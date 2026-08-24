import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptCredential, decryptCredential } from "./vault.js";

describe("credential vault (AES-256-GCM)", () => {
  it("round-trips a secret", () => {
    const masterKey = randomBytes(32);
    const blob = encryptCredential(masterKey, "sk-super-secret-key");
    expect(decryptCredential(masterKey, blob)).toBe("sk-super-secret-key");
  });

  it("produces different ciphertext each time (random IV)", () => {
    const masterKey = randomBytes(32);
    const a = encryptCredential(masterKey, "same-secret");
    const b = encryptCredential(masterKey, "same-secret");
    expect(a.equals(b)).toBe(false);
  });

  it("fails to decrypt with the wrong master key", () => {
    const masterKey = randomBytes(32);
    const wrongKey = randomBytes(32);
    const blob = encryptCredential(masterKey, "secret");
    expect(() => decryptCredential(wrongKey, blob)).toThrow();
  });

  it("fails to decrypt tampered ciphertext (GCM auth tag catches it)", () => {
    const masterKey = randomBytes(32);
    const blob = encryptCredential(masterKey, "secret");
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! + 1) % 256;
    expect(() => decryptCredential(masterKey, tampered)).toThrow();
  });
});
