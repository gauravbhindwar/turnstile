import type { Storage } from "../storage/types.js";
import { canonicalJson, computeChainHash, sha256Hex, GENESIS_PREV_HASH } from "./canonical.js";
import { verifyWithCheckpointKey } from "./keys.js";
import type { CheckpointPayload } from "./checkpoint.js";

export interface VerifyOptions {
  from?: number;
  to?: number;
  publicKeyPem?: string;
}

export type VerifyFailureReason =
  | "prev_hash_mismatch"
  | "payload_hash_mismatch"
  | "chain_hash_mismatch"
  | "checkpoint_signature_invalid";

export interface VerifyResult {
  ok: boolean;
  rowsChecked: number;
  headSeq: number | null;
  headChainHash: string | null;
  checkpointsVerified: number;
  firstDivergence: { seq: number; reason: VerifyFailureReason } | null;
}

// Recomputes the hash chain from storage and checks every link, streaming
// via Storage.ledger.iterate() so this stays cheap on large ledgers.
// Reports the first seq where the recorded chain diverges from what the
// data actually hashes to.
export async function verifyLedger(storage: Storage, options: VerifyOptions = {}): Promise<VerifyResult> {
  let expectedPrevHash = GENESIS_PREV_HASH;
  let rowsChecked = 0;
  let checkpointsVerified = 0;
  let headSeq: number | null = null;
  let headChainHash: string | null = null;

  for await (const row of storage.ledger.iterate({ from: options.from, to: options.to })) {
    if (row.prevHash !== expectedPrevHash) {
      return {
        ok: false,
        rowsChecked,
        headSeq,
        headChainHash,
        checkpointsVerified,
        firstDivergence: { seq: row.seq, reason: "prev_hash_mismatch" },
      };
    }

    if (row.payload !== null) {
      const recomputedPayloadHash = sha256Hex(canonicalJson(row.payload));
      if (recomputedPayloadHash !== row.payloadSha256) {
        return {
          ok: false,
          rowsChecked,
          headSeq,
          headChainHash,
          checkpointsVerified,
          firstDivergence: { seq: row.seq, reason: "payload_hash_mismatch" },
        };
      }
    }

    const recomputedChainHash = computeChainHash(row.prevHash, row.payloadSha256, row.seq, row.ts);
    if (recomputedChainHash !== row.chainHash) {
      return {
        ok: false,
        rowsChecked,
        headSeq,
        headChainHash,
        checkpointsVerified,
        firstDivergence: { seq: row.seq, reason: "chain_hash_mismatch" },
      };
    }

    if (options.publicKeyPem && row.kind === "system" && isCheckpointPayload(row.payload)) {
      const valid = verifyWithCheckpointKey(
        options.publicKeyPem,
        `${row.payload.upToSeq}:${row.payload.chainHash}`,
        row.payload.signature,
      );
      if (!valid) {
        return {
          ok: false,
          rowsChecked,
          headSeq,
          headChainHash,
          checkpointsVerified,
          firstDivergence: { seq: row.seq, reason: "checkpoint_signature_invalid" },
        };
      }
      checkpointsVerified += 1;
    }

    expectedPrevHash = row.chainHash;
    headSeq = row.seq;
    headChainHash = row.chainHash;
    rowsChecked += 1;
  }

  return { ok: true, rowsChecked, headSeq, headChainHash, checkpointsVerified, firstDivergence: null };
}

function isCheckpointPayload(payload: unknown): payload is CheckpointPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { type?: unknown }).type === "checkpoint"
  );
}
