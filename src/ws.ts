import { HingeError } from "./errors.js";
import type { SendbirdSyevEvent } from "./types.js";

export type SendbirdWsEvent =
  | { kind: "sessionKey"; key: string }
  | { kind: "read"; reqId?: string; payload: unknown }
  | { kind: "typing"; event: SendbirdSyevEvent }
  | { kind: "ping"; payload: unknown }
  | { kind: "pong"; payload: unknown }
  | { kind: "close"; code?: number; reason?: string }
  | { kind: "raw"; frame: string };

export class SendbirdWsSubscription implements AsyncIterable<SendbirdWsEvent> {
  constructor(
    private readonly commandSender: (command: string) => void,
    private readonly rawEvents: AsyncIterable<string>
  ) {}

  send(command: string): void {
    this.commandSender(command);
  }

  async *raw(): AsyncIterable<string> {
    yield* this.rawEvents;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SendbirdWsEvent> {
    for await (const frame of this.rawEvents) {
      yield parseSendbirdWsFrame(frame);
    }
  }
}

export function parseSendbirdWsFrame(frame: string): SendbirdWsEvent {
  if (frame.startsWith("__SESSION_KEY__:")) {
    return { kind: "sessionKey", key: frame.slice("__SESSION_KEY__:".length) };
  }
  if (frame.startsWith("__SYEV__:")) {
    return { kind: "typing", event: parseJson(frame.slice("__SYEV__:".length)) as SendbirdSyevEvent };
  }
  if (frame.startsWith("__CLOSE__")) {
    const rest = frame.slice("__CLOSE__:".length);
    const [codeText, ...reasonParts] = rest.split(":");
    const parsedCode = codeText ? Number.parseInt(codeText, 10) : undefined;
    const reason = reasonParts.join(":") || undefined;
    const out: SendbirdWsEvent = { kind: "close" };
    if (parsedCode !== undefined && Number.isFinite(parsedCode)) out.code = parsedCode;
    if (reason !== undefined) out.reason = reason;
    return out;
  }

  const start = frame.indexOf("{");
  if (start < 0) {
    return { kind: "raw", frame };
  }
  const prefix = frame.slice(0, start);
  const payload = parseJson(frame.slice(start));
  switch (prefix) {
    case "LOGI":
      return { kind: "sessionKey", key: sendbirdLogiSessionKey(payload) ?? "" };
    case "READ":
      {
        const reqId = getString(payload, "req_id") ?? getString(payload, "reqId");
        const out: SendbirdWsEvent = { kind: "read", payload };
        if (reqId !== undefined) out.reqId = reqId;
        return out;
      }
    case "SYEV":
      return { kind: "typing", event: payload as SendbirdSyevEvent };
    case "PING":
      return { kind: "ping", payload };
    case "PONG":
      return { kind: "pong", payload };
    default:
      return { kind: "raw", frame };
  }
}

export function sendbirdLogiSessionKey(payload: unknown): string | undefined {
  return getString(payload, "key") ?? getString(payload, "session_key") ?? getString(payload, "sessionKey");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new HingeError("serde", "failed to parse sendbird websocket frame", { cause });
  }
}

function getString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const out = (value as Record<string, unknown>)[key];
  return typeof out === "string" ? out : undefined;
}
