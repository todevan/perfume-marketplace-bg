# Issue #22 Open Registration Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Produce one bounded Issue #22 implementation baseline on exact current main (`313f60fde5c44eded11572ee318771c9b5580127`) without hosted execution, provider mutation, R2 certification, or unrelated Gate 3 work.

**Architecture:** Keep the current server-rendered Supabase SSR flow and existing database authorization model. Reimplement only the missing registration configuration, confirmation claim boundary, Turnstile-to-GoTrue handoff, and meaningful-city invariant. Enforce city validity in both application validation and the database predicates/RPC that define active access; preserve existing consent, suspension/revocation, role, RLS, and staff AAL2 controls.

**Tech Stack:** SvelteKit 2 / Svelte 5, TypeScript, Zod, Supabase Auth/Postgres migrations, pgTAP, Vitest.

**Spec:** `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md`

## Global Constraints

- Work only in `issue-22-open-registration-reconcile` from the recorded start SHA.
- Do not deploy, mutate hosted services, close Issue #22, start Checkpoint 22B, run the complete R2 certification matrix, or touch Issue #25/Gate 3 Task 9/10.
- Never hard-reset, clean, overwrite unknown files, rewrite an applied migration, weaken RLS/auth/MFA, or use service-role access as a generic workaround.
- Use strict RED/GREEN evidence for each behavior repair. A test that errors for environmental reasons is not RED.
- Keep `SECURITY DEFINER` functions fail-closed with `search_path = ''`, explicit privilege revocation/grants, ownership checks, and existing suspension/revocation/current-consent checks.
- Commit each task with a conventional commit and no AI attribution.

## PR #33 Reconciliation Map

### KEEP from current main

- `public.claim_open_registration`: creates pending membership for confirmed direct email/password users; existing suspended/revoked memberships remain unchanged.
- Current consent truth: onboarding completion requires every current `required_for_access` legal document; RLS exposes only effective, non-retired current documents.
- Privileged profile-column trigger/RLS: authenticated users cannot self-escalate role or account privilege.
- Staff route guard: staff/admin authorization still requires AAL2 through `requireMfa`.
- Phone, anonymous signup, and SMS signup remain disabled.

### REIMPLEMENT from PR #33 against current main

- Enable email/password signup while retaining required email confirmation and disabled phone/anonymous signup.
- Configure local Auth Turnstile and confirmation email template; pass the registration token to `auth.signUp` rather than consuming it in the application first.
- Treat a successful token-hash `type=email` verification as the registration-confirmation boundary that claims pending membership.
- Require a meaningful, normalized city in onboarding and profile updates.
- Make database activation and `private.is_active_beta_user` fail closed for null/blank/control-only/punctuation-only or otherwise malformed cities.
- Add targeted tests for configuration, confirmation, captcha handoff, city validation, hostile state preservation, role non-escalation, and AAL2 preservation.

### DROP or defer

- PR #33 hosted runners, operator scripts, provider checks, rollback artifacts, screenshots, status updates, and PR/issue workflow documentation.
- Old Gate 3 deletions or replacements, Issue #25 changes, profile redesign, social login, phone/SMS features, merchant/payment changes, and unrelated refactors.
- Local full-journey browser proof, full R2 certification, CI matrix expansion, deployment, and hosted verification are Checkpoint 22B or later—not this checkpoint.

---

## Task 1: Reconcile registration configuration and confirmation boundary

**Files:**
- Modify: `.env.example`
- Modify: `supabase/config.toml`
- Create: `supabase/templates/confirmation.html`
- Modify: `src/routes/login/+page.server.ts`
- Modify: `src/routes/auth/confirm/+server.ts`
- Create: `tests/contracts/open-registration-config.contract.test.ts`
- Create: `tests/server/auth-confirm.test.ts`
- Modify: `tests/server/login-backend-attestation.test.ts`

### Step 1: Write failing contract and server tests

Add tests that prove:

```ts
expect(config.auth.enable_signup).toBe(true);
expect(config.auth.email.enable_signup).toBe(true);
expect(config.auth.email.enable_confirmations).toBe(true);
expect(config.auth.sms.enable_signup).toBe(false);
expect(config.auth.enable_anonymous_sign_ins).toBe(false);
expect(config.auth.captcha.provider).toBe('turnstile');
expect(config.auth.email.template.confirmation.content_path).toBe('./supabase/templates/confirmation.html');
```

The template contract must require `TokenHash`, `RedirectTo`, and `type=email`, and reject the obsolete `PRIVATE_BETA_REQUIRE_INVITE` environment setting.

The registration action test must prove that `captchaToken` is supplied to `supabase.auth.signUp({ options: { captchaToken, data } })` and that the application does not pre-consume the same token through `event.fetch`.

The confirmation tests must prove that valid `token_hash` + `type=email`:

```ts
await supabase.auth.verifyOtp({ token_hash, type: 'email' });
await supabase.rpc('claim_open_registration');
```

and that invalid verification never claims, claim failure signs the user out, and an external `next` URL is sanitized.

### Step 2: Run the focused tests and capture RED

Run:

```bash
pnpm exec vitest run tests/contracts/open-registration-config.contract.test.ts tests/server/auth-confirm.test.ts tests/server/login-backend-attestation.test.ts
```

Expected: assertion failures for disabled signup/missing template, missing registration captcha handoff, and missing `type=email` claim.

### Step 3: Implement the minimum behavior

In `supabase/config.toml`, enable only normal email/password signup, retain confirmations, disabled SMS/anonymous signup, and add:

```toml
[auth.captcha]
enabled = true
provider = "turnstile"

[auth.email.template.confirmation]
subject = "Потвърдете регистрацията си в Ароматика"
content_path = "./supabase/templates/confirmation.html"
```

Reference the local `LOCAL_AUTH_CAPTCHA_TEST_KEY` environment variable as the captcha secret without recording a credential value.

Create a Bulgarian confirmation template whose link appends `token_hash={{ .TokenHash }}&type=email` to `.RedirectTo`.

In the register action, remove the application-side Turnstile verification for registration only, require the submitted token, and pass it as `options.captchaToken` to `auth.signUp`. Keep the login-side Turnstile check unchanged.

In the confirm handler, claim open registration after successful verification for both `signup` and `email` token types. Keep failure sign-out and safe redirect behavior.

### Step 4: Run focused tests and capture GREEN

Run the Step 2 command. Expected: all listed files/tests pass.

### Step 5: Commit

```bash
git add .env.example supabase/config.toml supabase/templates/confirmation.html src/routes/login/+page.server.ts src/routes/auth/confirm/+server.ts tests/contracts/open-registration-config.contract.test.ts tests/server/auth-confirm.test.ts tests/server/login-backend-attestation.test.ts
git commit -m "fix(auth): reconcile open registration confirmation"
```

---

## Task 2: Enforce meaningful city in application flows

**Files:**
- Modify: `src/lib/contracts/profiles.ts`
- Modify: `src/routes/onboarding/+page.server.ts`
- Modify: `src/routes/settings/profile/+page.server.ts`
- Modify: `src/routes/settings/profile/+page.svelte`
- Modify: `tests/server/auth-lifecycle-regressions.test.ts`
- Modify: `tests/contracts/production-data-contracts.test.ts`

### Step 1: Write failing application tests

Add cases that reject blank, whitespace/control-only, punctuation-only, and unsupported-character cities before consent or onboarding RPCs are called. Add cases that normalize surrounding ASCII spaces and accept meaningful Bulgarian/Latin alphanumeric names with spaces, hyphens, or apostrophes.

The shared contract must expose one schema:

```ts
export const cityInputSchema = z
  .string()
  .transform((value) => value.replace(/^ +| +$/gu, ''))
  .pipe(
    z
      .string()
      .min(2, 'City must be at least 2 characters')
      .max(100, 'City must be at most 100 characters')
      .refine(
        (value) => /[\p{L}\p{N}]/u.test(value) && /^[-\p{L}\p{N} ']+$/u.test(value),
        'Enter a valid city or location'
      )
  );
```

`updateProfileInputSchema.city` must use this schema and no longer accept `null`/blank input for an active account.

### Step 2: Run the focused tests and capture RED

```bash
pnpm exec vitest run tests/server/auth-lifecycle-regressions.test.ts tests/contracts/production-data-contracts.test.ts
```

Expected: the new city assertions fail against the nullable/current length-only behavior.

### Step 3: Implement shared validation and wire both entry points

- Parse raw onboarding city with `cityInputSchema.safeParse`; return its validation message before recording consents or calling onboarding.
- Pass the normalized parsed city to the RPC.
- Pass raw settings form city to the shared profile-update schema rather than converting blank to `null`.
- Add the HTML `required` attribute to the profile city input; do not redesign the form.

### Step 4: Validate Svelte syntax

Run the Svelte autofixer for `src/routes/settings/profile/+page.svelte` with Svelte 5 and apply any required fixes before tests.

### Step 5: Run focused tests and capture GREEN

Run the Step 2 command and `pnpm exec svelte-check --tsconfig ./tsconfig.json`. Expected: all pass.

### Step 6: Commit

```bash
git add src/lib/contracts/profiles.ts src/routes/onboarding/+page.server.ts src/routes/settings/profile/+page.server.ts src/routes/settings/profile/+page.svelte tests/server/auth-lifecycle-regressions.test.ts tests/contracts/production-data-contracts.test.ts
git commit -m "fix(onboarding): require a meaningful city"
```

---

## Task 3: Enforce city and hostile-state invariants in Postgres

