# Profiles

```ts
const me = await client.profiles.me();
const content = await client.profiles.content();
const preferences = await client.profiles.preferences();

const profiles = await client.profiles.public(["0123456789abcdef0123456789abcdef"]);
const profileContent = await client.profiles.publicContent(["0123456789abcdef0123456789abcdef"]);
```

Public profile reads validate IDs, de-duplicate them, and batch them by
`publicIdsBatchSize`.

Profile and preference updates convert public string enum values to numeric API
values before sending:

```ts
await client.profiles.update({
  drinking: { value: "Sometimes", visible: true },
  height: 183
});
```
