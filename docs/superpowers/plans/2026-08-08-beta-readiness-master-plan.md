# Beta Readiness Remediation Implementation Plan

**Plan date:** 2026-08-08  
**Role:** Historical Gate 0–3 remediation plan and reusable technical acceptance contract.  
**Execution semantics reconciled:** 2026-08-11.

> This document preserves the technical design, gate ordering, failure modes, acceptance criteria, and verification intent established for the 2026-08-08 beta-readiness remediation.
>
> It is not the current executable queue, does not reopen completed gates, and does not independently authorize hosted/provider/database mutations. Current execution comes from `AGENTS.md`, authoritative project docs, current gate/status documents, and the canonical GitHub Issue.

**Goal:** Make the reviewed application safe to advance toward hosted beta by repairing the two High-severity findings identified at the time, proving critical auth lifecycles end-to-end, addressing the immediate public-form resource boundary, and running the required verification.

**Architecture:** Preserve the existing server-first, fail-closed security architecture. Repair lazy auth by separating **route access policy** from **auth-data requirements**, rather than reverting to eager auth loading or adding route-specific exceptions. Registration abuse protection must fail before `auth.signUp()` is reachable. Public form parsing must be bounded by application-level limits.

**Tech Stack:** SvelteKit, TypeScript, Supabase/PostgreSQL/RLS, Cloudflare Workers, Cloudflare Turnstile, Vitest/current repository Node test stack, pgTAP/current DB test stack, Playwright/current E2E stack, GitHub Actions.

## Authority and execution model

For current work derived from this plan, use this order:

1. repository instructions / `AGENTS.md`;
2. authoritative project, product, architecture, security, business, legal and operational documentation;
3. current `docs/PROJECT-STATUS.md` and the active named-gate documents;
4. canonical GitHub Issue and explicitly authorized task/gate scope;
5. Superpowers as the primary engineering-process authority;
6. Matt Pocock deep-engineering skills when useful;
7. ECC/platform specialists when useful;
8. repository-defined verification and release gates.

Superpowers owns the engineering lifecycle.

Matt skills such as:

- `diagnosing-bugs`;
- `domain-modeling`;
- `codebase-design`;
- `code-review`;
- `wizard`;
- `writing-for-agents`;

may deepen the current Superpowers step when useful.

ECC/platform specialists may support areas such as:

- security;
- backend;
- Supabase;
- Cloudflare;
- E2E / Playwright;
- GitHub;
- evals;
- documentation lookup.

Skills do not independently define product truth, project status, mutation authority, or completion.

Do not create a second competing planner, debugging methodology, TDD loop, execution framework, review loop, or completion loop from this historical plan.

## Global Constraints

- This is a beta-gate remediation plan, not a general refactor.
- Historical checkboxes in this file are not the current executable frontier. GitHub Issues are the canonical executable queue.
- Do not add unrelated marketplace functionality while executing a currently active beta-gate issue.
- Preserve lazy auth loading; do not globally restore eager profile/membership/AAL loading.
- Preserve fail-closed authorization.
- Do not weaken RLS, SQL privilege boundaries, staff MFA/AAL2, upload sanitization, evidence isolation, or feature gates to make tests pass.
- Do not special-case `/onboarding` inside `hooks.server.ts` as the architectural fix.
- Normal users register publicly with email/password and complete email confirmation.
- Do not reintroduce invitation-only registration or phone/SMS OTP requirements for normal-user activation, first listing, offers, or ordinary marketplace actions.
- Legacy invite/bootstrap behavior may remain only where explicitly required for operator or first-admin compatibility.
- Staff/admin MFA/AAL2 remains mandatory.
- The underlying perfume transaction remains off-platform.
- Payment, billing, listing-fee, subscription, boost, advertising and provider scaffolding does not authorize activation of those features. They remain disabled until the applicable business/legal/production gates are satisfied.
- Merchant verification remains a free trust status and is not sold.
- Never edit an existing Supabase migration. Hosted schema evolution is forward-only.
- Do not use hosted database reset, migration-history rewrite, destructive repair or equivalent destructive remediation as the normal fix path.
- Behavior-changing work follows the current Superpowers lifecycle: reproduce/diagnose, TDD where applicable, minimal coherent repair, review, focused verification, broader verification, and verification-before-completion.
- A green unit test is not sufficient when the finding concerns a real user lifecycle.
- If implementation uncovers a security-semantic or product decision outside the current issue/gate, respect the applicable Human Gate and named-scope boundary instead of silently broadening work.
- Routine branch/worktree/commit/push/PR actions follow the current autonomy model rather than requiring blanket owner approval.
- R0/R1 may merge autonomously only after all required gates pass.
- R2 may be implemented autonomously but requires H3 before merge.
- R3 protected production/policy/destructive actions remain owner-controlled.
- Named-gate scope is strict. An instruction such as `A9 only` does not authorize adjacent provider, Auth, database, release or production mutations.
- Do not mark a gate complete without fresh command/results or equivalent hosted evidence.
- Local, staging and production remain isolated environments. Staging credentials do not imply production authority.
- Hosted work must use current target-locked operational procedures rather than historical credentials or project assumptions.

