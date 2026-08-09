# Gate 2 — Registration Turnstile

## Objective
Ensure public registration cannot reach Supabase `auth.signUp()` without successful Turnstile verification bound to the `register` action.

## Primary files
- `src/routes/login/+page.svelte`
- `src/routes/login/+page.server.ts`
- existing Turnstile helper/tests

## TDD order
- [x] Add missing-token registration test; assert `signUp()` is never called.
- [x] Run and confirm expected failure.
- [x] Add invalid-token registration test; assert `signUp()` is never called.
- [x] Run and confirm expected failure.
- [x] Add valid-token contract coverage.
- [x] Render Turnstile in register mode with `data-action="register"`.
- [x] Verify server Turnstile action `register` before `signUp()`.
- [x] Run registration tests.
- [x] Run existing login Turnstile tests.
- [x] Run Svelte check/build/relevant E2E.

## Invariants
- Missing challenge fails closed.
- Invalid challenge fails closed.
- Verification occurs before signup.
- Login Turnstile continues to use its correct login action.
- Safe redirects remain unchanged.
- Age validation remains unchanged.

## Acceptance criteria
- [x] Register UI contains action-bound Turnstile.
- [x] Missing token cannot call `signUp()`.
- [x] Invalid token cannot call `signUp()`.
- [x] Valid verified request can reach existing signup logic.
- [x] Existing login flow remains green.

## Execution Record
**Status:** COMPLETE

**Execution date:** 2026-08-09

**Branch:** `main`

**Baseline HEAD:** `fb3e644615c6bbe4895142d6fc4fabbce00e853f`

### Scope reconciliation

- Gate 1 records PASS and its owner-approved auth remediation remains protected.
- The pre-Gate-2 working tree was already dirty. Existing public email/password registration, auth-context work, tests, documentation, deployment configuration, and local Supabase port mapping were treated as protected owner work.
- The existing registration action, shared server-only Turnstile verifier, login challenge, safe-next handling, validation, age confirmation, and demo behavior were reused rather than reimplemented.
- Local Supabase ports remain `45320`-`45326`. Gate 2 did not change Supabase, Wrangler, hosted-provider, migration, RLS, service-role, or secret configuration.
- Gate 3 bounded public-form parsing was not implemented. The registration and login actions continue to use their existing parsing until Gate 3.
- No worktree, commit, push, pull request, issue, reset, stash, clean, deployment, or remote mutation was performed.

### Files changed by Gate 2

- `src/routes/login/+page.server.ts`
- `src/routes/login/+page.svelte`
- `tests/server/login-backend-attestation.test.ts`
- `tests/components/registration-turnstile.test.ts`
- `docs/superpowers/plans/gate-2-registration-turnstile.md` (this execution record)

### TDD and debugging evidence

1. Server RED: `pnpm exec vitest run tests/server/login-backend-attestation.test.ts --reporter=verbose --maxWorkers=1` failed with 1 failing and 7 passing tests. The missing-token registration reached the pre-existing `signUp()` call, demonstrating the absent server boundary before the production change.
2. Server GREEN: after adding the smallest server guard, the focused server/auth run passed 2 files and 27 tests. Missing and wrong-action challenges return before Supabase resolution or `signUp()`; verified requests retain the existing signup path.
3. Client RED: the initial component contract found zero registration widgets after switching the real page from login to registration.
4. Client GREEN: rendering a registration host made the focused component contract pass.
5. Task review found the implicit widget approach was unreliable for dynamically inserted content. Systematic debugging against Cloudflare's documented client-rendering model established that explicit rendering is required for conditional/dynamic content.
6. Explicit-lifecycle RED: a controlled `window.turnstile.render` assertion failed with 0 calls against the implicit implementation.
7. Explicit-lifecycle GREEN: the page now loads `?render=explicit`, removes the old widget, and renders the active mode with the correct `login` or `register` action; the focused component test passed 1/1.
8. The first broad `pnpm test` completed 325/325 Vitest assertions but exposed an incomplete typed component fixture during Svelte checking. The test-only fixture was reconciled with inherited root-layout data and `form: null`; fresh focused and complete canonical verification then passed.

