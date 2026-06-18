# AGENTS.md — Wall of Names (Coder workshop)

You are helping a **workshop attendee** add their name to a shared "Wall of
Names" and open a pull request. The attendee may not be technical — do the
steps for them and explain what's happening in friendly, plain language.

## Important: paths

The repo is at the **absolute path `/home/node/name-wall`**. Your tool working
directory may be different (e.g. `/root`), so **always use the absolute path
`/home/node/name-wall/...`** for file reads/writes and run
`cd /home/node/name-wall` before any git/gh command. Do not use relative paths.

## The goal

Each contributor has **one file**: `names/<github-handle>.json`. Each name is
rendered as its **own mini web page** on the wall — a full HTML + CSS canvas, so
people can make animated, moving, gradient, component-style names, not just a
color. The attendee's PR is auto-approved and merged within about a minute,
after which their name appears on the big screen.

## The artifact

Create (or edit) exactly **one** file:
`/home/node/name-wall/names/<their-github-handle>.json`

```json
{
  "handle": "bpmct",
  "name": "Ben",
  "html": "<div class='wrap'><span class='glow'>Ben</span></div>",
  "css": ".wrap{display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#0b0a1f}.glow{font-size:clamp(1.4rem,9vw,3rem);font-weight:800;background:linear-gradient(90deg,#7511e2,#01f2ff,#66ffab,#7511e2);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:slide 4s linear infinite}@keyframes slide{to{background-position:300% 0}}"
}
```

- `handle` — their GitHub username. Use it for the filename too.
- `name` — plain-text fallback label (used if you omit `html`).
- `html` — **the creative part**: any HTML for their name card. Build whatever
  they ask for — animated text, moving elements, gradients, glows, emoji,
  layered components, CSS art, bouncing letters, etc.
- `css` — styles for the html, including `@keyframes` animations. Scope your
  selectors (e.g. a wrapper class) so they're self-contained.

Each card renders inside a **sandboxed iframe** that is your name's own region
on the wall. Design for it as a **responsive box**, not a fixed canvas:
- The region is roughly **4:3** and its width varies with how many names are on
  the wall — anywhere from about **100px wide (packed) to 340px wide (just a few
  names)**. Your art must look good across that whole range.
- **Fill the whole region.** Your `html`/`body` are already `width:100%;
  height:100%` and centered — make your wrapper fill `100%/100%` too, and **set
  your own background** (the region is transparent by default) so the card reads
  as one tile, not a small graphic floating in an empty box.
- **Size things relatively**, not in fixed px: use `%`, `vw`/`vh`, `clamp()`,
  flexbox/grid inside your card. Avoid hard-coded pixel widths/heights that
  assume one size — they clip or float when the region resizes.
- **CSS only — no `<script>`, no JS, no external network/resource loads.**
  Inline everything; do not reference external URLs, fonts, or images.
- Animate/move freely with CSS `@keyframes`; scope your selectors (a wrapper
  class) so they stay self-contained.

### Simple fallback

For "just make my name blue", you can skip `html`/`css` and use:
```json
{ "handle": "bpmct", "name": "Ben", "color": "#4893fc" }
```

## Rules

- **Only ever create/edit the attendee's own `names/<handle>.json`.** Never
  touch anyone else's file or any shared file (index.html, wall.js, etc.).
- No scripts / no external loads — CSS animations only.
- If their file already exists, edit it in place.

## Steps

1. Get their handle: `gh api user --jq .login`.
2. **Fork first** (they have no write access to upstream):
   `cd /home/node/name-wall && gh repo fork coder-contrib/name-wall --clone=false --remote=true`
3. Create a branch and write `/home/node/name-wall/names/<handle>.json` with
   their creative `html` + `css` (or the simple `color` fallback).
4. **Preview:** make sure the wall preview is running and point them at the
   "Name Wall" app button (port 8080) so they SEE their animated name before
   the PR. Start it if needed: `cd /home/node/name-wall && node serve.js &`.
5. Commit, push to their fork, open a PR:
   `gh pr create --repo coder-contrib/name-wall --fill` (any title is fine).
6. Tell them: "Your PR is in — it'll be auto-approved and merged in about a
   minute, and your name will light up on the wall." 🎉

## Preview server

`node serve.js` serves the wall on port 8080 and reads `names/*.json` live, so
there's no manifest to regenerate or shared file to edit.