---

## Historical gate order

The 2026-08-08 plan established this sequence:

1. **Gate 0 — Baseline and reproducibility**
2. **Gate 1 — Critical auth remediation**
3. **Gate 2 — Registration Turnstile**
4. **Gate 3 — Public auth form bounds + beta verification**

The original rule was that a later gate could not begin until the previous gate had recorded `PASS`.

That ordering remains useful historical evidence, but **current gate state must be read from the individual gate execution records and current project status**. Do not reopen Gate 0, Gate 1, or Gate 2 merely because their tasks remain unchecked in this master planning document.

The related gate records are:

```text
docs/superpowers/plans/gate-0-baseline.md
docs/superpowers/plans/gate-1-auth-remediation.md
docs/superpowers/plans/gate-2-registration-turnstile.md
docs/superpowers/plans/gate-3-beta-verification.md
```

Later Gate 3 staging reconciliation work is governed by its own current plan/evidence rather than inferred from this older master plan.

The following themes were intentionally outside the immediate beta gate unless new evidence promoted them:

- directional block semantics;
- message edit/delete/moderation evidence policy;
- compatible Worker rollback records;
- immutable SHA pinning for GitHub Actions;
- documentation drift;
- text-only report degradation behavior.

Their durable reference belongs in `post-beta-hardening.md`, which is a catalogue/reference rather than a competing executable queue.

---

# Gate 0 — Baseline and reproducibility

**Objective:** Establish the exact current state before behavior changes.

**Historical status authority:** The actual Gate 0 result belongs in `gate-0-baseline.md`. This section preserves the original plan and acceptance contract only.

**Primary files to inspect:**

- `src/hooks.server.ts`
- `src/lib/server/auth/guards.ts`
- `src/routes/onboarding/+page.server.ts`
- `src/routes/login/+page.server.ts`
- `src/routes/auth/update-password/+page.server.ts`
- `src/routes/auth/mfa/+page.server.ts`
- `src/lib/components/Header.svelte`
- `tests/server/auth-refactor-contract.test.ts`
- repository test scripts in `package.json`
- current auth-related test files discovered by search
- create lifecycle coverage in `tests/server/auth-lifecycle-regressions.test.ts` unless an existing lifecycle harness is clearly the correct home.

**Required output:** a baseline execution record containing commands, pass/fail output, and the exact tests that reproduce or fail to reproduce the audited bugs.

### Task 0.1 — Confirm repository state and commands

- [ ] Record current branch/commit SHA.
- [ ] Confirm dependency installation state.
- [ ] Read `package.json` and record the canonical commands for unit/server tests, Svelte check, build, DB lint/tests, and E2E.
- [ ] Search for existing tests covering onboarding, login redirects, password recovery, MFA, and auth hook behavior.
- [ ] Record whether the archive/current checkout contains `.git`.

