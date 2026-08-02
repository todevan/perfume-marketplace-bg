# Project Status

Last updated: 2026-08-02

## Current verdict

**Development baseline: green.**
**Production launch readiness: blocked.**

The current `codex/full-site-redesign` branch now compiles, tests, and builds successfully under the project-declared toolchain. This does not yet authorize a production launch because later security, legal, privacy, provider, monitoring, and recovery gates remain open.

The full repository audit is recorded in [AUDIT-2026-08-02.md](./AUDIT-2026-08-02.md).

## Phase 1 status

Completed locally:

- Node.js 22.23.2 active for project commands.
- pnpm 11.9.0 active, matching `package.json`.
- Frozen-lockfile install passed with no lockfile change.
- Accidental duplicate declarations removed from `ListingCard.svelte`.
- Existing favorite state from `listing.isFavorite` preserved.
- `PUBLIC_DEMO_MODE` now accepts only exact `true` or `false` when populated.
- All requested local verification commands passed.

No Phase 2 authorization, message, rate-limit, webhook, upload, database, migration, provider, or legal behavior was changed.

## Verification snapshot

| Command/check | Result |
| --- | --- |
| Node version | `v22.23.2` |
| pnpm version | `11.9.0` |
| `pnpm install --frozen-lockfile` | Passed; already up to date |
| `pnpm validate:catalog` | Passed; 196 brands and 48 aliases |
| `pnpm test` | Passed; 31 files, 258 tests |
| `pnpm check` | Passed; 0 errors, 0 warnings |
| `pnpm build` | Passed; Cloudflare adapter completed |
| `pnpm test:e2e` | Passed; 13 passed, 5 intentional skips |
| `pnpm audit --prod` | No known vulnerabilities |
| `pnpm audit` | No known vulnerabilities |
| All tracked Svelte files | 47 compiled, 0 failed |

The five E2E skips are the opt-in real hosted beta journeys and one configured mobile exclusion. Real provider/account testing remains a later launch gate.

## Changed product files in Phase 1

- `src/lib/components/ListingCard.svelte`
- `src/lib/server/env.ts`
- `tests/server/auth-runtime.test.ts`

Documentation added after verification:

- `docs/AUDIT-2026-08-02.md`
- `docs/PROJECT-STATUS.md`

`package.json`, `pnpm-lock.yaml`, database migrations, provider functions, and deployment workflows were not modified.

## Highest-priority unresolved blockers

1. Treat the credential-shaped Resend value in `.env.example` as exposed: rotate it, inspect provider activity, and blank the example.
2. Enforce staff MFA at authoritative database/RPC boundaries.
3. Verify report evidence ownership and cleanup against hosted Supabase.
4. Define immutable moderation evidence and message edit/delete/block behavior.
5. Harden multipart/JSON request-size enforcement and report attachment handling.
6. Finalize legal documents, retention, data export, and account deletion/anonymization.
7. Configure and verify SMS, Turnstile, Resend, Cloudflare Images, webhooks, Edge Functions, and schedulers.
8. Prove backups through a restore rehearsal and configure monitoring/alerts.
9. Add a protected production deployment path and complete real hosted lifecycle tests.

## Scope boundary

Phase 1 deliberately did not implement any later-phase item. The next change batch should be selected and approved independently rather than combining security, database, provider, legal, and UX work.
