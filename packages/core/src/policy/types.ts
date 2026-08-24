import type { ZodSchema } from "zod";
import type { ActionEvent, DecisionOutcome, OutcomeEvent } from "../types/action.js";
import type { Logger } from "../logging/logger.js";
import type { PriceSheet } from "../metering/priceSheet.js";

export interface PluginKV {
  get(key: string): string | null;
  set(key: string, value: string, ttlMs?: number): void;
  incr(key: string, by: number, ttlMs?: number): number;
  delete(key: string): void;
}

export interface ApprovalHint {
  message?: string;
  timeoutS?: number;
  // require_approval's on_timeout setting: what the final outcome should be
  // if nobody decides before the deadline. Defaults to "deny" if absent —
  // the fail-closed choice (D10).
  onTimeout?: "deny" | "allow";
}

export interface BudgetsCapability {
  reserveIfUnder(scopeKey: string, windowKey: string, estUsd: number, limitUsd: number): boolean;
  settle(scopeKey: string, windowKey: string, estUsd: number, actualUsd: number): void;
  getUsage(scopeKey: string, windowKey: string): { reservedUsd: number; settledUsd: number };
}

export interface PolicyContext {
  event: ActionEvent;
  policy: { id: string; params: unknown };
  store: PluginKV;
  now: () => Date;
  logger: Logger;
  // Elevated capabilities available to built-in plugins only (spend_cap uses
  // these for atomic reserve-then-settle, §10.3). Third-party/local plugins
  // should stick to `store` per §8.3's "all state via store" constraint —
  // these two are not part of that contract.
  budgets: BudgetsCapability;
  priceSheet: PriceSheet;
}

export type PluginResult =
  | { result: "pass" }
  | { result: "deny"; reason: string }
  | { result: "escalate"; reason: string; approvalHint?: ApprovalHint }
  | { result: "transform"; reason: string; patch: (params: unknown) => unknown };

export interface PolicyPlugin {
  name: string;
  version: string;
  paramsSchema: ZodSchema;
  evaluate(ctx: PolicyContext): Promise<PluginResult>;
  onOutcome?: (ctx: PolicyContext, outcome: OutcomeEvent) => Promise<void>;
}

export interface MatchedPolicyTrace {
  policyId: string;
  pluginName: string;
  result: DecisionOutcome | "pass";
  reason: string;
  latencyMs: number;
}
