// Renders the wall by DIFFING against the DOM — new names animate in once,
// existing names stay put (no full re-render, so no flicker). Color changes
// update in place.

const wall = document.getElementById("wall");
const countEl = document.getElementById("count");
const seen = new Map(); // handle -> { el, color, name }

function keyOf(n) {
  return n.handle || n.name || JSON.stringify(n);
}

async function tick() {
  let names;
  try {
    names = await (await fetch("/api/names")).json();
  } catch {
    return; // transient; keep what's on screen
  }

  // Clear any non-.name content (e.g. the initial "Loading…"/empty-state node)
  // so the placeholder never lingers next to real names.
  for (const child of Array.from(wall.childNodes)) {
    if (child.nodeType !== 1 || !child.classList.contains("name")) child.remove();
  }

  const present = new Set();
  for (const n of names) {
    const k = keyOf(n);
    present.add(k);
    const color = n.color || "#ffffff";
    const label = n.name || n.handle || "";
    let entry = seen.get(k);
    if (!entry) {
      // new name → create + animate in once
      const el = document.createElement("div");
      el.className = "name name--enter";
      el.style.color = color;
      el.innerHTML = `${esc(label)}<small>@${esc(n.handle || "")}</small>`;
      wall.appendChild(el);
      // remove the enter class after the animation so it never replays
      el.addEventListener("animationend", () => el.classList.remove("name--enter"), { once: true });
      seen.set(k, { el, color, name: label });
    } else if (entry.color !== color || entry.name !== label) {
      // changed → update in place, no re-animate
      entry.el.style.color = color;
      entry.el.innerHTML = `${esc(label)}<small>@${esc(n.handle || "")}</small>`;
      entry.color = color;
      entry.name = label;
    }
  }
  // remove names that disappeared
  for (const [k, entry] of seen) {
    if (!present.has(k)) {
      entry.el.remove();
      seen.delete(k);
    }
  }

  countEl.textContent = String(names.length);

  // Empty state (only when there are genuinely zero names)
  let empty = wall.querySelector(".wall-empty");
  if (!names.length && !wall.querySelector(".name")) {
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "wall-empty";
      empty.textContent = "No names yet — be the first! Tell the agent your name and color.";
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
