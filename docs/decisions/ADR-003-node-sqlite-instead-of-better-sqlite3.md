# ADR-003: `node:sqlite` instead of `better-sqlite3`

## Status

Accepted (M1).

## Context

D4 (locked decision) specifies `better-sqlite3` for v0.1 storage. `better-sqlite3`
is a native addon — it needs either a prebuilt binary matching the exact
Node ABI/platform, or a C++ toolchain to compile from source. In this
project's primary dev environment there is no C++ build toolchain
available, and the Node version in use has no published prebuilt binary for
`better-sqlite3`, so `pnpm install` fails at the native build step.

Node has shipped a built-in `node:sqlite` module (`DatabaseSync`) since
Node 22.5, stable and requiring no native compilation or extra dependency —
it ships with the runtime. D1 already requires Node ≥ 20 for the app in
general, and this project's Docker build stage already needed Node ≥ 22.13
for pnpm's own CLI (ADR notes in `docker/Dockerfile`), so requiring Node ≥
22 at runtime too is a small, consistent bump rather than a new constraint.

## Decision

`packages/core/src/storage/sqlite.ts` implements the `Storage` interface
(§13.1, unchanged) using `node:sqlite`'s `DatabaseSync` instead of
`better-sqlite3`. Practical differences absorbed inside this one file:

- No `.pragma()` helper — pragmas run via `.exec("PRAGMA ...")`.
- No `.transaction()` helper — wrapped manually with
  `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` (see `runInTransaction`).
- BLOB columns come back as `Uint8Array`, not `Buffer` — wrapped with
  `Buffer.from()` at the one read site that needs it (`credentials.get`).

The `docker/Dockerfile` runtime stage moves from
`gcr.io/distroless/nodejs20-debian12` to `gcr.io/distroless/nodejs22-debian12`
to match.

Nothing outside `sqlite.ts` changed: the `Storage` interface, migrations,
and every caller are unaware of which SQLite binding is underneath — a
future swap to Postgres (D5) or back to `better-sqlite3` on a machine that
can build it stays a drop-in replacement of this one file.

## Revisit when

Deploying to an environment where `better-sqlite3`'s extra maturity/perf
matters and native builds (or matching prebuilds) are available — swap
`sqlite.ts`'s internals back, the interface doesn't need to change.
