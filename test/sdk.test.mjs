import assert from "node:assert/strict";
import test from "node:test";
import {
  HingeClient,
  HingeError,
  MemoryStorage,
  parseSendbirdWsFrame,
  redactHeaders
} from "../dist/index.js";

class MockTransport {
  requests = [];
  handlers = new Map();

  on(method, path, handler) {
    this.handlers.set(`${method} ${path}`, handler);
    return this;
  }

  async request(input) {
    this.requests.push(input);
    const handler = this.handlers.get(`${input.method} ${input.pathOrUrl}`);
    if (!handler) {
      return { status: 200, headers: {}, body: {} };
    }
    const result = await handler(input);
    if (result instanceof Error) {
      throw result;
    }
    return { status: result.status ?? 200, headers: result.headers ?? {}, body: result.body };
  }
}

test("redacts sensitive headers", () => {
  const headers = redactHeaders({
    authorization: "Bearer hinge-secret",
    "sb-access-token": "sendbird-secret",
    "session-key": "session-secret",
    "x-device-id": "DEVICE-123456"
  });

  assert.equal(headers.authorization, "Bearer ***REDACTED***");
  assert.equal(headers["sb-access-token"], "***REDACTED***");
  assert.equal(headers["session-key"], "***REDACTED***");
  assert.equal(headers["x-device-id"], "***3456");
});

test("parses sendbird websocket frames", () => {
  assert.deepEqual(parseSendbirdWsFrame('LOGI{"key":"session-key"}'), {
    kind: "sessionKey",
    key: "session-key"
  });
  assert.deepEqual(parseSendbirdWsFrame('READ{"req_id":"r1","channel_url":"c"}'), {
    kind: "read",
    reqId: "r1",
    payload: { req_id: "r1", channel_url: "c" }
  });
  assert.equal(parseSendbirdWsFrame('SYEV{"cat":10900,"channel_url":"c"}').kind, "typing");
  assert.equal(parseSendbirdWsFrame("NOPE{}").kind, "raw");
});

test("saves and loads portable session json", async () => {
  const storage = new MemoryStorage();
  const client = HingeClient.builder().phoneNumber("+15555550123").storage(storage).build();
  client.deviceId = "device";
  client.installId = "install";
  client.sessionId = "session";
  client.installed = true;
  client.hingeAuth = { identityId: "user-1", token: "hinge-token", expires: "2999-01-01T00:00:00Z" };
  client.sendbirdAuth = { token: "sendbird-token", expires: "2999-01-01T00:00:00Z" };
  client.sendbirdSessionKey = "sendbird-session";

  await client.persistence.saveSession("session.json");

  const restored = HingeClient.builder().phoneNumber("+10000000000").storage(storage).build();
  await restored.persistence.loadSession("session.json");

  assert.equal(restored.phoneNumber, "+15555550123");
  assert.equal(restored.deviceId, "device");
  assert.equal(restored.session().hingeIdentityId, "user-1");
  assert.equal(restored.session().hingeAuthToken.hint, "***oken");
});

test("auth sends install and sms initiation requests", async () => {
  const transport = new MockTransport()
    .on("POST", "/identity/install", () => ({ body: {} }))
    .on("POST", "/auth/sms/v2/initiate", () => ({ body: {} }));
  const client = HingeClient.builder().phoneNumber("+15555550123").transport(transport).build();

  await client.auth.initiateSms();

  assert.equal(transport.requests[0].pathOrUrl, "/identity/install");
  assert.equal(transport.requests[1].pathOrUrl, "/auth/sms/v2/initiate");
  assert.equal(transport.requests[1].body.phoneNumber, "+15555550123");
  assert.equal(client.installed, true);
});

test("submit otp stores tokens", async () => {
  const transport = new MockTransport().on("POST", "/auth/sms/v2", () => ({
    body: {
      hingeAuthToken: { identityId: "user-1", token: "hinge-token", expires: "2999-01-01T00:00:00Z" },
      sendbirdAuthToken: { token: "sendbird-token", expires: "2999-01-01T00:00:00Z" }
    }
  }));
  const client = HingeClient.builder().phoneNumber("+15555550123").transport(transport).build();

  await client.auth.submitOtp("123456");

  assert.equal(client.hingeAuth.identityId, "user-1");
  assert.equal(client.sendbirdAuth.token, "sendbird-token");
});

