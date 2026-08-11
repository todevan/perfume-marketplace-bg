# A7 Turnstile Testing-Key Reconciliation Implementation Plan

> Follow-up status (2026-08-11): this plan records the first remediation attempt.
> The live provider receipt and durable workflow requirements are governed by the
> 2026-08-11 addendum in the companion design document; that addendum supersedes
> this plan's original receipt-shape and allowed-file assumptions where they conflict.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile Cloudflare's official always-pass Turnstile testing receipt with staging while preserving strict action and hostname validation everywhere else.

**Architecture:** Keep `verifyTurnstile` environment-agnostic and add an explicit default-false capability for accepting Cloudflare's exact dummy testing receipt. `verifyTurnstileForAction` is the only application boundary allowed to enable that capability, and only for the exact approved staging/testing credential triple.

**Tech Stack:** TypeScript, SvelteKit, Vitest, Cloudflare Turnstile, pnpm, Wrangler.

## Global Constraints

- A7 remediation only.
- Do not reopen A6.
- Do not enter A8.
- Do not modify migrations or hosted database state.
- Do not modify production configuration.
- Do not deploy during implementation.
- Do not set `UPLOAD_CLEANUP_SECRET`.
- Keep canonical staging on the known fail-closed Worker until a new exact-SHA candidate is separately approved.
- Production Turnstile validation must remain strict.
- Testing mode requires all three exact conditions:
  - `appEnvironment === "staging"`
  - `PUBLIC_TURNSTILE_SITE_KEY === "1x00000000000000000000AA"`
  - `TURNSTILE_SECRET_KEY === "1x0000000000000000000000000000000AA"`
- `verifyTurnstile` receives `acceptCloudflareTestingReceipt?: boolean`.
- The capability defaults to false.
- `verifyTurnstileForAction` is the only boundary allowed to enable it.
- Only the exact dummy receipt is accepted in testing mode:
  - `success === true`
  - `action === "test"`
  - `hostname === "localhost"`
- Any other receipt remains rejected.
- No real login, registration, report, upload, or DB mutation is required.

## File Structure

**Modify only:**
- `src/lib/server/auth/turnstile.ts`
- `tests/server/auth-runtime.test.ts`

**Must not modify:**
- `src/lib/server/env.ts`
- `src/routes/login/**`
- `src/routes/report/**`
- `wrangler.jsonc`
- `.github/workflows/**`
- `package.json`
- `pnpm-lock.yaml`
- `supabase/**`

The runtime already exposes the required four values:
`appEnvironment`, `publicTurnstileSiteKey`, `turnstileSecretKey`, and
`turnstileExpectedHostname`.

---

### Task 1: Define low-level testing-receipt semantics

**Files:**
- Modify: `tests/server/auth-runtime.test.ts`
- Modify: `src/lib/server/auth/turnstile.ts`

**Interfaces:**
- Consumes: existing `verifyTurnstile(options)`
- Produces: `acceptCloudflareTestingReceipt?: boolean`
- Default: false

- [ ] **Step 1: Add the Siteverify test helper**

Add near the existing Turnstile tests:

```ts
const TURNSTILE_DUMMY_RESPONSE = 'dummy-response-value';

function siteverifyFetcher(payload: Record<string, unknown>): typeof fetch {
    return vi.fn(async () =>
        new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        })
    ) as unknown as typeof fetch;
}
```

- [ ] **Step 2: Add failing tests**

Add coverage proving:

```ts
it('accepts the exact Cloudflare dummy receipt only when explicitly enabled', async () => {
    const fetcher = siteverifyFetcher({
        success: true,
        action: 'test',
        hostname: 'localhost'
    });

    await expect(
        verifyTurnstile({
            token: TURNSTILE_DUMMY_RESPONSE,
            secretKey: 'testing-secret',
            expectedAction: 'login',
            expectedHostname: 'staging.example',
            acceptCloudflareTestingReceipt: true,
            fetch: fetcher
        })
    ).resolves.toEqual({ success: true });
});
```

And:

```ts
it('keeps the Cloudflare dummy receipt rejected by default', async () => {
    const fetcher = siteverifyFetcher({
        success: true,
        action: 'test',
        hostname: 'localhost'
    });

    await expect(
        verifyTurnstile({
            token: TURNSTILE_DUMMY_RESPONSE,
            secretKey: 'testing-secret',
            expectedAction: 'login',
            expectedHostname: 'staging.example',
            fetch: fetcher
        })
    ).resolves.toMatchObject({
        success: false,
        reason: 'rejected'
    });
});
```

Also add negative cases for:

- wrong dummy action;
- wrong dummy hostname;
- unsuccessful dummy receipt;
- normal response with wrong expected hostname.

- [ ] **Step 3: Verify RED**

