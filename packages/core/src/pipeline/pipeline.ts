import { uuidv7 } from "../ids.js";
import type { ActionEvent, Decision, OutcomeEvent } from "../types/action.js";
import type { ApprovalRow, Storage } from "../storage/types.js";
import type { Logger } from "../logging/logger.js";
import type { PolicyFile } from "../policy/schema.js";
import type { PolicyPlugin } from "../policy/types.js";
import { PolicyEngine, buildDecision, type EvaluateResult } from "../policy/engine.js";
import { makePluginKv } from "../policy/pluginKv.js";
import { EventBus } from "../bus/eventBus.js";
import type { PriceSheet } from "../metering/priceSheet.js";
import type { FailMode, DefaultActionByClass } from "../config/schema.js";
import { buildCheckpointRow, shouldCheckpoint } from "../ledger/checkpoint.js";
import type { CheckpointKeypair } from "../ledger/keys.js";

export interface PipelineOptions {
  storage: Storage;
  logger: Logger;
  eventBus: EventBus;
  priceSheet: PriceSheet;
  defaultActionByClass: DefaultActionByClass;
  failMode: FailMode;
  checkpointKeypair: CheckpointKeypair;
  checkpointEveryRows: number;
  checkpointEveryMs: number;
}

export interface PolicyStageResult {
  decision: Decision;
  evalResult: EvaluateResult;
  transformedParams: unknown;
}

// The seven-stage core pipeline (§4). Stages 1-2 (normalize, authenticate)
// happen in the adapter before an ActionEvent exists. This class owns
// stages 3 (policy eval), 6 (ledger append), and 7 (emit) around the
// adapter's stage 4 (execute) and 5 (meter, folded into recordOutcome).
export class Pipeline {
  private rowsSinceCheckpoint = 0;
  private lastCheckpointAt = Date.now();

  constructor(
    private readonly options: PipelineOptions,
    private policies: PolicyFile[],
    private readonly plugins: Map<string, PolicyPlugin>,
  ) {}

  setPolicies(policies: PolicyFile[]): void {
    this.policies = policies;
  }

  private engine(): PolicyEngine {
    return new PolicyEngine({
      policies: this.policies,
      plugins: this.plugins,
      storage: this.options.storage,
      logger: this.options.logger,
      defaultActionByClass: this.options.defaultActionByClass,
      failMode: this.options.failMode,
      priceSheet: this.options.priceSheet,
    });
  }

  async runPolicyStage(event: ActionEvent): Promise<PolicyStageResult> {
    const { storage, eventBus } = this.options;
    const evalResult = await this.engine().evaluate(event);
    const decision = buildDecision(uuidv7(), event.eventId, evalResult);

    storage.events.insertAction(event);
    storage.events.insertDecision(decision, event.eventId);

    await storage.ledger.append([
      { eventId: event.eventId, ts: event.ts, kind: "action", payload: event },
      { eventId: decision.eventId, ts: decision.ts, kind: "decision", payload: decision },
    ]);
    this.rowsSinceCheckpoint += 2;

    eventBus.publish({ type: "action", data: event });
    eventBus.publish({ type: "decision", data: decision });

    await this.maybeCheckpoint();

    return { decision, evalResult, transformedParams: evalResult.transformedParams };
  }

  async recordOutcome(event: ActionEvent, outcome: OutcomeEvent, evalResult: EvaluateResult): Promise<void> {
    const { storage, eventBus } = this.options;

    storage.events.insertOutcome(outcome, event.eventId);
    await storage.ledger.append([{ eventId: outcome.eventId, ts: outcome.ts, kind: "outcome", payload: outcome }]);
    this.rowsSinceCheckpoint += 1;

    eventBus.publish({ type: "outcome", data: outcome });

    // Metering hooks (§8.3 onOutcome) — only for policies that actually
    // matched and ran (recorded in the decision trace), scoped to plugins
    // that declare onOutcome (spend_cap settles its reservation here).
    for (const trace of evalResult.matchedPolicies) {
      const plugin = this.plugins.get(trace.pluginName);
      if (!plugin?.onOutcome) continue;
      const policy = this.policies.find((p) => p.id === trace.policyId);
      if (!policy) continue;
      await plugin.onOutcome(
        {
          event,
          policy: { id: policy.id, params: policy.params },
          store: makePluginKv(storage, policy.id),
          now: () => new Date(),
          logger: this.options.logger,
          budgets: {
            reserveIfUnder: storage.budgets.reserveIfUnder.bind(storage.budgets),
            settle: storage.budgets.settle.bind(storage.budgets),
            getUsage: storage.budgets.getUsage.bind(storage.budgets),
          },
          priceSheet: this.options.priceSheet,
        },
        outcome,
      );
    }

    await this.maybeCheckpoint();
  }

  // Records an approval's terminal decision (approved/denied/expired) as
  // its own ledger row (kind "approval") and publishes it live — separate
  // from the original "escalate" Decision row, since it can land seconds
  // or minutes later, from a human, not a policy plugin.
  async recordApprovalDecision(approval: ApprovalRow): Promise<void> {
    const { storage, eventBus } = this.options;
    await storage.ledger.append([{ eventId: approval.id, ts: approval.decidedAt ?? new Date().toISOString(), kind: "approval", payload: approval }]);
    this.rowsSinceCheckpoint += 1;
    eventBus.publish({ type: "approval", data: approval });
    await this.maybeCheckpoint();
  }

  private async maybeCheckpoint(): Promise<void> {
    const msSinceLastCheckpoint = Date.now() - this.lastCheckpointAt;
    if (!shouldCheckpoint(this.rowsSinceCheckpoint, msSinceLastCheckpoint, this.options.checkpointEveryRows, this.options.checkpointEveryMs)) {
      return;
    }
    const head = await this.options.storage.ledger.latest();
    if (!head) return;

    const row = buildCheckpointRow(uuidv7(), head.seq, head.chainHash, this.options.checkpointKeypair.privateKeyPem);
    await this.options.storage.ledger.append([row]);
    this.rowsSinceCheckpoint = 0;
    this.lastCheckpointAt = Date.now();
    this.options.logger.info({ upToSeq: head.seq }, "ledger checkpoint written");
  }
}
