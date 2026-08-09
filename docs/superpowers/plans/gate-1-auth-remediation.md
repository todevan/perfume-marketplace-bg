# Gate 1 — Critical Auth Remediation

## Objective
Repair the lazy-auth regression without reverting the performance optimization.

## Root cause
Route access requirements and route auth-data requirements are currently conflated.

## Required architecture
Keep authorization policy separate from data requirements.

Required data vocabulary must be able to represent:
- user
- profile
- beta access/membership
- AAL

Required behavior:
- `/onboarding`: authenticated + profile + beta access
- `/login`: public; authenticated users must get enough beta state for correct redirect
- `/auth/update-password`: authenticated + beta access
- `/auth/mfa`: staff AAL1 + profile + beta access + AAL
- `/admin`: preserve current AAL2 enforcement

## TDD order
- [x] Failing onboarding loader lifecycle test.
- [x] Failing onboarding action lifecycle test.
- [x] Failing active-user `/login` redirect test.
- [x] Failing active-user password recovery redirect test.
- [x] Failing already-AAL2 `/auth/mfa` redirect test.
- [x] Failing authenticated-public-navigation regression test.
- [x] Rewrite the `/onboarding` lazy-load contract that currently codifies the bug.
- [x] Implement explicit auth-data requirements.
- [x] Reconcile affected route consumers without removing defensive guards.
- [x] Run focused auth suite.
- [x] Run full available verification.

## Forbidden fixes
- Do not special-case `/onboarding` in the hook as the architectural solution.
- Do not globally load profile/membership/AAL on every request.
- Do not weaken route authorization.
- Do not weaken AAL2.
- Do not mock away hook → route interaction in the decisive lifecycle tests.

## Acceptance criteria
- [x] Newly confirmed/pending user reaches onboarding.
- [x] Onboarding receives profile + beta state in loader and action.
- [x] Active beta user visiting `/login` goes to intended safe destination.
- [x] Active beta user after password recovery does not go to onboarding.
- [x] AAL2 staff visiting `/auth/mfa` redirects correctly.
- [x] `/admin` still enforces AAL2.
- [x] Active authenticated public navigation is correct.
- [x] Anonymous public routes remain lazy.
- [x] Focused tests green.
- [x] Full available verification green.

## Execution Record
**Status:** PASS

**Branch / SHA:** `main` / `fb3e644615c6bbe4895142d6fc4fabbce00e853f`

Gate 1 was executed directly in the owner-approved protected dirty checkout.
No worktree, commit, stage, push, PR, issue, reset, stash, clean, or Gate 2 work
was performed.

### Files changed

- `src/lib/server/auth/guards.ts` — added the separate declarative
  `routeAuthDataRequirements` contract and single-source public route groups.
- `src/hooks.server.ts` — loads optional auth pieces from route data requirements
  after authoritative `getUser()` succeeds.
- `tests/server/auth-lifecycle-regressions.test.ts` — new hook-to-real-consumer
  lifecycle coverage for onboarding loader/action, login, password update, MFA,
  public layout navigation, technical public routes, and admin AAL2.
- `tests/server/auth-refactor-contract.test.ts` — replaced the assertions that
  codified missing onboarding/login/MFA state; added update-password/logout
  query-shape coverage and a stable static hook import for full-suite execution.
- `docs/testing/AUTH-REFACTOR-CONTRACT.md`
- `docs/testing/AUTH-ROUTE-POLICY-TEST-MATRIX.md`
- `docs/testing/AUTH-REFACTOR-VERIFICATION.md`
- `docs/testing/AUTH-REFACTOR-CODE-REVIEW.md`
- `wrangler.jsonc` — replaced the invalid staging publishable-key JSON object
  with the owner-verified scalar publishable key under the approved pre-Gate-1
  blocker escalation.
- `supabase/config.toml` — moved the local-only Supabase host ports from the
  Windows-excluded `54320–54326` range to the verified-free
  `45320–45326` range; production and staging configuration are unchanged.
- `docs/superpowers/plans/gate-1-auth-remediation.md` — this execution record.

### Tests

- RED: `pnpm vitest run tests/server/auth-lifecycle-regressions.test.ts tests/server/auth-refactor-contract.test.ts`
  produced the expected 9 failures out of 19 tests before the implementation:
  missing onboarding profile/beta state, wrong active-login/password redirects,
  missing MFA AAL, missing public-layout beta state, and conflicting call-count
  contracts.
- Initial GREEN: the same two files passed 19/19; the first expanded focused
  set passed 55/55.
- Final focused server/auth/admin command passed 6 files and 81/81 tests.
- `tests/components/auth-shell.test.ts` passed 6/6 with
  `--pool=threads --maxWorkers=1`; its isolated delay was a roughly 38-second
  Svelte transform, not an assertion failure.
