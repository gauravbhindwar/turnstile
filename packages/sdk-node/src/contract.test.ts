import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Turnstile } from "./index.js";

// Same fixtures drive the Python SDK's contract test (tools/sdk-contract/
// fixtures.json) — this proves both SDKs interpret the wire format
// identically without needing a live gateway.
const fixturesPath = fileURLToPath(new URL("../../../tools/sdk-contract/fixtures.json", import.meta.url));
const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8")) as Array<{
  name: string;
  description: string;
  mockResponse: { status: number; body: unknown };
  expected: { allowed: boolean; eventId?: string; traceId?: string; errorCode?: string };
}>;

describe("Turnstile SDK contract (shared fixtures)", () => {
  for (const fixture of fixtures) {
    it(`${fixture.name}: ${fixture.description}`, async () => {
      const fetchMock = async () =>
        new Response(JSON.stringify(fixture.mockResponse.body), {
          status: fixture.mockResponse.status,
          headers: { "content-type": "application/json" },
        });

      const client = new Turnstile("http://localhost:8787", "trn_test", { fetchImpl: fetchMock as unknown as typeof fetch });
      const guarded = await client.guard("send_email", { to: "x@example.com" }, { resource: { upstream: "sendgrid" } });

      expect(guarded.allowed).toBe(fixture.expected.allowed);
      if (fixture.expected.allowed) {
        // eventId/traceId aren't part of the public Guarded API surface,
        // but report() must be a real network call when allowed — verified
        // in index.test.ts. Here we only assert the contract-visible field.
        expect(guarded.decision).toMatchObject({ outcome: "allow" });
      } else {
        expect((guarded.decision as { code: string }).code).toBe(fixture.expected.errorCode);
      }
    });
  }
});
