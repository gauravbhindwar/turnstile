import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, TurnstileConfigSchema } from "@turnstile/core";
import { bootstrap } from "./bootstrap.js";
import { buildApp } from "./app.js";

const dataDirs: string[] = [];
afterAll(() => {
  for (const dir of dataDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can still hold a brief lock on the WAL file right after
      // close(); best-effort cleanup, not worth failing the suite over.
    }
  }
});

async function makeApp() {
  const dataDir = mkdtempSync(join(tmpdir(), "turnstile-gateway-test-"));
  dataDirs.push(dataDir);
  const config = TurnstileConfigSchema.parse({ admin: { token: "test-token-1234567890" }, data_dir: dataDir });
  const ctx = await bootstrap(config, createLogger(config.logging));
  const app = buildApp(ctx);
  return {
    app,
    close: async () => {
      ctx.approvalManager.stop();
      await app.close();
      await ctx.storage.close();
    },
  };
}

describe("GET /healthz", () => {
  it("returns 200 with status ok", async () => {
    const { app, close } = await makeApp();
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
    await close();
  });
});

describe("admin auth", () => {
  it("rejects /admin/v1/agents without a token", async () => {
    const { app, close } = await makeApp();
    const response = await app.inject({ method: "GET", url: "/admin/v1/agents" });
    expect(response.statusCode).toBe(401);
    await close();
  });

  it("allows /admin/v1/agents with the correct admin token", async () => {
    const { app, close } = await makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/agents",
      headers: { authorization: "Bearer test-token-1234567890" },
    });
    expect(response.statusCode).toBe(200);
    await close();
  });

  it("/admin/v1/health needs no token", async () => {
    const { app, close } = await makeApp();
    const response = await app.inject({ method: "GET", url: "/admin/v1/health" });
    expect(response.statusCode).toBe(200);
    await close();
  });
});

describe("agent key lifecycle + chat completions auth", () => {
  it("creates an agent, issues a key, and the key authenticates /v1/chat/completions", async () => {
    const { app, close } = await makeApp();
    const adminHeaders = { authorization: "Bearer test-token-1234567890" };

    const createAgent = await app.inject({
      method: "POST",
      url: "/admin/v1/agents",
      headers: adminHeaders,
      payload: { name: "test-bot" },
    });
    expect(createAgent.statusCode).toBe(201);
    const agentId = createAgent.json().data.id as string;

    const createKey = await app.inject({
      method: "POST",
      url: `/admin/v1/agents/${agentId}/keys`,
      headers: adminHeaders,
    });
    expect(createKey.statusCode).toBe(201);
    const rawKey = createKey.json().data.key as string;
    expect(rawKey).toMatch(/^trn_/);

    // No model_routes configured in this minimal test config, so the
    // request reaches auth successfully but then 400s on unknown model
    // route — proving the key authenticated rather than a fixed 401.
    const chat = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: `Bearer ${rawKey}` },
      payload: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
    });
    expect(chat.statusCode).toBe(400);
    expect(chat.json().error.code).toBe("UNKNOWN_MODEL_ROUTE");

    const noAuth = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "gpt-4o-mini", messages: [] },
    });
    expect(noAuth.statusCode).toBe(401);

    await close();
  });
});
