# Auth Refactor Verification Checklist

## Purpose

Use for Gate 1 implementation verification. Mark only commands run in the
current evidence set; do not infer or invent results.

## Focused commands

```powershell
pnpm exec vitest run `
  tests/server/auth-lifecycle-regressions.test.ts `
  tests/server/auth-refactor-contract.test.ts `
  tests/server/auth-guards-regression.test.ts `
  tests/server/auth-runtime.test.ts
```

```powershell
pnpm check
pnpm build
```

Focused diff review must include `src/lib/server/auth/guards.ts`,
`src/hooks.server.ts`, the lifecycle and contract suites, affected route
consumers, `src/routes/+layout.server.ts`, and `src/lib/components/Header.svelte`.

## Full Gate 1 commands from the approved plan

```powershell
pnpm test
pnpm check
pnpm build
pnpm db:lint
pnpm db:test
pnpm test:e2e
```

Record each as PASS, FAIL, or NOT RUN with the exact command and reason where
applicable. No result is recorded by this checklist.

## Manual invariants

- [ ] Access policy and auth-data requirements are separate contracts.
- [ ] `/onboarding` loads user/profile/beta, not AAL.
- [ ] Authenticated `/login` and public/legal navigation load beta, not profile/AAL.
- [ ] `/auth/update-password` loads beta, not profile/AAL.
- [ ] `/auth/mfa` loads profile/beta/AAL while retaining staff-AAL1 access.
- [ ] `/admin/*` still fetches and enforces AAL2.
- [ ] Ordinary authenticated routes remain user-only unless mapped otherwise.
- [ ] Anonymous public routes remain `getUser()`-only.
- [ ] Authenticated `/auth/confirm`, `/auth/callback`, `/robots.txt`, and
  `/sitemap.xml` remain unenriched.
- [ ] Lifecycle evidence covers onboarding loader/POST, login, password update,
  MFA, and public root-layout/`Header` behavior.
- [ ] No global eager-auth rollback or `/onboarding` special-case patch exists.
- [ ] Required profile/RPC failures return `503`; missing required auth data
  fails closed.

## Completion record

Record the exact commands and fresh outputs, focused test counts/failures,
manual-invariant review, diff summary, and residual risk. Do not claim Gate 1
PASS until the plan's acceptance criteria and full available verification have
evidence.
