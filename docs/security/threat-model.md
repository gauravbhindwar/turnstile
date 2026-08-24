# Threat Model

Mirrors §17 of [AGENT_GATEWAY_SPEC.md](../../AGENT_GATEWAY_SPEC.md). Update
this file whenever §17 changes or a new milestone adds attack surface.

## Assets

Vendor API keys; the ledger's integrity; agent keys; the admin token;
(optionally) message contents; the master key.

## Adversaries considered

- **A1** — malfunctioning or prompt-injected agent attempting costly or
  destructive actions. **Primary threat.**
- **A2** — network attacker on the same LAN.
- **A3** — curious insider with dashboard read access.
- **A4** — attacker with read access to the database file, attempting to
  forge history.
- **A5** — malicious third-party policy plugin.

**Out of scope for v0.x:** root on the host, side channels, supply-chain
attacks beyond lockfile pinning + provenance builds.

## Controls implemented so far (M0)

- Boot refuses to start on a non-loopback host without TLS unless
  `i_understand_http: true` is set (`packages/core/src/config/loader.ts`).
- Structured logger redacts common secret-shaped fields
  (`packages/core/src/logging/logger.ts`).
- Config validated with Zod at the file boundary; invalid config never
  partially applies (last-good is kept on hot-reload failure).

## Controls planned (M1+)

See §17.3 of the spec: credential vault (AES-256-GCM), hashed agent keys,
SSRF containment for the forward proxy, ledger anti-tamper via Ed25519
checkpoints, admin/data-plane auth separation.
