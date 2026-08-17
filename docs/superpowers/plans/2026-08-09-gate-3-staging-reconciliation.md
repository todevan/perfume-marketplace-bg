# Gate 3 Staging Reconciliation Implementation Plan

**Plan date:** 2026-08-09  
**Role:** Historical Gate 3 staging-reconciliation execution plan, safety contract, and reusable evidence reference.  
**Execution semantics reconciled:** 2026-08-11.

> This document preserves the exact safety reasoning, target boundaries, candidate construction, provider/migration sequencing, synthetic-actor model, hostile-test matrix, cleanup requirements, and A1–A12 checkpoint vocabulary established for the Gate 3 staging reconciliation.
>
> It is **not** the current executable queue and does not independently authorize a state change merely because a step appears below. Current execution authority comes from `AGENTS.md`, authoritative current project/gate docs, the canonical GitHub Issue, the current `R0`–`R3` risk classification, applicable H1–H6 Human Gates, and the exact named-gate scope.
>
> Historical SHAs, migration inventories, Worker versions, provider drift and A1–A12 completion state in this file must not be assumed current. Fresh current evidence wins.

**Goal:** Reconcile only the hosted staging identity, immutable release, schema, provider, synthetic-actor, and test-harness prerequisites that blocked Gate 3 report-evidence verification, then run that verification without entering the next gate.

**Architecture:** Preserve the existing server-first, fail-closed Worker/Supabase design. Construct an attributable release from an exact allow-list of protected Gate 0–3 work, move the authorized Frankfurt staging project through a maintenance-safe forward migration and Worker cutover, enable only the providers needed by report evidence, and exercise every access boundary with ordinary authenticated sessions. Service-role access is limited to guarded fixture setup, sanitized inspection, and cleanup; it is never evidence that an ordinary or moderator authorization check passed.

**Tech Stack:** SvelteKit, TypeScript, Cloudflare Workers and Images binding, Cloudflare Turnstile testing configuration, Supabase PostgreSQL/Auth/Storage/Edge Functions, pnpm 11.9.0, Node.js 22, Vitest, pgTAP, Playwright, GitHub Actions.

## Process and skill routing

Superpowers is the primary process authority for any current engineering work derived from this plan.

Use, as applicable:

```text
Superpowers systematic-debugging
Superpowers test-driven-development
Superpowers subagent-driven-development / executing-plans
Superpowers requesting-code-review / receiving-code-review
Superpowers verification-before-completion
Superpowers finishing-a-development-branch
```

Matt Pocock skills may deepen the current Superpowers step when useful, especially:

```text
diagnosing-bugs
domain-modeling
codebase-design
code-review
wizard
writing-for-agents
```

ECC/platform specialists may provide expertise for:

```text
security
backend
Supabase
Cloudflare
E2E / Playwright
GitHub
evals
documentation lookup
```

Do not start a competing planner, debugger, TDD loop, execution framework,
review loop, or completion loop.

Skills are engineering tools, not project truth or mutation authority.

---

## Global Constraints

- At plan creation, Gate 3 was **BLOCKED** until every hosted report-evidence criterion had fresh evidence. Current Gate 3/A-series status must be read from current status/gate evidence rather than inferred from this historical statement.
- Do not start the next gate or execute deferred hardening work merely because this plan's historical sequence reaches its end.
- `post-beta-hardening.md` is a deferred hardening catalogue, not an executable queue.
- Do not weaken RLS, staff AAL2, one-time attachment, stream limits, image sanitization, cleanup durability, or deployment identity checks.
- Use only the authorized staging project:
  - project: `perfume-marketplace-bg-staging`;
  - ref: `nuhkpqjjyuygiemrxbdp`;
  - organization: `khazvscqabwvslnphbqp`;
  - region: `eu-central-1`;
  - PostgreSQL: 17.
- The authorized staging application origin is:

```text
https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev
```

- Never target the former Stockholm ref:

```text
zllqwlekadiuyejgbuxc
```

- Use synthetic/throwaway data only. Do not copy or inspect real user data.
- Never print, commit, attach, persist in issue/PR evidence, or place in chat any password, TOTP seed, Supabase secret/service-role key, database password, access token, Cloudflare token, Turnstile secret, cleanup secret, cookie, or bearer token.
- Keep the repository's local Supabase mapping `45320`–`45326` unless a separately authorized current local-environment issue changes it.
- Never run hosted `db reset`, migration-history rewrite/repair, schema drop/truncate, destructive hosted remediation, or equivalent destructive recovery as a normal Gate 3 fix.
- Never use `supabase stop --no-backup` or destructive Docker/volume cleanup as a routine local verification shortcut.
- Hosted database recovery is forward-only. Applied migrations are not reverted in place.
- Do not use the hardening catalogue to redesign rollback records, pin Actions, change messaging semantics, or change report degradation behavior while a narrower Gate 3/A-series scope is active.
- Normal users use public email/password registration with email confirmation.
- Do not reintroduce invitation-only registration or phone/SMS OTP requirements for ordinary-user activation, listing, offers, or normal marketplace use.
- Legacy invite/bootstrap behavior may exist only for explicitly documented operator/first-admin compatibility.
- Staff/admin MFA/AAL2 remains mandatory.
- Payment, listing-fee, subscription, boost, advertising and billing-provider scaffolding does not authorize activation. Monetisation remains disabled until its applicable business/legal/production gates.
- The perfume transaction remains off-platform.
- Merchant verification remains a free trust status.
- Local, staging and production are distinct environments.
- Staging authority never implies production authority.
- Named-gate scope is strict. An instruction such as `A9 only` authorizes only A9-scoped mutations, not A8/A10/provider/database/production work.
- Routine Git engineering actions follow current autonomy policy:
  - R0/R1 may proceed and merge autonomously after required gates;
  - R2 may be implemented autonomously but requires H3 before merge;
  - R3 protected production/policy/destructive actions remain owner-controlled.
