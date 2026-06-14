# Prompts

```ts
const prompts = await client.prompts.list();
const manager = await client.prompts.manager();

const text = await client.prompts.text("prompt-id");
const matches = await client.prompts.search("travel");
const category = await client.prompts.byCategory("about-me");
```

`client.prompts.payload()` builds the Hinge prompt payload from current profile
and preference data. Prompt cache uses the configured storage instead of direct
filesystem access.
