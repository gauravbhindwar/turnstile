export const SCHEMA_VERSION = "1.0" as const;

export type ActionKind =
  | "model.chat"
  | "model.embed"
  | "mcp.tool_call"
  | "mcp.resource_read"
  | "http.request"
  | "custom.action";

export type ActionClass = "read" | "mutate" | "spend";

export interface DelegationLink {
  type: "human" | "agent" | "service";
  id: string;
  note?: string;
}

export interface Principal {
  agentId: string;
  agentName: string;
  workspaceId: string;
  delegation: DelegationLink[];
  keyId: string;
}

export interface ActionEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  eventId: string;
  traceId: string;
  sessionId: string | null;
  parentEventId: string | null;
  ts: string;
  principal: Principal;
  kind: ActionKind;
  actionClass: ActionClass;
  resource: {
    upstream: string;
    target: string;
    method?: string;
  };
  params: {
    raw: unknown;
    bodySha256: string;
    sizeBytes: number;
  };
  context: {
    clientIp: string;
    userAgent: string | null;
    adapter: "openai" | "mcp" | "actions" | "forward";
  };
}

export type DecisionOutcome = "allow" | "deny" | "escalate" | "transform";

export interface MatchedPolicy {
  policyId: string;
  pluginName: string;
  result: DecisionOutcome | "pass";
  reason: string;
  latencyMs: number;
}

export interface Decision {
  eventId: string;
  actionEventId: string;
  ts: string;
  outcome: DecisionOutcome;
  matchedPolicies: MatchedPolicy[];
  finalReason: string;
  transform?: { description: string; paramsPatchSha256: string };
  approval?: { approvalId: string };
}

export type OutcomeStatus =
  | "success"
  | "upstream_error"
  | "denied"
  | "timeout"
  | "approval_denied"
  | "approval_timeout";

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  costUsd: number;
  priceSheetVersion: string;
  estimated?: boolean;
}

export interface OutcomeEvent {
  eventId: string;
  actionEventId: string;
  ts: string;
  status: OutcomeStatus;
  httpStatus?: number;
  latencyMs: number;
  upstreamLatencyMs?: number;
  usage?: UsageSummary;
  responseSha256?: string;
  responseSizeBytes?: number;
  errorCode?: string;
}
