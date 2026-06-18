#!/usr/bin/env bash
# role-bot.sh — auto-grant the "Coder Agents User" role to new workshop logins.
#
# Polls Coder org members and assigns the `agents-access` org role to anyone
# who doesn't have it yet — so when an attendee logs in with GitHub, they can
# use the agent/CLI for the workshop without you clicking through the UI.
#
# Run on the box or in the admin workspace, with a Coder ADMIN token:
#   export CODER_SESSION_TOKEN=...        # an owner/org-admin token
#   export CODER_URL=http://10.42.0.1:3000   # in-pod; or http://localhost:3000 on the box
#   ./bot/role-bot.sh
#
# Env:
#   ROLE       org role to grant (default agents-access)
#   INTERVAL   poll seconds (default 5)
#   SKIP       comma-sep usernames to never modify (default admin)
#   DRY_RUN    set 1 to log without assigning
set -uo pipefail

ROLE="${ROLE:-agents-access}"
INTERVAL="${INTERVAL:-5}"
SKIP="${SKIP:-admin}"
DRY_RUN="${DRY_RUN:-0}"
URL="${CODER_URL:-http://10.42.0.1:3000}"
URL="${URL%/}"
TOKEN="${CODER_SESSION_TOKEN:-${CODER_TOKEN:-}}"

[ -n "$TOKEN" ] || { echo "Set CODER_SESSION_TOKEN (owner/org-admin)"; exit 1; }
command -v jq >/dev/null || { echo "jq required"; exit 1; }

api() { curl -s -H "Coder-Session-Token: $TOKEN" "$@"; }

ORG=$(api "$URL/api/v2/users/me" | jq -r '.organization_ids[0]')
[ -n "$ORG" ] && [ "$ORG" != "null" ] || { echo "could not resolve org id"; exit 1; }
echo "[role-bot] org=$ORG role=$ROLE interval=${INTERVAL}s dry_run=$DRY_RUN"

is_skipped() { echo ",$SKIP," | grep -q ",$1,"; }

while true; do
  # List members; for each, check whether they already hold $ROLE.
  members=$(api "$URL/api/v2/organizations/$ORG/members" \
    | jq -c '.[] | {id: .user_id, name: .username, roles: [.roles[].name]}' 2>/dev/null)
  while IFS= read -r m; do
    [ -z "$m" ] && continue
    name=$(echo "$m" | jq -r '.name')
    id=$(echo "$m" | jq -r '.id')
    has=$(echo "$m" | jq -r --arg r "$ROLE" 'if (.roles | index($r)) then "yes" else "no" end')
    is_skipped "$name" && continue
    if [ "$has" = "no" ]; then
      if [ "$DRY_RUN" = "1" ]; then
        echo "[role-bot] DRY_RUN would grant $ROLE to $name"
        continue
      fi
      # Preserve any existing roles and add ours.
      existing=$(echo "$m" | jq -c '.roles')
      newroles=$(echo "$existing" | jq -c --arg r "$ROLE" '. + [$r] | unique')
      if api -X PUT -H "Content-Type: application/json" \
           "$URL/api/v2/organizations/$ORG/members/$id/roles" \
           -d "{\"roles\":$newroles}" | jq -e '.roles' >/dev/null 2>&1; then
        echo "[role-bot] ✅ granted $ROLE to $name"
      else
        echo "[role-bot] ⚠️  failed to grant to $name (retry next pass)"
      fi
    fi
  done <<< "$members"
  sleep "$INTERVAL"
done