### Task 0.2 — Run current focused auth tests

- [ ] Run the existing auth hook/refactor tests unchanged.
- [ ] Run existing onboarding/login/recovery/MFA tests.
- [ ] Record all output.
- [ ] Do not reinterpret green hook-only tests as lifecycle proof.

### Task 0.3 — Record baseline suite status

If dependencies and required services are available, run the audited canonical commands:

```bash
pnpm test
pnpm check
pnpm build
pnpm db:lint
pnpm db:test
pnpm test:e2e
```

- [ ] Record the exit status and meaningful failure output for every command.
- [ ] If `package.json` shows these scripts have changed, use the current script definitions and record that difference.

If any command cannot run, record the exact blocker.

Do not claim that suite as green.

### Gate 0 PASS requires

- current SHA/state recorded;
- canonical test commands known;
- auth test inventory known;
- current verification limitations recorded;
- no behavior changes made.

This plan does not supersede the actual Gate 0 execution record.

---

# Gate 1 — Critical auth remediation

**Objective:** Repair the lazy-auth regression while retaining the performance optimization.

**Historical status authority:** The actual Gate 1 result belongs in `gate-1-auth-remediation.md`. This section preserves the design and acceptance contract.

**Root cause:** The reviewed implementation treated “authorization required to enter a route” as equivalent to “auth context the route needs to render/execute.” These are different concerns.

## Required design

Keep `RouteAccessPolicy` for authorization.

Use a separate representation of auth-data requirements capable of expressing:

- `user`;
- `profile`;
- `betaAccess`;
- `aal`.

The exact type/file naming follows current project conventions, but the design must allow the hook to compute the minimum data needed from:

1. route access policy; and
2. route data requirements.

Do not make access policy carry unrelated rendering/data-fetch semantics.

### Required behavior matrix

| Route | Access | Auth data needed |
|---|---|---|
| `/onboarding` | authenticated | user + profile + betaAccess |
| `/login` | public | user; betaAccess when a user is authenticated |
| `/auth/update-password` | authenticated | user + betaAccess |
| `/auth/mfa` | staff AAL1 | user + profile + betaAccess + AAL |
| `/admin` | staff AAL2 | preserve current full staff/AAL2 enforcement |

Authenticated navigation on public/legal pages must not incorrectly present an active authenticated marketplace user as needing onboarding because required beta state was omitted.

The presence of beta/membership state in this Gate 1 contract does **not** mean normal-user registration is invite-only.

## Task 1.1 — Add failing onboarding lifecycle regression

**Test file:** create `tests/server/auth-lifecycle-regressions.test.ts` unless the repository already has a lifecycle test harness that executes `handle` plus route server code; if so, extend that exact harness rather than creating a parallel one.

**Test intent:** Execute the hook/auth-context path and onboarding loader/action together. Do not mock away the data dependency being tested.

- [ ] Create or extend an auth lifecycle test proving an authenticated newly-confirmed/pending user entering `/onboarding` has the required profile and beta membership/access context.
- [ ] Assert onboarding does not return the audited false 403 solely because lazy loading omitted required state.
- [ ] Add action coverage proving onboarding POST receives the same required context.
- [ ] Run only the new test and verify it fails against the pre-fix implementation for the expected reason.

**Expected pre-fix failure:** `locals.profile` and/or `locals.betaAccess` missing, resulting in 403 or equivalent failed lifecycle.

## Task 1.2 — Add failing active-user `/login` regression

- [ ] Add a lifecycle test for an already active authenticated user requesting `/login?next=<safe-route>`.
- [ ] Assert the active user is redirected to the safe intended destination.
- [ ] Assert the user is not redirected to `/onboarding`.
- [ ] Verify the new test fails before implementation.

## Task 1.3 — Add failing password recovery regression

- [ ] Add a test for an active authenticated user successfully updating a password through `/auth/update-password`.
- [ ] Assert successful completion does not redirect that active user to onboarding.
- [ ] Verify the test fails before implementation because beta state is missing.

