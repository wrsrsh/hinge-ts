# Proxy

The SDK is browser first, but full feature parity requires a user-hosted proxy.
Browsers cannot set the custom Sendbird WebSocket handshake headers used by the
mobile-style implementation.

## REST Contract

`HingeProxyTransport` sends `POST /request`:

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

The proxy should perform the upstream request with the provided headers and
return the upstream body. For byte downloads, return a base64 string.

## WebSocket Contract

`ProxySendbirdRealtimeTransport` opens a WebSocket to your proxy and immediately
sends:

```json
{
  "type": "connect",
  "input": {
    "url": "wss://ws-...sendbird.com/...",
    "headers": {},
    "token": "...",
    "sessionKey": "...",
    "userId": "..."
  }
}
```

The proxy relays text frames both ways. It must apply custom headers server-side
when connecting to Sendbird.

## Security

- Require authentication on every proxy route.
- Restrict allowed upstream hosts to Hinge and Sendbird.
- Validate origin and user session.
- Rate limit login, raw, and message endpoints.
- Redact authorization, Sendbird tokens, session keys, device IDs, install IDs,
  and session IDs from logs.
- Do not deploy an unrestricted public proxy.
