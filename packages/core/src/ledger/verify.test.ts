import { describe, it, expect, afterEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { SqliteStorage } from "../storage/sqlite.js";
import { verifyLedger } from "./verify.js";
import type { Storage } from "../storage/types.js";

async function makeStorage(): Promise<Storage> {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  return storage;
}

describe("verifyLedger", () => {
  let storage: Storage | null = null;
  afterEach(async () => {
    if (storage) await storage.close();
    storage = null;
  });

  it("passes on a freshly appended, untampered chain", async () => {
    storage = await makeStorage();
    await storage.ledger.append([
      { eventId: "e1", ts: "2026-01-01T00:00:00.000Z", kind: "action", payload: { hello: "world" } },
      { eventId: "e2", ts: "2026-01-01T00:00:01.000Z", kind: "decision", payload: { outcome: "allow" } },
      { eventId: "e3", ts: "2026-01-01T00:00:02.000Z", kind: "outcome", payload: { status: "success" } },
    ]);

    const result = await verifyLedger(storage);
    expect(result.ok).toBe(true);
    expect(result.rowsChecked).toBe(3);
    expect(result.firstDivergence).toBeNull();

    const head = await storage.ledger.latest();
    expect(head).toEqual({ seq: result.headSeq, chainHash: result.headChainHash });
  });

  it("fails verification and reports the exact seq when one payload byte is flipped", async () => {
    storage = await makeStorage();
    await storage.ledger.append([
      { eventId: "e1", ts: "2026-01-01T00:00:00.000Z", kind: "action", payload: { n: 1 } },
      { eventId: "e2", ts: "2026-01-01T00:00:01.000Z", kind: "action", payload: { n: 2 } },
      { eventId: "e3", ts: "2026-01-01T00:00:02.000Z", kind: "action", payload: { n: 3 } },
    ]);

    // Reach into the raw db to flip one byte in row seq=1's stored payload,
    // simulating tamper (A4 in the threat model: DB file write access).
    const raw = (storage as unknown as { db: DatabaseSync }).db;
    raw.prepare("UPDATE ledger SET payload_json = ? WHERE seq = 1").run('{"n":999}');

    const result = await verifyLedger(storage);
    expect(result.ok).toBe(false);
    expect(result.firstDivergence).toEqual({ seq: 1, reason: "payload_hash_mismatch" });
  });

  it("detects a forged chain_hash even when payload matches", async () => {
    storage = await makeStorage();
    await storage.ledger.append([
      { eventId: "e1", ts: "2026-01-01T00:00:00.000Z", kind: "action", payload: { n: 1 } },
      { eventId: "e2", ts: "2026-01-01T00:00:01.000Z", kind: "action", payload: { n: 2 } },
    ]);

    const raw = (storage as unknown as { db: DatabaseSync }).db;
    raw.prepare("UPDATE ledger SET chain_hash = 'deadbeef' WHERE seq = 0").run();

    const result = await verifyLedger(storage);
    expect(result.ok).toBe(false);
    // seq 0's own chain_hash is wrong -> caught immediately at seq 0.
    expect(result.firstDivergence).toEqual({ seq: 0, reason: "chain_hash_mismatch" });
  });

  it("returns ok on an empty ledger", async () => {
    storage = await makeStorage();
    const result = await verifyLedger(storage);
    expect(result.ok).toBe(true);
    expect(result.rowsChecked).toBe(0);
    expect(result.headSeq).toBeNull();
  });
});
