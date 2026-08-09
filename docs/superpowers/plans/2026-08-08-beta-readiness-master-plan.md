# Beta Readiness Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Use TDD for every behavior-changing task. Do not skip gates.

**Goal:** Make the current application safe to advance toward hosted beta by repairing the two current High-severity findings first, proving the critical auth lifecycles end-to-end, then addressing the immediate public-form resource boundary and running full verification.

**Architecture:** Preserve the existing server-first, fail-closed security architecture. Repair lazy auth by separating **route access policy** from **auth-data requirements**, rather than reverting to eager auth loading or adding route-specific exceptions. Registration abuse protection must fail before `auth.signUp()` is reachable. Public form parsing must be bounded by application-level limits.

**Tech Stack:** SvelteKit, TypeScript, Supabase/PostgreSQL/RLS, Cloudflare Workers, Cloudflare Turnstile, Vitest/current repository Node test stack, pgTAP/current DB test stack, Playwright/current E2E stack, GitHub Actions.

## Global Constraints

- This is a beta-gate remediation plan, not a general refactor.
- Do not add new marketplace functionality while a beta gate is failing.
- Preserve lazy auth loading; do not globally restore eager profile/membership/AAL loading.
- Preserve fail-closed authorization.
- Do not weaken RLS, SQL privilege boundaries, staff MFA/AAL2, upload sanitization, evidence isolation, or feature gates to make tests pass.
- Do not special-case `/onboarding` inside `hooks.server.ts` as the architectural fix.
- Behavior-changing work must follow: reproduce → failing test → minimal coherent fix → focused verification → broader regression verification.
- A green unit test is not sufficient when the finding concerns a real user lifecycle.
- If implementation uncovers a security-semantic change outside the current gate, stop that task and record the discovery instead of silently broadening scope.
- Commit after each independently reviewable task when working in a Git repository.
- Do not mark a gate complete without recording test/verification evidence.

---

## Gate order

1. **Gate 0 — Baseline and reproducibility**
2. **Gate 1 — Critical auth remediation**
3. **Gate 2 — Registration Turnstile**
4. **Gate 3 — Public auth form bounds + beta verification**

Do not begin the next gate until the previous gate has a recorded `PASS`.

The following remain outside the immediate beta gate unless new evidence shows they are release-critical:

- directional block semantics;
- message edit/delete/moderation evidence policy;
- compatible Worker rollback records;
- immutable SHA pinning for GitHub Actions;
- documentation drift;
- text-only report degradation behavior.

Track those separately in `post-beta-hardening.md`.

---

# Gate 0 — Baseline and reproducibility

**Objective:** Establish the exact current state before behavior changes.

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
- Create for new lifecycle coverage unless an existing lifecycle file is a clearly better home: `tests/server/auth-lifecycle-regressions.test.ts`

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
- [ ] Record all output; do not reinterpret green hook-only tests as lifecycle proof.

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

If any command cannot run, record the exact blocker. Do not claim that suite is green.

**Gate 0 PASS requires:**
- current SHA/state recorded;
- canonical test commands known;
- auth test inventory known;
- current verification limitations recorded;
- no behavior changes made.

---

# Gate 1 — Critical auth remediation

**Objective:** Repair the lazy-auth regression while retaining the performance optimization.

**Root cause:** The current implementation treats "authorization required to enter a route" as equivalent to "auth context the route needs to render/execute." These are different concerns.

## Required design

Keep `RouteAccessPolicy` for authorization.

Introduce a separate representation of auth-data requirements, conceptually capable of expressing:

- `user`
- `profile`
- `betaAccess`
- `aal`

The exact type/file naming should follow current project conventions, but the final design must let the hook compute the minimum data needed from:

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

Authenticated navigation on public/legal pages must not incorrectly present active beta users as needing onboarding.

## Task 1.1 — Add failing onboarding lifecycle regression

**Test file:** create `tests/server/auth-lifecycle-regressions.test.ts` unless the repository already has a lifecycle test harness that executes `handle` plus route server code; if so, extend that exact harness rather than creating a parallel one.

