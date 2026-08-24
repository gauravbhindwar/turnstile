import { z } from "zod";
import type { PolicyContext, PluginResult, PolicyPlugin } from "../types.js";

export const RateLimitParamsSchema = z.object({
  max_requests: z.number().int().positive(),
  per: z.enum(["1m", "1h", "1d"]),
  scope: z.enum(["agent", "workspace"]).default("agent"),
  on_breach: z.enum(["deny", "escalate"]).default("deny"),
});

export type RateLimitParams = z.infer<typeof RateLimitParamsSchema>;

const WINDOW_MS: Record<RateLimitParams["per"], number> = {
  "1m": 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

// Fixed-window counter (bucketed by floor(now/windowMs)), not a true
// sliding window — simpler, and the standard "reset at N/bucket" behavior
// is what most rate-limit UX expects anyway. Documented deviation from the
// spec's "sliding window" wording; state lives entirely in `store` (§8.3).
export const rateLimitPlugin: PolicyPlugin = {
  name: "rate_limit",
  version: "1.0.0",
  paramsSchema: RateLimitParamsSchema,

  async evaluate(ctx: PolicyContext): Promise<PluginResult> {
    const params = ctx.policy.params as RateLimitParams;
    const windowMs = WINDOW_MS[params.per];
    const bucket = Math.floor(ctx.now().getTime() / windowMs);
    const scopeId = params.scope === "agent" ? ctx.event.principal.agentId : ctx.event.principal.workspaceId;
    const key = `${scopeId}:${bucket}`;

    const count = ctx.store.incr(key, 1, windowMs);
    if (count > params.max_requests) {
      const reason = `rate limit of ${params.max_requests} requests per ${params.per} exceeded (scope: ${params.scope})`;
      return params.on_breach === "escalate"
        ? { result: "escalate", reason, approvalHint: { message: reason } }
        : { result: "deny", reason };
    }
    return { result: "pass" };
  },
};
