# Auth Route Policy and Data-Requirement Test Matrix

## Purpose

Permanent Gate 1 behavioral contract for `src/lib/server/auth/guards.ts`.
`routeAccessPolicy` is authorization; `routeAuthDataRequirements` is a separate
data-loading map. Guard tests exercise access outcomes; hook and lifecycle
tests exercise enrichment and consumers.

## Route mapping

| Route or class | Access policy | User | Profile | Beta access | Current AAL |
|---|---|---:|---:|---:|---:|
| `/onboarding/*` | authenticated | Yes | Yes | Yes | No |
| `/login` | public | Yes | No | authenticated only | No |
| `/auth/update-password` | authenticated | Yes | No | Yes | No |
| `/auth/mfa` | staff-AAL1 | Yes | Yes | Yes | Yes |
| `/admin/*` | staff | Yes | Yes | Yes | Yes |
| ordinary authenticated route | authenticated | Yes | No | No | No |
| beta fallback private route | beta | Yes | Yes | Yes | No |
| public/legal navigation | public | Yes | No | authenticated only | No |
| `/auth/confirm`, `/auth/callback`, `/robots.txt`, `/sitemap.xml` | public | Yes | No | No | No |

Authenticated-only means the optional data is queried only after `getUser()`
returns a user. The final row stays unenriched even for an authenticated user.
Anonymous public requests remain `getUser()`-only.

## Permanent guard tests

### Public and authenticated access

- `public_allows_anonymous_on_login` and `public_allows_anonymous_on_legal_prefix`
  proceed without redirect or `403`.
- `authenticated_redirects_anonymous_to_login_on_logout` and
  `authenticated_onboarding_prefix_requires_user_presence` assert exact `303`
  login redirects.
- `authenticated_allows_user_with_user_presence_on_update_password` proceeds;
  its additional beta data is a route-data requirement, not an access rule.

### Beta and staff access

- Beta fallback redirects anonymous or incomplete users as specified, rejects
  suspended/revoked/inactive access, and requires profile plus beta access.
- `/auth/mfa` redirects anonymous users, rejects non-staff users, and permits a
  valid staff user without treating AAL2 as its access requirement. It still
  loads current AAL for the MFA route consumer.
- `/admin/*` redirects anonymous users, rejects non-staff users, and redirects
  insufficient AAL to `/auth/mfa?next=...`; a valid staff user must have AAL2.

## Test ownership rule

Guard tests assert policy classification, exact redirects, `403`s, and AAL2
admin enforcement. `auth-refactor-contract.test.ts` owns hook query-call
assertions. `auth-lifecycle-regressions.test.ts` owns hook-to-route behavior,
including root-layout/`Header` consumers and public technical endpoint laziness.