- The full-run auth contract timeout recorded by Gate 0 was traced to the first
  dynamic `hooks.server` import consuming the 5-second test timeout under
  parallel transform load. A static import after hoisted mocks reduced the
  focused test body to 145 ms; the final full run contains no auth timeout.
- The unchanged deployment-hardening contract reproduced the blocker at 12/13,
  then passed 13/13 after the single approved `wrangler.jsonc` correction.
- An extra verification attempt incorrectly ran `pnpm db:lint` concurrently
  with `pnpm db:test`; lint transiently inspected pgTAP helper functions while
  the test transactions had installed the extension. Every pgTAP file rolls
  back, post-run inspection found no retained pgTAP extension/functions, and
  the final canonical sequential run passed lint followed by 185/185 DB tests.

### Existing work reused

- Reused the protected `loadMinimalAuthContext` / `loadAuthPieces` selective
  loading refactor instead of replacing it.
- Kept `RouteAccessPolicy`, `enforceRoutePolicy`, fail-closed route consumers,
  root-layout projection, and `Header.svelte` behavior; the new data contract now
  supplies the state those unchanged consumers already require.
- Preserved existing safe redirects, staff request-boundary checks, and admin
  AAL2 enforcement.

### Verification results

| Command or evidence | Actual result | Decision |
|---|---|---|
| `pnpm exec vitest run tests/server/auth-lifecycle-regressions.test.ts tests/server/auth-refactor-contract.test.ts tests/server/auth-guards-regression.test.ts tests/server/auth-runtime.test.ts tests/server/login-backend-attestation.test.ts tests/server/admin-moderation.test.ts --reporter=verbose --maxWorkers=1` | 6 files passed; 81/81 tests passed. | PASS |
| `pnpm exec vitest run tests/components/auth-shell.test.ts --reporter=verbose --pool=threads --maxWorkers=1` | 1 file passed; 6/6 tests passed. | PASS |
| `pnpm exec vitest run tests/contracts/deployment-hardening.contract.test.ts --reporter=verbose --maxWorkers=1` | 1 file passed; 13/13 tests passed without changing the deployment assertion. | PASS |
| Staging publishable-key structural inspection | `env.staging.vars.PUBLIC_SUPABASE_PUBLISHABLE_KEY` parsed as a scalar string matching `^sb_publishable_`; neither `SUPABASE_SECRET_KEY` nor `SUPABASE_SERVICE_ROLE_KEY` is present. | PASS |
| `pnpm test` | Catalog validation passed; Vitest reported 38/38 files and 322/322 tests passed; Svelte check found 0 errors and 0 warnings; the production Cloudflare build completed. | PASS |
| `pnpm check` | Exit 0; Svelte check found 0 errors and 0 warnings. | PASS |
| `pnpm build` | Exit 0; production SSR/client Cloudflare build completed. | PASS |
| `pnpm db:lint` | Exit 0; the unchanged command discovered `127.0.0.1:45322` from local config and reported no schema errors. | PASS |
| `pnpm db:test` | Exit 0; 6 pgTAP files and 185/185 tests passed through the unchanged command and config discovery. | PASS |
| Docker/local-Supabase diagnostics | Windows persistently excludes the default `54320–54326` local range. The replacement `45320–45329` block was verified free and unexcluded, and `supabase/config.toml` now maps the seven enabled services to `45320–45326`. Normal `supabase stop` backed up local data to the retained Docker volume; normal `supabase start` restored the database and recreated the stack. API `45321`, database `45322`, Studio `45323`, and mail `45324–45326` are published; required containers are healthy and no old `54320–54326` listener remains. | PASS |
| `pnpm test:e2e` | Exit 0; build passed, 13 Playwright tests passed and 5 were skipped. Hosted marketplace and moderator-MFA flows were not executed because the real-run environment was not enabled. | PASS with limitation |
| Protected-tree reconciliation | The approved remediations changed only the publishable-key value inside the already-protected modified `wrangler.jsonc` path and the seven local-only ports in `supabase/config.toml`. Existing invite/SMS configuration edits and all unrelated dirty-tree work remain untouched. | PASS |
| Task review, scoped fix re-reviews, final code/security review | All auth findings remain resolved. Independent final review approved the scalar binding and local-only port remediation, found no privileged-key exposure, data loss, auth regression, production/staging change, or Windows-networking mutation, and approved Gate 1 PASS. | PASS |

### Gate 0 failure ownership

- **Owned and remediated by Gate 1:** missing auth lifecycles and conflicting
  selective-loading contract; the full-run auth contract timeout caused by a
  dynamic import inside the test timeout.
