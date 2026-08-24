import type { ActionEvent, Decision, OutcomeEvent } from "../types/action.js";

export type LedgerRowKind = "action" | "decision" | "outcome" | "approval" | "system";

export interface NewLedgerRow {
  eventId: string;
  ts: string;
  kind: LedgerRowKind;
  payload: unknown;
}

export interface LedgerRow extends NewLedgerRow {
  seq: number;
  payloadSha256: string;
  prevHash: string;
  chainHash: string;
}

export interface LedgerHead {
  seq: number;
  chainHash: string;
}

export interface AppendResult {
  seqs: number[];
  head: LedgerHead;
}

export interface LedgerRange {
  from?: number;
  to?: number;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  createdAt: string;
}

export interface AgentRow {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  disabled: boolean;
}

export interface AgentKeyRow {
  id: string;
  agentId: string;
  keyHash: string;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface UpstreamRow {
  name: string;
  kind: string;
  baseUrl: string;
  credentialId: string | null;
}

export interface CredentialRow {
  id: string;
  label: string | null;
  ciphertext: Buffer;
  createdAt: string;
}

export interface TimelineFilter {
  workspaceId?: string;
  agentId?: string;
  kind?: string;
  outcome?: string;
  from?: string;
  to?: string;
  q?: string;
}

export interface PageParams {
  cursor?: string;
  limit: number;
}

export interface TimelineEntry {
  action: ActionEvent;
  decision: Decision | null;
  outcome: OutcomeEvent | null;
}

export interface TimelinePage {
  items: TimelineEntry[];
  nextCursor: string | null;
}

export interface BudgetUsage {
  reservedUsd: number;
  settledUsd: number;
}

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface ApprovalRow {
  id: string;
  actionEventId: string;
  status: ApprovalStatus;
  summary: unknown;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  note: string | null;
}

export interface Storage {
  init(): Promise<void>;
  migrate(): Promise<void>;
  close(): Promise<void>;

  ledger: {
    append(rows: NewLedgerRow[]): Promise<AppendResult>;
    iterate(range?: LedgerRange): AsyncIterable<LedgerRow>;
    latest(): Promise<LedgerHead | null>;
  };

  events: {
    insertAction(event: ActionEvent): void;
    insertDecision(decision: Decision, actionEventId: string): void;
    insertOutcome(outcome: OutcomeEvent, actionEventId: string): void;
    queryTimeline(filter: TimelineFilter, page: PageParams): TimelinePage;
    getExchange(traceId: string): TimelineEntry[];
  };

  budgets: {
    reserveIfUnder(scopeKey: string, windowKey: string, est: number, limit: number): boolean;
    settle(scopeKey: string, windowKey: string, est: number, actual: number): void;
    getUsage(scopeKey: string, windowKey: string): BudgetUsage;
    gc(olderThanMs: number): void;
  };

  kv: {
    get(ns: string, key: string): string | null;
    set(ns: string, key: string, value: string, ttlMs?: number): void;
    incr(ns: string, key: string, by: number, ttlMs?: number): number;
    delete(ns: string, key: string): void;
  };

  approvals: {
    create(row: ApprovalRow): void;
    get(id: string): ApprovalRow | null;
    listPending(): ApprovalRow[];
    decide(id: string, status: "approved" | "denied", decidedBy: string, note: string | null): ApprovalRow | null;
    // Durable timeout sweep (§11): marks every still-pending row whose
    // expiresAt has passed as expired, and returns those rows. Must be
    // callable on every boot (not only via setTimeout) so a process
    // restart can't strand a parked approval forever.
    expireOverdue(nowIso: string): ApprovalRow[];
  };

  workspaces: {
    create(row: WorkspaceRow): void;
    get(id: string): WorkspaceRow | null;
    getByName(name: string): WorkspaceRow | null;
    list(): WorkspaceRow[];
  };

  agents: {
    create(row: AgentRow): void;
    get(id: string): AgentRow | null;
    getByName(workspaceId: string, name: string): AgentRow | null;
    list(workspaceId?: string): AgentRow[];
  };

  agentKeys: {
    create(row: AgentKeyRow): void;
    getByHash(keyHash: string): AgentKeyRow | null;
    revoke(id: string): void;
    touchLastUsed(id: string, at: string): void;
    listForAgent(agentId: string): AgentKeyRow[];
  };

  upstreams: {
    upsert(row: UpstreamRow): void;
    get(name: string): UpstreamRow | null;
    list(): UpstreamRow[];
  };

  credentials: {
    create(row: CredentialRow): void;
    get(id: string): CredentialRow | null;
  };
}
