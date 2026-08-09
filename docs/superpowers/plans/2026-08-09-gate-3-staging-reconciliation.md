# Gate 3 Staging Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute independent source/harness tasks, `superpowers:test-driven-development` for executable behavior changes, `superpowers:systematic-debugging` for unexpected results, and `superpowers:verification-before-completion` before any PASS claim. Use `superpowers:requesting-code-review` for the final independent review. Repository instructions and explicit owner approvals override generic skill defaults.

**Goal:** Reconcile only the hosted staging identity, immutable release, schema, provider, synthetic-actor, and test-harness prerequisites that currently block Gate 3 report-evidence verification, then run that verification without entering Gate 4.

**Architecture:** Preserve the existing server-first, fail-closed Worker/Supabase design. Construct an attributable release from an exact allow-list of protected Gate 0–3 work, move the authorized Frankfurt staging project through a maintenance-safe forward migration and Worker cutover, enable only the providers needed by report evidence, and exercise every access boundary with ordinary authenticated sessions. Service-role access is limited to guarded fixture setup, sanitized inspection, and cleanup; it is never evidence that an ordinary or moderator authorization check passed.

**Tech Stack:** SvelteKit, TypeScript, Cloudflare Workers and Images binding, Cloudflare Turnstile testing configuration, Supabase PostgreSQL/Auth/Storage/Edge Functions, pnpm 11.9.0, Node.js 22, Vitest, pgTAP, Playwright, GitHub Actions.

## Global Constraints

- Planning status: **NOT EXECUTED**. This file authorizes no state change by itself.
- Gate 3 remains **BLOCKED** until every hosted report-evidence criterion has fresh evidence.
- Do not start Gate 4 or enter `post-beta-hardening.md`.
- Do not weaken RLS, staff AAL2, one-time attachment, stream limits, image sanitization, cleanup durability, or deployment identity checks.
- Use only project `perfume-marketplace-bg-staging`, ref `nuhkpqjjyuygiemrxbdp`, organization `khazvscqabwvslnphbqp`, region `eu-central-1`, PostgreSQL 17, status `ACTIVE_HEALTHY`.
- The only application origin is `https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev`.
- Never target the former Stockholm ref `zllqwlekadiuyejgbuxc`.
- Use synthetic/throwaway data only. Do not copy or inspect real user data.
- Never print, commit, attach, or place in chat any password, TOTP seed, Supabase secret/service-role key, database password, access token, Cloudflare token, Turnstile secret, cleanup secret, cookie, or bearer token.
- Keep the local Supabase mapping `45320`–`45326` unchanged.
- Never run hosted `db reset`, `migration repair`, schema drop/truncate, migration-history rewrite, `supabase stop --no-backup`, or destructive Docker/volume commands.
- Database rollback is forward-only. Applied migrations are never reverted in place.
- Do not use the hardening backlog to redesign rollback records, pin Actions, change messaging semantics, or change text-only reporting behavior.
- Do not create a branch, commit, push, PR, merge, deploy, migrate, configure a provider, create/elevate an account, or execute hostile hosted tests until the corresponding approval in this plan is explicit.

---

## 1. Authority and current drift

### Governing authorities

1. `AGENTS.md`
2. `docs/MASTER-PLAN.md`
3. `docs/PROJECT-STATUS.md`
4. `docs/superpowers/specs/2026-08-08-beta-readiness-design.md`
5. `docs/superpowers/plans/2026-08-08-beta-readiness-master-plan.md`
6. `docs/superpowers/plans/gate-0-baseline.md`
7. `docs/superpowers/plans/gate-1-auth-remediation.md`
8. `docs/superpowers/plans/gate-2-registration-turnstile.md`
9. `docs/superpowers/plans/gate-3-beta-verification.md`
10. `docs/STAGING-CREDENTIALS.md`, `docs/PRODUCTION-SETUP.md`, `docs/ARCHITECTURE.md`, `docs/BACKUP-RESTORE.md`, and the guarded operator/provider contracts they reference.

Master-plan escalation rule 6 applies: **hosted schema/runtime state differs materially from local assumptions**.

### Recorded drift to reconcile

| Surface | Intended Gate 3 state | Current recorded state | Consequence |
|---|---|---|---|
| Supabase identity | Frankfurt ref `nuhkpqjjyuygiemrxbdp` with its current publishable key | Project identity is correct; the publishable key in `wrangler.jsonc` does not equal the current API-key inventory key | Guarded target verification fails; configured key returns Auth 401 |
| Worker source | Exact immutable SHA containing protected Gate 0–3 work | Live SHA `ada151d1fe68a7d12402084818df2f9df15624cd`; protected work is uncommitted at local HEAD `fb3e644615c6bbe4895142d6fc4fabbce00e853f` | Hosted behavior cannot be attributed to the approved tree |
| Hosted migrations | Current forward history including report-evidence hardening | Last recorded hosted checkpoint is 001–010; deployed source also contains only 001–010 | 012–014 are not available; 011 may also be pending and must be freshly proven |
| Auth configuration | Public email/password signup after migration 012; anonymous signup off; email confirmation on | Read-only preflight found public signup on and email auto-confirm off | Functional target is plausible, but the guarded migration receipt requires signup to be temporarily off before mutation |
| Turnstile | Always-pass testing pair bound to staging hostname and correct action names | Required staging variables are absent | Hosted auth/report actions cannot be automated safely |
| Images | `IMAGES` binding plus `IMAGE_PROCESSOR_MODE=cloudflare-images` | Binding is declared, but mode is `disabled` | Evidence creation fails closed before allocation |
| Cleanup | Current `upload-cleanup` function, secrets, and one five-minute scheduler | Deployment/scheduler not verified | Expiry/rejection lifecycle cannot be proved |
| Actors | Reporter, cross-user, assigned TOTP moderator, unassigned TOTP moderator | Required secure account variables are unavailable; existence is unproven | Access matrix cannot execute |
| Harness | Existing real-beta E2E plus narrow report-evidence hostile harness | Existing suite covers marketplace and one moderator AAL2 journey, not the report-evidence matrix | Ten hosted scenarios remain unexecuted |

