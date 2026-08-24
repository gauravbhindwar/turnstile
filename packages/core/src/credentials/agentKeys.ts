import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const KEY_PREFIX = "trn_";
const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomBase62(byteLength: number): string {
  const bytes = randomBytes(byteLength);
  let out = "";
  for (const byte of bytes) {
    out += BASE62_ALPHABET[byte % BASE62_ALPHABET.length];
  }
  return out;
}

export interface GeneratedAgentKey {
  raw: string; // shown to the operator exactly once
  hash: string; // SHA-256 hex, what actually gets stored
  prefix: string; // first 12 chars, safe to display later
}

export function generateAgentKey(): GeneratedAgentKey {
  const raw = `${KEY_PREFIX}${randomBase62(32)}`;
  return { raw, hash: hashAgentKey(raw), prefix: raw.slice(0, 12) };
}

export function hashAgentKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
