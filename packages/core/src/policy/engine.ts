import type { ActionEvent, ActionClass, Decision, DecisionOutcome } from "../types/action.js";
import type { FailMode } from "../config/schema.js";
import type { Storage } from "../storage/types.js";
import type { Logger } from "../logging/logger.js";
import type { PolicyFile } from "./schema.js";
import type { PolicyPlugin, PluginResult, MatchedPolicyTrace } from "./types.js";
import { matchesEvent } from "./match.js";
import { makePluginKv } from "./pluginKv.js";
import type { PriceSheet } from "../metering/priceSheet.js";

const POLICY_TIMEOUT_MS = 50;

export interface EngineOptions {
  policies: PolicyFile[];
  plugins: Map<string, PolicyPlugin>;
  storage: Storage;
  logger: Logger;
  defaultActionByClass: Record<ActionClass, "allow" | "deny" | "escalate">;
  failMode: FailMode;
  priceSheet: PriceSheet;
}

export interface EvaluateResult {
  outcome: DecisionOutcome;
  finalReason: string;
  matchedPolicies: MatchedPolicyTrace[];
  transformedParams: unknown;
  escalatedPolicyId?: string;
  approvalHint?: { message?: string; timeoutS?: number };
}

async function runWithTimeout(promise: Promise<PluginResult>, ms: number): Promise<PluginResult> {
  return Promise.race([
    promise,
    new Promise<PluginResult>((_, reject) => setTimeout(() => reject(new Error("policy plugin timeout")), ms)),
  ]);
}

export class PolicyEngine {
  constructor(private readonly options: EngineOptions) {}

  async evaluate(event: ActionEvent): Promise<EvaluateResult> {
    const { policies, plugins, storage, logger, defaultActionByClass, failMode, priceSheet } = this.options;
    const budgetsCapability = {
      reserveIfUnder: storage.budgets.reserveIfUnder.bind(storage.budgets),
      settle: storage.budgets.settle.bind(storage.budgets),
      getUsage: storage.budgets.getUsage.bind(storage.budgets),
    };
    const matching = policies.filter((p) => p.enabled && matchesEvent(p.match, event));

    const trace: MatchedPolicyTrace[] = [];
    let outcome: DecisionOutcome = "allow";
    let finalReason = "no matching policy; default allow";
    let transformedParams: unknown = event.params.raw;
    let escalatedPolicyId: string | undefined;
    let approvalHint: { message?: string; timeoutS?: number } | undefined;
    let denied = false;
    let escalated = false;

    if (matching.length === 0) {
      const defaultOutcome = defaultActionByClass[event.actionClass];
      outcome = defaultOutcome === "allow" ? "allow" : defaultOutcome;
      finalReason = `no matching policy; default ${defaultOutcome} for class "${event.actionClass}"`;
      return { outcome, finalReason, matchedPolicies: trace, transformedParams };
    }

    for (const policy of matching) {
      if (denied) {
        trace.push({ policyId: policy.id, pluginName: policy.plugin, result: "pass", reason: "skipped (already denied)", latencyMs: 0 });
        continue;
      }

      const plugin = plugins.get(policy.plugin);
      if (!plugin) {
        trace.push({ policyId: policy.id, pluginName: policy.plugin, result: "pass", reason: "unknown plugin; skipped", latencyMs: 0 });
        continue;
      }

      const start = performance.now();
      let result: PluginResult;
      try {
        result = await runWithTimeout(
          plugin.evaluate({
            event,
            policy: { id: policy.id, params: policy.params },
            store: makePluginKv(storage, policy.id),
            now: () => new Date(),
            logger,
            budgets: budgetsCapability,
            priceSheet,
          }),
          POLICY_TIMEOUT_MS,
        );
      } catch (err) {
        const latencyMs = performance.now() - start;
        logger.error({ policyId: policy.id, plugin: policy.plugin, err: (err as Error).message }, "policy plugin error");
        const classFailMode = failMode[event.actionClass];
        if (classFailMode === "closed") {
          trace.push({ policyId: policy.id, pluginName: policy.plugin, result: "deny", reason: "POLICY_PLUGIN_ERROR", latencyMs });
          denied = true;
          outcome = "deny";
          finalReason = `policy "${policy.id}" errored and actionClass "${event.actionClass}" fails closed`;
          continue;
        } else {
          trace.push({ policyId: policy.id, pluginName: policy.plugin, result: "pass", reason: "POLICY_PLUGIN_ERROR (fail-open)", latencyMs });
          continue;
        }
      }
      const latencyMs = performance.now() - start;

      switch (result.result) {
        case "pass":
          trace.push({ policyId: policy.id, pluginName: policy.plugin, result: "pass", reason: "pass", latencyMs });
          break;
        case "deny":
          trace.push({ policyId: policy.id, pluginName: policy.plugin, result: "deny", reason: result.reason, latencyMs });
          denied = true;
          outcome = "deny";
          finalReason = `denied by policy "${policy.id}": ${result.reason}`;
          break;
        case "escalate":
          trace.push({ policyId: policy.id, pluginName: policy.plugin, result: "escalate", reason: result.reason, latencyMs });
          if (!escalated) {
            escalated = true;
            escalatedPolicyId = policy.id;
            approvalHint = result.approvalHint;
            finalReason = `escalated by policy "${policy.id}": ${result.reason}`;
          }
          break;
        case "transform":
          trace.push({ policyId: policy.id, pluginName: policy.plugin, result: "transform", reason: result.reason, latencyMs });
          transformedParams = result.patch(transformedParams);
          break;
      }
    }

    if (!denied && escalated) {
      outcome = "escalate";
    } else if (!denied && !escalated && transformedParams !== event.params.raw) {
      outcome = "transform";
      if (finalReason === "no matching policy; default allow") {
        finalReason = "parameters transformed by policy";
      }
    } else if (!denied && !escalated) {
      outcome = "allow";
      finalReason = "all matching policies passed";
    }

    return { outcome, finalReason, matchedPolicies: trace, transformedParams, escalatedPolicyId, approvalHint };
  }
}

export function buildDecision(eventId: string, actionEventId: string, evalResult: EvaluateResult, approvalId?: string): Decision {
  return {
    eventId,
    actionEventId,
    ts: new Date().toISOString(),
    outcome: evalResult.outcome,
    matchedPolicies: evalResult.matchedPolicies,
    finalReason: evalResult.finalReason,
    approval: approvalId ? { approvalId } : undefined,
  };
}
