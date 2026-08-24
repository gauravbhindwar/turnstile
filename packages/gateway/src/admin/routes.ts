import {
  encryptCredential,
  generateAgentKey,
  uuidv7,
  verifyLedger,
  type BusEvent,
} from "@turnstile/core";
import type { GatewayContext } from "../context.js";
import type { App } from "../app.js";
import { requireAdminAuth } from "../auth/adminAuth.js";

const START_TIME = Date.now();

export function registerAdminRoutes(app: App, ctx: GatewayContext): void {
  const adminAuth = requireAdminAuth(ctx);

  app.get("/admin/v1/health", async () => ({
    data: { status: "ok", version: "0.1.0", storage: "sqlite", uptime_s: Math.floor((Date.now() - START_TIME) / 1000) },
  }));

  app.get("/admin/v1/stats/overview", { preHandler: adminAuth }, async (request) => {
    const query = request.query as { window?: string };
    const page = ctx.storage.events.queryTimeline({}, { limit: 500 });
    const requests = page.items.length;
    const denials = page.items.filter((i) => i.decision?.outcome === "deny").length;
    const escalations = page.items.filter((i) => i.decision?.outcome === "escalate").length;
    const spendUsd = page.items.reduce((sum, i) => sum + (i.outcome?.usage?.costUsd ?? 0), 0);
    return {
      data: { window: query.window ?? "recent", requests, denials, escalations, spendUsd },
    };
  });

  app.get("/admin/v1/events", { preHandler: adminAuth }, async (request) => {
    const query = request.query as { agent?: string; kind?: string; outcome?: string; from?: string; to?: string; cursor?: string; limit?: string };
    const page = ctx.storage.events.queryTimeline(
      { agentId: query.agent, kind: query.kind, outcome: query.outcome, from: query.from, to: query.to },
      { cursor: query.cursor, limit: query.limit ? Number(query.limit) : 50 },
    );
    return { data: page.items, nextCursor: page.nextCursor };
  });

  app.get("/admin/v1/events/:traceId", { preHandler: adminAuth }, async (request) => {
    const { traceId } = request.params as { traceId: string };
    return { data: ctx.storage.events.getExchange(traceId) };
  });

  app.get("/admin/v1/events/stream", { preHandler: adminAuth }, async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    reply.raw.write(": connected\n\n");

    const unsubscribe = ctx.eventBus.subscribe((event: BusEvent) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    });

    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.get("/admin/v1/agents", { preHandler: adminAuth }, async (request) => {
    const query = request.query as { workspace?: string };
    return { data: ctx.storage.agents.list(query.workspace) };
  });

  app.post("/admin/v1/agents", { preHandler: adminAuth }, async (request, reply) => {
    const body = request.body as { workspaceName?: string; name: string };
    const workspaceName = body.workspaceName ?? "default";
    let workspace = ctx.storage.workspaces.getByName(workspaceName);
    if (!workspace) {
      workspace = { id: uuidv7(), name: workspaceName, createdAt: new Date().toISOString() };
      ctx.storage.workspaces.create(workspace);
    }
    if (ctx.storage.agents.getByName(workspace.id, body.name)) {
      return reply.code(409).send({ error: { code: "AGENT_EXISTS", message: `agent "${body.name}" already exists in workspace "${workspaceName}"` } });
    }
    const agent = { id: uuidv7(), workspaceId: workspace.id, name: body.name, createdAt: new Date().toISOString(), disabled: false };
    ctx.storage.agents.create(agent);
    return reply.code(201).send({ data: agent });
  });

  app.post("/admin/v1/agents/:id/keys", { preHandler: adminAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = ctx.storage.agents.get(id);
    if (!agent) {
      return reply.code(404).send({ error: { code: "AGENT_NOT_FOUND", message: `no agent with id "${id}"` } });
    }
    const generated = generateAgentKey();
    ctx.storage.agentKeys.create({
      id: uuidv7(),
      agentId: agent.id,
      keyHash: generated.hash,
      prefix: generated.prefix,
      createdAt: new Date().toISOString(),
      revokedAt: null,
      lastUsedAt: null,
    });
    // The raw key is returned exactly once — it is never stored or logged (§17.3).
    return reply.code(201).send({ data: { key: generated.raw, prefix: generated.prefix } });
  });

  app.delete("/admin/v1/keys/:id", { preHandler: adminAuth }, async (request) => {
    const { id } = request.params as { id: string };
    ctx.storage.agentKeys.revoke(id);
    return { data: { revoked: true } };
  });

  app.get("/admin/v1/upstreams", { preHandler: adminAuth }, async () => ({ data: ctx.storage.upstreams.list() }));

  app.put("/admin/v1/upstreams/:name", { preHandler: adminAuth }, async (request) => {
    const { name } = request.params as { name: string };
    const body = request.body as { kind: string; base_url: string };
    ctx.storage.upstreams.upsert({ name, kind: body.kind, baseUrl: body.base_url, credentialId: null });
    return { data: ctx.storage.upstreams.get(name) };
  });

  app.put("/admin/v1/upstreams/:name/credential", { preHandler: adminAuth }, async (request, reply) => {
    const { name } = request.params as { name: string };
    const upstream = ctx.storage.upstreams.get(name);
    if (!upstream) {
      return reply.code(404).send({ error: { code: "UPSTREAM_NOT_FOUND", message: `no upstream "${name}"` } });
    }
    const body = request.body as { apiKey: string };
    const credentialId = uuidv7();
    ctx.storage.credentials.create({
      id: credentialId,
      label: `${name}-key`,
      ciphertext: encryptCredential(ctx.credentialMasterKey, body.apiKey),
      createdAt: new Date().toISOString(),
    });
    ctx.storage.upstreams.upsert({ ...upstream, credentialId });
    // write-only: never echo the secret back.
    return { data: { name, credentialSet: true } };
  });

  app.get("/admin/v1/ledger/head", { preHandler: adminAuth }, async () => ({ data: await ctx.storage.ledger.latest() }));

  app.post("/admin/v1/ledger/verify", { preHandler: adminAuth }, async (request) => {
    const body = (request.body as { from?: number; to?: number } | undefined) ?? {};
    const result = await verifyLedger(ctx.storage, { from: body.from, to: body.to });
    return { data: result };
  });

  app.get("/admin/v1/budgets", { preHandler: adminAuth }, async (request) => {
    const query = request.query as { scopeKey?: string; windowKey?: string };
    if (!query.scopeKey || !query.windowKey) {
      return { data: null };
    }
    return { data: ctx.storage.budgets.getUsage(query.scopeKey, query.windowKey) };
  });

  app.get("/admin/v1/prices", { preHandler: adminAuth }, async () => ({ data: ctx.priceSheet }));

  app.get("/admin/v1/policies", { preHandler: adminAuth }, async () => ({
    data: ctx.policies.map((p) => ({ id: p.id, description: p.description, enabled: p.enabled, priority: p.priority, match: p.match, plugin: p.plugin })),
  }));
}
