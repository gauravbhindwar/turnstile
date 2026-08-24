#!/usr/bin/env bash
# Perf smoke test runner (§18.2, §20). Boots a fake OpenAI-compatible
# upstream + the gateway with 5 active policies, fires load, and reports
# Turnstile's own added latency (not the upstream's response time).
set -euo pipefail
cd "$(dirname "$0")"

export TURNSTILE_ADMIN_TOKEN="${TURNSTILE_ADMIN_TOKEN:-perf-admin-token-1234567890}"
CLI="node ../../packages/cli/dist/index.js"
RPS="${RPS:-50}"
DURATION="${DURATION:-10}"

rm -rf turnstile-data
mkdir -p plugins

echo "--- starting fake upstream on :4100 ---"
node ../../examples/05-spend-cap-demo/fake-upstream.mjs &
FAKE_PID=$!

echo "--- creating perf-bot agent key ---"
KEY=$($CLI keys create perf-bot | grep '^  trn_' | tr -d ' ')

echo "--- starting gateway on :8787 ---"
$CLI start &
GATEWAY_PID=$!

cleanup() {
  kill "$GATEWAY_PID" "$FAKE_PID" 2>/dev/null || true
}
trap cleanup EXIT

sleep 2
curl -sf http://localhost:8787/healthz >/dev/null

echo "--- running load: ${RPS} rps for ${DURATION}s ---"
python3 run.py \
  --admin-token "$TURNSTILE_ADMIN_TOKEN" \
  --agent-key "$KEY" \
  --rps "$RPS" \
  --duration "$DURATION" \
  --gateway-pid "$GATEWAY_PID" \
  "$@"
