# Perfume Marketplace Combined Remediation Implementation Plan

**Plan date:** 2026-08-08  
**Role:** Historical remediation plan and reusable task/acceptance catalogue.  
**Execution semantics reconciled:** 2026-08-11.

> The task packets and source observations below preserve the 2026-08-08 planning baseline. They are not the current executable queue and unchecked boxes do not mean a task is still open. Current work is selected from GitHub Issues and the current project/gate documents.

**Goal:** Close the verified correctness/security defects, add the missing high-value UI regression coverage identified in the second review, finish the remaining Phase 2 security boundaries, and strengthen release reliability without destabilizing the marketplace with broad refactors.

**Architecture:** Preserve the existing server-first SvelteKit → services → repositories → Supabase/RLS design. Fix correctness at the narrowest authoritative layer, test the real lifecycle at the layer where regressions can occur, and keep schema changes forward-only. Large UI components should be decomposed only when a requested change naturally touches a coherent sub-area and the extraction reduces risk.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, Supabase/PostgreSQL with RLS and pgTAP, Cloudflare Workers, Vitest 4, Testing Library for Svelte, Playwright, pnpm 11, Node 22, GitHub Actions.

## Authority and skill routing

For any current task that refers back to this plan, use this authority order:

1. repository instructions / `AGENTS.md`;
2. authoritative project, product, security, operational, and legal/business docs;
3. current `docs/PROJECT-STATUS.md` and current named-gate documents;
4. the canonical GitHub Issue and explicitly authorized task/gate scope;
5. Superpowers as the primary process authority;
6. Matt Pocock deep-engineering skills such as `diagnosing-bugs`, `domain-modeling`, `codebase-design`, `code-review`, `wizard`, and `writing-for-agents` when useful;
7. ECC/platform specialists for security, backend, E2E/Playwright, evals, documentation lookup, Supabase, Cloudflare, GitHub, or other specialist surfaces when useful;
8. repository-defined verification and release gates.

Skills are reasoning/execution tools, not independent sources of project truth. Do not install, vendor, or duplicate skill systems merely because an old task packet names one; route only capabilities that the current `docs/agents/SKILL-ROUTER.md` says are available.

Do not start competing planners, debugging methodologies, TDD loops, execution frameworks, review loops, or completion loops. Superpowers owns the process lifecycle. Matt and ECC/platform skills deepen or specialize that lifecycle.

Historical priorities and dependencies in this plan remain useful planning context, but current GitHub Issue priority/risk/state labels and current gate dependencies control execution.

## Global Constraints

- The repository root `AGENTS.md` and current authoritative docs override this plan if they conflict.
- At the start of current implementation work, determine the active phase/gate and canonical GitHub Issue from repository state. Continue autonomously by default; stop only at a real H1–H6 Human Gate, phase completion, an explicit stop instruction, or a documented blocker that exhausts the repair budget.
- At the time this plan was written, the project phase was **Phase 2 — security hardening and hosted integration tests**. That statement is historical; current phase/status comes from `docs/PROJECT-STATUS.md` and current gate docs.
- Public email/password registration with email confirmation is the normal-user model. Do **not** reintroduce invitation-only registration or phone/SMS OTP gates for regular-user activation, first listing, offers, or ordinary marketplace actions.
- Staff/admin MFA/AAL2 remains mandatory.
- The underlying perfume transaction remains off-platform.
- Payments, listing fees, subscriptions, boosts, ads, billing providers, and other monetization paths remain disabled until their applicable business/legal/production gates authorize activation. Payment scaffolding is not activation authority. Merchant verification remains a free trust status.
- Protect confidential data. Never log or persist secrets, auth tokens, private emails, phone numbers, raw profile content, or sensitive command output in task records.
- Never edit an existing Supabase migration. Hosted schema changes are forward-only. Do not use remote reset, migration-history rewrite, or destructive repair as normal remediation.
- Prefer the smallest reversible change that restores correctness.
- Behavior-changing implementation follows the current Superpowers lifecycle, including systematic debugging when diagnosing an unexpected failure, TDD for the behavioral fix, independent review, and verification-before-completion. Matt/ECC specialists may be layered in when useful; they do not replace the process owner.
- Branches, worktrees, commits, pull requests, pushes, and R0/R1 merges are routine autonomous engineering actions when permitted by `AGENTS.md` and the current issue. R2 may be implemented autonomously but requires H3 before merge. R3 protected production/policy/destructive actions remain owner-controlled.
- Named-gate scope is strict. A task such as `A9 only` authorizes only that gate's mutations; it does not grant permission for adjacent provider, database, release, or account mutations.
- Do not create routine `docs/task-results/*` records for ordinary engineering history. GitHub Issue + PR + CI are the normal record. Update durable/current docs only when their actual state materially changes.
- GitHub Issues are the canonical executable queue. Convert or reconcile plan work into issues when it becomes executable; do not run directly from unchecked boxes in this historical plan.
- Local, staging, and production are isolated environments. Staging credentials never imply production authority.
- Hosted Supabase work must use the current target-locked procedures in `docs/STAGING-CREDENTIALS.md`; never infer authority from an old project reference or credential.
- Line numbers in this document reflect the 2026-08-08 review snapshot and may drift. Re-locate symbols by name before editing.
- This document is a remediation planning/evidence aid, **not** a replacement for `docs/MASTER-PLAN.md`, `docs/PROJECT-STATUS.md`, `docs/agents/`, current gate docs, or the GitHub issue queue.

---

# 1. Why this plan exists

This plan combines three sources of work:

1. **Verified defects from the 2026-08-08 repository review**
   - lazy auth-context loading at the reviewed snapshot breaks or misroutes important authenticated flows;
   - public registration lacks server-side Turnstile verification;
   - many route actions still materialize unbounded form bodies with `request.formData()`;
   - blocking/message mutation semantics do not yet form an unambiguous moderation/abuse boundary;
   - staging rollback is tied to one permanent Worker version rather than a release compatible with the current database;
   - GitHub Actions use mutable major-version tags;
   - project status/security documentation has drifted behind current source;
   - text-only reports are unnecessarily coupled to privileged evidence infrastructure.

2. **Legitimate test/maintainability gaps identified by a second AI review and verified against the repository**
   - `ListingWizard.svelte` lacks isolated component tests despite being a large and business-critical state machine;
   - `admin/+page.svelte` and `listing/[slug]/+page.svelte` lack direct smoke-level component coverage;
   - the three largest UI files should be decomposed gradually when a requested change already touches a coherent subsection;
   - documentation overhead should be revisited only if live project docs actually become large enough to slow agent startup.

3. **Existing Phase 2 / launch blockers already recorded in project documentation**
   - hosted evidence acceptance and isolation;
   - owner decisions for message edit/delete/block/moderation retention semantics;
   - real multi-session concurrency tests;
   - staging providers and full hosted lifecycle verification;
   - legal/privacy completion;
   - backup/restore rehearsal, monitoring and protected production deployment.

The plan deliberately separates these categories. A correctness defect is not the same as test debt, and neither is the same as an unresolved product/legal decision.

---

# 2. Evidence and review limitations at plan creation

## 2.1 Verified source facts at plan creation

- `src/lib/components/listing/ListingWizard.svelte`: approximately **1,291 lines**.
- `src/routes/admin/+page.svelte`: approximately **1,058 lines**.
- `src/routes/listing/[slug]/+page.svelte`: approximately **980 lines**.
- `tests/components/` contains component tests for auth shell, evidence helpers, listing card, and member shell, but no direct wizard/admin/listing-detail component test.
- There are **34** raw `request.formData()` calls across **18** route files.
- The wizard is **not completely untested**: Playwright covers wizard behavior, and the real-beta suite performs a real draft → evidence upload → publish lifecycle. The missing layer is fast isolated component regression testing.
- The database review found RLS enabled across the current public-table inventory and explicit `search_path` on the scanned `SECURITY DEFINER` functions. Do not reopen those areas without new evidence.
- `.env.example` is currently blank for `RESEND_API_KEY`; the old status entry saying a credential-shaped value remains there is stale.

## 2.2 Verification limitation from the review session

The reviewed ZIP did not provide an installable local dependency state in the review runtime and network access was unavailable, so the reviewer could not truthfully rerun the full suite. `docs/PROJECT-STATUS.md` records a green run from 2026-08-02, but the auth lazy-loading changes were modified later. Therefore every implementation task must produce fresh verification evidence before any “fixed”, “green”, “ready”, or “passes” claim.

