import { HingeError } from "./errors.js";
import type { HingeLogger } from "./logger.js";
import { logRequest, logResponse } from "./logger.js";
import type { HingeHttpMethod, JsonValue } from "./types.js";

export type HingeTransportRequest = {
  service: "hinge" | "sendbird";
  method: HingeHttpMethod;
  url: string;
  pathOrUrl: string;
  headers: Record<string, string>;
  body?: JsonValue;
  responseType?: "json" | "bytes";
};

export type HingeTransportResponse<T = unknown> = {
  status: number;
  headers: Record<string, string>;
  body: T;
};

export interface HingeTransport {
  request<T = unknown>(input: HingeTransportRequest): Promise<HingeTransportResponse<T>>;
  downloadBytes?(url: string): Promise<ArrayBuffer>;
}

export type HingeProxyTransportOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  logger?: HingeLogger;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
};

export class HingeProxyTransport implements HingeTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: HingeProxyTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new HingeError("unsupported_runtime", "fetch is not available");
    }
  }

  async request<T = unknown>(input: HingeTransportRequest): Promise<HingeTransportResponse<T>> {
    const extraHeaders = typeof this.options.headers === "function"
      ? await this.options.headers()
      : this.options.headers ?? {};
    const body = JSON.stringify({
      service: input.service,
      method: input.method,
      pathOrUrl: input.pathOrUrl,
      url: input.url,
      headers: input.headers,
      body: input.body,
      responseType: input.responseType ?? "json"
    });
    logRequest(this.options.logger, "POST", `${this.baseUrl}/request`, extraHeaders, JSON.parse(body) as JsonValue);
    const response = await this.fetchImpl(`${this.baseUrl}/request`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...extraHeaders
      },
      body
    });
    const headers = headersToObject(response.headers);
    const responseBody = await parseProxyBody<T>(response);
    logResponse(this.options.logger, response.status, headers, responseBody as JsonValue);
    if (!response.ok) {
      throw new HingeError("http", `status ${response.status}: ${stringifyBody(responseBody)}`, { status: response.status });
    }
    return { status: response.status, headers, body: responseBody };
  }

  async downloadBytes(url: string): Promise<ArrayBuffer> {
    const result = await this.request<string>({
      service: "hinge",
      method: "GET",
      url,
      pathOrUrl: url,
      headers: {},
      responseType: "bytes"
    });
    if (typeof result.body === "string") {
      return base64ToArrayBuffer(result.body);
    }
    throw new HingeError("serde", "proxy bytes response must be a base64 string");
  }
}

export class BrowserFetchTransport implements HingeTransport {
  constructor(private readonly options: { fetch?: typeof fetch; logger?: HingeLogger } = {}) {}

  async request<T = unknown>(input: HingeTransportRequest): Promise<HingeTransportResponse<T>> {
    const fetchImpl = this.options.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new HingeError("unsupported_runtime", "fetch is not available");
    }
    logRequest(this.options.logger, input.method, input.url, input.headers, input.body);
    const init: RequestInit = {
      method: input.method,
      headers: input.headers
    };
    if (input.body !== undefined) {
      init.body = JSON.stringify(input.body);
    }
    const response = await fetchImpl(input.url, init);
    const headers = headersToObject(response.headers);
    const body = input.responseType === "bytes"
      ? await response.arrayBuffer() as T
      : await parseProxyBody<T>(response);
    logResponse(this.options.logger, response.status, headers, body as JsonValue);
    if (!response.ok) {
      throw new HingeError("http", `status ${response.status}: ${stringifyBody(body)}`, { status: response.status });
    }
    return { status: response.status, headers, body };
  }

  async downloadBytes(url: string): Promise<ArrayBuffer> {
    const fetchImpl = this.options.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new HingeError("unsupported_runtime", "fetch is not available");
    }
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new HingeError("http", `status ${response.status}: ${await response.text()}`, { status: response.status });
    }
    return response.arrayBuffer();
  }
}

export type SendbirdConnectRequest = {
  url: string;
  headers: Record<string, string>;
  token?: string;
  sessionKey?: string;
  userId: string;
};

export interface SendbirdRealtimeConnection {
  send(frame: string): void;
  close(code?: number, reason?: string): void;
  events(): AsyncIterable<string>;
}

export interface SendbirdRealtimeTransport {
  connect(input: SendbirdConnectRequest): Promise<SendbirdRealtimeConnection>;
}

export class ProxySendbirdRealtimeTransport implements SendbirdRealtimeTransport {
  private readonly endpoint: string;

  constructor(private readonly options: { url: string; WebSocket?: typeof WebSocket }) {
    this.endpoint = options.url;
  }

  async connect(input: SendbirdConnectRequest): Promise<SendbirdRealtimeConnection> {
    const WebSocketImpl = this.options.WebSocket ?? globalThis.WebSocket;
    if (!WebSocketImpl) {
      throw new HingeError("unsupported_runtime", "WebSocket is not available");
    }
    const socket = new WebSocketImpl(this.endpoint);
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "connect", input }));
    return new BrowserSocketConnection(socket);
  }
}

class BrowserSocketConnection implements SendbirdRealtimeConnection {
  constructor(private readonly socket: WebSocket) {}

  send(frame: string): void {
    this.socket.send(frame);
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }

  async *events(): AsyncIterable<string> {
    const queue: string[] = [];
    const waiters: Array<(value: IteratorResult<string>) => void> = [];
    let closed = false;
    let closeError: unknown;

    const push = (value: string) => {
      const waiter = waiters.shift();
      if (waiter) {
        waiter({ value, done: false });
      } else {
        queue.push(value);
      }
    };

    this.socket.addEventListener("message", (event) => {
      push(typeof event.data === "string" ? event.data : String(event.data));
    });
    this.socket.addEventListener("close", (event) => {
      closed = true;
      push(`__CLOSE__:${event.code}:${event.reason}`);
    });
    this.socket.addEventListener("error", (event) => {
      closeError = event;
      closed = true;
    });

    while (true) {
      if (queue.length > 0) {
        yield queue.shift() as string;
        continue;
      }
      if (closed) {
        if (closeError) {
          throw new HingeError("network", "sendbird websocket failed", { cause: closeError });
        }
        return;
      }
      const next = await new Promise<IteratorResult<string>>((resolve) => waiters.push(resolve));
      if (next.done) {
        return;
      }
      yield next.value;
    }
  }
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new HingeError("network", "websocket open failed")), { once: true });
  });
}

async function parseProxyBody<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function stringifyBody(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
