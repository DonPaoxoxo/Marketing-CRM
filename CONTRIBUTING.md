# Contributing

Thank you for helping improve the Marketing Resource CRM. This guide covers the workflow and the rules that keep the
system secure and consistent.

## Ground rules

These are not style preferences — pull requests that break them will not be merged.

1. **Never commit secrets or personal data.** No `.env` files, API keys, passwords, invite links, real phone numbers,
   real email addresses, real names of team members or agents, or production hostnames. Use `example.com`, synthetic
   numbers and placeholder names in tests and fixtures.
2. **The system stores credential references, never secrets.** Do not add fields, columns, fixtures, logs or exports
   that could hold passwords, tokens, recovery or backup codes, session cookies or 2FA seeds.
3. **Authorization is enforced on the server.** Every new route must check the session and the relevant permission or
   ownership rule. Hiding a button is not access control.
4. **Rules live in `src/lib/`.** Validation, permissions and business rules are pure functions shared by the browser,
   the mock API and the server. Do not re-implement a rule separately in a route or a component.
5. **Migrations are additive and immutable.** Add a new numbered file in `server/db/migrations/`. Never edit or
   renumber a migration that has been applied anywhere.
6. **Destructive actions archive first and need a written reason**, and every change is written to the audit trail
   without sensitive values.

## Development setup

```bash
npm install
VITE_USE_MOCK_API=true npm run dev     # quick UI work against the mock API
```

For backend work, follow [SETUP.md](SETUP.md) to create a local database, then run `npm run server` and `npm run dev`.

## Workflow

1. Create a branch from `main`: `feature/<short-name>`, `fix/<short-name>` or `docs/<short-name>`.
2. Make focused changes. Keep unrelated refactoring out of the same pull request.
3. Add or update tests for the behaviour you changed.
4. Run the checks below until they pass.
5. Open a pull request using the template, describing what changed, why, and how you verified it.

### Commit messages

Use short, imperative subjects, optionally prefixed with a type:

```
feat(agents): add salary status column
fix(domains): keep archived domains out of expiry counts
docs: explain the deploy bundle
```

## Checks

```bash
npm run typecheck
npm run typecheck:server
npm run lint
npm test
npm run build
```

Continuous integration runs the same commands on every pull request.

### Database integration tests

Changes to server routes, SQL or migrations should also pass the real-database suites. They **delete data**, so point
them at a throwaway database only:

```bash
npm run db:migrate && npm run db:seed-config
ADS_IT=1 ADS_IT_CONFIRM_DB=<scratch-db-name> npx vitest run --no-file-parallelism server/routes
```

## Adding a feature — checklist

- [ ] Rules and validation in `src/lib/`, with unit tests
- [ ] Server route checks authentication, permission and ownership; returns `404` for records the caller may not see
- [ ] Every write inside a transaction, with an audit entry in the same transaction
- [ ] Additive migration, and the column map / schema test updated if a register table changed
- [ ] Mock API handler mirrors the server behaviour when the page uses the mock
- [ ] UI works in light and dark themes, at phone width, and by keyboard
- [ ] New permissions added to `PERMISSIONS`, labels and defaults in `src/lib/permissions.ts`
- [ ] Documentation updated ([DEVELOPER-HANDOVER.md](DEVELOPER-HANDOVER.md) for design, README for user-visible features)

## Code style

- TypeScript strict mode; no `any` in production code without a comment explaining why.
- Match the surrounding code: naming, comment density and component patterns.
- Comments explain *why* a decision was made, not what the next line does.
- User-facing text is plain and specific: say what happened and what to do next.

## Reporting bugs and requesting features

Use the issue templates. For anything security-related, **do not open a public issue** — follow [SECURITY.md](SECURITY.md).
