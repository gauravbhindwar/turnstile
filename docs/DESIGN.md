# Turnstile — Design

This is the public design reference for Turnstile: the architecture, the
decisions that are locked for the v0.x series, and the milestone plan.
Contributors should read this before opening a PR that touches architecture.

## Vision

**Kong for AI agents.** A drop-in, self-hosted gateway that any AI agent's
traffic flows through, giving the operator real-time policy enforcement
(spend caps, allowlists, human-in-the-loop approval) and a cryptographically
verifiable audit ledger of everything the agent did — from a single choke
point.

**Why:** agents now hold credentials, spend money, send emails, and call
tools. The operational risks concentrate in over-broad scopes, token theft,
prompt-injection coercing agents into misusing legitimate scopes, and the
attribution problem ("was that the agent or the human?"). Turnstile
addresses all four from one place instead of scattering controls across
every tool integration.

**Model-agnostic, non-negotiable:** the core never imports a model vendor
SDK. All vendor awareness lives in adapters and the price sheet. Turnstile
works identically with OpenAI, Anthropic, Google, Mistral, Groq, OpenRouter,
Ollama, vLLM, LM Studio, or any OpenAI-compatible endpoint.

## Goals / non-goals (v0.x)

**In scope:** one-command install; policy enforcement before the action
reaches the upstream; an append-only hash-chained ledger; a live dashboard;
human-in-the-loop approvals; policies as declarative, hot-reloadable YAML; a
plugin interface for third-party policy plugins; MCP tool traffic, not just
model calls; p50 added latency < 15 ms.

**Explicitly out of scope for v0.x:** a hosted multi-tenant SaaS control
plane; SSO/RBAC beyond a single admin token + agent keys; model
routing/load-balancing (point Turnstile at a router like LiteLLM if you want
that); prompt evaluation/RAG/vector DB; end-user billing; a Kubernetes
operator; non-HTTP upstream protocols.

## Locked architectural decisions

These are settled for the v0.x series — a PR proposing to revisit one needs
an ADR under `docs/decisions/` explaining why.

| Area | Choice | Why |
|---|---|---|
| Core language | TypeScript, Node.js ≥ 20, strict mode | Large plugin-author pool; adequate perf for a control-plane workload |
| HTTP framework | Fastify 4.x | Fast; schema validation built in |
| Monorepo tooling | pnpm workspaces + Turborepo | Standard, fast, simple |
| Storage (v0.1) | SQLite via `better-sqlite3` (WAL) | Zero-dependency install; single-file backup |
| Storage (v0.2+) | PostgreSQL 15+ behind the same `Storage` interface | Production deployments; interface is written first so this is a swap |
| Dashboard | React 18 + Vite + Tailwind, served statically by the gateway | One process, one port |
| Realtime to dashboard | Server-Sent Events | Simpler than WebSockets; one-directional is enough |
| Policy language | Declarative YAML, built-in engine, no embedded scripting | Safety + install-weight simplicity |
| Hash chain | SHA-256 per-event chaining + Ed25519-signed periodic checkpoints | Tamper-evidence without blockchain theater |
| Fail mode | Fail-closed for `spend`/`mutate`, fail-open (buffered) for `read`, both overridable | Security by default without bricking read-only agents |
| License | Apache-2.0, whole repo | Max adoption |
| Config | YAML + `${VAR}` interpolation + `TURNSTILE_*` env overrides, hot-reload via file watch | GitOps-friendly |
| IDs | UUIDv7 everywhere | Ledger ordering + index locality |
| Streaming | Full SSE passthrough; usage metered from the final chunk or a post-hoc tokenizer fallback | Agents rely on streaming |

## Architecture

