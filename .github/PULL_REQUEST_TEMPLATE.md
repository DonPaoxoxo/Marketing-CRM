## Summary

<!-- What does this change do, and why? Link the issue it closes, e.g. "Closes #123". -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no behaviour change)
- [ ] Documentation
- [ ] Database migration

## How was this verified?

<!-- Tests added, manual steps, screenshots (light and dark, desktop and phone) for UI changes. -->

## Checklist

- [ ] `npm run typecheck`, `npm run typecheck:server`, `npm run lint`, `npm test` and `npm run build` pass
- [ ] Tests added or updated for the changed behaviour
- [ ] Server routes check authentication, permissions and ownership (not only the UI)
- [ ] Writes are audited, without sensitive values
- [ ] Migrations are new numbered files; no applied migration was edited
- [ ] Real-database integration tests pass against a scratch database (for server or SQL changes)
- [ ] **No secrets or personal data**: no `.env`, keys, passwords, invite links, real names, emails, phone numbers or production hostnames
- [ ] Documentation updated where needed
