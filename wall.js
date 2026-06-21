// Renders the wall by DIFFING against the DOM — new names animate in once,
// existing names stay put (no full re-render, so no flicker). Color changes
// update in place.

const wall = document.getElementById("wall");
const countEl = document.getElementById("count");
const seen = new Map(); // handle -> { card, frame, sig }
const WALL_REPO = "coder-contrib/name-wall"; // for linking PRs + contributors

// ─── Rotating example prompts in the header ──────────────────────────────────
// Cycles fun + networking-oriented prompt ideas so attendees see the range of
// what they can do (creative looks AND sharing they're hiring / job-hunting).
const PROMPT_IDEAS = [
  "make my name blue",
  "rainbow bouncing letters",
  "say I'm hiring a designer",
  "neon sign with my name",
  "I'm open to work — make it pop",
  "matrix rain behind my name",
  "add my role and that I'm freelancing",
  "a glowing retro arcade vibe",
  "I'm a student looking for an internship",
  "make it look like fire",
  "we're hiring engineers at my company",
  "gradient that shifts like an aurora",
];
(function rotatePrompts() {
  const el = document.getElementById("prompt-rotator");
  if (!el) return;
  let i = 0;
  setInterval(() => {
    el.classList.add("fading");
    setTimeout(() => {
      i = (i + 1) % PROMPT_IDEAS.length;
      el.textContent = `“${PROMPT_IDEAS[i]}”`;
      el.classList.remove("fading");
    }, 350);
  }, 3500);
})();

// ─── Status filter (networking: Hiring / Open to work / Freelancing / Learning) ──
// The filter bar doubles as a live legend with per-status counts. It works on the
// personal-device view (click to filter) and reads as an at-a-glance legend on the
// projected display. State is mirrored in the URL (?filter=hiring) so a view can be
// pinned or shared.
const FILTERS = [
  { key: "all",       label: "All" },
  { key: "hiring",    label: "Hiring" },
  { key: "seeking",   label: "Open to work" },
  { key: "freelance", label: "Freelancing" },
  { key: "learning",  label: "Learning" },
];
let activeFilter = (new URLSearchParams(location.search).get("filter") || "all").toLowerCase();
if (!FILTERS.some((f) => f.key === activeFilter)) activeFilter = "all";

function setFilter(key) {
  activeFilter = key;
  const u = new URL(location.href);
  if (key === "all") u.searchParams.delete("filter");
  else u.searchParams.set("filter", key);
  history.replaceState(null, "", u);
  const bar = document.getElementById("filterbar");
  if (bar) for (const c of bar.children) c.classList.toggle("on", c.dataset.key === key);
  applyFilter();
}

function updateFilterBar(names) {
  let bar = document.getElementById("filterbar");
  if (!bar) {
    bar = document.createElement("nav");
    bar.id = "filterbar";
    bar.className = "filterbar";
    // Place the filter bar at the BOTTOM, just above the footer (after the wall).
    const footer = document.querySelector("footer");
    if (footer) footer.parentNode.insertBefore(bar, footer);
    else wall.parentNode.appendChild(bar);
    for (const f of FILTERS) {
      const chip = document.createElement("button");
      chip.className = "filter-chip" + (f.key === activeFilter ? " on" : "");
      chip.dataset.key = f.key;
      chip.innerHTML = `<span class="fc-label">${f.label}</span><span class="fc-dash"> – </span><span class="fc-count"></span>`;
      chip.addEventListener("click", () => setFilter(f.key));
      bar.appendChild(chip);
    }
  }
  // Live counts per status.
  const counts = { all: names.length, hiring: 0, seeking: 0, freelance: 0, learning: 0 };
  for (const n of names) { const k = statusKeyOf(n); if (k) counts[k]++; }
  for (const c of bar.children) {
    const cnt = counts[c.dataset.key] || 0;
    c.querySelector(".fc-count").textContent = cnt;
    // Always show every chip with its count so the bar reads as a complete legend
    // (e.g. Hiring 3 · Open to work 5 · Freelancing 0 · Learning 1).
    c.hidden = false;
    c.classList.toggle("empty", c.dataset.key !== "all" && cnt === 0);
  }
}

