import { describe, it, expect, vi } from "vitest";
import { Turnstile, TurnstileError } from "./index.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Turnstile.guard", () => {
  it("sends execution.mode=evaluate_only and the declared class/resource", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: { allowed: true, eventId: "e1", traceId: "t1", decision: { outcome: "allow", finalReason: "ok", matchedPolicies: [] } } }),
    );
    const client = new Turnstile("http://localhost:8787", "trn_x", { fetchImpl: fetchMock as unknown as typeof fetch });
    await client.guard("send_email", { to: "a@b.com" }, { class: "mutate", resource: { upstream: "sendgrid" } });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:8787/actions/execute");
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe("Bearer trn_x");
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toMatchObject({ name: "send_email", class: "mutate", resource: { upstream: "sendgrid" }, execution: { mode: "evaluate_only" } });
  });

  it("throws TurnstileError on an unexpected status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { error: { code: "INTERNAL" } }));
    const client = new Turnstile("http://localhost:8787", "trn_x", { fetchImpl: fetchMock as unknown as typeof fetch });
    await expect(client.guard("x", {}, { resource: { upstream: "u" } })).rejects.toThrow(TurnstileError);
  });
});

describe("Guarded.report", () => {
  it("posts to /actions/outcome when allowed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: { allowed: true, eventId: "e1", traceId: "t1", decision: { outcome: "allow", finalReason: "ok", matchedPolicies: [] } } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { recorded: true } }));
    const client = new Turnstile("http://localhost:8787", "trn_x", { fetchImpl: fetchMock as unknown as typeof fetch });

    const guarded = await client.guard("x", {}, { resource: { upstream: "u" } });
    await guarded.report({ status: "success", latencyMs: 12 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("http://localhost:8787/actions/outcome");
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toMatchObject({ eventId: "e1", traceId: "t1", status: "success", latencyMs: 12 });
  });

  it("is a no-op (no network call) when denied", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { error: { type: "turnstile_policy_block", code: "TURNSTILE_POLICY_BLOCK", reason: "no", traceId: "t1" } }));
    const client = new Turnstile("http://localhost:8787", "trn_x", { fetchImpl: fetchMock as unknown as typeof fetch });

    const guarded = await client.guard("x", {}, { resource: { upstream: "u" } });
    await guarded.report({ status: "success" });

    expect(fetchMock).toHaveBeenCalledTimes(1); // only the guard() call, no /actions/outcome
  });
});

describe("Turnstile.wrap", () => {
  it("runs fn and reports success when allowed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: { allowed: true, eventId: "e1", traceId: "t1", decision: { outcome: "allow", finalReason: "ok", matchedPolicies: [] } } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { recorded: true } }));
    const client = new Turnstile("http://localhost:8787", "trn_x", { fetchImpl: fetchMock as unknown as typeof fetch });

    const result = await client.wrap("x", {}, { resource: { upstream: "u" } }, async () => "done");
    expect(result).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws without calling fn when denied", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { error: { type: "turnstile_policy_block", code: "TURNSTILE_POLICY_BLOCK", reason: "blocked", traceId: "t1" } }));
    const client = new Turnstile("http://localhost:8787", "trn_x", { fetchImpl: fetchMock as unknown as typeof fetch });
    const fn = vi.fn();

    await expect(client.wrap("x", {}, { resource: { upstream: "u" } }, fn)).rejects.toThrow(TurnstileError);
    expect(fn).not.toHaveBeenCalled();
  });
});
