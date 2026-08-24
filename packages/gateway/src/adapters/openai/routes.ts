import { createHash } from "node:crypto";
import {
  classifyAction,
  costForModel,
  estimateTokensFromChars,
  uuidv7,
  ApprovalQueueFullError,
  type ActionEvent,
  type OutcomeEvent,
} from "@turnstile/core";
import type { GatewayContext } from "../../context.js";
import type { App } from "../../app.js";
import { requireAgentAuth } from "../../auth/agentAuth.js";
import { resolveUpstream, resolveUpstreamName, UpstreamResolutionError } from "../../upstreamResolver.js";

interface ChatCompletionBody {
  model: string;
  messages: unknown[];
  max_tokens?: number;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  [key: string]: unknown;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function policyBlockBody(traceId: string, decision: { finalReason: string; matchedPolicies: Array<{ policyId: string }> }) {
  const policyId = decision.matchedPolicies.find((m) => m.policyId)?.policyId;
  return {
    error: {
      type: "turnstile_policy_block",
      code: "TURNSTILE_POLICY_BLOCK",
      reason: decision.finalReason,
      policyId,
      traceId,
    },
  };
}

export function registerOpenAiRoutes(app: App, ctx: GatewayContext): void {
  const authHook = requireAgentAuth(ctx);

  app.get("/v1/models", { preHandler: authHook }, async () => {
    const models = ctx.config.model_routes.map((r) => ({ id: r.match, object: "model", owned_by: r.upstream }));
    return { object: "list", data: models };
  });

  app.post<{ Body: ChatCompletionBody }>("/v1/chat/completions", { preHandler: authHook }, async (request, reply) => {
    const principal = request.principal!;
    const body = request.body;
    const bodyText = JSON.stringify(body);
    const traceId = (request.headers["x-turnstile-trace-id"] as string | undefined) ?? uuidv7();
    const sessionId = (request.headers["x-turnstile-session-id"] as string | undefined) ?? null;

    let upstreamName: string;
    try {
      upstreamName = resolveUpstreamName(ctx, body.model, request.headers["x-turnstile-upstream"] as string | undefined);
    } catch (err) {
      if (err instanceof UpstreamResolutionError) {
        return reply.code(400).send({ error: { type: "turnstile_config_error", code: "UNKNOWN_MODEL_ROUTE", reason: err.message } });
      }
      throw err;
    }

    const event: ActionEvent = {
      schemaVersion: "1.0",
      eventId: uuidv7(),
      traceId,
      sessionId,
      parentEventId: null,
      ts: new Date().toISOString(),
      principal,
      kind: "model.chat",
      actionClass: classifyAction({ kind: "model.chat" }),
      resource: { upstream: upstreamName, target: body.model },
      params: {
        raw: ctx.config.redaction.store_message_content ? body : { redacted: true, model: body.model },
        bodySha256: sha256Hex(bodyText),
        sizeBytes: Buffer.byteLength(bodyText, "utf8"),
      },
      context: {
        clientIp: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
        adapter: "openai",
      },
    };

    const { decision, evalResult, transformedParams } = await ctx.pipeline.runPolicyStage(event);
    const startedAt = performance.now();

    if (decision.outcome === "deny") {
      await ctx.pipeline.recordOutcome(
        event,
        {
          eventId: uuidv7(),
          actionEventId: event.eventId,
          ts: new Date().toISOString(),
          status: "denied",
          httpStatus: 403,
          latencyMs: performance.now() - startedAt,
          errorCode: "TURNSTILE_POLICY_BLOCK",
        },
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
          await ctx.pipeline.recordOutcome(
            event,
            {
              eventId: uuidv7(),
              actionEventId: event.eventId,
              ts: new Date().toISOString(),
              status: "denied",
              httpStatus: 503,
              latencyMs: performance.now() - startedAt,
              errorCode: "APPROVAL_QUEUE_FULL",
            },
            evalResult,
          );
          return reply.code(503).send({ error: { type: "turnstile_policy_block", code: "APPROVAL_QUEUE_FULL", reason: err.message, traceId } });
        }
        throw err;
      }

      // Parks the HTTP response until a human decides or the timeout
      // fires (§11). Agent-side: no auto-retry — the caller should surface
      // this to its own operator and treat connection loss as deny.
      const decided = await ctx.approvalManager.waitForDecision(approval.id);
      await ctx.pipeline.recordApprovalDecision(decided);

      if (decided.status === "denied") {
        await ctx.pipeline.recordOutcome(
          event,
          {
            eventId: uuidv7(),
            actionEventId: event.eventId,
            ts: new Date().toISOString(),
            status: "approval_denied",
            httpStatus: 403,
            latencyMs: performance.now() - startedAt,
            errorCode: "APPROVAL_DENIED",
          },
          evalResult,
        );
        return reply.code(403).send({
          error: { type: "turnstile_policy_block", code: "APPROVAL_DENIED", reason: decided.note ?? "denied by an operator", approvalId: decided.id, traceId },
        });
      }

      if (decided.status === "expired") {
        const onTimeout = evalResult.approvalHint?.onTimeout ?? "deny";
        if (onTimeout === "deny") {
          await ctx.pipeline.recordOutcome(
            event,
            {
              eventId: uuidv7(),
              actionEventId: event.eventId,
              ts: new Date().toISOString(),
              status: "approval_timeout",
              httpStatus: 403,
              latencyMs: performance.now() - startedAt,
              errorCode: "APPROVAL_TIMEOUT",
            },
            evalResult,
          );
          return reply.code(403).send({
            error: { type: "turnstile_policy_block", code: "APPROVAL_TIMEOUT", reason: "no decision before the approval deadline", approvalId: decided.id, traceId },
          });
        }
        // onTimeout === "allow": fall through to execute below.
      }
      // decided.status === "approved" (or expired+allow): fall through to execute.
    }

    let upstream;
    try {
      upstream = resolveUpstream(ctx, upstreamName);
    } catch (err) {
      if (err instanceof UpstreamResolutionError) {
        return reply.code(502).send({ error: { type: "turnstile_config_error", code: "UPSTREAM_UNREACHABLE", reason: err.message } });
      }
      throw err;
    }

    const effectiveBody = (transformedParams ?? body) as ChatCompletionBody;
    const upstreamUrl = `${upstream.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const isStreaming = effectiveBody.stream === true;
    const requestBody = isStreaming
      ? { ...effectiveBody, stream_options: { ...effectiveBody.stream_options, include_usage: true } }
      : effectiveBody;

    const upstreamStartedAt = performance.now();
    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(upstream.apiKey ? { authorization: `Bearer ${upstream.apiKey}` } : {}),
        },
        body: JSON.stringify(requestBody),
      });
    } catch (err) {
      await ctx.pipeline.recordOutcome(
        event,
        {
          eventId: uuidv7(),
          actionEventId: event.eventId,
          ts: new Date().toISOString(),
          status: "upstream_error",
          latencyMs: performance.now() - startedAt,
          errorCode: "UPSTREAM_UNREACHABLE",
        },
        evalResult,
      );
      return reply.code(502).send({ error: { type: "turnstile_upstream_error", code: "UPSTREAM_UNREACHABLE", reason: (err as Error).message } });
    }
    const upstreamLatencyMs = performance.now() - upstreamStartedAt;

    if (!isStreaming) {
      const responseText = await upstreamResponse.text();
      const latencyMs = performance.now() - startedAt;
      let usage: OutcomeEvent["usage"];
      try {
        const parsed = JSON.parse(responseText) as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
        if (parsed.usage) {
          const { costUsd } = costForModel(ctx.priceSheet, body.model, {
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
          });
          usage = {
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
            costUsd,
            priceSheetVersion: ctx.priceSheet.version,
          };
        }
      } catch {
        // non-JSON upstream response (e.g. an error body) — no usage to meter
      }

      await ctx.pipeline.recordOutcome(
        event,
        {
          eventId: uuidv7(),
          actionEventId: event.eventId,
          ts: new Date().toISOString(),
          status: upstreamResponse.ok ? "success" : "upstream_error",
          httpStatus: upstreamResponse.status,
          latencyMs,
          upstreamLatencyMs,
          usage,
          responseSha256: sha256Hex(responseText),
          responseSizeBytes: Buffer.byteLength(responseText, "utf8"),
        },
        evalResult,
      );

      reply.code(upstreamResponse.status);
      reply.header("content-type", upstreamResponse.headers.get("content-type") ?? "application/json");
      return reply.send(responseText);
    }

    // Streaming: full byte-for-byte SSE passthrough (D14); usage is parsed
    // from the final `data: {...}` chunk (we asked for stream_options.
    // include_usage above) with a char/4 estimate fallback.
    reply.hijack();
    reply.raw.writeHead(upstreamResponse.status, {
      "content-type": upstreamResponse.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    let capturedUsage: OutcomeEvent["usage"] | undefined;
    let sseBuffer = "";
    let fullText = "";

    if (upstreamResponse.body) {
      for await (const chunk of upstreamResponse.body as unknown as AsyncIterable<Uint8Array>) {
        reply.raw.write(chunk);
        const text = Buffer.from(chunk).toString("utf8");
        fullText += text;
        sseBuffer += text;
        let boundary: number;
        while ((boundary = sseBuffer.indexOf("\n\n")) !== -1) {
          const frame = sseBuffer.slice(0, boundary);
          sseBuffer = sseBuffer.slice(boundary + 2);
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine || dataLine.includes("[DONE]")) continue;
          try {
            const parsed = JSON.parse(dataLine.slice("data: ".length)) as {
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            if (parsed.usage) {
              const { costUsd } = costForModel(ctx.priceSheet, body.model, {
                inputTokens: parsed.usage.prompt_tokens ?? 0,
                outputTokens: parsed.usage.completion_tokens ?? 0,
              });
              capturedUsage = {
                inputTokens: parsed.usage.prompt_tokens ?? 0,
                outputTokens: parsed.usage.completion_tokens ?? 0,
                costUsd,
                priceSheetVersion: ctx.priceSheet.version,
              };
            }
          } catch {
            // not a JSON data frame we can parse for usage — fine, passthrough already happened
          }
        }
      }
    }
    reply.raw.end();

    if (!capturedUsage) {
      const estimatedOutputTokens = estimateTokensFromChars(fullText);
      const { costUsd } = costForModel(ctx.priceSheet, body.model, { inputTokens: 0, outputTokens: estimatedOutputTokens });
      capturedUsage = {
        inputTokens: 0,
        outputTokens: estimatedOutputTokens,
        costUsd,
        priceSheetVersion: ctx.priceSheet.version,
        estimated: true,
      };
    }

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
        usage: capturedUsage,
        responseSha256: sha256Hex(fullText),
        responseSizeBytes: Buffer.byteLength(fullText, "utf8"),
      },
      evalResult,
    );
  });
}
