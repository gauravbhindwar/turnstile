import { describe, it, expect } from "vitest";
import { computeModelCost, roundHalfUp6, costForModel } from "./cost.js";
import { loadPriceSheet } from "./priceSheet.js";

describe("computeModelCost", () => {
  const price = { match: "gpt-4o*", input_per_mtok_usd: 2.5, output_per_mtok_usd: 10 };

  it("computes cost from input/output tokens", () => {
    const cost = computeModelCost(price, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBe(12.5);
  });

  it("charges the cached rate for cached input tokens", () => {
    const priced = { ...price, cached_input_per_mtok_usd: 1.25 };
    const cost = computeModelCost(priced, { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 500_000 });
    // 500k billable @ 2.50/mtok (=1.25) + 500k cached @ 1.25/mtok (=0.625)
    expect(cost).toBe(1.875);
  });

  it("returns 0 for zero usage", () => {
    expect(computeModelCost(price, { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});

describe("roundHalfUp6", () => {
  it("rounds to 6 decimal places", () => {
    expect(roundHalfUp6(0.1234565)).toBeCloseTo(0.123457, 6);
    expect(roundHalfUp6(1 / 3)).toBeCloseTo(0.333333, 6);
  });
});

describe("costForModel with the bundled default sheet", () => {
  const sheet = loadPriceSheet();

  it("prices a known model via glob match", () => {
    const result = costForModel(sheet, "gpt-4o-mini", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(result.flagUnpriced).toBe(false);
    expect(result.costUsd).toBe(12.5);
  });

  it("falls back to the terminal wildcard and flags unpriced models", () => {
    const result = costForModel(sheet, "some-unknown-model-9000", { inputTokens: 1000, outputTokens: 1000 });
    expect(result.flagUnpriced).toBe(true);
    expect(result.costUsd).toBe(0);
  });
});
