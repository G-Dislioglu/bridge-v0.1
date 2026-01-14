// index.js (komplett ersetzen)

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 8080;

// Railway Variable: OPENAI_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Optional: Modell über Railway Variable setzen (z.B. "gpt-4o-mini")
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Optional aber empfohlen: schützt deinen Endpoint vor Missbrauch
// Railway Variable: BRIDGE_TOKEN = irgend ein langes Passwort
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || "";

// ------- Helpers -------
function send(res, statusCode, headers, body) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function sendJson(res, statusCode, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  send(
    res,
    statusCode,
    {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      ...extraHeaders,
    },
    body
  );
}

function sendText(res, statusCode, text, extraHeaders = {}) {
  send(
    res,
    statusCode,
    {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": Buffer.byteLength(text),
      ...extraHeaders,
    },
    text
  );
}

function withCors(headers = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Bridge-Token",
    ...headers,
  };
}

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function looksLikeSafePublicPath(p) {
  // verhindert Path Traversal
  if (!p || p.includes("..") || p.includes("\\") || p.includes("\0")) return false;
  return true;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".svg") return "image/svg+xml; charset=utf-8";
  return "application/octet-stream";
}

function requireBridgeToken(reqUrl, req) {
  if (!BRIDGE_TOKEN) return true; // keine Prüfung aktiv
  const headerToken = (req.headers["x-bridge-token"] || "").toString();
  const urlToken = reqUrl.searchParams.get("token") || "";
  return headerToken === BRIDGE_TOKEN || urlToken === BRIDGE_TOKEN;
}

async function callOpenAIChatCompletions({ message, system }) {
  if (!OPENAI_API_KEY) {
    return { ok: false, error: "OPENAI_API_KEY fehlt in Railway Variables." };
  }

  const messages = [];
  if (system && typeof system === "string" && system.trim()) {
    messages.push({ role: "system", content: system.trim() });
  } else {
    messages.push({
      role: "system",
      content:
        "Du bist eine hilfreiche Assistenz. Antworte kurz, klar und auf Deutsch.",
    });
  }
  messages.push({ role: "user", content: String(message || "") });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        temperature: 0.2,
      }),
    });

    const text = await resp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (!resp.ok) {
      const detail =
        (json && (json.error?.message || JSON.stringify(json))) || text || "";
      return {
        ok: false,
        error: `OpenAI Fehler (${resp.status}): ${detail}`.slice(0, 1200),
      };
    }

    const reply =
      json?.choices?.[0]?.message?.content ??
      "Keine Antwort erhalten (unerwartetes Format).";

    return { ok: true, reply };
  } catch (e) {
    const msg =
      e && e.name === "AbortError"
        ? "Timeout: OpenAI hat zu lange gebraucht (30s)."
        : `Netzwerk/Runtime Fehler: ${String(e?.message || e)}`;
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

// ------- Server -------
const server = http.createServer(async (req, res) => {
  const base = `http://${req.headers.host || "localhost"}`;
  const reqUrl = new URL(req.url || "/", base);

  // CORS Preflight (für /api/*)
  if (reqUrl.pathname.startsWith("/api/") && req.method === "OPTIONS") {
    send(res, 204, withCors(), "");
    return;
  }

  // --- API: Status ---
  if (reqUrl.pathname === "/api/status" && req.method === "GET") {
    sendJson(
      res,
      200,
      {
        status: "bridge online",
        model: OPENAI_MODEL,
        time: new Date().toISOString(),
      },
      withCors()
    );
    return;
  }

  // --- API: Chat ---
  if (reqUrl.pathname === "/api/chat" && req.method === "POST") {
    if (!requireBridgeToken(reqUrl, req)) {
      sendJson(
        res,
        401,
        { error: "Unauthorized (BRIDGE_TOKEN erforderlich)." },
        withCors()
      );
      return;
    }

    let raw;
    try {
      raw = await readBody(req, 1_000_000);
    } catch (e) {
      sendJson(res, 413, { error: "Request zu groß." }, withCors());
      return;
    }

    let data;
    try {
      data = JSON.parse(raw || "{}");
    } catch {
      sendJson(res, 400, { error: "Ungültiges JSON." }, withCors());
      return;
    }

    const userMessage = (data.message || "").toString();
    const system = (data.system || "").toString();

    if (!userMessage.trim()) {
      sendJson(res, 400, { error: "message fehlt." }, withCors());
      return;
    }

    const result = await callOpenAIChatCompletions({
      message: userMessage,
      system,
    });

    if (!result.ok) {
      sendJson(res, 500, { error: result.error }, withCors());
      return;
    }

    sendJson(res, 200, { reply: result.reply }, withCors());
    return;
  }

  // --- Static UI (public/) ---
  // Wenn du später Dateien wie app.js/css einbaust, werden sie hier mit ausgeliefert.
  const publicDir = path.join(__dirname, "public");

  // Standard: "/" => index.html
  let relPath = reqUrl.pathname === "/" ? "/index.html" : reqUrl.pathname;

  if (!looksLikeSafePublicPath(relPath)) {
    sendText(res, 400, "Bad Request");
    return;
  }

  const absPath = path.join(publicDir, relPath);
  if (absPath.startsWith(publicDir) && fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
    const file = fs.readFileSync(absPath);
    send(res, 200, { "Content-Type": contentTypeFor(absPath) }, file);
    return;
  }

  // Fallback: immer index.html (SPA-Style)
  const indexPath = path.join(publicDir, "index.html");
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, "utf8");
    send(res, 200, { "Content-Type": "text/html; charset=utf-8" }, html);
    return;
  }

  sendText(res, 404, "Not Found");
});

server.listen(PORT, () => {
  console.log("Bridge läuft auf Port", PORT);
});
