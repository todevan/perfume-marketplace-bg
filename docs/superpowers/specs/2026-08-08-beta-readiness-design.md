# Beta Readiness Remediation Design

**Date:** 2026-08-08

## Purpose

Prepare the current application for hosted beta without broadening into unrelated marketplace work.

The immediate release blockers are:

1. the lazy-auth regression affecting onboarding, active-user login routing, password recovery, MFA behavior, and authenticated public navigation;
2. public registration reaching Supabase signup without Turnstile verification.

A third pre-beta resource boundary is included immediately after the High-severity fixes: bounded parsing for anonymous/public auth form bodies.

## Operating model

Work proceeds through four sequential gates:

1. Gate 0 — establish the current baseline;
2. Gate 1 — repair auth context/data requirements;
3. Gate 2 — protect registration with Turnstile;
4. Gate 3 — bound public auth forms and perform full beta verification.

A gate cannot start until the preceding gate records PASS.

## Auth architecture

Authorization requirements and auth-data requirements are separate concepts.

`RouteAccessPolicy` continues to answer:

> May this request enter this route?

A separate auth-data requirement contract answers:

> What authenticated state must be loaded so this route can behave correctly?

The implementation must preserve lazy loading and fail-closed authorization.

Required route behavior:

| Route | Access requirement | Data requirement |
|---|---|---|
| `/onboarding` | authenticated | user + profile + beta access |
| `/login` | public | user; beta access if authenticated |
| `/auth/update-password` | authenticated | user + beta access |
| `/auth/mfa` | staff AAL1 | user + profile + beta access + AAL |
| `/admin` | staff AAL2 | preserve current full AAL2 enforcement |

The architectural fix must not be an `/onboarding` pathname special case and must not restore global eager auth loading.

## Registration abuse boundary

Registration must render a Turnstile challenge bound to action `register`.

The server must successfully verify the `register` challenge before `supabase.auth.signUp()` is reachable.

Missing or invalid verification must fail closed, and regression tests must assert that `signUp()` was not invoked.

## Public form resource boundary

Anonymous/public auth actions must not use unbounded `await request.formData()`.

Use the existing bounded request-body infrastructure, with a centralized small text-form profile. The stream itself must be bounded; `Content-Length` is not considered sufficient enforcement.

## Verification philosophy

Behavior changes follow:

reproduce → failing lifecycle/contract test → minimal coherent fix → focused tests → broader regression suite → gate decision

Hook-only tests are not sufficient evidence for real auth lifecycles.

The full available verification set is:

```bash
pnpm test
pnpm check
pnpm build
pnpm db:lint
pnpm db:test
pnpm test:e2e
```

Any command that cannot run must be recorded as NOT RUN with the exact reason. It must not be counted as green.

## Out of immediate beta scope

Unless new evidence promotes them:

- messaging block/edit/delete/moderation evidence semantics;
- release-compatible Worker rollback;
- immutable SHA pinning for GitHub Actions;
- documentation drift;
- text-only reporting degradation.

## Security guardrails

Do not weaken:

- PostgreSQL RLS;
- SQL privilege boundaries;
- staff MFA/AAL2;
- upload/evidence sanitization and isolation;
- fail-closed authorization;
- safe redirects;
- feature gates.

If a required fix appears to conflict with one of these invariants, stop the task and record the discovery rather than silently redesigning the security model.
