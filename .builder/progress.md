# Progress

## 2026-07-26 — GitHub Free staging bootstrap in progress

- Replaced the deploy workflow with a `workflow_dispatch`-only, `main`-guarded
  staging job. There is no GitHub Environment, push deploy, production job,
  generic deploy script, or ambiguous production default.
- Added forward-only migration `008_first_admin_bootstrap` with the exact
  service-role-only RPCs `prepare_first_admin_invite(text, interval)` and
  `bind_first_admin_invite(uuid, uuid)`. The bootstrap is tokenless,
  concurrency-safe, append-only audited, terminal after one exact invite/user
  binding, and never creates legal consent or active beta membership.
- Added the trusted staging-only first-admin operator. A definite pre-user
  delivery failure compensates the pending marker; a successful or uncertain
  Auth delivery keeps deterministic invite/user recovery IDs and never
  resends or revokes automatically.
- Added exact dashboard paths, secret ownership, inventory stop conditions,
  Cloudflare rollback order and the deferred provider gates to the staging
  runbook.
- Aligned the Svelte plugin toolchain on Vite `8.1.5` and overrode the
  vulnerable transitive `cookie` `0.6.0` with `0.7.2`. Production and full
  dependency audits now report zero known vulnerabilities and peer checks are
  clean.
- Current local verification is green: aggregate `pnpm test`; 19 Vitest files
  and 166 tests; 23 static SQL/bootstrap contracts; catalogue
  `80/80/80/80/15`; 13 Playwright scenarios with 5 provider scenarios
  intentionally skipped; 0 Svelte errors/warnings; Cloudflare build; both
  Wrangler dry-runs; and the expected 35-condition production fail-closed
  gate. Migration `008` adds 18 pgTAP assertions, but they remain unexecuted
  because no local Docker/PostgreSQL test service is available.
- Selected `todevan/perfume-marketplace-bg` as the new private canonical
  repository. `todevan/remix-of-scent-exchange` remains explicitly untouched.
- Defined a GitHub Free model with repository secrets and manual staging
  dispatch only; no protected branch, required-check, environment-reviewer, or
  protected-environment enforcement is assumed.
- Added fail-closed Supabase inventory stop conditions. No hosted reset,
  migration repair, schema drop, truncation, or remote history rewrite is
  authorized.
- Added a fail-closed Cloudflare bootstrap and rollback contract: exact tested
  commit, dry-runs, demo/billing/SMS/Images disabled, recorded known-good
  deployment, and no database rollback disguised as application recovery.
- Provider integrations, production, legal approval, external invitations,
  carrier tests, and backup/restore acceptance remain deferred external gates.
- GitHub, Supabase, Cloudflare, and all other provider resources remain
  unmodified. GitHub CLI is unavailable, and Supabase/Wrangler are not
  authenticated; hosted inventories, migration/seed, Worker deploy, smoke
  checks and manual GitHub dispatch therefore remain blocked rather than
  guessed or partially applied.

## 2026-07-26 — deployment hardening checkpoint

- Made the Worker authoritative for `/robots.txt` and `/sitemap.xml`, removed the static crawler-policy bypass, kept `Disallow: /`, and preserved the beta sitemap `404`.
- Disabled the public production `workers.dev` surface, kept staging accessible, repeated the non-inheritable `IMAGES` binding in staging, and validated both Worker bundles with explicit environment dry-runs.
- Capped Playwright at two workers and separated the one-time build from the preview lifecycle. The stable browser package passed 13/13 local scenarios; 5 real-provider scenarios remain intentionally skipped.
- Upgraded Wrangler to `4.114.0`; the lockfile now resolves Miniflare `4.20260722.0` and sharp `0.35.2`. Production dependencies have no known vulnerabilities; the high-severity full-audit gate passes with one accepted upstream low-severity `cookie` advisory through SvelteKit.
- Added crawler, environment-binding, production-exposure, demo-mode and billing-flag regression contracts. Verification passed: 19 unit/contract files and 163 tests, 0 Svelte errors/warnings, successful Cloudflare production build, 9/9 SQL hardening contracts, and both staging/production Wrangler dry-runs.
- Strengthened CI and deployment workflows with production/full-high audits, deterministic build/test stages and matching Wrangler dry-runs before any real deployment.
- Confirmed that the production release gate fails closed without external configuration, reporting 35 missing or unapproved requirements. Added an exact staging credentials runbook; no credentials, external deployment, domain, SMS test, legal approval, UI change or billing activation was performed.

## 2026-07-22 — implementation handoff

- Implemented the invite-only Cloudflare Workers/SvelteKit runtime with cookie-based Supabase PKCE, verified server sessions, onboarding consent history, Bulgarian phone OTP, staff MFA and fail-closed route guards.
- Added forward-only migrations `003`–`007` without modifying the two foundation migrations. Embedded PostgreSQL applied the complete chain; pgTAP passed 81/81 and the static hardening contracts passed 9/9.
- Replaced runtime demo reads with typed DTO, repository and service boundaries for profiles, catalog, listings, offers, conversations, deals, reviews, reports, merchants, favorites, saved searches and notifications. Demo data remains a test-only adapter behind `PUBLIC_DEMO_MODE=true`.
- Implemented persistent listing drafts/autosave, pending brands, typed search with cursor pagination, four-role evidence uploads, atomic publishing, offer acceptance, reservation, private Realtime chat, double deal confirmation and transaction-bound reviews.
- Implemented private quarantine/finalized image processing, cleanup leases, report-bound moderation, merchant review, durable in-app/email notification delivery and encrypted Storage backup/restore tooling.
- Added Cloudflare/Supabase configuration, CI/deploy workflows, production release checks, legal/safety pages and setup, incident, launch and backup runbooks.
- Verification passed: catalog 80/80/80/80/15, 17 unit/contract files and 151 tests, Svelte diagnostics 0 errors/0 warnings, production Cloudflare build, 13 local Playwright scenarios, 9 SQL contract tests and 81 pgTAP assertions.
- Real staging Playwright scenarios are present but intentionally skipped until provider credentials exist. The production readiness command intentionally fails closed while domain, secrets, legal approval, hosted projects and real provider tests are absent.
- No private GitHub remote was created or deployment performed because no authenticated external account or production domain was supplied.
