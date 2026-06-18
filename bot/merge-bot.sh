#!/usr/bin/env bash
# merge-bot.sh — Wall of Names review-and-merge bot (admin / workshop host)
#
# For each open PR against the wall repo:
#   1. Mechanical gate: every changed file must be names/<handle>.json (hard
#      block — defense in depth, runs before any LLM).
#   2. Agent-in-the-loop: a small Claude review of the diff decides whether the
#      entry is a single, sane name card (no abuse/slurs/malice, only the
#      author's own file). Only an "approve" verdict gets approved + merged.
#      A "reject" verdict posts a REQUEST_CHANGES review (once per head commit,
#      no spam) explaining why, and keeps polling so a pushed fix is re-reviewed
#      and merged automatically.
#   3. On merge, record the PR number to a file so the live PR-queue can drop it
#      immediately (no waiting for the next GitHub poll).
#
# This is NOT a blanket auto-approve — every PR is reviewed by the model.
#
# Run from the admin workspace, gh-authenticated as a coder-contrib member:
#   ANTHROPIC_API_KEY=sk-ant-...   # required for the review (else mechanical-only)
#   ./bot/merge-bot.sh
#
# Env:
#   REPO              default coder-contrib/name-wall
#   INTERVAL          poll seconds (default 5)
#   ANTHROPIC_API_KEY Anthropic key for the review agent
#   REVIEW_MODEL      default claude-sonnet-4-6
#   MERGED_FILE       path the queue reads to drop merged PRs (default /tmp/name-wall-merged)
#   REVIEWED_FILE     path tracking PR#@sha we've already requested changes on (default /tmp/name-wall-reviewed)
#   DRY_RUN           1 = log verdicts, don't approve/merge
#   NO_REVIEW         1 = skip the LLM and use mechanical gate only (not recommended)
set -uo pipefail

REPO="${REPO:-coder-contrib/name-wall}"
INTERVAL="${INTERVAL:-5}"
DRY_RUN="${DRY_RUN:-0}"
REVIEW_MODEL="${REVIEW_MODEL:-claude-sonnet-4-6}"
MERGED_FILE="${MERGED_FILE:-/tmp/name-wall-merged}"
REVIEWED_FILE="${REVIEWED_FILE:-/tmp/name-wall-reviewed}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
NO_REVIEW="${NO_REVIEW:-0}"

