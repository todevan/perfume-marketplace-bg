# Architecture

## Purpose and authority

This document defines the repository's authoritative application architecture, system boundaries, major security invariants and intended runtime shape.

It describes the architecture the implementation is expected to conform to. It is not, by itself, proof that every capability is currently enabled or deployed.

For current implementation and rollout state, also consult:

- `docs/PROJECT-STATUS.md`
- `docs/LAUNCH-GATES.md`
- applicable approved plans under `docs/superpowers/plans/`
- the current GitHub issue and explicitly authorized gate/phase scope

Repository instructions in `AGENTS.md` and more specific applicable project documentation take precedence where they intentionally constrain a particular task.

Installed skills are reasoning and execution tools. They may analyze or improve this architecture, but must not silently replace repository architecture with their own preferred patterns.

---

## Runtime shape

The application is a SvelteKit/TypeScript modular monolith deployed as a Cloudflare Worker with static assets. Supabase provides PostgreSQL, email/password Auth, private Storage and Realtime. Resend handles email, Turnstile protects sensitive forms, and Cloudflare Images performs trusted image normalization.

```text
Browser
  ├─ SSR pages and validated SvelteKit form actions
  └─ authorised Supabase Realtime subscriptions only
             │
Cloudflare Worker / SvelteKit
  ├─ request-scoped cookie PKCE client
  ├─ authentication, membership, role and MFA guards
  ├─ Zod input contracts → services → repositories
  └─ private upload processor and structured request logs
             │
Supabase
  ├─ PostgreSQL functions, constraints, RLS and scheduled jobs
  ├─ Auth users (email remains private)
  ├─ quarantine/finalized private Storage
  ├─ report-bound moderation and immutable audit
  └─ Realtime messages and notifications
             │
Database Webhook → notification Edge Function → Resend
```

The modular monolith is intentional.

Do not introduce additional distributed services, alternate data-access layers, client-side database mutation paths or provider abstractions merely because an installed engineering skill normally prefers them.

Material architecture changes require explicit issue scope and the normal repository decision/risk process.

---

## Runtime modes

- `PUBLIC_DEMO_MODE=true` is an explicit local/test fixture adapter. No external identity or persistent writes are implied.
- Production mode fails closed when Supabase configuration or verified identity loading fails.
- Production routes use repository/service DTOs; database row shapes do not reach components.
- `robots.txt` denies indexing and `sitemap.xml` returns 404 during pre-launch development.

Demo behavior must not leak into the real authenticated runtime.

A temporary staging/provider configuration state is not automatically an architectural rule. Use current-status and launch-gate documentation to determine whether a capability is intentionally disabled during a particular reconciliation or release phase.

---

## Authentication and access

`hooks.server.ts` creates one request-scoped `@supabase/ssr` client, reads cookies and validates identity with `getUser()` before loading the profile, membership and AAL.

Route policy is default-deny: only login/registration, auth callbacks, legal and safety routes are public.

Any user may create an email/password account. Email confirmation establishes the secure-cookie session, `claim_open_registration()` creates pending invite-free membership, and onboarding records the current legal consents before activation.

All marketplace routes require active membership; staff routes additionally require role and AAL2.

Legacy invite records remain supported for the operator-only first-administrator bootstrap, but they are not part of public user registration.

Suspended or revoked memberships are never reactivated by the open-registration claim.

Authentication, membership, authorization, role and MFA checks are security boundaries rather than UI conventions. Do not bypass or duplicate them in client code to simplify a feature.

Where a launch gate intentionally disables a capability such as public signup on a hosted environment, treat that as rollout state unless authoritative product documentation explicitly changes the architecture.

---

## Application boundaries

- `src/lib/contracts` contains parsed input and stable UI DTO contracts.
- `src/lib/server/repositories` is the only ordinary query/RPC boundary.
- `src/lib/server/services` enforces request-level workflow rules and maps repository failures.
- `src/lib/domain` contains deterministic marketplace rules.
- `src/routes/**/+page.server.ts` and endpoints own authorization and HTTP semantics.
- Browser code may subscribe to rows already allowed by RLS, but does not write directly to Supabase.

These boundaries are deliberate.

Normal feature work should extend them rather than create parallel access patterns.

Examples of architectural drift include:

- querying Supabase directly from ordinary components;
- bypassing repositories from unrelated server code;
- moving authorization decisions into the browser;
- exposing raw database rows directly to UI components;
- duplicating deterministic domain rules across routes;
- replacing database-enforced invariants with UI-only checks.

When code appears to violate an existing boundary, determine whether the code is a regression or the architecture has been explicitly superseded before changing this document.

---

## Core workflow

```text
email/password signup → email confirmation → onboarding/consent
  → listing draft/autosave → sanitized evidence → atomic activation
  → indexed search → structured offer → atomic acceptance/reservation
  → private conversation/deal → seller completion OR either-party cancellation
  → completed deal → review
```

Material listing edits pause the listing and expire stale offers.

Offer acceptance locks the physical listing(s), reserves them and creates the deal/conversation in one database transaction.

Reviews are permitted only after seller completion. Cancelled deals do not unlock reviews.

Seller completion and either-party cancellation are the current repository lifecycle; historical mutual-confirmation rows remain readable evidence but are not an active mutation path.

Opening a dispute atomically marks the deal and creates its moderation case.

The transaction and state-transition boundaries above are domain invariants. Do not split an atomic domain transition into unrelated application writes unless an explicitly approved architectural change establishes equivalent correctness.

---

## Data privacy and RLS

`profiles` is not publicly selectable.

A security-invoker public projection exposes only allow-listed profile fields.

Email stays in Supabase Auth.

The legacy nullable `phone_verified_at` column remains dormant for forward-migration safety and is not an activation or marketplace-action requirement.

