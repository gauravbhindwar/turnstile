# Turnstile perf smoke test

Measures the latency Turnstile itself adds on top of the upstream response
(§18.2): p50 < 15ms, p99 < 50ms, non-streaming 1KB bodies, 50 rps, 5 active
policies (`policies/`, all matching every request in this run so their
combined evaluation cost is actually exercised). Also checks the gateway
process's peak RSS stays under 300MB.

The "added latency" figure isn't measured client-side (too noisy —
includes this machine's own network stack) — it's read back from each
request's own `OutcomeEvent.latencyMs - upstreamLatencyMs`, which is
exactly what the gateway itself recorded as its own overhead.

## Run it

```bash
pnpm build   # from the repo root, once
cd tools/loadtest
pip install -r requirements.txt
./run.sh
```

Writes `report.md` (human-readable) and `report.json` (machine-readable —
`{p50_ms, p99_ms, samples}`, usable as a future run's `--baseline`).
Exits non-zero if the budget or a 25%-regression-vs-baseline check fails.

Override load shape with env vars: `RPS=100 DURATION=30 ./run.sh`. Extra
args after `./run.sh` pass straight through to `run.py` (e.g.
`./run.sh --baseline report.json` to gate against a previous run).

## Standalone

`run.py` doesn't manage the gateway itself — point it at anything already
running:

```bash
python3 run.py --admin-token <token> --agent-key <trn_...> --rps 50 --duration 10
```
