export type ActionClass = "read" | "mutate" | "spend";
export type OutcomeStatus = "success" | "upstream_error" | "denied" | "timeout" | "approval_denied" | "approval_timeout";

export interface ResourceRef {
  upstream: string;
  target?: string;
  method?: string;
}

export interface GuardOptions {
  class?: ActionClass;
  resource: ResourceRef;
  traceId?: string;
  sessionId?: string;
}

export interface OutcomeReport {
  status: OutcomeStatus;
  httpStatus?: number;
  latencyMs?: number;
  usage?: { inputTokens: number; outputTokens: number; costUsd: number; estimated?: boolean };
  responseSha256?: string;
  responseSizeBytes?: number;
  errorCode?: string;
}

export interface DecisionInfo {
  outcome: "allow" | "deny" | "escalate" | "transform";
  finalReason: string;
  matchedPolicies: Array<{ policyId: string; pluginName: string; result: string; reason: string; latencyMs: number }>;
}

export interface DenialInfo {
  type: string;
  code: string;
  reason: string;
  policyId?: string;
  approvalId?: string;
  traceId: string;
}

export class TurnstileError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "TurnstileError";
  }
}

// A guard() call's result: either allowed (execute client-side, then call
// .report()) or denied (denial carries the reason — do not execute).
export class Guarded {
  constructor(
    private readonly client: Turnstile,
    public readonly allowed: boolean,
    public readonly decision: DecisionInfo | DenialInfo,
    private readonly eventId: string | null,
    private readonly traceId: string | null,
  ) {}

  async report(outcome: OutcomeReport): Promise<void> {
    if (!this.allowed || !this.eventId || !this.traceId) return; // nothing to report for a denial
    await this.client.reportOutcome(this.eventId, this.traceId, outcome);
  }
}

export interface TurnstileOptions {
  fetchImpl?: typeof fetch;
}

// Thin HTTP client over the generic Action API (§7.3/§7.4) — zero business
// logic, just request/response shaping. The gateway does all enforcement.
export class Turnstile {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly baseUrl: string,
    private readonly agentKey: string,
    options: TurnstileOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async guard(name: string, params: unknown, options: GuardOptions): Promise<Guarded> {
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/actions/execute`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.agentKey}`,
        "content-type": "application/json",
        ...(options.traceId ? { "x-turnstile-trace-id": options.traceId } : {}),
        ...(options.sessionId ? { "x-turnstile-session-id": options.sessionId } : {}),
      },
      body: JSON.stringify({
        name,
        class: options.class,
        resource: options.resource,
        params,
        execution: { mode: "evaluate_only" },
      }),
    });

    const body = (await response.json()) as { data?: { allowed: boolean; eventId: string; traceId: string; decision: DecisionInfo }; error?: DenialInfo };

    if (response.status === 403 || response.status === 503) {
      if (!body.error) throw new TurnstileError(`unexpected response shape for status ${response.status}`, response.status);
      return new Guarded(this, false, body.error, null, null);
    }
    if (!response.ok || !body.data) {
      throw new TurnstileError(`turnstile guard() failed: HTTP ${response.status}`, response.status);
    }
    return new Guarded(this, body.data.allowed, body.data.decision, body.data.eventId, body.data.traceId);
  }

  // Used internally by Guarded.report(); also exposed for callers that
  // stash eventId/traceId themselves (e.g. across a process boundary).
  async reportOutcome(eventId: string, traceId: string, outcome: OutcomeReport): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/actions/outcome`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.agentKey}`, "content-type": "application/json" },
      body: JSON.stringify({ eventId, traceId, ...outcome }),
    });
    if (!response.ok) {
      throw new TurnstileError(`turnstile reportOutcome() failed: HTTP ${response.status}`, response.status);
    }
  }

  // Wraps an async function: guards it, runs it if allowed, reports
  // success/failure automatically, and throws if denied.
  async wrap<T>(name: string, params: unknown, options: GuardOptions, fn: () => Promise<T>): Promise<T> {
    const guarded = await this.guard(name, params, options);
    if (!guarded.allowed) {
      const denial = guarded.decision as DenialInfo;
      throw new TurnstileError(`blocked by Turnstile policy: ${denial.reason}`, 403);
    }
    const startedAt = Date.now();
    try {
      const result = await fn();
      await guarded.report({ status: "success", latencyMs: Date.now() - startedAt });
      return result;
    } catch (err) {
      await guarded.report({ status: "upstream_error", latencyMs: Date.now() - startedAt, errorCode: (err as Error).message });
      throw err;
    }
  }
}
