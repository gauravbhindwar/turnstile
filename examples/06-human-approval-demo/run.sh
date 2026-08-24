#!/usr/bin/env bash
# Human-in-the-loop demo: fires one request that requires approval, parks
# it, then decides it from the admin API (as a stand-in for a human
# clicking Approve in the dashboard) and shows the parked request resume.
set -euo pipefail
cd "$(dirname "$0")"

export TURNSTILE_ADMIN_TOKEN="${TURNSTILE_ADMIN_TOKEN:-demo-admin-token-1234567890}"
CLI="node ../../packages/cli/dist/index.js"

rm -rf turnstile-data
mkdir -p plugins

echo "--- starting fake upstream on :4100 ---"
node ../../examples/05-spend-cap-demo/fake-upstream.mjs &
FAKE_PID=$!

echo "--- creating approval-bot agent key ---"
KEY=$($CLI keys create approval-bot | grep '^  trn_' | tr -d ' ')

echo "--- starting gateway on :8787 ---"
$CLI start &
GATEWAY_PID=$!

cleanup() {
  kill "$GATEWAY_PID" "$FAKE_PID" 2>/dev/null || true
}
trap cleanup EXIT

sleep 2
curl -sf http://localhost:8787/healthz >/dev/null

echo "--- firing a request that requires approval (parks, doesn't respond yet) ---"
curl -s -o /tmp/turnstile-approval-response.json -w '%{http_code}' \
  -X POST http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}' \
  > /tmp/turnstile-approval-status.txt &
CURL_PID=$!

echo "--- waiting for it to appear in the pending queue ---"
for i in $(seq 1 20); do
  PENDING=$(curl -s http://localhost:8787/admin/v1/approvals -H "Authorization: Bearer $TURNSTILE_ADMIN_TOKEN")
  APPROVAL_ID=$(echo "$PENDING" | node -e "process.stdin.once('data',d=>{const j=JSON.parse(d);process.stdout.write(j.data[0]?.id||'')})")
  if [ -n "$APPROVAL_ID" ]; then break; fi
  sleep 0.5
done

if [ -z "$APPROVAL_ID" ]; then
  echo "no pending approval showed up — something's wrong"
  exit 1
fi
echo "pending approval: $APPROVAL_ID"
echo "$PENDING" | node -e "process.stdin.once('data',d=>console.log(JSON.stringify(JSON.parse(d).data[0].summary,null,2)))"

echo "--- approving it (this is what clicking Approve in the dashboard does) ---"
curl -s -X POST "http://localhost:8787/admin/v1/approvals/$APPROVAL_ID/decide" \
  -H "Authorization: Bearer $TURNSTILE_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"decision":"approved","note":"looks fine, approved via run.sh"}' | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d).data))"

wait "$CURL_PID"
echo "--- the originally-parked request just resumed with HTTP $(cat /tmp/turnstile-approval-status.txt) ---"
cat /tmp/turnstile-approval-response.json
echo
