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
    .on("GET", "/v3/users/user-1/my_group_channels?&members_exactly_in=peer-1&show_latest_message=false&distinct_mode=all&hidden_mode=unhidden_only&show_pinned_messages=false&show_metadata=true&member_state_filter=all&user_id=user-1&is_explicit_request=true&public_mode=all&include_left_channel=false&show_conversation=false&show_frozen=true&is_feed_channel=false&show_delivery_receipt=true&unread_filter=all&super_mode=all&show_member=true&show_read_receipt=true&order=chronological&show_empty=true&include_chat_notification=false&limit=1", () => ({ body: { channels: [{ channel_url: "c1" }] } }))
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

test("missing transport errors clearly", async () => {
  const client = HingeClient.builder().phoneNumber("+15555550123").build();
  await assert.rejects(() => client.likes.limit(), HingeError);
});