// Show/hide cards to match the active filter. "all" shows everything.
function applyFilter() {
  for (const [, entry] of seen) {
    const match = activeFilter === "all" || entry.card.dataset.status === activeFilter;
    entry.card.classList.toggle("filtered-out", !match);
  }
}

function keyOf(n) {
  return n.handle || n.name || JSON.stringify(n);
}

// A signature of the entry's visual content, so we only re-render a card when
// its content actually changes (no flicker on unrelated polls).
function sigOf(n) {
  return JSON.stringify([n.name, n.handle, n.color, n.html, n.css,
    n.role, n.tagline, n.status, n.hiringFor || n.hiring_for, n.link || n.url, n.contact]);
}

// Build the sandboxed HTML document for one name. Each entry gets a full
// HTML/CSS canvas (animations, movement, components) rendered inside an
// <iframe sandbox> with NO scripts allowed — so creative CSS is fully
// supported while arbitrary JS / XSS can't run on the shared wall, and one
// entry's styles can't leak out and break the layout or other names.
// Sanitize a user-supplied contact URL. Only http/https allowed (no javascript:,
// data:, etc.). Returns {href, label} or null. label is a friendly short form.
function safeLink(raw, customLabel) {
  let v = String(raw || "").trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) {
    // allow bare domains/emails: prefix sensibly
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) v = "mailto:" + v;
    else if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v)) v = "https://" + v;
    else return null;
  }
  let url;
  try { url = new URL(v); } catch { return null; }
  if (!/^(https?:|mailto:)$/i.test(url.protocol)) return null;
  let label = customLabel
    ? String(customLabel)
    : url.protocol === "mailto:"
      ? url.pathname
      : (url.hostname.replace(/^www\./, "") + url.pathname).replace(/\/$/, "");
  if (label.length > 40) label = label.slice(0, 39) + "\u2026";
  return { href: url.href, label };
}