### Migration ambiguity that must not be hidden

The recorded hosted baseline is 001–010, while migration `202607290011_production_readiness_fixes.sql` is already part of protected HEAD and precedes 012–014. Therefore:

- 012, 013, and 014 must be freshly confirmed pending before any push;
- 011 must also be checked, not assumed;
- if hosted remains at 001–010, the guarded forward push will necessarily propose 011–014;
- if hosted is at 001–011, the expected pending set is exactly 012–014;
- any other local/remote history requires a stop and a new owner decision;
- no push occurs until the owner approves the exact dry-run-disclosed set.

---

## 2. Protected deployment-candidate manifest

The candidate is a scoped release assembled from protected work; it is not “everything dirty.” Every path below is included because it implements Gate 0–3 behavior, the owner-approved open-registration dependency needed to provision synthetic actors, the report-evidence High, or the tests/runbooks needed to prove those surfaces.

### 2.1 Application, configuration, and operator paths

```text
package.json
pnpm-lock.yaml
wrangler.jsonc
scripts/bootstrap-first-admin.mjs
scripts/check-production-readiness.mjs
scripts/smoke-staging.mjs
src/hooks.server.ts
src/lib/components/Header.svelte
src/lib/components/MemberShell.svelte
src/lib/components/listing/ListingWizard.svelte
src/lib/domain/listing.ts
src/lib/domain/types.ts
src/lib/server/auth/context.ts
src/lib/server/auth/guards.ts
src/lib/server/database.types.ts
src/lib/server/feature-flags.ts
src/lib/server/uploads/image-processor.ts
src/lib/server/http/request-body.ts
src/routes/admin/+page.server.ts
src/routes/admin/+page.svelte
src/routes/api/listing-uploads/+server.ts
src/routes/auth/confirm/+server.ts
src/routes/auth/reset-password/+page.server.ts
src/routes/dashboard/+page.server.ts
src/routes/dashboard/+page.svelte
src/routes/listing/[slug]/+page.server.ts
src/routes/listing/[slug]/+page.svelte
src/routes/login/+page.server.ts
src/routes/login/+page.svelte
src/routes/merchant-application/+page.server.ts
src/routes/offers/+page.server.ts
src/routes/onboarding/+page.server.ts
src/routes/onboarding/+page.svelte
src/routes/phone-verification/+page.server.ts          (deletion)
src/routes/phone-verification/+page.svelte             (deletion)
src/routes/publish/+page.server.ts
src/routes/publish/+page.svelte
src/routes/report/+page.server.ts
src/routes/report/+page.svelte
supabase/config.toml
supabase/functions/upload-cleanup/index.ts
supabase/migrations/202608020012_open_email_password_registration.sql
supabase/migrations/202608020013_staff_mfa_enforcement.sql
supabase/migrations/202608020014_report_evidence_hardening.sql
```

`supabase/config.toml` stays in the candidate because the guarded operator copies it with migrations/functions and because it declares `upload-cleanup`; its local-only ports remain `45320`–`45326` and are never pushed as hosted Auth settings.

The offer-expiry presentation changes in `src/lib/domain/offers.ts`, `src/lib/server/repositories/offers.ts`, and `tests/domain/offer-status.test.ts` are excluded: they are not needed to close the report-evidence High. Migration 012 remains whole and forward-only; no historical migration is split or edited.

### 2.2 Gate and regression tests

```text
tests/components/auth-shell.test.ts
tests/components/member-shell.test.ts
tests/components/registration-turnstile.test.ts
tests/contracts/deployment-hardening.contract.test.ts
tests/contracts/report-attachments.contract.test.ts
tests/contracts/request-body-limits.contract.test.ts
tests/contracts/staging-smoke.contract.test.ts
tests/contracts/upload-cleanup.contract.test.ts
tests/domain/listing-rules.test.ts
tests/e2e/real-beta.spec.ts
tests/server/anonymous-auth-action-body-limits.test.ts
tests/server/auth-guards-regression.test.ts
tests/server/auth-lifecycle-regressions.test.ts
tests/server/auth-refactor-contract.test.ts
tests/server/auth-runtime.test.ts
tests/server/image-processor.test.ts
tests/server/login-backend-attestation.test.ts
tests/server/request-body.test.ts
supabase/tests/open_email_registration.pgtap.sql
supabase/tests/production_readiness_fixes.pgtap.sql
supabase/tests/report_evidence_hardening.pgtap.sql
```

Clean tracked tests and implementation files inherited from base SHA `fb3e644615c6bbe4895142d6fc4fabbce00e853f` remain part of the commit tree automatically; they are not dirty-path additions to this manifest.

### 2.3 Gate authority/evidence documentation

```text
docs/ARCHITECTURE.md
docs/MASTER-PLAN.md
docs/PRODUCTION-SETUP.md
docs/PROJECT-STATUS.md
docs/STAGING-CREDENTIALS.md
docs/testing/AUTH-REFACTOR-CODE-REVIEW.md
docs/testing/AUTH-REFACTOR-CONTRACT.md
docs/testing/AUTH-REFACTOR-VERIFICATION.md
docs/testing/AUTH-ROUTE-POLICY-TEST-MATRIX.md
docs/superpowers/specs/2026-08-08-beta-readiness-design.md
docs/superpowers/plans/2026-08-08-beta-readiness-master-plan.md
docs/superpowers/plans/gate-0-baseline.md
docs/superpowers/plans/gate-0-working-tree-manifest.md
docs/superpowers/plans/gate-1-auth-remediation.md
docs/superpowers/plans/gate-2-registration-turnstile.md
docs/superpowers/plans/gate-3-beta-verification.md
docs/superpowers/plans/2026-08-09-gate-3-staging-reconciliation.md
```

