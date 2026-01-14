const http = require("http");
const fs = require("fs");
const path = require("path");

/**
 * Zentrale Nachrichtenlogik (Phase 2.5)
 * Hier wird später OpenAI / andere KI angebunden.
 */
function handleMessage(message) {
  if (!message || typeof message !== "string") {
    return "Leere oder ungültige Nachricht empfangen.";
  }

  return `Bridge hat verstanden: "${message}"`;
}

const server = http.createServer((req, res) => {
  // --- Status Endpoint ---
  if (req.url === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "bridge online" }));
    return;
  }

  // --- Chat API Endpoint ---
  if (req.url === "/api/chat" && req.method === "POST") {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const userMessage = data.message || "";

        const reply = handleMessage(userMessage);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Ungültige Anfrage" }));
      }
    });

    return;
  }

  // --- UI ausliefern ---
  const filePath = path.join(__dirname, "public", "index.html");

  try {
    const html = fs.readFileSync(filePath, "utf8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("UI konnte nicht geladen werden.");
  }
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("Bridge läuft auf Port", PORT);
});
``