- Current hosted/provider/account mutations require the authority defined by the current named gate, risk classification and Human Gate rules. This historical plan is not blanket authorization.
- If a current gate already records a valid approval for an unchanged exact scope, do not interrupt the owner merely to obtain the same approval again.

---

# 1. Authority and recorded reconciliation baseline

## Current authority order

For any current work using this plan as reference:

1. `AGENTS.md`;
2. authoritative project/product/security/business/operational docs;
3. current `docs/PROJECT-STATUS.md` and active gate/A-series docs;
4. canonical GitHub Issue and explicit named-gate scope;
5. Superpowers process;
6. Matt deep-engineering skills when useful;
7. ECC/platform specialists when useful;
8. repository-defined verification/release gates.

The dated files below remain important historical inputs but do not outrank newer authoritative current state merely because this plan once listed them as governing sources.

Historical planning/evidence dependencies included:

```text
docs/superpowers/specs/2026-08-08-beta-readiness-design.md
docs/superpowers/plans/2026-08-08-beta-readiness-master-plan.md
docs/superpowers/plans/gate-0-baseline.md
docs/superpowers/plans/gate-1-auth-remediation.md
docs/superpowers/plans/gate-2-registration-turnstile.md
docs/superpowers/plans/gate-3-beta-verification.md
docs/STAGING-CREDENTIALS.md
docs/PRODUCTION-SETUP.md
docs/ARCHITECTURE.md
docs/BACKUP-RESTORE.md
```

At plan creation, the triggering escalation was:

> hosted schema/runtime state differed materially from local assumptions.

## Recorded drift at plan creation

The following table is a historical pre-reconciliation snapshot. It must not be
used as current staging inventory without fresh evidence.

| Surface | Intended Gate 3 state | Recorded state at plan creation | Consequence at that time |
|---|---|---|---|
| Supabase identity | Frankfurt ref `nuhkpqjjyuygiemrxbdp` with its then-current publishable key | Project identity was correct; the publishable key in `wrangler.jsonc` did not equal the API-key inventory key | Guarded target verification failed; configured key returned Auth 401 |
| Worker source | Exact immutable SHA containing protected Gate 0–3 work | Live SHA was `ada151d1fe68a7d12402084818df2f9df15624cd`; protected work was uncommitted at local HEAD `fb3e644615c6bbe4895142d6fc4fabbce00e853f` | Hosted behavior could not be attributed to the protected tree |
| Hosted migrations | Forward history including report-evidence hardening | Recorded hosted checkpoint was 001–010; deployed source also contained only 001–010 | 012–014 were absent; 011 disposition had to be freshly proven |
| Auth configuration | Public email/password signup after required migration; anonymous signup off; email confirmation on | Read-only preflight found public signup on and email auto-confirm off | Guarded maintenance prerequisites were not satisfied |
| Turnstile | Testing pair bound to staging hostname and exact actions | Required staging variables were absent | Hosted auth/report automation could not proceed safely |
| Images | `IMAGES` binding plus `IMAGE_PROCESSOR_MODE=cloudflare-images` | Binding declared; mode `disabled` | Evidence creation failed closed before allocation |
| Cleanup | Current `upload-cleanup`, secrets and one five-minute scheduler | Deployment/scheduler not verified | Expiry/rejection lifecycle could not be proved |
| Actors | Reporter, cross-user, assigned TOTP moderator, unassigned TOTP moderator | Secure actor inputs unavailable; account existence unproven | Access matrix could not execute |
| Harness | Real-beta E2E plus report-evidence hostile harness | Existing suite lacked the complete report-evidence matrix | Hosted scenarios remained unexecuted |

## Historical migration ambiguity

At plan creation, the recorded hosted baseline was 001–010 while migration
`202607290011_production_readiness_fixes.sql` preceded 012–014 in the protected
tree.

The original decision rules were:

- 012, 013 and 014 had to be freshly confirmed pending;
- 011 had to be checked, never assumed;
- hosted 001–010 implied a proposed 011–014 forward set;
- hosted 001–011 implied a proposed 012–014 forward set;
- any other history required a stop;
- no push occurred without exact dry-run reconciliation.

These rules are preserved as historical reasoning.

**Do not use 001–014 as a current expected migration inventory.** A current
agent must obtain a fresh target-locked migration inventory and follow current
operational docs.

---

# 2. Historical protected deployment-candidate manifest

The following manifest defined the scoped candidate for this reconciliation.
It was deliberately not “everything dirty.”

It is preserved because it explains what the reconciliation intended to
release and what it intentionally excluded.

**It is not a current candidate allow-list.** Do not reconstruct a modern
candidate from this list without comparing it against the current repository,
current `main`, current GitHub Issue and current gate evidence.

## 2.1 Application, configuration and operator paths

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

`supabase/config.toml` was included because the guarded operator copied it with
migrations/functions and because it declared `upload-cleanup`; its local-only
ports remained `45320`–`45326` and were not hosted Auth settings.

The offer-expiry presentation changes in:

```text
src/lib/domain/offers.ts
src/lib/server/repositories/offers.ts
tests/domain/offer-status.test.ts
```

were intentionally excluded because they were not required for the
report-evidence High.

Migration 012 remained whole and forward-only. No historical migration was
split or edited.

## 2.2 Gate and regression tests

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

Clean tracked tests and implementation files inherited from the historical base
SHA remained part of that candidate tree automatically.

## 2.3 Gate authority/evidence documentation

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

## 2.4 Historical narrow reconciliation delta

These were the planned source/harness changes beyond the protected
implementation:

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

Their responsibilities were deliberately narrow:

