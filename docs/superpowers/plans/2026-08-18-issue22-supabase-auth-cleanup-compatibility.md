# Issue 22 Supabase Auth Cleanup Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Issue 22 hosted cleanup accept Supabase's observed safe-disabled Auth normalization without weakening any effective security or credential checks.

**Architecture:** Keep the change inside the existing `assertSafeDisabledAuth()` boundary in `scripts/issue22-hosted/operator-lib.mjs`. Preserve `clearAuthSafely()`, the nullable OpenAPI schema guard, the credential-clear PATCH, and all existing Auth/public-settings checks; only stop requiring the inert `security_captcha_provider` metadata field itself to become null after CAPTCHA is disabled and its secret is cleared.

**Tech Stack:** Node.js 22, TypeScript tests with Vitest, Supabase Management API compatibility behavior already observed on project `zzrrutwlrkhevellwork`.

## Global Constraints

- Work on branch `issue-22-open-registration` for PR #33.
- Before editing, fast-forward the local worktree to the current remote branch; do not reset, delete, or modify ignored recovery files under `scripts/issue22-hosted/private`.
- Use TDD: add the regression assertion first, run it and observe RED, then change production code.
- Do not weaken `assertAuthState()`.
- Do not remove `security_captcha_provider: null` from `buildAuthCredentialClearPatch()`; the operator should continue requesting credential/provider clearing even though Supabase currently normalizes the provider metadata back to a value.
- Do not weaken `assertNullableAuthUpdateSchema()`.
- A retained CAPTCHA secret, enabled CAPTCHA, retained SMTP credential, enabled signup, or other Auth/public-settings drift must still fail closed.
- Do not run `hosted-cleanup` or `hosted-execute` during this repair.
- Commit the production repair as `fix(issue22): accept provider-normalized disabled captcha metadata`.

---

## File Structure

- Modify `tests/scripts/issue22-hosted-operator.test.ts`: add the exact provider-normalization regression and strengthen negative assertions around retained secret/effective CAPTCHA state.
- Modify `scripts/issue22-hosted/operator-lib.mjs`: minimally relax only the inert provider-metadata null requirement inside `assertSafeDisabledAuth()`.

### Task 1: Accept inert provider metadata while preserving effective Auth safety

**Files:**
- Modify: `tests/scripts/issue22-hosted-operator.test.ts` in `describe('issue-22 hosted Auth attestation')`, test `uses nullable credential clearing after independently disabling signup`
- Modify: `scripts/issue22-hosted/operator-lib.mjs` in `assertSafeDisabledAuth(auth, publicSettings)`

**Interfaces:**
- Consumes: `assertSafeDisabledAuth(auth: Record<string, any>, publicSettings: Record<string, any>): void`
- Produces: the same public function and signature; behavior changes only for a non-null `security_captcha_provider` when CAPTCHA is disabled and secret/SMTP credentials are cleared.

- [ ] **Step 1: Synchronize the existing Issue 22 worktree without touching recovery state**

Run:

```powershell
Set-Location -LiteralPath 'C:\Users\Admin\Documents\Сайт парфюми.worktrees\issue-22-open-registration'
git status --porcelain --untracked-files=no
git fetch origin issue-22-open-registration
git merge --ff-only origin/issue-22-open-registration
git status --porcelain --untracked-files=no
```

Expected:

- both status commands print no tracked changes;
- the branch fast-forwards to the remote planning commits;
- ignored files under `scripts/issue22-hosted/private` remain present and untouched.

- [ ] **Step 2: Add the failing Supabase normalization regression test**

In the existing `uses nullable credential clearing after independently disabling signup` test, keep the current safe `auth` and `settings` fixtures and add these assertions after the existing safe baseline assertion:

```ts
expect(() => assertSafeDisabledAuth(
	{ ...auth, security_captcha_provider: 'turnstile' },
	settings
)).not.toThrow();

expect(() => assertSafeDisabledAuth(
	{ ...auth, security_captcha_provider: 'turnstile', security_captcha_secret: 'retained-secret' },
	settings
)).toThrow(/baseline/i);

expect(() => assertSafeDisabledAuth(
	{ ...auth, security_captcha_provider: 'turnstile', security_captcha_enabled: true },
	settings
)).toThrow(/Auth/i);
```

