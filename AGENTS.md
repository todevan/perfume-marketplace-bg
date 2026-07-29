# AGENTS.md

## Purpose
Guide changes for this SvelteKit, TypeScript, Supabase and Cloudflare Worker marketplace.

## Global rules
- Favor the existing server-first architecture: routes and server actions coordinate requests, services enforce rules, repositories access data, and domain code holds deterministic marketplace logic.
- Keep the closed-beta and privacy constraints intact. Do not enable public signup, public profile writes, payments, boosts, ads or other monetization paths unless explicitly requested.
- Protect confidential data. Never log secrets, auth tokens, phone numbers, emails or raw profile content.
- Do not edit existing Supabase migrations. If schema changes are required, add a new forward-only migration and keep the existing migration history intact.
- Prefer small, reversible changes and validate them with the narrowest relevant command first.

## Module map
- src/routes: page and endpoint entrypoints, route guards and HTTP semantics.
- src/lib/server: services, repositories, auth helpers and workflow logic.
- src/lib/domain: marketplace rules and decision logic.
- src/lib/contracts: Zod contracts and stable DTOs shared across UI/server boundaries.
- supabase/: SQL migrations, functions, RLS and test fixtures.
- scripts/: operational tools for backup, seeding, staging and readiness checks.
- tests/: unit, contract and end-to-end coverage.
- docs/: reference documentation; consult when behavior or rollout details are unclear.

## Common verification commands
- pnpm validate:catalog
- pnpm test:unit
- pnpm check
- pnpm build
- pnpm test:e2e
- pnpm db:lint
- pnpm db:test

## Working style
- Reuse existing patterns instead of introducing new abstractions.
- Keep UI components presentation-oriented and push business logic to server-side modules.
- If a change affects auth, privacy, uploads, migrations or release gates, review the relevant docs before editing.
