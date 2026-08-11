# Gate 3 A7 Turnstile Testing-Key Reconciliation Design

Date: 2026-08-10

## Status

Approved design for A7 remediation.

This document defines the smallest change required to reconcile Cloudflare
Turnstile testing-key semantics with the staging runtime validation policy.

This is an A7 remediation only.

It does not reopen A6, enter A8, modify database state, change production
configuration, or alter the fail-closed staging rollback Worker.

## 2026-08-11 live reconciliation addendum

The current A7 owner handoff and fresh provider evidence supersede the original
receipt-shape and file-scope assumptions below where they conflict.

Against the official testing site key, testing secret, and dummy token, the live
Cloudflare Siteverify API repeatedly returned `success=true`, omitted `action`,
reported `hostname=example.com`, and returned an empty `error-codes` array. The
documented `action=test` / `hostname=localhost` receipt remains accepted too.
Both shapes are accepted only behind the existing exact three-condition gate:
staging environment, official testing site key, and official testing secret.
Production and non-testing credentials retain strict action and hostname checks.

The durable follow-up may change the staging Wrangler configuration, manual
staging workflow, evidence script, and the direct dependency needed to decode
SvelteKit action envelopes. Required secret names provide an early configuration
guard; post-deploy live login/register action evidence detects a missing, stale,
or wrong secret value and triggers the existing safe rollback on failure.

The action evidence uses per-run random `.invalid` identities, exact known
application failure branches, and signup-disabled checks before and after the
registration request. The temporary signup-disabled precondition is an explicit
manual-workflow input so later staging phases can turn it off without making all
future deployments fail. `report_submit` remains deferred because its route
requires an authenticated actor before Turnstile and no A7-safe actor is approved;
the evidence receipt must state that dependency rather than provision an A9 actor.

## Context

The exact approved staging candidate was:

- Git SHA: `2e64870623c8e619eb443f4c546dd32845fd7ac4`
- Tree: `6637aa4736b3ed6c924b20e92b9772fef323ca90`
- Worker version: `bab20bf7-3148-4b09-a50f-bd39064c3faa`

The candidate passed:

- repository tests;
- Svelte checks;
- builds;
- database contracts;
- hosted catalogue baseline;
- exact-SHA deployment;
- canonical staging functional smoke;
- canonical crawler-header checks.

The candidate was subsequently returned to 0% traffic and the known fail-closed
Worker was restored to 100%.

## Root cause

Staging intentionally uses Cloudflare's official always-pass Turnstile testing
site key and testing secret.

Cloudflare's testing verification response is a dummy receipt. A successful
testing-key verification reports the testing values:

- action: `test`
- hostname: `localhost`

The current server validator applies production-style action and hostname
matching to every successful Siteverify response.

The application therefore expects:

- `login` + staging hostname;
- `register` + staging hostname;
- `report_submit` + staging hostname;

while Cloudflare testing credentials return:

- `test` + `localhost`.

This means the configured staging testing-key success path cannot satisfy the
current validator by design.

This is not a database failure, Worker-secret binding failure, widget-rendering
failure, or invalid candidate deployment.

## Goal

Allow deterministic Cloudflare Turnstile testing credentials to work in the
staging environment without weakening production Turnstile validation.

## Non-goals

This remediation will not:

- disable Turnstile validation;
- remove action validation from production;
- remove hostname validation from production;
- accept arbitrary Turnstile testing responses;
- affect production configuration;
- change registration admission rules;
- create test users or reports;
- change Supabase configuration or data;
- change image handling;
- change payment configuration;
- perform A8 cleanup.

## Design

### 1. Keep strict validation as the default

The normal `verifyTurnstile` path remains unchanged in principle:

A response succeeds only when:

- Siteverify returns `success === true`;
- the returned action matches the expected action, when supplied;
- the returned hostname matches the expected hostname, when supplied.

This remains the behavior for production and for staging when real credentials
are used.

### 2. Add an explicit Cloudflare testing-receipt mode

Testing semantics must be enabled explicitly by runtime context.

The validator must not infer testing mode merely from a successful response.

The server-side verification boundary will receive enough configuration to
decide whether the request is running with the approved Cloudflare always-pass
testing credentials in staging.

Only when all required staging/testing conditions are true may the validator
accept Cloudflare's documented dummy receipt:

