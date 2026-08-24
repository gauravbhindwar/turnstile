// Replaces ${VAR_NAME} tokens anywhere in a parsed YAML value tree with
// process.env values. A whole-string template ("${VAR}" and nothing else)
// resolves to `null` when the var is unset, so optional url/string fields
// fail validation loudly instead of silently becoming "". A template
// embedded in a larger string (e.g. "https://${HOST}/v1") falls back to ""
// for the missing portion, since there's no sensible non-string value there.
const WHOLE_STRING_VAR = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function interpolateEnv(value: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  if (typeof value === "string") {
    const wholeMatch = WHOLE_STRING_VAR.exec(value);
    if (wholeMatch) {
      const name = wholeMatch[1] as string;
      return env[name] ?? null;
    }
    return value.replace(VAR_PATTERN, (_match, name: string) => env[name] ?? "");
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateEnv(item, env));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = interpolateEnv(val, env);
    }
    return out;
  }
  return value;
}
