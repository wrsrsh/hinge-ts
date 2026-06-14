# hinge-ts

Unofficial browser-first TypeScript SDK for Hinge APIs, including Sendbird chat
through a user-hosted proxy.

`hinge-ts` provides typed API groups, session persistence, redacted logging
helpers, raw escape hatches, and Sendbird REST/realtime support.

## Install

```bash
npm install hinge-ts
```

## Quickstart

Full browser feature parity requires a proxy because browsers cannot set the
custom Hinge and Sendbird WebSocket headers directly.

```ts
import {
  BrowserStorage,
  Email2FAError,
  HingeClient,
  HingeProxyTransport,
  ProxySendbirdRealtimeTransport
} from "hinge-ts";

const client = HingeClient.builder()
  .phoneNumber("+15555550123")
  .transport(new HingeProxyTransport({ baseUrl: "/api/hinge-proxy" }))
  .realtimeTransport(new ProxySendbirdRealtimeTransport({ url: "/api/hinge-proxy/ws/sendbird" }))
  .storage(new BrowserStorage())
  .build();

await client.auth.initiateSms();

try {
  await client.auth.submitOtp("123456");
} catch (error) {
  if (error instanceof Email2FAError) {
    await client.auth.submitEmailCode(error.caseId, "654321");
  } else {
    throw error;
  }
}

const recs = await client.recommendations.get();
console.log(recs.feeds[0]?.subjects.length ?? 0);
```

## Covers

- Auth: device install, SMS OTP, email 2FA, Sendbird token refresh.
- Recommendations: multi-fetch, rate-limit backoff, cache merge, repeat profiles.
- Profiles: self/public profile and content reads, batched public reads, updates.
- Likes and ratings: likes list, limits, skip, like, note, text review, respond.
- Prompts: prompt payloads, cache, search, categories, create/evaluate helpers.
- Connections and settings: connections, standouts, account, notifications, export status.
- Chat: Sendbird channels, messages, full history, send message, realtime commands.
- Persistence: portable session JSON, browser and memory storage.
- Raw Hinge and Sendbird request escape hatches.

## Docs

- [Auth](docs/auth.md)
- [Proxy](docs/proxy.md)
- [Chat](docs/chat.md)
- [Recommendations](docs/recommendations.md)
- [Profiles](docs/profiles.md)
- [Likes and ratings](docs/ratings.md)
- [Prompts](docs/prompts.md)
- [Persistence](docs/persistence.md)
- [Raw requests](docs/raw.md)

## Development

```bash
npm install
npm run typecheck
npm test
npm run pack:dry
```

## Status

Unofficial and not affiliated with Hinge, Match Group, or Sendbird.

## License

Licensed under [MIT](LICENSE-MIT).
