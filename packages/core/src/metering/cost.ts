import type { ModelPrice, PriceSheet } from "./priceSheet.js";
import { matchModelPrice, matchToolPrice } from "./priceSheet.js";

export interface UsageInput {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

// costUsd = in/1e6*in_rate + cachedIn/1e6*cached_rate + out/1e6*out_rate,
// rounded HALF_UP to 6 decimal places (§10.1).
export function computeModelCost(price: ModelPrice, usage: UsageInput): number {
  const cachedTokens = usage.cachedInputTokens ?? 0;
  const billableInputTokens = usage.inputTokens - cachedTokens;
  const raw =
    (billableInputTokens / 1_000_000) * price.input_per_mtok_usd +
    (cachedTokens / 1_000_000) * (price.cached_input_per_mtok_usd ?? price.input_per_mtok_usd) +
    (usage.outputTokens / 1_000_000) * price.output_per_mtok_usd;
  return roundHalfUp6(raw);
}

export function roundHalfUp6(value: number): number {
  const factor = 1_000_000;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export interface CostResult {
  costUsd: number;
  flagUnpriced: boolean;
}

export function costForModel(sheet: PriceSheet, model: string, usage: UsageInput): CostResult {
  const price = matchModelPrice(sheet, model);
  if (!price) return { costUsd: 0, flagUnpriced: true };
  return { costUsd: computeModelCost(price, usage), flagUnpriced: price.flag_unpriced ?? false };
}

export function costForTool(sheet: PriceSheet, tool: string): CostResult {
  const price = matchToolPrice(sheet, tool);
  if (!price) return { costUsd: 0, flagUnpriced: false };
  return { costUsd: price.flat_usd, flagUnpriced: false };
}

// Cheap fallback estimator used before a real tokenizer count is available
// (e.g. pre-request budget reservation). §10.3 documents this as a coarse
// heuristic, not a precise count.
export function estimateTokensFromChars(text: string): number {
  return Math.ceil(text.length / 4);
}