---

# 3. Priority and dependency map

This table preserves the 2026-08-08 planning priority/dependency model. It is not the current GitHub queue. Before executing any row, reconcile it with the current issue, current gate status, current source, and `R0`–`R3` classification.

`P0`–`P3` here are work priority, not mutation risk. Current mutation/merge authority comes from the issue's `risk:R0`–`risk:R3` classification and `docs/agents/AUTONOMY.md`.

| ID | Priority | Work item | Category | Dependency |
|---|---:|---|---|---|
| AUTH-01 | P0 | Separate route access policy from auth-data loading requirements | Verified correctness defect | None |
| AUTH-02 | P0 | Add lifecycle regressions for onboarding/login/password/MFA | Regression protection | AUTH-01 design, may start red before implementation |
| AUTH-03 | P0 | Protect public registration with Turnstile | Verified security/abuse defect | None |
| HTTP-01 | P1 | Bound public auth form bodies | Resource/security hardening | Prefer after AUTH-01/03 |
| HTTP-02 | P1 | Migrate remaining raw route forms to shared bounded parsing | Resource/security hardening | HTTP-01 establishes convention |
| UI-01 | P1 | Add `ListingWizard.svelte` component suite | Verified test gap | Can run after P0 batch |
| UI-02 | P2 | Add listing-detail page smoke component test | Test gap | None |
| UI-03 | P2 | Add admin page smoke component test | Test gap | None |
| MSG-01 | P2 blocking | Human Gate decision: block/edit/delete/evidence retention semantics | Product/legal/security decision | H1/H2 decision required |
| MSG-02 | P2 | Implement authoritative messaging invariants | Security correctness | MSG-01 |
| MSG-03 | P2 | Add real multi-session messaging/offer/block/report race tests | Phase 2 blocker | MSG-02 + hosted/local multi-session harness |
| HOST-01 | P2 | Hosted report-evidence acceptance/isolation/cleanup verification | Existing Phase 2 blocker | Current named-gate scope + applicable Human Gate |
| REPORT-01 | P2 | Decouple text-only reports from evidence service dependency | Resilience | Confirm desired degradation behavior |
| RELEASE-01 | P2 | Replace permanent rollback UUID with compatible release rollback | Release safety | Release metadata design |
| RELEASE-02 | P3 | Pin GitHub Actions to immutable SHAs | Supply-chain hardening | None |
| DOC-01 | P2/P3 | Correct stale status/architecture documentation after fixes | Documentation correctness | Run after actual behavioral changes |
| MAINT-01 | Opportunistic | Extract large component subsections only while touching them | Maintainability | Triggered by real feature/change |
| MAINT-02 | Conditional | Archive old status history only if startup docs actually become unwieldy | Agent efficiency | Trigger threshold, not immediate |
| LAUNCH-01 | Later phases | Legal/privacy export/delete/retention completion | Existing launch blocker | Applicable H2/legal decisions |
| LAUNCH-02 | Later phases | Backup/restore, monitoring, production deployment | Existing launch blocker | Phase sequence |

## Historical recommended execution order

This ordering preserves the 2026-08-08 plan. Current GitHub Issue dependencies and named-gate scope take precedence. Do not combine the work into one giant code change. Historical batches:

1. **Batch A — P0 auth correctness and registration abuse boundary**: AUTH-01, AUTH-02, AUTH-03.
2. **Batch B — high-value regression coverage**: UI-01, optionally UI-02/UI-03 when the current issue/gate scope includes them.
3. **Batch C — request-body hardening**: HTTP-01 then HTTP-02 in small route groups.
4. **Batch D — messaging policy/security**: MSG-01 Human Gate decision, then MSG-02 and MSG-03.
5. **Batch E — hosted Phase 2 acceptance**: HOST-01 plus provider/lifecycle verification.
6. **Batch F — release hardening**: RELEASE-01, RELEASE-02.
7. **Batch G — documentation reconciliation**: DOC-01 after verified source state changes.
8. **Later phase work** only according to current phase/gate authority and the `R0`–`R3` / H1–H6 model.

---

## Task-packet reuse rule

Sections 4–22 are reusable technical task packets from the 2026-08-08 plan. They preserve the intended defect description, acceptance criteria, and verification ideas.

Before executing any packet:

- confirm the defect or gap still exists on the current candidate;
- use or create the canonical GitHub Issue;
- respect the issue's current risk/state labels and dependencies;
- respect any active named-gate mutation scope;
- use the current Superpowers process with Matt/ECC specialist help only where useful;
- do not treat old unchecked boxes, old line numbers, old phase wording, or old provider assumptions as current evidence.

If a later gate or execution record already closed a packet, do not reopen it merely because this historical plan still contains unchecked steps.

---

# 4. Task AUTH-01 — Separate route access from auth-data requirements

**Severity:** P0 / High

**Problem:** `RouteAccessPolicy` currently drives both authorization and what authentication context is loaded. Those concerns are different. `/onboarding` is only “authenticated” from an access perspective, yet its page requires `profile` and `betaAccess`. `/auth/mfa` is allowed at staff AAL1 but still needs current AAL data to decide whether an already-AAL2 user should be redirected. `/login` uses `betaAccess` for authenticated-user routing even though public routes currently skip beta loading.

**Relevant files:**
- Modify: `src/lib/server/auth/guards.ts`
- Modify: `src/hooks.server.ts`
- Possibly modify: `src/lib/server/auth/context.ts`
- Possibly modify: `src/lib/server/auth/types.ts`
- Test: `tests/server/auth-refactor-contract.test.ts`
- Test: `tests/server/auth-guards-regression.test.ts`
- Add or modify focused route tests for onboarding/login/update-password/MFA.

**Observed current behavior:**
- `routeAccessPolicy('/onboarding')` returns `authenticated`.
- In `src/hooks.server.ts`, `authenticated` currently means only `getUser()` is loaded.
- `src/routes/onboarding/+page.server.ts` rejects when `locals.profile` or `locals.betaAccess` is absent.
- `src/routes/login/+page.server.ts` routes authenticated active users based on `locals.betaAccess?.isActive`, but a public route currently does not load that value.
- `src/routes/auth/update-password/+page.server.ts` uses beta state after password change.
- `src/routes/auth/mfa/+page.server.ts` checks `locals.currentAal`, but `staff-aal1` currently does not request AAL.

## Intended design

Keep `RouteAccessPolicy` for authorization. Add a separate function that declares auth-data requirements. A suitable shape is:

```ts
export interface RouteAuthDataRequirements {
  profile: boolean;
  betaAccess: boolean;
  aal: boolean;
}

export function routeAuthDataRequirements(pathname: string): RouteAuthDataRequirements {
  // Exact route-data mapping; must not be inferred solely from access level.
}
```

Minimum correctness requirements:

- `/onboarding` → profile + beta access.
- `/auth/update-password` → beta access.
- `/auth/mfa` → profile + beta access + AAL.
- `/admin/**` → profile + beta access + AAL.
- ordinary beta routes → profile + beta access.
- `/login` for an authenticated user must have enough state to send active users to `next` and incomplete users to onboarding.
- authenticated users on public/legal pages must not be falsely rendered as “needs onboarding” merely because beta state was intentionally not loaded.

### Important implementation warning

`loadAuthPieces()` currently normalizes some profile fields using the beta-access row. Do not introduce a “profile only” route mode that silently loses role/account-kind information unless the normalization logic is explicitly corrected and tested. Prefer profile+beta together where profile semantics depend on the access RPC.

## TDD steps

- [ ] **Step 1: Rewrite the incorrect characterization expectations as regression expectations.**

In `tests/server/auth-refactor-contract.test.ts`, remove the assertion that authenticated `/onboarding` must call only `getUser()`. Replace it with a test asserting profile and beta access are loaded for `/onboarding` and MFA is not loaded there.

Expected assertions:

```ts
expect(client.auth.getUser).toHaveBeenCalled();
expect(client.from).toHaveBeenCalled();
expect(client.rpc).toHaveBeenCalled();
expect(client.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
```

- [ ] **Step 2: Add a failing test for `/auth/mfa`.**

Assert `getUser`, profile, beta and `getAuthenticatorAssuranceLevel()` are all called. This protects the page’s existing `currentAal === 'aal2'` branch.