Run:

```powershell
pnpm exec vitest run tests/server/auth-runtime.test.ts
```

Expected: the new acceptance case fails before implementation.

- [ ] **Step 4: Add minimal low-level implementation**

Extend the `verifyTurnstile` options type with:

```ts
acceptCloudflareTestingReceipt?: boolean;
```

After parsing Siteverify:

```ts
const isCloudflareTestingReceipt =
    options.acceptCloudflareTestingReceipt === true &&
    result.success === true &&
    result.action === 'test' &&
    result.hostname === 'localhost';

if (isCloudflareTestingReceipt) {
    return { success: true };
}
```

Then retain the existing strict action/hostname success condition and existing
failure/error-code behavior.

`verifyTurnstile` must not inspect runtime environment variables itself.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
pnpm exec vitest run tests/server/auth-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Only these paths may be modified:

```text
src/lib/server/auth/turnstile.ts
tests/server/auth-runtime.test.ts
```

Run:

```powershell
git diff --check
git add -- src/lib/server/auth/turnstile.ts tests/server/auth-runtime.test.ts
git diff --cached --check
git commit -m "test: define Turnstile testing receipt semantics"
```

---

### Task 2: Gate testing mode at the application boundary

**Files:**
- Modify: `tests/server/auth-runtime.test.ts`
- Modify: `src/lib/server/auth/turnstile.ts`

**Interfaces:**
- Consumes: Task 1 capability.
- Produces: exact three-condition staging predicate.
- Keeps `verifyTurnstileForAction` public signature unchanged.

- [ ] **Step 1: Import the application boundary**

Update the Turnstile test import:

```ts
import {
    verifyTurnstile,
    verifyTurnstileForAction
} from '../../src/lib/server/auth/turnstile';
```

Import the runtime type:

```ts
import {
    getRuntimeConfiguration,
    RuntimeConfigurationError,
    type ProductionRuntimeConfiguration
} from '../../src/lib/server/env';
```

- [ ] **Step 2: Add test constants**

```ts
const CLOUDFLARE_ALWAYS_PASS_TEST_SITE_KEY =
    '1x00000000000000000000AA';

const CLOUDFLARE_ALWAYS_PASS_TEST_SECRET_KEY =
    '1x0000000000000000000000000000000AA';

const STAGING_TURNSTILE_HOST =
    'perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev';
```

Add helpers creating:

- a staging `ProductionRuntimeConfiguration`;
- `FormData` with `cf-turnstile-response`;
- a minimal event containing mocked `fetch` and `getClientAddress`.

- [ ] **Step 3: Add failing boundary tests**

Cover all three logical actions:

```ts
it.each(['login', 'register', 'report_submit'])(
    'accepts the official dummy receipt for %s only in the exact staging testing runtime',
    async (expectedAction) => {
        // call verifyTurnstileForAction
        // expect { success: true }
    }
);
```

Add three negative tests changing one gate value at a time:

```text
APP_ENV != staging
PUBLIC_TURNSTILE_SITE_KEY != official testing sitekey
TURNSTILE_SECRET_KEY != official testing secret
```

Each must produce:

```ts
{
    success: false,
    reason: 'rejected'
}
```

- [ ] **Step 4: Verify RED**

Run:

```powershell
pnpm exec vitest run tests/server/auth-runtime.test.ts
```

Expected: Task 1 remains green; boundary acceptance still fails.

- [ ] **Step 5: Add private server constants**

In `src/lib/server/auth/turnstile.ts`:

```ts
const CLOUDFLARE_ALWAYS_PASS_TEST_SITE_KEY =
    '1x00000000000000000000AA';

const CLOUDFLARE_ALWAYS_PASS_TEST_SECRET_KEY =
    '1x0000000000000000000000000000000AA';
```

Do not export them.

- [ ] **Step 6: Add exact private predicate**

```ts
function acceptsCloudflareTestingReceipt(
    runtime: ProductionRuntimeConfiguration
): boolean {
    return (
        runtime.appEnvironment === 'staging' &&
        runtime.publicTurnstileSiteKey === CLOUDFLARE_ALWAYS_PASS_TEST_SITE_KEY &&
        runtime.turnstileSecretKey === CLOUDFLARE_ALWAYS_PASS_TEST_SECRET_KEY
    );
}
```

Do not add `turnstileExpectedHostname` as a fourth gate.

- [ ] **Step 7: Enable capability only in `verifyTurnstileForAction`**

Extend its existing `verifyTurnstile` call with:

```ts
acceptCloudflareTestingReceipt:
    acceptsCloudflareTestingReceipt(runtime)
```

Do not change route call sites.

- [ ] **Step 8: Verify GREEN**

Run:

