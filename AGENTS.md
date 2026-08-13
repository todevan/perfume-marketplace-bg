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
## Graphify usage

For non-trivial repository work, use Graphify before broad source exploration.

Use Graphify to:
- identify the relevant architectural community/subsystem;
- find callers, callees, neighbors, and dependency paths;
- estimate blast radius before editing;
- identify likely affected tests;
- locate architectural hubs touched by the change.

Treat Graphify as discovery evidence, not correctness evidence.

For security-, auth-, privacy-, database-, RLS-, RPC-, trigger-, migration-,
moderation-, payment-, or release-sensitive behavior, verify Graphify findings
against authoritative source, SQL/migrations, tests, and runtime evidence.
Before relying on Graphify for important work, confirm that its indexed
repository commit/tree matches the task baseline.

If Graphify is unavailable or stale, do not block the task solely because of it;
fall back to authoritative source exploration and record that limitation.

After substantial structural changes, refresh the Graphify index before relying
on it for subsequent blast-radius or dependency analysis.
Before relying on the graph for important work, confirm its indexed repository
SHA/tree matches the task baseline.

After substantial structural changes, refresh/update the Graphify graph.

## Durable operating model

The repository instructions are the primary authority for autonomous engineering. Installed skills and agent tooling support investigation and implementation but do not override owner decisions, phase boundaries, security rules, Human Gates, or release scope. When instructions conflict, prefer the explicit current owner instruction, this file, current project/status documentation, applicable architecture and launch documentation, approved task scope, then skills and generic defaults.

Do not silently resolve material conflicts involving authentication, authorization, MFA/AAL, RLS, privacy, cross-user visibility, evidence, staging or production providers, database mutations, releases, rollback, credentials, or destructive infrastructure. Report the conflict before performing the mutation.

Routine reversible engineering work may proceed within the authorized scope. Hosted-provider changes, production mutations, destructive recovery, credential changes, and other protected actions require the applicable Human Gate and explicit scope. A runbook or skill is not authorization by itself.

### Evidence discipline

- Never invent provider state, hosted evidence, deployment, migration, rollback, smoke-test, or release claims.
- Never publish secrets, authentication material, private evidence, personal data, or credential-bearing command output.
- Keep local, staging, and production environments distinct; staging authority never implies production authority.
- Security-sensitive failures must fail closed, and service-role access must not be used as a convenience shortcut around ordinary authorization.
