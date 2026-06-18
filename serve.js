// Tiny zero-dependency preview server for the Wall of Names.
//   node serve.js   →   http://localhost:8080
//
// Serves the static files (index.html, style.css, wall.js) and a dynamic
// /api/names endpoint that reads every names/*.json at request time. No build
// step, no shared manifest file — so each attendee only ever creates their own
// names/<handle>.json and the wall picks it up on the next refresh.

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;

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

http
  .createServer((req, res) => {
    if (req.url === "/api/names") {
      res.writeHead(200, { "Content-Type": TYPES[".json"] });
      res.end(JSON.stringify(readNames()));
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
