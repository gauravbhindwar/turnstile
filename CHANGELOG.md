# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); versioning follows
[SemVer](https://semver.org/).

## [Unreleased]

### Added

- **M1 — dashboard**: React + Vite + Tailwind admin UI at `/app` — Live
  (SSE event stream + exchange detail drawer), Agents (create + one-time
  key reveal), Budgets (scope/window usage lookup).
- **M1 — CLI**: `turnstile keys create/revoke/list`, `turnstile verify-ledger`.
- **M1 — gateway**: `POST /v1/chat/completions` (streaming + non-streaming,
  full SSE passthrough, usage-based metering) and `GET /v1/models`; agent-key
  (`trn_...`) and admin-token auth; admin API (health, stats, events +
  `events/stream` SSE, agents/keys, upstreams + credentials, ledger
  head/verify, budgets, prices, policies).
- **M1 — core**: `Storage` interface + `node:sqlite` implementation; RFC 8785
  canonical JSON + SHA-256 hash-chained ledger + Ed25519-signed checkpoints +
  `verifyLedger` (flip-one-byte tamper detection); price sheet + cost calc +
  reserve-then-settle budget counters; AES-256-GCM credential vault + hashed
  agent keys; policy engine (§8.4 combination semantics) with built-in
  `spend_cap` and `allowlist` plugins; seven-stage `Pipeline` orchestrator;
  in-process `EventBus` for the dashboard's SSE feed.
- `examples/05-spend-cap-demo`: a runnable end-to-end proof — a fake
  OpenAI-compatible upstream, a $0.01/day spend cap, and a script that
  hammers the gateway until the cap blocks it.
- Monorepo scaffold (pnpm workspaces + Turborepo), `@turnstile/core`,
  `@turnstile/gateway`, `@turnstile/cli` packages.
- `ActionEvent`/`Decision`/`OutcomeEvent` types + Zod schemas (§6).
- Config system: YAML + `${VAR}` interpolation + Zod validation + hot-reload
  file watcher (§16).
- Boot-time security gate refusing non-loopback hosts without TLS (§17.3).
- Secret-scrubbing structured logger (pino).
- `GET /healthz` liveness route.
- `turnstile init` / `turnstile start` CLI commands.
- Dockerfile (multi-stage, distroless) + docker-compose.yml.
- CI: lint, typecheck, unit tests (Node 22/24 matrix), Docker build.

### Changed

- Node floor bumped to `>=22.5.0` (was `>=20`) for `node:sqlite` (ADR-003).
