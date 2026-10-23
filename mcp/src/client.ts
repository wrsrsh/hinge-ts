import {
  BrowserFetchTransport,
  HingeClient,
  type HingeLogger,
  type SendbirdConnectRequest,
  type SendbirdRealtimeConnection,
  type SendbirdRealtimeTransport
} from "hinge-ts";
import { basename } from "node:path";
import WebSocket, { type RawData } from "ws";
import type { HingeMcpConfig } from "./config.js";
import { FileStorage } from "./storage.js";

export const UNSET_PHONE_NUMBER = "unset";

export type HingeMcpContext = {
  client: HingeClient;
  config: HingeMcpConfig;
  storage: FileStorage;
  sessionKey: string;
  saveSession(): Promise<void>;
  loadSession(): Promise<void>;
  ensureChatSession(): Promise<void>;
  hasPhoneNumber(): boolean;
};

/**
 * Builds a HingeClient that talks to Hinge directly from Node using global
 * fetch and persists the session to a file.
 */
export function createHingeContext(config: HingeMcpConfig, logger?: HingeLogger): HingeMcpContext {
  const storage = new FileStorage(config.cacheDir);
  const sessionKey = basename(config.sessionFile);
  let builder = HingeClient.builder()
    .phoneNumber(config.phoneNumber ?? UNSET_PHONE_NUMBER)
    .transport(new BrowserFetchTransport(logger ? { logger } : {}))
    .realtimeTransport(new NodeSendbirdRealtimeTransport())
    .storage(storage);
  if (logger) {
    builder = builder.logger(logger);
  }
  const client = builder.build();
  client.persistence.configure(config.sessionFile, config.cacheDir, true);
  return {
    client,
    config,
    storage,
    sessionKey,
    saveSession: () => client.persistence.saveSession(config.sessionFile),
    loadSession: async () => {
      await client.persistence.loadSession(config.sessionFile);
      if (config.phoneNumber && client.phoneNumber === UNSET_PHONE_NUMBER) {
        client.phoneNumber = config.phoneNumber;
      }
    },
    ensureChatSession: async () => {
      await client.ensureRealtime();
    },
    hasPhoneNumber: () => client.phoneNumber !== UNSET_PHONE_NUMBER && client.phoneNumber.trim().length > 0
  };
}

class NodeSendbirdRealtimeTransport implements SendbirdRealtimeTransport {
  async connect(input: SendbirdConnectRequest): Promise<SendbirdRealtimeConnection> {
    const socket = new WebSocket(input.url, { headers: input.headers });
    const connection = new NodeSendbirdConnection(socket);
    await connection.opened();
    return connection;
  }
}

class NodeSendbirdConnection implements SendbirdRealtimeConnection {
  private readonly queue: string[] = [];
  private readonly waiters: Array<(value: IteratorResult<string>) => void> = [];
  private closed = false;
  private error: unknown;

  constructor(private readonly socket: WebSocket) {
    socket.on("message", (data: RawData) => this.push(data.toString()));
    socket.on("close", (code, reason) => {
      this.closed = true;
      this.push(`__CLOSE__:${code}:${reason.toString()}`);
    });
    socket.on("error", (error) => {
      this.error = error;
      this.closed = true;
      this.flushClosed();
    });
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
  }

  send(frame: string): void {
    this.socket.send(frame);
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }

  async *events(): AsyncIterable<string> {
    while (true) {
      const queued = this.queue.shift();
      if (queued !== undefined) {
        yield queued;
        continue;
      }
      if (this.closed) {
        if (this.error) throw this.error;
        return;
      }
      const next = await new Promise<IteratorResult<string>>((resolve) => this.waiters.push(resolve));
      if (next.done) return;
      yield next.value;
    }
  }

  private push(value: string): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.queue.push(value);
  }

  private flushClosed(): void {
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }
}

export function stderrLogger(enabled: boolean): HingeLogger | undefined {
  if (!enabled) return undefined;
  const write = (level: string) => (...args: unknown[]) => {
    process.stderr.write(`[hinge-mcp ${level}] ${args.map(formatArg).join(" ")}\n`);
  };
  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error")
  };
}

function formatArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
