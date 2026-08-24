import { z } from "zod";
import type { PolicyContext, PluginResult, PolicyPlugin } from "../types.js";

export const TokenGuardParamsSchema = z.object({
  max_input_tokens: z.number().int().positive().optional(),
  max_output_tokens: z.number().int().positive().optional(),
});

export type TokenGuardParams = z.infer<typeof TokenGuardParamsSchema>;

interface ChatParams {
  max_tokens?: number;
  [key: string]: unknown;
}

// Prevents runaway generations by clamping max_tokens down to
// max_output_tokens when the request asks for more (§9). A transform, not
// a deny — the call still goes through, just capped.
export const tokenGuardPlugin: PolicyPlugin = {
  name: "token_guard",
  version: "1.0.0",
  paramsSchema: TokenGuardParamsSchema,

  async evaluate(ctx: PolicyContext): Promise<PluginResult> {
    const params = ctx.policy.params as TokenGuardParams;
    if (params.max_output_tokens === undefined) {
      return { result: "pass" };
    }

    const raw = ctx.event.params.raw as ChatParams | undefined;
    const requested = raw?.max_tokens;
    if (requested === undefined || requested <= params.max_output_tokens) {
      return { result: "pass" };
    }

    const cap = params.max_output_tokens;
    return {
      result: "transform",
      reason: `max_tokens ${requested} clamped to token_guard's max_output_tokens (${cap})`,
      patch: (current) => ({ ...(current as ChatParams), max_tokens: cap }),
    };
  },
};
