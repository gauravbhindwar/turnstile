import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicies } from "./loader.js";
import { builtinPlugins } from "./plugins/index.js";
import { allowlistPlugin } from "./plugins/allowlist.js";

describe("loadPolicies", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("applies the plugin's own schema defaults to params (not just the raw YAML)", () => {
    dir = mkdtempSync(join(tmpdir(), "turnstile-policy-test-"));
    // `deny` is omitted — allowlistPlugin's schema defaults it to []. If the
    // loader stored the raw parsed YAML instead of the schema-validated
    // params, `deny` would come back `undefined` and blow up at eval time.
    writeFileSync(
      join(dir, "p1.yaml"),
      `
id: allow-gpt-only
enabled: true
priority: 100
match: {}
plugin: allowlist
params:
  field: target
  allow: ["gpt-*"]
  mode: allow_only
`,
    );

    const { policies, errors } = loadPolicies(dir, builtinPlugins());
    expect(errors).toEqual([]);
    expect(policies).toHaveLength(1);
    const params = policies[0]!.params as { allow: string[]; deny: string[]; mode: string };
    expect(params.deny).toEqual([]);
    expect(params.allow).toEqual(["gpt-*"]);
  });

  it("records a load error for an unknown plugin without throwing", () => {
    dir = mkdtempSync(join(tmpdir(), "turnstile-policy-test-"));
    writeFileSync(
      join(dir, "bad.yaml"),
      `
id: uses-nonexistent-plugin
plugin: does_not_exist
params: {}
`,
    );
    const { policies, errors } = loadPolicies(dir, builtinPlugins());
    expect(policies).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain("unknown plugin");
  });

  it("sorts by priority then id", () => {
    dir = mkdtempSync(join(tmpdir(), "turnstile-policy-test-"));
    const plugins = new Map([[allowlistPlugin.name, allowlistPlugin]]);
    writeFileSync(join(dir, "b.yaml"), `id: b\npriority: 10\nplugin: allowlist\nparams: {field: target}\n`);
    writeFileSync(join(dir, "a.yaml"), `id: a\npriority: 10\nplugin: allowlist\nparams: {field: target}\n`);
    writeFileSync(join(dir, "c.yaml"), `id: c\npriority: 5\nplugin: allowlist\nparams: {field: target}\n`);
    const { policies, errors } = loadPolicies(dir, plugins);
    expect(errors).toEqual([]);
    expect(policies.map((p) => p.id)).toEqual(["c", "a", "b"]);
  });
});
