import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

// Vendor API keys are the highest-value secret in the system (§17.3): they
// never touch the agent, never appear in logs, and are stored encrypted at
// rest under a key derived (HKDF) from WARDEN_MASTER_KEY / an auto-generated
// data_dir/master.key. Renamed reference kept as historical context only —
// the env var is TURNSTILE_MASTER_KEY.
export function loadOrCreateMasterKey(dataDir: string): Buffer {
  const fromEnv = process.env.TURNSTILE_MASTER_KEY;
  if (fromEnv) return Buffer.from(fromEnv, "hex");

  const keyPath = join(dataDir, "master.key");
  if (existsSync(keyPath)) {
    return Buffer.from(readFileSync(keyPath, "utf8").trim(), "hex");
  }

  mkdirSync(dataDir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString("hex"), "utf8");
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    // best-effort on filesystems without POSIX permission bits
  }
  return key;
}

function deriveEncryptionKey(masterKey: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey, Buffer.alloc(0), "turnstile-credential-vault", 32));
}

export function encryptCredential(masterKey: Buffer, plaintext: string): Buffer {
  const key = deriveEncryptionKey(masterKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptCredential(masterKey: Buffer, blob: Buffer): string {
  const key = deriveEncryptionKey(masterKey);
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = blob.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