- **Escalated and remediated before Gate 1 re-verification:** the deployment
  contract mismatch nominally owned by Gate 3 provider/runtime verification.
  Master-plan escalation rule 7 permitted the narrow remediation because the
  JSON-object binding would block the repaired signup/auth lifecycle with a
  fail-closed 503.
- **Environment blocker remediated before Gate 1 re-verification:** Windows
  persistently excludes the default local Supabase range. The project-local
  configuration now uses the verified-free `45320–45326` range, and a normal
  backup-preserving stop/start restored the database and healthy host
  publications without changing Windows networking.
- **Verification limitation:** hosted real-user/MFA E2E remains skipped; local
  lifecycle coverage and the available Playwright suite are recorded without
  claiming hosted evidence.

### Acceptance evidence

| Required condition | Verification command or evidence source | Actual result | Decision |
|---|---|---|---|
| Confirmed/pending user reaches onboarding with profile + beta state | `auth-lifecycle-regressions.test.ts` pending-member loader lifecycle | Real `handle` and onboarding loader completed with pending profile/beta context instead of false 403. | PASS |
| Onboarding action has the same required context | Onboarding POST lifecycle | Real `handle` and action received profile/beta, accepted consent/onboarding RPCs, and redirected safely. | PASS |
| Active beta user visiting `/login` bypasses onboarding | Active login lifecycle | Exact 303 redirect to `/messages`, not onboarding. | PASS |
| Active beta user completing password recovery bypasses onboarding | Password-update lifecycle | Exact password update and other-session sign-out calls; exact 303 to `/dashboard`. | PASS |
| Already-AAL2 staff visiting `/auth/mfa` redirects correctly | MFA lifecycle | Current AAL loaded and exact 303 to `/admin`. | PASS |
| `/admin` still requires and enforces AAL2 | Admin lifecycle, auth guards, `admin-moderation.test.ts` | AAL loaded; real admin boundary accepts AAL2 and rejects/redirects insufficient AAL. | PASS |
| Active authenticated public navigation is correct | Legal root-layout lifecycle plus auth-shell component suite | Active beta state reaches layout/Header; marketplace navigation remains visible. | PASS |
| Anonymous public routes avoid unnecessary profile/beta/AAL queries | Anonymous legal lifecycle and technical endpoint cases | `getUser()` only; no profile, beta RPC, or AAL lookup. | PASS |
| No global eager-auth rollback | `routeAuthDataRequirements`, hook inspection, query-shape contract tests | Optional pieces load only for authenticated users and declared route needs. | PASS |
| No `/onboarding` imperative hook special case | Final source inspection and independent review | Hook consumes the declarative data contract; no onboarding pathname branch exists there. | PASS |
| Focused auth tests green | Final 81-test focused command and 6 auth-shell component tests | 87/87 relevant tests passed. | PASS |
| Full available verification green | Focused commands plus `pnpm test`, `pnpm check`, `pnpm build`, `pnpm db:lint`, `pnpm db:test`, and `pnpm test:e2e` | Focused auth tests passed 87/87; deployment contract passed 13/13; canonical tests passed 322/322; check reported 0 errors/warnings; build completed; DB lint reported no schema errors; DB tests passed 185/185; available E2E passed 13 with 5 hosted/mobile skips explicitly recorded. | PASS |

### Findings and residual risk

- The separate authorization/data-requirement architecture is implemented and
  independently approved; no escalation condition required AAL2, RLS, or
  fail-closed weakening.
- The escalated deployment blocker is remediated: the staging publishable key
  is a scalar string, the unchanged contract passes, and no privileged Supabase
  key was added to committed vars.
- DB lint and pgTAP evidence are now available through the unchanged canonical
  commands after the local-only port remediation and data-preserving lifecycle
  reconciliation.
- `pnpm db:lint` and `pnpm db:test` must remain sequential because the latter
  creates pgTAP inside test transactions; concurrent execution can expose that
  temporary extension to the linter.
- Hosted lifecycle evidence remains unavailable in this environment.
- Local development uses the repository-configured `45320–45326` range because
  Windows excludes the default range on this machine; this has no production or
  staging configuration impact.
- No post-beta-hardening item was entered or implemented.

### Gate decision

**PASS**

**Reason:** Every Gate 1 auth behavior and architecture criterion has fresh
passing evidence. The escalated deployment contract remains fixed, canonical
tests pass 322/322, database lint is clean, pgTAP passes 185/185, check/build
pass, and the available E2E suite passes 13 tests with 5 hosted/mobile skips
explicitly retained as a later hosted-verification limitation. Independent
final review found no correctness, security, data-preservation, or scope issue.
Gate 2 is eligible to begin but was not started.


## Canonical verification commands

```bash
pnpm test
pnpm check
pnpm build
pnpm db:lint
pnpm db:test
pnpm test:e2e
```

Record PASS / FAIL / NOT RUN for each command used by this gate.
