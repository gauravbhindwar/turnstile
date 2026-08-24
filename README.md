# Turnstile

**Kong for AI agents.** A drop-in, self-hosted gateway that your agent's traffic
flows through — real-time policy enforcement (spend caps, allowlists, human
approval) and a cryptographically verifiable audit ledger of everything the
agent did, from a single choke point.

> **Status: alpha (Milestone 1 in progress).** The OpenAI-compatible adapter,
> credential vault, policy engine (`spend_cap` + `allowlist`), hash-chained
> ledger, admin API, and dashboard (Live/Agents/Budgets) all work end to end —
> see [examples/05-spend-cap-demo](./examples/05-spend-cap-demo). Approvals,
> MCP, and the forward proxy land in later milestones. Follow
> [docs/DESIGN.md](./docs/DESIGN.md) for the full plan.

## Why

Agents now hold credentials, spend money, send emails, and call tools. Turnstile
sits between your agent and the outside world so you can see what it did,
cap what it can spend, and require a human to sign off on anything risky —
without trusting the agent (or the prompt it read) to police itself.

## How it works

```
Agent ──(OpenAI-dialect / MCP / SDK / HTTP proxy)──▶ Turnstile ──▶ Upstream
                                                        │
                                              policy engine + ledger
                                                        │
                                                    Dashboard (SSE)
```

Every action is normalized → authenticated → policy-evaluated → executed →
metered → ledgered → streamed to the dashboard. See
[docs/DESIGN.md](./docs/DESIGN.md) for the full seven-stage pipeline.

## Quickstart

```bash
pnpm install
pnpm build
pnpm --filter @turnstile/dashboard build   # optional: adds the web UI at /app

cp turnstile.example.yaml turnstile.yaml
export TURNSTILE_ADMIN_TOKEN=$(openssl rand -hex 16)

node packages/cli/dist/index.js keys create my-agent   # prints a trn_... key, shown once
node packages/cli/dist/index.js start &

curl http://localhost:8787/healthz
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer <the trn_... key>" \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'
```

To see a spend cap actually block a runaway agent — live, on the
dashboard — run [examples/05-spend-cap-demo](./examples/05-spend-cap-demo):
it spins up a fake OpenAI-compatible upstream, sets a $0.01/day cap, and
hammers `/v1/chat/completions` until Turnstile says no.

## Feature status

| Feature | Status |
|---|---|
| Config system (YAML + `${VAR}` + hot-reload) | ✅ M0 |
| `/healthz` | ✅ M0 |
| OpenAI-compatible adapter (streaming + non-streaming) + credential vault | ✅ M1 |
| Policy engine (`spend_cap`, `allowlist`) | ✅ M1 |
| Hash-chained ledger + Ed25519 checkpoints + `verify-ledger` | ✅ M1 |
| Admin API (agents/keys, upstreams, events, SSE stream, budgets, ledger) | ✅ M1 |
| Dashboard (Live, Agents, Budgets) | ✅ M1 |
| Human-in-the-loop approvals + Slack | 🔜 M2 |
| MCP proxy + `mcp_tool_guard` | 🔜 M3 |
| Forward proxy (domain policies) | 🔜 M4 |

## Security model (honest limitations)

- Vendor API keys never touch the agent — Turnstile injects them from an
  encrypted credential vault (AES-256-GCM).
- The ledger is tamper-evident (SHA-256 chain + Ed25519-signed checkpoints),
  not tamper-proof against root on the host.
- `CONNECT` (TLS) traffic through the forward proxy is logged by domain and
  byte count only — Turnstile does not MITM by default.
- Local policy plugins run in-process and are trusted code.
- Single-node only in v0.x — SQLite is a single writer.
- Storage uses Node's built-in `node:sqlite` rather than `better-sqlite3`
  (ADR-003) — same on-disk SQLite file, no native build step required.

## License

Apache-2.0. See [LICENSE](./LICENSE).
