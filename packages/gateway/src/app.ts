import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type { GatewayContext } from "./context.js";
import { registerOpenAiRoutes } from "./adapters/openai/routes.js";
import { registerActionsRoutes } from "./adapters/actions/routes.js";
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
  registerActionsRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

  // Dashboard is built separately (packages/dashboard) and served statically
  // (D6: one process, one port). Only mounted if the built assets are
  // actually present, so a local `pnpm --filter @turnstile/gateway build`
  // without the dashboard step still boots cleanly.
  const dashboardDist = fileURLToPath(new URL("../../dashboard/dist", import.meta.url));
  if (existsSync(dashboardDist)) {
    void app.register(fastifyStatic, { root: dashboardDist, prefix: "/app/", decorateReply: false });
    app.get("/", async (_request, reply) => reply.redirect("/app/"));
    app.setNotFoundHandler(async (request, reply) => {
      if (request.raw.url?.startsWith("/app")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "no such route" } });
    });
  } else {
    ctx.logger.warn({ dashboardDist }, "dashboard build not found; /app will 404 (run `pnpm --filter @turnstile/dashboard build`)");
  }

  return app;
}
