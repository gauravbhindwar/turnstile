# 02 — Anthropic via OpenAI-compat

Turnstile's model-agnostic promise, made concrete: the same OpenAI SDK
client, the same agent key, calling **both** OpenAI and Anthropic — routed
by `model_routes` in `turnstile.yaml`, with one `spend_cap` policy capping
their **combined** daily spend.

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
pnpm build   # from the repo root, once
cd examples/02-anthropic-via-openai-compat
./run.sh
```

`client.mjs` never branches on vendor — it just picks a model name and
Turnstile does the rest: `gpt-*` goes to the `openai` upstream, `claude-*`
goes to the `anthropic` upstream (Anthropic's OpenAI-compatible endpoint),
and both draw down the same `multi-vendor-daily-cap` budget
(`policies/spend-cap.yaml`, $2/day, `scope: agent`) because the cap is keyed
on the agent, not the upstream.
