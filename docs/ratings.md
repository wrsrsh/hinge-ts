# Likes And Ratings

```ts
const limit = await client.likes.limit();
const likes = await client.likes.list();

await client.ratings.skip({
  subjectId: "user-id",
  ratingToken: "rating-token"
});

await client.ratings.rateUser({
  subjectId: "user-id",
  ratingToken: "rating-token",
  comment: "great photo",
  photo: { url: "https://..." }
});
```

When a comment is present, the SDK calls `/flag/textreview` first and includes
the returned `hcmRunId` in `/rate/v2/initiate`.
