import { uuidv7 } from "../ids.js";
import type { ActionEvent } from "../types/action.js";
import type { ApprovalRow, Storage } from "../storage/types.js";
import type { Logger } from "../logging/logger.js";
import type { Notifier } from "./notifiers.js";

export class ApprovalQueueFullError extends Error {
  constructor() {
    super("approval queue is full (max_pending_approvals reached)");
    this.name = "ApprovalQueueFullError";
  }
}

export interface ApprovalManagerOptions {
  storage: Storage;
  logger: Logger;
  defaultTimeoutS: number;
  maxPending: number;
  publicBaseUrl: string;
  notifiers: Notifier[];
  sweepIntervalMs?: number;
}

interface Waiter {
  resolve: (row: ApprovalRow) => void;
  timer: ReturnType<typeof setTimeout>;
}

// Escalation state machine (§11): pending -> approved | denied | expired
// (terminal, final). Timeout handling uses BOTH an in-memory setTimeout
// (fast path: resolves a parked request immediately) AND a durable
// interval sweep of storage (so a process restart can't strand a row
// forever — the parked HTTP request is gone either way after a restart,
// but the DB row still needs to transition out of "pending").
export class ApprovalManager {
  private readonly waiters = new Map<string, Waiter>();
  private sweepHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: ApprovalManagerOptions) {}

  start(): void {
    this.sweepExpired(); // on-boot sweep
    this.sweepHandle = setInterval(() => this.sweepExpired(), this.options.sweepIntervalMs ?? 30_000);
    this.sweepHandle.unref?.();
  }

  stop(): void {
    if (this.sweepHandle) clearInterval(this.sweepHandle);
    for (const waiter of this.waiters.values()) clearTimeout(waiter.timer);
    this.waiters.clear();
  }

  async escalate(event: ActionEvent, reason: string, timeoutS?: number): Promise<ApprovalRow> {
    const { storage, maxPending } = this.options;
    if (storage.approvals.listPending().length >= maxPending) {
      throw new ApprovalQueueFullError();
    }

    const now = new Date();
    const effectiveTimeoutS = timeoutS ?? this.options.defaultTimeoutS;
    const row: ApprovalRow = {
      id: uuidv7(),
      actionEventId: event.eventId,
      status: "pending",
      summary: {
        agentName: event.principal.agentName,
        agentId: event.principal.agentId,
        workspaceId: event.principal.workspaceId,
        kind: event.kind,
        target: event.resource.target,
        upstream: event.resource.upstream,
        reason,
      },
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + effectiveTimeoutS * 1000).toISOString(),
      decidedAt: null,
      decidedBy: null,
      note: null,
    };
    storage.approvals.create(row);

    const approvalUrl = `${this.options.publicBaseUrl.replace(/\/$/, "")}/app/approvals/${row.id}`;
    for (const notifier of this.options.notifiers) {
      void notifier.send({ approval: row, event, reason, approvalUrl }).catch((err: Error) => {
        this.options.logger.error({ err: err.message }, "approval notifier threw");
      });
    }

    return row;
  }

  // Resolves once the approval leaves "pending" — via decide() being
  // called, the in-memory timer firing, or the durable sweep catching it.
  waitForDecision(approvalId: string): Promise<ApprovalRow> {
    return new Promise((resolve) => {
      const row = this.options.storage.approvals.get(approvalId);
      if (!row) {
        throw new Error(`no approval with id "${approvalId}"`);
      }
      if (row.status !== "pending") {
        resolve(row);
        return;
      }

      const msRemaining = Math.max(0, new Date(row.expiresAt).getTime() - Date.now());
      const timer = setTimeout(() => {
        this.waiters.delete(approvalId);
        const expired = this.options.storage.approvals.expireOverdue(new Date().toISOString());
        const match = expired.find((r) => r.id === approvalId) ?? this.options.storage.approvals.get(approvalId);
        resolve(match ?? { ...row, status: "expired" });
      }, msRemaining);
      timer.unref?.();

      this.waiters.set(approvalId, { resolve, timer });
    });
  }

  decide(id: string, status: "approved" | "denied", decidedBy: string, note: string | null): ApprovalRow | null {
    const row = this.options.storage.approvals.decide(id, status, decidedBy, note);
    if (row) this.resolveWaiter(row);
    return row;
  }

  sweepExpired(): void {
    const expired = this.options.storage.approvals.expireOverdue(new Date().toISOString());
    for (const row of expired) this.resolveWaiter(row);
  }

  private resolveWaiter(row: ApprovalRow): void {
    const waiter = this.waiters.get(row.id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.waiters.delete(row.id);
    waiter.resolve(row);
  }
}
