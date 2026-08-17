# Issue 22 Hosted Cleanup Compatibility Repairs — Design

Date: 2026-08-18

## Scope

Repair two independent fail-closed cleanup compatibility bugs discovered while running `hosted-cleanup` for candidate `73668630605c49119ccd7844b87c9cac95f86911` on PR #33. Keep the fixes small, independently testable, and independently committable.

No hosted execution is part of this repair. Recovery evidence under `scripts/issue22-hosted/private` must remain intact until a later cleanup run proves final state.

## Observed provider behavior

### Supabase

The exact-target Management API currently returns a safe-disabled Auth state with:

- `disable_signup = true`
- `security_captcha_enabled = false`
- `security_captcha_secret` absent/cleared
- SMTP credential fields absent/cleared
- `security_captcha_provider` still populated

A PATCH of `{ "security_captcha_provider": null }` succeeds, but a following GET still returns the provider populated. The live OpenAPI schema marks the provider and credential fields nullable. Therefore the current operator assertion is stricter than the provider's observed normalization behavior.

### Cloudflare Turnstile

Recovery state retains the exact Issue 22 widget intent and saved sitekey, but the live account no longer contains that widget. The only live widget observed belongs to an unrelated site and must never be touched.

The current saved-sitekey resolver treats zero live matches as an error. That prevents idempotent cleanup when the intended widget is already absent.

## Repair 1 — Supabase Auth cleanup compatibility

### Goal

Treat a retained CAPTCHA provider name as harmless metadata only when every effective CAPTCHA and credential control proves disabled/cleared.

### Required behavior

`assertSafeDisabledAuth()` may accept a populated `security_captcha_provider` when all of the following are true:

- signup is disabled in both management and public settings;
- CAPTCHA is disabled;
- CAPTCHA secret is absent or null;
- all SMTP credential fields are absent or null;
- all existing email-only, anonymous-disabled, confirmation, and site-url invariants remain satisfied.

It must continue to fail closed if any effective credential or capability remains active, including:

- CAPTCHA enabled;
- CAPTCHA secret present;
- SMTP credential present;
- signup enabled;
- any existing Auth/public-settings invariant drift.

### Implementation boundary

Prefer changing only the final safe-disabled assertion. Do not weaken `assertAuthState()`, do not remove the credential-clear PATCH, and do not change the live OpenAPI nullable-shape guard.

### TDD contract

Add a failing test using the observed normalized state: `security_captcha_enabled: false`, `security_captcha_provider: 'turnstile'`, secret cleared, SMTP cleared. Verify the test fails before production code changes.

Retain or add negative tests proving enabled CAPTCHA, retained secret, or retained SMTP still fail.

## Repair 2 — Cloudflare Turnstile idempotent cleanup

### Goal

Allow cleanup to succeed when the saved Issue 22 widget is already absent, without ever deleting a different widget.

### Required behavior

When a saved sitekey exists:

1. If exactly one live widget has that sitekey, it must also match the saved recovery intent (`name` and `domain`) or cleanup fails.
2. If zero live widgets have that sitekey:
   - if zero live widgets match the saved recovery intent, treat the target widget as already absent;
   - if any live widget matches the saved recovery intent under a different sitekey, fail closed because the state is ambiguous/drifted.
3. More than one match remains an error.

An unrelated live widget must be ignored and must never be selected for deletion.

### Implementation boundary

Prefer changing only `resolveSavedWidgetForCleanup()` and its unit tests. Do not broaden matching rules and do not weaken `resolveWidgetForCleanup()` ambiguity checks.

### TDD contract

Add a failing test for saved sitekey + zero saved-sitekey matches + zero intent matches => `null` / already absent.

Add or retain negative tests for:

- saved sitekey points to wrong name;
- saved sitekey points to wrong domain;
- saved sitekey is absent but another widget matches the intent with a different sitekey;
- ambiguous intent matches.

## Commit structure

Use two commits on `issue-22-open-registration`:

1. `fix(issue22): accept provider-normalized disabled captcha metadata`
2. `fix(issue22): make turnstile cleanup idempotent when target is absent`

Each commit should contain its own RED test, minimal implementation, and GREEN verification.

## Verification

For each repair independently:

1. run the targeted Issue 22 operator test and observe the new test fail before the production change;
2. implement the minimal change;
3. rerun the targeted test to green;
4. run the full `tests/scripts/issue22-hosted-operator.test.ts` suite.

After both commits:

- run the broader repository checks normally required for PR #33;
- perform engineering/security review of the two bounded changes;
- do not run `hosted-execute`;
- only after both commits are pushed and reviewed may the preserved recovery state be used for a new `hosted-cleanup` attempt.

## Safety invariants

The repairs must not:

- delete or edit `scripts/issue22-hosted/private/recovery-state.json` manually;
- delete the unrelated `uhh.com (Spin)` Turnstile widget;
- relax target account/project identity checks;
- relax Worker secret cleanup guards;
- allow active CAPTCHA or retained secret material to pass final attestation;
- allow a mismatched or ambiguous Turnstile widget to be deleted;
- run the hosted registration journey before cleanup passes.

## Out of scope

- changing Cloudflare or Supabase account permissions;
- changing database/RLS policy behavior;
- changing registration product behavior;
- manually editing hosted provider state beyond the later guarded cleanup operation;
- merging PR #33 before hosted cleanup and hosted verification both pass.