- [ ] **Step 3: Add a failing authenticated `/login` routing test.**

Construct locals/context representing an active user and prove `/login?next=/dashboard` redirects to `/dashboard`, not `/onboarding`.

- [ ] **Step 4: Add a failing `/auth/update-password` post-success test.**

Mock a successful password update for an active beta user and assert the action redirects to the safe `next` target instead of onboarding.

- [ ] **Step 5: Add an onboarding lifecycle route test.**

Exercise hook context loading plus onboarding loader/action with a pending membership and profile. The test should fail on the pre-fix lazy-loading code because `profile`/`betaAccess` are absent.

- [ ] **Step 6: Verify tests are red before implementation.**

Run the narrowest relevant Vitest files. Record the exact failing assertions and ensure the failures correspond to the regression, not test setup mistakes.

Suggested command:

```bash
pnpm vitest run tests/server/auth-refactor-contract.test.ts tests/server/auth-guards-regression.test.ts
```

- [ ] **Step 7: Implement `routeAuthDataRequirements()`.**

Do not make authorization weaker. `enforceRoutePolicy()` continues to use `routeAccessPolicy()`; only context fetching changes.

- [ ] **Step 8: Update `src/hooks.server.ts` to use the data requirement function.**

The hook should still call `getUser()` first. If no user exists, do not make authenticated profile/beta/MFA calls. If a user exists, load exactly the additional pieces required by the route-data policy.

- [ ] **Step 9: Resolve public-page header correctness.**

Choose the smallest implementation that prevents an authenticated active user on a public/legal page from being labelled as onboarding-required. A safe first fix is to load beta access for authenticated public pages rather than optimizing prematurely. If a tri-state “not loaded” model is used instead, it must be explicit in `PublicAuthState` and tested so `null` does not ambiguously mean both “known missing” and “not fetched”.

- [ ] **Step 10: Re-run the focused auth suite.**

All newly added regression tests must pass.

- [ ] **Step 11: Run normal-to-high-risk verification.**

Because auth is security-sensitive, run at minimum:

```bash
pnpm test:unit
pnpm check
pnpm build
pnpm test:e2e
```

If database/auth contracts are affected, also run:

```bash
pnpm db:lint
pnpm db:test
pnpm test:db:contracts
```

## Acceptance criteria

- New/confirmed users can reach onboarding with the profile and membership state the page requires.
- Active authenticated users visiting `/login` are routed to the requested safe destination.
- Active users completing password recovery do not get falsely sent through onboarding.
- AAL2 staff visiting `/auth/mfa` can be recognized as AAL2.
- `/admin/**` remains fail-closed behind role + AAL2.
- No external/open-redirect behavior is introduced.
- No invitation or phone-verification gate is reintroduced.
- Tests demonstrate the previous regression and the corrected lifecycle.

## Reviewer focus

- Confirm access authorization did not become coupled to UI convenience.
- Confirm public unauthenticated requests do not trigger unnecessary profile/RPC/MFA calls.
- Confirm fail-closed handling remains in place when required profile/beta calls error.
- Confirm authenticated-but-incomplete users still reach onboarding rather than beta routes.

---

# 5. Task AUTH-02 — Add lifecycle regression tests at the right abstraction level

**Priority:** P0 companion task

**Problem:** The current hook-level optimization test can pass while the real route lifecycle is broken. The project needs tests that cross the hook → locals → route loader/action boundary for critical auth journeys.

**Files:**
- Create: `tests/server/auth-lifecycle.test.ts` or add a clearly separated lifecycle section to the existing auth contract suite.
- Reuse existing auth mocks and SvelteKit redirect/fail assertions.
- Keep E2E coverage as a second layer rather than replacing these tests.

## Required scenarios

- [ ] **Registration confirmation → onboarding**
  - authenticated user exists;
  - pending membership exists;
  - profile exists;
  - onboarding loader succeeds rather than returning 403.

- [ ] **Active user → `/login?next=/dashboard`**
  - active beta state exists;
  - loader redirects 303 to `/dashboard`.

- [ ] **Incomplete user → `/login?next=/dashboard`**
  - pending/incomplete state exists;
  - loader redirects 303 to `/onboarding?next=...`.

- [ ] **Password recovery completion for active user**
  - `updateUser({ password })` succeeds;
  - active beta state exists;
  - redirects to safe next path, not onboarding.

- [ ] **AAL2 staff → `/auth/mfa`**
  - `currentAal` is loaded as `aal2`;
  - redirects to safe next path without unnecessary MFA enrollment/verification flow.

- [ ] **AAL1 staff → `/admin`**
  - still redirects to `/auth/mfa?next=...`.

- [ ] **Missing/erroring required auth context**
  - required profile or beta RPC failure remains a 503/fail-closed condition rather than treating the user as unauthenticated or inactive.

## Acceptance criteria

The tests must fail if a future optimization again decides that route access level alone determines what route loaders are allowed to read.

---

# 6. Task AUTH-03 — Add Turnstile to public registration

**Severity:** P0 / High

**Problem:** Login, password reset, offers, reports and listing uploads use Turnstile, but public registration can call `supabase.auth.signUp()` without a server-side Turnstile verification. An automated client can bypass the UI entirely and submit the registration action directly.

**Files:**
- Modify: `src/routes/login/+page.svelte`
- Modify: `src/routes/login/+page.server.ts`
- Test: add focused server action tests, preferably `tests/server/registration-turnstile.test.ts` if no existing login-action suite is an obvious home.
- E2E: extend `tests/e2e/real-beta.spec.ts` only if the real hosted registration path is already part of that suite or a registration scenario exists elsewhere.

## Intended behavior

Registration must require a Turnstile token with expected action `register` in production mode **before** `supabase.auth.signUp()` is called. Demo behavior should remain intentionally local/demo according to existing runtime conventions.

## TDD steps

- [ ] **Step 1: Add server test — missing token prevents sign-up.**

Mock production runtime, Turnstile verification failure/missing token, and a spy for `auth.signUp`. Assert the action fails with the existing user-facing validation/security pattern and `signUp` is never called.

- [ ] **Step 2: Add server test — rejected token prevents sign-up.**

Return a rejected Turnstile result and again assert `signUp` has zero calls.

- [ ] **Step 3: Add server test — valid `register` token allows sign-up path.**

Assert Turnstile verification occurs before sign-up and the successful registration behavior remains unchanged.

- [ ] **Step 4: Verify red.**

Run the focused server test before modifying registration.

- [ ] **Step 5: Render the registration Turnstile widget.**

Inside the registration branch of `src/routes/login/+page.svelte`, render:

```svelte
{#if data.turnstileSiteKey && !data.demoMode}
  <div
    class="cf-turnstile"
    data-sitekey={data.turnstileSiteKey}
    data-action="register"
  ></div>
{/if}
```

The page already loads the Turnstile script when configured; do not add duplicate scripts.

- [ ] **Step 6: Verify Turnstile in the `register` server action before `auth.signUp()`.**

Use the existing helper:

```ts
const challenge = await verifyTurnstileForAction(
  event,
  formData,
  event.locals.runtime,
  'register'
);
```

Follow the established login/password-reset error handling pattern. Do not log the email or Turnstile token.

- [ ] **Step 7: Verify focused tests green.**

- [ ] **Step 8: Run auth/security verification.**

```bash
pnpm test:unit
pnpm check
pnpm build
```

Run relevant E2E if configured with Cloudflare’s testing keys.

## Acceptance criteria

- Production registration cannot reach `auth.signUp()` without a successful Turnstile verification for action `register`.
- A token minted for a different expected action is rejected by the existing helper behavior.
- Login continues using `data-action="login"`; registration uses `register`.
- Demo mode remains usable according to existing demo semantics.
- No email/PII is added to logs.

---

# 7. Task HTTP-01 — Bound public auth request bodies first

**Priority:** P1 security/resource hardening

**Problem:** The codebase already has a robust `parseBoundedFormData()` helper that bounds the actual request stream, but public auth actions still call `request.formData()` directly. Public endpoints are the highest-value place to enforce a small request-body budget.

**Existing helper:** `src/lib/server/http/request-body.ts`

**First target files:**
- `src/routes/login/+page.server.ts`
- `src/routes/auth/reset-password/+page.server.ts`
- `src/routes/auth/update-password/+page.server.ts`
- `src/routes/auth/mfa/+page.server.ts`
- `src/routes/onboarding/+page.server.ts`