function docFor(n) {
  const handle = esc(n.handle || "");
  const isCustom = !!n.html;
  const css = n.css || "";
  // Optional showcase fields (plain text — escaped). role + tagline render as a
  // small caption; status renders as a colored pill (hiring / seeking / open).
  const role = esc(n.role || "");
  const tagline = esc(n.tagline || "");
  const statusKey = String(n.status || "").toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z-]/g, "");
  const statusLabel = {
    hiring: "Hiring",
    seeking: "Open to work",
    open: "Open to work",
    "open-to-work": "Open to work",
    opentowork: "Open to work",
    freelance: "Freelancing",
    learning: "Learning",
  }[statusKey] || "";
  // When hiring, optionally say WHAT they're hiring for (e.g. "Hiring · DevRel").
  const hiringFor = esc(n.hiringFor || n.hiring_for || "");
  const pillText = (statusKey === "hiring" && hiringFor)
    ? `Hiring · ${hiringFor}` : statusLabel;
  const pill = statusLabel
    ? `<div class="status st-${esc(statusKey)}">${esc(pillText)}</div>` : "";
  const lk = safeLink(n.link || n.url, n.contact);
  // The whole CARD is clickable to this link (handled on the parent .name div),
  // so we don't render any in-card link text — keep the card clean.
  const linkEl = "";
  const hasShowcase = !!(role || tagline || statusLabel);
  const caption = (role || tagline)
    ? `<div class="showcase">${role ? `<span class="role">${role}</span>` : ""}` +
      `${role && tagline ? `<span class="dot">·</span>` : ""}` +
      `${tagline ? `<span class="tagline">${tagline}</span>` : ""}</div>`
    : "";
  // The iframe fills its whole region; html/body are 100%/100% so the author's
  // art covers the box at any size. Authors design responsively (%, vw/vh, flex,
  // clamp) against this box rather than a fixed pixel canvas. The showcase strip
  // is overlaid at the bottom (pointer-events:none) so it never blocks the art.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    /* ─ Coder brand made available INSIDE every card iframe ─ fonts + tokens.
       Cards inherit on-brand defaults; author css (appended later) can override. */
    @font-face{font-family:'Lay Grotesk';font-weight:400;font-display:swap;src:url("fonts/LayGrotesk-Regular.woff2") format("woff2");}
    @font-face{font-family:'Lay Grotesk';font-weight:500;font-display:swap;src:url("fonts/LayGrotesk-Medium.woff2") format("woff2");}
    @font-face{font-family:'Lay Grotesk';font-weight:600;font-display:swap;src:url("fonts/LayGrotesk-Semibold.woff2") format("woff2");}
    @font-face{font-family:'FT System Mono';font-weight:500;font-display:swap;src:url("fonts/FTSystemMono-Medium.woff2") format("woff2");}
    :root{
      --coder-ink:rgb(9,11,11);--coder-ink-soft:rgb(47,45,51);--coder-white:rgb(255,255,255);
      --coder-purple-900:rgb(41,36,68);--coder-purple-600:rgb(117,17,226);--coder-purple-400:rgb(188,124,255);
      --coder-magenta:rgb(240,141,255);--coder-cyan:rgb(1,242,255);--coder-green:rgb(102,255,171);
      --coder-coral:rgb(255,128,103);--coder-blue:rgb(72,147,252);
      --font-display:'Lay Grotesk','Plus Jakarta Sans',system-ui,sans-serif;
      --font-mono:'FT System Mono','IBM Plex Mono',monospace;
    }
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;
      display:flex;align-items:center;justify-content:center;
      font-family:'Lay Grotesk','Plus Jakarta Sans',system-ui,sans-serif;color:rgb(237,237,237);}
    /* Custom-art cards: when a showcase strip overlays the bottom, inset the art
       so it centers ABOVE the caption instead of floating with a gap below. */
    body.has-showcase{padding-bottom:24%;box-sizing:border-box;align-items:center;}
    /* Default (no-custom-art) card: name + role + status + handle are ONE centered
       vertical stack — balanced, not a floating name over a bottom-pinned caption. */
    body.default-body{padding:0;}
    .fallback{font-size:clamp(1.4rem,9vw,3rem);font-weight:800;text-shadow:0 0 24px currentColor;}
    /* Default (no-custom-html) card: name-led, on-brand, one centered stack. */
    .card-default{display:flex;flex-direction:column;align-items:center;justify-content:center;
      width:100%;height:100%;background:var(--coder-ink);padding:6% 7%;box-sizing:border-box;
      gap:clamp(.25em,1.8%,.5em);text-align:center;}
    .card-default .cd-name{font-family:var(--font-display);font-weight:600;
      color:var(--coder-white);letter-spacing:-.01em;line-height:1.05;
      font-size:clamp(1.5rem,11vw,3.1rem);margin-bottom:.05em;}
    /* In the default stack the showcase pieces are in normal flow (not the absolute
       overlay), so reset their absolute/overlay positioning here. */
    .card-default .showcase{position:static;font-family:var(--font-display);
      font-size:clamp(.55rem,3.2vw,.9rem);line-height:1.25;color:rgba(255,255,255,.82);
      letter-spacing:.01em;max-width:96%;}
    .card-default .role{font-weight:600;color:var(--coder-white);}
    .card-default .tagline{color:rgba(255,255,255,.66);}
    .card-default .dot{margin:0 .4em;color:rgba(255,255,255,.4);}
    .card-default .status{position:static;margin-top:.15em;}
    .card-default .handle{position:static;margin-top:.35em;}
    .handle{position:absolute;bottom:5%;left:0;right:0;text-align:center;
      font-family:'FT System Mono','IBM Plex Mono',monospace;font-size:clamp(.5rem,3vw,.75rem);
      letter-spacing:-.02em;color:rgba(255,255,255,.55);}
    /* Contact link — the ONLY clickable element (sandbox allows popups only). */
    .contact{font-family:'FT System Mono','IBM Plex Mono',monospace;
      font-size:clamp(.5rem,2.8vw,.72rem);letter-spacing:.01em;color:var(--coder-cyan);
      text-decoration:none;border-bottom:1px solid rgba(1,242,255,.45);
      pointer-events:auto;max-width:94%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .overlay .contact{position:relative;z-index:2;margin-top:.1em;}
    .card-default .contact{margin-top:.2em;}
    /* Showcase strip — Coder Design System tokens (cyan/green/coral/purple),
     * radius-full pills, mono labels. Literal values: an iframe can't read the
     * parent page's CSS variables. */
    .overlay{position:absolute;left:0;right:0;bottom:0;padding:5% 5% 3%;
      display:flex;flex-direction:column;align-items:center;gap:.25em;
      pointer-events:none;}
    .overlay.has-showcase{background:linear-gradient(180deg,transparent,rgba(9,11,11,.78));}
    .overlay .showcase{font-family:'Lay Grotesk','Plus Jakarta Sans',system-ui,sans-serif;
      font-size:clamp(.5rem,3vw,.8rem);line-height:1.2;color:rgba(255,255,255,.82);text-align:center;
      letter-spacing:.02em;max-width:96%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .overlay .role{font-weight:600;color:rgb(255,255,255);}
    .overlay .dot{margin:0 .4em;color:rgba(255,255,255,.4);}
    .overlay .tagline{color:rgba(255,255,255,.7);}
    .overlay .status,.card-default .status{font-family:'FT System Mono','IBM Plex Mono',monospace;
      font-size:clamp(.45rem,2.6vw,.7rem);font-weight:500;letter-spacing:.02em;
      padding:.14em .65em;border-radius:9999px;border:1px solid transparent;}
    .overlay .status.st-hiring,.card-default .status.st-hiring{color:rgb(1,242,255);border-color:rgba(1,242,255,.5);background:rgba(1,242,255,.08);}
    .overlay .status.st-seeking,.overlay .status.st-open,.overlay .status.st-open-to-work,.card-default .status.st-seeking,.card-default .status.st-open,.card-default .status.st-open-to-work{color:rgb(102,255,171);border-color:rgba(102,255,171,.5);background:rgba(102,255,171,.08);}
    .overlay .status.st-freelance,.card-default .status.st-freelance{color:rgb(255,128,103);border-color:rgba(255,128,103,.5);background:rgba(255,128,103,.08);}
    .overlay .status.st-learning,.card-default .status.st-learning{color:rgb(188,124,255);border-color:rgba(188,124,255,.5);background:rgba(188,124,255,.08);}
    ${css}
  </style></head>${isCustom
    ? `<body class="${hasShowcase ? 'has-showcase' : ''}">${n.html}<div class="overlay${hasShowcase ? ' has-showcase' : ''}">${caption}${pill}<div class="handle" style="position:static">@${handle}</div>${linkEl}</div></body>`
    : `<body class="default-body"><div class="card-default"><div class="cd-name"${n.color ? ` style="color:${esc(n.color)}"` : ''}>${esc(n.name || handle)}</div>${caption}${pill}<div class="handle" style="position:static">@${handle}</div>${linkEl}</div></body>`}</html>`;
}


// Pick a layout density tier from the number of names so a large wall still
// fits one screen (it's projected — no scrolling). Cards shrink as count grows.
function densityFor(n) {
  if (n <= 12) return "cozy";
  if (n <= 30) return "medium";
  if (n <= 60) return "dense";
  if (n <= 120) return "packed";
  return "huge";
}

async function tick() {
  let names;
  try {
    names = await (await fetch("/api/names", { cache: "no-store" })).json();
    loaded = true; // first good fetch — switch to the steady cadence
  } catch {
    return; // transient (e.g. cold app-proxy tunnel); keep what's on screen
  }

  // Clear any non-card content (e.g. the initial empty-state node) so the
  // placeholder never lingers next to real names.
  for (const child of Array.from(wall.childNodes)) {
    if (child.nodeType !== 1 || !child.classList.contains("name")) child.remove();
  }

  // Normalize a name's status into a canonical filter key (or "" for none).
function statusKeyOf(n) {
  const k = String(n.status || "").toLowerCase().trim()
    .replace(/\s+/g, "-").replace(/[^a-z-]/g, "");
  if (k === "open" || k === "open-to-work" || k === "opentowork") return "seeking";
  if (["hiring", "seeking", "freelance", "learning"].includes(k)) return k;
  return "";
}

const present = new Set();
  for (const n of names) {
    const k = keyOf(n);
    present.add(k);
    const sig = sigOf(n);
    let entry = seen.get(k);
    if (!entry) {
      // new entry → create a sandboxed iframe card, animate it in once
      const card = document.createElement("div");
      card.className = "name name--enter";
      card.dataset.handle = k;
      card.dataset.status = statusKeyOf(n);
      // Make the WHOLE card clickable when the person shared a contact link.
      const lk = safeLink(n.link || n.url, n.contact);
      if (lk) {
        card.classList.add("has-link");
        card.dataset.link = lk.href;
        card.title = `Open ${lk.label}`;
        card.addEventListener("click", () => {
          if (card.dataset.link) window.open(card.dataset.link, "_blank", "noopener,noreferrer");
        });
      }
      const frame = document.createElement("iframe");
      frame.className = "name-frame";
      frame.setAttribute("sandbox", ""); // CSS only — no scripts, no popups; the parent card handles clicks
      frame.setAttribute("scrolling", "no");
      frame.srcdoc = docFor(n);
      card.appendChild(frame);
      // Tiny "fullscreen" button, top-right, revealed on hover. Opens this card
      // big in a modal so a single entry can be reviewed up close (and the
      // attendee-preview flow can trigger it for their own card).
      const expandBtn = document.createElement("button");
      expandBtn.className = "name-expand";
      expandBtn.type = "button";
      expandBtn.title = "View fullscreen";
      expandBtn.setAttribute("aria-label", `View ${k} fullscreen`);
      // expand/fullscreen glyph (inline SVG so no external load)
      expandBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 9V4h5v2H6v3H4zm0 6h2v3h3v2H4v-5zm16 0v5h-5v-2h3v-3h2zM15 6V4h5v5h-2V6h-3z"/></svg>';
      expandBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // don't trigger the card's contact-link click
        openModal(k);
      });
      card.appendChild(expandBtn);
      wall.appendChild(card);
      card.addEventListener("animationend", () => card.classList.remove("name--enter"), { once: true });
      seen.set(k, { card, frame, sig, name: n });
    } else if (entry.sig !== sig) {
      // content changed → refresh the iframe in place (no re-animate)
      entry.frame.srcdoc = docFor(n);
      entry.name = n; // keep latest data for the modal
      entry.card.dataset.status = statusKeyOf(n);
      // keep the card-level link in sync
      const lk2 = safeLink(n.link || n.url, n.contact);
      if (lk2) {
        entry.card.classList.add("has-link");
        entry.card.dataset.link = lk2.href;
        entry.card.title = `Open ${lk2.label}`;
      } else {
        entry.card.classList.remove("has-link");
        delete entry.card.dataset.link;
        entry.card.removeAttribute("title");
      }
      entry.sig = sig;
      // if this card is currently open in the modal, refresh the big view too
      if (modalHandle === k) renderModal(n);
    }
  }
  // remove entries that disappeared
  for (const [k, entry] of seen) {
    if (!present.has(k)) {
      entry.card.remove();
      seen.delete(k);
    }
  }

  countEl.textContent = String(names.length);
  document.body.dataset.density = densityFor(names.length);
  updateFilterBar(names);
  applyFilter();

  // Honor a ?expand=<handle> request once the card exists (used by the
  // attendee-preview flow to auto-open their own card big for review).
  if (pendingExpand && seen.has(pendingExpand)) {
    const h = pendingExpand;
    pendingExpand = null;
    openModal(h);
  }

  // Empty state. Before the first successful load show a calm "Connecting"
  // message (the app-proxy tunnel may still be warming); only show the real
  // "no names yet" prompt once we've actually loaded and the wall is empty.
  let empty = wall.querySelector(".wall-empty");
  if (!names.length && !wall.querySelector(".name")) {
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "wall-empty";
      wall.appendChild(empty);
    }
    empty.textContent = loaded
      ? "No names on the wall yet. Tell the agent to add yours."
      : "Connecting to the wall…";
  } else if (empty) {
    empty.remove();
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ─── Fullscreen / modal view for a single name ───────────────────────────────
// Pops one card big and centered so it can be reviewed up close. Reuses the
// exact same sandboxed docFor() render at a large size. The attendee-preview
// flow opens the attendee's own card via ?expand=<handle> (or openModal()).
let modalEl = null;
let modalFrame = null;
let modalTitle = null;
let modalLinks = null;
let modalHandle = null;
let pendingExpand = (new URLSearchParams(location.search).get("expand") || "").toLowerCase() || null;

function buildModal() {
  if (modalEl) return;
  modalEl = document.createElement("div");
  modalEl.className = "name-modal";
  modalEl.hidden = true;
  modalEl.innerHTML =
    '<div class="nm-backdrop"></div>' +
    '<div class="nm-dialog" role="dialog" aria-modal="true" aria-label="Name preview">' +
    '  <div class="nm-head">' +
    '    <span class="nm-title"></span>' +
    '    <span class="nm-links"></span>' +
    '    <button class="nm-close" type="button" title="Close (Esc)" aria-label="Close">' +
    '      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41L10.59 13.4l-6.3 6.3 1.41 1.41 6.3-6.3 6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.29z"/></svg>' +
    '    </button>' +
    '  </div>' +
    '  <div class="nm-stage"><iframe class="nm-frame" sandbox="" scrolling="no"></iframe></div>' +
    '</div>';
  document.body.appendChild(modalEl);
  modalFrame = modalEl.querySelector(".nm-frame");
  modalTitle = modalEl.querySelector(".nm-title");
  modalLinks = modalEl.querySelector(".nm-links");
  modalEl.querySelector(".nm-close").addEventListener("click", closeModal);
  modalEl.querySelector(".nm-backdrop").addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
}

function renderModal(n) {
  if (!modalFrame) return;
  modalFrame.srcdoc = docFor(n);
  modalTitle.textContent = (n.name || n.handle || "") + (n.handle ? `  ·  @${n.handle}` : "");
  // Contributor + PR links live HERE (in the modal), not on the card hover. The
  // handle is the GitHub login by convention (names/<handle>.json).
  const login = String(n.handle || "").replace(/[^A-Za-z0-9-]/g, "");
  if (login) {
    const ghHref = `https://github.com/${login}`;
    const prHref = `https://github.com/${WALL_REPO}/pulls?q=` +
      encodeURIComponent(`is:pr author:${login}`);
    modalLinks.innerHTML =
      `<a class="nm-link" href="${ghHref}" target="_blank" rel="noopener" title="@${login} on GitHub">` +
      `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>` +
      `@${login}</a>` +
      `<a class="nm-link nm-link-pr" href="${prHref}" target="_blank" rel="noopener" title="View @${login}'s pull request">` +
      `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M5 3.25a1.75 1.75 0 1 0-2.5 1.58v6.34a1.75 1.75 0 1 0 1.5 0V4.83A1.75 1.75 0 0 0 5 3.25zM3.75 2.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zm0 10a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zm8.5-1.42V5.5A2.5 2.5 0 0 0 9.75 3H8.66l.97-.97L8.57.97 5.79 3.75l2.78 2.78 1.06-1.06-.97-.97h1.09a1 1 0 0 1 1 1v5.58a1.75 1.75 0 1 0 1.5 0zM11.5 14a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z"/></svg>` +
      `PR</a>`;
  } else {
    modalLinks.innerHTML = "";
  }
}

