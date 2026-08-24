import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";
import { PolicyFileSchema, type PolicyFile } from "./schema.js";
import type { PolicyPlugin } from "./types.js";

export class PolicyLoadError extends Error {
  constructor(
    message: string,
    public readonly file: string,
  ) {
    super(message);
    this.name = "PolicyLoadError";
  }
}

export interface LoadPoliciesResult {
  policies: PolicyFile[];
  errors: PolicyLoadError[];
}

// Loads every *.yaml in policiesDir, validates the envelope with
// PolicyFileSchema, then validates `params` against the matching plugin's
// own paramsSchema. A single bad file is skipped with a loud error rather
// than aborting the whole load — callers keep the last-good policy set on
// error (§16: "never partially apply a broken reload").
export function loadPolicies(policiesDir: string, plugins: Map<string, PolicyPlugin>): LoadPoliciesResult {
  const policies: PolicyFile[] = [];
  const errors: PolicyLoadError[] = [];

  if (!existsSync(policiesDir)) {
    return { policies, errors };
  }

  const files = readdirSync(policiesDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const file of files) {
    const fullPath = join(policiesDir, file);
    try {
      const raw = parseYaml(readFileSync(fullPath, "utf8"));
      const parsed = PolicyFileSchema.parse(raw);

      const plugin = plugins.get(parsed.plugin);
      if (!plugin) {
        throw new Error(`unknown plugin "${parsed.plugin}"`);
      }
      plugin.paramsSchema.parse(parsed.params);

      policies.push(parsed);
    } catch (err) {
      const message = err instanceof ZodError ? err.issues.map((i) => i.message).join("; ") : (err as Error).message;
      errors.push(new PolicyLoadError(`${file}: ${message}`, fullPath));
    }
  }

  policies.sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : a.id.localeCompare(b.id)));
  return { policies, errors };
}
