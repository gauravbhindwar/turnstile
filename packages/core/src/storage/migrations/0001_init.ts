// Numbered SQL migration, applied at boot (§13.2). Kept as a TS string
// constant (not a .sql asset file) so it survives the tsc build untouched.
export const MIGRATION_0001_INIT = `
CREATE TABLE workspaces(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE agents(
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  UNIQUE(workspace_id, name)
);

CREATE TABLE agent_keys(
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX ix_agent_keys_agent ON agent_keys(agent_id);

CREATE TABLE credentials(
  id TEXT PRIMARY KEY,
  label TEXT,
  ciphertext BLOB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE upstreams(
  name TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  base_url TEXT NOT NULL,
  credential_id TEXT REFERENCES credentials(id)
);

CREATE TABLE action_events(
  event_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  session_id TEXT,
  ts TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  action_class TEXT NOT NULL,
  upstream TEXT,
  target TEXT,
  payload_json TEXT NOT NULL
);
CREATE INDEX ix_ae_ts ON action_events(ts);
CREATE INDEX ix_ae_trace ON action_events(trace_id);
CREATE INDEX ix_ae_agent_ts ON action_events(agent_id, ts);

CREATE TABLE decisions(
  event_id TEXT PRIMARY KEY,
  action_event_id TEXT NOT NULL REFERENCES action_events(event_id),
  ts TEXT NOT NULL,
  outcome TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX ix_decisions_action ON decisions(action_event_id);

CREATE TABLE outcomes(
  event_id TEXT PRIMARY KEY,
  action_event_id TEXT NOT NULL REFERENCES action_events(event_id),
  ts TEXT NOT NULL,
  status TEXT NOT NULL,
  cost_usd REAL,
  latency_ms INTEGER,
  payload_json TEXT NOT NULL
);
CREATE INDEX ix_outcomes_action ON outcomes(action_event_id);

CREATE TABLE ledger(
  seq INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT,
  payload_sha256 TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  chain_hash TEXT NOT NULL
);
CREATE INDEX ix_ledger_event ON ledger(event_id);

CREATE TABLE approvals(
  id TEXT PRIMARY KEY,
  action_event_id TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  note TEXT
);
CREATE INDEX ix_approvals_status ON approvals(status);

CREATE TABLE budget_counters(
  scope_key TEXT NOT NULL,
  window_key TEXT NOT NULL,
  reserved_usd REAL NOT NULL DEFAULT 0,
  settled_usd REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope_key, window_key)
);

CREATE TABLE plugin_kv(
  ns TEXT NOT NULL,
  k TEXT NOT NULL,
  v TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY(ns, k)
);

CREATE TABLE schema_migrations(
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`;
