import { z } from "zod";
import { SCHEMA_VERSION } from "./action.js";

export const ActionKindSchema = z.enum([
  "model.chat",
  "model.embed",
  "mcp.tool_call",
  "mcp.resource_read",
  "http.request",
  "custom.action",
]);

export const ActionClassSchema = z.enum(["read", "mutate", "spend"]);

export const DelegationLinkSchema = z.object({
  type: z.enum(["human", "agent", "service"]),
  id: z.string(),
  note: z.string().optional(),
});

export const PrincipalSchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  workspaceId: z.string(),
  delegation: z.array(DelegationLinkSchema),
  keyId: z.string(),
});

export const ActionEventSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  eventId: z.string(),
  traceId: z.string(),
  sessionId: z.string().nullable(),
  parentEventId: z.string().nullable(),
  ts: z.string(),
  principal: PrincipalSchema,
  kind: ActionKindSchema,
  actionClass: ActionClassSchema,
  resource: z.object({
    upstream: z.string(),
    target: z.string(),
    method: z.string().optional(),
  }),
  params: z.object({
    raw: z.unknown(),
    bodySha256: z.string(),
    sizeBytes: z.number().int().nonnegative(),
  }),
  context: z.object({
    clientIp: z.string(),
    userAgent: z.string().nullable(),
    adapter: z.enum(["openai", "mcp", "actions", "forward"]),
  }),
});

export const DecisionOutcomeSchema = z.enum(["allow", "deny", "escalate", "transform"]);

export const MatchedPolicySchema = z.object({
  policyId: z.string(),
  pluginName: z.string(),
  result: z.union([DecisionOutcomeSchema, z.literal("pass")]),
  reason: z.string(),
  latencyMs: z.number(),
});

export const DecisionSchema = z.object({
  eventId: z.string(),
  actionEventId: z.string(),
  ts: z.string(),
  outcome: DecisionOutcomeSchema,
  matchedPolicies: z.array(MatchedPolicySchema),
  finalReason: z.string(),
  transform: z
    .object({ description: z.string(), paramsPatchSha256: z.string() })
    .optional(),
  approval: z.object({ approvalId: z.string() }).optional(),
});

export const OutcomeStatusSchema = z.enum([
  "success",
  "upstream_error",
  "denied",
  "timeout",
  "approval_denied",
  "approval_timeout",
]);

export const UsageSummarySchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative(),
  priceSheetVersion: z.string(),
  estimated: z.boolean().optional(),
});

export const OutcomeEventSchema = z.object({
  eventId: z.string(),
  actionEventId: z.string(),
  ts: z.string(),
  status: OutcomeStatusSchema,
  httpStatus: z.number().optional(),
  latencyMs: z.number(),
  upstreamLatencyMs: z.number().optional(),
  usage: UsageSummarySchema.optional(),
  responseSha256: z.string().optional(),
  responseSizeBytes: z.number().optional(),
  errorCode: z.string().optional(),
});