## Design

Add a small shared limit profile for ordinary text forms instead of copy/pasting values throughout the app. Recommended starting policy:

```ts
export const STANDARD_ACTION_FORM_LIMITS = {
  maxBytes: 64 * 1024,
  maxFileBytes: 1,
  maxFiles: 1,
  maxParts: 32,
  maxHeaderBytes: 8 * 1024
} as const;
```

The exact `maxFiles` handling must be compatible with the parser’s semantics for a text-only form. If a zero-file limit is unsupported by the helper’s positive-limit validation, use the smallest valid value and reject actual unexpected file fields at validation if necessary.

## TDD steps

- [ ] Add tests proving a request with an oversized declared `Content-Length` is rejected before action logic.
- [ ] Add chunked/no-content-length oversized-body test using the existing hostile stream patterns from `tests/server/request-body.test.ts`.
- [ ] Add a normal login/register/reset form test proving ordinary forms still parse.
- [ ] Map `RequestBodyTooLargeError` to HTTP 413 and `InvalidFormDataError` to HTTP 400 using a shared route/action helper or consistent local handling.
- [ ] Replace raw `formData()` calls in the first auth route batch.
- [ ] Run focused tests, `pnpm check`, and build.

## Acceptance criteria

- A malicious giant login/register/reset body is rejected at the stream boundary.
- Business logic and Supabase calls are not reached after a body-limit failure.
- User-facing errors do not reveal parser internals.
- Existing listing/report multipart limits remain unchanged.

---

# 8. Task HTTP-02 — Migrate the remaining 34 raw form actions in small groups

**Priority:** P1/P2

**Inventory at review time:** 34 calls across 18 route files.

**Known files:**
- `src/routes/admin/+page.server.ts`
- `src/routes/auth/mfa/+page.server.ts`
- `src/routes/auth/reset-password/+page.server.ts`
- `src/routes/auth/update-password/+page.server.ts`
- `src/routes/brand/[slug]/+page.server.ts`
- `src/routes/deals/+page.server.ts`
- `src/routes/favorites/+page.server.ts`
- `src/routes/listing/[slug]/+page.server.ts`
- `src/routes/login/+page.server.ts`
- `src/routes/merchant-application/+page.server.ts`
- `src/routes/messages/+page.server.ts`
- `src/routes/notifications/+page.server.ts`
- `src/routes/offers/+page.server.ts`
- `src/routes/onboarding/+page.server.ts`
- `src/routes/perfume/[slug]/+page.server.ts`
- `src/routes/publish/+page.server.ts`
- `src/routes/saved-searches/+page.server.ts`
- `src/routes/settings/+page.server.ts`

Do **not** convert all 18 files in one diff. Suggested groups:

1. auth/onboarding;
2. simple favorites/saved-searches/notifications/brand/perfume actions;
3. offers/deals/listing detail;
4. messages;
5. admin;
6. publish text actions, while preserving the separate listing-upload multipart endpoint.

For each group:

- [ ] Add or reuse a bounded form limit appropriate to the payload.
- [ ] Add one normal parsing test and one over-limit test for the group’s shared helper/convention.
- [ ] Replace only that group’s raw `formData()` calls.
- [ ] Run the narrowest affected tests.
- [ ] Run `pnpm check` and build for behavioral route changes.
- [ ] Reviewer checks that file-upload flows were not accidentally forced through a text-only limit.

**Completion query:**

```bash
rg -n 'request\.formData\(\)' src/routes
```

Expected end state: either zero results or a deliberately documented exception with a bounded upstream mechanism and an explicit reason.

---

# 9. Task UI-01 — Add component tests for `ListingWizard.svelte`

**Priority:** P1 test gap

**Important nuance:** The wizard already has Playwright coverage and real-beta publication coverage. This task adds the missing **fast isolated component layer**; do not duplicate every E2E assertion.

**Files:**
- Create: `tests/components/listing-wizard.test.ts`
- Reference pattern: `tests/components/listing-card.test.ts`
- Component under test: `src/lib/components/listing/ListingWizard.svelte`
- Reuse types/helpers from `src/lib/components/listing/types.ts`, `evidence.ts`, and contracts where appropriate.

## Test fixture design

Use `@vitest-environment jsdom`, `@testing-library/svelte`, `fireEvent`, `screen`, `waitFor`, `cleanup`, and `vi` consistent with the existing component tests.

Create a minimal catalog fixture with at least one real brand:

```ts
const brands = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Dior',
    slug: 'dior',
    parentBrandId: null
  }
];
```

Start most navigation/validation tests in `demoMode: true` so no SvelteKit action fetch/Turnstile infrastructure is required. Use a separate non-demo test for draft-to-publish network sequencing.

## Required component scenarios

### UI-01A — Step 1 cannot advance without fragrance identity

- [ ] Render wizard with `demoMode: true` and fixture catalog.
- [ ] Click `Продължи` without selecting brand or entering fragrance.
- [ ] Assert the wizard remains on step 1.
- [ ] Assert Bulgarian brand/fragrance validation feedback is visible.
- [ ] Assert the first invalid control has `aria-invalid="true"` or equivalent existing accessibility state.

### UI-01B — Valid forward and backward navigation

- [ ] Select a catalog brand through the combobox behavior rather than only mutating DOM values.
- [ ] Enter an acceptable fragrance name.
- [ ] Click `Продължи` and assert heading `Каква обява създаваш?`.
- [ ] Click Back and assert step 1 heading returns.
- [ ] Navigate forward again and assert previously entered brand/fragrance remain.

### UI-01C — Offer volume validation

- [ ] Reach physical-product step for an offer listing.
- [ ] Set bottle volume to a valid value and remaining volume above bottle volume.
- [ ] Click `Продължи`.
- [ ] Assert error `Остатъкът не може да надвишава оригиналния обем.`.
- [ ] Also cover zero/non-positive or over-precision values if the linked control permits entering them.

### UI-01D — Wanted listing branch

- [ ] Choose `wanted` listing kind using the real UI control.
- [ ] Assert step 3 title becomes `Опиши какво търсиш`.
- [ ] Assert the wanted flow does not require physical-product evidence photos.
- [ ] Continue into details and verify optional budget validation only rejects a provided invalid/non-positive value.

### UI-01E — Evidence-photo requirement

For an offer listing:

- [ ] Navigate to `Покажи реалния продукт`.
- [ ] Assert four required file inputs/roles are rendered for the default retail/open-bottle configuration.
- [ ] Attempt to continue with zero files and assert `Добави четири различни снимки — по една за всяка роля.`.
- [ ] Attach fewer than four distinct files and assert the step remains blocked.
- [ ] Attach four distinct `File` objects, one per required role, and assert the completion message `Всички нужни кадри са добавени.` appears.
- [ ] Continue successfully to details.

Use small in-memory test files such as:

```ts
new File([new Uint8Array([1, 2, 3])], 'front.png', { type: 'image/png' })
```

The component test verifies role/count state, not image decoding; actual image sanitization remains covered at server/integration layers.

### UI-01F — Details validation

- [ ] Sale/sale-or-swap with blank or non-positive price must show `Въведи продажна цена над €0.`.
- [ ] City shorter than two characters must show `Посочи град.`.
- [ ] Description under 30 characters must show `Опиши продукта с поне 30 знака.`.
- [ ] Invalid Fragrantica URL must show the existing HTTPS-specific error.
- [ ] Valid values advance to `Провери преди публикуване`.

### UI-01G — Final review revalidates prior steps

The component calls `firstInvalidStep()` across `[0, 2, 3, 4]` before final submission.

- [ ] Reach review with valid data.
- [ ] Mutate a previously valid field through UI if possible or use an interaction that makes one prior step invalid.
- [ ] Click publish.
- [ ] Assert the wizard returns to the first invalid step rather than attempting publication.

If the current UI prevents changing a prior step from review, test the same guarantee by navigating back, invalidating, returning to review, and publishing.

### UI-01H — Draft → upload → publish transition in non-demo mode

Mock global `fetch` to emulate SvelteKit action responses for the actions invoked by `callAction()`. The test must verify sequence, not implementation internals:

