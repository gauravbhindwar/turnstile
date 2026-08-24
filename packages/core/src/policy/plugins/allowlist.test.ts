import { describe, it, expect } from "vitest";
import { allowlistPlugin, type AllowlistParams } from "./allowlist.js";
import { makeTestContext, makeActionEvent } from "../testUtils.js";

async function evaluate(params: AllowlistParams, targetOverride?: string, upstreamOverride?: string) {
  const event = makeActionEvent({
    resource: { upstream: upstreamOverride ?? "openai", target: targetOverride ?? "gpt-4o-mini" },
  });
  const ctx = makeTestContext({ event, policy: { id: "p", params } });
  return allowlistPlugin.evaluate(ctx);
}

describe("allowlist plugin", () => {
  it("deny_only: passes when nothing matches deny", async () => {
    const result = await evaluate({ field: "target", allow: [], deny: ["claude-*"], mode: "deny_only" });
    expect(result.result).toBe("pass");
  });

  it("deny_only: denies when target matches a deny glob", async () => {
    const result = await evaluate({ field: "target", allow: [], deny: ["gpt-*"], mode: "deny_only" });
    expect(result.result).toBe("deny");
  });

  it("allow_only: denies by default when allow list is empty", async () => {
    const result = await evaluate({ field: "target", allow: [], deny: [], mode: "allow_only" });
    expect(result.result).toBe("deny");
  });

  it("allow_only: passes when target matches an allow glob", async () => {
    const result = await evaluate({ field: "target", allow: ["gpt-*"], deny: [], mode: "allow_only" });
    expect(result.result).toBe("pass");
  });

  it("allow_only: denies when target does not match any allow glob", async () => {
    const result = await evaluate({ field: "target", allow: ["claude-*"], deny: [], mode: "allow_only" });
    expect(result.result).toBe("deny");
  });

  it("deny always wins over allow, even in allow_only mode", async () => {
    const result = await evaluate({
      field: "target",
      allow: ["gpt-*"],
      deny: ["gpt-4o-mini"],
      mode: "allow_only",
    });
    expect(result.result).toBe("deny");
  });

  it("matches on the upstream field", async () => {
    const result = await evaluate(
      { field: "upstream", allow: [], deny: ["shady-upstream"], mode: "deny_only" },
      undefined,
      "shady-upstream",
    );
    expect(result.result).toBe("deny");
  });

  it("matches on the domain field, extracted from a URL target", async () => {
    const result = await evaluate(
      { field: "domain", allow: [], deny: ["*.internal.example"], mode: "deny_only" },
      "https://db.internal.example/query",
    );
    expect(result.result).toBe("deny");
  });

  it("domain field falls back to raw target when not a URL", async () => {
    const result = await evaluate(
      { field: "domain", allow: [], deny: ["not-a-url"], mode: "deny_only" },
      "not-a-url",
    );
    expect(result.result).toBe("deny");
  });
});
