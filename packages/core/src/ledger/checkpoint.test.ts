import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCheckpointRow, shouldCheckpoint } from "./checkpoint.js";
import { loadOrCreateCheckpointKeypair, verifyWithCheckpointKey } from "./keys.js";

describe("shouldCheckpoint", () => {
  it("never checkpoints with zero new rows", () => {
    expect(shouldCheckpoint(0, 999_999, 1000, 60_000)).toBe(false);
  });

  it("checkpoints once the row threshold is hit", () => {
    expect(shouldCheckpoint(1000, 0, 1000, 60_000)).toBe(true);
    expect(shouldCheckpoint(999, 0, 1000, 60_000)).toBe(false);
  });

  it("checkpoints once the time threshold is hit, even with few rows", () => {
    expect(shouldCheckpoint(1, 60_000, 1000, 60_000)).toBe(true);
    expect(shouldCheckpoint(1, 59_999, 1000, 60_000)).toBe(false);
  });
});

describe("buildCheckpointRow", () => {
  it("produces a system row whose signature verifies against the public key", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "turnstile-checkpoint-test-"));
    try {
      const keypair = loadOrCreateCheckpointKeypair(dataDir);
      const row = buildCheckpointRow("evt-1", 41, "some-chain-hash", keypair.privateKeyPem);

      expect(row.kind).toBe("system");
      const payload = row.payload as { type: string; upToSeq: number; chainHash: string; signature: string };
      expect(payload.type).toBe("checkpoint");
      expect(payload.upToSeq).toBe(41);
      expect(payload.chainHash).toBe("some-chain-hash");

      const valid = verifyWithCheckpointKey(keypair.publicKeyPem, `${payload.upToSeq}:${payload.chainHash}`, payload.signature);
      expect(valid).toBe(true);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("fails verification against a tampered chainHash", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "turnstile-checkpoint-test-"));
    try {
      const keypair = loadOrCreateCheckpointKeypair(dataDir);
      const row = buildCheckpointRow("evt-1", 41, "original-hash", keypair.privateKeyPem);
      const payload = row.payload as { upToSeq: number; signature: string };

      const valid = verifyWithCheckpointKey(keypair.publicKeyPem, `${payload.upToSeq}:tampered-hash`, payload.signature);
      expect(valid).toBe(false);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("loadOrCreateCheckpointKeypair", () => {
  it("persists and reloads the same keypair", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "turnstile-checkpoint-test-"));
    try {
      const first = loadOrCreateCheckpointKeypair(dataDir);
      const second = loadOrCreateCheckpointKeypair(dataDir);
      expect(second.publicKeyPem).toBe(first.publicKeyPem);
      expect(second.privateKeyPem).toBe(first.privateKeyPem);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
