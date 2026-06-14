import { createHingeRestProxyHandler } from "hinge-ts/proxy";

const rest = createHingeRestProxyHandler({
  cors: {
    origin: ["http://localhost:5173", "https://your-app.example"],
    credentials: true
  },
  authorize: ({ request }) => {
    const expected = process.env.HINGE_PROXY_TOKEN;
    if (!expected) return true;
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    return token === expected;
  }
});

export async function handler(event) {
  const method = event.requestContext?.http?.method ?? event.httpMethod ?? "POST";
  const host = event.headers?.host ?? "lambda.local";
  const path = event.rawPath ?? event.path ?? "/api/hinge-proxy/request";
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const body = event.isBase64Encoded && event.body
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  const request = new Request(`https://${host}${path}${query}`, {
    method,
    headers: event.headers ?? {},
    body: method === "GET" || method === "HEAD" ? undefined : body
  });
  const response = await rest(request);
  return toLambdaResponse(response);
}

async function toLambdaResponse(response) {
  const headers = Object.fromEntries(response.headers);
  return {
    statusCode: response.status,
    headers,
    body: await response.text(),
    isBase64Encoded: false
  };
}
