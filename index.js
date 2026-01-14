/**
 * bridge-v0.1 — Railway-stabiler Core
 * Ziel:
 * - 1 Node-Prozess
 * - klare API-Endpunkte
 * - sauberes Static-Serving
 * - keine Experimente, kein Build-Risiko
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, "public");

/* ---------- Hilfsfunktionen ---------- */

function sendJSON(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendHTML(res, html) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/* ---------- Server ---------- */

const server = http.createServer((req, res) => {
  /* --- Health / Status --- */
  if (req.method === "GET" && req.url === "/api/status") {
    return sendJSON(res, 200, {
      status: "ok",
      service: "bridge-v0.1",
      time: new Date().toISOString()
    });
  }

  /* --- Chat API --- */
  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}");
        const userMessage = String(data.message || "");

        return sendJSON(res, 200, {
          reply: `Bridge empfangen: "${userMessage}"`,
          source: "bridge-v0.1"
        });
      } catch (err) {
        return sendJSON(res, 400, { error: "Invalid JSON" });
      }
    });

    return;
  }

  /* --- UI (immer index.html) --- */
  try {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
    return sendHTML(res, html);
  } catch (err) {
    res.writeHead(500);
    res.end("UI not found");
  }
});

/* ---------- Start ---------- */

server.listen(PORT, () => {
  console.log(`[bridge-v0.1] running on port ${PORT}`);
});