### 2.4 Narrow reconciliation delta to add before creating the candidate SHA

These paths are the only planned source changes beyond the already-protected implementation:

```text
wrangler.jsonc
scripts/smoke-staging.mjs
tests/contracts/deployment-hardening.contract.test.ts
tests/contracts/staging-smoke.contract.test.ts
playwright.hosted.config.ts                              (new)
scripts/hosted-report-evidence-operator.mjs             (new)
tests/scripts/hosted-report-evidence-operator.test.ts   (new)
tests/e2e/hosted-report-evidence.spec.ts                (new)
```

Their responsibilities are deliberately narrow:

- replace the stale scalar staging publishable key only after secure in-memory target verification;
- commit the public testing Turnstile site-key name/value and exact expected hostname, while keeping the secret out of Git;
- set `IMAGE_PROCESSOR_MODE=cloudflare-images` only after the binding preflight is green;
- update the staging smoke expectation for configured Turnstile so a complete login without a token returns 400 before Supabase Auth, not the old “provider absent” 503;
- provide a no-local-webserver, one-worker, artifact-minimized hosted Playwright configuration;
- add a target-locked, redacting fixture/inspection/cleanup operator and its tests;
- add the ten-scenario report-evidence hosted test without rewriting or unskipping unrelated real-beta cases.

### 2.5 Explicit dirty-tree exclusions

The candidate must not contain:

- `.agents/**`, `.claudian/**`, `skills-lock.json`, or any skill/plugin installation artifact;
- root or nested `AGENTS*` edits/deletions/copies;
- `README.md`, `README-INSTALL-FIRST.txt`, `DESIGN.md`, `NUL`, `myrepo.zip`, or the stray `~/` tree;
- `docs/agents/**`, `docs/task-results/**`, autonomous-engineering setup plans/specs, `post-beta-hardening.md`, or unrelated plan history;
- `supabase/functions/notification-email/index.ts` or `tests/contracts/notification-email.contract.test.ts`;
- `src/lib/server/payments/types.ts`;
- the excluded offer-expiry presentation paths named above;
- any generated build, Playwright, backup, Supabase temp/link, Wrangler, credential, or provider output.

If an excluded change is needed for the candidate to compile or pass a load-bearing test, stop and report the exact dependency rather than silently adding it.

---

## 3. Required owner approvals and recovery register

No approval is implied by this plan. The owner may approve several rows in one explicit instruction, but each resource/action must be named.

| ID | Exact state-changing action | Environment/resource | Prerequisite | Rollback or recovery | Required owner approval |
|---|---|---|---|---|---|
| A1 | Edit only the reconciliation-delta paths in §2.4 and this gate/status evidence after execution | Protected local working tree | Fresh status/diff manifest and no path conflict | Scoped reviewed reverse patch only; never reset/stash/checkout protected work | Approve local source/harness reconciliation |
| A2 | Create an isolated temporary clone, branch `codex/gate3-staging-reconciliation`, and one scoped candidate commit | Local Git objects/temp clone | Exact manifest and full verification green | Delete the temp clone/branch if unpushed; original dirty tree remains untouched | Approve local branch/commit creation |
| A3 | Push the candidate branch and open/update a PR | Canonical private GitHub repo | Candidate SHA, clean scoped diff, local review | Close PR/delete remote branch; no force push/history rewrite | Approve push and PR |
| A4 | Merge the R2 candidate to `main` after exact-SHA CI | Canonical private GitHub repo | CI green, independent review, owner H3 review | Revert by new commit if needed; never rewrite public history | Explicit H3 merge approval |
| A5 | Temporarily disable hosted public signup and place the staging Worker on the recorded safe 503 version during cutover | Frankfurt Supabase Auth and staging Worker | Read-only identity/inventory green; maintenance window recorded | Keep signup disabled and safe 503 on failure; restore functional access only after compatible cutover | Approve staging maintenance window/provider mutation |
| A6 | Run guarded `db:staging:push` for the exact dry-run-disclosed forward set | Frankfurt staging database | Fresh 30-minute inventory receipt, target verification, dry-run, exact pending set approved | No down migration/reset/repair; keep app fail-closed and use a new reviewed forward migration for defects | Approve exact migration versions, including 011 if pending |
| A7 | Set/verify staging Turnstile and Images configuration and manually dispatch deployment of the exact merged `main` SHA | Cloudflare staging Worker/account | Candidate main SHA/CI, migration postcheck, secret names inventoried | Automatic/manual rollback to safe 503; restore prior provider settings; DB remains forward-only | Approve Cloudflare provider config and deploy |
| A8 | Deploy `upload-cleanup`, set its staging-only secrets, and create exactly one five-minute scheduler | Frankfurt Supabase Edge Functions/scheduler | Migration 014 applied, function code bound to candidate SHA | Disable scheduler first; restore previous function version or leave function inactive; never delete DB history | Approve Edge Function, secret, and scheduler changes |
| A9 | Create or reuse four synthetic actors, activate memberships, elevate two to moderator, and enroll TOTP | Frankfurt staging Auth/database | Functional candidate, signup/onboarding checks, target-locked operator | Remove new factors/accounts and restore any reused role; preserve sanitized audit receipt | Approve synthetic account creation and role/MFA elevation |
| A10 | Execute hostile uploads/access attempts and create synthetic reports/evidence/queue rows | Staging Worker/Supabase only | Providers, accounts, and preflight green | Stop on first security defect; run scoped cleanup; retain no object/path/credential in logs | Approve Gate 3 hosted hostile execution |
| A11 | Delete every synthetic row/object/account artifact and remove temporary testing config when designated ephemeral | Staging Worker/Supabase only | Evidence captured; attached-object preservation check completed | Retry bounded cleanup; if cleanup cannot be proven, keep Gate 3 BLOCKED and open an incident record only with owner approval | Approve scoped synthetic cleanup/destruction |
| A12 | Change Gate 3 from BLOCKED to PASS and reconcile concise project status | Gate/status docs only | All exact criteria plus independent review green | Revert the status with a scoped doc edit if evidence is later invalidated | No separate approval beyond executing this plan; PASS still requires fresh evidence |

