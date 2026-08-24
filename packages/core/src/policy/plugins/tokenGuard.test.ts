import { describe, it, expect } from "vitest";
import { tokenGuardPlugin, type TokenGuardParams } from "./tokenGuard.js";
import { makeTestContext, makeActionEvent } from "../testUtils.js";

describe("token_guard plugin", () => {
  it("passes when max_tokens is under the cap", async () => {
    const params: TokenGuardParams = { max_output_tokens: 1000 };
    const event = makeActionEvent({ params: { raw: { max_tokens: 500 }, bodySha256: "x", sizeBytes: 1 } });
    const result = await tokenGuardPlugin.evaluate(makeTestContext({ policy: { id: "tg", params }, event }));
    expect(result.result).toBe("pass");
  });

  it("passes when max_tokens is omitted from the request", async () => {
    const params: TokenGuardParams = { max_output_tokens: 1000 };
    const event = makeActionEvent({ params: { raw: {}, bodySha256: "x", sizeBytes: 1 } });
    const result = await tokenGuardPlugin.evaluate(makeTestContext({ policy: { id: "tg", params }, event }));
    expect(result.result).toBe("pass");
  });

  it("transforms and clamps max_tokens when it exceeds the cap", async () => {
    const params: TokenGuardParams = { max_output_tokens: 1000 };
    const event = makeActionEvent({ params: { raw: { max_tokens: 5000, model: "gpt-4o" }, bodySha256: "x", sizeBytes: 1 } });
    const result = await tokenGuardPlugin.evaluate(makeTestContext({ policy: { id: "tg", params }, event }));
    expect(result.result).toBe("transform");
    if (result.result === "transform") {
      const patched = result.patch({ max_tokens: 5000, model: "gpt-4o" }) as { max_tokens: number; model: string };
      expect(patched.max_tokens).toBe(1000);
      expect(patched.model).toBe("gpt-4o"); // other fields pass through untouched
    }
  });

  it("passes when max_tokens equals the cap exactly (boundary)", async () => {
    const params: TokenGuardParams = { max_output_tokens: 1000 };
    const event = makeActionEvent({ params: { raw: { max_tokens: 1000 }, bodySha256: "x", sizeBytes: 1 } });
    const result = await tokenGuardPlugin.evaluate(makeTestContext({ policy: { id: "tg", params }, event }));
    expect(result.result).toBe("pass");
  });

  it("passes (no-op) when max_output_tokens is not configured", async () => {
    const params: TokenGuardParams = {};
    const event = makeActionEvent({ params: { raw: { max_tokens: 999999 }, bodySha256: "x", sizeBytes: 1 } });
    const result = await tokenGuardPlugin.evaluate(makeTestContext({ policy: { id: "tg", params }, event }));
    expect(result.result).toBe("pass");
  });
});
