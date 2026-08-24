import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";
import { TurnstileConfigSchema, type TurnstileConfig } from "./schema.js";
import { interpolateEnv } from "./interpolate.js";

export class ConfigError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "ConfigError";
  }
}

export function resolveConfigPath(explicitPath?: string): string {
  return explicitPath ?? process.env.TURNSTILE_CONFIG ?? "./turnstile.yaml";
}

export function loadConfig(explicitPath?: string): TurnstileConfig {
  const path = resolveConfigPath(explicitPath);
  if (!existsSync(path)) {
    throw new ConfigError(`Config file not found: ${path}`);
  }

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ConfigError(`Failed to parse YAML config at ${path}: ${(err as Error).message}`, err);
  }

  const interpolated = interpolateEnv(raw);

  try {
    return TurnstileConfigSchema.parse(interpolated);
  } catch (err) {
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      throw new ConfigError(`Invalid config at ${path}: ${details}`, err);
    }
    throw err;
  }
}

// §17.3: refuse to boot on a non-loopback host without TLS unless the operator
// has explicitly acknowledged the risk via i_understand_http.
export function assertBootSecurityGate(config: TurnstileConfig): void {
  const isLoopback = config.server.host === "127.0.0.1" || config.server.host === "localhost";
  const hasTls = false; // TLS config not yet modeled in M0; tighten when server.tls lands.
  if (!isLoopback && !hasTls && !config.i_understand_http) {
    throw new ConfigError(
      `Refusing to boot: server.host is "${config.server.host}" (non-loopback) without TLS. ` +
        `Set server.tls or acknowledge the risk with i_understand_http: true.`,
    );
  }
}