test("send message generates dedup id and posts hinge payload", async () => {
  const transport = new MockTransport()
    .on("GET", "/users/user-1/my_group_channels?&members_exactly_in=peer-1&show_latest_message=false&distinct_mode=all&hidden_mode=unhidden_only&show_pinned_messages=false&show_metadata=true&member_state_filter=all&user_id=user-1&is_explicit_request=true&public_mode=all&include_left_channel=false&show_conversation=false&show_frozen=true&is_feed_channel=false&show_delivery_receipt=true&unread_filter=all&super_mode=all&show_member=true&show_read_receipt=true&order=chronological&show_empty=true&include_chat_notification=false&limit=1", () => ({ body: { channels: [{ channel_url: "c1" }] } }))
    .on("POST", "/message/send", () => ({ body: { ok: true } }));
  const client = HingeClient.builder().phoneNumber("+15555550123").transport(transport).build();
  client.hingeAuth = { identityId: "user-1", token: "hinge-token", expires: "2999-01-01T00:00:00Z" };
  client.sendbirdAuth = { token: "sendbird-token", expires: "2999-01-01T00:00:00Z" };

  await client.chat.sendMessage({
    ays: false,
    matchMessage: true,
    messageType: "text",
    messageData: { message: "hello" },
    subjectId: "peer-1",
    origin: "connection"
  });

  const send = transport.requests.find((request) => request.pathOrUrl === "/message/send");
  assert.equal(send.body.messageData.message, "hello");
  assert.match(send.body.dedupId, /^[0-9A-F-]+$/);
});

test("send message falls back to sendbird when hinge send is rejected", async () => {
  const transport = new MockTransport()
    .on("GET", "/users/user-1/my_group_channels?&members_exactly_in=peer-1&show_latest_message=false&distinct_mode=all&hidden_mode=unhidden_only&show_pinned_messages=false&show_metadata=true&member_state_filter=all&user_id=user-1&is_explicit_request=true&public_mode=all&include_left_channel=false&show_conversation=false&show_frozen=true&is_feed_channel=false&show_delivery_receipt=true&unread_filter=all&super_mode=all&show_member=true&show_read_receipt=true&order=chronological&show_empty=true&include_chat_notification=false&limit=1", () => ({ body: { channels: [{ channel_url: "c1" }] } }))
    .on("POST", "/message/send", () => ({ status: 400, body: { message: "Error" } }))
    .on("POST", "/group_channels/c1/messages", () => ({ body: { message_id: 123 } }));
  const client = HingeClient.builder().phoneNumber("+15555550123").transport(transport).build();
  client.hingeAuth = { identityId: "user-1", token: "hinge-token", expires: "2999-01-01T00:00:00Z" };
  client.sendbirdAuth = { token: "sendbird-token", expires: "2999-01-01T00:00:00Z" };

  await client.chat.sendMessage({
    ays: false,
    matchMessage: true,
    messageType: "text",
    messageData: { message: "hello" },
    subjectId: "peer-1",
    origin: "connection",
    dedupId: "DEDUP-1"
  });

  const fallback = transport.requests.find((request) => request.pathOrUrl === "/group_channels/c1/messages");
  assert.equal(fallback.body.message_type, "MESG");
  assert.equal(fallback.body.user_id, "user-1");
  assert.equal(fallback.body.message, "hello");
  assert.equal(fallback.body.dedup_id, "DEDUP-1");
});

test("recommendations multi-fetch merges and normalizes subjects", async () => {
  let call = 0;
  const transport = new MockTransport().on("POST", "/rec/v2", () => {
    call += 1;
    return {
      body: {
        feeds: [{
          id: call,
          origin: "compatibles",
          subjects: [{ subjectId: `s${call}`, ratingToken: `r${call}` }]
        }]
      }
    };
  });
  const client = HingeClient.builder()
    .phoneNumber("+15555550123")
    .transport(transport)
    .recsFetchConfig({ multiFetchCount: 2, requestDelayMs: 0 })
    .build();
  client.hingeAuth = { identityId: "user-1", token: "hinge-token", expires: "2999-01-01T00:00:00Z" };

  const recs = await client.recommendations.get();

  assert.equal(recs.feeds.length, 1);
  assert.deepEqual(recs.feeds[0].subjects.map((subject) => subject.subjectId), ["s1", "s2"]);
});

