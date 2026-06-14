# Auth

`hinge-ts` follows the mobile-style Hinge login flow:

1. Register the device install with `/identity/install`.
2. Start SMS login with `/auth/sms/v2/initiate`.
3. Submit the OTP to `/auth/sms/v2`.
4. If Hinge returns 412, catch `Email2FAError` and submit the email code to
   `/auth/device/validate`.
5. Authenticate Sendbird through `/message/authenticate`.

```ts
import { Email2FAError, HingeClient, HingeProxyTransport } from "hinge-ts";

const client = HingeClient.builder()
  .phoneNumber("+15555550123")
  .transport(new HingeProxyTransport({ baseUrl: "/api/hinge-proxy" }))
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
```

`client.session()` returns redacted secrets. Use `client.persistence.saveSession`
for a portable JSON session file shape.