**Test intent:** Execute the hook/auth-context path and onboarding loader/action together. Do not mock away the data dependency being tested.

- [ ] Create or extend an auth lifecycle test proving an authenticated newly-confirmed/pending user entering `/onboarding` has the required profile and beta membership context.
- [ ] Assert onboarding does not return the audited false 403 solely because lazy loading omitted required state.
- [ ] Add action coverage proving onboarding POST receives the same required context.
- [ ] Run only the new test and verify it fails against the pre-fix implementation for the expected reason.

**Expected pre-fix failure:** `locals.profile` and/or `locals.betaAccess` missing, resulting in 403 or equivalent failed lifecycle.

## Task 1.2 — Add failing active-user `/login` regression

- [ ] Add a lifecycle test for an already active beta user requesting `/login?next=<safe-route>`.
- [ ] Assert the active user is redirected to the safe intended destination.
- [ ] Assert the user is not redirected to `/onboarding`.
- [ ] Verify the new test fails before implementation.

## Task 1.3 — Add failing password recovery regression

- [ ] Add a test for an active beta user successfully updating a password through `/auth/update-password`.
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
- [ ] Change the contract from "onboarding must not load state" to "onboarding loads only the state its route actually needs."
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

- [ ] Confirm every consumer's assumptions match the new requirement contract.
- [ ] Do not remove defensive/fail-closed checks merely because the hook now loads the data.
- [ ] Adjust route/header logic only where required for the audited behavior.

## Task 1.9 — Focused auth verification

Run:
- [ ] new onboarding lifecycle tests;
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
- [ ] Confirm no new unnecessary auth data loading on unrelated anonymous public routes.

### Gate 1 PASS requires

- [ ] New confirmed/pending user can reach onboarding with profile + beta state.
- [ ] Onboarding action has the same required context.
- [ ] Active beta user visiting `/login` bypasses onboarding.
- [ ] Active beta user completing password recovery bypasses onboarding.
- [ ] Already-AAL2 staff visiting `/auth/mfa` redirects correctly.
- [ ] `/admin` still requires and enforces AAL2.
- [ ] Active authenticated navigation on public routes is correct.
- [ ] Anonymous public routes still avoid unnecessary profile/beta/AAL queries.
- [ ] No global eager-auth rollback.
- [ ] No `/onboarding` special-case patch standing in for the architecture.
- [ ] Focused auth tests green.
- [ ] Full available verification green.

---

# Gate 2 — Registration Turnstile

**Objective:** Make automated public registration fail before Supabase `auth.signUp()` can be called.

**Primary files:**
- `src/routes/login/+page.svelte`
- `src/routes/login/+page.server.ts`
- existing Turnstile server helper/test files discovered in repository

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
- [ ] Avoid sharing an action label if the server validation expects action binding.

## Task 2.3 — Verify Turnstile before `signUp()`

**File:**
- `src/routes/login/+page.server.ts`

- [ ] Parse the registration form through the bounded mechanism introduced/selected for public auth forms in Gate 3 if that helper already exists; otherwise do not broaden Gate 2 solely to refactor every form.
- [ ] Before `supabase.auth.signUp(...)`, call the existing Turnstile verification helper with expected action `register`.
- [ ] Missing/invalid verification must return/fail before signup is reachable.
- [ ] Preserve current form validation and safe redirect semantics.

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

---

# Gate 3 — Public auth form bounds and beta verification

**Objective:** Close the immediate unauthenticated request-body resource gap, then prove the corrected tree is suitable for hosted Phase 2 verification.

**Primary files:**
- `src/lib/server/http/request-body.ts`
- `src/routes/login/+page.server.ts`
- `src/routes/auth/reset-password/+page.server.ts`
- any other unauthenticated/public auth actions discovered by route inventory
- tests for request-body helper/routes

## Task 3.1 — Inventory public raw `request.formData()` use

