# Deployment

`hinge-ts` runs as a browser SDK plus a server-side proxy.

- REST proxy: required for Hinge REST and Sendbird REST calls.
- Realtime proxy: required for Sendbird WebSocket events and commands.

REST works anywhere that exposes `Request`, `Response`, and `fetch`. Realtime
needs a runtime that can accept a browser WebSocket and also open an upstream
WebSocket to Sendbird with custom headers.

## Matrix

| Runtime | REST | Realtime | Use |
| --- | --- | --- | --- |
| Cloudflare Workers | yes | yes | Full edge proxy |
| Deno / Deno Deploy | yes | yes | Full proxy when `Deno.upgradeWebSocket` is available |
| Bun server | yes | yes | Full proxy with `Bun.serve` |
| Long-running Node server | yes | yes | Full proxy on any always-on Node host |
| Express | yes | yes | Full proxy inside an existing Express app |
| Fastify | yes | yes | Full proxy inside an existing Fastify app |
| Hono | yes | host-dependent | REST everywhere, realtime on WebSocket-capable adapters |
| Vercel Edge | yes | no | REST only |
| Vercel / Next.js Node runtime | yes | no on Vercel Functions | REST only on Vercel |
| Netlify Functions | yes | no | REST only |
| AWS Lambda Function URL / API Gateway HTTP | yes | no | REST only |
| AWS ECS, App Runner, EC2, Fly.io, Render, Railway, DigitalOcean, VMs | yes | yes | Run the Node server or container |
| Docker / Kubernetes | yes | yes | Run the Node server image |

## Shared REST Handler

Use `hinge-ts/proxy` anywhere that accepts a Fetch-style handler:

```ts
import { createHingeRestProxyHandler } from "hinge-ts/proxy";

const rest = createHingeRestProxyHandler({
  cors: {
    origin: ["https://your-app.example"],
    credentials: true
  },
  authorize: ({ request }) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    return token === process.env.HINGE_PROXY_TOKEN;
  }
});
```

The handler:

- accepts the `HingeProxyTransport` request body
- validates the upstream URL is HTTPS
- allows `prod-api.hingeaws.net` and `*.sendbird.com` by default
- forwards the request with SDK-generated upstream headers
- returns JSON/text responses directly
- returns byte downloads as a base64 JSON string
- handles `OPTIONS` preflight when CORS is enabled

## Client Configuration

REST-only deployments:

```ts
const client = HingeClient.builder()
  .phoneNumber("+15555550123")
  .transport(new HingeProxyTransport({
    baseUrl: "https://your-proxy.example/api/hinge-proxy",
    headers: { authorization: `Bearer ${token}` }
  }))
  .build();
```

Full REST plus realtime deployments:

```ts
const client = HingeClient.builder()
  .phoneNumber("+15555550123")
  .transport(new HingeProxyTransport({
    baseUrl: "https://your-proxy.example/api/hinge-proxy",
    headers: { authorization: `Bearer ${token}` }
  }))
  .realtimeTransport(new ProxySendbirdRealtimeTransport({
    url: `wss://your-proxy.example/api/hinge-proxy/ws/sendbird?token=${encodeURIComponent(token)}`
  }))
  .build();
