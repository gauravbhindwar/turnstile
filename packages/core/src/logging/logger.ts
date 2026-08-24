import pino from "pino";

export type Logger = pino.Logger;

export interface LoggingOptions {
  level: string;
  format: "json" | "pretty";
}

// Redacts common secret-shaped fields so a leaked credential never reaches
// stdout/log storage. Matched against pino's redact path syntax.
const REDACT_PATHS = [
  "*.authorization",
  "*.Authorization",
  "*.apiKey",
  "*.api_key",
  "*.credential",
  "*.credentials",
  "*.token",
  "*.password",
  "*.secret",
  "*.master_key",
  "*.TURNSTILE_ADMIN_TOKEN",
];

export function createLogger(options: LoggingOptions): Logger {
  return pino({
    level: options.level,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    transport:
      options.format === "pretty"
        ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
        : undefined,
  });
}