- reconcile the stale staging publishable key only after secure target verification;
- configure the public testing Turnstile site-key and exact expected hostname while keeping the secret out of Git;
- set staging `IMAGE_PROCESSOR_MODE=cloudflare-images` only after binding verification;
- update the configured-Turnstile staging smoke expectation;
- provide a no-local-webserver, one-worker, artifact-minimized hosted Playwright configuration;
- add a target-locked, redacting fixture/inspection/cleanup operator and tests;
- add the ten-scenario report-evidence hosted test without changing unrelated real-beta cases.

## 2.5 Historical dirty-tree exclusions

The candidate intentionally excluded:

- `.agents/**`, `.claudian/**`, `skills-lock.json`, and skill/plugin installation artifacts;
- root or nested `AGENTS*` edits/deletions/copies from that historical dirty tree;
- `README.md`, `README-INSTALL-FIRST.txt`, `DESIGN.md`, `NUL`, `myrepo.zip`, and the stray `~/` tree;
- `docs/agents/**`, `docs/task-results/**`, autonomy setup plans/specs, `post-beta-hardening.md`, and unrelated plan history;
- `supabase/functions/notification-email/index.ts`;
- `tests/contracts/notification-email.contract.test.ts`;
- `src/lib/server/payments/types.ts`;
- the excluded offer-expiry presentation paths;
- generated build, Playwright, backup, Supabase temp/link, Wrangler, credential or provider output.

Those exclusions are historical candidate boundaries, not instructions to
delete or ignore current `docs/agents/` or other current authoritative files.

If current work needs a path outside its current canonical issue/named-gate
scope, treat that as a scope dependency rather than silently adding it.

---

# 3. A1–A12 checkpoint and recovery register

The A1–A12 identifiers are retained because later Gate 3 evidence and operator
work may refer to them.

They should no longer be interpreted as a blanket rule that every local edit,
branch, commit, push or PR requires owner permission.

For current execution:

- routine local/Git actions follow R0–R3 autonomy;
- R2 requires H3 at merge;
- staging/provider/database/account mutations require the exact authority of
  the current named gate and applicable Human Gate;
- R3 production/policy/destructive actions remain owner-controlled;
- an approval already recorded for an unchanged exact named-gate scope should
  not be requested again merely because this historical table exists.

| ID | Historical action boundary | Resource | Required prerequisite | Recovery / safety boundary | Current authority interpretation |
|---|---|---|---|---|---|
| A1 | Edit only the narrow reconciliation delta and gate/status evidence | Local working tree | Fresh scoped status/diff evidence | Scoped reviewed reversal only; never destroy unrelated protected work | Routine engineering action when inside the current issue/gate; no blanket owner approval |
| A2 | Create isolated candidate branch/clone and scoped commit | Local Git | Exact scoped manifest + verification | Delete isolated unpushed branch/clone if abandoned; do not damage owner working tree | Routine engineering action under current autonomy |
| A3 | Push candidate and open/update PR | GitHub | Candidate SHA, scoped diff, review readiness | Close PR/delete remote branch; no force-history rewrite | Routine engineering action under current autonomy |
| A4 | Merge R2 candidate after exact-SHA CI | GitHub `main` | CI/review/verification green | Revert by new commit if needed; never rewrite shared history | **H3 required before R2 merge** |
| A5 | Staging maintenance: change Auth signup state and put Worker in fail-closed maintenance mode | Frankfurt Supabase Auth + staging Worker | Exact target/inventory, maintenance-safe plan | Keep system fail-closed on failure; restore functional state only after compatible cutover | Requires current named-gate/provider mutation authority; historical plan alone is insufficient |
| A6 | Guarded forward migration push for exact dry-run set | Frankfurt staging database | Fresh target lock, inventory receipt, dry-run, exact proposed migration set | Never down-migrate/reset/repair history; defect uses new forward migration | Requires current named-gate DB mutation authority |
| A7 | Configure staging Turnstile/Images and deploy exact candidate | Cloudflare staging | Exact candidate/CI, DB postcheck, secret-name inventory | Fail closed / use currently verified safe release strategy; DB stays forward-only | Requires current named-gate provider/deploy authority |
| A8 | Deploy `upload-cleanup`, set staging-only secrets, create scheduler | Frankfurt Edge Functions/scheduler | Required migration/runtime state | Disable scheduler before changing function; preserve DB history | Requires current named-gate Edge Function/provider authority |
| A9 | Create/reuse synthetic actors, activate required state, elevate moderators, enroll TOTP | Frankfurt staging Auth/DB | Functional candidate, target-locked operator, exact synthetic allow-list | Remove fresh factors/accounts or restore reused state; preserve sanitized receipt | Requires exact current **A9** scope. `A9 only` does not authorize A8/A10 or adjacent mutations |
| A10 | Run hostile synthetic evidence/access scenarios | Staging only | Providers, actors and preflight green | Stop on security defect; scoped cleanup | Requires exact current A10/hosted-test authority |
| A11 | Remove synthetic rows/objects/accounts and temporary testing state | Staging only | Evidence captured; attached-object safety proven | Cleanup must remain run-scoped and verified; unknown residue blocks closure | Requires exact cleanup/destructive scope; never generalize to real data |
| A12 | Reconcile Gate 3 status after evidence | Gate/status docs | All required criteria + review green | Correct status if evidence is later invalidated | No extra owner approval solely for truthful status reconciliation |

Production, Windows networking, unrelated payment flags, unrelated providers
and adjacent gates are outside these A1–A12 boundaries unless separately
authorized by current project policy.

---

# 4. Task 1 — Freeze the protected tree and prove hosted identity

**Historical mode:** read-only preflight.

For current reuse, compare against current Git state rather than expecting the
historical SHAs below.

1. Capture:

```text
git status --short --untracked-files=all
git diff --binary --full-index
git diff --stat
branch
HEAD
worktrees
relevant recent history
```

2. Reconcile against the appropriate current baseline/evidence. Do not
normalize line endings or silently discard unrelated changes.
3. Verify the authorized Cloudflare account and Worker read-only. Record active
deployment/version and live `x-deployed-git-sha` without printing secrets.
4. Verify Supabase project ref, organization, Frankfurt region, PostgreSQL
version and health through target-locked tooling.
5. Obtain any required current public key through the trusted provider/CLI
path. Do not paste secret values into chat/history.
6. Use:

```powershell
pnpm db:staging:verify-target
```

to verify the exact target before DB mutation.
7. Compare current committed public configuration to current provider inventory
without exposing privileged values.
8. Inventory read-only:

- Auth settings;
- migration versions;
- Auth-user counts;
- application-row counts;
- Storage buckets/object counts;
- Realtime publication inventory;
- cron/jobs;
- Edge Functions;
- webhook/scheduler names;
- secret **names** only.

## Stop conditions

Stop before mutation on:

- wrong project/ref/organization/region;
- forbidden Stockholm target;
- incomplete target inventory;
- unexpected real data;
- unexplained user/object/row/function/job;
- key/target verification failure;
- unexplained migration history;
- evidence that current scope is not sufficient for the required mutation.

## Evidence

Keep evidence sanitized:

- public identifiers;
- SHA;
- counts;
- statuses;
- secret names;
- opaque synthetic run IDs where needed.

No secret values or real-user PII.

---

# 5. Task 2 — TDD the narrow reconciliation delta

This section preserves the original reconciliation TDD contract.

Current work should execute it only if the corresponding source/harness issue is
actually current.

## 5.1 RED — final staging configuration and smoke contract

Historical files:

```text
tests/contracts/deployment-hardening.contract.test.ts
tests/contracts/staging-smoke.contract.test.ts
```

The intended candidate assertions were:

- scalar project-bound `PUBLIC_SUPABASE_PUBLISHABLE_KEY`;
- non-secret `PUBLIC_TURNSTILE_SITE_KEY`;
- exact `TURNSTILE_EXPECTED_HOSTNAME`;
- no committed `TURNSTILE_SECRET_KEY`;
- no committed Supabase secret/service-role key;
- no committed cleanup secret;
- `IMAGE_PROCESSOR_MODE=cloudflare-images` with the `IMAGES` binding;
- every monetisation flag false;
- configured-Turnstile login without token fails before Supabase Auth;
- submitted password is not reflected.

Historical focused command:

```powershell
pnpm exec vitest run tests/contracts/deployment-hardening.contract.test.ts tests/contracts/staging-smoke.contract.test.ts --reporter=verbose --maxWorkers=1
```

Infrastructure failure is not a valid RED.

## 5.2 GREEN — minimal configuration/operator changes

Historically, the minimal repair was:

1. reconcile only the stale public staging key after secure target verification;
2. add only non-secret Turnstile staging variables to committed configuration;
3. enable staging image-processing mode only after binding verification;
4. update only the affected smoke expectation;
5. keep all privileged runtime secrets out of committed vars.

For current use, do not repeat these mutations if current evidence shows they
are already reconciled.

## 5.3 RED/GREEN — target-locked hosted harness

Historical files:

```text
playwright.hosted.config.ts
scripts/hosted-report-evidence-operator.mjs
tests/scripts/hosted-report-evidence-operator.test.ts
tests/e2e/hosted-report-evidence.spec.ts
```

Operator requirements:

- exact authorized Frankfurt target;
- explicit Stockholm rejection;
- staging-only mutation gates;
- synthetic allow-list enforcement;
- no credential/email/object-path output;
- service role limited to fixture setup/inspection/cleanup;
- service role never used as authorization evidence;
- idempotent run-ID-scoped cleanup;
- no deletion of pre-existing users/objects/rows;
- no success claim while scoped cleanup residue remains.

Historical RED command:

```powershell
pnpm exec vitest run tests/scripts/hosted-report-evidence-operator.test.ts --reporter=verbose --maxWorkers=1
```

Hosted specs must remain gated against accidental local/CI mutation.

## 5.4 Focused and broad local verification

Historical verification set:

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

Run DB lint/test in the safe repository-defined sequence when their local
behavior requires sequential execution.

Hosted E2E is separate evidence and must not be accidentally triggered by this
local verification phase.

---

# 6. Task 3 — Create an immutable attributable candidate

This section records the historical candidate-construction method used because
the owner working tree was protected and dirty.

The historical base:

```text
fb3e644615c6bbe4895142d6fc4fabbce00e853f
```

and branch:

```text
codex/gate3-staging-reconciliation
```

are historical identifiers. **Do not recreate a current candidate from that
base.**

The original procedure was:

1. verify remote base had not moved;
2. create an isolated temporary clone;
3. export only allow-listed tracked diffs;
4. copy only allow-listed untracked files;
5. preserve deletions explicitly;
6. hash corresponding source files and require equality;
7. require clone status to match the intended manifest;
8. create one scoped R2 commit;
9. push/open PR;
10. run independent review and exact-SHA CI;
11. merge only after H3;
12. treat merged `main` SHA—not pre-merge branch SHA—as deployable;
13. revalidate the merged tree before deployment.

For current work:

- isolated branch/worktree/clone creation is routine engineering and does not
  require separate owner permission merely because it changes Git state;
- R2 still requires H3 before merge;
- do not mutate the owner's unrelated working tree;
- do not rebase/merge away protected unrelated work;
- deploy only an exact attributable candidate accepted by current release
  rules.

A local dirty-tree Wrangler deployment is not acceptable evidence for an exact
release candidate.

---

# 7. Task 4 — Prepare a guarded migration window

