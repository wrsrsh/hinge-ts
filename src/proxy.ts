import { HingeError } from "./errors.js";
import type { HingeHttpMethod, JsonValue } from "./types.js";

export type HingeProxyService = "hinge" | "sendbird";

export type HingeProxyRequestBody = {
  service: HingeProxyService;
  method: HingeHttpMethod;
  pathOrUrl: string;
  url: string;
  headers: Record<string, string>;
  body?: JsonValue;
  responseType?: "json" | "bytes";
};

export type HingeProxyAuthorizeContext = {
  request: Request;
  body: HingeProxyRequestBody;
};

export type HingeProxyOptions = {
  allowedHosts?: string[];
  allowSendbirdSubdomains?: boolean;
  authorize?: (context: HingeProxyAuthorizeContext) => boolean | Promise<boolean>;
  fetch?: typeof fetch;
  maxBodyBytes?: number;
  cors?: HingeProxyCorsOptions | false;
};

export type HingeProxyCorsOptions = {
  origin?: string | string[];
  methods?: string[];
  headers?: string[];
  credentials?: boolean;
  maxAge?: number;
};

export type HingeProxyRouteOptions = HingeProxyOptions & {
  requestPath?: string;
};

export function createHingeRestProxyHandler(options: HingeProxyOptions = {}) {
  return async function handleHingeRestProxy(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return corsPreflight(request, options.cors);
    }
    if (request.method !== "POST") {
      return withCors(json({ error: "method not allowed" }, 405), request, options.cors);
    }

    let body: HingeProxyRequestBody;
    try {
      body = await readProxyBody(request, options.maxBodyBytes);
    } catch (error) {
      return withCors(json({ error: errorMessage(error) }, 400), request, options.cors);
    }

    if (!(await isAuthorized(request, body, options))) {
      return withCors(json({ error: "unauthorized" }, 401), request, options.cors);
    }

    const url = safeUpstreamUrl(body.url, options);
    if (!url) {
      return withCors(json({ error: "upstream host is not allowed" }, 400), request, options.cors);
    }

    const init: RequestInit = {
      method: body.method,
      headers: body.headers
    };
    if (body.body !== undefined) {
      init.body = JSON.stringify(body.body);
    }

    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new HingeError("unsupported_runtime", "fetch is not available");
    }

    const upstream = await fetchImpl(url, init);
    const responseHeaders = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) {
      responseHeaders.set("content-type", contentType);
    }

    if (body.responseType === "bytes") {
      responseHeaders.set("content-type", "application/json");
      const encoded = encodeBase64(await upstream.arrayBuffer());
      return withCors(new Response(JSON.stringify(encoded), {
        status: upstream.status,
        headers: responseHeaders
      }), request, options.cors);
    }

    return withCors(new Response(await upstream.text(), {
      status: upstream.status,
      headers: responseHeaders
    }), request, options.cors);
  };
}

export function createHingeProxyRouter(options: HingeProxyRouteOptions = {}) {
  const requestPath = options.requestPath ?? "/request";
  const rest = createHingeRestProxyHandler(options);
  return async function handleHingeProxyRoute(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.endsWith(requestPath)) {
      return rest(request);
    }
    return withCors(json({ error: "not found" }, 404), request, options.cors);
  };
}

export function isAllowedHingeProxyHost(hostname: string, options: HingeProxyOptions = {}): boolean {
  const allowedHosts = new Set(options.allowedHosts ?? ["prod-api.hingeaws.net"]);
  if (allowedHosts.has(hostname)) {
    return true;
  }
  return options.allowSendbirdSubdomains !== false && hostname.endsWith(".sendbird.com");
}

export function corsPreflight(request: Request, options: HingeProxyCorsOptions | false | undefined): Response {
  return withCors(new Response(null, { status: 204 }), request, options);
}

export function withCors(response: Response, request: Request, options: HingeProxyCorsOptions | false | undefined): Response {
  if (options === false) {
    return response;
  }
  const cors = options ?? {};
  const headers = new Headers(response.headers);
  const origin = resolveCorsOrigin(request.headers.get("origin"), cors.origin ?? "*");
  if (origin) {
    headers.set("access-control-allow-origin", origin);
  }
  if (cors.credentials) {
    headers.set("access-control-allow-credentials", "true");
  }
  headers.set("access-control-allow-methods", (cors.methods ?? ["POST", "OPTIONS"]).join(", "));
  headers.set("access-control-allow-headers", (cors.headers ?? ["content-type", "authorization"]).join(", "));
  if (cors.maxAge !== undefined) {
    headers.set("access-control-max-age", String(cors.maxAge));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function readProxyBody(request: Request, maxBodyBytes = 1_000_000): Promise<HingeProxyRequestBody> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBodyBytes) {
    throw new Error("request body too large");
  }
  const parsed = JSON.parse(text) as Partial<HingeProxyRequestBody>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("request body must be an object");
  }
  if (parsed.service !== "hinge" && parsed.service !== "sendbird") {
    throw new Error("service must be hinge or sendbird");
  }
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(parsed.method))) {
    throw new Error("method is not allowed");
  }
  if (typeof parsed.url !== "string" || !parsed.url) {
    throw new Error("url is required");
  }
  if (!parsed.headers || typeof parsed.headers !== "object") {
    throw new Error("headers are required");
  }
  return parsed as HingeProxyRequestBody;
}

async function isAuthorized(request: Request, body: HingeProxyRequestBody, options: HingeProxyOptions): Promise<boolean> {
  if (!options.authorize) {
    return true;
  }
  return options.authorize({ request, body });
}

function safeUpstreamUrl(value: string, options: HingeProxyOptions): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") {
    return undefined;
  }
  return isAllowedHingeProxyHost(url.hostname, options) ? url : undefined;
}

function resolveCorsOrigin(requestOrigin: string | null, configured: string | string[]): string | undefined {
  if (configured === "*") {
    return "*";
  }
  if (typeof configured === "string") {
    return configured;
  }
  if (requestOrigin && configured.includes(requestOrigin)) {
    return requestOrigin;
  }
  return undefined;
}

function json(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}
