const http = require("http");

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "bridge online" }));
}).listen(PORT, () => {
  console.log("Bridge läuft auf Port", PORT);
});