This section preserves the historical maintenance-safe sequence.

The historical fail-closed Worker version used by this plan was:

```text
75593db4-12fd-486d-ae8a-bdf9ebbb3ece
```

**That version ID is historical evidence, not a permanent safe rollback target.**
Do not deploy it in a current run without current compatibility evidence.

For a current migration window:

1. repeat target/provider inventories immediately before mutation;
2. establish the currently verified safe fail-closed deployment strategy;
3. temporarily change Auth signup state only if the current guarded migration
   procedure actually requires it and the current named gate authorizes it;
4. keep anonymous signup disabled and email confirmation enabled;
5. confirm no synthetic-account or hostile run is concurrently starting;
6. generate the current required fresh target-bound inventory receipt;
7. verify its age/hash and stop conditions;
8. move the Worker into the currently approved fail-closed maintenance state
   where required;
9. verify fail-closed behavior before DB mutation.

Historical receipt properties included:

```text
exact project ref
all required inventory categories
stopConditionsClear=true
containsRealData=false
publicSignupEnabled=false
zero unexpected objects
exact migration versions
Auth user count
Storage inventory
application-row counts
Realtime inventory
jobs
functions
secret names
```

Current `docs/STAGING-CREDENTIALS.md` and operator contracts decide the exact
receipt schema.

## Failure recovery

If maintenance preflight fails:

- keep the environment in the safest already-established state;
- do not improvise a database mutation;
- do not switch target;
- do not enable demo mode;
- do not reset or rewrite DB history.

---

# 8. Task 5 — Apply and attest the exact forward migration set

Historical commands:

```powershell
pnpm db:staging:verify-target
pnpm db:staging:push:dry-run
```

The original plan then reconciled the exact 011–014 possibilities.

Those migration-version expectations are historical and must not be used as the
current expected pending set.

For every current hosted migration operation:

1. verify exact staging target;
2. generate fresh inventory receipt;
3. run the guarded dry run;
4. inspect the **actual exact proposed forward set**;
5. ensure the set is authorized by the current named gate;
6. stop on gaps/checksum mismatches/unknown history/unexpected versions;
7. run the guarded push only after those conditions are satisfied;
8. verify hosted types/runtime/inventory after the push.

Current commands may include the repository's current guarded equivalents such
as:

```powershell
pnpm db:staging:push
pnpm db:staging:types:check
```

Post-migration evidence should establish the current gate's required facts,
including as applicable:

- local/remote migration convergence;
- exact versions applied by the authorized run;
- generated public-type convergence;
- staff AAL2 functions/ACLs;
- evidence allocation/finalization/rejection/expiry functions/triggers;
- Storage bucket/policy invariants;
- Realtime/jobs inventory;
- absence of unexplained Auth users/data/objects.

Generate the current hosted runtime receipt bound to the exact candidate SHA
through the repository-defined runtime check.

## Recovery

Never:

- down-migrate applied hosted history;
- `db reset` staging;
- rewrite migration history;
- use destructive schema repair to return to an old Worker.

A schema defect requires a new reviewed forward migration.

---

# 9. Task 6 — Configure providers and deploy the exact Worker

## 9.1 Cloudflare pre-deploy configuration

For a currently authorized staging deployment:

1. verify secret **names** only;
2. verify no privileged key is committed/browser-visible;
3. configure staging-only Turnstile secret through a secure provider/local
   secret source when the current named gate requires it;
4. verify `IMAGES` binding before enabling image processing;
5. verify:

```text
PUBLIC_DEMO_MODE=false
all monetisation flags=false
```

6. run the current staging dry run from the exact candidate SHA.

Do not treat the existence of provider scaffolding as permission to enable
unrelated providers.

## 9.2 Exact-SHA deploy

The release boundary remains:

- exact merged/approved SHA;
- complete required CI for that SHA;
- frozen dependency install;
- required audits/tests/contracts;
- staging dry-run;
- staging-only deployment;
- functional smoke;
- fail-closed recovery when smoke fails.

Post-deploy evidence should include, as applicable:

- live `x-deployed-git-sha`;
- exact origin/Worker/account identity;
- security/no-store headers;
- crawler/sitemap behavior;
- redirect behavior;
- demo disabled;
- billing/monetisation disabled;
- current public Supabase configuration reaches Auth appropriately;
- Turnstile missing/wrong action fails before protected provider work;
- valid testing actions work for only expected action names;
- catalogue/runtime attestations;
- deployment/version identifiers;
- sanitized request IDs.

If deployment or smoke fails:

- do not roll back hosted DB history;
- do not deploy an arbitrary stale functional SHA;
- use the current verified compatible fail-closed/recovery mechanism.

## 9.3 Cleanup function and scheduler

Where the current gate authorizes cleanup infrastructure:

1. set only the required Edge Function secrets through the secure provider
   boundary;
2. verify provider-owned runtime secret names without printing values;
3. deploy the exact candidate function to the authorized Frankfurt project;
4. invoke its protected boundary with an empty queue;
5. require sanitized status/counts;
6. configure exactly the intended scheduler cadence;
7. send secrets in protected headers, not query strings/logs;
8. prove exactly the expected active schedule;
9. observe at least the required successful invocation.

Disable a scheduler before changing/restoring its function when that is the
safe current recovery path.

Do not delete queue/database history as a substitute for cleanup correctness.

## 9.4 Restore functional Auth setting

After the required schema, Worker, Turnstile, Images and cleanup prerequisites
are green:

- public email/password signup should match the current public-registration
  product decision;
- anonymous sign-in remains disabled;
- email confirmation remains enabled;
- Site URL/callback/confirmation allow-list must match current authoritative
  staging configuration.

Do not run a broad hosted `supabase config push` from localhost-oriented local
config unless the current operational docs explicitly authorize and verify it.

