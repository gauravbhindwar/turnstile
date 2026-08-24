import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { minimatch } from "minimatch";
import { z } from "zod";

const ModelPriceSchema = z.object({
  match: z.string(),
  input_per_mtok_usd: z.number().nonnegative(),
  output_per_mtok_usd: z.number().nonnegative(),
  cached_input_per_mtok_usd: z.number().nonnegative().optional(),
  flag_unpriced: z.boolean().optional(),
});

const ToolPriceSchema = z.object({
  match: z.string(),
  flat_usd: z.number().nonnegative(),
});

const PriceSheetFileSchema = z.object({
  version_note: z.string().optional(),
  models: z.array(ModelPriceSchema),
  tools: z.array(ToolPriceSchema).default([]),
});

export type ModelPrice = z.infer<typeof ModelPriceSchema>;
export type ToolPrice = z.infer<typeof ToolPriceSchema>;

export interface PriceSheet {
  version: string; // content hash, so historical costs stay reproducible
  models: ModelPrice[];
  tools: ToolPrice[];
}

// §10.1 bundled default: last entry MUST be a terminal "*" fallback so an
// unrecognized model never throws — it's flagged unpriced instead.
export const DEFAULT_PRICE_SHEET_YAML = `
version_note: "bundled default; override with prices_file"
models:
  - match: "gpt-4o*"
    input_per_mtok_usd: 2.50
    output_per_mtok_usd: 10.00
    cached_input_per_mtok_usd: 1.25
  - match: "claude-*sonnet*"
    input_per_mtok_usd: 3.00
    output_per_mtok_usd: 15.00
  - match: "claude-*haiku*"
    input_per_mtok_usd: 0.80
    output_per_mtok_usd: 4.00
  - match: "claude-*opus*"
    input_per_mtok_usd: 15.00
    output_per_mtok_usd: 75.00
  - match: "*"
    input_per_mtok_usd: 0
    output_per_mtok_usd: 0
    flag_unpriced: true
tools: []
`;

function loadFromYaml(yamlText: string): PriceSheet {
  const parsed = PriceSheetFileSchema.parse(parseYaml(yamlText));
  const version = createHash("sha256").update(yamlText, "utf8").digest("hex").slice(0, 16);
  return { version, models: parsed.models, tools: parsed.tools };
}

export function loadPriceSheet(pricesFile?: string): PriceSheet {
  if (pricesFile && existsSync(pricesFile)) {
    return loadFromYaml(readFileSync(pricesFile, "utf8"));
  }
  return loadFromYaml(DEFAULT_PRICE_SHEET_YAML);
}

// First glob match wins, top-down (§10.1). The bundled default's terminal
// "*" guarantees this never returns undefined for a well-formed sheet.
export function matchModelPrice(sheet: PriceSheet, model: string): ModelPrice | undefined {
  return sheet.models.find((m) => minimatch(model, m.match));
}

export function matchToolPrice(sheet: PriceSheet, tool: string): ToolPrice | undefined {
  return sheet.tools.find((t) => minimatch(tool, t.match));
}
