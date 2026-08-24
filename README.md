# Turnstile

**Kong for AI agents.** A drop-in, self-hosted gateway that your agent's traffic
flows through — real-time policy enforcement (spend caps, allowlists, human
approval) and a cryptographically verifiable audit ledger of everything the
agent did, from a single choke point.

> **Status: pre-alpha (Milestone 0 — skeleton).** The config system, logging,
> and `/healthz` are live; the policy engine, ledger, and dashboard land in
> Milestone 1. Nothing here is ready for production traffic yet. Follow
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
metered → ledgered → streamed to the dashboard. See §4 of the spec for the
full seven-stage pipeline.

## Quickstart (developer setup, M0)

```bash
pnpm install
cp turnstile.example.yaml turnstile.yaml
export TURNSTILE_ADMIN_TOKEN=$(openssl rand -hex 16)
pnpm --filter @turnstile/gateway build
pnpm --filter @turnstile/cli build
node packages/cli/dist/index.js start
curl http://localhost:8787/healthz
```

The one-command `docker run` / `npx turnstile start` flow, and the "point your
agent at Turnstile and watch a spend cap block it live" demo, ship in
Milestone 1 (v0.1.0).

## Feature status

| Feature | Status |
|---|---|
| Config system (YAML + `${VAR}` + hot-reload) | ✅ M0 |
| `/healthz` | ✅ M0 |
| OpenAI-compatible adapter + credential vault | 🔜 M1 |
| Policy engine (`spend_cap`, `allowlist`) | 🔜 M1 |
| Hash-chained ledger + checkpoints | 🔜 M1 |
| Dashboard (Live, Agents, Budgets) | 🔜 M1 |
| Human-in-the-loop approvals + Slack | 🔜 M2 |
| MCP proxy + `mcp_tool_guard` | 🔜 M3 |
| Forward proxy (domain policies) | 🔜 M4 |

## Security model (honest limitations)

- Vendor API keys never touch the agent — Turnstile injects them from an
  encrypted credential vault. See §17.
- The ledger is tamper-evident (SHA-256 chain + Ed25519-signed checkpoints),
  not tamper-proof against root on the host.
- `CONNECT` (TLS) traffic through the forward proxy is logged by domain and
  byte count only — Turnstile does not MITM by default.
- Local policy plugins run in-process and are trusted code.
- Single-node only in v0.x — SQLite is a single writer.

## License

Apache-2.0. See [LICENSE](./LICENSE).
