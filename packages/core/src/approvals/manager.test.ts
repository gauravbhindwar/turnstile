import { describe, it, expect, afterEach } from "vitest";
import { ApprovalManager, ApprovalQueueFullError } from "./manager.js";
import type { Notifier, NotificationContext } from "./notifiers.js";
import { SqliteStorage } from "../storage/sqlite.js";
import { createLogger } from "../logging/logger.js";
import { makeActionEvent } from "../policy/testUtils.js";
import type { Storage } from "../storage/types.js";

const logger = createLogger({ level: "silent", format: "json" });

class RecordingNotifier implements Notifier {
  sent: NotificationContext[] = [];
  async send(ctx: NotificationContext): Promise<void> {
    this.sent.push(ctx);
  }
}

async function makeStorage(): Promise<Storage> {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  return storage;
}

describe("ApprovalManager", () => {
  let manager: ApprovalManager | null = null;
  let storage: Storage | null = null;

  afterEach(async () => {
    manager?.stop();
    if (storage) await storage.close();
    manager = null;
    storage = null;
  });

  it("escalate() creates a pending row and fires notifiers", async () => {
    storage = await makeStorage();
    const notifier = new RecordingNotifier();
    manager = new ApprovalManager({
      storage,
      logger,
      defaultTimeoutS: 300,
      maxPending: 50,
      publicBaseUrl: "http://localhost:8787",
      notifiers: [notifier],
    });

    const event = makeActionEvent();
    const row = await manager.escalate(event, "spend cap breach, escalate configured");
    expect(row.status).toBe("pending");
    expect(row.actionEventId).toBe(event.eventId);

    // notifier fires async (fire-and-forget); give the microtask queue a turn
    await new Promise((r) => setTimeout(r, 10));
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]!.approvalUrl).toBe(`http://localhost:8787/app/approvals/${row.id}`);
  });

  it("throws ApprovalQueueFullError once max_pending is reached", async () => {
    storage = await makeStorage();
    manager = new ApprovalManager({
      storage,
      logger,
      defaultTimeoutS: 300,
      maxPending: 2,
      publicBaseUrl: "http://localhost:8787",
      notifiers: [],
    });

    await manager.escalate(makeActionEvent({ eventId: "e1" }), "r");
    await manager.escalate(makeActionEvent({ eventId: "e2" }), "r");
    await expect(manager.escalate(makeActionEvent({ eventId: "e3" }), "r")).rejects.toThrow(ApprovalQueueFullError);
  });

  it("waitForDecision resolves immediately when decide() is called", async () => {
    storage = await makeStorage();
    manager = new ApprovalManager({
      storage,
      logger,
      defaultTimeoutS: 300,
      maxPending: 50,
      publicBaseUrl: "http://localhost:8787",
      notifiers: [],
    });

    const row = await manager.escalate(makeActionEvent(), "r");
    const waitPromise = manager.waitForDecision(row.id);
    const decided = manager.decide(row.id, "approved", "admin-token-holder", "looks fine");
    expect(decided?.status).toBe("approved");

    const resolved = await waitPromise;
    expect(resolved.status).toBe("approved");
    expect(resolved.decidedBy).toBe("admin-token-holder");
  });

  it("waitForDecision resolves with expired status once the timeout elapses", async () => {
    storage = await makeStorage();
    manager = new ApprovalManager({
      storage,
      logger,
      defaultTimeoutS: 300,
      maxPending: 50,
      publicBaseUrl: "http://localhost:8787",
      notifiers: [],
    });

    // A tiny per-call timeout so the test doesn't wait 300s.
    const row = await manager.escalate(makeActionEvent(), "r", 0.05);
    const resolved = await manager.waitForDecision(row.id);
    expect(resolved.status).toBe("expired");

    const stored = storage.approvals.get(row.id);
    expect(stored?.status).toBe("expired");
  });

  it("a deciding call after expiry is a no-op (terminal state)", async () => {
    storage = await makeStorage();
    manager = new ApprovalManager({
      storage,
      logger,
      defaultTimeoutS: 300,
      maxPending: 50,
      publicBaseUrl: "http://localhost:8787",
      notifiers: [],
    });

    const row = await manager.escalate(makeActionEvent(), "r", 0.05);
    await manager.waitForDecision(row.id);
    const lateDecision = manager.decide(row.id, "approved", "admin", null);
    expect(lateDecision).toBeNull();
  });

  it("sweepExpired resolves waiters for rows that expired via a durable scan", async () => {
    storage = await makeStorage();
    manager = new ApprovalManager({
      storage,
      logger,
      defaultTimeoutS: 300,
      maxPending: 50,
      publicBaseUrl: "http://localhost:8787",
      notifiers: [],
    });

    // Escalate with a long in-memory timeout, but manually backdate the
    // stored expiresAt to simulate "this row should already be expired" —
    // the scenario the durable sweep exists for (e.g. after a restart).
    const row = await manager.escalate(makeActionEvent(), "r", 300);
    const raw = (storage as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db;
    raw.prepare("UPDATE approvals SET expires_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", row.id);

    const waitPromise = manager.waitForDecision(row.id);
    manager.sweepExpired();
    const resolved = await waitPromise;
    expect(resolved.status).toBe("expired");
  });
});
