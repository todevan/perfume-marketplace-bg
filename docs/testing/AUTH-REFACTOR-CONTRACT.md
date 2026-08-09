# Auth Refactor Contract

## Purpose

Defines the Gate 1 selective auth-context contract for:

```text
src/lib/server/auth/guards.ts
src/hooks.server.ts
src/lib/server/auth/context.ts
```

Primary executable suites:

```text
tests/server/auth-lifecycle-regressions.test.ts
tests/server/auth-refactor-contract.test.ts
```

Supporting suites include `tests/server/auth-guards-regression.test.ts` and
`tests/server/auth-runtime.test.ts`.

## Gate 1 correction

`RouteAccessPolicy` answers whether a request may enter a route. Its separate
`routeAuthDataRequirements` mapping answers which authenticated data a route
consumer needs. This corrects the earlier contract that incorrectly said
onboarding, authenticated login, and staff-AAL1 could omit required data; it
does not rewrite that historical conflict silently.

The hook verifies identity with `getUser()` first, then loads only the mapped
pieces for an authenticated request. It must not restore global eager loading.

## Permanent selective-loading contract

| Route or class | Access policy | Required authenticated data |
|---|---|---|
| `/onboarding` | authenticated | user + profile + beta access; no AAL |
| `/login` | public | user; beta access when authenticated; no profile or AAL |
| `/auth/update-password` | authenticated | user + beta access; no profile or AAL |
| `/auth/mfa` | staff-AAL1 | user + profile + beta access + current AAL |
| `/admin/*` | staff | user + profile + beta access + current AAL; AAL2 remains enforced |
| ordinary authenticated route | authenticated | user only unless explicitly mapped otherwise |
| beta fallback | beta | user + profile + beta access; no AAL |

Authenticated public and legal navigation (`/login`, `/safety`,
`/auth/error`, `/auth/reset-password`, and `/legal/*`) loads beta access so the
root layout and `Header` can render active users correctly. Anonymous requests
to those routes remain `getUser()`-only. Even for authenticated sessions,
`/auth/confirm`, `/auth/callback`, `/robots.txt`, and `/sitemap.xml` remain
unenriched: no profile, beta, or AAL query.

## Lifecycle and focused contract evidence

The decisive lifecycle suite must exercise the hook plus the route consumer;
hook call-count tests alone are insufficient. It covers:

- pending-member onboarding loader and POST with profile + beta context;
- active-user `/login` safe redirect without an onboarding detour;
- active-user password update safe redirect without an onboarding detour;
- already-AAL2 staff redirect from `/auth/mfa`;
- authenticated public/legal root-layout projection for `Header`, while
  anonymous public navigation remains lazy;
- authenticated technical public endpoint laziness.

`auth-refactor-contract.test.ts` proves the declarative mapping's query shape,
including no AAL for onboarding/beta routes and full AAL loading for staff
routes.

## Exact redirect and failure contracts

- Anonymous authenticated route: exact `303` login redirect.
- Missing beta-route profile/access or incomplete onboarding: exact `303`
  `/onboarding?next=...` redirect.
- Insufficient admin AAL: exact `303` `/auth/mfa?next=...` redirect.
- Required profile SELECT or beta RPC failure: `503`; no silent grant.

## Security invariants

- `getUser()` remains authoritative; do not substitute `getSession()`.
- Access authorization stays in `enforceRoutePolicy()`; data requirements do
  not authorize entry.
- Missing required authorization data fails closed.
- Beta and staff checks continue to enforce suspension, membership status,
  onboarding completion, active access, roles, and admin AAL2.
- No pathname-only onboarding patch and no global eager-auth rollback.