Production, the hosted Supabase project identity, Windows networking, local ports, payment flags, and unrelated providers are never affected.

---

## 4. Task 1 — Freeze the protected tree and prove hosted identity

**Files:** read only; no repository changes.

1. Capture `git status --short --untracked-files=all`, `git diff --binary --full-index`, `git diff --stat`, branch, HEAD, worktrees, and relevant recent history.
2. Recompute the Gate 0 protected baseline comparison. Record post-Gate-0 paths separately; do not normalize line endings.
3. Verify the authorized Cloudflare account and Worker name read-only. Record the active deployment/version and live `x-deployed-git-sha` without printing variables or secrets.
4. Verify the local Supabase link, project ref, organization, Frankfurt region, PostgreSQL 17, and health through the guarded operator.
5. Obtain the current publishable key from the official Supabase CLI/Dashboard into a trusted local environment or credential store. Do not paste it into chat or command history.
6. Let `pnpm db:staging:verify-target` compare that key against the API-key inventory in memory. Record only equality, key type, response status, and target identity.
7. Compare the verified key to `wrangler.jsonc` in memory. The expected initial result is mismatch; do not edit until A1.
8. Read-only inventory Auth settings, migration versions, Auth-user count, application-row counts, Storage buckets/objects, Realtime publications, cron jobs, Edge Functions, webhook/scheduler names, and secret **names**.

**Stop conditions:** wrong identity/region/organization, incomplete inventory, any real data, an unexplained user/object/row/function/job, a key that fails the official inventory check, or migration history outside a prefix of local 001–014.

**Evidence:** sanitized preflight table; no values beyond public identifiers, SHA, counts, statuses, and secret names.

---

## 5. Task 2 — TDD the narrow reconciliation delta

### 5.1 RED: final staging configuration and smoke contract

**Modify first:**

- `tests/contracts/deployment-hardening.contract.test.ts`
- `tests/contracts/staging-smoke.contract.test.ts`

Add assertions that the final staging candidate:

- uses a scalar project-bound `PUBLIC_SUPABASE_PUBLISHABLE_KEY`;
- has `PUBLIC_TURNSTILE_SITE_KEY` and exact `TURNSTILE_EXPECTED_HOSTNAME` as non-secret staging vars;
- keeps `TURNSTILE_SECRET_KEY`, Supabase secret/service-role keys, and cleanup secrets out of committed vars;
- uses `IMAGE_PROCESSOR_MODE=cloudflare-images` with the `IMAGES` binding;
- keeps every monetisation flag false;
- expects 400 for a syntactically valid login request with no Turnstile token when Turnstile is configured, and still proves the submitted password is not reflected and Supabase Auth is not reached.

Run:

```powershell
pnpm exec vitest run tests/contracts/deployment-hardening.contract.test.ts tests/contracts/staging-smoke.contract.test.ts --reporter=verbose --maxWorkers=1
```

Required RED: assertions fail because the current candidate still has the stale public key, disabled image mode, no testing Turnstile variables, and the old missing-provider login smoke expectation. Infrastructure failure is not a valid RED.

### 5.2 GREEN: minimal configuration/operator changes

After A1:

