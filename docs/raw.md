# Raw Requests

Raw methods are escape hatches for endpoints that are not yet modeled.

```ts
await client.raw.hinge("POST", "/flag/textreview", {
  text: "hey",
  receiverId: "user-id"
});

await client.raw.sendbird("GET", "/users/me/my_group_channels?limit=20");
```

Raw methods still attach the SDK-generated headers and use the configured
transport.
