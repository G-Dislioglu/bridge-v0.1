const http = require("http");
const fs = require("fs");
const path = require("path");

const server = http.createServer((req, res) => {
  // Status endpoint
  if (req.url === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "bridge online" }));
    return;
  }

  // Chat endpoint
  if (req.url === "/api/chat" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const userMessage = data.message || "";
        const reply = `Nachricht empfangen: "${userMessage}"`;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply }));
      } catch (e) {
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }

  // Serve UI
  const filePath = path.join(__dirname, "public", "index.html");
  const html = fs.readFileSync(filePath, "utf8");
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log("Bridge läuft auf Port", PORT);
});