- `success === true`;
- `action === "test"`;
- `hostname === "localhost"`.

Any other testing receipt remains rejected.

### 2.1 Exact testing-mode gate

Cloudflare testing-receipt acceptance must be enabled only when all three of
the following runtime conditions are true:

- `appEnvironment === "staging"`;
- `PUBLIC_TURNSTILE_SITE_KEY === "1x00000000000000000000AA"`;
- `TURNSTILE_SECRET_KEY === "1x0000000000000000000000000000000AA"`.

The low-level `verifyTurnstile` function must receive an explicit boolean
capability such as:

`acceptCloudflareTestingReceipt`

Its default value must be `false`.

`verifyTurnstile` must not inspect application environment variables itself and
must not infer testing mode from the Siteverify response.

`verifyTurnstileForAction` is the only application boundary allowed to enable
`acceptCloudflareTestingReceipt`, after checking the exact three runtime
conditions above.

When `acceptCloudflareTestingReceipt === true`, the only testing receipt that
may bypass normal expected-action and expected-hostname comparison is exactly:

- `success === true`;
- `action === "test"`;
- `hostname === "localhost"`.

A testing-mode response with any other action or hostname remains rejected.

When `acceptCloudflareTestingReceipt === false`, the validator continues using
the normal strict expected-action and expected-hostname checks.

This explicit three-condition gate prevents:

- production from accepting Cloudflare dummy receipts;
- staging with real Turnstile credentials from entering testing mode;
- arbitrary successful Siteverify responses from being interpreted as testing
  receipts;
- the low-level validator from depending directly on deployment environment.
### 3. Production cannot enter testing mode

Production runtime must never accept the dummy testing receipt.

A production request using:

- action `test`;
- hostname `localhost`;

must fail even if Siteverify reports success.

The testing exception is therefore fail-closed outside staging.

### 4. Application action bindings remain unchanged

The browser widgets continue declaring their real logical actions:

- login widget -> `login`;
- registration widget -> `register`;
- report widget -> `report_submit`.

The server actions continue requesting those same expected logical actions.

The remediation affects only how Cloudflare's known testing receipt is
interpreted in the explicitly configured staging testing environment.

### 5. No form side effects are required for verification

A7 verification must prove:

- the live staging widgets issue tokens;
- Siteverify accepts those testing tokens;
- staging recognizes the official dummy testing receipt;
- production-style validation remains strict.

No successful registration, login, report creation, upload, or database mutation
is required to prove the reconciliation.

## Testing strategy

The implementation must be test-driven.

Before changing validation logic, add failing regression coverage for at least:

1. staging + official testing configuration + `success=true`,
   `action=test`, `hostname=localhost` -> accepted;

2. staging testing configuration + unsuccessful Siteverify response -> rejected;

3. staging testing configuration + unexpected dummy action or hostname -> rejected;

4. production + `success=true`, `action=test`, `hostname=localhost` -> rejected;

5. normal production response with exact expected action and hostname -> accepted;

6. normal production response with wrong action -> rejected;

7. normal production response with wrong hostname -> rejected.

Existing Turnstile tests must continue passing.

After implementation, run the full repository quality gates required by Gate 3,
not only the new Turnstile unit tests.

## Release procedure

The remediation produces a new exact Git SHA.

That SHA must:

1. pass the full local/CI Gate 3 quality suite;
2. be reviewed as an A7-only change;
3. merge to `main`;
4. receive a new explicit exact-SHA staging deployment approval;
5. deploy only to staging;
6. complete canonical functional smoke;
7. complete live Turnstile testing-key verification;
8. preserve the known safe Worker as rollback fallback.

A8 must not begin as part of this remediation.

## Rollback

Until the reconciled candidate passes A7, canonical staging traffic remains on:

`75593db4-12fd-486d-ae8a-bdf9ebbb3ece`

Database migrations remain forward-only and are not part of this remediation.

## Success criteria

A7 Turnstile reconciliation is successful only when all of the following are
true:

- staging testing tokens are accepted according to Cloudflare testing semantics;
- login, register, and report_submit logical bindings remain present;
- production validation still rejects mismatched action and hostname;
- full Gate 3 CI remains green;
- the new exact staging SHA passes canonical functional smoke;
- no production or A8 mutation occurs.
