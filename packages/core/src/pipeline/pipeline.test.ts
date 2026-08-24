import { describe, it, expect, afterEach } from "vitest";
import { Pipeline } from "./pipeline.js";
import { SqliteStorage } from "../storage/sqlite.js";
import { EventBus, type BusEvent } from "../bus/eventBus.js";
import { loadPriceSheet } from "../metering/priceSheet.js";
import { createLogger } from "../logging/logger.js";
import { builtinPlugins } from "../policy/plugins/index.js";
import type { PolicyFile } from "../policy/schema.js";
import { makeActionEvent } from "../policy/testUtils.js";
import { loadOrCreateCheckpointKeypair } from "../ledger/keys.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Storage } from "../storage/types.js";

const priceSheet = loadPriceSheet();
const logger = createLogger({ level: "silent", format: "json" });

function spendCapPolicy(limitUsd: number): PolicyFile {
  return {
    id: "invoice-bot-cap",
    enabled: true,
    priority: 100,
    match: { classes: ["spend"] },
    plugin: "spend_cap",
    params: { limit_usd: limitUsd, window: "daily", on_breach: "deny", warn_at_pct: 80, scope: "agent" },
  };
}

describe("Pipeline (end-to-end policy -> ledger -> SSE)", () => {
  let storage: Storage | null = null;
  let dataDir: string | null = null;

  afterEach(async () => {
    if (storage) await storage.close();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    storage = null;
    dataDir = null;
  });

  async function makePipeline(limitUsd: number) {
    storage = new SqliteStorage(":memory:");
    await storage.init();
    dataDir = mkdtempSync(join(tmpdir(), "turnstile-pipeline-test-"));
    const eventBus = new EventBus();
    const pipeline = new Pipeline(
      {
        storage,
        logger,
        eventBus,
        priceSheet,
        defaultActionByClass: { read: "allow", mutate: "allow", spend: "allow" },
        failMode: { read: "open", mutate: "closed", spend: "closed" },
        checkpointKeypair: loadOrCreateCheckpointKeypair(dataDir),
        checkpointEveryRows: 1000,
        checkpointEveryMs: 60_000,
      },
      [spendCapPolicy(limitUsd)],
      builtinPlugins(),
    );
    return { pipeline, storage, eventBus };
  }

  it("allows a call under the cap, then blocks the runaway loop once it breaches", async () => {
    const { pipeline, eventBus } = await makePipeline(0.00005);
    const seen: BusEvent[] = [];
    eventBus.subscribe((e) => seen.push(e));

    const smallParams = { raw: { messages: [{ role: "user", content: "hi" }], max_tokens: 1 }, bodySha256: "x", sizeBytes: 2 };

    let deniedAt = -1;
    for (let i = 0; i < 50; i++) {
      const event = makeActionEvent({ eventId: `loop-${i}`, params: smallParams });
      const { decision } = await pipeline.runPolicyStage(event);
      if (decision.outcome === "deny") {
        deniedAt = i;
        break;
      }
    }

    expect(deniedAt).toBeGreaterThanOrEqual(0);
    expect(deniedAt).toBeLessThan(50); // the cap actually bit — this IS the "magic moment"

    // Every action + decision landed on the SSE bus live.
    const actionEvents = seen.filter((e) => e.type === "action");
    const decisionEvents = seen.filter((e) => e.type === "decision");
    expect(actionEvents.length).toBe(deniedAt + 1);
    expect(decisionEvents.length).toBe(deniedAt + 1);
    const lastDecision = decisionEvents[decisionEvents.length - 1];
    expect(lastDecision?.type).toBe("decision");
    if (lastDecision?.type === "decision") {
      expect(lastDecision.data.outcome).toBe("deny");
    }
  });

  it("appends action+decision to a verifiable ledger", async () => {
    const { pipeline, storage: s } = await makePipeline(1);
    const event = makeActionEvent({ eventId: "e1" });
    await pipeline.runPolicyStage(event);

    const head = await s.ledger.latest();
    expect(head).not.toBeNull();
    expect(head!.seq).toBe(1); // action=seq0, decision=seq1
  });

  it("settles the budget reservation via onOutcome after recordOutcome", async () => {
    const { pipeline, storage: s } = await makePipeline(1);
    const event = makeActionEvent({ eventId: "e1" });
    const { evalResult } = await pipeline.runPolicyStage(event);
    expect(evalResult.outcome).toBe("allow");

    await pipeline.recordOutcome(
      event,
      {
        eventId: "out-1",
        actionEventId: event.eventId,
        ts: new Date().toISOString(),
        status: "success",
        latencyMs: 5,
        usage: { inputTokens: 10, outputTokens: 10, costUsd: 0.0002, priceSheetVersion: priceSheet.version },
      },
      evalResult,
    );

    const usage = s.budgets.getUsage("ws-1:agent-1:invoice-bot-cap", new Date().toISOString().slice(0, 10));
    expect(usage.settledUsd).toBe(0.0002);
    expect(usage.reservedUsd).toBe(0);
  });
});
