import { describe, it, expect, afterEach } from "vitest";
import { SqliteStorage } from "./sqlite.js";
import type { ApprovalRow, Storage } from "./types.js";

async function makeStorage(): Promise<Storage> {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  return storage;
}

function makeApproval(overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: "appr-1",
    actionEventId: "evt-1",
    status: "pending",
    summary: { agent: "test-bot", target: "gpt-4o-mini" },
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:05:00.000Z",
    decidedAt: null,
    decidedBy: null,
    note: null,
    ...overrides,
  };
}

describe("Storage.approvals", () => {
  let storage: Storage | null = null;
  afterEach(async () => {
    if (storage) await storage.close();
    storage = null;
  });

  it("creates and reads back a pending approval", async () => {
    storage = await makeStorage();
    storage.approvals.create(makeApproval());
    const row = storage.approvals.get("appr-1");
    expect(row).not.toBeNull();
    expect(row!.status).toBe("pending");
    expect(row!.summary).toEqual({ agent: "test-bot", target: "gpt-4o-mini" });
  });

  it("returns null for an unknown id", async () => {
    storage = await makeStorage();
    expect(storage.approvals.get("nope")).toBeNull();
  });

  it("listPending returns only pending rows, oldest first", async () => {
    storage = await makeStorage();
    storage.approvals.create(makeApproval({ id: "a1", createdAt: "2026-01-01T00:00:01.000Z" }));
    storage.approvals.create(makeApproval({ id: "a2", createdAt: "2026-01-01T00:00:00.000Z" }));
    storage.approvals.create(makeApproval({ id: "a3", status: "approved" }));
    const pending = storage.approvals.listPending();
    expect(pending.map((r) => r.id)).toEqual(["a2", "a1"]);
  });

  it("decide() transitions pending -> approved/denied and is a no-op if already decided", async () => {
    storage = await makeStorage();
    storage.approvals.create(makeApproval());
    const decided = storage.approvals.decide("appr-1", "approved", "admin", "looks fine");
    expect(decided?.status).toBe("approved");
    expect(decided?.decidedBy).toBe("admin");
    expect(decided?.note).toBe("looks fine");

    const secondAttempt = storage.approvals.decide("appr-1", "denied", "admin2", null);
    expect(secondAttempt).toBeNull(); // already decided — decide() only acts on pending rows

    const stored = storage.approvals.get("appr-1");
    expect(stored?.status).toBe("approved"); // unchanged by the no-op second attempt
  });

  it("expireOverdue marks and returns only pending rows past their expiresAt", async () => {
    storage = await makeStorage();
    storage.approvals.create(makeApproval({ id: "overdue", expiresAt: "2026-01-01T00:00:00.000Z" }));
    storage.approvals.create(makeApproval({ id: "not-yet", expiresAt: "2099-01-01T00:00:00.000Z" }));
    storage.approvals.create(makeApproval({ id: "already-approved", status: "approved", expiresAt: "2026-01-01T00:00:00.000Z" }));

    const expired = storage.approvals.expireOverdue("2026-06-01T00:00:00.000Z");
    expect(expired.map((r) => r.id)).toEqual(["overdue"]);
    expect(storage.approvals.get("overdue")?.status).toBe("expired");
    expect(storage.approvals.get("not-yet")?.status).toBe("pending");
    expect(storage.approvals.get("already-approved")?.status).toBe("approved");
  });
});