1. Replace only the stale publishable scalar with the securely verified active public key.
2. Add the public Turnstile testing site key and exact staging hostname to `env.staging.vars`; do not commit the secret.
3. Change only staging `IMAGE_PROCESSOR_MODE` to `cloudflare-images` after the binding inventory is green.
4. Update `scripts/smoke-staging.mjs` only for the configured-Turnstile login expectation and preserve all SHA, headers, crawler, demo, redirect, registration, and password-redaction checks.
5. Keep `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, and `UPLOAD_CLEANUP_SECRET` absent from committed vars.

Run the same focused command and require GREEN.

### 5.3 RED/GREEN: target-locked hosted harness

**New files:**

- `playwright.hosted.config.ts`
- `scripts/hosted-report-evidence-operator.mjs`
- `tests/scripts/hosted-report-evidence-operator.test.ts`
- `tests/e2e/hosted-report-evidence.spec.ts`

Write operator tests first for:

- exact Frankfurt project/URL/ref enforcement and explicit Stockholm rejection;
- explicit `APP_ENV=staging`, `E2E_REAL_RUN=true`, and `E2E_REAL_REPORT_EVIDENCE_RUN=true` mutation gates;
- rejection of accounts outside the configured synthetic allow-list;
- no credential/email/path output;
- service-role use limited to provision/inspect/cleanup, never access assertions;
- idempotent, run-ID-scoped cleanup that cannot touch pre-existing users/objects/rows;
- failure to report success when any cleanup row/object remains.

Run RED before the operator exists:

```powershell
pnpm exec vitest run tests/scripts/hosted-report-evidence-operator.test.ts --reporter=verbose --maxWorkers=1
```

Implement the minimum operator and hosted Playwright config/spec, then require GREEN. The hosted spec remains skipped unless both explicit real-run flags are true and all required environment names are present.

### 5.4 Focused and broad local verification

```powershell
pnpm exec vitest run tests/scripts/hosted-report-evidence-operator.test.ts tests/contracts/deployment-hardening.contract.test.ts tests/contracts/staging-smoke.contract.test.ts tests/contracts/report-attachments.contract.test.ts tests/contracts/upload-cleanup.contract.test.ts tests/server/image-processor.test.ts tests/server/request-body.test.ts --reporter=verbose --maxWorkers=1
pnpm test
pnpm check
pnpm build
pnpm db:lint
pnpm db:test
pnpm test:e2e
pnpm test:db:contracts
pnpm exec wrangler deploy --dry-run --env staging
git diff --check
```

Do not run hosted E2E in this task. Any load-bearing failure keeps reconciliation unready.

---

## 6. Task 3 — Create an immutable attributable candidate

This task requires A2–A4. It does not use a Git worktree and does not touch the protected working tree's index.

1. Verify `origin/main` still resolves to base `fb3e644615c6bbe4895142d6fc4fabbce00e853f`. If it moved, stop for a scoped reconciliation; do not rebase/merge implicitly.
2. Create a temporary local clone from that exact base in a resolved directory under the OS temporary directory.
3. Export only tracked diffs from §2 and copy only the allow-listed untracked files. Preserve deletions explicitly.
4. Hash every source file in the protected tree and temporary clone; require equality for the full manifest.
5. Require the clone's `git status --short --untracked-files=all` to equal the manifest and contain no excluded path.
6. Create branch `codex/gate3-staging-reconciliation` and one scoped R2 commit only after A2.
7. Record the commit SHA, parent SHA, tree SHA, manifest hash, and verification results.
8. Push/open a PR only after A3. Obtain independent source/security review and exact-SHA CI.
9. Merge only after A4/H3. The merge/main SHA—not the pre-merge branch SHA—is the deployable candidate.
10. Re-run manifest comparison against the exact merged SHA. If the merge contains unrelated paths or main advanced, stop.

The GitHub staging workflow is main-only and must be manually dispatched for the exact tested `main` SHA. A local dirty-tree Wrangler deploy is not an acceptable substitute.

---

## 7. Task 4 — Prepare the guarded migration window

This task requires A5 before mutation.

1. Repeat all Task 1 read-only inventories immediately before the window.
2. Record the current functional Worker deployment and the safe fail-closed version `75593db4-12fd-486d-ae8a-bdf9ebbb3ece`.
3. Temporarily disable public email/password signup. Keep anonymous signup disabled and email confirmation enabled.
4. Confirm no account provisioning or hostile run has started.
5. Generate a fresh local inventory receipt no more than 30 minutes before the push. It must report:
   - exact project ref;
   - all required inventory categories;
   - `stopConditionsClear=true`;
   - `containsRealData=false`;
   - `publicSignupEnabled=false`;
   - zero unexpected objects;
   - exact migration versions, user/object/row counts, Realtime, jobs, functions, and secret names.
6. Hash the exact receipt locally and set only `STAGING_INVENTORY_RECEIPT_PATH` and `STAGING_INVENTORY_RECEIPT_SHA256` in the trusted shell.
7. Put the Worker on the recorded safe 503 version and verify its five-route fail-closed contract. Do not point it at another database or enable demo mode.

Failure recovery: keep public signup disabled and the Worker fail-closed. Do not attempt a database mutation.

---

## 8. Task 5 — Apply and attest the exact forward migration set

This task requires A6 naming the exact versions shown by the dry run.

Run in order from the exact candidate checkout:

```powershell
pnpm db:staging:verify-target
pnpm db:staging:push:dry-run
```

Inspect the trusted output and inventory receipt without copying credentials. Decision rules:

- remote 001–010 → proposed 011–014; requires explicit approval for all four;
- remote 001–011 → proposed 012–014; requires explicit approval for those three;
- 012, 013, or 014 already remote before this authorized run → stop as unexplained drift;
- any gap, checksum mismatch, unknown remote version, or proposal outside 011–014 → stop;
- an empty proposal does not prove the expected state unless the remote list independently shows 001–014.

After exact approval:

```powershell
pnpm db:staging:push
pnpm db:staging:types:check
```

Post-migration evidence must prove:

- local and remote histories exactly match through 014;
- 012, 013, and 014 changed from pending to applied in this authorized run;
- migration 011 disposition is explicit;
- hosted generated public types equal `src/lib/server/database.types.ts`;
- staff AAL2 functions/ACLs are present;
- report allocation/finalization/rejection/expiry functions and triggers are present;
- `report-evidence` bucket constraints and Storage read policy match migration 014;
- exact Realtime and scheduled-job inventory remains acceptable;
- no Auth user, synthetic object, or unexpected row appeared during migration.

Generate/check a fresh hosted runtime receipt bound to the exact candidate SHA using `db:staging:runtime:check` and its existing receipt contract. Keep receipt content sanitized.

**Recovery:** Never reverse or repair history. Keep the Worker fail-closed and signup disabled. Any defect requires a new reviewed forward migration and fresh owner approval.

---

## 9. Task 6 — Configure providers and deploy the exact Worker

### 9.1 Cloudflare pre-deploy configuration

After A7 and while the safe Worker is active:

1. Verify secret **names** on `perfume-marketplace-bg-staging`; do not retrieve values.
2. Confirm `SUPABASE_SECRET_KEY` exists as the sole Worker Supabase secret and that no legacy service-role key is committed or browser-visible.
3. Set the staging-only always-pass `TURNSTILE_SECRET_KEY` from a secure local source. The matching public site key and exact hostname are already in the candidate config.
4. Verify the `IMAGES` binding is available to the staging Worker/account.
5. Verify every payment/monetisation flag remains false and `PUBLIC_DEMO_MODE=false`.
6. Run one final `wrangler deploy --dry-run --env staging` from the exact candidate SHA.

### 9.2 Exact-SHA deploy

Manually dispatch `.github/workflows/deploy.yml` on `main` for the exact candidate SHA. The workflow must:

- require successful complete CI for that SHA;
- perform frozen install and dependency audits;
- run `pnpm test` and DB contracts;
- dry-run the staging bundle;
- deploy only `perfume-marketplace-bg-staging`;
- run the updated functional smoke;
- restore the safe 503 version and verify it if smoke fails.

Post-deploy evidence:

- live `x-deployed-git-sha` equals the exact candidate SHA on every smoke route;
- application origin and Worker/account identity are exact;
- crawler, sitemap, security/no-store, redirect, demo, and billing checks remain green;
- configured publishable key reaches Auth settings successfully;
- login without a Turnstile token fails 400 before Supabase Auth;
- a valid testing widget issues action-bound tokens for `login`, `register`, and `report_submit`;
- backend catalogue attestation remains exact;
- Worker version/deployment IDs and sanitized request IDs are recorded.

If deployment or smoke fails, stop with the safe 503 version active. Do not roll the database back or deploy the stale functional SHA.

### 9.3 Cleanup function and scheduler

After A8:

1. Set only the Edge Function secret names `UPLOAD_CLEANUP_SECRET` and optional `UPLOAD_CLEANUP_BATCH_SIZE`; verify provider-owned `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` names without printing values.
2. Deploy `supabase/functions/upload-cleanup/index.ts` explicitly to project ref `nuhkpqjjyuygiemrxbdp` from the candidate SHA.
3. Invoke it once through its protected POST boundary with an empty queue; require an authenticated 202 and sanitized counts.
4. Configure exactly one scheduler, every five minutes, sending the secret in `x-upload-cleanup-secret`, never in URL/query/logs, with 5xx retry/backoff.
5. Prove there is exactly one active schedule and observe one successful scheduled invocation.

Recovery: disable the schedule before changing/restoring the function. Do not remove queue/database history.

### 9.4 Restore functional Auth setting

Only after migrations, Worker, Turnstile, Images, and cleanup checks pass:

- enable public email/password signup;
- keep anonymous signup disabled;
- keep email confirmation enabled;
- verify Site URL and the two exact callback/confirm allow-list URLs;
- do not run `supabase config push` because local config contains localhost values.

On any subsequent security failure, disable public signup and stop hosted testing.

---

## 10. Task 7 — Provision or verify synthetic identities

Use the target-locked operator only after A9. Account values live in a trusted one-session environment/credential store and are cleared afterward.

| Actor | Required state | Provisioning rule |
|---|---|---|
| Ordinary reporter | Confirmed email/password identity, active membership, ordinary `user` role | Create/reuse synthetic account, claim open registration, accept current consents, complete onboarding |
| Ordinary cross-user/target | Different confirmed active ordinary account | Same flow; email/username must differ from reporter |
| Assigned moderator | Confirmed active account, `moderator` role, enrolled verified TOTP factor | Elevate only after explicit A9; preserve AAL1 password session and obtain AAL2 only through TOTP |
| Unassigned moderator | Different confirmed active account, `moderator` role, separate enrolled TOTP | Must never claim/receive the test report |
| AAL2 administrator | Not expected | Do not provision. A moderator can self-claim an open case. If that approved path is unavailable, stop and ask for a separate owner decision. |

Rules:

- Prefer fresh throwaway accounts so all artifacts can be deleted.
- Do not silently reuse an unknown user or alter a real account.
- The service role may create/confirm synthetic fixtures and set the two roles only inside the guarded operator; user lifecycle and access assertions use each actor's own session.
- TOTP enrollment/verification occurs as the moderator; seeds are never attached to Playwright traces, HTML reports, screenshots, docs, or logs.
- The hosted Playwright config uses one Chromium worker, no local web server, no retry trace/video, and a line/sanitized reporter.
- Record opaque run ID and actor role only, not email or credential.

Pre-account acceptance:

- each ordinary session is AAL1 and active;
- each moderator has a demonstrable AAL1 session before TOTP and AAL2 after TOTP;
- all four user IDs differ;
- no admin is created;
- no report/evidence row exists for the run ID.

---

## 11. Task 8 — Hosted report-evidence scenario matrix

This task requires A10. Run only after every prior prerequisite is green. A missing UI element is never proof of authorization denial.

| # | Scenario and actor | Precondition/action | Expected result and required evidence | Cleanup |
|---|---|---|---|---|
| 1 | Cross-user evidence access denial; reporter then ordinary cross-user | Create one attached evidence object. Download the exact object through each authenticated Storage boundary. | Reporter receives 200/object bytes matching recorded size/hash. Cross-user receives a real non-2xx authorization/not-found response and zero bytes while service inspection proves the object exists. | Keep object for moderator tests; delete through final cleanup queue afterward. |
| 2 | Report evidence creation; reporter | Submit one synthetic valid PNG through `/report` with testing Turnstile. | Action success with one report ID; exactly one private allocation/object; source is not retained; no raw path in logs. | Reused by scenarios 3–7. |
| 3 | Evidence finalization; reporter route plus server-only finalizer | Inspect the just-created synthetic ledger/object through the guarded operator. | Status is `attached` after a prior `finalized` transition; stored MIME is WebP; bounded dimensions/size/hash and timestamps exist; object existence preceded finalization. | Same object retained. |
| 4 | One-time attachment and reconciliation safety; reporter | Attempt a second authenticated report insert using the exact attached path; invoke reconciliation with the attached upload ID plus a disposable unattached ID. | Second attachment is denied at the database boundary; no second report references the object; reconciliation never changes/deletes attached evidence. | Disposable unattached ID enters cleanup; attached object remains for access tests. |
| 5 | Assigned-moderator access; assigned TOTP moderator | At AAL2, self-claim the open report so it becomes `investigating`/assigned, then download the exact evidence. | Assignment is auditable and case-bound; Storage returns 200/bytes only for that assigned AAL2 moderator. | Report remains assigned until final cleanup. |
| 6 | Unassigned moderator rejection; second TOTP moderator | Reach AAL2 but do not assign/claim; attempt exact Storage read. | Real non-2xx denial and zero bytes while the same object remains readable to reporter/assigned moderator. | No state beyond session. |
| 7 | Required moderator AAL2; assigned moderator | Before TOTP, attempt direct Storage read and `/admin`; then verify TOTP and repeat after assignment. | AAL1 is denied/challenged and receives no object bytes; the same identity succeeds only at AAL2 after assignment. | Remove factor/account during final cleanup. |
| 8 | Evidence cleanup/lifecycle; reporter plus cleanup worker | Create (a) a valid sanitized object whose report submission is deliberately rejected, and (b) an abandoned synthetic allocation/object backdated only by the guarded fixture operator. Observe manual cleanup and one scheduler cycle. | Rejected/expired terminal states enqueue durable cleanup; exact objects are deleted once; queue rows are processed; attached evidence from scenario 2 survives reconciliation/scheduler until its report is deliberately removed; no path is logged. | Delete report to enqueue attached object, run cleanup again, prove zero scoped objects/queue work. |
| 9 | Malformed upload rejection; reporter | Send malformed multipart and an image-labelled non-image payload with a valid testing Turnstile token. | Predictable 400; no report, allocation, finalized row, Storage object, or provider leak. | Prove zero scoped side effects. |
| 10 | Oversized/hostile/chunked upload; reporter | Send per-file over-limit, aggregate over-limit, absent-length chunked, understated-length, and malformed multipart streams through the authenticated action. | Actual-stream enforcement returns 413 for size and 400 for malformed input before allocation/upload/report; zero downstream state. | Prove zero scoped side effects. |

For every scenario, record:

- actor role, not credential/email;
- precondition and opaque synthetic run/report/upload IDs only where necessary;
- action and exact HTTP/Storage/database boundary;
- actual status/result and sanitized request ID;
- PASS / FAIL / BLOCKED;
- before/after scoped row/object/queue counts;
- cleanup performed and residual count.

The harness must additionally prove the HOST-01 subconditions: rejected evidence enters the durable queue, abandoned allocation expires, and reconciliation cannot delete already-attached evidence.

Stop immediately on any unexpected read, object bytes returned to a denied actor, AAL1 staff success, reused attachment, unsanitized/non-WebP stored output, unbounded request reaching downstream work, cleanup of attached evidence, or unscoped fixture deletion.

---

## 12. Task 9 — Cleanup every synthetic artifact

After evidence capture and A11:

1. Delete the synthetic report through the guarded cleanup path so attached evidence is durably queued.
2. Invoke cleanup and observe queue completion plus Storage deletion.
3. Remove all remaining run-scoped report/evidence/allocation/cleanup rows in dependency order only through the target-locked operator.
4. Verify no run-scoped object remains in `report-evidence` and no unprocessed queue row remains.
5. Remove the four throwaway Auth identities, profiles, memberships, sessions, and MFA factors; verify zero run-scoped actor rows remain.
6. Restore any reused actor's original role/factor state instead of deleting it; prefer not to reuse.
7. Remove temporary local credential variables/files and raw test artifacts. Preserve only a sanitized, checksum-bound result summary.
8. If testing Turnstile or scheduler configuration is designated temporary, disable/remove it only after all cleanup invocations are complete and record the final provider inventory.

Cleanup failure is a Gate 3 blocker. Do not hide it by deleting database ledger rows while Storage/queue state remains unknown.

---

## 13. Task 10 — Final Gate 3 rerun, review, and decision

### Exact execution order

1. Protected-tree and authoritative target preflight.
2. Current Worker/deployed-SHA and provider-name inventory.
3. Secure publishable-key reconciliation.
4. TDD RED/GREEN for configuration, smoke, and target-locked harness.
5. Full local/canonical verification and independent candidate review.
6. Isolated exact-manifest Git candidate, exact-SHA CI, owner H3 merge.
7. Maintenance window: signup off and safe 503 Worker.
8. Fresh migration inventory/receipt, guarded dry run, exact owner approval, guarded push.
9. Migration history, hosted type, runtime/cron/Realtime, RLS/function postchecks.
10. Turnstile/Images preconfiguration, exact-SHA Worker deploy, functional smoke.
11. Cleanup function and scheduler deploy/verification.
12. Restore public signup with anonymous signup off/email confirmation on.
13. Synthetic actor/role/TOTP provisioning and verification.
14. Existing hosted moderator AAL2 check where reusable.
15. Ten-scenario hostile report-evidence run.
16. Full synthetic cleanup and final provider/account/data inventory.
17. Fresh canonical local verification on the exact final candidate SHA.
18. Independent final code/security/evidence review.
19. Gate 3 PASS / FAIL / BLOCKED decision and allowed documentation update.

### Hosted commands

Run the existing moderator journey without the unrelated marketplace mutation:

```powershell
pnpm exec playwright test tests/e2e/real-beta.spec.ts --config=playwright.hosted.config.ts --project=chromium --workers=1 --reporter=line --grep "moderator reaches the AAL2 moderation queue"
```

Run the new report-evidence matrix once:

```powershell
pnpm exec playwright test tests/e2e/hosted-report-evidence.spec.ts --config=playwright.hosted.config.ts --project=chromium --workers=1 --reporter=line
```

No ad-hoc DB URL, RLS bypass, Turnstile bypass, or test rewrite is permitted.

### Fresh final canonical verification

```powershell
pnpm test
pnpm check
pnpm build
pnpm db:lint
pnpm db:test
pnpm test:e2e
pnpm test:db:contracts
pnpm exec wrangler deploy --dry-run --env staging
git diff --check
```

Run from the exact final candidate checkout. Record exit code and assertion counts independently. Local `pnpm test:e2e` hosted skips remain acceptable only because the authorized hosted commands above have separate fresh evidence.

### Independent final review

The reviewer must inspect:

- exact candidate manifest and absence of unrelated dirty work;
- no committed/printed secret, service-role key, credential, cookie, TOTP seed, object path, or private email;
- published Worker SHA and staging project identity;
- exact applied migration set and forward-only recovery posture;
- preservation of Gate 1 auth and Gate 2 action-bound Turnstile behavior;
- actual WebP sanitization and bounded hostile streams;
- ordinary/cross-user/assigned/unassigned/AAL1/AAL2 authorization evidence;
- one-time attachment and attached-evidence reconciliation safety;
- cleanup function, scheduler, queue, object, and account cleanup evidence;
- every Gate 3 acceptance criterion and every scenario result.

No Critical or Important finding may remain unresolved.

### Decision rule

- **PASS:** every Gate 3 local and hosted criterion is freshly green, every synthetic artifact is cleaned, and independent review approves.
- **FAIL:** a criterion produces a reproducible application/security defect. Use systematic debugging and stop for owner review if remediation exceeds Gate 3 escalation authority.
- **BLOCKED:** any scenario, provider proof, cleanup, account precondition, exact-SHA evidence, migration attestation, or review remains unavailable/unexecuted.

Only after PASS may `docs/superpowers/plans/gate-3-beta-verification.md` change from BLOCKED to PASS and `docs/PROJECT-STATUS.md` receive a concise state update. Gate 4 then becomes eligible for owner consideration but must not start.

---

## 14. Secure configuration and account inputs — names only

### GitHub/Cloudflare deployment

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

### Supabase target/migration/operator

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
SUPABASE_SERVICE_ROLE_KEY
STAGING_INVENTORY_RECEIPT_PATH
STAGING_INVENTORY_RECEIPT_SHA256
EXPECTED_SUPABASE_PROJECT_REF
RELEASE_COMMIT_SHA
HOSTED_RUNTIME_INVENTORY_RECEIPT_PATH
HOSTED_CRON_INVENTORY_SHA256
```