```
                                   ┌─────────────────────────────────────────┐
                                   │               TURNSTILE                 │
                                   │            (single process)             │
   ┌──────────┐   OpenAI-dialect   │  ┌───────────┐   ┌──────────────────┐   │      ┌─────────────────┐
   │  Agent A │──/v1/chat/...─────▶│  │  OpenAI   │   │                  │   │      │ api.openai.com  │
   └──────────┘                    │  │  Adapter  │──▶│                  │──────────▶ api.anthropic…  │
   ┌──────────┐   MCP (HTTP)       │  ├───────────┤   │   CORE PIPELINE  │   │      │ localhost:11434 │
   │  Agent B │──/mcp/{server}────▶│  │    MCP    │──▶│                  │──────────▶ (any upstream)  │
   └──────────┘                    │  │   Proxy   │   │  1 normalize     │   │      └─────────────────┘
   ┌──────────┐   SDK / REST       │  ├───────────┤   │  2 authenticate  │   │
   │  Agent C │──/actions/execute─▶│  │  Action   │──▶│  3 policy eval   │   │      ┌─────────────────┐
   └──────────┘                    │  │    API    │   │  4 execute/block │──────────▶ Slack webhook   │
                                   │  └───────────┘   │  5 meter spend   │   │      │ (approvals)     │
   ┌──────────┐   HTTP(S) proxy    │  ┌───────────┐   │  6 ledger append │   │      └─────────────────┘
   │  Agent D │──CONNECT/absolute─▶│  │  Forward  │──▶│  7 emit SSE      │   │
   └──────────┘                    │  │   Proxy   │   └────────┬─────────┘   │
                                   │  └───────────┘            │             │
                                   │  ┌─────────────────┐      ▼             │
   ┌──────────┐    HTTP + SSE      │  │  Admin API +    │  ┌────────┐        │
   │ Operator │◀──────────────────▶│  │  Dashboard      │  │ Ledger │        │
   │ (browser)│                    │  │  (React, SSE)   │  │(SQLite)│        │
   └──────────┘                    │  └─────────────────┘  └────────┘        │
                                   └─────────────────────────────────────────┘
```

Every action goes through the same seven stages, regardless of adapter:

1. **Normalize** — the adapter translates the wire format into an
   `ActionEvent` (`packages/core/src/types/action.ts`). Core code only ever
   sees this normalized shape.
2. **Authenticate** — resolve the Turnstile agent key to a `Principal`
   (agent identity + workspace).
3. **Policy evaluation** — run matching policy plugins in deterministic
   order. Outcome: `ALLOW | DENY | ESCALATE | TRANSFORM`.
4. **Execute** — forward to the upstream with vendor credentials injected
   from the credential vault (the agent never holds real vendor keys), deny
   with a structured error, or park for human approval.
5. **Meter** — compute cost from usage + the price sheet; update budget
   counters atomically (reserve-then-settle).
6. **Ledger append** — write the request/decision/response events,
   hash-chained.
7. **Emit** — push redacted event summaries to the dashboard's SSE bus.

Stages 1–4 are on the hot path (a latency budget applies); stages 5–7 for
the response side complete asynchronously but must be durably queued before
the response reaches the agent.

Repository layout, storage schema, admin API surface, and the full policy
plugin catalog are documented as each milestone lands them — see the
package `README.md` files and `docs/decisions/` for the reasoning behind
choices not covered here.

## Milestones

- **M0 — Skeleton.** Monorepo scaffold, config system, logging, `/healthz`,
  CI, Docker. *(done)*
- **M1 — The Magic Moment.** OpenAI adapter (streaming), credential vault,
  `spend_cap` + `allowlist` policy plugins, SQLite storage + hash-chained
  ledger with checkpoints, metering, admin API subset, dashboard (Live +
  Agents + Budgets), CLI (`keys`, `verify-ledger`). *(in progress)*
- **M2 — Control.** Human-in-the-loop approvals end-to-end + Slack, more
  policy plugins (`rate_limit`, `require_approval`, `token_guard`), the
  generic Action API + TS/Python SDKs, Postgres storage.
- **M3 — Reach.** MCP proxy + `mcp_tool_guard`, `redact_pii` +
  `time_window`, session replay with diff view, ledger export/retention.
- **M4 — Hardening & launch.** Forward proxy, stdio MCP wrapper, metrics,
  auth-matrix + SSRF tests, production checklist.

## Security model

See [`docs/security/threat-model.md`](./security/threat-model.md) for the
full threat model (assets, adversaries, controls by milestone).