### Acceptance evidence

| Required condition | Verification command or evidence source | Actual result | Decision |
|---|---|---|---|
| Register UI renders a Turnstile challenge bound to `register` | `tests/components/registration-turnstile.test.ts`; focused component run | Controlled explicit lifecycle observed the initial `login` render, removal, and replacement `register` render; exactly one action-specific host remained | PASS |
| Missing token cannot reach `auth.signUp()` | `tests/server/login-backend-attestation.test.ts`; focused server/auth run | Missing response returned 400 and the `signUp` spy was not called | PASS |
| Invalid token cannot reach `auth.signUp()` | Wrong-action route contract plus rejected/expired shared-verifier cases in `tests/server/auth-runtime.test.ts` | Wrong action and unsuccessful verification failed closed before `signUp()` | PASS |
| Valid verified registration reaches the existing signup path | Verified signup and immediate-session registration contracts | Existing normalized email, metadata, confirmation URL, membership claim, sign-out, and redirect behavior passed | PASS |
| Login Turnstile remains intact | Focused server/auth and component runs | Server still requires action `login`; client initially renders action `login`; existing login cases passed | PASS |
| Safe redirects and registration validation remain intact | Focused registration contracts, full unit suite, independent source review | Existing validation, age check, safe-next confirmation URL, demo redirect, and post-signup behavior remain in their established order | PASS |
| Focused and broader available tests are green | Complete command table below | Every required local command passed on the final production/test tree | PASS |

### Fresh final verification

| Command | Actual result | Decision |
|---|---|---|
| `pnpm exec vitest run tests/server/login-backend-attestation.test.ts tests/server/auth-runtime.test.ts --reporter=verbose --maxWorkers=1` | 2 files passed; 27/27 tests passed | PASS |
| `pnpm exec vitest run tests/components/registration-turnstile.test.ts --reporter=verbose --pool=threads --maxWorkers=1` | 1 file passed; 1/1 test passed | PASS |
| `pnpm test` | Catalog validation passed; 39/39 Vitest files and 325/325 tests passed; Svelte check reported 0 errors and 0 warnings; production Cloudflare build completed | PASS |
| `pnpm check` | Svelte check reported 0 errors and 0 warnings | PASS |
| `pnpm build` | Production Cloudflare build completed | PASS |
| `pnpm db:lint` | Completed with no schema errors | PASS |
| `pnpm db:test` | 6 pgTAP files passed; 185/185 tests passed | PASS |
| `pnpm test:e2e` | 13 passed; 5 skipped; command exited 0 | PASS with skips recorded |
| `git diff --check` | No whitespace errors; only existing line-ending warnings | PASS |

### Independent review

- Server task review: specification PASS and code quality APPROVED; no findings.
- Client task review: one Important finding identified the implicit-rendering lifecycle gap. The explicit render/remove fix received a clean scoped re-review.
- Final whole-gate code/security review: no Critical, Important, or Minor findings; **APPROVE Gate 2 PASS**.
- The final reviewer confirmed fail-closed ordering, exact action binding, preserved login/signup behavior, client cleanup, no secret/service-role exposure, no protected configuration drift, and no Gate 3 implementation.

### Residual hosted/staging limitations

- The component test uses a controlled Turnstile API; it does not load Cloudflare's networked widget in JSDOM.
- The E2E command passed, but five scenarios were skipped: hosted-real marketplace/auth/MFA scenarios were not enabled, and the existing mobile overflow case is intentionally skipped.
- No pre-existing hosted-real registration journey was available to extend. Actual Cloudflare provider behavior, deployed hostname configuration, and a real registration challenge remain staging verification work. They are explicitly not claimed as verified and are not Gate 2 blockers under the approved plan.

### Gate decision
**PASS**

Every Gate 2 acceptance criterion has fresh final-state evidence. Gate 3 is eligible to begin but has not been started; owner approval is required before proceeding.


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
