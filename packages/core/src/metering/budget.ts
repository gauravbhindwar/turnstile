import type { Storage } from "../storage/types.js";

export type BudgetWindow = "daily" | "weekly" | "monthly" | "rolling_24h";

// Computes the window_key a policy's counters live under, in the policy's
// configured tz (§10.2). rolling_24h buckets by the current hour so a
// sliding window doesn't need per-request cleanup.
export function computeWindowKey(window: BudgetWindow, now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");

  switch (window) {
    case "daily":
      return `${year}-${month}-${day}`;
    case "rolling_24h":
      return `${year}-${month}-${day}T${hour}`;
    case "weekly": {
      const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      const dayOfWeek = (d.getUTCDay() + 6) % 7; // Monday = 0
      d.setUTCDate(d.getUTCDate() - dayOfWeek);
      return `${d.getUTCFullYear()}-W${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
    case "monthly":
      return `${year}-${month}`;
  }
}

export function scopeKey(workspaceId: string, agentId: string | "*", policyId: string): string {
  return `${workspaceId}:${agentId}:${policyId}`;
}

export interface ReserveResult {
  reserved: boolean;
  scopeKey: string;
  windowKey: string;
}

export async function reserveBudget(
  storage: Storage,
  workspaceId: string,
  agentId: string,
  policyId: string,
  scope: "agent" | "workspace",
  window: BudgetWindow,
  tz: string,
  estUsd: number,
  limitUsd: number,
  now = new Date(),
): Promise<ReserveResult> {
  const key = scopeKey(workspaceId, scope === "agent" ? agentId : "*", policyId);
  const windowKey = computeWindowKey(window, now, tz);
  const reserved = storage.budgets.reserveIfUnder(key, windowKey, estUsd, limitUsd);
  return { reserved, scopeKey: key, windowKey };
}

export function settleBudget(
  storage: Storage,
  scopeKeyValue: string,
  windowKeyValue: string,
  estUsd: number,
  actualUsd: number,
): void {
  storage.budgets.settle(scopeKeyValue, windowKeyValue, estUsd, actualUsd);
}
