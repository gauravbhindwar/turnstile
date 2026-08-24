# ADR-002: Default `server.host` is `127.0.0.1`, not `0.0.0.0`

## Status

Accepted (M0).

## Context

§16's sample config shows `host: 0.0.0.0` as the implied default, but §17.3
requires Turnstile to refuse to boot on a non-loopback host without TLS unless
`i_understand_http: true` is set. If the schema default were `0.0.0.0`, a
completely fresh `turnstile start` with no config customization would refuse to
boot — contradicting G1 ("one-command install... one env-var adoption").

## Decision

`server.host` defaults to `127.0.0.1` in the Zod schema
(`packages/core/src/config/schema.ts`). Operators who need Turnstile reachable
from outside the host (Docker port publishing, a real multi-host deployment)
opt in explicitly by setting `host: 0.0.0.0` and either `server.tls` or
`i_understand_http: true` — which is exactly what
`docker/turnstile.docker.yaml` does for the bundled `docker-compose.yml`,
with a comment explaining why it's safe there (the operator already chose to
publish the port).

## Revisit when

`server.tls` is implemented (M2+ likely) — at that point the Docker default
should switch to real TLS instead of `i_understand_http: true`.
