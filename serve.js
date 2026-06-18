// Tiny zero-dependency preview server for the Wall of Names.
//   node serve.js   →   http://localhost:8080
//
// Serves the static files and:
//   /api/names   — reads every names/*.json at request time (no build step,
//                  no shared manifest; each attendee only edits their own file)
//   /api/active  — if a Coder token is in the env (CODER_SESSION_TOKEN +
//                  CODER_URL, present on the admin Wall-of-Fame display), returns
//                  the count of distinct people with a workshop workspace going
//                  right now (running build + agent connected in the last 5 min).
//                  Returns {available:false} when no token (attendee preview).

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;

// Coder API access for the live-activity indicator (admin display only).
const CODER_URL = (process.env.CODER_URL || "http://localhost:3000").replace(/\/$/, "");
const CODER_TOKEN = process.env.CODER_SESSION_TOKEN || process.env.CODER_TOKEN || "";
const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // "active now" = activity in last 5 min
// Owners to exclude from the "active now" count (workshop hosts/admins, not
// attendees). Comma-separated usernames in ACTIVE_EXCLUDE; defaults to admin.
const ACTIVE_EXCLUDE = new Set(
  (process.env.ACTIVE_EXCLUDE || "admin").split(",").map((s) => s.trim()).filter(Boolean)
);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

function readNames() {
  const dir = path.join(ROOT, "names");
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
    } catch {
      /* skip malformed entries so one bad file can't break the wall */
    }
  }
  return out;
}

// Count people actively doing the workshop right now. We use WORKSPACES, not
// users: Coder only refreshes user.last_seen_at about once an hour (throttled in
// the apikey middleware: it writes last_seen_at only when key.LastUsed is >1h
// old), so a 5-minute "active now" can't be derived from it. A workspace's agent
// last_connected_at is a real heartbeat (updates every few seconds), and
// last_used_at tracks interaction — either being recent means the person is here.
function readActive(cb) {
  if (!CODER_TOKEN) return cb({ available: false });
  const url = new URL(CODER_URL + "/api/v2/workspaces?limit=1000");
  const lib = url.protocol === "https:" ? https : http;
  const req = lib.request(
    url,
    { headers: { "Coder-Session-Token": CODER_TOKEN }, timeout: 4000 },
    (r) => {
      let body = "";
      r.on("data", (c) => (body += c));
      r.on("end", () => {
        try {
          const list = JSON.parse(body).workspaces || [];
          const cutoff = Date.now() - ACTIVE_WINDOW_MS;
          const recent = (t) => t && Date.parse(t) >= cutoff;
          const owners = new Set();
          for (const w of list) {
            const owner = w.owner_name;
            if (!owner || ACTIVE_EXCLUDE.has(owner)) continue;
            if ((w.latest_build && w.latest_build.status) !== "running") continue;
            // Agent heartbeat (preferred) or recent interaction.
            let live = recent(w.last_used_at);
            const resources = (w.latest_build && w.latest_build.resources) || [];
            for (const res of resources) {
              for (const a of res.agents || []) {
                if (recent(a.last_connected_at)) live = true;
              }
            }
            if (live) owners.add(owner);
          }
          cb({ available: true, count: owners.size, users: [...owners] });
        } catch {
          cb({ available: false });
        }
      });
    }
  );
  req.on("error", () => cb({ available: false }));
  req.on("timeout", () => { req.destroy(); cb({ available: false }); });
  req.end();
}

// Small helper: GET a Coder API path with the admin token, parse JSON.
function coderGet(p, cb) {
  if (!CODER_TOKEN) return cb(null);
  const url = new URL(CODER_URL + p);
  const lib = url.protocol === "https:" ? https : http;
  const req = lib.request(url, { headers: { "Coder-Session-Token": CODER_TOKEN }, timeout: 4000 }, (r) => {
    let body = "";
    r.on("data", (c) => (body += c));
    r.on("end", () => { try { cb(JSON.parse(body)); } catch { cb(null); } });
  });
  req.on("error", () => cb(null));
  req.on("timeout", () => { req.destroy(); cb(null); });
  req.end();
}

// Admin roster: every org member, whether they hold the agents-access role (so
// the Agents UI works) and whether they're online now. Lets the host see who
// just logged in and who still needs the role (the role bot grants it, but this
// surfaces lag/failures). Needs the admin Coder token; else {available:false}.
const AGENTS_ROLE = process.env.AGENTS_ROLE || "agents-access";
function readMembers(cb) {
  if (!CODER_TOKEN) return cb({ available: false });
  coderGet("/api/v2/users/me", (me) => {
    const org = me && me.organization_ids && me.organization_ids[0];
    if (!org) return cb({ available: false });
    let members = null, online = null;
    const done = () => {
      if (members === null || online === null) return;
      const list = (members || []).map((m) => {
        const roles = (m.roles || []).map((r) => r.name);
        return {
          username: m.username,
          has_agents: roles.includes(AGENTS_ROLE) || roles.includes("organization-admin"),
          is_admin: roles.includes("organization-admin"),
          online: online.has(m.username),
        };
      }).filter((m) => !ACTIVE_EXCLUDE.has(m.username));
      cb({ available: true, count: list.length, members: list });
    };
    coderGet("/api/v2/organizations/" + org + "/members", (ms) => { members = ms || []; done(); });
    readActive((a) => { online = new Set(a && a.available ? a.users : []); done(); });
  });
}