Drafts, conversations, reports, evidence, staff data and verification details remain owner/member/report scoped.

Revoked or suspended members cannot create rows, subscribe to protected Realtime data or upload files.

RLS and database constraints are authoritative security boundaries.

Application checks may provide earlier failures and better UX, but they do not replace database enforcement where the architecture requires it.

Security-sensitive changes to RLS, authorization, identity, moderation access, or privileged RPCs must follow the current R2/R3 controls in `AGENTS.md` and `docs/agents/SECURITY.md`.

---

## Upload pipeline

1. An authenticated active owner requests a quarantine upload record.
2. The Worker validates declared limits and sends the original to private quarantine.
3. The processor detects actual MIME and dimensions, hashes content, re-encodes to safe JPEG/WebP with metadata removed and stores only the derivative in the finalized bucket.
4. The original is deleted; a finalized database record is written with ownership and evidence role.
5. Listing activation counts only finalized, sanitized evidence rows.

Stale and orphan records are removed by scheduled maintenance.

Database backup does not include Storage, so finalized objects use the separate encrypted backup workflow.

The quarantine → validation → normalization → finalized flow is a trust boundary.

Original user uploads must not become marketplace evidence merely because a client declaration or filename appears valid.

---

## Search, Realtime and jobs

`search_listings` combines PostgreSQL full-text search, trigram similarity, brand aliases and typed filters.

Pagination uses an activation timestamp plus UUID cursor, not mutable offsets.

Stable database slugs identify fragrances and listings.

Realtime publishes only conversations, membership, messages, deals and notifications required by the UI; RLS remains the subscriber boundary.

Scheduled jobs expire listings/offers, enqueue expiry notices, enforce retention and clean orphan uploads.

Realtime availability does not authorize additional read or write access. RLS remains authoritative.

---

## Notifications

Database triggers create deduplicated in-app notifications for offers, messages, deal confirmation, reviews, reports, merchant review and listing expiry.

An INSERT-only Database Webhook calls the notification Edge Function.

It authenticates with a dedicated webhook secret, claims a service-role-only delivery ledger row, resolves the address through Auth, validates same-origin action URLs, uses the notification UUID as the Resend idempotency key and records sent/failed state without storing the recipient address in the ledger.

The delivery mechanism must preserve:

- dedicated webhook authentication;
- service-role-only delivery state;
- idempotency;
- same-origin action URLs;
- recipient-address privacy.

A provider or implementation change must preserve equivalent guarantees.

---

## Moderation

Content decisions are made only through target-specific, report-bound RPCs.

Chat inspection requires an assigned `investigating` case and writes an audit event.

Listing/profile/review/comment actions, dispute resolution and merchant decisions are audited.

Unsupported report types fail safely instead of using broad table updates.

Moderation access is case-bound and auditable by design.

Do not replace target-specific moderation RPCs with broad privileged table mutation merely to reduce implementation complexity.

---

## Deployment and observability

`wrangler.jsonc` targets Cloudflare Workers with `nodejs_compat`, static assets, Images binding and structured logs.

CI runs application and real local Supabase tests separately.

Staging and production use different secrets and data.

Production deployment is manually gated by `scripts/check-production-readiness.mjs`; it rejects demo mode, missing providers, unapproved legal content, missing domain/HTTPS and any enabled monetisation path.

Hosted state must not be inferred solely from local configuration or repository files.

Where acceptance requires deployed/provider evidence, follow the repository's hosted verification and launch-gate procedures.

A named release or reconciliation gate authorizes only the mutations explicitly inside that scope.

### Hosted operator boundary

Hosted inspection and hosted mutation are separate capabilities. Read-only inspection may establish target, release, ownership, manifest, and current provider state, but it neither authorizes nor performs a mutation.

For a hosted state transition:

1. bind the operation to one exact authorized target and run;
2. obtain fresh read-only inspection and release evidence;
3. let lifecycle policy select one exact permitted boundary;
4. give the runner only the capability required for that boundary;
5. read back and verify the provider result before persisting manifest evidence and then orchestration state.

An uncertain mutation outcome is a stop condition. It requires fresh inspection and reconciliation; it must not trigger automatic retry, a wider mutation, or a hidden repair path. Local orchestration state is not hosted truth, and a manifest is evidence only for the exact target, run, release, ownership, and provider state it binds.

---

## Launch and deferred boundaries

Perfume checkout, escrow, courier integration, chat attachments, complex decants or splits, subscriptions, and international expansion remain deferred unless separately approved.

Paid additional listings and paid promotion are part of the approved launch model, but existing provider-neutral payment and entitlement scaffolding is not proof that those journeys are implemented, secure, configured, or ready to activate.

Commercial entitlements must remain server-authoritative and fail closed until their implementation, security, provider, business, and production gates pass.

---

## Architecture change discipline

The existing architecture is the default constraint. Treat a change as architectural when it materially changes boundaries such as:

- runtime/service topology;
- authentication or authorization model;
- domain ownership;
- database access pattern;
- RLS responsibility;
- transaction boundaries;
- storage trust boundaries;
- public/private data exposure;
- moderation authority;
- provider responsibility;
- deployment or release safety model.

Such changes must be explicit in task or issue scope, follow the applicable R2/R3 controls, and preserve the authority of `PRODUCT.md`, `DESIGN.md`, and the Launch Readiness design. Do not smuggle architectural redesign into an unrelated bug fix or cleanup.

---

## Core architectural invariant

```text
Browser behavior is constrained by server authorization and RLS.
Server workflows use contracts → services → repositories.
Deterministic marketplace rules remain explicit domain logic.
Sensitive state transitions are database-enforced and atomic where required.
Private data remains private by default.
Hosted/provider behavior must be verified when local evidence cannot prove it.
```
