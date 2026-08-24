import Fastify from "fastify";
import type { GatewayContext } from "./context.js";
import { registerOpenAiRoutes } from "./adapters/openai/routes.js";
import { registerAdminRoutes } from "./admin/routes.js";

const BOOT_TIME = Date.now();

export type App = ReturnType<typeof buildApp>;

export function buildApp(ctx: GatewayContext) {
  const app = Fastify({ logger: ctx.logger, bodyLimit: 2 * 1024 * 1024 });

  // Unauthenticated liveness route, deliberately separate from
  // /admin/v1/health (which requires the admin token). §21
  app.get("/healthz", async () => ({
    status: "ok",
    version: process.env.npm_package_version ?? "0.1.0",
    uptime_s: Math.floor((Date.now() - BOOT_TIME) / 1000),
  }));

  registerOpenAiRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

  return app;
}
