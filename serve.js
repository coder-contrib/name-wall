// Tiny zero-dependency preview server for the Wall of Names.
//   node serve.js   →   http://localhost:8080
//
// Serves the static files and:
//   /api/names   — reads every names/*.json at request time (no build step,
//                  no shared manifest; each attendee only edits their own file)
//   /api/active  — if a Coder token is in the env (CODER_SESSION_TOKEN +
//                  CODER_URL, present on the admin Wall-of-Fame display), returns
//                  users active in the last 5 minutes (Coder last_seen_at).
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
const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // "active in the last 5 minutes"

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

// Query Coder for users seen within the activity window.
function readActive(cb) {
  if (!CODER_TOKEN) return cb({ available: false });
  const url = new URL(CODER_URL + "/api/v2/users?limit=1000");
  const lib = url.protocol === "https:" ? https : http;
  const req = lib.request(
    url,
    { headers: { "Coder-Session-Token": CODER_TOKEN }, timeout: 4000 },
    (r) => {
      let body = "";
      r.on("data", (c) => (body += c));
      r.on("end", () => {
        try {
          const users = JSON.parse(body).users || [];
          const cutoff = Date.now() - ACTIVE_WINDOW_MS;
          const active = users
            .filter((u) => u.last_seen_at && Date.parse(u.last_seen_at) >= cutoff)
            .map((u) => u.username);
          cb({ available: true, count: active.length, users: active });
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
