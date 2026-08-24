# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); versioning follows
[SemVer](https://semver.org/).

## [Unreleased]

### Added

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
- CI: lint, typecheck, unit tests (Node 20/22 matrix), Docker build.
