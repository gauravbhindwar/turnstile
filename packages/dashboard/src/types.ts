// Minimal local mirrors of @turnstile/core's ActionEvent/Decision/OutcomeEvent
// shapes — kept local (not a workspace dependency) so the dashboard bundle
// doesn't pull in Node-only code paths from core.
export interface ActionEvent {
  eventId: string;
  traceId: string;
  ts: string;
  principal: { agentId: string; agentName: string; workspaceId: string };
  kind: string;
  actionClass: "read" | "mutate" | "spend";
  resource: { upstream: string; target: string; method?: string };
}

export interface MatchedPolicyTrace {
  policyId: string;
  pluginName: string;
  result: string;
  reason: string;
  latencyMs: number;
}

export interface Decision {
  eventId: string;
  actionEventId: string;
  ts: string;
  outcome: "allow" | "deny" | "escalate" | "transform";
  matchedPolicies: MatchedPolicyTrace[];
  finalReason: string;
}

export interface OutcomeEvent {
  eventId: string;
  actionEventId: string;
  ts: string;
  status: string;
  httpStatus?: number;
  latencyMs: number;
  usage?: { inputTokens: number; outputTokens: number; costUsd: number; estimated?: boolean };
}

export interface TimelineEntry {
  action: ActionEvent;
  decision: Decision | null;
  outcome: OutcomeEvent | null;
}

export interface Agent {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  disabled: boolean;
}
