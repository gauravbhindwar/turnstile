#!/usr/bin/env bash
# Spend-cap demo: a runaway "agent" hammering /v1/chat/completions gets
# blocked by Turnstile's spend_cap policy after a handful of calls — the
# same call, the same key, the cap just bites. Run from this directory
# after `pnpm build` at the repo root.
set -euo pipefail
cd "$(dirname "$0")"

export TURNSTILE_ADMIN_TOKEN="${TURNSTILE_ADMIN_TOKEN:-demo-admin-token-1234567890}"
CLI="node ../../packages/cli/dist/index.js"

rm -rf turnstile-data
mkdir -p plugins

echo "--- starting fake upstream on :4100 ---"
node fake-upstream.mjs &
FAKE_PID=$!

echo "--- creating agent key for demo-bot ---"
KEY=$($CLI keys create demo-bot | grep '^  trn_' | tr -d ' ')
echo "issued key: ${KEY:0:12}..."

echo "--- starting gateway on :8787 ---"
$CLI start &
GATEWAY_PID=$!

cleanup() {
  kill "$GATEWAY_PID" "$FAKE_PID" 2>/dev/null || true
}
trap cleanup EXIT

sleep 2
curl -sf http://localhost:8787/healthz >/dev/null

echo "--- hammering /v1/chat/completions until the spend cap bites ---"
for i in $(seq 1 20); do
  STATUS=$(curl -s -o /tmp/turnstile-demo-response.json -w '%{http_code}' \
    -X POST http://localhost:8787/v1/chat/completions \
    -H "Authorization: Bearer $KEY" \
    -H 'Content-Type: application/json' \
    -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}],"max_tokens":50}')
  echo "call $i -> HTTP $STATUS"
  if [ "$STATUS" = "403" ]; then
    echo "--- BLOCKED by spend_cap on call $i ---"
    cat /tmp/turnstile-demo-response.json
    echo
    break
  fi
done

echo "--- verifying the ledger ---"
$CLI verify-ledger