## Task 1.4 — Add failing AAL2 `/auth/mfa` regression

- [ ] Add a test for an already-AAL2 staff user requesting `/auth/mfa`.
- [ ] Assert the route detects `aal2` and takes the existing correct redirect.
- [ ] Verify the test fails before implementation because `currentAal` was not loaded.

## Task 1.5 — Add authenticated-public-navigation regression

- [ ] Add component/server-data coverage for an active authenticated user on a public/legal route.
- [ ] Assert navigation does not label or route that user as requiring onboarding merely because beta state was omitted.
- [ ] Keep anonymous public route behavior lazy.

## Task 1.6 — Replace the test that codifies the bug

**File:**

- `tests/server/auth-refactor-contract.test.ts`

- [ ] Locate the `/onboarding` assertion that currently expects no profile/beta query.
- [ ] Change the contract from “onboarding must not load state” to “onboarding loads only the state its route actually needs”.
- [ ] Preserve performance assertions for unrelated routes.
- [ ] Ensure this test fails before the architectural implementation if run against the old behavior.

## Task 1.7 — Implement explicit auth-data requirements

**Likely files:**

- `src/lib/server/auth/guards.ts` or a focused neighboring auth-policy module
- `src/hooks.server.ts`
- related auth types/helpers

**Implementation constraints:**

- [ ] Keep `RouteAccessPolicy`.
- [ ] Add a separate auth-data-requirement mapping/helper.
- [ ] Make requirements explicit enough that `/onboarding`, `/auth/update-password`, and `/auth/mfa` cannot accidentally depend on data their policy does not request.
- [ ] Support conditional beta lookup for `/login`: anonymous requests should not pay for membership data that cannot affect behavior; authenticated requests must have enough state for correct redirect behavior.
- [ ] Avoid pathname-specific imperative patches inside the hook when a declarative route requirement can express the need.
- [ ] Preserve current admin AAL2 authorization behavior.

## Task 1.8 — Make route consumers consistent

Inspect:

- `src/routes/onboarding/+page.server.ts`
- `src/routes/login/+page.server.ts`
- `src/routes/auth/update-password/+page.server.ts`
- `src/routes/auth/mfa/+page.server.ts`
- `src/lib/components/Header.svelte`

- [ ] Confirm every consumer's assumptions match the requirement contract.
- [ ] Do not remove defensive/fail-closed checks merely because the hook now loads the data.
- [ ] Adjust route/header logic only where required for the audited behavior.

## Task 1.9 — Focused auth verification

Run:

- [ ] onboarding lifecycle tests;
- [ ] active `/login` test;
- [ ] recovery test;
- [ ] AAL2 MFA test;
- [ ] navigation regression;
- [ ] `auth-refactor-contract.test.ts`;
- [ ] existing auth/guard tests.

Record exact commands and results.

## Task 1.10 — Broader regression verification

- [ ] Run the full server/unit suite.
- [ ] Run Svelte/type check.
- [ ] Run build.
- [ ] Run relevant E2E auth flows if available.
- [ ] Confirm no unnecessary auth data loading on unrelated anonymous public routes.

### Gate 1 PASS requires

- [ ] New confirmed/pending user can reach onboarding with profile + beta state.
- [ ] Onboarding action has the same required context.
- [ ] Active user visiting `/login` bypasses onboarding.
- [ ] Active user completing password recovery bypasses onboarding.
- [ ] Already-AAL2 staff visiting `/auth/mfa` redirects correctly.
- [ ] `/admin` still requires and enforces AAL2.
- [ ] Active authenticated navigation on public routes is correct.
- [ ] Anonymous public routes still avoid unnecessary profile/beta/AAL queries.
- [ ] No global eager-auth rollback.
- [ ] No `/onboarding` special-case patch standing in for the architecture.
- [ ] Focused auth tests green.
- [ ] Full available verification green.

This section defines the historical acceptance target; current closure evidence belongs in the Gate 1 execution record.

---

# Gate 2 — Registration Turnstile

