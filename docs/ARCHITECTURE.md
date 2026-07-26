# Architecture

## Runtime shape

The application is a SvelteKit/TypeScript modular monolith deployed as a Cloudflare Worker with static assets. Supabase provides PostgreSQL, Auth, private Storage and Realtime. Resend handles email, Twilio is configured through Supabase Auth for Bulgarian phone OTP, Turnstile protects sensitive forms, and Cloudflare Images performs trusted image normalization.

```text
Browser
  ├─ SSR pages and validated SvelteKit form actions
  └─ authorised Supabase Realtime subscriptions only
             │
Cloudflare Worker / SvelteKit
  ├─ request-scoped cookie PKCE client
  ├─ authentication, beta, phone, role and MFA guards
  ├─ Zod input contracts → services → repositories
  └─ private upload processor and structured request logs
             │
Supabase
  ├─ PostgreSQL functions, constraints, RLS and scheduled jobs
  ├─ Auth users (email and phone remain private)
  ├─ quarantine/finalized private Storage
  ├─ report-bound moderation and immutable audit
  └─ Realtime messages and notifications
             │
Database Webhook → notification Edge Function → Resend
```

## Runtime modes

- `PUBLIC_DEMO_MODE=true` is an explicit local/test fixture adapter. No external identity or persistent writes are implied.
- Production mode fails closed when Supabase configuration or verified identity loading fails.
- Production routes use repository/service DTOs; database row shapes do not reach components.
- `robots.txt` denies indexing and `sitemap.xml` returns 404 during the closed beta.

## Authentication and access

`hooks.server.ts` creates one request-scoped `@supabase/ssr` client, reads cookies and validates identity with `getUser()` before loading the profile, beta membership and AAL. Route policy is default-deny: only login, auth callbacks, legal and safety routes are public. Onboarding and phone verification require an authenticated invitee; all marketplace routes require active beta membership; staff routes additionally require role and AAL2.

An administrator creates a hashed one-time database invite and then asks Supabase Auth to send the invitation. The raw token exists only in that confirmation URL. Delivery failure revokes the database invite. Callback redemption and onboarding record accepted document versions and the 18+ declaration before activation.

## Application boundaries

- `src/lib/contracts` contains parsed input and stable UI DTO contracts.
- `src/lib/server/repositories` is the only ordinary query/RPC boundary.
- `src/lib/server/services` enforces request-level workflow rules and maps repository failures.
- `src/lib/domain` contains deterministic marketplace rules.
- `src/routes/**/+page.server.ts` and endpoints own authorization and HTTP semantics.
- Browser code may subscribe to rows already allowed by RLS, but does not write directly to Supabase.

## Core workflow

```text
invite → onboarding/consent → phone OTP
  → listing draft/autosave → sanitized evidence → atomic activation
  → indexed search → structured offer → atomic acceptance/reservation
  → private conversation/deal → two confirmations → completed deal → review
```

Material listing edits pause the listing and expire stale offers. Offer acceptance locks the physical listing(s), reserves them and creates the deal/conversation in one database transaction. Reviews are permitted only after both parties confirm completion. Opening a dispute atomically marks the deal and creates its moderation case.

## Data privacy and RLS

`profiles` is not publicly selectable. A security-invoker public projection exposes only allow-listed profile fields. Email and phone stay in Supabase Auth; the application stores only `phone_verified_at`. Drafts, conversations, reports, evidence, staff data and verification details remain owner/member/report scoped. Revoked or suspended beta users cannot create rows, subscribe to protected Realtime data or upload files.

## Upload pipeline

1. An authenticated, phone-verified owner requests a quarantine upload record.
2. The Worker validates declared limits and sends the original to private quarantine.
3. The processor detects actual MIME and dimensions, hashes content, re-encodes to safe JPEG/WebP with metadata removed and stores only the derivative in the finalized bucket.
4. The original is deleted; a finalized database record is written with ownership and evidence role.
5. Listing activation counts only finalized, sanitized evidence rows.

Stale and orphan records are removed by scheduled maintenance. Database backup does not include Storage, so finalized objects use the separate encrypted backup workflow.

## Search, Realtime and jobs

`search_listings` combines PostgreSQL full-text search, trigram similarity, brand aliases and typed filters. Pagination uses an activation timestamp plus UUID cursor, not mutable offsets. Stable database slugs identify fragrances and listings.

Realtime publishes only conversations, membership, messages, deals and notifications required by the UI; RLS remains the subscriber boundary. Scheduled jobs expire listings/offers, enqueue expiry notices, enforce retention and clean orphan uploads.

## Notifications

Database triggers create deduplicated in-app notifications for offers, messages, deal confirmation, reviews, reports, merchant review and listing expiry. An INSERT-only Database Webhook calls the notification Edge Function. It authenticates with a dedicated webhook secret, claims a service-role-only delivery ledger row, resolves the address through Auth, validates same-origin action URLs, uses the notification UUID as the Resend idempotency key and records sent/failed state without storing the recipient address in the ledger.

## Moderation

Content decisions are made only through target-specific, report-bound RPCs. Chat inspection requires an assigned `investigating` case and writes an audit event. Listing/profile/review/comment actions, dispute resolution and merchant decisions are audited. Unsupported report types fail safely instead of using broad table updates.

## Deployment and observability

`wrangler.jsonc` targets Cloudflare Workers with `nodejs_compat`, static assets, Images binding and structured logs. CI runs application and real local Supabase tests separately. Staging and production use different secrets and data. Production deployment is manually gated by `scripts/check-production-readiness.mjs`; it rejects demo mode, missing providers, unapproved legal content, missing domain/HTTPS and any enabled monetisation path.

## Deferred by design

Perfume checkout, delivery, attachments in chat, decants/splits/attar formats, boosts, subscriptions, ads and all platform payments remain disabled. The provider-neutral payment code is future scaffolding and is outside the closed-beta transaction flow.