1. autosave draft obtains/retains a draft ID;
2. selected evidence is uploaded through the component’s expected upload path/action;
3. publish action is called with that draft ID;
4. success data contains a canonical slug;
5. component shows `Обявата е активна` or its current success heading and a `Виж обявата` link such as `/listing/published-test-slug`, using the slug returned by the mocked publish action.

- [ ] Capture fetch calls and assert the publish request occurs only after successful draft persistence/upload.
- [ ] Add a failure case where publish returns an action error and assert the success screen is not rendered.
- [ ] Add a server-validation routing case: a returned price/photo/etc. error sends the user back to the mapped step.

### UI-01I — Accessibility smoke

- [ ] Step heading receives focus after navigation where the component intentionally does so.
- [ ] Validation surfaces an alert/live message using the existing semantics.
- [ ] Busy/publishing state prevents accidental duplicate submit if the current UI already exposes disabled state.

## Verification

Focused:

```bash
pnpm vitest run tests/components/listing-wizard.test.ts
```

Then:

```bash
pnpm test:unit
pnpm check
pnpm build
```

Do not declare the wizard “fully covered”. The goal is regression coverage for its state machine and high-risk validation/publish boundaries, while E2E retains browser/server/database responsibilities.

## Acceptance criteria

- Step navigation has direct component regression protection.
- Per-step validation is tested for offer and wanted branches.
- Four-role evidence requirement is tested without needing a browser E2E run.
- Draft/publish sequencing has a focused test.
- Existing real-beta E2E remains in place; do not delete it as “redundant”.

---

# 10. Task UI-02 — Listing-detail page smoke coverage

**Priority:** P2

**File:** `src/routes/listing/[slug]/+page.svelte` (~980 lines at review time)

**Test:** create `tests/components/listing-detail-page.test.ts`.

**Goal:** Catch accidental rendering/data-contract breakage without attempting exhaustive component coverage that duplicates Playwright and service tests.

## Minimum smoke scenarios

- [ ] Render a representative offer listing DTO and required page data.
- [ ] Assert brand/fragrance title, price, city, seller, main image/gallery shell, description, and primary offer CTA render.
- [ ] Assert seller/profile link points to the canonical profile path.
- [ ] Assert favorite form/action renders in the expected state for an authenticated eligible viewer if that state is represented by page data.
- [ ] Assert a non-sale/swap-only listing does not incorrectly render a sale price/CTA.
- [ ] Assert at least one important disabled/owner state: the listing owner must not be presented with the same buyer offer path as another user.

**Do not:** reproduce every offer-dialog E2E assertion already in `tests/e2e/marketplace.spec.ts`.

**Verification:**

```bash
pnpm vitest run tests/components/listing-detail-page.test.ts
pnpm check
```

---

# 11. Task UI-03 — Admin page smoke coverage

**Priority:** P2

**File:** `src/routes/admin/+page.svelte` (~1,058 lines at review time)

**Test:** create `tests/components/admin-page.test.ts`.

**Goal:** Protect the large admin UI’s server-data contract and critical moderation surface. Authorization itself remains tested server/database-side; this is a render smoke test.

## Minimum smoke scenarios

- [ ] Render a minimal admin/moderator page-data fixture with at least one moderation case/queue item matching current `$types` data shape.
- [ ] Assert `Модерационен център` renders.
- [ ] Assert protected-session/AAL2 indicator renders when supplied by current page data.
- [ ] Assert one queue item’s target/reason/status is visible.
- [ ] Assert primary moderation action forms/buttons exist with the correct action names/URLs.
- [ ] Render an empty queue state and assert a stable empty-state message rather than a crash.

**Do not:** mock away route authorization and claim the page is security-tested. Actual authorization remains the responsibility of `+page.server.ts`, auth guards, RLS/RPC tests and E2E.

---

# 12. Task MSG-01 — Human Gate decision packet for block/edit/delete/moderation evidence

**Priority:** P2 blocker / cannot be guessed by an agent

**Current gate model:** Use the applicable H1 product and/or H2 legal/privacy/business Human Gate from `docs/agents/HUMAN-GATES.md`. The technical agent should present the smallest plain-language decision needed and recommend an option where the evidence supports one.

**Why this is not an ordinary code task:** Existing project docs explicitly mark these semantics as an owner/legal/product decision. The agent must not silently choose a policy.

## Current technical concern

The conversation membership has a `blocked_at` concept. The reviewed database invariant checks the sender’s own membership state when allowing a message, which does not automatically mean “the recipient blocked this sender, therefore inbound contact is prohibited”. Message mutation also needs a defined relationship to moderation evidence: whether content can be edited/deleted after a report, whether revisions are preserved, and for how long.

## Required Human Gate decision question set

Before implementation, present the owner with these concrete choices:

### A. Block semantics

Choose one:

1. **Unilateral inbound-contact prohibition — recommended for familiar marketplace expectations**
   - If Alice blocks Bob, Bob cannot send new direct messages to Alice.
   - Alice may also be prevented from sending until she unblocks Bob to avoid confusing one-way interaction.
   - Historical conversation remains visible according to retention policy.

2. **Mutual conversation closure**
   - A block by either participant prevents both sides from sending.
   - Conversation becomes read-only for both.

3. **Local mute/hide only**
   - Block affects Alice’s UI but does not prevent Bob from sending.
   - This should not be labelled “block” without very clear UX because it does not provide a contact boundary.

Also decide:
- Does blocking affect open offers/deals?
- Can a blocked party still view the other’s public listings/profile?
- Can either party report the historical conversation after blocking?
- Can staff still access the conversation when assigned to a moderation case?

### B. Message edit policy

Choose an edit window, e.g. irreversible after 15 minutes, 1 hour, or no editing after send. If editing remains allowed indefinitely, moderation must retain revisions.

### C. Delete policy

Choose whether user “delete” means:
- soft-delete from normal participant UI while preserving moderation evidence;
- replace visible text with a tombstone;
- true irreversible deletion only after a retention window and when no legal/moderation hold exists.

### D. Moderation evidence snapshot

Choose whether submitting a report creates:
- immutable snapshot of the relevant message/revision set;
- immutable revision history attached to the case;
- case reference to retained message rows with enforced no-mutation while under hold.

### E. Retention/legal hold

Specify:
- normal message retention;
- reported-message retention;
- retention after account deletion;
- who can lift a legal/moderation hold.

## Completion condition

- [ ] Record the owner-approved Human Gate decision in the authoritative project decision location, including date and reasoning; use `docs/MASTER-PLAN.md` if it remains the current decision ledger.
- [ ] Remove the corresponding unanswered item from Open Questions.
- [ ] Only then begin MSG-02.

---

# 13. Task MSG-02 — Enforce the chosen messaging semantics in the authoritative layer

**Priority:** P2 security correctness

**Dependency:** MSG-01 applicable Human Gate decision completed and recorded in the authoritative project decision source.

**Likely files:**
- `src/lib/server/repositories/conversations.ts`
- `src/lib/server/services/conversations.ts`
- `src/lib/contracts/conversations.ts`
- `src/routes/messages/+page.server.ts`
- new forward-only migration under `supabase/migrations/` if DB invariants/policies/triggers change;
- pgTAP tests under `supabase/tests/`;
- server tests for service/repository behavior;
- Playwright/multi-session tests.

## Implementation principle

Any rule that must remain true against a hostile authenticated client must be enforced in PostgreSQL/RLS/RPC/trigger logic, not only in Svelte UI or route actions.

## Required tests before implementation

Write hostile-client tests matching the chosen policy. If unilateral inbound prohibition is selected, tests should prove at minimum:

- [ ] Alice blocks Bob → Bob cannot insert/send a new message to Alice.
- [ ] A direct database/RPC attempt cannot bypass the block.
- [ ] Unrelated users cannot read the conversation.
- [ ] Assigned AAL2 moderator retains only the explicitly authorized investigation access.
- [ ] Historical messages remain readable or hidden exactly according to the recorded Human Gate decision.
- [ ] Message edit after the permitted window is rejected at the authoritative layer.
- [ ] Delete behavior matches the chosen tombstone/soft-delete semantics.
- [ ] Reported/held evidence cannot be destroyed by user mutation.
- [ ] Unblock behavior restores only the allowed future actions and does not rewrite history.

## Migration rules

- Never alter historical migration files.
- Add a new forward-only migration with narrowly scoped functions/policies/triggers.
- Include migration-from-scratch verification.
- Re-run DB lint and pgTAP.

