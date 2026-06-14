import { createHingeRestProxyHandler } from "npm:hinge-ts/proxy";

const token = Deno.env.get("HINGE_PROXY_TOKEN");
const rest = createHingeRestProxyHandler({
  cors: {
    origin: ["http://localhost:5173"],
    credentials: true
  },
  authorize: ({ request }) => {
    if (!token) return true;
    const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    return received === token;
  }
});

Deno.serve((request) => {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/hinge-proxy/request") {
    return rest(request);
  }
  if (pathname === "/api/hinge-proxy/ws/sendbird") {
    return handleSendbirdWebSocket(request);
  }
  return new Response("not found", { status: 404 });
});

function handleSendbirdWebSocket(request: Request): Response {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected websocket", { status: 426 });
  }
  if (!isSocketAuthorized(request)) {
    return new Response("unauthorized", { status: 401 });
  }

  const { socket: browser, response } = Deno.upgradeWebSocket(request);
  browser.addEventListener("message", (event) => {
    const first = JSON.parse(String(event.data));
    const input = first.input;
    const upstream = new URL(input.url);
    if (upstream.protocol !== "wss:" || !upstream.hostname.endsWith(".sendbird.com")) {
      browser.close(1008, "upstream host is not allowed");
      return;
    }

    const sendbird = new WebSocket(input.url, { headers: input.headers });
    sendbird.addEventListener("message", (message) => browser.send(message.data));
    browser.addEventListener("message", (message) => {
      if (sendbird.readyState === WebSocket.OPEN) sendbird.send(message.data);
    });
    sendbird.addEventListener("close", (close) => browser.close(close.code, close.reason));
    browser.addEventListener("close", () => sendbird.close());
  }, { once: true });

  return response;
}

function isSocketAuthorized(request: Request): boolean {
  if (!token) return true;
  return new URL(request.url).searchParams.get("token") === token;
}
