# Auth Refactor Code Review Checklist

## Scope

Review the Gate 1 mapping and its consumers, including:

```text
src/lib/server/auth/guards.ts
src/hooks.server.ts
src/lib/server/auth/context.ts
src/routes/onboarding/+page.server.ts
src/routes/login/+page.server.ts
src/routes/auth/update-password/+page.server.ts
src/routes/auth/mfa/+page.server.ts
src/routes/+layout.server.ts
src/lib/components/Header.svelte
tests/server/auth-lifecycle-regressions.test.ts
tests/server/auth-refactor-contract.test.ts
tests/server/auth-guards-regression.test.ts
tests/server/auth-runtime.test.ts
```

Do not expand into a repository-wide audit.

## Review questions

### Mapping and authorization

- [ ] `RouteAccessPolicy` authorizes entry and `routeAuthDataRequirements`
  declares data; neither silently substitutes for the other.
- [ ] `/onboarding`, `/login`, `/auth/update-password`, `/auth/mfa`, and
  `/admin/*` match the approved Gate 1 mapping.
- [ ] `/auth/mfa` retains staff-AAL1 access while loading AAL for its consumer.
- [ ] `/admin/*` still requires staff access and enforces AAL2.
- [ ] Ordinary authenticated routes stay user-only unless explicitly mapped.
- [ ] The mapping has one clear owner and cannot drift from hook behavior.

### Lazy loading and consumers

- [ ] Authenticated public/legal navigation supplies beta state to the root
  layout and `Header` without profile/AAL loading.
- [ ] Anonymous public navigation stays `getUser()`-only.
- [ ] Authenticated `/auth/confirm`, `/auth/callback`, `/robots.txt`, and
  `/sitemap.xml` stay unenriched.
- [ ] No global eager loading or `/onboarding` imperative special case appears.

### Security and error semantics

- [ ] `getUser()` remains authoritative; no unproven `getSession()` substitution.
- [ ] Beta/staff checks still fail closed and enforce suspension, membership,
  onboarding, active access, role, and AAL2 as applicable.
- [ ] Required profile and beta RPC failures preserve intended `503` behavior.
- [ ] Optional data not required by a route cannot create an irrelevant `503`.

### Test quality

- [ ] Lifecycle tests execute hook plus route consumers for onboarding loader and
  POST, login, password update, MFA, and public root-layout/`Header` behavior.
- [ ] Lifecycle tests cover technical endpoint laziness for authenticated users.
- [ ] Contract tests assert the selective query shape; guard tests assert access
  outcomes and exact redirects.
- [ ] Tests no longer encode the prior incorrect omission of onboarding, login,
  or staff-AAL1 data.

## Finding format and residual risk

Order findings Critical/High/Medium/Low; include file/line, execution path,
why real, smallest safe fix, and confidence. A clean local review does not
replace hosted Supabase, staging, multi-session, or production-observability
verification.
