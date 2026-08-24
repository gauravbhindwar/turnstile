import { describe, it, expect } from "vitest";
import { createLogger, TurnstileConfigSchema } from "@turnstile/core";
import { buildApp } from "./app.js";

describe("GET /healthz", () => {
  it("returns 200 with status ok", async () => {
    const config = TurnstileConfigSchema.parse({ admin: { token: "test-token-1234567890" } });
    const app = buildApp({ config, logger: createLogger(config.logging) });
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
  });
});
