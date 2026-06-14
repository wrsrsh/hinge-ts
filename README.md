# hinge-ts

Typed browser SDK for Hinge automation, with Hinge REST, Sendbird chat, session
persistence, redacted logging, and raw escape hatches.

This package is a TypeScript port of https://github.com/f0rr0/hinge-rs/.

This package is unofficial and is not affiliated with Hinge, Match Group, or
Sendbird.

## Install

```bash
npm install hinge-ts
```

## Runtime Model

`hinge-ts` is browser-first. Full network access runs through your proxy:

- browser app owns SDK state, types, persistence, and API calls
- proxy performs upstream Hinge and Sendbird requests with SDK-generated headers
- proxy relays Sendbird WebSocket frames because browser WebSocket cannot set
  the required custom handshake headers

Use `BrowserFetchTransport` only for environments where direct upstream requests
are explicitly allowed.

## Login

```ts
import {
  BrowserStorage,
  Email2FAError,
  HingeClient,
  HingeProxyTransport,
  ProxySendbirdRealtimeTransport
} from "hinge-ts";

const proxyToken = "your-short-lived-proxy-token";

const client = HingeClient.builder()
  .phoneNumber("+15555550123")
  .transport(new HingeProxyTransport({
    baseUrl: "/api/hinge-proxy",
    headers: { authorization: `Bearer ${proxyToken}` }
  }))
  .realtimeTransport(
    new ProxySendbirdRealtimeTransport({
      url: `/api/hinge-proxy/ws/sendbird?token=${encodeURIComponent(proxyToken)}`
    })
  )
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

await client.persistence.saveSession("session.json");
```

## Use

```ts
await client.persistence.loadSession("session.json");

const recs = await client.recommendations.get();
const me = await client.profiles.me();
const likes = await client.likes.list();

await client.ratings.skip({
  subjectId: recs.feeds[0].subjects[0].subjectId,
  ratingToken: recs.feeds[0].subjects[0].ratingToken
});

await client.chat.sendMessage({
  ays: false,
  matchMessage: true,
  messageType: "text",
  messageData: { message: "hey" },
  subjectId: "peer-user-id",
  origin: "connection"
});
```

## Realtime Chat

```ts
const subscription = await client.chat.subscribeEvents();

for await (const event of subscription) {
  if (event.kind === "typing") {
    console.log(event.event.channelUrl);
  }
}
```

Commands:

```ts
await client.chat.markRead("channel-url");
await client.chat.typingStart("channel-url");
await client.chat.typingEnd("channel-url");
await client.chat.ackMessage("channel-url", "message-id");
await client.chat.closeWs({ code: 1000, reason: "done" });
```

## API Surface

| Group | Methods |
| --- | --- |
| `auth` | `initiateSms`, `submitOtp`, `submitEmailCode`, `isSessionValid`, `loadTokensSecure` |
| `recommendations` | `get`, `getWithParams`, `repeatProfiles`, `save`, `load`, `cached`, `remove` |
| `profiles` | `me`, `content`, `preferences`, `public`, `publicContent`, `update`, `updatePreferences`, `updateAnswers`, `deleteContent` |
| `likes` | `limit`, `list`, `listRaw`, `subject`, `matchNote` |
| `ratings` | `skip`, `rateUser`, `respond` |
| `prompts` | `list`, `manager`, `text`, `search`, `byCategory`, `payload`, `evaluateAnswer`, `createPromptPoll`, `createVideoPrompt` |
| `connections` | `list`, `detail`, `matchNote`, `standouts` |
| `settings` | `preferences`, `updatePreferences`, `content`, `updateContent`, `auth`, `notifications`, `userTraits`, `accountInfo`, `exportStatus` |
| `chat` | `credentials`, `channels`, `channel`, `messages`, `fullMessages`, `sendMessage`, `subscribeEvents`, `markRead`, `typingStart`, `typingEnd` |
| `persistence` | `saveSession`, `loadSession`, `configure` |
| `raw` | `hinge`, `sendbird` |

## Proxy Contract

REST proxy endpoint:

```http
POST /api/hinge-proxy/request
```

Body:

```json
{
  "service": "hinge",
  "method": "POST",
  "pathOrUrl": "/auth/sms/v2/initiate",
  "url": "https://prod-api.hingeaws.net/auth/sms/v2/initiate",
  "headers": {},
  "body": {},
  "responseType": "json"
}
```

Realtime proxy endpoint:

```http
GET /api/hinge-proxy/ws/sendbird?token=...
```

The browser sends a `connect` payload first. The proxy opens the upstream
Sendbird socket with the provided headers, then relays text frames both ways.

Use an `Authorization` header for REST calls and a short-lived query token for
the realtime socket.

See [docs/proxy.md](docs/proxy.md), [docs/deploy.md](docs/deploy.md), and
[examples](examples).

## Docs

- [Auth](docs/auth.md)
- [Proxy](docs/proxy.md)
- [Deployment](docs/deploy.md)
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
npm test
npm run pack:dry
```

## Publish

```bash
npm login
npm test
npm run pack:dry
npm publish
```

`prepack` builds `dist/` automatically.

GitHub Actions publishing:

1. On npm, open `hinge-ts` package settings.
2. Add a trusted publisher:
   - provider: GitHub Actions
   - organization/user: `wrsrsh`
   - repository: `hinge-ts`
   - workflow filename: `publish.yml`
   - environment name: `npm`
   - allowed action: `npm publish`
3. Publish by tagging the package version:

```bash
npm version patch
git push origin main --tags
```

The workflow runs typecheck, tests, dry pack, checks the tag matches
`package.json`, then publishes to npm.

## License

MIT.
