# Security Policy

Turnstile sits in the path of agent traffic and vendor credentials, so we treat
security reports seriously and ask you to report privately first.

## Reporting a vulnerability

Email **security@turnstile.example** (placeholder — update before public launch)
with:

- A description of the issue and its impact.
- Steps to reproduce, or a PoC if available.
- Affected version/commit.

We aim to acknowledge within 3 business days and to ship a fix or mitigation
within 90 days, whichever is faster. Please do not open a public GitHub issue
for undisclosed vulnerabilities.

## Scope

See the threat model in
[docs/security/threat-model.md](./docs/security/threat-model.md) (mirrors §17
of [AGENT_GATEWAY_SPEC.md](./AGENT_GATEWAY_SPEC.md)) for the adversaries and
assets Turnstile's design considers in scope.

## Supported versions

Pre-1.0: only the latest tagged release receives security fixes.
