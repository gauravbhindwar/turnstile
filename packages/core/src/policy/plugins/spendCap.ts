import { z } from "zod";
import type { PolicyContext, PluginResult, PolicyPlugin } from "../types.js";
import { computeWindowKey, scopeKey, type BudgetWindow } from "../../metering/budget.js";
import { costForModel, costForTool, estimateTokensFromChars } from "../../metering/cost.js";

export const SpendCapParamsSchema = z.object({
  limit_usd: z.number().positive(),
  window: z.enum(["daily", "weekly", "monthly", "rolling_24h"]),
  on_breach: z.enum(["deny", "escalate"]).default("deny"),
  warn_at_pct: z.number().min(0).max(100).default(80),
  scope: z.enum(["agent", "workspace"]).default("agent"),
});

export type SpendCapParams = z.infer<typeof SpendCapParamsSchema>;

interface PendingReservation {
  scopeKey: string;
  windowKey: string;
  estUsd: number;
}

function estimateEventCostUsd(ctx: PolicyContext): number {
  const { event, priceSheet } = ctx;
  if (event.kind === "model.chat" || event.kind === "model.embed") {
    const params = event.params.raw as { messages?: unknown; max_tokens?: number } | undefined;
    const promptTokens = estimateTokensFromChars(JSON.stringify(params?.messages ?? ""));
    const maxOutputTokens = params?.max_tokens ?? 1000;
    return costForModel(priceSheet, event.resource.target, {
      inputTokens: promptTokens,
      outputTokens: maxOutputTokens,
    }).costUsd;
  }
  return costForTool(priceSheet, event.resource.target).costUsd;
}

export const spendCapPlugin: PolicyPlugin = {
  name: "spend_cap",
  version: "1.0.0",
  paramsSchema: SpendCapParamsSchema,

  async evaluate(ctx: PolicyContext): Promise<PluginResult> {
    const params = ctx.policy.params as SpendCapParams;
    const est = estimateEventCostUsd(ctx);
    const key = scopeKey(
      ctx.event.principal.workspaceId,
      params.scope === "agent" ? ctx.event.principal.agentId : "*",
      ctx.policy.id,
    );
    const windowKey = computeWindowKey(params.window as BudgetWindow, ctx.now(), "UTC");

    const reserved = ctx.budgets.reserveIfUnder(key, windowKey, est, params.limit_usd);
    if (!reserved) {
      const usage = ctx.budgets.getUsage(key, windowKey);
      const reason = `spend cap of $${params.limit_usd.toFixed(2)} (${params.window}) would be exceeded: ` +
        `$${usage.settledUsd.toFixed(4)} settled + $${usage.reservedUsd.toFixed(4)} reserved + $${est.toFixed(4)} est`;
      return params.on_breach === "escalate"
        ? { result: "escalate", reason, approvalHint: { message: reason } }
        : { result: "deny", reason };
    }

    const pending: PendingReservation = { scopeKey: key, windowKey, estUsd: est };
    ctx.store.set(`pending:${ctx.event.eventId}`, JSON.stringify(pending), 10 * 60 * 1000);

    const usageAfterReserve = ctx.budgets.getUsage(key, windowKey);
    const pct = ((usageAfterReserve.settledUsd + usageAfterReserve.reservedUsd) / params.limit_usd) * 100;
    if (pct >= params.warn_at_pct) {
      ctx.logger.warn({ policyId: ctx.policy.id, pct: pct.toFixed(1) }, "spend_cap: approaching limit");
    }

    return { result: "pass" };
  },

  async onOutcome(ctx: PolicyContext, outcome): Promise<void> {
    const raw = ctx.store.get(`pending:${ctx.event.eventId}`);
    if (!raw) return; // no reservation was made (e.g. plugin denied/escalated earlier)
    const pending = JSON.parse(raw) as PendingReservation;
    const actual = outcome.usage?.costUsd ?? 0;
    ctx.budgets.settle(pending.scopeKey, pending.windowKey, pending.estUsd, actual);
    ctx.store.delete(`pending:${ctx.event.eventId}`);
  },
};
