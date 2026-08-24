import type { FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { GatewayContext } from "../context.js";

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// §14: admin token != agent keys; agent keys get 403 on /admin/*.
export function requireAdminAuth(ctx: GatewayContext) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (!token || !constantTimeEquals(token, ctx.config.admin.token)) {
      await reply.code(401).send({ error: { code: "AUTH_INVALID_ADMIN_TOKEN", message: "invalid or missing admin token" } });
    }
  };
}
