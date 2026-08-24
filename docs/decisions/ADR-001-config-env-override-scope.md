# ADR-001: Scope of `TURNSTILE_*` env var config overrides

## Status

Accepted (M0).

## Context

§16 states config precedence as "defaults < `turnstile.yaml` < env `TURNSTILE_*`"
but the only concrete env var named anywhere in §16 is `TURNSTILE_CONFIG` (the
file path). Every other example in the spec's sample config
(`admin.token: ${TURNSTILE_ADMIN_TOKEN}`, `approvals.slack_webhook_url:
${SLACK_WEBHOOK_URL}`) already goes through `${VAR}` interpolation inside the
YAML, not a generic `TURNSTILE_<DOTTED_PATH>` → config-field mapping.

## Decision

For M0, "env `TURNSTILE_*` overrides" is implemented as:

1. `TURNSTILE_CONFIG` selects the config file path.
2. Per-field overrides happen exclusively through `${VAR}` interpolation
   inside `turnstile.yaml` (`packages/core/src/config/interpolate.ts`), resolved
   from `process.env` before Zod validation.

A generic `TURNSTILE_SERVER_PORT`-style dotted-path override mapping was
considered and rejected for M0: it adds a second, undocumented-in-the-spec
override mechanism that can silently fight with the YAML value, for a use
case (`${VAR}` in YAML) the spec's own examples already cover.

## Revisit when

A milestone needs to override config in an environment where editing
`turnstile.yaml` isn't practical (e.g., a container image baked from a fixed
YAML). If that need materializes, add explicit, documented env vars one at a
time rather than a generic dotted-path mapper.