Keep the existing retained-SMTP negative assertion:

```ts
expect(() => assertSafeDisabledAuth({ ...auth, smtp_host: 'smtp.example' }, settings)).toThrow(/baseline/i);
```

Do not change the expected value of `buildAuthCredentialClearPatch()`; it must continue to include:

```ts
security_captcha_enabled: false,
security_captcha_provider: null,
security_captcha_secret: null,
```

- [ ] **Step 3: Run only the new Auth attestation test and verify RED**

Run:

```powershell
pnpm exec vitest run tests/scripts/issue22-hosted-operator.test.ts -t "uses nullable credential clearing after independently disabling signup"
```

Expected: FAIL specifically because `assertSafeDisabledAuth()` currently rejects `security_captcha_provider: 'turnstile'` even though CAPTCHA is disabled and its secret is cleared. The retained-secret and enabled-CAPTCHA negative assertions should already reject.

If the provider-normalization assertion unexpectedly passes before production code changes, stop and re-inspect the current branch rather than changing code.

- [ ] **Step 4: Make the minimal production change**

Current `assertSafeDisabledAuth()` contains a `cleared()` helper and rejects both provider and secret metadata. Change only the final credential-clearing condition from the effective shape:

```js
if (
	!cleared('security_captcha_provider') ||
	!cleared('security_captcha_secret') ||
	['smtp_admin_email', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_sender_name']
		.some((key) => !cleared(key))
) {
	throw new Error('safe disabled Auth baseline mismatch');
}
```

to:

```js
if (
	!cleared('security_captcha_secret') ||
	['smtp_admin_email', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_sender_name']
		.some((key) => !cleared(key))
) {
	throw new Error('safe disabled Auth baseline mismatch');
}
```

Do not change the preceding call:

```js
assertAuthState(auth, publicSettings, { open: false, captcha: false });
```

That call is what continues to prove signup disabled, CAPTCHA disabled, email-only Auth, anonymous disabled, confirmation behavior, and exact site URL.

- [ ] **Step 5: Rerun the targeted test and verify GREEN**

Run:

```powershell
pnpm exec vitest run tests/scripts/issue22-hosted-operator.test.ts -t "uses nullable credential clearing after independently disabling signup"
```

Expected: PASS. Specifically:

- retained provider metadata + disabled CAPTCHA + cleared secret/SMTP passes;
- retained CAPTCHA secret fails;
- enabled CAPTCHA fails;
- retained SMTP fails.

- [ ] **Step 6: Run the full Issue 22 operator unit suite**

Run:

```powershell
pnpm exec vitest run tests/scripts/issue22-hosted-operator.test.ts
```

Expected: PASS with no failing Issue 22 operator tests.

- [ ] **Step 7: Review the diff for scope and recovery safety**

Run:

```powershell
git --no-pager diff -- scripts/issue22-hosted/operator-lib.mjs tests/scripts/issue22-hosted-operator.test.ts
git status --short
```

Expected:

- only the two intended tracked files are modified for this repair;
- no file under `scripts/issue22-hosted/private` is staged or modified;
- no Cloudflare, Supabase, database, or hosted mutation has been run.

- [ ] **Step 8: Commit Repair 1 only**

Run:

```powershell
git add -- scripts/issue22-hosted/operator-lib.mjs tests/scripts/issue22-hosted-operator.test.ts
git diff --cached --check
git commit -m "fix(issue22): accept provider-normalized disabled captcha metadata"
```

Expected: one bounded commit containing the RED/GREEN regression and minimal assertion change. Do not include Repair 2 in this commit.

- [ ] **Step 9: Record the checkpoint before Repair 2**

Run:

```powershell
git rev-parse HEAD
git status --porcelain --untracked-files=no
```

Expected: a new commit SHA and no tracked worktree changes. Preserve that SHA as the Repair 1 checkpoint for review.