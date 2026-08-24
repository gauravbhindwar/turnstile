#!/usr/bin/env bash
# Point the real OpenAI SDK at Turnstile instead of api.openai.com and watch
# a normal completion sail through, fully audited.
set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "Set OPENAI_API_KEY to a real OpenAI key (Turnstile injects it; your" >&2
  echo "agent never sees it) before running this example." >&2
  exit 1
fi

export TURNSTILE_ADMIN_TOKEN="${TURNSTILE_ADMIN_TOKEN:-demo-admin-token-1234567890}"
CLI="node ../../packages/cli/dist/index.js"

rm -rf turnstile-data
mkdir -p plugins

echo "--- creating agent key ---"
KEY=$($CLI keys create sdk-demo-bot | grep '^  trn_' | tr -d ' ')
export TURNSTILE_AGENT_KEY="$KEY"

echo "--- starting gateway ---"
$CLI start &
GATEWAY_PID=$!
trap 'kill $GATEWAY_PID 2>/dev/null || true' EXIT
sleep 2

if [ ! -d node_modules ]; then
  echo "--- installing the openai SDK ---"
  npm install --no-audit --no-fund
fi

echo "--- calling gpt-4o-mini through Turnstile ---"
node client.mjs
