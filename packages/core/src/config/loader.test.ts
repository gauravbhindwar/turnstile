import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, ConfigError, assertBootSecurityGate } from "./loader.js";

function writeTempConfig(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "turnstile-config-test-"));
  const path = join(dir, "turnstile.yaml");
  writeFileSync(path, contents, "utf8");
  return path;
}

const MINIMAL_VALID = `
admin:
  token: this-is-a-fake-token-1234
`;

describe("loadConfig", () => {
  const cleanupPaths: string[] = [];
  afterEach(() => {
    for (const p of cleanupPaths.splice(0)) {
      rmSync(p, { recursive: true, force: true });
    }
  });

  it("applies defaults for a minimal valid file", () => {
    const path = writeTempConfig(MINIMAL_VALID);
    cleanupPaths.push(path);
    const config = loadConfig(path);
    expect(config.server.port).toBe(8787);
    expect(config.fail_mode).toEqual({ spend: "closed", mutate: "closed", read: "open" });
  });

  it("throws ConfigError for a missing file", () => {
    expect(() => loadConfig("./does-not-exist.yaml")).toThrow(ConfigError);
  });

  it("throws ConfigError when admin.token is too short", () => {
    const path = writeTempConfig("admin:\n  token: short\n");
    cleanupPaths.push(path);
    expect(() => loadConfig(path)).toThrow(ConfigError);
  });

  it("interpolates env vars from the yaml before validation", () => {
    const path = writeTempConfig("admin:\n  token: ${TEST_ADMIN_TOKEN}\n");
    cleanupPaths.push(path);
    process.env.TEST_ADMIN_TOKEN = "env-supplied-token-123456";
    try {
      const config = loadConfig(path);
      expect(config.admin.token).toBe("env-supplied-token-123456");
    } finally {
      delete process.env.TEST_ADMIN_TOKEN;
    }
  });
});

describe("assertBootSecurityGate", () => {
  it("allows loopback host without TLS", () => {
    const config = loadConfig(writeTempConfig(MINIMAL_VALID));
    expect(() => assertBootSecurityGate(config)).not.toThrow();
  });

  it("refuses non-loopback host without TLS or acknowledgement", () => {
    const path = writeTempConfig(`
server:
  host: 0.0.0.0
admin:
  token: this-is-a-fake-token-1234
`);
    const config = loadConfig(path);
    expect(() => assertBootSecurityGate(config)).toThrow(ConfigError);
    rmSync(path, { recursive: true, force: true });
  });

  it("allows non-loopback host when i_understand_http is set", () => {
    const path = writeTempConfig(`
server:
  host: 0.0.0.0
admin:
  token: this-is-a-fake-token-1234
i_understand_http: true
`);
    const config = loadConfig(path);
    expect(() => assertBootSecurityGate(config)).not.toThrow();
    rmSync(path, { recursive: true, force: true });
  });
});
