import { createHingeRestProxyHandler } from "hinge-ts/proxy";

type Peer = {
  sendbird?: WebSocket;
};

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

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  fetch(request, server) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/hinge-proxy/request") {
      return rest(request);
    }
    if (pathname === "/api/hinge-proxy/ws/sendbird") {
      if (!isSocketAuthorized(request)) {
        return new Response("unauthorized", { status: 401 });
      }
      const upgraded = server.upgrade<Peer>(request, { data: {} });
      return upgraded ? undefined : new Response("expected websocket", { status: 426 });
    }
    return new Response("not found", { status: 404 });
  },
  websocket: {
    message(browser, frame) {
      if (browser.data.sendbird) {
        browser.data.sendbird.send(frame);
        return;
      }

      const first = JSON.parse(String(frame));
      const input = first.input;
      const upstream = new URL(input.url);
      if (upstream.protocol !== "wss:" || !upstream.hostname.endsWith(".sendbird.com")) {
        browser.close(1008, "upstream host is not allowed");
        return;
      }

      const sendbird = new WebSocket(input.url, { headers: input.headers });
      browser.data.sendbird = sendbird;
      sendbird.addEventListener("message", (message) => browser.send(message.data));
      sendbird.addEventListener("close", (close) => browser.close(close.code, close.reason));
    },
    close(browser) {
      browser.data.sendbird?.close();
    }
  }
});

function isSocketAuthorized(request: Request): boolean {
  const expected = process.env.HINGE_PROXY_TOKEN;
  if (!expected) return true;
  return new URL(request.url).searchParams.get("token") === expected;
}
