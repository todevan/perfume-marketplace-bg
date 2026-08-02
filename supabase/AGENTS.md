# supabase AGENTS.md

## Scope
This folder owns database schema, migrations, RLS, edge functions and related tests.

## Expectations
- Treat schema changes as high risk. Do not weaken RLS, remove constraints or alter existing migration history.
- Prefer additive, forward-only migrations. If a change is not safe to backfill, document the reason clearly.
- Keep security invariants first: auth, privacy, moderation and upload evidence should remain fail-closed.
- Update or add tests when a migration changes behavior or contracts.

## Useful checks
- pnpm db:lint
- pnpm db:test
- pnpm db:staging:verify-target
- pnpm db:staging:push:dry-run
