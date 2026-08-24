import type { FastifyReply, FastifyRequest } from "fastify";
import { hashAgentKey } from "@turnstile/core";
import type { Principal } from "@turnstile/core";
import type { GatewayContext } from "../context.js";

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}

// Resolves `Authorization: Bearer trn_...` to a Principal (§7.1: agents
// never hold real vendor keys, only Turnstile-issued ones). Denies with the
// stable WARDEN_AUTH_INVALID_KEY-equivalent error taxonomy code.
export function requireAgentAuth(ctx: GatewayContext) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;
    const raw = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (!raw) {
      await reply.code(401).send({ error: { type: "turnstile_auth_error", code: "AUTH_MISSING_KEY", reason: "missing Authorization: Bearer <key>" } });
      return;
    }

    const keyHash = hashAgentKey(raw);
    const keyRow = ctx.storage.agentKeys.getByHash(keyHash);
    if (!keyRow || keyRow.revokedAt) {
      await reply.code(401).send({ error: { type: "turnstile_auth_error", code: "AUTH_INVALID_KEY", reason: "invalid or revoked agent key" } });
      return;
    }

    const agent = ctx.storage.agents.get(keyRow.agentId);
    if (!agent || agent.disabled) {
      await reply.code(401).send({ error: { type: "turnstile_auth_error", code: "AUTH_INVALID_KEY", reason: "agent disabled or not found" } });
      return;
    }

    ctx.storage.agentKeys.touchLastUsed(keyRow.id, new Date().toISOString());

    request.principal = {
      agentId: agent.id,
      agentName: agent.name,
      workspaceId: agent.workspaceId,
      delegation: [],
      keyId: keyRow.id,
    };
  };
}
