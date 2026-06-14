import { createHingeRestProxyHandler } from "hinge-ts/proxy";

type Env = {
  HINGE_PROXY_TOKEN?: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/hinge-proxy/request") {
      return createHingeRestProxyHandler({
        cors: {
          origin: ["http://localhost:5173", "https://your-app.example"],
          credentials: true
        },
        authorize: ({ request }) => {
          if (!env.HINGE_PROXY_TOKEN) return true;
          const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
          return token === env.HINGE_PROXY_TOKEN;
        }
      })(request);
    }

    if (url.pathname === "/api/hinge-proxy/ws/sendbird") {
      return handleSendbirdWebSocket(request, env);
    }

    return new Response("not found", { status: 404 });
  }
};

async function handleSendbirdWebSocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected websocket", { status: 426 });
  }
  if (!isSocketAuthorized(request, env)) {
    return new Response("unauthorized", { status: 401 });
  }

  const pair = new WebSocketPair();
  const client = pair[0];
  const browser = pair[1];
  browser.accept();

  browser.addEventListener("message", async (event) => {
    const first = JSON.parse(String(event.data));
    const input = first.input;
    const upstream = new URL(input.url);
    if (upstream.protocol !== "wss:" || !upstream.hostname.endsWith(".sendbird.com")) {
      browser.close(1008, "upstream host is not allowed");
      return;
    }

    const upstreamResponse = await fetch(input.url, {
      headers: {
        ...input.headers,
        Upgrade: "websocket"
      }
    });
    const sendbird = upstreamResponse.webSocket;
    if (!sendbird) {
      browser.close(1011, "sendbird websocket rejected");
      return;
    }

    sendbird.accept();
    sendbird.addEventListener("message", (message) => browser.send(message.data));
    browser.addEventListener("message", (message) => sendbird.send(message.data));
    sendbird.addEventListener("close", (event) => browser.close(event.code, event.reason));
    browser.addEventListener("close", (event) => sendbird.close(event.code, event.reason));
  }, { once: true });

  return new Response(null, {
    status: 101,
    webSocket: client
  });
}

function isSocketAuthorized(request: Request, env: Env): boolean {
  if (!env.HINGE_PROXY_TOKEN) return true;
  const token = new URL(request.url).searchParams.get("token");
  return token === env.HINGE_PROXY_TOKEN;
}
