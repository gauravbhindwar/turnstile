import type { ActionEvent } from "../types/action.js";
import type { BudgetsCapability, PluginKV, PolicyContext } from "./types.js";
import { loadPriceSheet } from "../metering/priceSheet.js";
import { createLogger } from "../logging/logger.js";

export function makeActionEvent(overrides: Partial<ActionEvent> = {}): ActionEvent {
  return {
    schemaVersion: "1.0",
    eventId: overrides.eventId ?? "evt-1",
    traceId: "trace-1",
    sessionId: null,
    parentEventId: null,
    ts: new Date().toISOString(),
    principal: {
      agentId: "agent-1",
      agentName: "test-agent",
      workspaceId: "ws-1",
      delegation: [],
      keyId: "key-1",
    },
    kind: "model.chat",
    actionClass: "spend",
    resource: { upstream: "openai", target: "gpt-4o-mini" },
    params: { raw: { messages: [{ role: "user", content: "hi" }] }, bodySha256: "abc", sizeBytes: 10 },
    context: { clientIp: "127.0.0.1", userAgent: null, adapter: "openai" },
    ...overrides,
  };
}

export function makeInMemoryKv(): PluginKV {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    incr: (key, by) => {
      const next = (Number(map.get(key)) || 0) + by;
      map.set(key, String(next));
      return next;
    },
    delete: (key) => {
      map.delete(key);
    },
  };
}

export function makeInMemoryBudgets(): BudgetsCapability {
  const counters = new Map<string, { reserved: number; settled: number }>();
  const keyOf = (scopeKey: string, windowKey: string) => `${scopeKey}::${windowKey}`;
  return {
    reserveIfUnder: (scopeKey, windowKey, est, limit) => {
      const k = keyOf(scopeKey, windowKey);
      const cur = counters.get(k) ?? { reserved: 0, settled: 0 };
      if (cur.settled + cur.reserved + est > limit) return false;
      cur.reserved += est;
      counters.set(k, cur);
      return true;
    },
    settle: (scopeKey, windowKey, est, actual) => {
      const k = keyOf(scopeKey, windowKey);
      const cur = counters.get(k) ?? { reserved: 0, settled: 0 };
      cur.reserved = Math.max(0, cur.reserved - est);
      cur.settled += actual;
      counters.set(k, cur);
    },
    getUsage: (scopeKey, windowKey) => {
      const cur = counters.get(keyOf(scopeKey, windowKey)) ?? { reserved: 0, settled: 0 };
      return { reservedUsd: cur.reserved, settledUsd: cur.settled };
    },
  };
}

export function makeTestContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    event: makeActionEvent(),
    policy: { id: "test-policy", params: {} },
    store: makeInMemoryKv(),
    now: () => new Date("2026-01-01T12:00:00.000Z"),
    logger: createLogger({ level: "silent", format: "json" }),
    budgets: makeInMemoryBudgets(),
    priceSheet: loadPriceSheet(),
    ...overrides,
  };
}
