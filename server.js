"use strict";
// Night Routine — tiny state server. No dependencies.
// Serves ./public and keeps one JSON state document in DATA_DIR/state.json.
//   GET  /api/state            -> { state, serverTime }
//   PUT  /api/state            body { baseRev, state } -> 200 { state, serverTime } | 409 { state, serverTime }
//   GET  /api/events           -> Server-Sent Events: "rev" whenever the state changes
//   GET  /healthz              -> ok
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "8080", 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "state.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const BACKUP_KEEP = parseInt(process.env.BACKUP_KEEP || "30", 10);
const PUBLIC = path.join(__dirname, "public");
const MAX_BODY = 2 * 1024 * 1024;

// Personal labels come from the environment (see .env.example), so nothing personal lives in the code.
const APP_TITLE = process.env.APP_TITLE || "Homework & bedtime routine";
const APP_SHORT_NAME = process.env.APP_SHORT_NAME || "Night Routine";
const escHTML = v => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MANIFEST = JSON.stringify({
  name: APP_SHORT_NAME, short_name: APP_SHORT_NAME, start_url: "./", scope: "./", display: "standalone",
  background_color: "#111214", theme_color: "#111214",
  icons: [
    { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
});

fs.mkdirSync(BACKUP_DIR, { recursive: true });

let state = { rev: 0, config: null, run: null, history: [] };
try {
  const loaded = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (loaded && typeof loaded.rev === "number") state = loaded;
  console.log(`Loaded state rev ${state.rev} from ${FILE}`);
} catch (e) {
  if (e.code !== "ENOENT") console.error("Could not read state, starting fresh:", e.message);
}

function localDate(d = new Date()) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function persist() {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, FILE);
  // One backup per day (the day's last write wins), keep BACKUP_KEEP days.
  try {
    fs.copyFileSync(FILE, path.join(BACKUP_DIR, `state-${localDate()}.json`));
    const old = fs.readdirSync(BACKUP_DIR).filter(f => /^state-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(BACKUP_KEEP);
    for (const f of old) fs.unlinkSync(path.join(BACKUP_DIR, f));
  } catch (e) {
    console.error("Backup failed:", e.message);
  }
}

const clients = new Set();
function broadcast() {
  for (const res of clients) res.write(`event: rev\ndata: ${state.rev}\n\n`);
}
setInterval(() => { for (const res of clients) res.write(": ping\n\n"); }, 25000).unref();

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

const STATIC = {
  "/icon-192.png": ["icon-192.png", "image/png"],
  "/icon-512.png": ["icon-512.png", "image/png"],
};

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, "http://localhost"); } catch { res.writeHead(400); return res.end(); }
  const p = url.pathname;

  if (p === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }

  if (p === "/api/state" && req.method === "GET") return sendJSON(res, 200, { state, serverTime: Date.now() });

  if (p === "/api/state" && req.method === "PUT") {
    const chunks = [];
    let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { sendJSON(res, 413, { error: "too large" }); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      let msg;
      try { msg = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return sendJSON(res, 400, { error: "bad json" }); }
      if (!msg || typeof msg.baseRev !== "number" || !msg.state || typeof msg.state !== "object")
        return sendJSON(res, 400, { error: "expected { baseRev, state }" });
      if (msg.baseRev !== state.rev) return sendJSON(res, 409, { state, serverTime: Date.now() });
      const s = msg.state;
      const next = {
        rev: state.rev + 1,
        config: s.config && typeof s.config === "object" ? s.config : null,
        run: s.run && typeof s.run === "object" ? s.run : null,
        history: Array.isArray(s.history) ? s.history.slice(0, 400) : [],
      };
      const prev = state;
      state = next;
      try { persist(); }
      catch (e) { state = prev; console.error("Write failed:", e.message); return sendJSON(res, 500, { error: "write failed" }); }
      broadcast();
      sendJSON(res, 200, { state, serverTime: Date.now() });
    });
    return;
  }

  if (p === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`retry: 3000\nevent: rev\ndata: ${state.rev}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if ((p === "/" || p === "/index.html") && (req.method === "GET" || req.method === "HEAD")) {
    fs.readFile(path.join(PUBLIC, "index.html"), "utf8", (err, html) => {
      if (err) { res.writeHead(500); return res.end("index.html missing"); }
      html = html.replace(/\{\{APP_TITLE\}\}/g, escHTML(APP_TITLE)).replace(/\{\{APP_SHORT_NAME\}\}/g, escHTML(APP_SHORT_NAME));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : html);
    });
    return;
  }

  if (p === "/manifest.webmanifest") {
    res.writeHead(200, { "Content-Type": "application/manifest+json", "Cache-Control": "no-cache" });
    return res.end(MANIFEST);
  }

  const entry = STATIC[p];
  if (entry && (req.method === "GET" || req.method === "HEAD")) {
    fs.readFile(path.join(PUBLIC, entry[0]), (err, buf) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": entry[1], "Cache-Control": p.endsWith(".png") ? "public, max-age=86400" : "no-cache" });
      res.end(req.method === "HEAD" ? undefined : buf);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, () => console.log(`${APP_SHORT_NAME} listening on :${PORT}, data in ${DATA_DIR}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { server.close(); process.exit(0); });
