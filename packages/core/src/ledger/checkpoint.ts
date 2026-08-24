import type { NewLedgerRow } from "../storage/types.js";
import { signWithCheckpointKey } from "./keys.js";

export interface CheckpointPayload {
  type: "checkpoint";
  upToSeq: number;
  chainHash: string;
  signature: string;
}

export function buildCheckpointRow(eventId: string, upToSeq: number, chainHash: string, privateKeyPem: string): NewLedgerRow {
  const signature = signWithCheckpointKey(privateKeyPem, `${upToSeq}:${chainHash}`);
  const payload: CheckpointPayload = { type: "checkpoint", upToSeq, chainHash, signature };
  return { eventId, ts: new Date().toISOString(), kind: "system", payload };
}

// Triggers a checkpoint when either threshold is hit (§12.2): N rows since
// the last checkpoint, or S seconds since the last checkpoint — whichever
// comes first, and only if new rows exist.
export function shouldCheckpoint(
  rowsSinceLastCheckpoint: number,
  msSinceLastCheckpoint: number,
  everyRows: number,
  everyMs: number,
): boolean {
  if (rowsSinceLastCheckpoint <= 0) return false;
  return rowsSinceLastCheckpoint >= everyRows || msSinceLastCheckpoint >= everyMs;
}
