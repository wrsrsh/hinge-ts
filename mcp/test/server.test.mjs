import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { connect, makeContext, MockTransport, publicContent, publicProfile } from "./helpers.mjs";

test("advertises auth, read, write, and chatgpt tools", async () => {
  const { context } = await makeContext();
  const session = await connect(context);
  const names = await session.toolNames();
  for (const expected of ["hinge_session_status", "hinge_login_start", "hinge_me", "hinge_recommendations", "hinge_like", "hinge_send_message", "search", "fetch"]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
  assert.equal(names.includes("hinge_raw_request"), false);
  const tools = (await session.client.listTools()).tools;
  const like = tools.find((tool) => tool.name === "hinge_like");
  assert.equal(like.annotations.readOnlyHint, false);
  assert.equal(tools.find((tool) => tool.name === "hinge_matches").annotations.readOnlyHint, true);
  await session.close();
});

test("read-only mode hides write tools and raw is opt-in", async () => {
  const readOnly = await connect((await makeContext({ env: { HINGE_MCP_READ_ONLY: "1" } })).context);
  const names = await readOnly.toolNames();
  assert.equal(names.some((name) => ["hinge_like", "hinge_skip", "hinge_send_message", "hinge_update_preferences", "hinge_raw_request"].includes(name)), false);
  assert.ok(names.includes("hinge_matches"));
  await readOnly.close();

  const raw = await connect((await makeContext({ env: { HINGE_MCP_ALLOW_RAW: "1" } })).context);
  assert.ok((await raw.toolNames()).includes("hinge_raw_request"));
  await raw.close();
});

test("session status reports logged out without a token", async () => {
  const { context } = await makeContext({ loggedIn: false });
  const session = await connect(context);
  const status = await session.call("hinge_session_status");
  assert.equal(status.isError, undefined);
  assert.equal(status.json.loggedIn, false);
  assert.equal(status.json.hasStoredToken, false);
  assert.equal(status.json.phoneNumber, "+15555550123");
  await session.close();
});

test("login flow sends otp, handles email 2fa, and persists the session", async () => {
  const transport = new MockTransport()
    .on("POST", "/identity/install", () => ({ body: {} }))
    .on("POST", "/auth/sms/v2/initiate", () => ({ body: {} }))
    .on("POST", "/auth/sms/v2", () => ({ status: 412, body: { caseId: "case-1", email: "w@example.com" } }))
    .on("POST", "/auth/device/validate", () => ({ body: { token: "new-hinge-token", identity_id: "1001", expires: "2999-01-01T00:00:00Z" } }))
    .on("POST", "/message/authenticate", () => ({ body: { token: "sb-token", expires: "2999-01-01T00:00:00Z" } }));
  const { context } = await makeContext({ transport, loggedIn: false });
  const session = await connect(context);

  const start = await session.call("hinge_login_start", { phoneNumber: "+15555550999" });
  assert.equal(start.json.status, "otp_sent");
  assert.equal(start.json.phoneNumber, "+15555550999");
  assert.equal(transport.calls("POST", "/auth/sms/v2/initiate")[0].body.phoneNumber, "+15555550999");

  const otp = await session.call("hinge_login_verify_otp", { otp: "123456" });
  assert.equal(otp.isError, undefined);
  assert.equal(otp.json.status, "email_verification_required");
  assert.equal(otp.json.caseId, "case-1");

  const email = await session.call("hinge_login_verify_email", { caseId: "case-1", code: "654321" });
  assert.equal(email.json.status, "logged_in");
  assert.equal(email.json.identityId, "1001");
  assert.equal(email.json.sendbirdReady, true);

  const saved = JSON.parse(await readFile(context.config.sessionFile, "utf8"));
  assert.equal(saved.hingeAuth.token, "new-hinge-token");
  assert.equal(saved.phoneNumber, "+15555550999");

  const status = await session.call("hinge_session_status");
  assert.equal(status.json.loggedIn, true);
  await session.close();
});

test("login start without a phone number is a tool error", async () => {
  const { context } = await makeContext({ env: { HINGE_PHONE_NUMBER: "" }, loggedIn: false });
  const session = await connect(context);
  const start = await session.call("hinge_login_start");
  assert.equal(start.isError, true);
  assert.match(start.text, /No phone number/);
  await session.close();
});

test("expired or missing auth becomes a helpful error", async () => {
  const transport = new MockTransport().on("GET", "/user/v3", () => ({ status: 401, body: { message: "unauthorized" } }));
  const { context } = await makeContext({ transport });
  const session = await connect(context);
  const me = await session.call("hinge_me");
  assert.equal(me.isError, true);
  assert.match(me.text, /hinge_login_start/);
  await session.close();
});

test("recommendations attach profile summaries with rating tokens", async () => {
  const transport = new MockTransport()
    .on("POST", "/rec/v2", () => ({ body: { feeds: [{ id: 1, origin: "compatibles", subjects: [{ subject_id: "1002", rating_token: "tok-2" }, { subject_id: "1003", rating_token: "tok-3" }] }] } }))
    .on("GET", "/user/v3/public", () => ({ body: [publicProfile("1002", { first_name: "Sam", job_title: "Nurse" }), publicProfile("1003", { first_name: "Alex" })] }))
    .on("GET", "/content/v2/public", () => ({ body: [publicContent("1002", [{ question: "Two truths", answer: "one lie", content_id: "c-1" }]), publicContent("1003")] }));
  const { context } = await makeContext({ transport });
  const session = await connect(context);
  const recs = await session.call("hinge_recommendations", { limit: 1 });
  assert.equal(recs.isError, undefined);
  assert.equal(recs.json.subjects.length, 1);
  const [subject] = recs.json.subjects;
  assert.equal(subject.subjectId, "1002");
  assert.equal(subject.ratingToken, "tok-2");
  assert.equal(subject.profile.name, "Sam");
  assert.match(subject.profile.text, /Job Title: Nurse/);
  assert.equal(subject.profile.prompts[0].contentId, "c-1");
  assert.equal(transport.calls("GET", "/user/v3/public")[0].pathOrUrl, "/user/v3/public?ids=1002");
  await session.close();
});

test("like and skip post ratings", async () => {
  const transport = new MockTransport()
    .on("POST", "/flag/textreview", () => ({ body: { hcm_run_id: "run-1" } }))
    .on("POST", "/rate/v2/initiate", () => ({ body: { ok: true } }));
  const { context } = await makeContext({ transport });
  const session = await connect(context);

  const like = await session.call("hinge_like", { subjectId: "1002", ratingToken: "tok", comment: "hey", contentId: "c-1", questionText: "Two truths", answerText: "one lie", useRose: true });
  assert.equal(like.json.status, "liked");
  const likeBody = transport.calls("POST", "/rate/v2/initiate")[0].body;
  assert.equal(likeBody.rating, "note");
  assert.equal(likeBody.initiatedWith, "superlike");
  assert.equal(likeBody.hcmRunId, "run-1");
  assert.equal(likeBody.content.prompt.contentId, "c-1");

  const skip = await session.call("hinge_skip", { subjectId: "1003", ratingToken: "tok3" });
  assert.equal(skip.json.status, "skipped");
  assert.equal(transport.calls("POST", "/rate/v2/initiate")[1].body.rating, "skip");
  await session.close();
});

test("send message detects a first message and posts through hinge", async () => {
  const transport = new MockTransport()
    .on("GET", /my_group_channels/, () => ({ body: { channels: [{ channel_url: "ch-1" }] } }))
    .on("GET", /^\/group_channels\/ch-1\/messages/, () => ({ body: { messages: [] } }))
    .on("POST", "/message/send", (input) => ({ body: { accepted: input.body.messageData.message } }));
  const { context } = await makeContext({ transport });
  const session = await connect(context);
  const sent = await session.call("hinge_send_message", { subjectId: "1002", message: "hello there" });
  assert.equal(sent.isError, undefined);
  assert.equal(sent.json.status, "sent");
  const body = transport.calls("POST", "/message/send")[0].body;
  assert.equal(body.matchMessage, true);
  assert.equal(body.subjectId, "1002");
  assert.equal(body.messageData.message, "hello there");
  await session.close();
});

test("chats and messages summarize sendbird payloads", async () => {
  const transport = new MockTransport()
    .on("GET", /my_group_channels/, () => ({ body: { channels: [{ channel_url: "ch-1", unread_message_count: 2, members: [{ user_id: "1001", nickname: "Me" }, { user_id: "1002", nickname: "Sam" }], last_message: { message_id: "m2", message: "see you", created_at: 1700000001000, user: { user_id: "1002", nickname: "Sam" }, channel_url: "ch-1" } }] } }))
    .on("GET", /^\/group_channels\/ch-1\/messages/, () => ({ body: { messages: [
      { message_id: "m2", message: "see you", created_at: 1700000001000, user: { user_id: "1002", nickname: "Sam" }, channel_url: "ch-1" },
      { message_id: "m1", message: "hi", created_at: 1700000000000, user: { user_id: "1001", nickname: "Me" }, channel_url: "ch-1" }
    ] } }));
  const { context } = await makeContext({ transport });
  let chatSessionStarted = false;
  context.ensureChatSession = async () => {
    chatSessionStarted = true;
    context.client.sendbirdSessionKey = "session-key";
  };
  const session = await connect(context);
  const chats = await session.call("hinge_chats");
  assert.equal(chatSessionStarted, true);
  assert.equal(chats.json.channels[0].partnerName, "Sam");
  assert.equal(chats.json.channels[0].unreadMessageCount, 2);
  assert.equal(chats.json.channels[0].lastMessage.text, "see you");
  const messages = await session.call("hinge_chat_messages", { channelUrl: "ch-1" });
  assert.deepEqual(messages.json.messages.map((message) => [message.fromSelf, message.text]), [[true, "hi"], [false, "see you"]]);
  await session.close();
});

test("search and fetch follow the chatgpt connector contract", async () => {
  const transport = new MockTransport()
    .on("GET", "/connection/v2", () => ({ body: { connections: [{ initiator_id: "1001", subject_id: "1002" }, { initiator_id: "1003", subject_id: "1003" }] } }))
    .on("GET", "/user/v3/public", () => ({ body: [publicProfile("1002", { first_name: "Sam" }), publicProfile("1003", { first_name: "Alex", location: { name: "Denver" } })] }))
    .on("GET", "/content/v2/public", () => ({ body: [publicContent("1002"), publicContent("1003")] }))
    .on("GET", /^\/sdk\/group_channels\/ch-1/, () => ({ body: { channel_url: "ch-1", members: [{ user_id: "1001" }, { user_id: "1002", nickname: "Sam" }] } }))
    .on("GET", /^\/group_channels\/ch-1\/messages/, () => ({ body: { messages: [{ message_id: "m1", message: "hi", created_at: 1700000000000, user: { user_id: "1001" }, channel_url: "ch-1" }] } }));
  const { context } = await makeContext({ transport });
  const session = await connect(context);

  const all = await session.call("search", { query: "" });
  assert.equal(all.json.results.length, 2);
  const denver = await session.call("search", { query: "denver" });
  assert.deepEqual(denver.json.results.map((result) => result.id), ["match:1003"]);
  assert.match(denver.json.results[0].title, /Alex/);

  const profile = await session.call("fetch", { id: "match:1002" });
  assert.equal(profile.json.id, "match:1002");
  assert.match(profile.json.text, /Name: Sam/);
  assert.equal(profile.json.metadata.userId, "1002");

  const chat = await session.call("fetch", { id: "chat:ch-1" });
  assert.equal(chat.json.title, "Chat with Sam");
  assert.match(chat.json.text, /You: hi/);
  assert.equal(chat.json.metadata.messageCount, 1);

  const missing = await session.call("fetch", { id: "profile:9999" });
  assert.equal(missing.isError, true);
  await session.close();
});
