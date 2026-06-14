import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { createHingeRestProxyHandler } from "hinge-ts/proxy";

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

const server = createServer(async (req, res) => {
  if (req.url === "/api/hinge-proxy/request") {
    const request = toWebRequest(req);
    const response = await rest(request);
    await writeWebResponse(res, response);
    return;
  }
  res.writeHead(404).end("not found");
});

const wss = new WebSocketServer({
  server,
  path: "/api/hinge-proxy/ws/sendbird"
});

wss.on("connection", (browser, req) => {
  if (!isSocketAuthorized(req)) {
    browser.close(1008, "unauthorized");
    return;
  }

  browser.once("message", (firstFrame) => {
    const { input } = JSON.parse(String(firstFrame));
    const upstream = new URL(input.url);
    if (upstream.protocol !== "wss:" || !upstream.hostname.endsWith(".sendbird.com")) {
      browser.close(1008, "upstream host is not allowed");
      return;
    }

    const sendbird = new WebSocket(input.url, { headers: input.headers });

    sendbird.on("message", (frame) => browser.send(frame.toString()));
    browser.on("message", (frame) => {
      if (sendbird.readyState === WebSocket.OPEN) sendbird.send(frame.toString());
    });
    sendbird.on("close", (code, reason) => browser.close(code, reason.toString()));
    browser.on("close", () => sendbird.close());
  });
});

server.listen(process.env.PORT ?? 3000, () => {
  console.log("hinge proxy listening");
});

function isSocketAuthorized(req) {
  const expected = process.env.HINGE_PROXY_TOKEN;
  if (!expected) return true;
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get("token") === expected;
}

function toWebRequest(req) {
  const url = `http://${req.headers.host}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value !== undefined) headers.set(key, value);
  }
  return new Request(url, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
    duplex: "half"
  });
}

async function writeWebResponse(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}
