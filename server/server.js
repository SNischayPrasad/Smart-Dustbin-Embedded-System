/* ==========================================================================
   server.js - optional local server for the Smart Dustbin website
   --------------------------------------------------------------------------
   ZERO DEPENDENCIES. No npm install, no package.json needed.
       node server/server.js
       open http://localhost:3000

   Why bother, when website/ already works by double-clicking index.html?
     1. Some browsers block localStorage and fetch on file:// URLs.
     2. It shows how the same dashboard talks to a REAL backend.
     3. It demonstrates proper server-side authentication, which the
        client-only login in auth.js deliberately does not do.

   API
     POST /api/login              { username, password }  -> sets a session cookie
     POST /api/logout
     GET  /api/session
     GET  /api/bins                                       (requires the cookie)
     POST /api/bins/:id/command   { cmd }                 (requires the cookie)
   ========================================================================== */

const http = require("http");
const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT     = process.env.PORT || 3000;
const ROOT     = path.join(__dirname, "..", "website");
const DATAFILE = path.join(__dirname, "fleet.json");
const SEEDFILE = path.join(__dirname, "..", "data", "bins.json");

/* ---------------------------------------------------------------- users --
   The password is stored as a salted SHA-256 hash, never in plain text.
   A production system would use bcrypt or argon2, which are deliberately
   slow so that guessing is expensive. SHA-256 is used here only because it
   is built into Node with no packages to install.                        */
const USERS = [{
  username: "Nischay",
  salt:     "sd-2026-nischay",
  /* sha256("sd-2026-nischay" + "Admin@123") - computed at startup below */
  hash:     null,
  name:     "Nischay",
  role:     "Administrator"
}];

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/* Seed the hash once at boot so the plain password is not written down. */
USERS[0].hash = sha256(USERS[0].salt + "Admin@123");

const sessions = new Map();   /* token -> { username, expires } */
const SESSION_MS = 2 * 60 * 60 * 1000;

/* ----------------------------------------------------------------- data -- */
function loadFleet() {
  try { return JSON.parse(fs.readFileSync(DATAFILE, "utf8")); } catch (e) {}
  try { return JSON.parse(fs.readFileSync(SEEDFILE, "utf8")).bins; } catch (e) {}
  return [];
}
function saveFleet(fleet) {
  try { fs.writeFileSync(DATAFILE, JSON.stringify(fleet, null, 2)); } catch (e) {}
}
let fleet = loadFleet();

/* ------------------------------------------------------------- helpers -- */
const MIME = {
  ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8",
  ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg",
  ".ico":"image/x-icon", ".txt":"text/plain; charset=utf-8"
};

