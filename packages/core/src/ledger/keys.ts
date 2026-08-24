import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

export interface CheckpointKeypair {
  publicKeyPem: string;
  privateKeyPem: string;
}

// Ed25519 keypair for signed ledger checkpoints (§12.2). Generated once on
// first boot and persisted under data_dir; the private key is 0600.
export function loadOrCreateCheckpointKeypair(dataDir: string): CheckpointKeypair {
  const pubPath = join(dataDir, "checkpoint.pub.pem");
  const privPath = join(dataDir, "checkpoint.key.pem");

  if (existsSync(pubPath) && existsSync(privPath)) {
    return { publicKeyPem: readFileSync(pubPath, "utf8"), privateKeyPem: readFileSync(privPath, "utf8") };
  }

  mkdirSync(dataDir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  writeFileSync(pubPath, publicKeyPem, "utf8");
  writeFileSync(privPath, privateKeyPem, "utf8");
  try {
    chmodSync(privPath, 0o600);
  } catch {
    // chmod is a no-op on filesystems that don't support POSIX permissions
    // (e.g. some Windows setups); the file still exists, just less strictly guarded.
  }

  return { publicKeyPem, privateKeyPem };
}

export function signWithCheckpointKey(privateKeyPem: string, data: string): string {
  const signature = cryptoSign(null, Buffer.from(data, "utf8"), privateKeyPem);
  return signature.toString("base64");
}

export function verifyWithCheckpointKey(publicKeyPem: string, data: string, signatureBase64: string): boolean {
  return cryptoVerify(null, Buffer.from(data, "utf8"), publicKeyPem, Buffer.from(signatureBase64, "base64"));
}
