import { createHingeRestProxyHandler } from "hinge-ts/proxy";

export const runtime = "nodejs";

const handler = createHingeRestProxyHandler({
  cors: {
    origin: ["http://localhost:3000", "https://your-app.example"],
    credentials: true
  },
  authorize: ({ request }) => {
    const expected = process.env.HINGE_PROXY_TOKEN;
    if (!expected) return true;
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    return token === expected;
  }
});

export function OPTIONS(request: Request) {
  return handler(request);
}

export function POST(request: Request) {
  return handler(request);
}
