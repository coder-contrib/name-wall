#!/usr/bin/env bash
# wall-of-fame.sh — admin all-in-one: serve the merged Wall of Names for
# screen-share, show the live PR queue, AND auto-approve+merge incoming PRs.
#
#   ./bot/wall-of-fame.sh
#   → open http://localhost:$PORT/?admin full-screen and screen-share it
#
# It runs three things:
#   - serve.js               the wall + /api/active + /api/pending (PR queue)
#   - merge-bot.sh           auto-approve + squash-merge name PRs (queue order)
#   - git pull loop          keeps the displayed wall on merged origin/main
#
# Env: PORT (default 8080), PULL_INTERVAL (default 5), NO_MERGE_BOT=1 to skip
# the auto-merge bot (display + queue only).
set -uo pipefail

PORT="${PORT:-8080}"
PULL_INTERVAL="${PULL_INTERVAL:-5}"
cd "$(dirname "$0")/.." || exit 1

# Coder API token → live "active now" indicator.
if [ -z "${CODER_SESSION_TOKEN:-}" ]; then
  CODER_BIN=$(ls /tmp/coder.*/coder 2>/dev/null | head -1)
  [ -n "$CODER_BIN" ] && export CODER_SESSION_TOKEN=$("$CODER_BIN" tokens create --lifetime 24h 2>/dev/null || true)
fi
export CODER_URL="${CODER_URL:-http://10.42.0.1:3000}"  # in-pod Coder address

# Shared file so serve.js drops merged PRs from the queue instantly.
export MERGED_FILE="${MERGED_FILE:-/tmp/name-wall-merged}"
: > "$MERGED_FILE"

# Track PR#@sha we've already requested changes on (survives across this run so
# the bot doesn't re-comment on the same commit every poll).
export REVIEWED_FILE="${REVIEWED_FILE:-/tmp/name-wall-reviewed}"
: > "$REVIEWED_FILE"

# Anthropic key for the review agent (the merge bot reviews each PR, not blanket
# approve). Read from env, or from the box's local.nix if present.
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -r /etc/nixos-repo/hosts/coderbox/local.nix ]; then
  export ANTHROPIC_API_KEY=$(grep -o "CODER_AIBRIDGE_ANTHROPIC_KEY *= *\"[^\"]*\"" /etc/nixos-repo/hosts/coderbox/local.nix 2>/dev/null | sed "s/.*\"\([^\"]*\)\"/\1/")
fi

# GitHub token → live PR queue (/api/pending) and the merge bot.
if [ -z "${GITHUB_TOKEN:-}" ]; then
  export GITHUB_TOKEN=$(gh auth token 2>/dev/null || true)
fi

echo "[wall-of-fame] serving merged main — open http://localhost:$PORT/?admin full-screen"
PORT="$PORT" node serve.js &
SERVE_PID=$!

MERGE_PID=""
if [ "${NO_MERGE_BOT:-0}" != "1" ]; then
  echo "[wall-of-fame] starting auto-merge bot"
  ./bot/merge-bot.sh &
  MERGE_PID=$!
fi

cleanup() { kill $SERVE_PID $MERGE_PID 2>/dev/null; }
trap cleanup EXIT

# Keep the displayed wall pinned to merged origin/main.
git checkout -q main 2>/dev/null || true
while true; do
  git fetch -q origin main 2>/dev/null && git reset -q --hard origin/main 2>/dev/null
  sleep "$PULL_INTERVAL"
done