test("public profile lookups post the feed viewToken when known", async () => {
  const transport = new MockTransport()
    .on("POST", "/rec/v2", () => ({
      body: {
        feeds: [{
          id: 1,
          origin: "compatibles",
          viewToken: "view-1",
          subjects: [{ subjectId: "11", ratingToken: "r1" }],
          preview: { subjects: [{ subjectId: "12", ratingToken: "rp1" }] }
        }]
      }
    }))
    .on("GET", "/standouts/v3", () => ({ body: { viewToken: "view-standouts", standouts: [{ subjectId: "21", ratingToken: "rs1" }] } }))
    .on("POST", "/user/v3/public", (input) => ({ body: input.body.ids.map((userId) => ({ userId, profile: { firstName: `${userId}-${input.body.viewToken}` } })) }))
    .on("POST", "/content/v2/public", (input) => ({ body: input.body.ids.map((userId) => ({ userId, content: { answers: [{ contentId: "c", questionId: "q", response: "text" }], photos: [] } })) }))
    .on("GET", "/user/v3/public?ids=99", () => ({ body: [{ userId: "99", profile: {} }] }));
  const client = HingeClient.builder()
    .phoneNumber("+15555550123")
    .transport(transport)
    .recsFetchConfig({ multiFetchCount: 1, requestDelayMs: 0 })
    .build();
  client.hingeAuth = { identityId: "user-1", token: "hinge-token", expires: "2999-01-01T00:00:00Z" };

  const recs = await client.recommendations.get();
  await client.connections.standouts();
  assert.equal(recs.feeds[0].subjects[0].viewToken, "view-1");
  assert.equal(client.viewTokenFor("12"), "view-1");
  assert.equal(client.viewTokenFor("21"), "view-standouts");

  const profiles = await client.profiles.public(["11", "21", "99"]);
  assert.deepEqual(profiles.map((profile) => profile.profile.firstName), ["11-view-1", "21-view-standouts", undefined]);
  const posts = transport.requests.filter((request) => request.method === "POST" && request.pathOrUrl === "/user/v3/public");
  assert.deepEqual(posts.map((request) => request.body), [
    { ids: ["11"], viewToken: "view-1" },
    { ids: ["21"], viewToken: "view-standouts" }
  ]);
  assert.equal(transport.requests.filter((request) => request.method === "GET" && request.pathOrUrl.startsWith("/user/v3/public")).length, 1);

  const content = await client.profiles.publicContent(["11"], "view-override");
  assert.equal(content[0].content.answers[0].response, "text");
  assert.deepEqual(transport.requests.at(-1).body, { ids: ["11"], viewToken: "view-override" });
});

test("missing transport errors clearly", async () => {
  const client = HingeClient.builder().phoneNumber("+15555550123").build();
  await assert.rejects(() => client.likes.limit(), HingeError);
});

const DM_LOOKUP_PATH = "/users/user-1/my_group_channels?&members_exactly_in=peer-1&show_latest_message=false&distinct_mode=all&hidden_mode=unhidden_only&show_pinned_messages=false&show_metadata=true&member_state_filter=all&user_id=user-1&is_explicit_request=true&public_mode=all&include_left_channel=false&show_conversation=false&show_frozen=true&is_feed_channel=false&show_delivery_receipt=true&unread_filter=all&super_mode=all&show_member=true&show_read_receipt=true&order=chronological&show_empty=true&include_chat_notification=false&limit=1";

function authedClient(transport, extra = {}) {
  let builder = HingeClient.builder().phoneNumber("+15555550123").transport(transport);
  if (extra.realtimeTransport) builder = builder.realtimeTransport(extra.realtimeTransport);
  const client = builder.build();
  client.hingeAuth = { identityId: "user-1", token: "hinge-token", expires: "2999-01-01T00:00:00Z" };
  client.sendbirdAuth = { token: "sendbird-token", expires: "2999-01-01T00:00:00Z" };
  return client;
}

