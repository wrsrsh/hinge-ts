import type { JsonValue } from "./types.js";

export type HingeLogger = {
  debug?(message: string, meta?: unknown): void;
  info?(message: string, meta?: unknown): void;
  warn?(message: string, meta?: unknown): void;
  error?(message: string, meta?: unknown): void;
};

const SENSITIVE_FULL = new Set([
  "authorization",
  "sb-access-token",
  "session-key",
  "x-session-key",
  "sendbird-ws-auth",
  "sendbird-ws-token",
  "senbird-ws-auth",
  "senbird-ws-token"
]);

const SENSITIVE_SUFFIX = new Set(["x-session-id", "x-device-id", "x-install-id"]);

export function redactHeaderValue(name: string, value: string): string {
  const lower = name.toLowerCase();
  if (lower === "authorization") {
    return "Bearer ***REDACTED***";
  }
  if (SENSITIVE_FULL.has(lower)) {
    return "***REDACTED***";
  }
  if (SENSITIVE_SUFFIX.has(lower)) {
    return `***${value.slice(-4)}`;
  }
  return value;
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = redactHeaderValue(name, value);
  }
  return out;
}

export function logRequest(
  logger: HingeLogger | undefined,
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: JsonValue
): void {
  logger?.info?.("http request", { method, url });
  logger?.debug?.("http request headers", redactHeaders(headers));
  if (body !== undefined) {
    logger?.debug?.("http request body", body);
  }
}

export function logResponse(
  logger: HingeLogger | undefined,
  status: number,
  headers: Record<string, string>,
  body?: JsonValue
): void {
  logger?.info?.("http response", { status });
  logger?.debug?.("http response headers", redactHeaders(headers));
  if (body !== undefined) {
    logger?.debug?.("http response body", body);
  }
}
