# Workshop admin: Wall of Fame + merge bot

These two scripts run on the **admin** side (the workshop host's workspace, e.g.
`olive-locust-63`). They turn merged contributions into the live "Wall of Fame"
you screen-share, and auto-merge attendee PRs.

You must be `gh` authenticated as a **coder-contrib member** with PR write
(`gh auth status`). The workshop template installs `gh` and logs it in from
Coder's GitHub external auth automatically.

## Live "active now" indicator

The Wall of Fame shows a green "● N active now" pill (Coder users seen in the
last 5 min). It needs a Coder API token — export one in the admin workspace
before running:

```sh
export CODER_SESSION_TOKEN=$(coder tokens create --lifetime 24h)
# (CODER_URL defaults to http://10.42.0.1:3000, the in-pod Coder address)
```

Without a token the wall still works; the pill is just hidden.

## 1. Wall of Fame (screen-share)

```sh
./bot/wall-of-fame.sh
# → http://localhost:8080  (open full-screen, screen-share it)
```

Keeps the checkout pinned to `origin/main` and serves it, so **only merged
names** appear. New names show within a few seconds of merge.

## 2. Merge bot

```sh
./bot/merge-bot.sh           # approve + squash-merge safe PRs, queue order
DRY_RUN=1 ./bot/merge-bot.sh # log decisions only
```

For each open PR it checks that **every changed file is `names/*.json`** (so a
PR can't sneak in other changes), then approves and squash-merges oldest-first.

## Typical setup

Two terminals in the admin workspace:
- Terminal A: `./bot/wall-of-fame.sh`  → project this
- Terminal B: `./bot/merge-bot.sh`     → watch names roll in