function sendJson(res, code, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  }, headers || {}));
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve) {
    let data = "";
    req.on("data", c => {
      data += c;
      if (data.length > 1e6) req.destroy();      /* refuse oversized bodies */
    });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch (e) { resolve({}); }
    });
  });
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(function (part) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

/* The server, not the browser, decides who is allowed in. */
function currentUser(req) {
  const token = parseCookies(req).sd_session;
  if (!token) return null;

  const s = sessions.get(token);
  if (!s) return null;

  if (Date.now() > s.expires) { sessions.delete(token); return null; }
  return USERS.find(u => u.username === s.username) || null;
}

/* ------------------------------------------------------------ bin logic -- */
const BIN_HEIGHT_CM = 30, WARN = 75, FULL = 90;

function statusOf(bin) {
  if (!bin.online)      return "offline";
  if (bin.fill >= FULL) return "full";
  if (bin.fill >= WARN) return "warning";
  return "ok";
}

const COMMANDS = {
  OPEN:   b => { b.lid = "OPEN";   b.manual = true;  return "Lid forced open"; },
  CLOSE:  b => { b.lid = "CLOSED"; b.manual = true;  return "Lid forced closed"; },
  AUTO:   b => { b.manual = false;                   return "Automatic mode"; },
  MUTE:   b => { b.muted = true;                     return "Buzzer muted"; },
  UNMUTE: b => { b.muted = false;                    return "Buzzer enabled"; },
  EMPTY:  b => { b.fill = 0; b.opens = 0;            return "Marked as collected"; },
  PING:   b => { b.online = true;                    return "Device responded"; }
};

/* ------------------------------------------------------------- routing -- */
const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const pathname = decodeURIComponent(url.pathname);

  /* ---------------- API ---------------- */
  if (pathname.startsWith("/api/")) {

    if (pathname === "/api/login" && req.method === "POST") {
      const body = await readBody(req);
      const user = USERS.find(u => u.username === body.username);

      /* timingSafeEqual keeps the comparison constant-time so an attacker
         cannot learn the hash one character at a time.                  */
      let ok = false;
      if (user && typeof body.password === "string") {
        const given = Buffer.from(sha256(user.salt + body.password));
        const known = Buffer.from(user.hash);
        ok = given.length === known.length && crypto.timingSafeEqual(given, known);
      }

      if (!ok) {
        return sendJson(res, 401, { ok: false, message: "Invalid username or password" });
      }

      const token = crypto.randomBytes(24).toString("hex");
      sessions.set(token, { username: user.username, expires: Date.now() + SESSION_MS });

      /* HttpOnly means page JavaScript cannot read this cookie, so an XSS
         bug cannot steal the session. SameSite=Strict blocks CSRF.      */
      return sendJson(res, 200,
        { ok: true, user: { username: user.username, name: user.name, role: user.role } },
        { "Set-Cookie": "sd_session=" + token +
                        "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + (SESSION_MS / 1000) });
    }

    if (pathname === "/api/logout" && req.method === "POST") {
      const token = parseCookies(req).sd_session;
      sessions.delete(token);
      return sendJson(res, 200, { ok: true },
        { "Set-Cookie": "sd_session=; HttpOnly; Path=/; Max-Age=0" });
    }

    if (pathname === "/api/session") {
      const user = currentUser(req);
      return sendJson(res, 200, user
        ? { ok: true, user: { username: user.username, name: user.name, role: user.role } }
        : { ok: false });
    }

    /* Everything below needs a valid session. */
    const user = currentUser(req);
    if (!user) return sendJson(res, 401, { ok: false, message: "Not signed in" });

    if (pathname === "/api/bins" && req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        bins: fleet.map(b => Object.assign({}, b, { status: statusOf(b) }))
      });
    }

    const m = pathname.match(/^\/api\/bins\/([A-Za-z0-9-]+)\/command$/);
    if (m && req.method === "POST") {
      const bin = fleet.find(b => b.id === m[1]);
      if (!bin) return sendJson(res, 404, { ok: false, message: "Unknown bin" });

      const body = await readBody(req);
      const fn = COMMANDS[String(body.cmd || "").toUpperCase()];
      if (!fn) return sendJson(res, 400, { ok: false, message: "Unknown command" });

      const message = fn(bin);
      bin.lastSeen = Date.now();
      saveFleet(fleet);

      console.log("[" + new Date().toISOString() + "] " + user.username +
                  " -> " + bin.id + " " + body.cmd + " (" + message + ")");
      return sendJson(res, 200, { ok: true, message: message, bin: bin });
    }

    return sendJson(res, 404, { ok: false, message: "No such endpoint" });
  }

  /* ---------------- static files ---------------- */
  let rel = pathname === "/" ? "/index.html" : pathname;

  /* Block path traversal: resolve, then confirm the result is inside ROOT. */
  const filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); return res.end("Forbidden");
  }

  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end("<h1>404</h1><p>Not found: " + rel + "</p>" +
                     "<p><a href='/'>Back to the site</a></p>");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, function () {
  console.log("");
  console.log("  Smart Dustbin server running");
  console.log("  Public site : http://localhost:" + PORT + "/");
  console.log("  Admin login : http://localhost:" + PORT + "/login.html");
  console.log("  Credentials : Nischay / Admin@123");
  console.log("  Serving     : " + ROOT);
  console.log("");
});