---

# 10. Task 7 — Provision or verify synthetic identities

This section defines the synthetic actor roles required by the hosted
report-evidence matrix.

Creating/elevating them requires the exact current actor-provisioning named
gate, such as A9 when A9 is the active authorized scope.

`A9 only` means:

- perform only A9 actor/membership/role/MFA operations;
- do not mutate A8 provider/scheduler state;
- do not execute A10 hostile evidence scenarios;
- do not perform unrelated provider/Auth configuration;
- do not enter production.

| Actor | Required state | Provisioning rule |
|---|---|---|
| Ordinary reporter | Confirmed email/password identity, active ordinary account/membership state | Fresh synthetic account preferred; complete current ordinary-user activation/onboarding flow |
| Ordinary cross-user/target | Different confirmed active ordinary account | Same current ordinary-user flow; distinct identity |
| Assigned moderator | Confirmed active account, `moderator` role, verified TOTP | Elevate only inside exact authorized synthetic-role scope; preserve AAL1 evidence before obtaining AAL2 |
| Unassigned moderator | Different confirmed active moderator, separate verified TOTP | Must not receive/claim the test report |
| AAL2 administrator | Not normally required | Do not provision merely for convenience; if a genuinely required admin path is outside current scope, stop at the appropriate scope/Human Gate boundary |

Rules:

- Prefer fresh throwaway accounts.
- Do not silently repurpose an unknown/real account.
- Do not infer account ownership from weak metadata.
- Service role may be used only within target-locked fixture setup/inspection/
  cleanup where the gate explicitly allows it.
- Access-control assertions must use the actual ordinary/moderator sessions.
- TOTP enrollment/verification occurs as the moderator identity.
- Never expose TOTP seeds in traces, HTML reports, screenshots, docs, issues,
  PRs, chat or logs.
- Use artifact-minimized hosted browser configuration.
- Record only opaque run ID/actor role where possible.

Pre-scenario acceptance:

- ordinary actors are distinct and active at AAL1;
- moderators have demonstrable AAL1 before TOTP;
- moderators reach AAL2 only through verified MFA;
- all actor IDs differ;
- no unnecessary admin exists;
- no pre-existing report/evidence artifact is incorrectly attributed to the
  run.

---

# 11. Task 8 — Hosted report-evidence scenario matrix

Execute only under the exact current hostile-test scope after all prerequisites
are green.

A missing UI control is never proof of authorization denial. Denials must be
proved at the actual HTTP/Storage/database boundary.

| # | Scenario and actor | Precondition/action | Expected result and required evidence | Cleanup |
|---|---|---|---|---|
| 1 | Cross-user evidence access denial; reporter then ordinary cross-user | Create one attached synthetic evidence object. Access the exact object through each authenticated Storage boundary. | Reporter receives expected bytes. Cross-user receives real non-2xx authorization/not-found and zero bytes while trusted inspection proves the object exists. | Retain object only for subsequent authorized moderator scenarios; later remove through scoped cleanup. |
| 2 | Report evidence creation; reporter | Submit one synthetic valid PNG through `/report` with action-bound testing Turnstile. | Successful report; exactly one private allocation/object; source not retained; no raw path leaks. | Reuse only inside this run's scenarios. |
| 3 | Evidence finalization | Inspect run-scoped ledger/object through guarded operator. | `attached` follows valid finalized transition; stored output is sanitized WebP with bounded metadata/hash/timestamps; object existed before finalization. | Retain for run. |
| 4 | One-time attachment and reconciliation safety | Attempt a second authenticated attachment using the same evidence; reconcile attached + disposable unattached IDs. | Second attachment denied at authoritative DB boundary; no duplicate report reference; reconciliation never removes attached evidence. | Disposable object enters cleanup; attached object retained for access tests. |
| 5 | Assigned-moderator access | Assigned moderator reaches AAL2 and claims/receives the case through the authorized workflow; attempts exact evidence read. | Assignment is auditable/case-bound; only assigned AAL2 moderator receives bytes. | Keep case until run cleanup. |
| 6 | Unassigned moderator rejection | Different AAL2 moderator does not own the case; attempts same read. | Real non-2xx denial and zero bytes while object remains valid for authorized actors. | No extra state beyond session. |
| 7 | Required moderator AAL2 | Same assigned moderator attempts access at AAL1, then verifies TOTP and repeats at AAL2. | AAL1 is denied/challenged and receives no bytes; same identity succeeds only at AAL2 after assignment. | Remove run-scoped factor/account state according to cleanup policy. |
| 8 | Evidence cleanup/lifecycle | Create a deliberately rejected sanitized object and an abandoned allocation/object through guarded run-scoped fixtures; observe cleanup. | Rejected/expired terminal state enters durable cleanup; exact objects are deleted once; attached evidence survives until deliberately released; no object path leaks. | After report release, run cleanup and prove zero run-scoped object/queue residue. |
| 9 | Malformed upload rejection | Reporter submits malformed multipart and image-labelled non-image payload with valid testing Turnstile. | Predictable 400; no report/allocation/finalized object/Storage artifact/provider leak. | Prove zero run-scoped side effects. |
| 10 | Oversized/hostile/chunked upload | Reporter sends per-file over-limit, aggregate over-limit, missing-length chunked, understated-length and malformed multipart streams. | Actual-stream enforcement returns 413 for size and 400 for malformed payload before allocation/upload/report; zero downstream state. | Prove zero run-scoped side effects. |

For every scenario, record only sanitized evidence:

- actor role;
- opaque run/report/upload ID where needed;
- precondition;
- exact boundary exercised;
- HTTP/Storage/database status;
- sanitized request ID;
- PASS / FAIL / BLOCKED;
- scoped before/after counts;
- cleanup result and residual count.

Stop immediately on:

