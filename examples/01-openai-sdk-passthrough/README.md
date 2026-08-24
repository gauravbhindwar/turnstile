# 01 — OpenAI SDK passthrough

The unmodified `openai` npm SDK, pointed at Turnstile instead of
`api.openai.com`. Only `baseURL` and `apiKey` change; everything else about
the SDK call is identical.

```bash
export OPENAI_API_KEY=sk-...       # a real key — Turnstile injects it, your code never sees it
pnpm build                          # from the repo root, once
cd examples/01-openai-sdk-passthrough
./run.sh
```

What happens:

1. `turnstile keys create sdk-demo-bot` issues a `trn_...` key.
2. The gateway starts, with `policies/allow-gpt-models.yaml` restricting
   this instance to `gpt-*` models only (try changing the model in
   `client.mjs` to `claude-3-haiku` and re-running — it gets denied).
3. `client.mjs` calls `gpt-4o-mini` through `http://localhost:8787/v1`
   using the `trn_...` key. Turnstile authenticates the key, runs the
   allowlist policy, injects your real `OPENAI_API_KEY` from the encrypted
   credential vault, forwards the request, and records the whole exchange
   in the ledger.
