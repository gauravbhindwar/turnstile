import { z } from "zod";
import type { PolicyContext, PluginResult, PolicyPlugin } from "../types.js";

export const RequireApprovalParamsSchema = z.object({
  message_template: z.string().default("Action requires human approval."),
  approvers_channel: z.string().optional(), // informational; actual delivery is Slack/generic webhook config
  timeout_s: z.number().int().positive().default(300),
  on_timeout: z.enum(["deny", "allow"]).default("deny"),
});

export type RequireApprovalParams = z.infer<typeof RequireApprovalParamsSchema>;

function renderTemplate(template: string, ctx: PolicyContext): string {
  return template
    .replace(/\{\{\s*agent\s*\}\}/g, ctx.event.principal.agentName)
    .replace(/\{\{\s*target\s*\}\}/g, ctx.event.resource.target)
    .replace(/\{\{\s*kind\s*\}\}/g, ctx.event.kind);
}

// Always escalates matching actions (§9) — the match selector in the
// policy YAML decides which actions this applies to.
export const requireApprovalPlugin: PolicyPlugin = {
  name: "require_approval",
  version: "1.0.0",
  paramsSchema: RequireApprovalParamsSchema,

  async evaluate(ctx: PolicyContext): Promise<PluginResult> {
    const params = ctx.policy.params as RequireApprovalParams;
    const reason = renderTemplate(params.message_template, ctx);
    return {
      result: "escalate",
      reason,
      approvalHint: { message: reason, timeoutS: params.timeout_s, onTimeout: params.on_timeout },
    };
  },
};
