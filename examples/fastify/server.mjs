import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { WebSocket } from "ws";
import { createHingeRestProxyHandler } from "hinge-ts/proxy";

const app = Fastify();
await app.register(websocket);

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

app.options("/api/hinge-proxy/request", async (request, reply) => {
  const response = await rest(toWebRequest(request));
  await sendWebResponse(reply, response);
});

app.post("/api/hinge-proxy/request", async (request, reply) => {
  const response = await rest(toWebRequest(request));
  await sendWebResponse(reply, response);
});

app.get("/api/hinge-proxy/ws/sendbird", { websocket: true }, (browser, request) => {
  if (!isSocketAuthorized(request.url)) {
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

await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });

function isSocketAuthorized(path) {
  const expected = process.env.HINGE_PROXY_TOKEN;
  if (!expected) return true;
  const url = new URL(path, "http://local");
  return url.searchParams.get("token") === expected;
}

function toWebRequest(request) {
  return new Request(`http://local${request.url}`, {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" || request.method === "HEAD"
      ? undefined
      : JSON.stringify(request.body)
  });
}

async function sendWebResponse(reply, response) {
  reply.status(response.status);
  response.headers.forEach((value, key) => reply.header(key, value));
  reply.send(await response.text());
}
