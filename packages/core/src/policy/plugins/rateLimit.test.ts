import { describe, it, expect } from "vitest";
import { rateLimitPlugin, type RateLimitParams } from "./rateLimit.js";
import { makeTestContext, makeActionEvent, makeInMemoryKv } from "../testUtils.js";

const baseParams: RateLimitParams = { max_requests: 3, per: "1m", scope: "agent", on_breach: "deny" };
const fixedNow = new Date("2026-01-01T12:00:30.000Z");

describe("rate_limit plugin", () => {
  it("passes under the limit", async () => {
    const store = makeInMemoryKv();
    for (let i = 0; i < 3; i++) {
      const ctx = makeTestContext({ policy: { id: "rl", params: baseParams }, store, now: () => fixedNow });
      const result = await rateLimitPlugin.evaluate(ctx);
      expect(result.result).toBe("pass");
    }
  });

  it("denies the request that breaches the limit", async () => {
    const store = makeInMemoryKv();
    let lastResult;
    for (let i = 0; i < 4; i++) {
      const ctx = makeTestContext({ policy: { id: "rl", params: baseParams }, store, now: () => fixedNow });
      lastResult = await rateLimitPlugin.evaluate(ctx);
    }
    expect(lastResult?.result).toBe("deny");
  });

  it("escalates instead of denying when on_breach=escalate", async () => {
    const store = makeInMemoryKv();
    const params: RateLimitParams = { ...baseParams, on_breach: "escalate" };
    let lastResult;
    for (let i = 0; i < 4; i++) {
      const ctx = makeTestContext({ policy: { id: "rl", params }, store, now: () => fixedNow });
      lastResult = await rateLimitPlugin.evaluate(ctx);
    }
    expect(lastResult?.result).toBe("escalate");
  });

  it("resets in a new window bucket", async () => {
    const store = makeInMemoryKv();
    for (let i = 0; i < 3; i++) {
      const ctx = makeTestContext({ policy: { id: "rl", params: baseParams }, store, now: () => fixedNow });
      await rateLimitPlugin.evaluate(ctx);
    }
    const nextMinute = new Date(fixedNow.getTime() + 61_000);
    const ctx = makeTestContext({ policy: { id: "rl", params: baseParams }, store, now: () => nextMinute });
    const result = await rateLimitPlugin.evaluate(ctx);
    expect(result.result).toBe("pass");
  });

  it("scope=workspace shares the counter across agents", async () => {
    const store = makeInMemoryKv();
    const params: RateLimitParams = { ...baseParams, scope: "workspace" };
    const agentA = makeActionEvent({
      eventId: "a1",
      principal: { agentId: "agent-A", agentName: "A", workspaceId: "ws-1", delegation: [], keyId: "k" },
    });
    const agentB = makeActionEvent({
      eventId: "b1",
      principal: { agentId: "agent-B", agentName: "B", workspaceId: "ws-1", delegation: [], keyId: "k" },
    });
    for (const event of [agentA, agentA, agentA]) {
      await rateLimitPlugin.evaluate(makeTestContext({ policy: { id: "rl", params }, store, now: () => fixedNow, event }));
    }
    const result = await rateLimitPlugin.evaluate(
      makeTestContext({ policy: { id: "rl", params }, store, now: () => fixedNow, event: agentB }),
    );
    expect(result.result).toBe("deny"); // same workspace-scoped bucket, already at the limit
  });
});
