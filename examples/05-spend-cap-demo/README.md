# 05 — Spend cap demo

The "magic moment" from the README: point an agent at Turnstile, give it a
tiny spend cap, and watch a runaway loop get blocked live.

## What's here

- `fake-upstream.mjs` — a minimal OpenAI-compatible server that returns a
  canned completion with fixed usage (20 prompt / 200 completion tokens),
  so the demo needs no real API key.
- `policies/spend-cap.yaml` — a `spend_cap` policy for agent `demo-bot`,
  capped at **$0.01/day** (deliberately tiny — each fake call costs about
  $0.002 at the bundled default price sheet, so the cap bites within ~5
  calls).
- `turnstile.yaml` — routes model `fake-model` to the fake upstream.
- `run.sh` — runs the whole thing end to end.

## Run it

```bash
pnpm build   # from the repo root, once
cd examples/05-spend-cap-demo
./run.sh
```

Expected output: a handful of `HTTP 200` calls, then `HTTP 403` with a
`TURNSTILE_POLICY_BLOCK` error body naming the policy and the reason, then
`turnstile verify-ledger` confirming every one of those calls (allowed and
blocked) is durably recorded in the tamper-evident ledger.

## Watching it live

While `run.sh` is running, open a second terminal and hit the SSE stream:

```bash
curl -N http://localhost:8787/admin/v1/events/stream \
  -H "Authorization: Bearer $TURNSTILE_ADMIN_TOKEN"
```

You'll see `action` and `decision` events land in real time — the same
feed the dashboard's Live page consumes — including the `outcome: "deny"`
decision the moment the cap bites.
