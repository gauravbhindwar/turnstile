import { createHash } from "node:crypto";
import { classifyAction, costForTool, uuidv7, ApprovalQueueFullError, type ActionEvent, type OutcomeStatus, type ActionClass } from "@turnstile/core";
import type { GatewayContext } from "../../context.js";
import type { App } from "../../app.js";
import { requireAgentAuth } from "../../auth/agentAuth.js";
import { assertPublicHttpTarget, SsrfBlockedError } from "../../ssrfGuard.js";

interface ActionExecuteBody {
  name: string;
  class?: ActionClass;
  resource: { upstream: string; target?: string; method?: string };
  params?: unknown;
  execution?: {
    mode?: "evaluate_only" | "proxy_http";
    http?: { url: string; method?: string; headers?: Record<string, string>; body?: unknown };
  };
}

interface ActionOutcomeBody {
  eventId: string;
  traceId: string;
  status: OutcomeStatus;
  httpStatus?: number;
  latencyMs?: number;
  usage?: { inputTokens: number; outputTokens: number; costUsd: number; estimated?: boolean };
  responseSha256?: string;
  responseSizeBytes?: number;
  errorCode?: string;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function policyBlockBody(traceId: string, decision: { finalReason: string; matchedPolicies: Array<{ policyId: string }> }, code = "TURNSTILE_POLICY_BLOCK") {
  const policyId = decision.matchedPolicies.find((m) => m.policyId)?.policyId;
  return { error: { type: "turnstile_policy_block", code, reason: decision.finalReason, policyId, traceId } };
}

// §7.3: the generic SDK-facing Action API. evaluate_only lets the caller
// execute client-side then MUST report back via POST /actions/outcome;
// proxy_http has Warden perform the HTTP call itself on ALLOW.
export function registerActionsRoutes(app: App, ctx: GatewayContext): void {
  const authHook = requireAgentAuth(ctx);

  app.post<{ Body: ActionExecuteBody }>("/actions/execute", { preHandler: authHook }, async (request, reply) => {
    const principal = request.principal!;
    const body = request.body;
    const paramsText = JSON.stringify(body.params ?? {});
    const traceId = (request.headers["x-turnstile-trace-id"] as string | undefined) ?? uuidv7();
    const sessionId = (request.headers["x-turnstile-session-id"] as string | undefined) ?? null;
    const target = body.resource.target ?? body.name;
    const mode = body.execution?.mode ?? "evaluate_only";

    const event: ActionEvent = {
      schemaVersion: "1.0",
      eventId: uuidv7(),
      traceId,
      sessionId,
      parentEventId: null,
      ts: new Date().toISOString(),
      principal,
      kind: "custom.action",
      actionClass: classifyAction({ kind: "custom.action", declaredClass: body.class }),
      resource: { upstream: body.resource.upstream, target, method: body.resource.method },
      params: { raw: body.params, bodySha256: sha256Hex(paramsText), sizeBytes: Buffer.byteLength(paramsText, "utf8") },
      context: { clientIp: request.ip, userAgent: request.headers["user-agent"] ?? null, adapter: "actions" },
    };

    const { decision, evalResult } = await ctx.pipeline.runPolicyStage(event);
    const startedAt = performance.now();

    if (decision.outcome === "deny") {
      await ctx.pipeline.recordOutcome(
        event,
        { eventId: uuidv7(), actionEventId: event.eventId, ts: new Date().toISOString(), status: "denied", httpStatus: 403, latencyMs: performance.now() - startedAt, errorCode: "TURNSTILE_POLICY_BLOCK" },
        evalResult,
      );
      return reply.code(403).send(policyBlockBody(traceId, decision));
    }

    if (decision.outcome === "escalate") {
      let approval;
      try {
        approval = await ctx.approvalManager.escalate(event, decision.finalReason, evalResult.approvalHint?.timeoutS);
      } catch (err) {
        if (err instanceof ApprovalQueueFullError) {
          return reply.code(503).send({ error: { type: "turnstile_policy_block", code: "APPROVAL_QUEUE_FULL", reason: err.message, traceId } });
        }
        throw err;
      }
      const decided = await ctx.approvalManager.waitForDecision(approval.id);
      await ctx.pipeline.recordApprovalDecision(decided);

      if (decided.status === "denied") {
        await ctx.pipeline.recordOutcome(
          event,
          { eventId: uuidv7(), actionEventId: event.eventId, ts: new Date().toISOString(), status: "approval_denied", httpStatus: 403, latencyMs: performance.now() - startedAt, errorCode: "APPROVAL_DENIED" },
          evalResult,
        );
        return reply.code(403).send({ error: { type: "turnstile_policy_block", code: "APPROVAL_DENIED", reason: decided.note ?? "denied by an operator", approvalId: decided.id, traceId } });
      }
      if (decided.status === "expired") {
        const onTimeout = evalResult.approvalHint?.onTimeout ?? "deny";
        if (onTimeout === "deny") {
          await ctx.pipeline.recordOutcome(
            event,
            { eventId: uuidv7(), actionEventId: event.eventId, ts: new Date().toISOString(), status: "approval_timeout", httpStatus: 403, latencyMs: performance.now() - startedAt, errorCode: "APPROVAL_TIMEOUT" },
            evalResult,
          );
          return reply.code(403).send({ error: { type: "turnstile_policy_block", code: "APPROVAL_TIMEOUT", reason: "no decision before the approval deadline", approvalId: decided.id, traceId } });
        }
      }
    }

    if (mode === "evaluate_only") {
      // No outcome recorded here — the caller executes client-side and
      // MUST call POST /actions/outcome, echoing eventId + traceId back.
      return reply.code(200).send({ data: { allowed: true, eventId: event.eventId, traceId, decision } });
    }

    // proxy_http: Warden performs the call itself.
    const http = body.execution?.http;
    if (!http?.url) {
      return reply.code(400).send({ error: { type: "turnstile_config_error", code: "MISSING_HTTP_TARGET", reason: "execution.http.url is required for proxy_http mode" } });
    }
    try {
      assertPublicHttpTarget(http.url);
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        await ctx.pipeline.recordOutcome(
          event,
          { eventId: uuidv7(), actionEventId: event.eventId, ts: new Date().toISOString(), status: "denied", httpStatus: 400, latencyMs: performance.now() - startedAt, errorCode: "SSRF_BLOCKED" },
          evalResult,
        );
        return reply.code(400).send({ error: { type: "turnstile_config_error", code: "SSRF_BLOCKED", reason: err.message } });
      }
      throw err;
    }

    const upstreamStartedAt = performance.now();
    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(http.url, {
        method: http.method ?? "POST",
        headers: { "content-type": "application/json", ...http.headers },
        body: http.body !== undefined ? JSON.stringify(http.body) : undefined,
      });
    } catch (err) {
      await ctx.pipeline.recordOutcome(
        event,
        { eventId: uuidv7(), actionEventId: event.eventId, ts: new Date().toISOString(), status: "upstream_error", latencyMs: performance.now() - startedAt, errorCode: "UPSTREAM_UNREACHABLE" },
        evalResult,
      );
      return reply.code(502).send({ error: { type: "turnstile_upstream_error", code: "UPSTREAM_UNREACHABLE", reason: (err as Error).message } });
    }
    const upstreamLatencyMs = performance.now() - upstreamStartedAt;
    const responseText = await upstreamResponse.text();

    const { costUsd } = costForTool(ctx.priceSheet, target);
    await ctx.pipeline.recordOutcome(
      event,
      {
        eventId: uuidv7(),
        actionEventId: event.eventId,
        ts: new Date().toISOString(),
        status: upstreamResponse.ok ? "success" : "upstream_error",
        httpStatus: upstreamResponse.status,
        latencyMs: performance.now() - startedAt,
        upstreamLatencyMs,
        usage: costUsd > 0 ? { inputTokens: 0, outputTokens: 0, costUsd, priceSheetVersion: ctx.priceSheet.version } : undefined,
        responseSha256: sha256Hex(responseText),
        responseSizeBytes: Buffer.byteLength(responseText, "utf8"),
      },
      evalResult,
    );

    reply.code(upstreamResponse.status);
    reply.header("content-type", upstreamResponse.headers.get("content-type") ?? "application/json");
    return reply.send(responseText);
  });

  app.post<{ Body: ActionOutcomeBody }>("/actions/outcome", { preHandler: authHook }, async (request, reply) => {
    const body = request.body;
    const exchange = ctx.storage.events.getExchange(body.traceId);
    const entry = exchange.find((e) => e.action.eventId === body.eventId);
    if (!entry || !entry.decision) {
      return reply.code(404).send({ error: { code: "ACTION_NOT_FOUND", message: `no action "${body.eventId}" in trace "${body.traceId}"` } });
    }
    if (entry.outcome) {
      return reply.code(409).send({ error: { code: "OUTCOME_ALREADY_RECORDED", message: "an outcome was already recorded for this action" } });
    }

    // Reconstructs just enough of an EvaluateResult (only matchedPolicies is
    // used by recordOutcome's onOutcome metering hooks) from the Decision
    // already persisted at execute time — no need to re-run policy eval.
    await ctx.pipeline.recordOutcome(entry.action, {
      eventId: uuidv7(),
      actionEventId: body.eventId,
      ts: new Date().toISOString(),
      status: body.status,
      httpStatus: body.httpStatus,
      latencyMs: body.latencyMs ?? 0,
      usage: body.usage ? { ...body.usage, priceSheetVersion: ctx.priceSheet.version } : undefined,
      responseSha256: body.responseSha256,
      responseSizeBytes: body.responseSizeBytes,
      errorCode: body.errorCode,
    }, {
      outcome: entry.decision.outcome,
      finalReason: entry.decision.finalReason,
      matchedPolicies: entry.decision.matchedPolicies,
      transformedParams: undefined,
    });

    return reply.code(200).send({ data: { recorded: true } });
  });
}
