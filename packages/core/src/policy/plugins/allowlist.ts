import { z } from "zod";
import { minimatch } from "minimatch";
import type { PolicyContext, PluginResult, PolicyPlugin } from "../types.js";

export const AllowlistParamsSchema = z.object({
  field: z.enum(["target", "upstream", "domain"]),
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
  // allow_only: default-deny, fieldValue must match `allow` to pass.
  // deny_only: default-allow, fieldValue must NOT match `deny` to pass.
  // In both modes a `deny` match always wins over an `allow` match.
  mode: z.enum(["allow_only", "deny_only"]).default("deny_only"),
});

export type AllowlistParams = z.infer<typeof AllowlistParamsSchema>;

function extractFieldValue(field: AllowlistParams["field"], event: PolicyContext["event"]): string {
  if (field === "upstream") return event.resource.upstream;
  if (field === "target") return event.resource.target;
  // domain: pull the hostname out of a URL-shaped target, else use it raw.
  try {
    return new URL(event.resource.target).hostname;
  } catch {
    return event.resource.target;
  }
}

function matchesAny(value: string, globs: string[]): boolean {
  return globs.some((glob) => minimatch(value, glob));
}

export const allowlistPlugin: PolicyPlugin = {
  name: "allowlist",
  version: "1.0.0",
  paramsSchema: AllowlistParamsSchema,

  async evaluate(ctx: PolicyContext): Promise<PluginResult> {
    const params = ctx.policy.params as AllowlistParams;
    const value = extractFieldValue(params.field, ctx.event);

    if (params.deny.length > 0 && matchesAny(value, params.deny)) {
      return { result: "deny", reason: `"${value}" matched deny glob for field "${params.field}"` };
    }

    if (params.mode === "allow_only") {
      if (params.allow.length === 0 || !matchesAny(value, params.allow)) {
        return { result: "deny", reason: `"${value}" did not match any allow glob for field "${params.field}"` };
      }
      return { result: "pass" };
    }

    // deny_only: not denied above => allowed.
    return { result: "pass" };
  },
};
