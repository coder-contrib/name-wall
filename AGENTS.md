# AGENTS.md — Wall of Names (Coder workshop)

You are helping a **workshop attendee** add their name to a shared "Wall of
Names" and open a pull request. The attendee may not be technical — do the
steps for them and explain what's happening in friendly, plain language.

## The goal

Each contributor has **one file**: `names/<github-handle>.json`. The wall renders
every name in the color they choose. The attendee's PR is auto-approved and
merged within about a minute, after which their name appears on the big screen.

## The artifact

Create (or edit) exactly **one** file: `names/<their-github-handle>.json`

```json
{
  "name": "Ben",
  "handle": "bpmct",
  "color": "#3b82f6"
}
```

- `name` — what to display (their first name or whatever they want shown).
- `handle` — their GitHub username. Use it for the filename too:
  `names/<handle>.json`.
- `color` — a CSS hex color like `#3b82f6`. Map plain requests to hex:

  | They say | Use |
  |----------|-----|
  | blue | `#3b82f6` |
  | red | `#ef4444` |
  | green | `#22c55e` |
  | purple | `#a855f7` |
  | orange | `#f97316` |
  | pink | `#ec4899` |
  | yellow | `#eab308` |
  | teal / cyan | `#06b6d4` |
  | white / default | `#e6e8ee` |

  If they ask for "rainbow", a gradient, or anything fancy, just pick the
  closest single hex — the wall renders one color per name.

## Rules

- **Only ever create or edit the attendee's own `names/<handle>.json`.** Never
  touch anyone else's file, and never edit `index.html`, `wall.js`, `style.css`,
  `serve.js`, or any shared file. One file per person keeps merges clean.
- If `names/<handle>.json` already exists, edit it in place (e.g. change color).
- Determine the handle from the workspace owner / their GitHub login. If unsure,
  ask them once: "What's your GitHub username?"

## Steps

1. Create/edit `names/<handle>.json` with their name + chosen color.
2. **Preview:** make sure the preview server is running, then point them at the
   "Name Wall" app button (or http://localhost:8080). Their name should appear
   in their color within a few seconds (the wall auto-refreshes).
   - Start it if needed: `node serve.js &` (from the repo root).
3. **Open a pull request** with their change. The title/branch can be anything —
   e.g. `git checkout -b add-<handle>`, commit, push, then
   `gh pr create --fill` (or open it however is easiest).
4. Tell them: "Your PR is in — it'll be auto-approved and merged in about a
   minute, and your name will light up on the wall on screen." 🎉

## Preview server

`node serve.js` serves the wall on port 8080 and reads `names/*.json` live, so
there is no manifest to regenerate or shared file to edit.
