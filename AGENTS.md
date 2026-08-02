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
## Session start protocol

At the start of every session on this repository, before doing anything else:
1. Read `docs/MASTER-PLAN.md` in full.
2. Read `docs/PROJECT-STATUS.md` in full.
3. State which phase is currently active and what's currently blocking, based on those files.
4. Wait for instructions — do not begin work until told to.

## Session end protocol

Before ending a work session or completing a phase:
1. Update `docs/PROJECT-STATUS.md` to reflect what changed, what's now done, and what's next.
2. If any business/legal/product decision was surfaced that only the project owner can answer, add it to the "Open Questions" section of `docs/MASTER-PLAN.md` — do not guess or assume an answer.
3. If a decision from that list was answered during the session, move it to the "Decisions Made" section of `docs/MASTER-PLAN.md` with the date and reasoning.

These protocols apply regardless of which phase is active and do not require the user to repeat them.