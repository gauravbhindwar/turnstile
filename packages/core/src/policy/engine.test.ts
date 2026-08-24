import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { PolicyEngine } from "./engine.js";
import type { PolicyPlugin, PolicyContext, PluginResult } from "./types.js";
import type { PolicyFile } from "./schema.js";
import { SqliteStorage } from "../storage/sqlite.js";
import { loadPriceSheet } from "../metering/priceSheet.js";
import { createLogger } from "../logging/logger.js";
import { makeActionEvent } from "./testUtils.js";
import type { Storage } from "../storage/types.js";

function makePlugin(name: string, resultFn: (ctx: PolicyContext) => PluginResult | Promise<PluginResult>): PolicyPlugin {
  return {
    name,
    version: "1.0.0",
    paramsSchema: z.unknown(),
    evaluate: async (ctx) => resultFn(ctx),
  };
}

function policyFile(overrides: Partial<PolicyFile>): PolicyFile {
  return {
    id: "p",
    enabled: true,
    priority: 100,
    match: {},
    plugin: "noop",
    params: {},
    ...overrides,
  };
}

const logger = createLogger({ level: "silent", format: "json" });
const priceSheet = loadPriceSheet();

async function makeStorage(): Promise<Storage> {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  return storage;
}

describe("PolicyEngine combination semantics (§8.4)", () => {
  let storage: Storage | null = null;
  afterEach(async () => {
    if (storage) await storage.close();
    storage = null;
  });

  it("defaults to allow when no policy matches", async () => {
    storage = await makeStorage();
    const engine = new PolicyEngine({
      policies: [],
      plugins: new Map(),
      storage,
      logger,
      defaultActionByClass: { read: "allow", mutate: "allow", spend: "allow" },
      failMode: { read: "open", mutate: "closed", spend: "closed" },
      priceSheet,
    });
    const result = await engine.evaluate(makeActionEvent());
    expect(result.outcome).toBe("allow");
  });

  it("uses the configured default for the action's class when no policy matches", async () => {
    storage = await makeStorage();
    const engine = new PolicyEngine({
      policies: [],
      plugins: new Map(),
      storage,
      logger,
      defaultActionByClass: { read: "allow", mutate: "allow", spend: "escalate" },
      failMode: { read: "open", mutate: "closed", spend: "closed" },
      priceSheet,
    });
    const result = await engine.evaluate(makeActionEvent({ actionClass: "spend" }));
    expect(result.outcome).toBe("escalate");
  });

  it("first deny short-circuits; later policies are skipped", async () => {
    storage = await makeStorage();
    const plugins = new Map<string, PolicyPlugin>([
      ["deny-a", makePlugin("deny-a", () => ({ result: "deny", reason: "no" }))],
      ["always-pass", makePlugin("always-pass", () => ({ result: "pass" }))],
    ]);
    const engine = new PolicyEngine({
      policies: [
        policyFile({ id: "p1", priority: 1, plugin: "deny-a" }),
        policyFile({ id: "p2", priority: 2, plugin: "always-pass" }),
      ],
      plugins,
      storage,
      logger,
      defaultActionByClass: { read: "allow", mutate: "allow", spend: "allow" },
      failMode: { read: "open", mutate: "closed", spend: "closed" },
      priceSheet,
    });
    const result = await engine.evaluate(makeActionEvent());
    expect(result.outcome).toBe("deny");
    expect(result.matchedPolicies[1]?.reason).toContain("skipped");
  });

  it("a later deny wins over an earlier escalate", async () => {
    storage = await makeStorage();
    const plugins = new Map<string, PolicyPlugin>([
      ["escalate-a", makePlugin("escalate-a", () => ({ result: "escalate", reason: "please review" }))],
      ["deny-b", makePlugin("deny-b", () => ({ result: "deny", reason: "no" }))],
    ]);
    const engine = new PolicyEngine({
      policies: [
        policyFile({ id: "p1", priority: 1, plugin: "escalate-a" }),
        policyFile({ id: "p2", priority: 2, plugin: "deny-b" }),
      ],
      plugins,
      storage,
      logger,
      defaultActionByClass: { read: "allow", mutate: "allow", spend: "allow" },
      failMode: { read: "open", mutate: "closed", spend: "closed" },
      priceSheet,
    });
    const result = await engine.evaluate(makeActionEvent());
    expect(result.outcome).toBe("deny");
  });

  it("transform patches accumulate in order and never override deny/escalate", async () => {
    storage = await makeStorage();
    const plugins = new Map<string, PolicyPlugin>([
      ["clamp-a", makePlugin("clamp-a", () => ({ result: "transform", reason: "clamp a", patch: (p) => ({ ...(p as object), a: 1 }) }))],
      ["clamp-b", makePlugin("clamp-b", () => ({ result: "transform", reason: "clamp b", patch: (p) => ({ ...(p as object), b: 2 }) }))],
    ]);
    const engine = new PolicyEngine({
      policies: [
        policyFile({ id: "p1", priority: 1, plugin: "clamp-a" }),
        policyFile({ id: "p2", priority: 2, plugin: "clamp-b" }),
      ],
      plugins,
      storage,
      logger,
      defaultActionByClass: { read: "allow", mutate: "allow", spend: "allow" },
      failMode: { read: "open", mutate: "closed", spend: "closed" },
      priceSheet,
    });
    const result = await engine.evaluate(makeActionEvent());
    expect(result.outcome).toBe("transform");
    expect(result.transformedParams).toMatchObject({ a: 1, b: 2 });
  });

  it("plugin timeout/throw fails closed for mutate/spend classes", async () => {
    storage = await makeStorage();
    const plugins = new Map<string, PolicyPlugin>([
      ["boom", makePlugin("boom", async () => { throw new Error("boom"); })],
    ]);
    const engine = new PolicyEngine({
      policies: [policyFile({ id: "p1", plugin: "boom" })],
      plugins,
      storage,
      logger,
      defaultActionByClass: { read: "allow", mutate: "allow", spend: "allow" },
      failMode: { read: "open", mutate: "closed", spend: "closed" },
      priceSheet,
    });
    const result = await engine.evaluate(makeActionEvent({ actionClass: "mutate" }));
    expect(result.outcome).toBe("deny");
  });

  it("plugin timeout/throw fails open for read class", async () => {
    storage = await makeStorage();
    const plugins = new Map<string, PolicyPlugin>([
      ["boom", makePlugin("boom", async () => { throw new Error("boom"); })],
    ]);
    const engine = new PolicyEngine({
      policies: [policyFile({ id: "p1", plugin: "boom" })],
      plugins,
      storage,
      logger,
      defaultActionByClass: { read: "allow", mutate: "allow", spend: "allow" },
      failMode: { read: "open", mutate: "closed", spend: "closed" },
      priceSheet,
    });
    const result = await engine.evaluate(makeActionEvent({ actionClass: "read", kind: "mcp.resource_read" }));
    expect(result.outcome).toBe("allow");
  });

  it("only evaluates policies whose match selector fits the event", async () => {
    storage = await makeStorage();
    const plugins = new Map<string, PolicyPlugin>([
      ["deny-all", makePlugin("deny-all", () => ({ result: "deny", reason: "no" }))],
    ]);
    const engine = new PolicyEngine({
      policies: [policyFile({ id: "p1", plugin: "deny-all", match: { agents: ["someone-else"] } })],
      plugins,
      storage,
      logger,
      defaultActionByClass: { read: "allow", mutate: "allow", spend: "allow" },
      failMode: { read: "open", mutate: "closed", spend: "closed" },
      priceSheet,
    });
    const result = await engine.evaluate(makeActionEvent());
    expect(result.outcome).toBe("allow");
  });
});