command -v gh >/dev/null || { echo "gh CLI required"; exit 1; }
command -v jq >/dev/null || { echo "jq required"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh not authenticated"; exit 1; }
if [ -z "$ANTHROPIC_API_KEY" ] && [ "$NO_REVIEW" != "1" ]; then
  echo "[merge-bot] WARNING: no ANTHROPIC_API_KEY — set NO_REVIEW=1 for mechanical-only, or provide a key. Refusing blanket approve."
  exit 1
fi
touch "$MERGED_FILE" "$REVIEWED_FILE" 2>/dev/null || true

echo "[merge-bot] watching $REPO (interval=${INTERVAL}s dry_run=$DRY_RUN review=$([ "$NO_REVIEW" = 1 ] && echo off || echo on))"

# Mechanical gate: only names/*.json changed. Returns the single path on stdout.
pr_changed_only_names() {
  local num="$1" files
  files=$(gh pr view "$num" --repo "$REPO" --json files --jq '.files[].path' 2>/dev/null)
  [ -z "$files" ] && return 1
  while IFS= read -r f; do
    case "$f" in
      names/*.json) ;;
      *) return 1 ;;
    esac
  done <<< "$files"
  return 0
}

# Agent review: ask Claude for a strict JSON verdict on the PR diff.
# Echoes "approve" or "reject:<reason>".
agent_review() {
  local num="$1"
  if [ "$NO_REVIEW" = "1" ]; then echo "approve"; return; fi
  local author diff prompt body resp verdict
  author=$(gh pr view "$num" --repo "$REPO" --json author --jq '.author.login' 2>/dev/null)
  diff=$(gh pr diff "$num" --repo "$REPO" 2>/dev/null | head -c 6000)

  prompt="You are reviewing a pull request to a friendly public \"Wall of Names\" at a Coder workshop. The PR author's GitHub login is \"${author}\". Each contributor adds ONE file names/<their-handle>.json with their name and creative HTML/CSS for how it renders. Each entry renders in its own responsive box (~4:3, width varies ~100–340px) and should fill that box and look good at any size in that range.

Approve ONLY if ALL of these hold:
- The diff adds/edits exactly one file under names/ and it is valid-looking JSON.
- The displayed name and any html/css are not hateful, harassing, sexual, a slur, or impersonating someone else.
- The html/css contains NO <script>, no event handlers (onclick etc.), and no external network/resource loads (no http(s):// urls, no @import). Creative CSS animation is fine.

Do NOT reject over a filename that doesn't match the author's handle — people pick fun handles, and that mismatch alone is fine. Prefer entries that fill their region and size things relatively (%, vw/vh, clamp, flex) rather than tiny fixed-pixel art floating in the box, but only REJECT for the safety/abuse rules above, not for style.

Respond with ONLY compact JSON: {\"decision\":\"approve\"} or {\"decision\":\"reject\",\"reason\":\"short reason\"}.

DIFF:
${diff}"

  body=$(jq -n --arg m "$REVIEW_MODEL" --arg p "$prompt" \
    '{model:$m, max_tokens:200, messages:[{role:"user", content:$p}]}')
  resp=$(curl -s --max-time 25 https://api.anthropic.com/v1/messages \
    -H "x-api-key: ${ANTHROPIC_API_KEY}" -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" -d "$body" 2>/dev/null)
  # Extract the model's text, then the decision field.
  local text
  text=$(echo "$resp" | jq -r '.content[0].text // empty' 2>/dev/null)
  verdict=$(echo "$text" | grep -o '"decision"[^,}]*' | grep -o 'approve\|reject' | head -1)
  if [ "$verdict" = "approve" ]; then
    echo "approve"
  elif [ "$verdict" = "reject" ]; then
    echo "reject:$(echo "$text" | grep -o '"reason"[^}]*' | sed 's/.*: *"//; s/".*//' | head -1)"
  else
    echo "reject:review-failed (no clear verdict)"  # fail closed
  fi
}

# Request changes on a rejected PR, but only once per head commit so we don't
# spam. We re-review on every poll; when the author pushes a fix the head SHA
# changes, the PR#@sha key is new, and it gets reviewed (and merged) again.
request_changes() {
  local num="$1" reason="$2" sha key
  sha=$(gh pr view "$num" --repo "$REPO" --json headRefOid --jq '.headRefOid' 2>/dev/null)
  key="${num}@${sha}"
  if grep -qxF "$key" "$REVIEWED_FILE" 2>/dev/null; then
    return 0   # already told them about this exact commit; keep polling quietly
  fi
  if [ "$DRY_RUN" = "1" ]; then
    echo "[merge-bot] DRY_RUN would request changes on #$num — $reason"
  else
    gh pr review "$num" --repo "$REPO" --request-changes --body \
"This entry can't merge yet:

> ${reason}

Edit your \`names/<handle>.json\` and push again — CSS animations and colors are welcome; no \`<script>\`, event handlers, or external URLs. It will re-review automatically." 2>/dev/null \
      && echo "[merge-bot] requested changes on #$num — $reason"
  fi
  echo "$key" >> "$REVIEWED_FILE"
}

approve_and_merge() {
  local num="$1"
  if [ "$DRY_RUN" = "1" ]; then echo "[merge-bot] DRY_RUN would approve+merge #$num"; return; fi
  gh pr review "$num" --repo "$REPO" --approve \
    --body "Approved by the workshop review bot. Your name is on the wall." 2>/dev/null
  if gh pr merge "$num" --repo "$REPO" --squash --admin --delete-branch=false 2>/dev/null; then
    echo "$num" >> "$MERGED_FILE"   # let the live queue drop it immediately
    echo "[merge-bot] merged #$num"
  else
    echo "[merge-bot] merge failed for #$num (retry next pass)"
  fi
}

while true; do
  prs=$(gh pr list --repo "$REPO" --state open --json number --jq 'sort_by(.number) | .[].number' 2>/dev/null)
  for num in $prs; do
    if ! pr_changed_only_names "$num"; then
      echo "[merge-bot] skip #$num — touches files outside names/"
      continue
    fi
    verdict=$(agent_review "$num")
    if [ "$verdict" = "approve" ]; then
      echo "[merge-bot] approved #$num"
      approve_and_merge "$num"
    else
      request_changes "$num" "${verdict#reject:}"
    fi
    sleep 1
  done
  sleep "$INTERVAL"
done