```

Use an `Authorization` header for REST. Use a query token for realtime because
browser WebSocket constructors cannot set arbitrary request headers.

## Cloudflare Workers

Use when you want a full edge deployment with REST and realtime.

Files:

- `examples/cloudflare-worker/worker.ts`
- `examples/cloudflare-worker/wrangler.toml`

Deploy:

```bash
cd examples/cloudflare-worker
npm install hinge-ts
npx wrangler secret put HINGE_PROXY_TOKEN
npx wrangler deploy
```

The Worker uses `WebSocketPair` for the browser connection and an outbound
`fetch()` request with `Upgrade: websocket` for Sendbird.

## Vercel Edge

Use for REST proxy only.

File:

- `examples/vercel-edge/app/api/hinge-proxy/request/route.ts`

Deploy:

```bash
npm install hinge-ts
vercel env add HINGE_PROXY_TOKEN
vercel deploy
```

Do not use Vercel Edge or Vercel Functions for `ProxySendbirdRealtimeTransport`.
Run realtime on Cloudflare Workers, Deno, Bun, a long-running Node server, a
container, a VM, or another WebSocket-capable host.

## Next.js Node Runtime On Vercel

Use for REST proxy only.

File:

- `examples/next-node/app/api/hinge-proxy/request/route.ts`

This works for auth, recommendations, profile reads, likes, ratings, prompts,
settings, raw REST calls, and chat REST calls. Realtime needs a separate
WebSocket-capable host.

## Netlify Functions

Use for REST proxy only.

File:

- `examples/netlify/functions/hinge-proxy.mjs`

Deploy:

```bash
npm install hinge-ts
netlify env:set HINGE_PROXY_TOKEN your-token
netlify deploy --prod
```

Netlify Functions receive a Web `Request` and return a Web `Response`, so the
shared REST handler can be exported directly.

## AWS Lambda

Use for REST proxy only with Lambda Function URLs or API Gateway HTTP APIs.

File:

- `examples/aws-lambda/handler.mjs`

Package the function with `hinge-ts`, set `HINGE_PROXY_TOKEN`, and expose the
handler at `/api/hinge-proxy/request`.

AWS API Gateway WebSocket APIs are not a transparent relay for this SDK's
Sendbird socket because the proxy must keep one browser socket and one upstream
Sendbird socket open at the same time. For realtime on AWS, use ECS, App Runner,
EC2, EKS, or another always-on compute target.

## Long-running Node

Use when you want full REST and realtime support from one process.

File:

- `examples/node-http/server.mjs`

Run:

```bash
npm install hinge-ts ws
HINGE_PROXY_TOKEN=dev node server.mjs
```

Deploy this shape to Fly.io, Render, Railway, DigitalOcean, AWS ECS, AWS App
Runner, EC2, Azure Container Apps, Google Cloud Run, Kubernetes, or any host that
keeps the Node process alive and supports WebSocket upgrades.

## Docker

File:

- `examples/docker/Dockerfile`

Build from the repo root:

```bash
docker build -f examples/docker/Dockerfile -t hinge-proxy .
docker run -p 3000:3000 -e HINGE_PROXY_TOKEN=dev hinge-proxy
```

Point the browser client at `http://localhost:3000/api/hinge-proxy`.

## Express

File:

- `examples/proxy/express-proxy.js`

Run:

```bash
npm install hinge-ts express ws
HINGE_PROXY_TOKEN=dev node examples/proxy/express-proxy.js
```

Use this when you already have an Express app and want to mount the proxy under
`/api/hinge-proxy`.

## Fastify

File:

- `examples/fastify/server.mjs`

Run:

```bash
npm install hinge-ts fastify @fastify/websocket ws
HINGE_PROXY_TOKEN=dev node examples/fastify/server.mjs
```

## Hono

File:

- `examples/hono/index.ts`

The example uses only the shared REST handler. Add runtime-specific WebSocket
relay code when the Hono adapter exposes server-side WebSocket upgrades and
outbound WebSocket headers.

## Deno

File:

- `examples/deno/main.ts`

Run:

```bash
HINGE_PROXY_TOKEN=dev deno run --allow-net --allow-env examples/deno/main.ts
```

The Deno example uses `Deno.serve`, `Deno.upgradeWebSocket`, and Deno's
WebSocket constructor with custom headers.

## Bun

File:

- `examples/bun/server.ts`

Run:

```bash
HINGE_PROXY_TOKEN=dev bun examples/bun/server.ts
```

The Bun example uses `Bun.serve` for REST and server-side WebSocket upgrades.

## Security Checklist

- Require authentication on REST and realtime routes.
- Use an `Authorization` header for REST proxy calls.
- Use a short-lived query token for browser WebSocket proxy calls.
- Restrict CORS to your app origins.
- Keep `allowedHosts` narrow.
- Never log `authorization`, `sb-access-token`, `session-key`,
  `SENDBIRD-WS-AUTH`, `SENDBIRD-WS-TOKEN`, `x-session-id`, `x-device-id`, or
  `x-install-id`.
- Rate limit login, raw, message send, and realtime routes.
- Do not expose a public unauthenticated proxy.
