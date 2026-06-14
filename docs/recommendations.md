# Recommendations

Recommendations use `POST /rec/v2`.

```ts
const recs = await client.recommendations.get();
const activeToday = await client.recommendations.getWithParams({
  newHere: false,
  activeToday: true
});
```

Defaults:

- `multiFetchCount`: `3`
- `requestDelayMs`: `1500`
- `rateLimitRetries`: `3`
- `rateLimitBackoffMs`: `4000`
- `publicIdsBatchSize`: `75`

The SDK merges multi-fetch responses, de-duplicates subjects, normalizes to one
combined feed, and can save the recommendation cache through the configured
storage.
