import { describe, it, expect } from "vitest";
import { requireApprovalPlugin, RequireApprovalParamsSchema, type RequireApprovalParams } from "./requireApproval.js";
import { makeTestContext, makeActionEvent } from "../testUtils.js";

describe("require_approval plugin", () => {
  it("always escalates, regardless of the event", async () => {
    const params: RequireApprovalParams = {
      message_template: "please review",
      timeout_s: 300,
      on_timeout: "deny",
    };
    const ctx = makeTestContext({ policy: { id: "ra", params } });
    const result = await requireApprovalPlugin.evaluate(ctx);
    expect(result.result).toBe("escalate");
  });

  it("renders {{agent}}, {{target}}, {{kind}} in the message template", async () => {
    const params: RequireApprovalParams = {
      message_template: "{{agent}} wants to call {{kind}} on {{target}}",
      timeout_s: 300,
      on_timeout: "deny",
    };
    const event = makeActionEvent({
      kind: "model.chat",
      resource: { upstream: "openai", target: "gpt-4o" },
      principal: { agentId: "a1", agentName: "invoice-bot", workspaceId: "ws-1", delegation: [], keyId: "k" },
    });
    const ctx = makeTestContext({ policy: { id: "ra", params }, event });
    const result = await requireApprovalPlugin.evaluate(ctx);
    expect(result.result).toBe("escalate");
    if (result.result === "escalate") {
      expect(result.reason).toBe("invoice-bot wants to call model.chat on gpt-4o");
    }
  });

  it("passes timeout_s and on_timeout through as an approvalHint", async () => {
    const params: RequireApprovalParams = { message_template: "x", timeout_s: 60, on_timeout: "allow" };
    const ctx = makeTestContext({ policy: { id: "ra", params } });
    const result = await requireApprovalPlugin.evaluate(ctx);
    expect(result.result).toBe("escalate");
    if (result.result === "escalate") {
      expect(result.approvalHint).toEqual({ message: "x", timeoutS: 60, onTimeout: "allow" });
    }
  });

  it("defaults on_timeout to deny (fail-closed) once schema defaults are applied", async () => {
    const params: RequireApprovalParams = RequireApprovalParamsSchema.parse({ message_template: "x" });
    const ctx = makeTestContext({ policy: { id: "ra", params } });
    const result = await requireApprovalPlugin.evaluate(ctx);
    expect(result.result).toBe("escalate");
    if (result.result === "escalate") {
      expect(result.approvalHint?.onTimeout).toBe("deny");
    }
  });
});