## Verification

```bash
pnpm db:reset
pnpm db:lint
pnpm db:test
pnpm test:db:contracts
pnpm test:unit
pnpm check
pnpm build
pnpm test:e2e
```

Add real multi-session race coverage in MSG-03 before calling the Phase 2 messaging boundary complete.

---

# 14. Task MSG-03 — Real multi-session race tests

**Priority:** P2 Phase 2 blocker

**Goal:** Prove security invariants under concurrent sessions, not only sequential unit tests.

## Required scenarios

Use two or more independently authenticated browser/API sessions and synchronize actions close enough to exercise races.

- [ ] **Block vs send:** Alice blocks while Bob sends. Final outcome must never leave a message accepted after the authoritative block point in a way that violates the chosen policy.
- [ ] **Offer accept vs withdraw:** buyer withdraws while seller accepts. Exactly one valid terminal transition wins; no contradictory deal state.
- [ ] **Offer accept vs expire:** expiry boundary and acceptance cannot produce duplicate or impossible terminal states.
- [ ] **Report vs message edit/delete:** once the report/evidence hold point commits, later user mutation must follow the chosen moderation-evidence policy.
- [ ] **Duplicate send/retry:** repeated request identifiers/network retries do not create unintended duplicate state if idempotency is expected by the existing API.

## Test quality requirement

Do not rely on `sleep(100)` as proof of concurrency. Use barriers/promises or separate sessions that are released from a synchronization point so requests overlap intentionally.

## Acceptance criteria

- Tests fail reliably if DB transition guards are removed.
- Final database state is asserted, not only UI toast text.
- Race results are deterministic in allowed outcomes even when request winner order varies.

---

# 15. Task HOST-01 — Hosted report-evidence acceptance and isolation

**Priority:** P2 existing Phase 2 blocker

**This packet is not hosted-mutation authority.** Execute hosted steps only when the current GitHub Issue/named gate authorizes the exact staging scope and every applicable Human Gate has been satisfied. Read-only target verification may proceed where current repository policy permits it. Production remains out of scope unless separately and explicitly authorized by current R3 policy.

For staging Supabase mutations, verify the current authorized target through `pnpm db:staging:verify-target` and the current inventory/dry-run procedures before write. Never use the forbidden former Stockholm target.

## Hosted checks

- [ ] Apply only authorized forward migrations after `db:staging:verify-target` and dry run.
- [ ] Generate/check hosted DB types after migration.
- [ ] Verify staging Worker uses the updated evidence code and runtime inventory.
- [ ] Reporter A uploads valid supported evidence and finalizes it.
- [ ] Reporter B cannot read or attach A’s raw/final evidence.
- [ ] Unassigned moderator cannot read evidence.
- [ ] Assigned AAL1 moderator cannot read evidence.
- [ ] Assigned AAL2 moderator can read only the case-bound evidence allowed by policy.
- [ ] Evidence allocation cannot be attached twice.
- [ ] Malformed/chunked oversized uploads fail closed.
- [ ] Abandoned allocation expires and cleanup removes the corresponding object.
- [ ] Rejected object enters the durable cleanup path.
- [ ] Reconciliation does not delete evidence already attached to a committed report.

## Evidence record

Capture command names, exit codes, assertion counts and synthetic IDs only as needed. Do not place real user PII, bucket secrets or service-role credentials into the result file.

---

# 16. Task REPORT-01 — Keep text-only reporting available when evidence infrastructure is degraded

**Priority:** P2 resilience / smaller issue

**Observed issue:** `src/routes/report/+page.server.ts` checks for privileged Supabase/evidence configuration before it knows whether the user submitted any evidence. The UI/product decision already allows text-only reports when image processing is unavailable.

## Desired behavior

A text-only report should be able to reach the ordinary report service when evidence-only privileged infrastructure is unavailable, provided the normal authenticated/report authorization path is healthy. Evidence submission must still fail closed if its allocation/finalization requirements are unavailable.

## Tests

- [ ] text-only report + missing evidence-specific service configuration → report is accepted if the base report path can function;
- [ ] report containing evidence + missing privileged evidence configuration → 503/fail closed before storing untracked evidence;
- [ ] text-only report does not call evidence allocation/finalization methods;
- [ ] evidence report still uses allocation → sanitized upload → finalization → atomic attachment.

## Acceptance criteria

Degrading optional evidence processing does not unnecessarily disable the safety-critical ability to submit a textual report.

---

# 17. Task RELEASE-01 — Make staging rollback release-compatible

**Priority:** P2 release safety

**Problem:** `.github/workflows/deploy.yml` currently sets one permanent `SAFE_ROLLBACK_VERSION`. The database uses forward-only migrations. After future schema changes, an old Worker version may no longer be compatible with the current database even if it was once “safe”.

## Desired release model

Each successful staging release should have enough metadata to identify the last known-good **compatible** Worker version, not merely one hard-coded UUID.

Minimum release receipt fields:

```text
Git SHA
Cloudflare Worker version/deployment identifier
Database migration inventory or deterministic migration hash
Runtime/provider inventory version/check result
Smoke-test success timestamp/result
```

## Implementation options

Prefer a repository-controlled or CI-artifact approach that is auditable and does not expose secrets. Possible approaches include:

1. store a small deployment receipt artifact in the CI run and query the last successful compatible run before rollback;
2. maintain an operator-controlled release manifest in a protected environment/store;
3. query Cloudflare deployment/version metadata plus repository migration hash and choose the immediately previous successful compatible deployment.

Do not choose a design that silently edits tracked main-branch files during deployment.

## TDD/contract steps

- [ ] Add a deterministic script that computes the current migration inventory/hash from `supabase/migrations/`.
- [ ] Add Node contract tests for release receipt parsing and compatibility comparison.
- [ ] Add test: same DB migration hash + previous successful Worker → eligible rollback.
- [ ] Add test: old Worker receipt with incompatible migration inventory → rejected as rollback target.
- [ ] Add test: no compatible rollback target → deployment job fails closed and surfaces operator action rather than deploying an arbitrary old version.
- [ ] Replace `SAFE_ROLLBACK_VERSION` usage in workflow with resolved compatible target.
- [ ] Keep the existing post-rollback smoke verification.

## Acceptance criteria

A failed smoke test cannot automatically send staging back to code known to be incompatible with the current DB migration state.

---

# 18. Task RELEASE-02 — Pin GitHub Actions to immutable commit SHAs

**Priority:** P3 supply-chain hardening

**Files:**
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- any other workflow discovered by `find .github/workflows -type f`.

**Current examples:** `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4`.

## Procedure

- [ ] Enumerate every external `uses:` action.
- [ ] Resolve the reviewed release tag to its full 40-character commit SHA using a trusted source/operator environment.
- [ ] Replace mutable tag references with the actual full 40-character SHAs resolved and reviewed during the task, and retain the human-readable release tag/version in an adjacent YAML comment.
- [ ] Do not invent SHAs from memory or from this plan; the exact immutable value must come from the trusted resolution performed during implementation.
- [ ] Verify workflow YAML parses.
- [ ] Run any repository workflow contract/schema checks if available.
- [ ] Review Dependabot/Renovate strategy if automated updates are desired later.

**Acceptance criterion:** no third-party action used in security/release workflows relies only on a mutable major-version tag.

---

# 19. Task DOC-01 — Reconcile stale project documentation after verified fixes

**Priority:** P2/P3 documentation correctness

**Known drift at plan creation:**

- `docs/PROJECT-STATUS.md` says the last verification snapshot is 2026-08-02, which predates later auth-refactor changes.
- It still lists a credential-shaped Resend value in `.env.example` as an unresolved blocker, but the current example value is blank.
- `docs/ARCHITECTURE.md` was observed describing auth context as though profile/membership/AAL are always eagerly loaded; the current implementation is lazy.

## Rules

Do not “update the docs first” to make a defect disappear. Update documentation only after source behavior is fixed and freshly verified.

## Steps

- [ ] After AUTH-01/02/03, run the required verification suite and record exact results.
- [ ] Update `docs/PROJECT-STATUS.md` current verdict, blockers and verification snapshot to the actual date/results.
- [ ] Remove the stale `.env.example` credential blocker only after confirming the source tree and provider-side rotation/activity review state required by the current Phase 0/security process.
- [ ] Update architecture description to say auth access classification and auth-data requirements are distinct.
- [ ] Keep historical audit documents historical; do not rewrite old dated findings as if they were never true.
- [ ] Keep `PROJECT-STATUS.md` short and current rather than appending a long session diary.

