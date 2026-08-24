# Contributing to Turnstile

Turnstile is Apache-2.0 and accepts contributions under the [Developer Certificate
of Origin](https://developercertificate.org/) (DCO) — no CLA. Sign off every
commit:

```bash
git commit -s -m "..."
```

## Development setup

```bash
pnpm install
pnpm build
pnpm test
```

## Ground rules

- Never violate a Locked Architectural Decision (§3 of
  [AGENT_GATEWAY_SPEC.md](./AGENT_GATEWAY_SPEC.md)) or build a listed Non-Goal
  (§2) without first opening an issue to discuss it.
- Work milestone by milestone (§24); if the spec is ambiguous, pick the
  simplest option consistent with §3 and record the choice in
  `docs/decisions/ADR-NNN.md`.
- Every PR: typecheck, lint, and tests green; update `CHANGELOG.md` under
  `[Unreleased]`.
- All external input is validated with Zod at package boundaries.
- No new runtime dependency without an ADR justifying it.
- No secrets in logs — run the secret-scrubbing log test before closing a
  milestone.

## Reporting security issues

Do not open a public issue. See [SECURITY.md](./SECURITY.md).