### Turnstile, Images, and cleanup

```text
PUBLIC_TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY
TURNSTILE_EXPECTED_HOSTNAME
IMAGE_PROCESSOR_MODE
CLOUDFLARE_IMAGES_API_TOKEN        (operator/provider inventory only if required; never Worker runtime)
UPLOAD_CLEANUP_SECRET
UPLOAD_CLEANUP_BATCH_SIZE
SUPABASE_URL                       (Edge Function runtime)
```

### Hosted harness

```text
E2E_REAL_RUN
E2E_REAL_REPORT_EVIDENCE_RUN
E2E_REAL_BASE_URL
E2E_REAL_TURNSTILE_TESTING
E2E_REAL_REPORTER_EMAIL
E2E_REAL_REPORTER_PASSWORD
E2E_REAL_REPORTER_USERNAME
E2E_REAL_CROSS_USER_EMAIL
E2E_REAL_CROSS_USER_PASSWORD
E2E_REAL_CROSS_USER_USERNAME
E2E_REAL_ASSIGNED_MODERATOR_EMAIL
E2E_REAL_ASSIGNED_MODERATOR_PASSWORD
E2E_REAL_ASSIGNED_MODERATOR_USERNAME
E2E_REAL_ASSIGNED_MODERATOR_TOTP_SECRET
E2E_REAL_UNASSIGNED_MODERATOR_EMAIL
E2E_REAL_UNASSIGNED_MODERATOR_PASSWORD
E2E_REAL_UNASSIGNED_MODERATOR_USERNAME
E2E_REAL_UNASSIGNED_MODERATOR_TOTP_SECRET
E2E_REAL_ADMIN_EMAIL               (optional; must remain unset unless separately approved)
E2E_REAL_ADMIN_PASSWORD            (optional; must remain unset unless separately approved)
E2E_REAL_ADMIN_TOTP_SECRET         (optional; must remain unset unless separately approved)
```

