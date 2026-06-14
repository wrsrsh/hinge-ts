# Persistence

The SDK uses an async storage abstraction:

```ts
import { BrowserStorage, HingeClient } from "hinge-ts";

const client = HingeClient.builder()
  .phoneNumber("+15555550123")
  .storage(new BrowserStorage())
  .build();

await client.persistence.saveSession("session.json");
await client.persistence.loadSession("session.json");
```

Session JSON includes:

- `phoneNumber`
- `deviceId`
- `installId`
- `sessionId`
- `installed`
- `hingeAuth`
- `sendbirdAuth`
- `sendbirdSessionKey`

Use `MemoryStorage` for tests and `BrowserStorage` for browser apps. Avoid
storing raw secrets unless your application threat model allows it.
