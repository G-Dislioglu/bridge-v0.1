const http = require("http");

const server = http.createServer((req, res) => {
  if (req.url === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "bridge online" }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hello Bridge");
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log("Bridge läuft auf Port", PORT);
});
