# Wall of Names

A tiny "wall of names" for live Coder workshops. Each attendee adds **one file**
— `names/<github-handle>.json` — with their name and a color, opens a pull
request, and (once merged) their name lights up on the shared wall on screen.

It's designed to be driven by an **AI agent**: an attendee just says something
like *"make my name blue"* and the agent edits their file, previews it, and
opens the PR. See [`AGENTS.md`](./AGENTS.md) for the agent instructions.

## How it works

- `names/<handle>.json` — one entry per contributor: `{ "name", "handle", "color" }`
- `index.html` + `style.css` + `wall.js` — the wall UI
- `serve.js` — zero-dependency preview server; serves the wall and a
  `/api/names` endpoint that reads `names/*.json` at request time (no build step,
  no shared manifest, so contributors never touch the same file)

## Run the preview

```sh
node serve.js
# → http://localhost:8080
```

## Add yourself

```jsonc
// names/yourhandle.json
{ "name": "Your Name", "handle": "yourhandle", "color": "#3b82f6" }
```

Then open a pull request — any branch/title is fine. In the workshop it gets
auto-merged and your name appears on the wall.
