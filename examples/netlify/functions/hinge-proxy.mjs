import { createHingeRestProxyHandler } from "hinge-ts/proxy";

const rest = createHingeRestProxyHandler({
  cors: {
    origin: ["http://localhost:5173", "https://your-app.example"],
    credentials: true
  },
  authorize: ({ request }) => {
    const expected = Netlify.env.get("HINGE_PROXY_TOKEN");
    if (!expected) return true;
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    return token === expected;
  }
});

export default async function handler(request) {
  return rest(request);
}

export const config = {
  path: "/api/hinge-proxy/request"
};
