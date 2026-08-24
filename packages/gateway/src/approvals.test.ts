import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, TurnstileConfigSchema } from "@turnstile/core";
import { bootstrap } from "./bootstrap.js";
import { buildApp } from "./app.js";

const dataDirs: string[] = [];
let fakeUpstream: Server | null = null;

afterEach(() => {
  fakeUpstream?.close();
  fakeUpstream = null;
  for (const dir of dataDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort Windows cleanup
    }
  }
});

async function startFakeUpstream(): Promise<number> {
  return new Promise((resolve) => {
    fakeUpstream = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }));
      });
    });
    fakeUpstream.listen(0, "127.0.0.1", () => {
      const address = fakeUpstream!.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

async function makeApp(policyYaml: string) {
  const dataDir = mkdtempSync(join(tmpdir(), "turnstile-approvals-test-"));
  dataDirs.push(dataDir);
  const policiesDir = join(dataDir, "policies");
  mkdirSync(policiesDir, { recursive: true });
  writeFileSync(join(policiesDir, "p.yaml"), policyYaml, "utf8");

  const upstreamPort = await startFakeUpstream();

  const config = TurnstileConfigSchema.parse({
    admin: { token: "test-token-1234567890" },
    data_dir: dataDir,
    policies_dir: policiesDir,
    upstreams: [{ name: "fake", kind: "openai_compat", base_url: `http://127.0.0.1:${upstreamPort}/v1` }],
    model_routes: [{ match: "test-model", upstream: "fake" }],
    approvals: { default_timeout_s: 300, max_pending: 50, public_base_url: "http://localhost:8787" },
  });
  const ctx = await bootstrap(config, createLogger(config.logging));
  const app = buildApp(ctx);

  const adminHeaders = { authorization: "Bearer test-token-1234567890" };
  const createAgent = await app.inject({ method: "POST", url: "/admin/v1/agents", headers: adminHeaders, payload: { name: "approval-bot" } });
  const agentId = createAgent.json().data.id as string;
  const createKey = await app.inject({ method: "POST", url: `/admin/v1/agents/${agentId}/keys`, headers: adminHeaders });
  const agentKey = createKey.json().data.key as string;

  return {
    app,
    adminHeaders,
    agentKey,
    close: async () => {
      ctx.approvalManager.stop();
      await app.close();
      await ctx.storage.close();
    },
  };
}

const APPROVE_ALWAYS_POLICY = `
id: always-approve
enabled: true
priority: 100
match: {}
plugin: require_approval
params:
  message_template: "review please"
  timeout_s: 300
  on_timeout: deny
`;

describe("human-in-the-loop approvals (end to end)", () => {
  it("parks the request, and approving it via the admin API lets it through", async () => {
    const { app, adminHeaders, agentKey, close } = await makeApp(APPROVE_ALWAYS_POLICY);
    try {
      const chatPromise = app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { authorization: `Bearer ${agentKey}` },
        payload: { model: "test-model", messages: [{ role: "user", content: "hi" }] },
      });

      // wait for the request to actually park before looking for it
      let approvalId: string | undefined;
      for (let i = 0; i < 50 && !approvalId; i++) {
        await new Promise((r) => setTimeout(r, 20));
        const pending = await app.inject({ method: "GET", url: "/admin/v1/approvals", headers: adminHeaders });
        approvalId = pending.json().data[0]?.id;
      }
      expect(approvalId).toBeDefined();

      const decide = await app.inject({
        method: "POST",
        url: `/admin/v1/approvals/${approvalId}/decide`,
        headers: adminHeaders,
        payload: { decision: "approved", note: "looks fine" },
      });
      expect(decide.statusCode).toBe(200);
      expect(decide.json().data.status).toBe("approved");

      const chatResponse = await chatPromise;
      expect(chatResponse.statusCode).toBe(200);
      expect(chatResponse.json().choices[0].message.content).toBe("ok");
    } finally {
      await close();
    }
  });

  it("denying via the admin API returns APPROVAL_DENIED to the caller", async () => {
    const { app, adminHeaders, agentKey, close } = await makeApp(APPROVE_ALWAYS_POLICY);
    try {
      const chatPromise = app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { authorization: `Bearer ${agentKey}` },
        payload: { model: "test-model", messages: [{ role: "user", content: "hi" }] },
      });

      let approvalId: string | undefined;
      for (let i = 0; i < 50 && !approvalId; i++) {
        await new Promise((r) => setTimeout(r, 20));
        const pending = await app.inject({ method: "GET", url: "/admin/v1/approvals", headers: adminHeaders });
        approvalId = pending.json().data[0]?.id;
      }

      await app.inject({
        method: "POST",
        url: `/admin/v1/approvals/${approvalId}/decide`,
        headers: adminHeaders,
        payload: { decision: "denied", note: "too risky" },
      });

      const chatResponse = await chatPromise;
      expect(chatResponse.statusCode).toBe(403);
      expect(chatResponse.json().error.code).toBe("APPROVAL_DENIED");
    } finally {
      await close();
    }
  });

  it("times out and denies by default when on_timeout=deny and nobody decides", async () => {
    const timeoutPolicy = APPROVE_ALWAYS_POLICY.replace("timeout_s: 300", "timeout_s: 1");
    const { app, agentKey, close } = await makeApp(timeoutPolicy);
    try {
      const chatResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { authorization: `Bearer ${agentKey}` },
        payload: { model: "test-model", messages: [{ role: "user", content: "hi" }] },
      });
      expect(chatResponse.statusCode).toBe(403);
      expect(chatResponse.json().error.code).toBe("APPROVAL_TIMEOUT");
    } finally {
      await close();
    }
  });

  it("on_timeout=allow lets the request through once the deadline passes with no decision", async () => {
    const timeoutPolicy = APPROVE_ALWAYS_POLICY.replace("timeout_s: 300", "timeout_s: 1").replace("on_timeout: deny", "on_timeout: allow");
    const { app, agentKey, close } = await makeApp(timeoutPolicy);
    try {
      const chatResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { authorization: `Bearer ${agentKey}` },
        payload: { model: "test-model", messages: [{ role: "user", content: "hi" }] },
      });
      expect(chatResponse.statusCode).toBe(200);
    } finally {
      await close();
    }
  });
});