function openModal(handle) {
  buildModal();
  const entry = seen.get(handle);
  if (!entry) { pendingExpand = handle; return; } // not rendered yet — open when it appears
  modalHandle = handle;
  renderModal(entry.name);
  modalEl.hidden = false;
  // next frame: add the "open" class so the CSS transition runs
  requestAnimationFrame(() => modalEl.classList.add("open"));
}

function closeModal() {
  if (!modalEl || modalEl.hidden) return;
  modalEl.classList.remove("open");
  modalHandle = null;
  // Hide IMMEDIATELY (display:none via [hidden]) so the fixed-position overlay
  // can't keep intercepting clicks on the wall during/after the fade. We clear
  // the iframe after the transition; the element itself is already non-blocking.
  modalEl.hidden = true;
  // clear ?expand= from the URL so a refresh doesn't re-open it
  const u = new URL(location.href);
  if (u.searchParams.has("expand")) { u.searchParams.delete("expand"); history.replaceState(null, "", u); }
  setTimeout(() => { if (modalEl && modalEl.hidden) modalFrame.srcdoc = ""; }, 220);
}

// Expose for external triggers (e.g. the preview flow can call
// window.expandCard("<handle>") from the page console / a launcher).
window.expandCard = openModal;


// On a freshly-started display the Coder app-proxy tunnel can be cold, so the
// first fetch may fail or lag. Poll fast (600ms) until the first success, then
// settle to a calm 3s cadence — so the wall paints as soon as the tunnel is
// ready instead of waiting a full 3s, without hammering once it's up.
let loaded = false;
(function pollNames() {
  tick().finally(() => {
    setTimeout(pollNames, loaded ? 3000 : 600);
  });
})();


