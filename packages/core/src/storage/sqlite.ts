import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { canonicalJson, computeChainHash, sha256Hex, GENESIS_PREV_HASH } from "../ledger/canonical.js";

// Required via createRequire (not a static `import ... from "node:sqlite"`)
// so bundler-aware tooling (Vite/Vitest) that predates node:sqlite's builtin
// recognition doesn't try to statically resolve/transform it — see ADR-003.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: typeof DatabaseSyncType };
import { MIGRATION_0001_INIT } from "./migrations/0001_init.js";
import type {
  AgentKeyRow,
  AgentRow,
  AppendResult,
  BudgetUsage,
  CredentialRow,
  LedgerHead,
  LedgerRange,
  LedgerRow,
  NewLedgerRow,
  PageParams,
  Storage,
  TimelineEntry,
  TimelineFilter,
  TimelinePage,
  UpstreamRow,
  WorkspaceRow,
} from "./types.js";
import type { ActionEvent, Decision, OutcomeEvent } from "../types/action.js";

export class SqliteStorage implements Storage {
  private db!: DatabaseSyncType;

  constructor(private readonly filePath: string) {}

  // node:sqlite (DatabaseSync, stable since Node 22) instead of the D4-specified
  // better-sqlite3: this environment has no C++ toolchain to build native
  // addons against, and node:sqlite needs none. Same WAL-mode single-file
  // semantics; see ADR-003.
  private runInTransaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async init(): Promise<void> {
    if (this.filePath !== ":memory:") {
      mkdirSync(dirname(this.filePath), { recursive: true });
    }
    this.db = new DatabaseSync(this.filePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    await this.migrate();
  }

  async migrate(): Promise<void> {
    const hasMigrationsTable = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .get();
    if (!hasMigrationsTable) {
      this.db.exec(MIGRATION_0001_INIT);
      this.db.prepare("INSERT INTO schema_migrations(id, applied_at) VALUES (?, ?)").run(
        "0001_init",
        new Date().toISOString(),
      );
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // ---------------------------------------------------------------- ledger

  ledger: Storage["ledger"] = {
    append: async (rows: NewLedgerRow[]): Promise<AppendResult> => {
      return this.runInTransaction((): AppendResult => {
        const headRow = this.db
          .prepare("SELECT seq, chain_hash FROM ledger ORDER BY seq DESC LIMIT 1")
          .get() as { seq: number; chain_hash: string } | undefined;

        let seq = headRow ? headRow.seq : -1;
        let prevHash = headRow ? headRow.chain_hash : GENESIS_PREV_HASH;
        const seqs: number[] = [];

        const insert = this.db.prepare(
          `INSERT INTO ledger(seq, event_id, ts, kind, payload_json, payload_sha256, prev_hash, chain_hash)
           VALUES (@seq, @eventId, @ts, @kind, @payloadJson, @payloadSha256, @prevHash, @chainHash)`,
        );

        for (const row of rows) {
          seq += 1;
          const payloadJson = canonicalJson(row.payload);
          const payloadSha256 = sha256Hex(payloadJson);
          const chainHash = computeChainHash(prevHash, payloadSha256, seq, row.ts);
          insert.run({
            seq,
            eventId: row.eventId,
            ts: row.ts,
            kind: row.kind,
            payloadJson,
            payloadSha256,
            prevHash,
            chainHash,
          });
          seqs.push(seq);
          prevHash = chainHash;
        }

        return { seqs, head: { seq, chainHash: prevHash } };
      });
    },

    iterate: (range?: LedgerRange): AsyncIterable<LedgerRow> => {
      const from = range?.from ?? 0;
      const to = range?.to;
      const db = this.db;
      return {
        async *[Symbol.asyncIterator]() {
          const batchSize = 1000;
          let cursor = from;
          for (;;) {
            const upperClause = to !== undefined ? "AND seq <= ?" : "";
            const params: number[] = to !== undefined ? [cursor, to, batchSize] : [cursor, batchSize];
            const rows = db
              .prepare(
                `SELECT seq, event_id, ts, kind, payload_json, payload_sha256, prev_hash, chain_hash
                 FROM ledger WHERE seq >= ? ${upperClause} ORDER BY seq ASC LIMIT ?`,
              )
              .all(...params) as Array<{
              seq: number;
              event_id: string;
              ts: string;
              kind: LedgerRow["kind"];
              payload_json: string | null;
              payload_sha256: string;
              prev_hash: string;
              chain_hash: string;
            }>;
            if (rows.length === 0) return;
            for (const r of rows) {
              yield {
                seq: r.seq,
                eventId: r.event_id,
                ts: r.ts,
                kind: r.kind,
                payload: r.payload_json ? JSON.parse(r.payload_json) : null,
                payloadSha256: r.payload_sha256,
                prevHash: r.prev_hash,
                chainHash: r.chain_hash,
              };
              cursor = r.seq + 1;
            }
            if (rows.length < batchSize) return;
          }
        },
      };
    },

    latest: async (): Promise<LedgerHead | null> => {
      const row = this.db.prepare("SELECT seq, chain_hash FROM ledger ORDER BY seq DESC LIMIT 1").get() as
        | { seq: number; chain_hash: string }
        | undefined;
      return row ? { seq: row.seq, chainHash: row.chain_hash } : null;
    },
  };

  // ---------------------------------------------------------------- events

  events: Storage["events"] = {
    insertAction: (event: ActionEvent): void => {
      this.db
        .prepare(
          `INSERT INTO action_events(event_id, trace_id, session_id, ts, agent_id, workspace_id, kind, action_class, upstream, target, payload_json)
           VALUES (@eventId, @traceId, @sessionId, @ts, @agentId, @workspaceId, @kind, @actionClass, @upstream, @target, @payloadJson)`,
        )
        .run({
          eventId: event.eventId,
          traceId: event.traceId,
          sessionId: event.sessionId,
          ts: event.ts,
          agentId: event.principal.agentId,
          workspaceId: event.principal.workspaceId,
          kind: event.kind,
          actionClass: event.actionClass,
          upstream: event.resource.upstream,
          target: event.resource.target,
          payloadJson: JSON.stringify(event),
        });
    },

    insertDecision: (decision: Decision, actionEventId: string): void => {
      this.db
        .prepare(
          `INSERT INTO decisions(event_id, action_event_id, ts, outcome, payload_json)
           VALUES (@eventId, @actionEventId, @ts, @outcome, @payloadJson)`,
        )
        .run({
          eventId: decision.eventId,
          actionEventId,
          ts: decision.ts,
          outcome: decision.outcome,
          payloadJson: JSON.stringify(decision),
        });
    },

    insertOutcome: (outcome: OutcomeEvent, actionEventId: string): void => {
      this.db
        .prepare(
          `INSERT INTO outcomes(event_id, action_event_id, ts, status, cost_usd, latency_ms, payload_json)
           VALUES (@eventId, @actionEventId, @ts, @status, @costUsd, @latencyMs, @payloadJson)`,
        )
        .run({
          eventId: outcome.eventId,
          actionEventId,
          ts: outcome.ts,
          status: outcome.status,
          costUsd: outcome.usage?.costUsd ?? null,
          latencyMs: outcome.latencyMs,
          payloadJson: JSON.stringify(outcome),
        });
    },

    queryTimeline: (filter: TimelineFilter, page: PageParams): TimelinePage => {
      const clauses: string[] = [];
      const params: Record<string, string | number> = { limit: page.limit + 1 };
      if (filter.workspaceId) {
        clauses.push("ae.workspace_id = @workspaceId");
        params.workspaceId = filter.workspaceId;
      }
      if (filter.agentId) {
        clauses.push("ae.agent_id = @agentId");
        params.agentId = filter.agentId;
      }
      if (filter.kind) {
        clauses.push("ae.kind = @kind");
        params.kind = filter.kind;
      }
      if (filter.outcome) {
        clauses.push("o.status = @outcome");
        params.outcome = filter.outcome;
      }
      if (filter.from) {
        clauses.push("ae.ts >= @from");
        params.from = filter.from;
      }
      if (filter.to) {
        clauses.push("ae.ts <= @to");
        params.to = filter.to;
      }
      if (page.cursor) {
        clauses.push("ae.ts < @cursor");
        params.cursor = page.cursor;
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = this.db
        .prepare(
          `SELECT ae.payload_json AS action_json, d.payload_json AS decision_json, o.payload_json AS outcome_json
           FROM action_events ae
           LEFT JOIN decisions d ON d.action_event_id = ae.event_id
           LEFT JOIN outcomes o ON o.action_event_id = ae.event_id
           ${where}
           ORDER BY ae.ts DESC
           LIMIT @limit`,
        )
        .all(params) as Array<{ action_json: string; decision_json: string | null; outcome_json: string | null }>;

      const hasMore = rows.length > page.limit;
      const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
      const items: TimelineEntry[] = pageRows.map((r) => ({
        action: JSON.parse(r.action_json) as ActionEvent,
        decision: r.decision_json ? (JSON.parse(r.decision_json) as Decision) : null,
        outcome: r.outcome_json ? (JSON.parse(r.outcome_json) as OutcomeEvent) : null,
      }));
      const last = items[items.length - 1];
      return { items, nextCursor: hasMore && last ? last.action.ts : null };
    },

    getExchange: (traceId: string): TimelineEntry[] => {
      const rows = this.db
        .prepare(
          `SELECT ae.payload_json AS action_json, d.payload_json AS decision_json, o.payload_json AS outcome_json
           FROM action_events ae
           LEFT JOIN decisions d ON d.action_event_id = ae.event_id
           LEFT JOIN outcomes o ON o.action_event_id = ae.event_id
           WHERE ae.trace_id = ?
           ORDER BY ae.ts ASC`,
        )
        .all(traceId) as Array<{ action_json: string; decision_json: string | null; outcome_json: string | null }>;
      return rows.map((r) => ({
        action: JSON.parse(r.action_json) as ActionEvent,
        decision: r.decision_json ? (JSON.parse(r.decision_json) as Decision) : null,
        outcome: r.outcome_json ? (JSON.parse(r.outcome_json) as OutcomeEvent) : null,
      }));
    },
  };

  // --------------------------------------------------------------- budgets

  budgets: Storage["budgets"] = {
    reserveIfUnder: (scopeKey: string, windowKey: string, est: number, limit: number): boolean => {
      return this.runInTransaction((): boolean => {
        const row = this.db
          .prepare("SELECT reserved_usd, settled_usd FROM budget_counters WHERE scope_key = ? AND window_key = ?")
          .get(scopeKey, windowKey) as { reserved_usd: number; settled_usd: number } | undefined;
        const reserved = row?.reserved_usd ?? 0;
        const settled = row?.settled_usd ?? 0;
        if (settled + reserved + est > limit) return false;
        const now = new Date().toISOString();
        if (row) {
          this.db
            .prepare(
              "UPDATE budget_counters SET reserved_usd = reserved_usd + ?, updated_at = ? WHERE scope_key = ? AND window_key = ?",
            )
            .run(est, now, scopeKey, windowKey);
        } else {
          this.db
            .prepare(
              "INSERT INTO budget_counters(scope_key, window_key, reserved_usd, settled_usd, updated_at) VALUES (?, ?, ?, 0, ?)",
            )
            .run(scopeKey, windowKey, est, now);
        }
        return true;
      });
    },

    settle: (scopeKey: string, windowKey: string, est: number, actual: number): void => {
      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE budget_counters
           SET reserved_usd = MAX(0, reserved_usd - ?), settled_usd = settled_usd + ?, updated_at = ?
           WHERE scope_key = ? AND window_key = ?`,
        )
        .run(est, actual, now, scopeKey, windowKey);
    },

    getUsage: (scopeKey: string, windowKey: string): BudgetUsage => {
      const row = this.db
        .prepare("SELECT reserved_usd, settled_usd FROM budget_counters WHERE scope_key = ? AND window_key = ?")
        .get(scopeKey, windowKey) as { reserved_usd: number; settled_usd: number } | undefined;
      return { reservedUsd: row?.reserved_usd ?? 0, settledUsd: row?.settled_usd ?? 0 };
    },

    gc: (olderThanMs: number): void => {
      const cutoff = new Date(Date.now() - olderThanMs).toISOString();
      this.db.prepare("UPDATE budget_counters SET reserved_usd = 0 WHERE updated_at < ? AND reserved_usd > 0").run(cutoff);
    },
  };

  // -------------------------------------------------------------------- kv

  kv: Storage["kv"] = {
    get: (ns: string, key: string): string | null => {
      const row = this.db
        .prepare("SELECT v, expires_at FROM plugin_kv WHERE ns = ? AND k = ?")
        .get(ns, key) as { v: string; expires_at: string | null } | undefined;
      if (!row) return null;
      if (row.expires_at && row.expires_at < new Date().toISOString()) {
        this.db.prepare("DELETE FROM plugin_kv WHERE ns = ? AND k = ?").run(ns, key);
        return null;
      }
      return row.v;
    },

    set: (ns: string, key: string, value: string, ttlMs?: number): void => {
      const expiresAt = ttlMs !== undefined ? new Date(Date.now() + ttlMs).toISOString() : null;
      this.db
        .prepare(
          `INSERT INTO plugin_kv(ns, k, v, expires_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(ns, k) DO UPDATE SET v = excluded.v, expires_at = excluded.expires_at`,
        )
        .run(ns, key, value, expiresAt);
    },

    incr: (ns: string, key: string, by: number, ttlMs?: number): number => {
      return this.runInTransaction((): number => {
        const current = this.kv.get(ns, key);
        const next = (current ? Number(current) : 0) + by;
        this.kv.set(ns, key, String(next), ttlMs);
        return next;
      });
    },

    delete: (ns: string, key: string): void => {
      this.db.prepare("DELETE FROM plugin_kv WHERE ns = ? AND k = ?").run(ns, key);
    },
  };

  // -------------------------------------------------------------- registry

  workspaces: Storage["workspaces"] = {
    create: (row: WorkspaceRow): void => {
      this.db
        .prepare("INSERT INTO workspaces(id, name, created_at) VALUES (?, ?, ?)")
        .run(row.id, row.name, row.createdAt);
    },
    get: (id: string): WorkspaceRow | null => {
      const row = this.db.prepare("SELECT id, name, created_at FROM workspaces WHERE id = ?").get(id) as
        | { id: string; name: string; created_at: string }
        | undefined;
      return row ? { id: row.id, name: row.name, createdAt: row.created_at } : null;
    },
    getByName: (name: string): WorkspaceRow | null => {
      const row = this.db.prepare("SELECT id, name, created_at FROM workspaces WHERE name = ?").get(name) as
        | { id: string; name: string; created_at: string }
        | undefined;
      return row ? { id: row.id, name: row.name, createdAt: row.created_at } : null;
    },
    list: (): WorkspaceRow[] => {
      const rows = this.db.prepare("SELECT id, name, created_at FROM workspaces ORDER BY created_at ASC").all() as Array<{
        id: string;
        name: string;
        created_at: string;
      }>;
      return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
    },
  };

  agents: Storage["agents"] = {
    create: (row: AgentRow): void => {
      this.db
        .prepare("INSERT INTO agents(id, workspace_id, name, created_at, disabled) VALUES (?, ?, ?, ?, ?)")
        .run(row.id, row.workspaceId, row.name, row.createdAt, row.disabled ? 1 : 0);
    },
    get: (id: string): AgentRow | null => {
      const row = this.db
        .prepare("SELECT id, workspace_id, name, created_at, disabled FROM agents WHERE id = ?")
        .get(id) as { id: string; workspace_id: string; name: string; created_at: string; disabled: number } | undefined;
      return row
        ? { id: row.id, workspaceId: row.workspace_id, name: row.name, createdAt: row.created_at, disabled: !!row.disabled }
        : null;
    },
    getByName: (workspaceId: string, name: string): AgentRow | null => {
      const row = this.db
        .prepare("SELECT id, workspace_id, name, created_at, disabled FROM agents WHERE workspace_id = ? AND name = ?")
        .get(workspaceId, name) as
        | { id: string; workspace_id: string; name: string; created_at: string; disabled: number }
        | undefined;
      return row
        ? { id: row.id, workspaceId: row.workspace_id, name: row.name, createdAt: row.created_at, disabled: !!row.disabled }
        : null;
    },
    list: (workspaceId?: string): AgentRow[] => {
      const rows = (
        workspaceId
          ? this.db
              .prepare("SELECT id, workspace_id, name, created_at, disabled FROM agents WHERE workspace_id = ? ORDER BY created_at ASC")
              .all(workspaceId)
          : this.db.prepare("SELECT id, workspace_id, name, created_at, disabled FROM agents ORDER BY created_at ASC").all()
      ) as Array<{ id: string; workspace_id: string; name: string; created_at: string; disabled: number }>;
      return rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspace_id,
        name: r.name,
        createdAt: r.created_at,
        disabled: !!r.disabled,
      }));
    },
  };

  agentKeys: Storage["agentKeys"] = {
    create: (row: AgentKeyRow): void => {
      this.db
        .prepare(
          "INSERT INTO agent_keys(id, agent_id, key_hash, prefix, created_at, revoked_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(row.id, row.agentId, row.keyHash, row.prefix, row.createdAt, row.revokedAt, row.lastUsedAt);
    },
    getByHash: (keyHash: string): AgentKeyRow | null => {
      const row = this.db
        .prepare(
          "SELECT id, agent_id, key_hash, prefix, created_at, revoked_at, last_used_at FROM agent_keys WHERE key_hash = ?",
        )
        .get(keyHash) as
        | {
            id: string;
            agent_id: string;
            key_hash: string;
            prefix: string;
            created_at: string;
            revoked_at: string | null;
            last_used_at: string | null;
          }
        | undefined;
      return row
        ? {
            id: row.id,
            agentId: row.agent_id,
            keyHash: row.key_hash,
            prefix: row.prefix,
            createdAt: row.created_at,
            revokedAt: row.revoked_at,
            lastUsedAt: row.last_used_at,
          }
        : null;
    },
    revoke: (id: string): void => {
      this.db.prepare("UPDATE agent_keys SET revoked_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    },
    touchLastUsed: (id: string, at: string): void => {
      this.db.prepare("UPDATE agent_keys SET last_used_at = ? WHERE id = ?").run(at, id);
    },
    listForAgent: (agentId: string): AgentKeyRow[] => {
      const rows = this.db
        .prepare(
          "SELECT id, agent_id, key_hash, prefix, created_at, revoked_at, last_used_at FROM agent_keys WHERE agent_id = ? ORDER BY created_at ASC",
        )
        .all(agentId) as Array<{
        id: string;
        agent_id: string;
        key_hash: string;
        prefix: string;
        created_at: string;
        revoked_at: string | null;
        last_used_at: string | null;
      }>;
      return rows.map((r) => ({
        id: r.id,
        agentId: r.agent_id,
        keyHash: r.key_hash,
        prefix: r.prefix,
        createdAt: r.created_at,
        revokedAt: r.revoked_at,
        lastUsedAt: r.last_used_at,
      }));
    },
  };

  upstreams: Storage["upstreams"] = {
    upsert: (row: UpstreamRow): void => {
      this.db
        .prepare(
          `INSERT INTO upstreams(name, kind, base_url, credential_id) VALUES (?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET kind = excluded.kind, base_url = excluded.base_url, credential_id = excluded.credential_id`,
        )
        .run(row.name, row.kind, row.baseUrl, row.credentialId);
    },
    get: (name: string): UpstreamRow | null => {
      const row = this.db.prepare("SELECT name, kind, base_url, credential_id FROM upstreams WHERE name = ?").get(name) as
        | { name: string; kind: string; base_url: string; credential_id: string | null }
        | undefined;
      return row ? { name: row.name, kind: row.kind, baseUrl: row.base_url, credentialId: row.credential_id } : null;
    },
    list: (): UpstreamRow[] => {
      const rows = this.db.prepare("SELECT name, kind, base_url, credential_id FROM upstreams").all() as Array<{
        name: string;
        kind: string;
        base_url: string;
        credential_id: string | null;
      }>;
      return rows.map((r) => ({ name: r.name, kind: r.kind, baseUrl: r.base_url, credentialId: r.credential_id }));
    },
  };

  credentials: Storage["credentials"] = {
    create: (row: CredentialRow): void => {
      this.db
        .prepare("INSERT INTO credentials(id, label, ciphertext, created_at) VALUES (?, ?, ?, ?)")
        .run(row.id, row.label, row.ciphertext, row.createdAt);
    },
    get: (id: string): CredentialRow | null => {
      const row = this.db.prepare("SELECT id, label, ciphertext, created_at FROM credentials WHERE id = ?").get(id) as
        | { id: string; label: string | null; ciphertext: Uint8Array; created_at: string }
        | undefined;
      return row
        ? { id: row.id, label: row.label, ciphertext: Buffer.from(row.ciphertext), createdAt: row.created_at }
        : null;
    },
  };
}