// Query GitHub for open PRs to the wall repo (the live "PR queue"). Needs a
// GitHub token in the env (GITHUB_TOKEN), present on the admin display.
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const WALL_REPO = process.env.WALL_REPO || "coder-contrib/name-wall";
// GitHub GET helper (REST, token auth) returning parsed JSON.
function ghGet(path, cb) {
  if (!GH_TOKEN) return cb(null);
  const u = new URL("https://api.github.com" + path);
  const req = https.request(u, {
    headers: {
      "Authorization": `Bearer ${GH_TOKEN}`,
      "User-Agent": "name-wall",
      "Accept": "application/vnd.github+json",
    },
    timeout: 4000,
  }, (r) => {
    let body = "";
    r.on("data", (c) => (body += c));
    r.on("end", () => { try { cb(JSON.parse(body)); } catch { cb(null); } });
  });
  req.on("error", () => cb(null));
  req.on("timeout", () => { req.destroy(); cb(null); });
  req.end();
}

// Derive a human status for a PR from its review history + mergeability so the
// queue shows where each entry is: reviewing / changes-requested / re-review /
// conflicts / queued.
function prStatus(p, reviews) {
  if (p.mergeable_state === "dirty" || p.mergeable === false) return "conflicts";
  const rs = Array.isArray(reviews) ? reviews : [];
  // Last decisive review (APPROVED or CHANGES_REQUESTED), ignoring COMMENTED.
  let last = null;
  for (const rv of rs) {
    if (rv.state === "APPROVED" || rv.state === "CHANGES_REQUESTED") last = rv;
  }
  if (last && last.state === "CHANGES_REQUESTED") {
    // If the author pushed after the review, it needs another look.
    const pushed = Date.parse(p.updated_at || 0);
    const reviewed = Date.parse(last.submitted_at || 0);
    return pushed > reviewed + 1000 ? "re-review" : "changes-requested";
  }
  if (last && last.state === "APPROVED") return "approved";
  return "reviewing";
}

function readPending(cb) {
  if (!GH_TOKEN) return cb({ available: false });
  ghGet(`/repos/${WALL_REPO}/pulls?state=open&sort=created&direction=asc&per_page=50`, (prs) => {
    if (!Array.isArray(prs)) return cb({ available: false });
    let merged = new Set();
    try {
      const mf = process.env.MERGED_FILE || "/tmp/name-wall-merged";
      merged = new Set(fs.readFileSync(mf, "utf8").split(/\s+/).filter(Boolean).map(Number));
    } catch { /* no merged file yet */ }
    const open = prs.filter((p) => !merged.has(p.number));
    if (!open.length) return cb({ available: true, count: 0, prs: [] });
    // For each open PR, fetch its reviews AND its detail (the list endpoint
    // omits mergeable_state) in parallel, then derive a human status.
    let pending = open.length;
    const out = [];
    open.forEach((listPr, i) => {
      let reviews = null, detail = null, got = 0;
      const done = () => {
        if (++got < 2) return;
        const p = detail && detail.number ? detail : listPr;
        out[i] = {
          number: listPr.number,
          title: listPr.title,
          user: listPr.user && listPr.user.login,
          url: listPr.html_url,
          status: prStatus(p, reviews),
        };
        if (--pending === 0) cb({ available: true, count: out.length, prs: out });
      };
      ghGet(`/repos/${WALL_REPO}/pulls/${listPr.number}/reviews`, (r) => { reviews = r; done(); });
      ghGet(`/repos/${WALL_REPO}/pulls/${listPr.number}`, (d) => { detail = d; done(); });
    });
  });
}

http
  .createServer((req, res) => {
    if (req.url === "/api/names") {
      res.writeHead(200, { "Content-Type": TYPES[".json"] });
      res.end(JSON.stringify(readNames()));
      return;
    }
    if (req.url === "/api/active") {
      readActive((data) => {
        res.writeHead(200, { "Content-Type": TYPES[".json"] });
        res.end(JSON.stringify(data));
      });
      return;
    }
    if (req.url === "/api/pending") {
      readPending((data) => {
        res.writeHead(200, { "Content-Type": TYPES[".json"] });
        res.end(JSON.stringify(data));
      });
      return;
    }
    if (req.url === "/api/members") {
      readMembers((data) => {
        res.writeHead(200, { "Content-Type": TYPES[".json"] });
        res.end(JSON.stringify(data));
      });
      return;
    }
    let file = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const full = path.join(ROOT, path.normalize(file));
    if (!full.startsWith(ROOT) || !fs.existsSync(full)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(full)] || "application/octet-stream" });
    fs.createReadStream(full).pipe(res);
  })
  .listen(PORT, "0.0.0.0", () => console.log(`Wall of Names preview on http://0.0.0.0:${PORT}`));
