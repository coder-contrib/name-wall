// Renders the wall by DIFFING against the DOM — new names animate in once,
// existing names stay put (no full re-render, so no flicker). Color changes
// update in place.

const wall = document.getElementById("wall");
const countEl = document.getElementById("count");
const seen = new Map(); // handle -> { card, frame, sig }

function keyOf(n) {
  return n.handle || n.name || JSON.stringify(n);
}

// A signature of the entry's visual content, so we only re-render a card when
// its content actually changes (no flicker on unrelated polls).
function sigOf(n) {
  return JSON.stringify([n.name, n.handle, n.color, n.html, n.css]);
}

// Build the sandboxed HTML document for one name. Each entry gets a full
// HTML/CSS canvas (animations, movement, components) rendered inside an
// <iframe sandbox> with NO scripts allowed — so creative CSS is fully
// supported while arbitrary JS / XSS can't run on the shared wall, and one
// entry's styles can't leak out and break the layout or other names.
function docFor(n) {
  const handle = esc(n.handle || "");
  const body = n.html
    ? n.html
    : `<div class="fallback" style="color:${esc(n.color || "#fff")}">${esc(n.name || handle)}</div>`;
  const css = n.css || "";
  // The iframe fills its whole region; html/body are 100%/100% so the author's
  // art covers the box at any size. Authors design responsively (%, vw/vh, flex,
  // clamp) against this box rather than a fixed pixel canvas.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;
      display:flex;align-items:center;justify-content:center;
      font-family:'Lay Grotesk',system-ui,sans-serif;color:#e6e8ee;}
    .fallback{font-size:clamp(1.4rem,9vw,3rem);font-weight:800;text-shadow:0 0 24px currentColor;}
    .handle{position:absolute;bottom:5%;left:0;right:0;text-align:center;
      font-family:'FT System Mono',monospace;font-size:clamp(.5rem,3vw,.75rem);color:#8b93a7;}
    ${css}
  </style></head><body>${body}<div class="handle">@${handle}</div></body></html>`;
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
    names = await (await fetch("/api/names")).json();
  } catch {
    return; // transient; keep what's on screen
  }

  // Clear any non-card content (e.g. the initial empty-state node) so the
  // placeholder never lingers next to real names.
  for (const child of Array.from(wall.childNodes)) {
    if (child.nodeType !== 1 || !child.classList.contains("name")) child.remove();
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
      const frame = document.createElement("iframe");
      frame.className = "name-frame";
      frame.setAttribute("sandbox", ""); // no scripts, no same-origin → CSS only
      frame.setAttribute("scrolling", "no");
      frame.srcdoc = docFor(n);
      card.appendChild(frame);
      wall.appendChild(card);
      card.addEventListener("animationend", () => card.classList.remove("name--enter"), { once: true });
      seen.set(k, { card, frame, sig });
    } else if (entry.sig !== sig) {
      // content changed → refresh the iframe in place (no re-animate)
      entry.frame.srcdoc = docFor(n);
      entry.sig = sig;
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

  // Empty state (only when there are genuinely zero names)
  let empty = wall.querySelector(".wall-empty");
  if (!names.length && !wall.querySelector(".name")) {
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "wall-empty";
      empty.textContent = "No names yet — be the first! Ask the agent to make your name come alive.";
      wall.appendChild(empty);
    }
  } else if (empty) {
    empty.remove();
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

tick();
setInterval(tick, 3000);


// ─── Live activity indicator (admin display only) ─────────────────────────────
// Polls /api/active; shows "🟢 N active now" when the server has a Coder token
// (the Wall-of-Fame display). On attendee previews there's no token so it stays
// hidden. "Active" = Coder last_seen_at within the last 5 minutes.
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
    const sig = `${pr.user}|${pr.title}`;
    const html = `<span class="pr-user">@${esc(pr.user || "")}</span> <span class="pr-title">${esc(pr.title || "")}</span> <span class="pr-num">#${pr.number}</span>`;
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
