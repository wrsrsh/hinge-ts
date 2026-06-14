# Contributing

## Development

```bash
npm install
npm run typecheck
npm test
npm run pack:dry
```

Keep the main package entry browser-safe. Node-only code belongs in examples or
user-hosted proxy implementations.

## Commit Messages

Use short lowercase commit messages. Do not use em dashes.

Suggested sequence for large changes:

1. `init package`
2. `add core client`
3. `add browser storage`
4. `add proxy transport`
5. `add auth api`
6. `add shared types`
7. `add recommendations api`
8. `add profiles api`
9. `add social apis`
10. `add prompts api`
11. `add chat rest`
12. `add chat realtime`
13. `add raw api`
14. `write docs`
15. `add examples`
16. `add tests`
17. `prep npm release`

## Release

Before publishing:

1. Run `npm test`.
2. Run `npm run pack:dry`.
3. Update `CHANGELOG.md`.
4. Publish from a trusted npm session or CI job.