Passwords, TOTP seeds, and privileged provider values must be supplied through a trusted local secret source/session, never a tracked file, chat, GitHub issue/PR body, Playwright artifact, or documentation.

---

## 15. Acceptance record template

For each prerequisite and scenario, append only after execution:

| Required condition | Actor/resource | Evidence source/command | Actual sanitized result | Cleanup | PASS / FAIL / BLOCKED |
|---|---|---|---|---|---|
| Exact staging identity/key | Frankfurt project/Worker | Guarded target and read-only provider inventory | NOT RUN | None | BLOCKED |
| Exact immutable Worker SHA | Staging Worker | CI/deployment/smoke receipt | NOT RUN | None | BLOCKED |
| Exact forward migration state | Frankfurt DB | Receipt, dry run, push, post-list | NOT RUN | None | BLOCKED |
| Turnstile/Images/cleanup ready | Provider runtime | Action-bound token, WebP, function/scheduler receipts | NOT RUN | None | BLOCKED |
| Four synthetic actors ready | Staging Auth/DB | Target-locked operator receipt | NOT RUN | None | BLOCKED |
| Scenarios 1–10 | User/staff sessions | Hosted Playwright/operator receipt | NOT RUN | NOT RUN | BLOCKED |
| Canonical final verification | Candidate SHA | Commands in §13 | NOT RUN | None | BLOCKED |
| Independent final review | Candidate/evidence | Reviewer report | NOT RUN | None | BLOCKED |

Until populated with fresh evidence, the plan's decision remains **Gate 3 BLOCKED**.

---

## Plan self-review

- Scope maps only to master-plan escalation rule 6 and the existing Gate 3 hosted report-evidence High.
- No Gate 4 or post-beta hardening implementation is included.
- The stale public key is reconciled through a secure/in-memory target check; no credential value appears here.
- The candidate manifest is explicit and excludes unrelated protected dirt.
- The plan does not assume migration 011 is applied and prevents an unreviewed 011–014 push.
- Every external/local state-changing action has a resource, prerequisite, recovery path, and approval ID.
- Provider enablement is limited to testing Turnstile, Images sanitization, and evidence cleanup.
- Accounts are synthetic, role/MFA elevation is explicit, admin is conditional and not pre-authorized.
- The harness proves denials at HTTP/Storage/database boundaries and verifies zero downstream state for hostile uploads.
- Cleanup covers objects, queue rows, report/allocation rows, MFA factors, roles, sessions, and Auth users.
- PASS remains impossible while any hosted scenario or cleanup result is unexecuted.

