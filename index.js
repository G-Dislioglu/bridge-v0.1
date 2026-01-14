/**
 * bridge-v0.1 — Railway-stabiler Single-File Server
 * - /api/status  -> JSON Status
 * - /api/chat    -> Echo ODER OpenAI (wenn OPENAI_API_KEY gesetzt)
 * - Static Hosting aus /public (inkl. index.html)
 *
 * Keine externen npm Dependencies nötig.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

// ---------- Config ----------
const PORT = Number(process.env.PORT || 8080);

// Optional OpenAI (ohne npm SDK, nur fetch)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"; // kann in Railway Variables geändert werden
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 25000);

// Basic CORS (damit du später auch von anderen Apps callen kannst)
const CORS_ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || "*";

// Mini Rate Limit (schützt minimal gegen Missbrauch, in-memory)
const RL_WINDOW_MS = Number(process.env.RL_WINDOW_MS || 60_000); // 60s
const RL_MAX_REQ = Number(process.env.RL_MAX_REQ || 30); // 30 req/min pro IP

// Body Limit
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 200_000); // 200KB

// Public dir
const PUBLIC_DIR = path.join(__dirname, "public");

// ---------- Helpers ----------
function sendJson(res, statusCode, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function getContentTypeByExt(ext) {
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function safePublicPath(requestPath) {
  // verhindert ../ traversal
  const decoded = decodeURIComponent(requestPath);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(PUBLIC_DIR, normalized);
  if (!fullPath.startsWith(PUBLIC_DIR)) return null;
  return fullPath;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let body = "";

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// ---------- Rate limiter ----------
const rlMap = new Map(); // ip -> {count, resetAt}

function rateLimitOk(ip) {
  const now = Date.now();
  const cur = rlMap.get(ip);
  if (!cur || now > cur.resetAt) {
    rlMap.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return true;
  }
  cur.count += 1;
  return cur.count <= RL_MAX_REQ;
}

// ---------- OpenAI call (Chat Completions via fetch) ----------
async function openaiChat({ message, system }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const payload = {
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        ...(system ? [{ role: "system", content: String(system) }] : []),
        { role: "user", content: String(message || "") },
      ],
    };

    const r = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!r.ok) {
      const detail = data?.error?.message || text || `HTTP ${r.status}`;
      throw new Error(`OPENAI_ERROR: ${detail}`);
    }

    const reply =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.text ??
      "";

    return String(reply).trim();
  } finally {
    clearTimeout(t);
  }
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  try {
    setCors(res);

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const u = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = u.pathname || "/";

    // IP for rate limit
    const ip =
      (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "unknown";

    // ---- API: status ----
    if (pathname === "/api/status" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        status: "bridge online",
        uptime_s: Math.round(process.uptime()),
        node: process.version,
        has_openai_key: Boolean(OPENAI_API_KEY),
        model: OPENAI_MODEL,
        time: new Date().toISOString(),
      });
      return;
    }

    // ---- API: chat ----
    if (pathname === "/api/chat" && req.method === "POST") {
      if (!rateLimitOk(ip)) {
        sendJson(res, 429, { ok: false, error: "rate_limited" });
        return;
      }

      let raw;
      try {
        raw = await readRequestBody(req);
      } catch (e) {
        if (String(e.message) === "BODY_TOO_LARGE") {
          sendJson(res, 413, { ok: false, error: "body_too_large" });
          return;
        }
        throw e;
      }

      let data;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid_json" });
        return;
      }

      const userMessage = (data.message || "").toString();
      const system = (data.system || "").toString();

      if (!userMessage.trim()) {
        sendJson(res, 400, { ok: false, error: "missing_message" });
        return;
      }

      // Wenn kein Key gesetzt ist -> Echo Mode (damit UI immer funktioniert)
      if (!OPENAI_API_KEY) {
        const reply = `Nachricht empfangen: "${userMessage}"`;
        sendJson(res, 200, { ok: true, mode: "echo", reply });
        return;
      }

      // OpenAI Mode
      try {
        const reply = await openaiChat({ message: userMessage, system });
        sendJson(res, 200, { ok: true, mode: "openai", reply });
      } catch (e) {
        sendJson(res, 502, { ok: false, error: "openai_failed", detail: String(e.message || e) });
      }
      return;
    }

    // ---- Static files ----
    // "/" -> index.html
    let filePath;
    if (pathname === "/" || pathname === "") {
      filePath = path.join(PUBLIC_DIR, "index.html");
    } else {
      filePath = safePublicPath(pathname);
    }

    if (!filePath) {
      sendText(res, 400, "Bad Request");
      return;
    }

    // Wenn Datei nicht existiert -> fallback index.html (für SPAs)
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      const fallback = path.join(PUBLIC_DIR, "index.html");
      if (!fs.existsSync(fallback)) {
        sendText(res, 404, "Not Found");
        return;
      }
      const html = fs.readFileSync(fallback);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const ct = getContentTypeByExt(ext);
    const buf = fs.readFileSync(filePath);

    res.writeHead(200, { "Content-Type": ct, "Cache-Control": "no-store" });
    res.end(buf);
  } catch (err) {
    // Hard fallback
    try {
      sendJson(res, 500, { ok: false, error: "server_error", detail: String(err.message || err) });
    } catch {
      // ignore
    }
  }
});

server.listen(PORT, () => {
  console.log("Bridge läuft auf Port", PORT);
});

// Graceful shutdown (Railway)
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
