// Renders the wall by DIFFING against the DOM — new names animate in once,
// existing names stay put (no full re-render, so no flicker). Color changes
// update in place.

const wall = document.getElementById("wall");
const countEl = document.getElementById("count");
const seen = new Map(); // handle -> { el, color, name }

// Admin mode: ?admin in the URL (the Wall of Fame display sets this) shows a badge.
const ADMIN = new URLSearchParams(location.search).has("admin");

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
  if (wall.dataset.empty === "1" && names.length) {
    wall.dataset.empty = "0";
  }
  if (!names.length && wall.childElementCount === 0) {
    wall.dataset.empty = "1";
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

if (ADMIN) document.body.classList.add("admin");

tick();
setInterval(tick, 3000);
