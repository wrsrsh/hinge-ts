import express from "express";
import { WebSocketServer } from "ws";

const app = express();
app.use(express.json({ limit: "1mb" }));

const allowedHosts = new Set(["prod-api.hingeaws.net"]);

app.post("/api/hinge-proxy/request", async (req, res) => {
  const { url, method, headers, body, responseType } = req.body;
  const upstream = new URL(url);
  if (!allowedHosts.has(upstream.host) && !upstream.host.endsWith(".sendbird.com")) {
    res.status(400).json({ error: "upstream host is not allowed" });
    return;
  }

  const init = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await fetch(upstream, init);

  if (responseType === "bytes") {
    const bytes = Buffer.from(await response.arrayBuffer()).toString("base64");
    res.status(response.status).send(JSON.stringify(bytes));
    return;
  }

  const text = await response.text();
  res.status(response.status).type(response.headers.get("content-type") || "application/json").send(text);
});

const server = app.listen(3000);
const wss = new WebSocketServer({ server, path: "/api/hinge-proxy/ws/sendbird" });

wss.on("connection", (browserSocket) => {
  browserSocket.once("message", async (message) => {
    const { input } = JSON.parse(String(message));
    const { WebSocket } = await import("ws");
    const sendbirdSocket = new WebSocket(input.url, { headers: input.headers });

    sendbirdSocket.on("message", (frame) => browserSocket.send(frame.toString()));
    browserSocket.on("message", (frame) => sendbirdSocket.send(frame.toString()));
    sendbirdSocket.on("close", (code, reason) => browserSocket.send(`__CLOSE__:${code}:${reason.toString()}`));
    browserSocket.on("close", () => sendbirdSocket.close());
  });
});

console.log("hinge proxy listening on http://localhost:3000");
