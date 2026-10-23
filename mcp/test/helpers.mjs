import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHingeContext } from "../dist/client.js";
import { configFromEnv } from "../dist/config.js";
import { createHingeMcpServer } from "../dist/server.js";

export const SESSION_VALID = "2999-01-01T00:00:00Z";

export class MockTransport {
  constructor() {
    this.routes = [];
    this.requests = [];
  }

  on(method, match, handler) {
    this.routes.push({ method, match, handler });
    return this;
  }

  async request(input) {
    this.requests.push(input);
    for (const route of this.routes) {
      const matches = typeof route.match === "string" ? input.pathOrUrl === route.match || input.pathOrUrl.startsWith(`${route.match}?`) : route.match.test(input.pathOrUrl);
      if (route.method === input.method && matches) {
        const result = await route.handler(input);
        if (result instanceof Error) throw result;
        return { status: result.status ?? 200, headers: {}, body: result.body ?? {} };
      }
    }
    return { status: 404, headers: {}, body: { message: `no mock for ${input.method} ${input.pathOrUrl}` } };
  }

  calls(method, prefix) {
    return this.requests.filter((request) => request.method === method && request.pathOrUrl.startsWith(prefix));
  }
}

export async function makeContext({ env = {}, transport = new MockTransport(), loggedIn = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "hinge-mcp-test-"));
  const config = configFromEnv({ HINGE_SESSION_FILE: join(dir, "session.json"), HINGE_PHONE_NUMBER: "+15555550123", ...env }, []);
  const context = createHingeContext(config);
  context.ensureChatSession = async () => {
    context.client.sendbirdSessionKey = "session-key";
  };
  context.client.transport = transport;
  context.client.setRecsFetchConfig({ multiFetchCount: 1, requestDelayMs: 0, rateLimitRetries: 0, rateLimitBackoffMs: 0 });
  if (loggedIn) {
    context.client.hingeAuth = { identityId: "1001", token: "hinge-token", expires: SESSION_VALID };
    context.client.sendbirdAuth = { token: "sendbird-token", expires: SESSION_VALID };
  }
  return { context, transport, dir };
}

export async function connect(context) {
  const server = createHingeMcpServer(context);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  return {
    client,
    server,
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      const text = result.content?.[0]?.text ?? "";
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { ...result, text, json };
    },
    async toolNames() {
      return (await client.listTools()).tools.map((tool) => tool.name).sort();
    },
    async close() {
      await client.close();
      await server.close();
    }
  };
}

export function publicProfile(userId, extra = {}) {
  return { user_id: userId, profile: { first_name: `User${userId}`, age: 30, location: { name: "Austin" }, ...extra } };
}

export function publicContent(userId, answers = []) {
  return { user_id: userId, content: { answers, photos: [{ url: `https://cdn.test/${userId}.jpg`, content_id: `photo-${userId}` }] } };
}
