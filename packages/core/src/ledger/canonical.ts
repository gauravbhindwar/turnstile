import { createHash } from "node:crypto";

// RFC 8785 (JCS) canonical JSON. Single source of truth shared by the ledger
// writer (sqlite.ts) and the verifier so a byte-for-byte reproducible hash
// chain holds across platforms and over time. Implemented directly rather
// than via the `canonicalize` package: its shipped .d.ts declares an ESM
// `export default` for what is actually a CJS `module.exports = fn`, which
// TypeScript's NodeNext resolution can't reconcile. JCS's substance for
// JSON-safe values (no exotic numbers, no undefined) reduces
// to "sort object keys recursively, then JSON.stringify" — which is what
// this does; array order and primitive serialization are already governed
// by the same ECMA-262 Number-to-string rules JSON.stringify uses.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const GENESIS_PREV_HASH = "0".repeat(64);

export function computeChainHash(prevHash: string, payloadSha256: string, seq: number, ts: string): string {
  return sha256Hex(`${prevHash}${payloadSha256}${seq}${ts}`);
}