## Acceptance criteria

A new agent reading `MASTER-PLAN.md` and `PROJECT-STATUS.md` should not be told that an already-fixed source issue is still current or that an unverified post-August-2 code state is green.

---

# 20. Task MAINT-01 — Split large components opportunistically, not as a standalone refactor

**Priority:** Opportunistic

**Files currently large:**
- `ListingWizard.svelte` ~1,291 lines;
- `admin/+page.svelte` ~1,058 lines;
- `listing/[slug]/+page.svelte` ~980 lines.

## Rule

Do **not** create a task named “split the giant components”. Instead, when an approved behavior change already requires touching a coherent subsection, the agent may extract that subsection if the extraction makes the behavior change safer and easier to review.

## Good extraction examples

If changing evidence UI in the wizard, extracting an evidence-step wrapper or its touched state/UI may be justified.

If changing the wizard review screen, a focused component such as:

```text
ListingReviewStep.svelte
```

may be appropriate.

If changing listing-detail offer UI:

```text
ListingOfferDialog.svelte
```

may be appropriate if it isolates the exact touched behavior.

If changing listing gallery:

```text
ListingGallery.svelte
```

may be appropriate.

If changing an admin moderation card:

```text
ModerationCaseCard.svelte
```

may be appropriate.

Names are examples; follow existing repository naming and nearby component conventions.

## Extraction guardrails

- [ ] Existing component tests/E2E covering the touched behavior are green before refactor.
- [ ] Add a focused failing test for the requested behavioral change first.
- [ ] Extract only the state/markup needed for the touched responsibility.
- [ ] Keep business logic in server/domain/service layers rather than moving it into new presentation components.
- [ ] Preserve accessibility labels, focus behavior and form action semantics.
- [ ] Avoid style-only churn across untouched sections.
- [ ] Verify behavior before and after extraction.

## Anti-pattern

Do not turn a small requested change into a 3,000-line movement-only diff. Large movement diffs make security/correctness review harder and can hide accidental Svelte reactivity changes.

---

# 21. Task MAINT-02 — Revisit docs overhead only when there is measurable friction

**Priority:** Conditional / no current action

At plan creation:

- `docs/MASTER-PLAN.md` is roughly 100 lines;
- `docs/PROJECT-STATUS.md` is roughly 100 lines.

At plan creation that was not enough overhead to justify restructuring. Current startup/document-reading requirements are defined by `AGENTS.md` and `docs/agents/`, not by this historical observation.

## Trigger for future action

Only revisit if one or more of these become true:

- `PROJECT-STATUS.md` grows into several hundred lines of historical entries rather than a short current-state summary;
- repeated agent sessions spend material context summarizing resolved history before finding current blockers;
- conflicting historical and current statements are repeatedly causing implementation mistakes.

## Then use this structure

- keep `PROJECT-STATUS.md` as a concise current snapshot;
- move resolved historical detail into dated audit/changelog files under `docs/`;
- preserve `MASTER-PLAN.md` as the owner decision and phase source of truth;
- never remove security/product decisions solely to save tokens.

No code/doc change is required for this item now.

---

# 22. Launch-blocker themes preserved from the 2026-08-08 plan

These are historical blocker themes, not a current status checklist. Current blocker truth belongs in `docs/PROJECT-STATUS.md`, current gate docs, and GitHub Issues. Preserve the themes so lower-risk test work does not create a false sense of launch readiness, but do not mark them open or closed from this file alone.

## 22.1 Provider/staging lifecycle

- [ ] When a current gate requires staging migrations, use only authorized forward migrations and target-locked verification before write.
- [ ] Hosted normal-user auth matches the current public email/password + email-confirmation model; no invite or phone/SMS activation gate is reintroduced.
- [ ] Email confirmation remains enabled.
- [ ] Turnstile production/staging keys and expected hostname verified.
- [ ] Transactional email verified with synthetic accounts.
- [ ] Full registration → confirmation → onboarding → listing → search → offer → chat → deal → review lifecycle exercised in staging.

## 22.2 Legal/privacy

Do not implement legal policy from guesses. Resolve these through the applicable H2 legal/privacy/business Human Gate and qualified review:

- [ ] operator/entity and public support/privacy contacts;
- [ ] final privacy/terms/safety copy;
- [ ] data export behavior;
- [ ] account deletion/anonymization behavior;
- [ ] retention periods and moderation/legal holds;
- [ ] stale phone-verification/closed-beta language in legal pages.

## 22.3 Backup/restore and production release

- [ ] backup policy and retention approved;
- [ ] restore rehearsal proves a backup can actually recover expected state;
- [ ] monitoring/alerts configured;
- [ ] protected production deployment path added;
- [ ] production readiness checks run against actual provider configuration;
- [ ] rollback strategy uses compatible release metadata per RELEASE-01.

---

# 23. Verification matrix by task risk

## Component-test-only additions

For UI-01/02/03 when no production behavior changes:

Run the exact focused test added by the task first. For example, UI-01 uses:

```bash
pnpm vitest run tests/components/listing-wizard.test.ts
pnpm test:unit
pnpm check
```

Run build if test scaffolding or imports expose production compilation changes.

## Normal route behavior changes

```bash
pnpm test:unit
pnpm check
pnpm build
pnpm test:e2e
```

## Auth/security/request-body changes

Use focused tests first, then:

```bash
pnpm validate:catalog
pnpm test:unit
pnpm check
pnpm build
pnpm test:e2e
pnpm test:db:contracts
```

Add DB verification if SQL/RLS/RPC/migrations are involved:

```bash
pnpm db:start
pnpm db:reset
pnpm db:lint
pnpm db:test
```

Stop local database services only through the current non-destructive repository-approved procedure. Do not use `--no-backup`, destructive Docker/volume cleanup, remote reset, or hosted migration-history repair as routine verification.

## Release workflow changes

At minimum:

```bash
pnpm test:unit
pnpm check
pnpm build
pnpm exec wrangler deploy --dry-run --env staging
pnpm exec wrangler deploy --dry-run --env=""
```

An actual deployment must follow the current issue/gate risk classification, named-gate scope, target verification, and applicable Human Gate. A dry-run or local green result is not deployment authority.

---

# 24. Review checklist inside the existing execution loop

This checklist is input to the repository's existing Superpowers review/verification flow. It is not a second review framework or completion loop.

When the current task reaches its review step, the reviewer should answer:

1. **Scope:** Did the change stay within the approved task?
2. **Correctness:** Is the original failure represented by a test that would fail if the fix were removed?
3. **Security:** Did any authorization, RLS, service-role, secret, upload or privacy boundary weaken?
4. **Architecture:** Did routes coordinate, services enforce rules, repositories access data, and domain code remain deterministic where applicable?
5. **Migrations:** If schema changed, was it done with a new forward-only migration only?
6. **Tests:** Are focused tests plus risk-appropriate broader checks freshly green?
7. **Docs:** Did actual current state/blockers change enough to require `PROJECT-STATUS.md` update?
8. **Human Gates:** Was any product/legal/business/privacy or protected-action choice guessed instead of routed through the applicable H1–H6 boundary?
9. **Diff quality:** Is the diff small enough to review? Did opportunistic refactoring remain tied to the touched behavior?
10. **Result record:** Preserve concise command/result evidence in the canonical Issue/PR/CI surfaces; update durable/current docs only when repository policy says their state materially changed.

---

# 25. What agents must explicitly avoid

- Do not reintroduce invite-only registration.
- Do not add phone/SMS OTP as a marketplace action gate.
- Do not activate payments, checkout, listing fees, subscriptions, boosts, ads, or billing providers outside their applicable business/legal/production gates; the perfume transaction remains off-platform.
- Do not weaken RLS to “make tests pass”.
- Do not use service-role credentials from browser code.
- Do not trust client MIME/file extensions in place of existing image sanitization.
- Do not edit old migration files.
- Do not fix messaging semantics before the applicable H1/H2 Human Gate records the required product/legal policy.
- Do not replace real-beta E2E with component tests; the layers are complementary.
- Do not rewrite historical audit files to hide stale findings.
- Do not claim tests/build pass based on the 2026-08-02 snapshot; run them fresh.
- Do not perform a standalone 3,000-line UI decomposition.
- Do not deploy to hosted staging/production merely because local checks pass; follow current target-locking, risk, named-gate, and Human Gate requirements.
- Do not impose a blanket owner-approval requirement on routine Git actions. Follow current autonomy: R0/R1 may branch/commit/push/PR/merge autonomously after required gates; R2 requires H3 before merge; R3 protected actions remain owner-controlled.