// ─── Live activity indicator (admin display only) ─────────────────────────────
// Polls /api/active; shows "N active now" when the server has Coder API access
// (the Wall-of-Fame display). On attendee previews there's no token so it stays
// hidden. "Active" = someone with a running workshop workspace right now.
async function activityTick() {
  const box = document.getElementById("activity");
  const num = document.getElementById("active-count");
  if (!box) return;
  try {
    const a = await (await fetch("/api/active")).json();
    if (a && a.available) {
      num.textContent = String(a.count);
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  } catch {
    box.hidden = true;
  }
}
activityTick();
setInterval(activityTick, 5000);


// ─── PR queue panel (admin display only) ──────────────────────────────────────
// Polls /api/pending; shows open PRs to the wall repo as a live queue so the
// room can watch changes line up before they auto-merge. Auto-refreshes.
const queueSeen = new Map(); // pr number -> { li, sig }
async function queueTick() {
  const box = document.getElementById("queue");
  const list = document.getElementById("queue-list");
  const count = document.getElementById("queue-count");
  if (!box) return;
  let q;
  try {
    q = await (await fetch("/api/pending")).json();
  } catch {
    return; // transient; keep what's shown (no flicker)
  }
  if (!q || !q.available) { box.hidden = true; return; }
  box.hidden = false;
  count.textContent = String(q.count);

  const prs = q.prs || [];
  // empty-state node, toggled without wiping real rows
  let emptyLi = list.querySelector(".queue-empty");
  if (!prs.length) {
    for (const [, e] of queueSeen) e.li.remove();
    queueSeen.clear();
    if (!emptyLi) {
      emptyLi = document.createElement("li");
      emptyLi.className = "queue-empty";
      emptyLi.textContent = "All caught up";
      list.appendChild(emptyLi);
    }
    return;
  }
  if (emptyLi) emptyLi.remove();

  // Diff by PR number: add new rows (animate once), update changed ones in
  // place, remove gone ones. No full rebuild → no flicker.
  const present = new Set();
  for (const pr of prs) {
    present.add(pr.number);
    const st = pr.status || "queued";
    const stLabel = {
      reviewing: "reviewing",
      "changes-requested": "changes requested",
      "re-review": "re-reviewing",
      approved: "approved",
      conflicts: "conflicts",
      queued: "queued",
    }[st] || st;
    const sig = `${pr.user}|${pr.title}|${st}|${pr.url || ""}`;
    const prHref = pr.url ? esc(pr.url) : `https://github.com/${esc(WALL_REPO)}/pull/${pr.number}`;
    const userHref = pr.user ? `https://github.com/${esc(pr.user)}` : "";
    const userEl = pr.user
      ? `<a class="pr-user" href="${userHref}" target="_blank" rel="noopener" title="@${esc(pr.user)} on GitHub">@${esc(pr.user)}</a>`
      : `<span class="pr-user"></span>`;
    const html = `${userEl} <a class="pr-title" href="${prHref}" target="_blank" rel="noopener" title="Open PR #${pr.number}">${esc(pr.title || "")}</a> <span class="pr-status st-${esc(st)}">${esc(stLabel)}</span> <a class="pr-num" href="${prHref}" target="_blank" rel="noopener" title="Open PR #${pr.number}">#${pr.number}</a>`;
    let e = queueSeen.get(pr.number);
    if (!e) {
      const li = document.createElement("li");
      li.innerHTML = html;
      list.appendChild(li);
      queueSeen.set(pr.number, { li, sig });
    } else if (e.sig !== sig) {
      e.li.innerHTML = html;
      e.sig = sig;
    }
  }
  for (const [num, e] of queueSeen) {
    if (!present.has(num)) { e.li.remove(); queueSeen.delete(num); }
  }
}
queueTick();
setInterval(queueTick, 3000);


// ─── Attendee roster (admin display only) ─────────────────────────────────────
// Polls /api/members; shows everyone who's logged in, an online dot, and flags
// who still needs the agents-access role (the role bot grants it automatically,
// so this is a live health view). Hover a "needs role" row for the detail.
const rosterSeen = new Map(); // username -> { li, sig }
async function rosterTick() {
  const box = document.getElementById("roster");
  const list = document.getElementById("roster-list");
  const count = document.getElementById("roster-count");
  if (!box) return;
  let m;
  try {
    m = await (await fetch("/api/members")).json();
  } catch {
    return; // transient; keep what's shown
  }
  if (!m || !m.available) { box.hidden = true; return; }
  box.hidden = false;
  const members = (m.members || []).slice().sort((a, b) => {
    // online first, then those needing a role, then alphabetical
    if (a.online !== b.online) return a.online ? -1 : 1;
    if (a.has_agents !== b.has_agents) return a.has_agents ? 1 : -1;
    return a.username.localeCompare(b.username);
  });
  const onlineCount = members.filter((u) => u.online).length;
  count.textContent = String(onlineCount);

  let emptyLi = list.querySelector(".roster-empty");
  if (!members.length) {
    for (const [, e] of rosterSeen) e.li.remove();
    rosterSeen.clear();
    if (!emptyLi) {
      emptyLi = document.createElement("li");
      emptyLi.className = "roster-empty";
      emptyLi.textContent = "No attendees yet";
      list.appendChild(emptyLi);
    }
    return;
  }
  if (emptyLi) emptyLi.remove();

  const present = new Set();
  for (const u of members) {
    present.add(u.username);
    const sig = `${u.online}|${u.has_agents}|${u.is_admin}`;
    const dot = `<span class="r-dot ${u.online ? "on" : "off"}"></span>`;
    const badge = u.has_agents
      ? `<span class="r-badge ok">${u.is_admin ? "admin" : "agent"}</span>`
      : `<span class="r-badge need" title="Needs the agents-access role — the role bot grants it automatically; if this lingers, check the role bot.">needs role</span>`;
    const html = `${dot}<span class="r-user">@${esc(u.username)}</span>${badge}`;
    let e = rosterSeen.get(u.username);
    if (!e) {
      const li = document.createElement("li");
      li.className = "roster-row";
      li.innerHTML = html;
      li.style.cursor = "pointer";
      li.title = `Jump to ${u.username}'s card`;
      li.addEventListener("click", () => {
        const card = wall.querySelector(`.name[data-handle="${u.username}"]`);
        if (!card) return;
        card.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        card.classList.add("name--highlight");
        card.addEventListener("animationend", () => card.classList.remove("name--highlight"), { once: true });
      });
      list.appendChild(li);
      rosterSeen.set(u.username, { li, sig });
    } else if (e.sig !== sig) {
      e.li.innerHTML = html;
      e.sig = sig;
    }
    // keep DOM order roughly matching the sort
    list.appendChild(rosterSeen.get(u.username).li);
  }
  for (const [name, e] of rosterSeen) {
    if (!present.has(name)) { e.li.remove(); rosterSeen.delete(name); }
  }
}
rosterTick();
setInterval(rosterTick, 4000);