- unexpected evidence bytes for denied actor;
- AAL1 moderator success;
- wrong-assignee success;
- evidence reuse;
- unsanitized stored output;
- unbounded request reaching downstream work;
- deletion of attached evidence;
- unscoped fixture deletion;
- secret/PII/path leakage.

---

# 12. Task 9 — Cleanup every synthetic artifact

Cleanup is part of correctness, not optional housekeeping.

After evidence capture and under the exact authorized cleanup scope:

1. release/delete the synthetic report through the intended guarded path so
   attached evidence enters the proper durable cleanup lifecycle;
2. invoke/observe cleanup and verify Storage deletion;
3. remove remaining run-scoped report/evidence/allocation/cleanup rows only
   through the target-locked operator and in safe dependency order;
4. verify zero run-scoped Storage objects remain;
5. verify zero unprocessed run-scoped cleanup work remains;
6. remove fresh throwaway Auth identities/profiles/memberships/sessions/MFA
   factors where the cleanup scope authorizes it;
7. restore original role/factor state for any intentionally reused synthetic
   actor instead of deleting it;
8. clear temporary local credential variables/files and raw artifacts;
9. retain only sanitized checksum-bound evidence;
10. remove temporary testing provider configuration only if the current plan
   designates it ephemeral and only after cleanup is complete.

Cleanup failure keeps the relevant hosted verification boundary unresolved.

Do not hide cleanup failure by deleting DB ledger rows while Storage, queue or
Auth residue remains unknown.

---

# 13. Task 10 — Final Gate 3 rerun, review and decision

The following sequence records the intended complete reconciliation order.

For current execution, skip only steps already closed by current authoritative
evidence; do not rerun closed mutations merely because they appear here.

## Execution order

1. protected-tree/current-candidate preflight;
2. authoritative staging target and provider-name inventory;
3. public configuration reconciliation where still needed;
4. source/harness TDD where still needed;
5. full local/canonical verification and independent review;
6. exact attributable candidate and required H3 merge boundary;
7. maintenance-safe staging preparation where currently needed;
8. fresh migration inventory, guarded dry run and only the currently authorized
   forward migration set;
9. migration/type/runtime/cron/Realtime/RLS/function postchecks;
10. Turnstile/Images provider verification and exact-SHA deploy where still
    required;
11. cleanup function/scheduler verification where still required;
12. restore/verify public registration configuration;
13. synthetic actor/role/TOTP provisioning under its exact gate;
14. moderator AAL2 hosted verification;
15. hostile report-evidence matrix under its exact gate;
16. full synthetic cleanup;
17. fresh canonical verification of the exact final candidate;
18. independent final code/security/evidence review;
19. truthful PASS / FAIL / BLOCKED status reconciliation.

## Historical hosted commands

The original plan used:

```powershell
pnpm exec playwright test tests/e2e/real-beta.spec.ts --config=playwright.hosted.config.ts --project=chromium --workers=1 --reporter=line --grep "moderator reaches the AAL2 moderation queue"
```

and:

```powershell
pnpm exec playwright test tests/e2e/hosted-report-evidence.spec.ts --config=playwright.hosted.config.ts --project=chromium --workers=1 --reporter=line
```

Use the current repository commands/configuration if these have legitimately
changed.

No:

- ad-hoc DB target;
- RLS bypass;
- Turnstile bypass;
- service-role substitution for actor authorization;
- test rewrite merely to obtain green.

## Fresh canonical verification

Historical final command set:

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

Run from the exact candidate being evaluated.

Record every command independently.

A local hosted-test skip is acceptable only when the corresponding required
hosted evidence exists separately; otherwise it remains `NOT RUN`/`BLOCKED`.

## Independent final review

The final review should inspect:

- current exact candidate manifest/scope;
- absence of unrelated work;
- absence of committed/printed secrets;
- absence of credential, cookie, TOTP-seed, object-path or private-email leaks;
- exact Worker SHA and staging identity;
- exact applied forward migration state;
- preservation of Gate 1 auth behavior;
- preservation of Gate 2 action-bound Turnstile behavior;
- actual sanitization/output type;
- actual bounded hostile-stream behavior;
- ordinary/cross-user/assigned/unassigned/AAL1/AAL2 authorization evidence;
- one-time attachment;
- attached-evidence reconciliation safety;
- cleanup function/scheduler/queue/object/account cleanup evidence;
- every currently required Gate 3 acceptance criterion.

No unresolved Critical/Important issue may be hidden by a PASS claim.

## Decision rule

### PASS

Use `PASS` only when every currently required local and hosted criterion is
freshly green, required cleanup is proved and independent review accepts the
evidence.

### FAIL

Use `FAIL` when a required criterion produces a reproducible application or
security defect.

Use Superpowers systematic debugging and the normal repair-budget process.

If repair needs a product/legal decision, R3 action, or out-of-scope adjacent
mutation, stop at the applicable Human Gate/scope boundary.

### BLOCKED

Use `BLOCKED` when required evidence is unavailable or unexecuted, including:

- provider proof;
- synthetic-account precondition;
- migration attestation;
- exact-SHA proof;
- hosted scenario;
- cleanup;
- independent review;
- required current scope/authority.

Only truthful current evidence may change the dedicated gate/status record.

---

# 14. Secure configuration and account inputs — names only

This section intentionally records **names**, never secret values.

## GitHub / Cloudflare deployment

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

## Supabase target / migration / operator

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

## Turnstile, Images and cleanup

```text
PUBLIC_TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY
TURNSTILE_EXPECTED_HOSTNAME
IMAGE_PROCESSOR_MODE
CLOUDFLARE_IMAGES_API_TOKEN
UPLOAD_CLEANUP_SECRET
UPLOAD_CLEANUP_BATCH_SIZE
SUPABASE_URL
```

