import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createHingeRestProxyHandler } from "hinge-ts/proxy";

const app = express();

const rest = createHingeRestProxyHandler({
  cors: {
    origin: ["http://localhost:5173"],
    credentials: true
  },
  authorize: ({ request }) => {
    const expected = process.env.HINGE_PROXY_TOKEN;
    if (!expected) return true;
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    return token === expected;
  }
});

app.post("/api/hinge-proxy/request", async (req, res) => {
  const response = await rest(toWebRequest(req));
  await sendWebResponse(res, response);
});

const server = app.listen(process.env.PORT ?? 3000);
const wss = new WebSocketServer({ server, path: "/api/hinge-proxy/ws/sendbird" });

wss.on("connection", (browserSocket, req) => {
  if (!isSocketAuthorized(req)) {
    browserSocket.close(1008, "unauthorized");
    return;
  }

  browserSocket.once("message", (message) => {
    const { input } = JSON.parse(String(message));
    const upstream = new URL(input.url);
    if (upstream.protocol !== "wss:" || !upstream.hostname.endsWith(".sendbird.com")) {
      browserSocket.close(1008, "upstream host is not allowed");
      return;
    }

    const sendbirdSocket = new WebSocket(input.url, { headers: input.headers });
    sendbirdSocket.on("message", (frame) => browserSocket.send(frame.toString()));
    browserSocket.on("message", (frame) => {
      if (sendbirdSocket.readyState === WebSocket.OPEN) sendbirdSocket.send(frame.toString());
    });
    sendbirdSocket.on("close", (code, reason) => browserSocket.close(code, reason.toString()));
    browserSocket.on("close", () => sendbirdSocket.close());
  });
});

console.log("hinge proxy listening");

function isSocketAuthorized(req) {
  const expected = process.env.HINGE_PROXY_TOKEN;
  if (!expected) return true;
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get("token") === expected;
}

function toWebRequest(req) {
  return new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
    duplex: "half"
  });
}

async function sendWebResponse(res, response) {
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.send(await response.text());
}
