import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, TurnstileConfigSchema } from "@turnstile/core";
import { bootstrap } from "./bootstrap.js";
import { buildApp } from "./app.js";

const dataDirs: string[] = [];
afterEach(() => {
  for (const dir of dataDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort Windows cleanup
    }
  }
});

async function makeApp() {
  const dataDir = mkdtempSync(join(tmpdir(), "turnstile-actions-test-"));
  dataDirs.push(dataDir);
  const config = TurnstileConfigSchema.parse({ admin: { token: "test-token-1234567890" }, data_dir: dataDir });
  const ctx = await bootstrap(config, createLogger(config.logging));
  const app = buildApp(ctx);

  const adminHeaders = { authorization: "Bearer test-token-1234567890" };
  const createAgent = await app.inject({ method: "POST", url: "/admin/v1/agents", headers: adminHeaders, payload: { name: "actions-bot" } });
  const agentId = createAgent.json().data.id as string;
  const createKey = await app.inject({ method: "POST", url: `/admin/v1/agents/${agentId}/keys`, headers: adminHeaders });
  const agentKey = createKey.json().data.key as string;

  return {
    app,
    agentKey,
    close: async () => {
      ctx.approvalManager.stop();
      await app.close();
      await ctx.storage.close();
    },
  };
}

describe("POST /actions/execute (evaluate_only)", () => {
  it("allows an unmatched action by default and returns eventId + traceId for later outcome reporting", async () => {
    const { app, agentKey, close } = await makeApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/actions/execute",
        headers: { authorization: `Bearer ${agentKey}` },
        payload: { name: "send_email", resource: { upstream: "sendgrid" }, params: { to: "x@example.com" } },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.allowed).toBe(true);
      expect(body.data.eventId).toBeDefined();
      expect(body.data.traceId).toBeDefined();
    } finally {
      await close();
    }
  });

  it("requires auth", async () => {
    const { app, close } = await makeApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/actions/execute",
        payload: { name: "send_email", resource: { upstream: "sendgrid" }, params: {} },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await close();
    }
  });
});

describe("POST /actions/outcome", () => {
  it("records an outcome for a prior evaluate_only execute call", async () => {
    const { app, agentKey, close } = await makeApp();
    try {
      const execRes = await app.inject({
        method: "POST",
        url: "/actions/execute",
        headers: { authorization: `Bearer ${agentKey}` },
        payload: { name: "send_email", resource: { upstream: "sendgrid" }, params: {} },
      });
      const { eventId, traceId } = execRes.json().data;

      const outcomeRes = await app.inject({
        method: "POST",
        url: "/actions/outcome",
        headers: { authorization: `Bearer ${agentKey}` },
        payload: { eventId, traceId, status: "success", httpStatus: 200, latencyMs: 42 },
      });
      expect(outcomeRes.statusCode).toBe(200);
      expect(outcomeRes.json().data.recorded).toBe(true);

      const exchange = await app.inject({
        method: "GET",
        url: `/admin/v1/events/${traceId}`,
        headers: { authorization: "Bearer test-token-1234567890" },
      });
      const entries = exchange.json().data;
      expect(entries[0].outcome.status).toBe("success");
      expect(entries[0].outcome.latencyMs).toBe(42);
    } finally {
      await close();
    }
  });

  it("rejects reporting an outcome twice for the same action", async () => {
    const { app, agentKey, close } = await makeApp();
    try {
      const execRes = await app.inject({
        method: "POST",
        url: "/actions/execute",
        headers: { authorization: `Bearer ${agentKey}` },
        payload: { name: "send_email", resource: { upstream: "sendgrid" }, params: {} },
      });
      const { eventId, traceId } = execRes.json().data;
      const payload = { eventId, traceId, status: "success" };

      const first = await app.inject({ method: "POST", url: "/actions/outcome", headers: { authorization: `Bearer ${agentKey}` }, payload });
      expect(first.statusCode).toBe(200);
      const second = await app.inject({ method: "POST", url: "/actions/outcome", headers: { authorization: `Bearer ${agentKey}` }, payload });
      expect(second.statusCode).toBe(409);
    } finally {
      await close();
    }
  });

  it("404s for an unknown eventId/traceId pair", async () => {
    const { app, agentKey, close } = await makeApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/actions/outcome",
        headers: { authorization: `Bearer ${agentKey}` },
        payload: { eventId: "nope", traceId: "also-nope", status: "success" },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await close();
    }
  });
});

describe("POST /actions/execute (proxy_http)", () => {
  it("blocks a request targeting a private/loopback host (SSRF guard)", async () => {
    const { app, agentKey, close } = await makeApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/actions/execute",
        headers: { authorization: `Bearer ${agentKey}` },
        payload: {
          name: "fetch_internal",
          resource: { upstream: "internal" },
          params: {},
          execution: { mode: "proxy_http", http: { url: "http://169.254.169.254/latest/meta-data/", method: "GET" } },
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("SSRF_BLOCKED");
    } finally {
      await close();
    }
  });

  it("400s when execution.http.url is missing", async () => {
    const { app, agentKey, close } = await makeApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/actions/execute",
        headers: { authorization: `Bearer ${agentKey}` },
        payload: { name: "fetch_internal", resource: { upstream: "internal" }, params: {}, execution: { mode: "proxy_http" } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("MISSING_HTTP_TARGET");
    } finally {
      await close();
    }
  });
});
