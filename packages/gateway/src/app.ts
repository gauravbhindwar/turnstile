import Fastify from "fastify";
import type { Logger, TurnstileConfig } from "@turnstile/core";

export interface BuildAppOptions {
  config: TurnstileConfig;
  logger: Logger;
}

const BOOT_TIME = Date.now();

export function buildApp(options: BuildAppOptions) {
  const app = Fastify({ logger: options.logger });

  // Unauthenticated liveness route, deliberately separate from /admin/v1/health
  // (which requires the admin token) so container healthchecks stay simple. §21
  app.get("/healthz", async () => ({
    status: "ok",
    version: process.env.npm_package_version ?? "0.1.0",
    uptime_s: Math.floor((Date.now() - BOOT_TIME) / 1000),
  }));

  return app;
}
