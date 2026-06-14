# Chat

Chat combines Hinge REST endpoints and Sendbird REST/realtime endpoints.

```ts
const channels = await client.chat.channels(50);
const channel = await client.chat.channel(channels.channels[0].channelUrl);
const messages = await client.chat.fullMessages(channel.channelUrl);

await client.chat.sendMessage({
  ays: false,
  matchMessage: true,
  messageType: "text",
  messageData: { message: "hey" },
  subjectId: "peer-user-id",
  origin: "connection"
});
```

Realtime requires `ProxySendbirdRealtimeTransport`:

```ts
const subscription = await client.chat.subscribeEvents();

for await (const event of subscription) {
  if (event.kind === "typing") {
    console.log(event.event.channelUrl);
  }
}
```

Supported commands:

- `sendWsCommand`
- `markRead`
- `markReadFireAndForget`
- `ping`
- `typingStart`
- `typingEnd`
- `enterChannel`
- `exitChannel`
- `ackMessage`
- `closeWs`
