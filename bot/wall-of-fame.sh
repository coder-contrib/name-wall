#!/usr/bin/env bash
# wall-of-fame.sh — admin display: serve the merged Wall of Names for screen-share.
#
# Keeps the local checkout on the latest origin/main (so only MERGED names show —
# the canonical "wall of fame") and serves it on $PORT. Open http://localhost:$PORT/?admin full-screen and screen-share it; new names appear within a few seconds of merge.
#
#   ./bot/wall-of-fame.sh          # serves on :8080, pulls main every 5s
#
# Env: PORT (default 8080), PULL_INTERVAL (default 5)
set -uo pipefail

PORT="${PORT:-8080}"
PULL_INTERVAL="${PULL_INTERVAL:-5}"
cd "$(dirname "$0")/.." || exit 1

# For the live "active now" indicator, serve.js needs a Coder API token.
# Use $CODER_SESSION_TOKEN if exported, else the agent's coder CLI can mint one.
if [ -z "${CODER_SESSION_TOKEN:-}" ]; then
  CODER_BIN=$(ls /tmp/coder.*/coder 2>/dev/null | head -1)
  [ -n "$CODER_BIN" ] && export CODER_SESSION_TOKEN=$("$CODER_BIN" tokens create --lifetime 24h 2>/dev/null || true)
fi
export CODER_URL="${CODER_URL:-http://localhost:3000}"

echo "[wall-of-fame] serving merged main — open http://localhost:$PORT/?admin full-screen"
PORT="$PORT" node serve.js &
SERVE_PID=$!
trap 'kill $SERVE_PID 2>/dev/null' EXIT

git checkout -q main 2>/dev/null || true
while true; do
  git fetch -q origin main 2>/dev/null && git reset -q --hard origin/main 2>/dev/null
  sleep "$PULL_INTERVAL"
done