test("creates distinct dm with sendbird snake_case body", async () => {
  const transport = new MockTransport()
    .on("GET", DM_LOOKUP_PATH, () => ({ body: { channels: [] } }))
    .on("POST", "/group_channels?", () => ({ body: { channel_url: "created-1" } }));
  const client = authedClient(transport);

  const channelUrl = await client.chat.getOrCreateDmChannel("user-1", "peer-1");

  const create = transport.requests.find((request) => request.pathOrUrl === "/group_channels?");
  assert.equal(channelUrl, "created-1");
  assert.deepEqual(create.body.user_ids, ["peer-1", "user-1"]);
  assert.equal(create.body.is_distinct, true);
  assert.equal(create.body.userIds, undefined);
});

test("send message does not fall back when there is no text to resend", async () => {
  const transport = new MockTransport()
    .on("GET", DM_LOOKUP_PATH, () => ({ body: { channels: [{ channel_url: "c1" }] } }))
    .on("POST", "/message/send", () => ({ status: 400, body: { message: "Error" } }));
  const client = authedClient(transport);

  await assert.rejects(() => client.chat.sendMessage({
    ays: false,
    matchMessage: true,
    messageType: "gif",
    messageData: { message: "" },
    subjectId: "peer-1",
    origin: "connection"
  }), (error) => error instanceof HingeError && error.status === 400);
  assert.equal(transport.requests.some((request) => request.pathOrUrl === "/group_channels/c1/messages"), false);
});

test("recommendations surface rate limiting when nothing was fetched", async () => {
  const transport = new MockTransport().on("POST", "/rec/v2", () => new HingeError("http", "status 429: {}", { status: 429 }));
  const client = HingeClient.builder()
    .phoneNumber("+15555550123")
    .transport(transport)
    .recsFetchConfig({ multiFetchCount: 1, requestDelayMs: 0, rateLimitRetries: 1, rateLimitBackoffMs: 0 })
    .build();
  client.hingeAuth = { identityId: "user-1", token: "hinge-token", expires: "2999-01-01T00:00:00Z" };

  await assert.rejects(() => client.recommendations.get(), (error) => error instanceof HingeError && error.status === 429);
});

class MockRealtimeConnection {
  sent = [];
  queue = [];
  waiters = [];
  closed = false;

  send(frame) {
    this.sent.push(frame);
  }

  close() {
    this.emit(undefined);
  }

  emit(frame) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(frame);
    else this.queue.push(frame);
  }

  async *events() {
    while (true) {
      const frame = this.queue.length ? this.queue.shift() : await new Promise((resolve) => this.waiters.push(resolve));
      if (frame === undefined) return;
      yield frame;
    }
  }
}

class MockRealtimeTransport {
  connections = [];

  async connect() {
    const connection = new MockRealtimeConnection();
    this.connections.push(connection);
    queueMicrotask(() => connection.emit('LOGI{"key":"session-key-1","user_id":"user-1"}'));
    return connection;
  }
}

test("realtime connect waits for login, dedups concurrent connects, and recovers after close", async () => {
  const realtimeTransport = new MockRealtimeTransport();
  const client = authedClient(new MockTransport(), { realtimeTransport });

  const [first, second] = await Promise.all([client.chat.subscribeEvents(), client.chat.subscribeEvents()]);
  assert.equal(realtimeTransport.connections.length, 1);
  assert.equal(client.sendbirdSessionKey, "session-key-1");

  const connection = realtimeTransport.connections[0];
  const iterator = first[Symbol.asyncIterator]();
  connection.emit('PONG{"ts":1}');
  assert.equal((await iterator.next()).value.kind, "pong");

  const pendingRead = client.chat.markRead("channel-1");
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(connection.sent[0], /^READ\{/);
  connection.close();
  await assert.rejects(pendingRead, (error) => error instanceof HingeError && error.kind === "network");
  assert.deepEqual(await iterator.next(), { value: undefined, done: true });
  const secondIterator = second[Symbol.asyncIterator]();
  assert.equal((await secondIterator.next()).value.kind, "pong");
  assert.deepEqual(await secondIterator.next(), { value: undefined, done: true });

  await client.chat.ping();
  assert.equal(realtimeTransport.connections.length, 2);
  assert.match(realtimeTransport.connections[1].sent[0], /^PING\{/);
});
