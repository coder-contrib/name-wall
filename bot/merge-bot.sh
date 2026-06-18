#!/usr/bin/env bash
# merge-bot.sh — Wall of Names auto-merge bot (admin / workshop host)
#
# Polls open PRs against coder-contrib/name-wall, and for each one that only
# adds/edits a single names/<handle>.json (no other files touched), approves and
# squash-merges it. Names then land on main and light up the Wall of Fame.
#
# Run from an admin workspace or the box, authenticated as a coder-contrib member:
#   gh auth status        # must be logged in with repo + PR write
#   ./bot/merge-bot.sh    # loops forever, polling every few seconds
#
# Env:
#   REPO        default coder-contrib/name-wall
#   INTERVAL    poll seconds (default 5)
#   DRY_RUN     set to 1 to log decisions without approving/merging
set -uo pipefail

REPO="${REPO:-coder-contrib/name-wall}"
INTERVAL="${INTERVAL:-5}"
DRY_RUN="${DRY_RUN:-0}"

command -v gh >/dev/null || { echo "gh CLI required"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh not authenticated (run: gh auth login)"; exit 1; }

echo "[merge-bot] watching $REPO  (interval=${INTERVAL}s dry_run=$DRY_RUN)"

approve_and_merge() {
  local num="$1"
  if [ "$DRY_RUN" = "1" ]; then echo "[merge-bot] DRY_RUN would merge #$num"; return; fi
  # Approve, then squash-merge. --admin lets a maintainer merge without waiting
  # on checks; remove if you want required checks enforced.
  gh pr review "$num" --repo "$REPO" --approve \
    --body "Welcome to the wall! Auto-approved by the workshop bot. 🎉" 2>/dev/null
  if gh pr merge "$num" --repo "$REPO" --squash --admin --delete-branch=false 2>/dev/null; then
    echo "[merge-bot] ✅ merged #$num"
  else
    echo "[merge-bot] ⚠️  merge failed for #$num (will retry next pass)"
  fi
}

# A PR is safe to auto-merge if every changed file is names/<something>.json.
pr_is_safe() {
  local num="$1"
  local files
  files=$(gh pr view "$num" --repo "$REPO" --json files --jq '.files[].path' 2>/dev/null)
  [ -z "$files" ] && return 1
  while IFS= read -r f; do
    case "$f" in
      names/*.json) ;;                 # allowed
      *) echo "[merge-bot] ⏭  skip #$num — touches non-name file: $f"; return 1 ;;
    esac
  done <<< "$files"
  return 0
}

while true; do
  # Oldest-first so it behaves like a queue.
  prs=$(gh pr list --repo "$REPO" --state open --json number --jq 'sort_by(.number) | .[].number' 2>/dev/null)
  for num in $prs; do
    if pr_is_safe "$num"; then
      echo "[merge-bot] processing #$num"
      approve_and_merge "$num"
      sleep 1
    fi
  done
  sleep "$INTERVAL"
done
