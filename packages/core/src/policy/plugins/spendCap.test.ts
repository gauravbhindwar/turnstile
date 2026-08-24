import { describe, it, expect } from "vitest";
import { spendCapPlugin, type SpendCapParams } from "./spendCap.js";
import { makeTestContext, makeActionEvent, makeInMemoryBudgets, makeInMemoryKv } from "../testUtils.js";

const baseParams: SpendCapParams = {
  limit_usd: 1,
  window: "daily",
  on_breach: "deny",
  warn_at_pct: 80,
  scope: "agent",
};

describe("spend_cap plugin", () => {
  it("passes and reserves when under the cap", async () => {
    const ctx = makeTestContext({ policy: { id: "cap", params: baseParams } });
    const result = await spendCapPlugin.evaluate(ctx);
    expect(result.result).toBe("pass");
  });

  it("denies on breach when on_breach=deny", async () => {
    const params: SpendCapParams = { ...baseParams, limit_usd: 0.000001 };
    const ctx = makeTestContext({ policy: { id: "cap", params } });
    const result = await spendCapPlugin.evaluate(ctx);
    expect(result.result).toBe("deny");
  });

  it("escalates on breach when on_breach=escalate", async () => {
    const params: SpendCapParams = { ...baseParams, limit_usd: 0.000001, on_breach: "escalate" };
    const ctx = makeTestContext({ policy: { id: "cap", params } });
    const result = await spendCapPlugin.evaluate(ctx);
    expect(result.result).toBe("escalate");
  });

  it("blocks a runaway loop: N-th call breaches a small cap", async () => {
    const budgets = makeInMemoryBudgets();
    const params: SpendCapParams = { ...baseParams, limit_usd: 0.01 };
    let lastResult;
    let calls = 0;
    for (let i = 0; i < 100; i++) {
      const ctx = makeTestContext({
        policy: { id: "cap", params },
        budgets,
        event: makeActionEvent({ eventId: `evt-${i}`, params: { raw: { messages: [{ role: "user", content: "x".repeat(4000) }], max_tokens: 4000 }, bodySha256: "x", sizeBytes: 4000 } }),
      });
      lastResult = await spendCapPlugin.evaluate(ctx);
      calls++;
      if (lastResult.result === "deny") break;
    }
    expect(lastResult?.result).toBe("deny");
    expect(calls).toBeLessThan(100); // the cap actually bit before the loop "ran forever"
  });

  it("scope=workspace shares the budget across agents", async () => {
    const budgets = makeInMemoryBudgets();
    // Tiny max_tokens keeps the per-call estimate small and predictable so
    // one reservation fits under the cap but two don't.
    const smallParams = { raw: { messages: [{ role: "user", content: "hi" }], max_tokens: 1 }, bodySha256: "x", sizeBytes: 2 };
    const params: SpendCapParams = { ...baseParams, limit_usd: 0.00005, scope: "workspace" };
    const ctxA = makeTestContext({
      policy: { id: "cap", params },
      budgets,
      event: makeActionEvent({
        eventId: "a1",
        params: smallParams,
        principal: { agentId: "agent-A", agentName: "A", workspaceId: "ws-1", delegation: [], keyId: "k" },
      }),
    });
    const first = await spendCapPlugin.evaluate(ctxA);
    expect(first.result).toBe("pass");

    const ctxB = makeTestContext({
      policy: { id: "cap", params },
      budgets,
      event: makeActionEvent({
        eventId: "b1",
        params: smallParams,
        principal: { agentId: "agent-B", agentName: "B", workspaceId: "ws-1", delegation: [], keyId: "k" },
      }),
    });
    const second = await spendCapPlugin.evaluate(ctxB);
    expect(second.result).toBe("deny"); // same workspace scope, budget already spent by agent-A
  });

  it("onOutcome settles the reservation and clears pending state", async () => {
    const store = makeInMemoryKv();
    const budgets = makeInMemoryBudgets();
    const params: SpendCapParams = { ...baseParams, limit_usd: 1 };
    const event = makeActionEvent({ eventId: "evt-settle" });
    const ctx = makeTestContext({ policy: { id: "cap", params }, store, budgets, event });

    const evalResult = await spendCapPlugin.evaluate(ctx);
    expect(evalResult.result).toBe("pass");
    expect(store.get(`pending:${event.eventId}`)).not.toBeNull();

    await spendCapPlugin.onOutcome?.(ctx, {
      eventId: "out-1",
      actionEventId: event.eventId,
      ts: new Date().toISOString(),
      status: "success",
      latencyMs: 10,
      usage: { inputTokens: 10, outputTokens: 10, costUsd: 0.0001, priceSheetVersion: "x" },
    });

    expect(store.get(`pending:${event.eventId}`)).toBeNull();
    const usage = budgets.getUsage(`ws-1:agent-1:cap`, "2026-01-01");
    expect(usage.reservedUsd).toBe(0);
    expect(usage.settledUsd).toBe(0.0001);
  });

  it("onOutcome is a no-op if no reservation is pending (e.g. denied earlier)", async () => {
    const ctx = makeTestContext({ policy: { id: "cap", params: baseParams } });
    await expect(
      spendCapPlugin.onOutcome?.(ctx, {
        eventId: "out-1",
        actionEventId: "evt-1",
        ts: new Date().toISOString(),
        status: "success",
        latencyMs: 10,
      }),
    ).resolves.toBeUndefined();
  });
});
