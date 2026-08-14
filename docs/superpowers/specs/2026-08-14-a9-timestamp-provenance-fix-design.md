# A9 Supabase Timestamp Provenance Fix — Design

Date: 2026-08-14

## Problem

Hosted A9 provisioning accepts the exact Frankfurt staging target and passes all prerequisite checks, but the transaction fails immediately after successfully creating the first synthetic Reporter actor.

The failure is caused by `registerHostedActor()` calling `requireIsoTimestamp()`, which currently requires:

`new Date(Date.parse(value)).toISOString() === value`

Supabase Auth returns valid `created_at` timestamps with microsecond precision (for example `2026-08-14T09:54:01.47714Z`). JavaScript `Date#toISOString()` normalizes to millisecond precision, so valid Supabase timestamps are rejected as `actor provisioning timestamp is invalid`.

Because the actor is created before this validation failure and the transaction's created-actor bookkeeping is updated only after registration succeeds, the failed run can leave an orphan synthetic actor.

## Approved approach

Use a strict UTC RFC3339 timestamp validator that accepts Supabase-compatible fractional seconds without normalizing or rewriting the provider value.

Accepted forms:

- `YYYY-MM-DDTHH:mm:ssZ`
- `YYYY-MM-DDTHH:mm:ss.SZ`
- `YYYY-MM-DDTHH:mm:ss.SSSZ`
- up to six fractional digits, matching PostgreSQL/Supabase microsecond precision

The validator must:

1. Require UTC `Z`.
2. Require the full date/time structure.
3. Allow 0–6 fractional-second digits.
4. Reject invalid calendar/time values.
5. Return the original string unchanged.

Do not truncate or normalize timestamps before storing them in the manifest.

## Compensation safety

`createConfirmedUser()` must validate the returned `user.created_at` before returning the newly created actor to transaction bookkeeping.

If the provider returns a malformed or unsupported timestamp after a user was successfully created:

1. delete that exact newly created user;
2. confirm the user is absent;
3. return only a sanitized A9 operator error.

This ensures a post-create validation failure cannot leave an orphan synthetic actor.

## Scope

Change only the A9 hosted operator and its tests.

Primary files:

- `scripts/hosted-report-evidence-operator.mjs`
- `tests/scripts/hosted-report-evidence-operator.test.ts`

No changes to staging configuration, Supabase Auth policy, Cloudflare deployment, A10/A11 behavior, unrelated UX, payments, or production.

Do not retry hosted A9 until the fix is tested and the existing residual Reporter is handled through controlled cleanup.

## Tests

Add regression coverage before implementation:

1. `registerHostedActor()` accepts a valid Supabase microsecond timestamp and preserves the exact original value.
2. Existing millisecond timestamps remain accepted.
3. Malformed timestamps remain rejected.
4. A successfully-created user whose returned `created_at` fails validation is deleted and confirmed absent before the operation rejects.
5. The compensation error remains sanitized and does not expose credentials or actor details.

Run the focused hosted A9/operator tests, then the existing local A9 test gate before any hosted retry.

## Success criteria

The fix is complete when:

- valid Supabase microsecond `created_at` values are accepted without normalization;
- provenance comparisons can use the exact provider timestamp;
- malformed provider timestamps fail closed;
- post-create timestamp validation failure cannot leave a synthetic Auth user;
- all focused and existing A9 tests pass;
- no hosted mutation has been retried during code-fix verification.