**Files:**
- Create with Supabase CLI: `supabase/migrations/<timestamp>_require_meaningful_city_for_active_onboarding.sql`
- Create: `supabase/tests/issue22_open_registration_activation.pgtap.sql`

### Step 1: Write the failing pgTAP proof first

Create a self-contained transaction/rollback pgTAP test that proves:

- valid Cyrillic/Latin cities, hyphens, apostrophes, and surrounding ASCII-space normalization;
- blank, tabs/newlines, non-breaking/zero-width/control whitespace, punctuation-only, and unsupported characters fail;
- rejection leaves pending membership and an unconfirmed user cannot activate;
- missing current Terms or Marketplace Rules consent cannot activate;
- valid onboarding activates membership without requiring phone;
- clearing/invalidating city makes access fail closed and valid onboarding repairs legacy bad city;
- a user cannot update another profile or self-escalate role/account privilege;
- hostile `raw_user_meta_data.role = 'admin'` does not grant privilege;
- suspended/revoked membership is not reactivated by an open-registration claim;
- staff/admin AAL2 policy remains present and cannot be bypassed by user metadata.

### Step 2: Establish a behavior RED against the current schema

Start/reset the local Supabase stack using only local configuration, then run the new pgTAP file against the baseline schema before adding the migration. Expected: city validity/activation assertions fail for behavioral reasons.

### Step 3: Generate a new current migration

Do not copy an old timestamp. Run:

```bash
pnpm exec supabase migration new require_meaningful_city_for_active_onboarding
```

Implement:

```sql
private.normalize_city(text) returns text
private.is_valid_city(text) returns boolean
```

Both functions must be immutable/parallel-safe, use `search_path = ''`, normalize only surrounding ASCII spaces, require 2–100 characters, at least one `[[:alnum:]]`, and only `[-[:alnum:] '']` characters. Revoke `PUBLIC`/`anon` execution and grant only the minimum required authenticated/service-role execution.

Add a `NOT VALID` profile city-shape constraint so unknown legacy rows are preserved while new writes are safe.

Replace `private.is_active_beta_user(uuid)` so every existing condition remains and a valid city is additionally required.

Replace `public.complete_beta_onboarding(text, text)` so it:

- normalizes and validates city before any write;
- remains bound to `auth.uid()` and confirmed, non-suspended/non-revoked membership;
- still requires all current required legal consents;
- returns idempotently only when an already-active account also has a valid city;
- can repair a legacy active invalid-city row through the same safe onboarding path;
- updates username/city and activates membership atomically;
- retains the current unique-username conflict behavior and explicit grants.

### Step 4: Rebuild the local database and capture GREEN

Run:

```bash
pnpm db:reset
pnpm exec supabase test db supabase/tests/issue22_open_registration_activation.pgtap.sql
pnpm db:lint
```

If the CLI does not accept the path argument, run the exact local `psql` command documented by `supabase test db --help`; do not widen to hosted state. Expected: targeted pgTAP and lint pass.

### Step 5: Commit

```bash
git add supabase/migrations/*_require_meaningful_city_for_active_onboarding.sql supabase/tests/issue22_open_registration_activation.pgtap.sql
git commit -m "fix(db): fail closed on invalid onboarding city"
```

---

## Task 4: Bounded integration verification and reconciliation audit

**Files:**
- Modify only files from Tasks 1–3 if a focused verification failure exposes a reconciliation defect.

### Step 1: Run the complete focused Checkpoint 22A set

```bash
pnpm exec vitest run tests/contracts/open-registration-config.contract.test.ts tests/server/auth-confirm.test.ts tests/server/login-backend-attestation.test.ts tests/server/auth-lifecycle-regressions.test.ts tests/contracts/production-data-contracts.test.ts tests/server/auth-guards-regression.test.ts tests/server/auth-runtime.test.ts
pnpm exec svelte-check --tsconfig ./tsconfig.json
pnpm db:reset
pnpm exec supabase test db supabase/tests/issue22_open_registration_activation.pgtap.sql
pnpm db:lint
```

Do not substitute the full R2 matrix or hosted/browser execution.

### Step 2: Inspect the full bounded diff

```bash
git status --short
git diff --check 313f60fde5c44eded11572ee318771c9b5580127..HEAD
git diff --stat 313f60fde5c44eded11572ee318771c9b5580127..HEAD
git diff --name-status 313f60fde5c44eded11572ee318771c9b5580127..HEAD
```

Confirm no hosted scripts, provider state, Gate 3 work, Issue #25 work, profile redesign, unrelated docs, or migration rewrites are present.

### Step 3: Record exact evidence

Record per-command PASS/FAIL totals, RED/GREEN results, branch/start/end/origin-main SHAs, and the KEEP/REIMPLEMENT/DROP outcome for the final owner handoff. Do not push, merge, deploy, close the issue, or begin Checkpoint 22B.
