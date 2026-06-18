// Fetches the list of names from the local preview server (/api/names),
// which reads the names/ directory at request time — so a newly added
// names/<handle>.json shows up on refresh with no shared manifest to edit.
async function render() {
  const wall = document.getElementById("wall");
  const count = document.getElementById("count");
  try {
    const res = await fetch("/api/names");
    const names = await res.json();
    if (!names.length) {
      wall.textContent = "No names yet — be the first!";
      return;
    }
    wall.innerHTML = "";
    for (const n of names) {
      const el = document.createElement("div");
      el.className = "name";
      el.style.color = n.color || "#e6e8ee";
      el.innerHTML = `${escapeHtml(n.name || n.handle)}<small>@${escapeHtml(n.handle || "")}</small>`;
      wall.appendChild(el);
    }
    count.textContent = String(names.length);
  } catch (e) {
    wall.textContent = "Could not load names. Is the preview server running?";
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

render();
setInterval(render, 3000); // auto-refresh so a new file appears within ~3s