**Objective:** Make automated public registration fail before Supabase `auth.signUp()` can be called.

**Historical status authority:** The actual Gate 2 result belongs in `gate-2-registration-turnstile.md`.

**Primary files:**

- `src/routes/login/+page.svelte`
- `src/routes/login/+page.server.ts`
- existing Turnstile server helper/test files discovered in repository.

## Task 2.1 — Add failing server contract test

- [ ] Add a registration action test with missing Turnstile response.
- [ ] Assert registration fails.
- [ ] Assert `supabase.auth.signUp()` is never invoked.
- [ ] Add invalid-token coverage.
- [ ] Assert `signUp()` is never invoked for invalid verification.
- [ ] Verify tests fail before implementation.

## Task 2.2 — Add/register the client challenge

- [ ] Render Turnstile in registration mode as well as login mode.
- [ ] Use a registration-specific action name: `register`.
- [ ] Preserve the login challenge/action for login.
- [ ] Preserve age-check behavior.
- [ ] Avoid sharing an action label if server validation expects action binding.

## Task 2.3 — Verify Turnstile before `signUp()`

**File:**

- `src/routes/login/+page.server.ts`

- [ ] Parse registration through the bounded mechanism introduced/selected for public auth forms if that helper already exists; otherwise do not broaden Gate 2 solely to refactor unrelated forms.
- [ ] Before `supabase.auth.signUp(...)`, call the existing Turnstile verification helper with expected action `register`.
- [ ] Missing/invalid verification must return/fail before signup is reachable.
- [ ] Preserve current form validation and safe redirect semantics.
- [ ] Do not log email, Turnstile token, secret or private account metadata.

## Task 2.4 — Registration verification

- [ ] Run registration Turnstile contract tests.
- [ ] Run existing login Turnstile tests.
- [ ] Run login/register server tests.
- [ ] Run Svelte/type check.
- [ ] Run build.
- [ ] Run relevant E2E auth tests.

### Gate 2 PASS requires

- [ ] Register UI renders a Turnstile challenge bound to `register`.
- [ ] Missing token cannot reach `auth.signUp()`.
- [ ] Invalid token cannot reach `auth.signUp()`.
- [ ] Valid verified registration can reach the existing signup path.
- [ ] Login Turnstile behavior remains intact.
- [ ] Safe redirects and registration validation remain intact.
- [ ] Focused and broader available tests are green.

This plan does not convert Turnstile into a phone/SMS or invitation requirement. Public email/password registration remains the normal-user model.

---

# Gate 3 — Public auth form bounds and beta verification

**Objective:** Close the immediate unauthenticated request-body resource gap, then prove the corrected tree is suitable for the hosted verification required by the active beta-readiness boundary.

**Historical/current boundary:** This section is the original Gate 3 planning packet. The actual Gate 3 execution status and any later staging-reconciliation/A-series work must be read from the dedicated Gate 3 documents. Do not infer current hosted authority from this section.

**Primary files:**

- `src/lib/server/http/request-body.ts`
- `src/routes/login/+page.server.ts`
- `src/routes/auth/reset-password/+page.server.ts`
- other unauthenticated/public auth actions discovered by route inventory
- tests for request-body helper/routes.

## Scope rule

Start with anonymous/public auth endpoints.

Record the remaining authenticated raw `request.formData()` calls for separate follow-up unless changing them is required by the centralized helper or is separately authorized by the current issue.

Do not silently turn Gate 3 into a repository-wide form refactor.

## Task 3.1 — Inventory public raw `request.formData()` use

- [ ] Search current tree for `request.formData()`.
- [ ] Classify each call: anonymous/public, authenticated low-risk text form, file-bearing/bounded already.
- [ ] Confirm the current count rather than relying on the audit snapshot.
- [ ] Keep Gate 3 scoped to the public/anonymous auth boundary unless the current issue explicitly says otherwise.

## Task 3.2 — Define one standard small text-form profile

Follow the existing bounded body helper architecture.

Historical starting design:

```ts
const STANDARD_ACTION_FORM = {
  maxBytes: 64 * 1024,
  maxFileBytes: 1,
  maxFiles: 0,
  maxParts: 30
};
```

Adapt the exact helper shape to the repository's current parser API.

If the helper cannot represent zero files, use the smallest safe supported representation or a tested text-form wrapper.

- [ ] Do not trust `Content-Length` alone.
- [ ] Bound the actual request stream.
- [ ] Reject oversized/malformed bodies predictably.
- [ ] Keep the helper centralized.
- [ ] Do not weaken existing file-upload limits.

## Task 3.3 — Add failing oversized registration/login tests

- [ ] Add test for oversized registration form.
- [ ] Assert request is rejected before Turnstile/signup processing.
- [ ] Add test for oversized login form.
- [ ] Assert request is rejected before authentication processing.
- [ ] Verify the tests fail against raw `request.formData()` implementation.

## Task 3.4 — Add failing reset-password form test

- [ ] Add oversized body coverage for `/auth/reset-password`.
- [ ] Assert bounded rejection before provider call.
- [ ] Verify failure before implementation.

## Task 3.5 — Adopt bounded parsing on public auth actions

At minimum:

- `src/routes/login/+page.server.ts`
- `src/routes/auth/reset-password/+page.server.ts`
- any additional anonymous auth action discovered in Task 3.1.

- [ ] Replace raw `request.formData()` with the centralized bounded parsing path.
- [ ] Preserve existing field validation/error responses.
- [ ] Preserve Turnstile verification ordering.
- [ ] Ensure registration still verifies Turnstile before signup.
- [ ] Do not change authenticated business-action limits in this task unless explicitly required by current scope.

## Task 3.6 — Full local verification

Historical canonical command set:

```bash
pnpm test
pnpm check
pnpm build
pnpm db:lint
pnpm db:test
pnpm test:e2e
```

Record each command independently.

- [ ] unit/server tests;
- [ ] Svelte/type check;
- [ ] build;
- [ ] DB lint;
- [ ] DB tests;
- [ ] E2E.

If a dependency/service prevents a command, record the exact limitation.

Do not turn `NOT RUN` into `PASS`.

Run DB lint and DB test in the safe repository-defined order when their local lifecycle requires sequential execution.

## Task 3.7 — Hosted verification readiness

Prepare the corrected tree for hosted verification.

Do not claim hosted behavior was verified unless it was actually executed against the exact authorized target/candidate.

The original Gate 3 hosted checklist included:

- [ ] real signup → email confirmation → profile/beta state → onboarding → authenticated destination;
- [ ] active authenticated user → `/login` → intended destination;
- [ ] password recovery → password update → intended destination;
- [ ] staff AAL1 challenged appropriately;
- [ ] staff AAL2 accepted and `/admin` remains protected;
- [ ] evidence isolation;
- [ ] relevant multi-session/race behavior;
- [ ] cleanup behavior;
- [ ] restore rehearsal where required by the current release/gate;
- [ ] provider/runtime configuration, including Turnstile action validation.

Later Gate 3 plans may narrow, split or sequence these hosted requirements more precisely. Those later named-gate documents take precedence for current execution.

### Hosted authority rules

This master plan alone does **not** authorize:

- deployment;
- migration push;
- hosted Auth configuration changes;
- Turnstile/provider configuration;
- synthetic account creation/elevation;
- TOTP enrollment;
- hostile hosted tests;
- cleanup/destructive hosted operations;
- production actions.

For any such step:

- use the current named-gate scope;
- verify the exact target;
- apply current R0–R3/H1–H6 rules;
- keep staging and production authority separate;
- use forward-only database evolution;
- preserve synthetic-only evidence and least privilege.

### Gate 3 PASS requires

Historically:

- [ ] Public auth actions use bounded body parsing.
- [ ] Oversized registration/login/reset-password bodies fail before expensive/provider operations.
- [ ] All available local verification is green.
- [ ] Any unavailable verification is explicitly recorded as not run.
- [ ] Hosted verification prerequisites are ready.
- [ ] No High-severity beta-gate finding remains unresolved.