```powershell
pnpm exec vitest run tests/server/auth-runtime.test.ts
pnpm exec vitest run tests/components/registration-turnstile.test.ts
```

Expected: PASS.

- [ ] **Step 9: Scope check**

Only implementation files allowed:

```text
src/lib/server/auth/turnstile.ts
tests/server/auth-runtime.test.ts
```

Run:

```powershell
git diff --check
git status --short
```

- [ ] **Step 10: Commit Task 2**

```powershell
git add -- src/lib/server/auth/turnstile.ts tests/server/auth-runtime.test.ts
git diff --cached --check
git commit -m "fix: reconcile staging Turnstile testing receipt"
```

---

### Task 3: Full local quality gate

**Files:**
- No new source changes expected.

- [ ] **Step 1: Dependency audits**

```powershell
pnpm audit --prod
pnpm audit --audit-level high
```

Both must exit 0.

- [ ] **Step 2: Repository verification**

Run:

```powershell
pnpm validate:catalog
pnpm test:unit
pnpm test:db:contracts
pnpm check
pnpm test:e2e
pnpm exec wrangler deploy --dry-run --env staging
pnpm exec wrangler deploy --dry-run --env=""
pnpm test
```

Every command must pass.

No deployment is permitted.

- [ ] **Step 3: Review branch scope**

Use:

```powershell
$Base = '2e64870623c8e619eb443f4c546dd32845fd7ac4'

git diff --check $Base..HEAD
git diff --stat $Base..HEAD
git diff --name-only $Base..HEAD
git status --porcelain
```

Branch-level changes may include the approved design and plan docs.

Implementation source changes must remain limited to:

```text
src/lib/server/auth/turnstile.ts
tests/server/auth-runtime.test.ts
```

Working tree must be clean.

- [ ] **Step 4: Capture candidate identity**

```powershell
Write-Host "ImplementationCandidateSHA=$((git rev-parse HEAD).Trim())"
Write-Host "ImplementationCandidateTree=$((git rev-parse 'HEAD^{tree}').Trim())"
Write-Host "WorkingTreeClean=$([string]::IsNullOrWhiteSpace((git status --porcelain)))"
```

- [ ] **Step 5: Stop for implementation review**

Do not push, merge, deploy, or enter A8 yet.

Required receipt:

```text
Branch=
ImplementationCandidateSHA=
ImplementationCandidateTree=
LocalVerification=PASS
WorkingTreeClean=True
DeploymentPerformed=False
ProductionChanged=False
A8Started=False
STOP_HERE=True
```

---

### Task 4: Remote CI review after local implementation approval

**Files:**
- No implementation changes expected.

- [ ] **Step 1: Verify `origin/main` has not moved**

```powershell
git fetch origin main

$ExpectedBase =
    '2e64870623c8e619eb443f4c546dd32845fd7ac4'

$RemoteMain = (git rev-parse origin/main).Trim()

if ($RemoteMain -ne $ExpectedBase) {
    throw "STOP: origin/main moved; reconcile before publishing."
}
```

Do not automatically rebase.

- [ ] **Step 2: Push the remediation branch**

Only after local implementation review approval:

```powershell
git push -u origin codex/gate3-a7-turnstile-testing-reconciliation
```

- [ ] **Step 3: Open an A7-only PR**

The PR must state:

- root cause is Cloudflare testing receipt `test` / `localhost`;
- testing bypass is explicit and default false;
- exact staging/testing triple is required;
- production validation remains strict;
- no DB, dependency, route, Wrangler, workflow, production, or A8 changes;
- merge does not itself authorize staging deployment.

- [ ] **Step 4: Require exact-head GitHub Actions CI**

CI must cover:

- frozen install;
- dependency audits;
- catalogue;
- unit/contract tests;
- DB contracts;
- Svelte checks;
- Playwright;
- staging dry run;
- production dry run;
- database job.

If CI fails, use `superpowers:systematic-debugging`.

- [ ] **Step 5: Stop before merge**

Do not merge automatically.

After review/merge, capture the new merged exact `main` SHA and tree and obtain
a fresh explicit A7 exact-SHA staging deployment approval.

A8 remains separate.

## Verification Invariants

Before implementation is ready for review:

- testing capability defaults false;
- exact dummy receipt requires explicit capability;
- malformed dummy receipt is rejected;
- normal strict action validation remains intact;
- normal strict hostname validation remains intact;
- exact three-condition staging gate is required;
- changing any one gate input disables testing mode;
- `login`, `register`, and `report_submit` are covered;
- existing UI action-binding tests pass;
- no route changes;
- no runtime schema changes;
- no Wrangler/workflow changes;
- no dependency or lockfile changes;
- no database changes;
- no provider deployment;
- no production changes;
- no A8 work;
- full quality gate passes;
- working tree is clean.