`CLOUDFLARE_IMAGES_API_TOKEN` is operator/provider inventory material only if
actually required; it is not automatically a Worker runtime secret.

## Hosted harness

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
E2E_REAL_ADMIN_EMAIL
E2E_REAL_ADMIN_PASSWORD
E2E_REAL_ADMIN_TOTP_SECRET
```

Admin inputs remain optional and must stay unset unless the exact current
workflow genuinely requires an admin and the current scope authorizes one.

Passwords, TOTP seeds and privileged provider values belong only in trusted
secret stores/shell sessions.

Never place them in:

- tracked files;
- chat;
- GitHub Issue/PR bodies;
- Playwright traces;
- screenshots;
- test reports;
- documentation.

---

# 15. Acceptance record template

Use a dedicated current gate/evidence record for actual execution.

This historical template remains useful:

| Required condition | Actor/resource | Evidence source/command | Actual sanitized result | Cleanup | PASS / FAIL / BLOCKED |
|---|---|---|---|---|---|
| Exact staging identity/key | Frankfurt project/Worker | Target-locked verification + provider inventory | NOT RUN | None | BLOCKED |
| Exact immutable Worker SHA | Staging Worker | CI/deployment/smoke receipt | NOT RUN | None | BLOCKED |
| Exact forward migration state | Frankfurt DB | Receipt + dry run + push/post-list where authorized | NOT RUN | None | BLOCKED |
| Turnstile/Images/cleanup ready | Provider runtime | Action-bound token, sanitization, function/scheduler evidence | NOT RUN | None | BLOCKED |
| Required synthetic actors ready | Staging Auth/DB | Target-locked synthetic-actor receipt | NOT RUN | None | BLOCKED |
| Required hosted scenarios | Ordinary/staff sessions | Hosted Playwright/operator evidence | NOT RUN | NOT RUN | BLOCKED |
| Canonical final verification | Exact candidate SHA | Repository-required commands | NOT RUN | None | BLOCKED |
| Independent final review | Candidate/evidence | Reviewer report | NOT RUN | None | BLOCKED |

Do not leave placeholder `BLOCKED` rows in this historical plan and later treat
them as current project status.

Actual current status belongs in the current dedicated Gate/A-series evidence
and `PROJECT-STATUS.md`.

---

# Plan self-review

## Scope

- Gate 3 reconciliation only.
- No next-gate implementation.
- No deferred hardening implementation.
- No production work.
- No payment/monetisation activation.

## Target safety

- Frankfurt staging identity is explicit.
- Stockholm target is explicitly forbidden.
- Staging/production authority remains separate.
- Target verification precedes hosted DB mutation.
- No historical credential value is treated as authority.

## Candidate safety

- The historical candidate manifest was explicit.
- Unrelated dirty work was intentionally excluded.
- Exact-SHA attribution was mandatory.
- The owner working tree was not to be destroyed.
- Historical SHAs/manifests are preserved as historical evidence and not reused
  automatically for a current candidate.

## Database safety

- Migration 011 was never assumed.
- Exact forward set had to be proved.
- No down migration/reset/history repair.
- Defects use new forward migrations.
- Current migration inventory must now be freshly obtained rather than inferred
  from the historical 001–014 state.

## Provider safety

- Provider enablement was limited to what report-evidence verification needed.
- Secrets remained provider/secure-shell material.
- Monetisation remained disabled.
- Provider mutation authority was separate from local engineering authority.

## Actor safety

- Actors are synthetic.
- Real users are not silently reused.
- Role/MFA elevation is scoped.
- Admin is not provisioned merely for convenience.
- Service-role fixture access is not authorization evidence.
- `A9 only` remains a strict mutation boundary.

## Hosted-test quality

- Denials are asserted at actual boundaries.
- Missing UI is not authorization evidence.
- Actual-stream size limits are exercised.
- Sanitization is inspected.
- One-time attachment is tested.
- Reconciliation must preserve attached evidence.
- AAL1/AAL2 and assignment distinctions are exercised.

## Cleanup safety

- Cleanup covers object, queue, report, allocation, account, factor and session
  state as applicable.
- Cleanup is run-ID scoped.
- Pre-existing/real data is protected.
- PASS is impossible while required cleanup remains unproved.

## Authority reconciliation

The old A1–A12 vocabulary remains useful as a historical/stable Gate 3
checkpoint language, but the approval model is now interpreted through the
current repository autonomy architecture:

```text
Repository/project truth
→ current gate + GitHub Issue
→ R0–R3 / H1–H6 / named scope
→ Superpowers process
→ Matt deep engineering when useful
→ ECC/platform specialist when useful
→ repository verification
```

In particular:

- A1/A2/A3 do not impose blanket owner approval on local edits, branches,
  commits, pushes or PRs.
- A4 retains H3 for R2 merge.
- A5–A11 require the current exact hosted/provider/database/account/destructive
  scope rather than generic permission inferred from this plan.
- A12 is truthful evidence/status reconciliation, not a new product decision.
- previously granted unchanged exact scope should not trigger redundant owner
  interruption.

## Reuse rule

A future agent must not start this file from Task 1 merely because it finds it.

Instead:

1. read current `AGENTS.md`;
2. read current project/gate status;
3. inspect the canonical GitHub Issue;
4. identify the exact active A-series/named gate;
5. inspect which historical prerequisites are already closed;
6. perform only the remaining current scope;
7. collect fresh evidence;
8. never repeat a completed hosted mutation just to satisfy an old checklist;
9. never use an old SHA, migration set, Worker version or provider snapshot as
   current truth without verification;
10. stop only at a genuine Human Gate, named-scope boundary, exhausted repair
    budget, or current blocker.

This document remains valuable as a detailed operational safety/evidence
contract, not as a second current execution controller.