Current Gate 3 PASS must use the dedicated Gate 3 acceptance record and later reconciliation evidence, not this master checklist alone.

---

# Execution evidence format

The original plan required every gate document to maintain an execution record.

That remains a useful evidence shape for dedicated gate documents:

```md
## Execution Record

**Status:** NOT STARTED | IN PROGRESS | BLOCKED | COMPLETE

**Branch / SHA:**

### Files changed
- ...

### Tests added or modified
- ...

### Commands run
- `...` → PASS / FAIL / NOT RUN

### Unexpected findings
- None
  OR
- description + severity + whether it changes gate scope

### Gate decision
**PASS | FAIL | BLOCKED**

**Reason:**
Concrete evidence only.
```

A `PASS` is invalid without command/results or equivalent hosted evidence.

Do not duplicate the same execution record into multiple planning documents. The dedicated gate record is authoritative for that gate's evidence.

Routine issue/implementation history should remain in GitHub Issue + PR + CI unless durable gate evidence is specifically required.

---

# Escalation and Human Gate rules

The original plan identified several situations where work must not silently continue as though the finding were ordinary.

Current handling uses `docs/agents/HUMAN-GATES.md`, named-gate scope, risk classification, and repair budgets.

Escalate or stop at the relevant boundary if:

1. fixing auth appears to require weakening AAL2, RLS, or fail-closed authorization;
2. route behavior depends on a hidden auth-data requirement not represented by the current contract;
3. a test can only be made green by mocking away the lifecycle boundary under test;
4. registration can reach `signUp()` without successful action-bound Turnstile verification;
5. the bounded parser must buffer an unbounded body before applying limits;
6. hosted schema/runtime state differs materially from the verified local assumptions;
7. a lower-severity finding becomes demonstrably exploitable or blocks the active critical lifecycle;
8. implementation requires a product/legal/privacy/business decision that authoritative docs do not resolve;
9. completing the named gate would require an adjacent provider/database/Auth/release mutation outside its authorized scope;
10. an R2 change reaches merge-ready state without H3;
11. an R3 protected production/policy/destructive action becomes necessary.

Do not silently promote scope.

Record:

- the evidence;
- affected gate/issue;
- risk/severity;
- exact missing decision or authority;
- smallest safe next action.

Ordinary reversible technical failures should first use the normal Superpowers systematic-debugging and repair-budget process rather than immediately interrupting the owner.

---

# Historical definition of beta-gate complete

The 2026-08-08 plan defined beta-gate remediation completion as:

- Gate 0 = PASS;
- Gate 1 = PASS;
- Gate 2 = PASS;
- Gate 3 = PASS;
- the two audited High-severity issues closed with regression evidence;
- public auth request-body limits enforced;
- full available local verification green;
- required hosted verification passed or represented by the next explicit external gate;
- no unresolved newly discovered High issue.

This definition is preserved as the historical planning target.

Do not use it as a shortcut around later Gate 3 staging reconciliation, current launch gates, legal/business requirements, backup/restore requirements, or production protections.

The post-beta hardening catalogue is not automatically a beta blocker. A hardening item becomes active only when fresh evidence and the canonical GitHub queue promote it into the current execution frontier.

---

# Current reuse rule

When a future agent reads this plan:

1. do **not** start again at Gate 0;
2. read the individual gate execution records;
3. read current `PROJECT-STATUS.md`;
4. inspect the current GitHub Issues frontier;
5. identify the active named gate or issue;
6. use this document only for its still-relevant technical design/acceptance context;
7. use Superpowers as the process authority;
8. use Matt/ECC specialists only where useful;
9. respect current R0–R3/H1–H6 and named-gate boundaries;
10. collect fresh evidence before making any new PASS/readiness claim.

Historical unchecked boxes do not mean unfinished current work.

Historical `PASS` evidence does not automatically prove a later candidate.

Current repository and hosted state must always be established from current authoritative evidence.