---

# 26. Historical task prompt templates

These templates preserve the intended technical scope of the 2026-08-08 task packets. Before reuse, the current GitHub Issue, current gate state, `AGENTS.md`, and `docs/agents/` control process/risk/merge behavior. Do not use a template to override the current autonomous execution loop.

## Prompt A — Auth regression remediation

> Read `AGENTS.md`, the current issue/gate docs, and this task packet. Work only on AUTH-01 and AUTH-02 if the current issue proves they remain applicable. Use Superpowers as process authority; Matt `diagnosing-bugs`/`domain-modeling`/`code-review` and ECC security/backend/Supabase specialists may support the work when useful. Add failing lifecycle/regression tests first for `/onboarding`, authenticated `/login`, `/auth/update-password`, and `/auth/mfa`. Separate route access policy from auth-data loading requirements without weakening authorization. Run the auth-appropriate verification required by the repository. Follow the current R0–R3/H1–H6 rules for Git/merge actions and do not perform adjacent provider/production mutations outside the named scope. Report changed files, exact verification commands/results, and any remaining blocker.

## Prompt B — Registration Turnstile

> Read `AGENTS.md`, the current issue/gate docs, and this task packet. Work only on AUTH-03 if current source still requires it. Use the existing Superpowers process; use Matt/ECC security reasoning only where useful. Add server tests proving missing/rejected Turnstile prevents `supabase.auth.signUp()` from being called and a valid token with expected action `register` allows the existing registration flow. Render registration Turnstile with action `register` while preserving login behavior. Reuse the existing verification boundary; do not invent a competing anti-bot system. Run focused and repository-required verification. Follow current R0–R3/H1–H6 rules for Git/merge actions; provider/deploy mutations require their own current scope and target checks.

## Prompt C — Listing wizard coverage

> Add component tests for `src/lib/components/listing/ListingWizard.svelte`, following the style of `tests/components/listing-card.test.ts`. Cover step navigation/back behavior, step 1 identity validation, offer volume validation, wanted-listing branching, the four-distinct-evidence-photo requirement, price/city/description/reference validation, final revalidation, and the non-demo draft → evidence upload → publish transition including a failure path. Keep existing Playwright coverage; do not replace it. Do not refactor the whole wizard. If one small extraction is necessary to make the tested boundary cleaner, keep it tightly scoped and explain why. Run the focused component suite, unit suite, Svelte check, and build if production code changed.

## Prompt D — Listing/admin smoke coverage

> Add light component smoke tests for `src/routes/listing/[slug]/+page.svelte` and `src/routes/admin/+page.svelte`. The listing-detail test should prove representative offer data renders core title/brand/price/seller/gallery/description/action state and one important conditional state. The admin test should prove the moderation center, protected-session indicator, one queue item/action, and empty state render. Do not duplicate server authorization or full Playwright coverage. Keep this test-only unless a tiny testability fix is essential.

## Prompt E — Bounded form parsing

> Work on HTTP-01 only first. Reuse `src/lib/server/http/request-body.ts` and establish a small shared bounded-form convention for ordinary auth/text actions. Add hostile oversized-body tests before converting login/register/reset/update-password/MFA/onboarding. Preserve existing 413/400 semantics and ensure business logic is not reached after parsing failure. Do not touch listing/report multipart limits. After this batch is reviewed, propose the next small route group for HTTP-02 rather than converting all 18 files at once.

## Prompt F — Messaging policy preparation

> Work only on MSG-01. Do not change messaging behavior before the required policy decision exists. Read the current conversation repository/service, SQL invariants, authoritative product docs, current Human Gates, and the MSG-01 packet. Produce the applicable H1/H2 plain-language decision brief covering block directionality, historical access, message edit window, delete semantics, immutable moderation evidence/snapshots, and retention/legal hold. Make the choices concrete, recommend an option where evidence supports one, and explain the technical/user-safety consequences. Stop only at that real Human Gate; after the decision is recorded, normal autonomous execution may continue with the separately scoped implementation issue.

## Prompt G — Release rollback hardening

> Work only on RELEASE-01 if it is the current canonical issue. Use Superpowers for the process, Matt codebase/design reasoning when useful, and Cloudflare/ECC specialists for platform-specific checks. Replace the conceptual reliance on a permanent `SAFE_ROLLBACK_VERSION` with a tested design for selecting the last known-good Worker release compatible with the current forward-only database migration inventory. Start with Node contract tests for migration hashing/release receipt compatibility and keep failed-smoke rollback fail-closed when no compatible release exists. An actual staging/provider mutation is outside this task unless the current issue/gate expressly authorizes it and all target/risk/Human Gate requirements are satisfied.

---

# 27. Historical exit picture for the combined remediation program

This section preserves what the 2026-08-08 plan considered a strong Phase 2 exit picture. It is not the current phase checklist and its boxes must not be used as current status. Current completion comes from GitHub Issues, current gate records, and `docs/PROJECT-STATUS.md`.

The historical target picture included:

- [ ] Auth lifecycle regression fixed and covered across hook + routes.
- [ ] Public registration Turnstile enforced server-side.
- [ ] Public/critical form bodies bounded; remaining route forms either migrated or explicitly justified.
- [ ] Listing wizard has direct component coverage for navigation, validation, evidence and publication sequencing.
- [ ] Admin/listing detail have smoke-level component coverage.
- [ ] Required messaging/block/edit/delete/retention Human Gate decisions recorded.
- [ ] Messaging invariants implemented and hostile-client tested.
- [ ] Real multi-session race tests pass.
- [ ] Hosted evidence isolation/finalization/cleanup acceptance passes.
- [ ] Staging provider configuration and synthetic lifecycle are verified.
- [ ] Rollback cannot target a database-incompatible old Worker.
- [ ] Project status docs reflect current source and fresh verification evidence.

Later launch readiness additionally requires legal/privacy, backup/restore, monitoring and protected production deployment per `MASTER-PLAN.md`.

---

# 28. Plan self-review checklist

## Spec coverage

- [x] Included every issue from the 2026-08-08 review.
- [x] Included the other AI’s wizard, admin/listing-detail, opportunistic split and docs-overhead recommendations.
- [x] Corrected the “wizard is untested” wording: it has E2E coverage but lacks isolated component tests.
- [x] Preserved current project blockers from `MASTER-PLAN.md`/`PROJECT-STATUS.md`.
- [x] Preserved owner decisions: open email/password registration, no regular-user phone gate, no payment/monetisation activation.
- [x] Preserved forward-only migration rule and server-first architecture.
- [x] Added an explicit H1/H2 Human Gate before messaging semantics changes.
- [x] Added fresh verification requirement because the old green snapshot predates later auth edits.

## Scope-risk review

- [x] P0 defects are separated from lower-priority maintainability work.
- [x] Large components are not scheduled for a standalone refactor.
- [x] Hosted/deployment work remains subject to current target-locking, risk, named-gate, and Human Gate rules.
- [x] Documentation cleanup cannot be used to substitute for code verification.

## Current execution interpretation

Do not treat this plan as a second process owner.

For a current issue:

- Superpowers selects and owns the applicable process lifecycle, including brainstorming/planning when needed, systematic debugging, TDD, execution, review, verification, and branch completion.
- Matt Pocock skills deepen diagnosis, domain modeling, architecture/design, code review, or agent-facing writing when useful.
- ECC/platform skills handle specialist security, backend, E2E/Playwright, Supabase, Cloudflare, GitHub, documentation lookup, evals, or similar concerns when useful.
- The canonical GitHub queue determines what is ready next; historical ordering in this plan is context only.
- R0/R1 continue autonomously through required review/verification/CI and may auto-merge.
- R2 may be implemented autonomously but requires H3 before merge.
- R3 protected production/policy/destructive actions require owner involvement.
- When a named gate is active, its mutation scope remains strict even if a neighboring task in this plan looks relevant.