- [ ] Search current tree for `request.formData()`.
- [ ] Classify each call: anonymous/public, authenticated low-risk text form, file-bearing/bounded already.
- [ ] Confirm the current count rather than relying on the audit's snapshot.
- [ ] Gate 3 scope is public/anonymous auth actions first; record authenticated remainder for post-beta follow-up unless the same helper can be adopted trivially and safely.

## Task 3.2 — Define one standard small text-form profile

Follow the existing bounded body helper architecture.

Target profile should be intentionally small. Starting design:

```ts
const STANDARD_ACTION_FORM = {
  maxBytes: 64 * 1024,
  maxFileBytes: 1,
  maxFiles: 0,
  maxParts: 30
};
```

Adjust exact helper shape to the repository's actual parser API. If the current helper cannot represent zero files, use the smallest safe supported file limits or add a text-form wrapper with tests.

- [ ] Do not trust `Content-Length` alone.
- [ ] Bound the actual request stream.
- [ ] Reject oversized/malformed bodies predictably.
- [ ] Keep the helper centralized.

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
- any additional anonymous auth action discovered in Task 3.1

- [ ] Replace raw `request.formData()` with the centralized bounded parsing path.
- [ ] Preserve existing field validation/error responses.
- [ ] Preserve Turnstile verification ordering.
- [ ] Ensure registration still verifies Turnstile before signup.
- [ ] Do not change authenticated business-action limits in this task unless required by a shared helper change.

## Task 3.6 — Full local verification

Run:

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

If a dependency/service prevents a command, record the exact limitation and do not mark that verification item green.

## Task 3.7 — Hosted Phase 2 readiness checklist

Prepare the corrected tree for hosted verification. Do not claim hosted behaviors were verified unless they were actually executed.

Required hosted checks:

- [ ] real signup → email confirmation → pending membership/profile → onboarding → authenticated destination;
- [ ] active authenticated user → `/login` → intended destination;
- [ ] password recovery → password update → intended destination;
- [ ] staff AAL1 challenged appropriately;
- [ ] staff AAL2 accepted and `/admin` remains protected;
- [ ] evidence isolation;
- [ ] multi-session/race behavior relevant to auth/onboarding;
- [ ] cleanup behavior;
- [ ] restore rehearsal;
- [ ] provider/runtime configuration, including Turnstile action validation.

### Gate 3 PASS requires

- [ ] Public auth actions use bounded body parsing.
- [ ] Oversized registration/login/reset-password bodies fail before expensive/provider operations.
- [ ] All available local verification is green.
- [ ] Any unavailable verification is explicitly recorded as not run, not silently treated as passing.
- [ ] Hosted Phase 2 checklist is ready.
- [ ] No High-severity finding from the audit remains open.

---

# Execution evidence format

Every gate document must maintain:

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

A `PASS` is invalid without commands/results or equivalent hosted evidence.

---

# Escalation rules

Stop the active task and record a new finding if any of the following occurs:

1. Fixing auth appears to require weakening AAL2, RLS, or fail-closed authorization.
2. Route behavior depends on a hidden auth-data requirement not represented by the new contract.
3. A test can only be made green by mocking away the lifecycle boundary under test.
4. Registration can reach `signUp()` without a successful action-bound Turnstile verification.
5. The bounded parser must buffer an unbounded body before applying limits.
6. Hosted schema/runtime state differs materially from local assumptions.
7. A Medium finding becomes demonstrably exploitable or blocks the repaired signup/auth lifecycle.

Do not silently promote scope. Record the finding, severity rationale, affected gate, and proposed next action.

---

# Definition of beta-gate complete

The beta-gate remediation is complete only when:

- Gate 0 = PASS
- Gate 1 = PASS
- Gate 2 = PASS
- Gate 3 = PASS
- all two audited High-severity issues are closed with regression tests;
- public auth request-body limits are enforced;
- full available local verification is green;
- hosted Phase 2 verification has either passed or is explicitly the next external verification step;
- no unresolved newly-discovered High issue exists.

Do not treat the post-beta hardening queue as a blocker unless new evidence promotes an item.
