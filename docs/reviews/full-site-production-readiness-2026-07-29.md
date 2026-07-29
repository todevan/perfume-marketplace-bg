# Full-Site Production-Readiness Review

**Review date:** 2026-07-29  
**Snapshot:** `1ca6c64993b99fd63070cc51f471fdeabb0bdf68`  
**Branch:** `codex/full-site-redesign`  
**Review mode:** Report only; no production code, schema, configuration, or external data was changed.

## Executive assessment

**Overall verdict: Not ready for production or external beta invitations.**

The system has a strong architectural foundation: request-scoped Supabase authentication, default-deny intent, constrained DTOs, substantial RLS and transactional workflow logic, sanitized image processing, report-bound moderation audit, encrypted Storage backups, staged deployment attestation, and broad automated coverage.

Two critical launch blockers remain:

1. Chat/message safety reports can enter the moderation queue but cannot be inspected or resolved through the production admin route.
2. The legal/privacy/appeals package explicitly identifies itself as unfinished and contains placeholders and claims that contradict the closed-beta runtime.

The review also confirmed important defects in runtime fail-closed behavior, active-listing mutation, notification delivery binding, listing evidence, search and inbox pagination, onboarding suspension handling, moderation atomicity, accessibility, deployment gates, and restore safety.

### Severity totals

| Severity | Count | Meaning |
|---|---:|---|
| Critical | 2 | Launch blocker involving trust/safety or knowingly invalid production commitments |
| Important | 28 | Must be corrected before production readiness |
| Minor | 14 | Lower-risk hardening, consistency, maintainability, or test-quality work |

## Scope and coverage map

The review covered all first-party application, database, operational, and test categories. Generated types were used only to validate mappings.

| Portion | Assigned surface |
|---|---|
| 1 | Runtime/build configuration, hooks, layouts, environment, Supabase clients, flags, caching, error handling |
| 2 | Domain rules, contracts, catalogue, demo boundary, payment scaffolding |
| 3 | Core schema, RLS, grants, privacy, invitations, transactional marketplace foundations |
| 4 | Uploads, moderation lifecycle, search, Realtime, jobs, Edge Functions, hosted hardening |
| 5 | Repositories, services, DTO mapping, queries, workflow boundaries |
| 6 | Login/auth routes, onboarding, phone, password, MFA, settings, profiles, merchants |
| 7 | Shared UI, discovery, listings, brands, perfume pages, favorites, wanted and saved searches |
| 8 | Publish wizard, listing detail, evidence upload, image processor, activation lifecycle |
| 9 | Offers, deals, messages, notifications, reports, admin, moderation, legal and safety |
| 10 | CI/deploy, scripts, backup/restore, readiness gates, test architecture, operational docs |

Excluded from line-by-line review: dependencies, generated `database.types.ts`, build/test outputs, binary assets, prototypes, and bundled repository skills. Real-beta staging mutation was not authorized and was not run.

## Confirmed strengths

- Runtime configuration validates canonical origins and fails closed when required production Supabase values are absent (`src/lib/server/env.ts:56-76,127-146`).
- Production requests use a request-scoped PKCE Supabase client and validate identity with `getUser()` before loading authorization state (`src/hooks.server.ts:119-153`, `src/lib/server/auth/context.ts:76-106`).
- Active-beta authorization combines suspension, membership lifecycle, onboarding, email state, and current legal consents (`supabase/migrations/202607220003_beta_access_privacy.sql:393-444`).
- Public profile access uses an allow-listed security-invoker/barrier projection rather than exposing private profile rows (`supabase/migrations/202607220003_beta_access_privacy.sql:903-925`).
- Offer acceptance locks affected listings deterministically and creates reservations, conversation, and deal atomically (`supabase/migrations/202607200001_marketplace_foundation.sql:1642-1771`).
- Deal completion requires both confirmations and atomically finalizes listings, counters, and notifications (`supabase/migrations/202607200001_marketplace_foundation.sql:1841-1908`).
- Upload processing checks actual bytes/MIME/dimensions, re-encodes images, removes unsafe metadata, re-inspects output, and hashes finalized content (`src/lib/server/uploads/image-processor.ts:122-180`).
- Moderation audit is report-bound, target-checked, staff-checked, and append-only (`supabase/migrations/202607220006_moderation_lifecycle.sql:11-93`).
- Listing, offer, deal, and conversation hydration generally uses explicit projections and bounded batch queries rather than row-by-row N+1 access (`src/lib/server/repositories/listings.ts:50-196`).
- CI pins Node 22 and pnpm 11.9, freezes the lockfile, audits dependencies, runs app/database jobs, exercises browsers, and performs Cloudflare dry-runs (`.github/workflows/ci.yml:16-63`).
- The staging deploy is manual, main-only, serialized, SHA-attested, smoke-tested, and has a fail-closed rollback path (`.github/workflows/deploy.yml:9-63`).
- Finalized Storage backups use scrypt and per-object AES-256-GCM; restore verifies size/hash and refuses overwrites (`scripts/storage-backup-crypto.mjs:6-29`, `scripts/restore-finalized-storage.mjs:38-46`).

## Critical findings

### C-01 — Chat/message safety reports cannot be investigated or resolved

- **Evidence:** The database exposes an assigned-case, audited `moderator_read_messages` RPC (`supabase/migrations/202607200001_marketplace_foundation.sql:2233-2288`). The application marks `conversation` and `message` targets unsupported (`src/routes/admin/moderation.server.ts:285-287`), makes them undecidable (`src/routes/admin/moderation.server.ts:456-460`), exposes no inspection action (`src/routes/admin/+page.server.ts:45-87`), and tells staff that these cases must remain open (`src/routes/admin/+page.svelte:186-187`).
- **Impact:** Harassment, fraud, spam, or abusive-message reports enter the queue but staff cannot view the authorized evidence or close the incident. This fails the operational-reporting launch gate.
- **Correction:** Add an AAL2-guarded, report-bound inspection action and UI using `moderator_read_messages`; add target-specific conversation/message resolution RPCs that mutate the target if needed, append audit, and close the report atomically.
- **Missing coverage:** Assigned moderator success; unassigned/wrong-assignee/AAL1 denial; message-to-conversation scoping; audit on every inspection; successful and atomic resolution.

### C-02 — Legal, privacy, and appeals content is explicitly unfinished

- **Evidence:** Terms labels itself an unapproved draft and contains missing controller/company/contact fields (`src/routes/legal/terms/+page.svelte:27-40,60`). It says browsing is unrestricted (`src/routes/legal/terms/+page.svelte:44`), contradicting the default-deny closed beta (`docs/ARCHITECTURE.md:35-37`). Privacy states that legal bases and retention periods are unapproved (`src/routes/legal/privacy/+page.svelte:45-64`). Appeals still exposes placeholder contact/SLA language (`src/routes/legal/appeals/+page.svelte:21-34`).
- **Impact:** External invitations would publish knowingly incomplete regulatory information and inaccurate access commitments.
- **Correction:** Keep `LEGAL_CONTENT_APPROVED=false`; obtain Bulgarian/EU legal approval; populate controller/contact/notice/appeal/retention details; reconcile all copy with the actual invite-only runtime; record and enforce approved document versions.
- **Missing coverage:** Readiness tests that reject draft markers/placeholders, require approved metadata/contact values, and assert that public copy matches closed-beta authorization.

## Important findings

### I-01 — Runtime demo mode can bypass production route policy

- **Evidence:** `PUBLIC_DEMO_MODE=true` returns demo configuration regardless of `APP_ENV` (`src/lib/server/env.ts:103-124`). The hook then skips auth-context loading and route enforcement (`src/hooks.server.ts:110-117`), while protected routes return synthetic private content (`src/routes/dashboard/+page.server.ts:8-13`).
- **Impact:** A runtime binding mistake can turn staging/production into an unauthenticated synthetic marketplace, violating fail-closed behavior.
- **Correction:** Reject demo mode unless `APP_ENV=development`; preferably make it a build/test-only adapter. If protected demo screens are required, enforce policy with an explicit synthetic identity.
- **Missing coverage:** Demo=true under staging/production must fail; hook tests must prove protected/staff routes remain inaccessible.

### I-02 — Authorization and unknown-route errors can miss hardening headers

- **Evidence:** Non-redirect errors from `enforceRoutePolicy` are rethrown before `applySecurityHeaders` (`src/hooks.server.ts:163-188`). Null route IDs return before runtime/header handling (`src/hooks.server.ts:98-99`).
- **Impact:** 403/404 responses can omit CSP, no-store/Vary, request ID, and deployed SHA, reducing security consistency and incident correlation.
- **Correction:** Apply invariant security/correlation headers before guards or through an outer finalization layer; distinguish static assets from unknown application routes.
- **Missing coverage:** Suspended/revoked/wrong-role/unknown-route responses with complete security and correlation headers.

### I-03 — The central policy classifies every `/auth/*` route as public

- **Evidence:** `/auth` is a public prefix (`src/lib/server/auth/guards.ts:13-35`). MFA and password update compensate locally, so the intended default-deny rule depends on duplicated route-local checks.
- **Impact:** A new sensitive auth route becomes public unless its author remembers a second authorization layer.
- **Correction:** Explicitly allow only callback/confirm/reset-request/error routes; centrally classify MFA as staff and update-password as authenticated.
- **Missing coverage:** Enumerate every auth route and assert its intended central policy.

### I-04 — Unexpected service failures are swallowed without an operational record

- **Evidence:** Unknown exceptions become a generic `INTERNAL` result and are returned without logging or rethrowing (`src/lib/server/services/action.ts:55-75`).
- **Impact:** Programming/provider faults do not reach centralized error handling and cannot be correlated with `X-Request-ID`.
- **Correction:** Map only expected failures; log or rethrow unknown failures with sanitized operation/request metadata.
- **Missing coverage:** A throwing handler must produce one redacted structured log and a generic client response.

### I-05 — Wanted-listing input contradicts the product contract

- **Evidence:** Non-swap wanted listings require `maxBudgetMinor`, while physical product fields remain accepted (`src/lib/contracts/listings.ts:154-215`). The product contract makes budget optional and treats wanted entries separately (`docs/PERFUME-CATALOG-AND-UI-SPEC.md:46`).
- **Impact:** Users cannot create budgetless wanted entries, and contradictory wanted rows can carry offer-only physical state.
- **Correction:** Use a discriminated union by listing kind; make wanted budget optional and reject/strip product format, bottle/remaining volume, sealed, price, and estimated value.
- **Missing coverage:** Budgetless wanted entry and rejection of every offer-only field.

### I-06 — Official-sample evidence rules disagree and make the UI path unpublishable

- **Evidence:** The domain rule omits `seal` (`src/lib/domain/listing.ts:58-61`). The UI/test role set uses `fill_level` (`src/lib/components/listing/ListingWizard.svelte:260-264`, `tests/components/evidence.test.ts:21-25`), while database activation requires `seal` (`supabase/migrations/202607220004_workflow_invariants.sql:307-315`).
- **Impact:** A seller following the wizard cannot publish an official sample.
- **Correction:** Define one authoritative evidence-role rule shared by contracts/domain/UI/database; require `product_full`, `manufacturer_label`, `manufacturer_markings`, and `seal`.
- **Missing coverage:** Real draft → four uploads → successful official-sample activation.

### I-07 — Production draft contracts do not enforce 0.1 ml precision

- **Evidence:** Contracts accept arbitrary positive decimals (`src/lib/contracts/listings.ts:152,178-179`), while the unused domain validator requires tenths (`src/lib/domain/volume.ts:73-97`).
- **Impact:** Values such as `65.05` can cross the service boundary and be rounded by persistence, changing authoritative quantities.
- **Correction:** Enforce finite integer tenths at the production contract/service boundary.
- **Missing coverage:** Non-tenth values, boundary tenths, and exact round-trip preservation.

### I-08 — Owners can materially edit active listings without pausing or expiring offers

- **Evidence:** RLS permits owner updates for any non-completed/non-removed listing (`supabase/migrations/202607220004_workflow_invariants.sql:53-59`). The trigger freezes only reserved terms and server timestamps, not active material fields (`supabase/migrations/202607200001_marketplace_foundation.sql:1310-1349`). Authenticated clients retain direct update privilege.
- **Impact:** Sellers can bypass the repository through Supabase REST, change an active item after offers exist, and leave stale offers pending/acceptable.
- **Correction:** Remove general active-row owner updates; introduce a row-locking edit RPC that identifies material changes, pauses the listing, and expires every affected pending offer atomically.
- **Missing coverage:** Direct active update denial and concurrent edit-versus-accept behavior.

### I-09 — Security-critical RLS and concurrency behavior is mostly tested statically

- **Evidence:** Migration contracts search source text (`tests/contracts/migration-security.contract.test.ts:11`); pgTAP coverage focuses on metadata/ACL/function definitions rather than multi-role execution.
- **Impact:** Policy composition, `auth.uid()` semantics, trigger order, races, deadlocks, and rollback behavior can regress while CI remains green.
- **Correction:** Add live local Supabase tests with separate anon/authenticated/service sessions and concurrent connections.
- **Missing coverage:** Invite races, suspension across RLS/Realtime, overlapping offer acceptance, edit/accept, confirm/cancel, duplicate confirmation/review, injected rollback failures.

### I-10 — Notification delivery is not bound to the canonical notification row

- **Evidence:** The Edge Function claims only `payload.record.id`, then resolves recipient and constructs content from request-supplied `profile_id`, title, body, kind, and action URL (`supabase/functions/notification-email/index.ts:117-184`). It never loads/compares `public.notifications`.
- **Impact:** A secret-authenticated mismatched payload can send different content or recipient while the ledger records success for another notification UUID.
- **Correction:** Return canonical recipient/content from the claim RPC or fetch the canonical row after claim and construct the email only from database fields.
- **Missing coverage:** Same UUID with mismatched recipient/content/action must be rejected with zero provider calls.

### I-11 — Required hosted cron jobs can be absent after a successful migration

- **Evidence:** `pg_cron` enablement failure is reduced to a notice, and scheduling silently does nothing when `cron.schedule` is unavailable (`supabase/migrations/202607220007_search_realtime_jobs.sql:1389-1423`).
- **Impact:** Migration history can report success while expiry, cleanup, and notification jobs are missing.
- **Correction:** Fail closed in hosted environments or make exact job inventory a release-blocking post-migration assertion.
- **Missing coverage:** Extension failure and exact expected job names/schedules/commands.

### I-12 — Price sorting is local to each newest-first candidate window

- **Evidence:** The search RPC receives no sort argument and returns at most 60 cursor-ordered rows; price sorting happens afterward in memory (`src/lib/server/repositories/listings.ts:199-285`).
- **Impact:** Cross-page results are not globally price-sorted and can contradict the selected order.
- **Correction:** Implement price ordering and matching keyset pagination inside the search RPC.
- **Missing coverage:** Interleaved prices across multiple windows, ties, null prices, ascending/descending traversal.

### I-13 — Inbox selection and last-message hydration can hide active conversations

- **Evidence:** Memberships are paged by `joined_at`, then only that subset is sorted by conversation activity (`src/lib/server/repositories/conversations.ts:68-90`). Messages use one global cap across all conversations (`src/lib/server/repositories/conversations.ts:94-136`).
- **Impact:** Recently active older memberships may disappear, and one busy conversation can consume the cap so quieter conversations lose previews/unread state.
- **Correction:** Query viewer conversations by `updated_at,id`; hydrate exactly one latest message per conversation via a view/RPC/window query.
- **Missing coverage:** More than 50 conversations, concurrent new messages, one high-volume plus quiet conversations, stable page boundaries.

### I-14 — Received-offer queries build an unbounded historical listing-ID filter

- **Evidence:** Every seller listing ID is fetched without pagination/status bounds and embedded in an `.in()` filter (`src/lib/server/repositories/offers.ts:84-109`).
- **Impact:** Long-lived sellers can exceed PostgREST request/query limits and lose access to received offers.
- **Correction:** Join offers to listings by seller inside a bounded database query/RPC and paginate offers directly.
- **Missing coverage:** Large historical seller inventory and bounded request size.

### I-15 — Suspended users can mutate onboarding state and append consent events

- **Evidence:** The loader rejects suspension, but the action checks only authentication/object presence before changing password and calling consent RPCs (`src/routes/onboarding/+page.server.ts:28-39,48-126`). `accept_beta_consent` explicitly permits suspended memberships (`supabase/migrations/202607220003_beta_access_privacy.sql:686-723`).
- **Impact:** A suspended session can append marketplace consent rows and alter auth state, possibly receiving a failed response after irreversible partial mutations.
- **Correction:** Recheck suspended/revoked state before any action mutation; reject suspended consent at the RPC; consider one transactional onboarding RPC.
- **Missing coverage:** Direct suspended-user POST with no password/consent mutation and database rejection of suspended consent.

### I-16 — Mobile filter drawer has proven submission and keyboard failures

- **Evidence:** The close button inside the GET form lacks `type="button"` (`src/routes/listings/+page.svelte:47-48`). The closed form is only translated off-screen and remains focusable (`src/routes/listings/+page.svelte:47-73,393-410`).
- **Impact:** “Close” submits/navigates, while keyboard users can tab into invisible controls.
- **Correction:** Use a non-submit close control; hide/remove or inert the closed drawer; move focus on open, support Escape, and restore opener focus.
- **Missing coverage:** Mobile URL/submission assertion plus closed/open/Escape/focus-restoration keyboard flow.

### I-17 — Discovery state is lost and wanted pagination is unstable

- **Evidence:** Quick category links preserve only query/category and drop other active filters (`src/routes/listings/+page.svelte:16-21`). `/wanted` uses mutable offsets (`src/routes/wanted/+page.server.ts:14-27`) despite the documented timestamp/UUID cursor contract.
- **Impact:** Category selection silently changes the search, and concurrent activation/removal can duplicate or skip wanted listings.
- **Correction:** Preserve filters while clearing only pagination; migrate wanted listings to validated keyset cursors.
- **Missing coverage:** Combined-filter category changes and insert/remove between wanted pages.

### I-18 — Listing favorite controls ignore initial server state

- **Evidence:** `favoriteState` is always initialized false and no initial-state prop exists (`src/lib/components/ListingCard.svelte:34-37,96-98,182-193`).
- **Impact:** Saved listings render incorrectly and cannot be directly removed from discovery cards.
- **Correction:** Include personalized favorite state in the DTO/prop or present the control as add-only.
- **Missing coverage:** Initial true state and direct unfavorite.

### I-19 — Upload finalization can mutate evidence after concurrent activation

- **Evidence:** Allocation checks draft/paused state, but finalization later locks only the quarantine row and inserts a photo without locking/rechecking the listing (`supabase/migrations/202607220005_uploads_evidence.sql:380-422`). Publication locks/activates independently.
- **Impact:** An upload allocated before publish can finalize afterward, changing evidence on an active listing without pause/material-edit effects.
- **Correction:** Serialize finalization and publication on the listing row; require draft/paused ownership at finalization and account for pending uploads at publication.
- **Missing coverage:** Both transaction interleavings for allocation/finalization versus publication.

### I-20 — Evidence replacement and uniqueness are not enforced server-side

- **Evidence:** Finalization always inserts a new photo with no role replacement/removal (`supabase/migrations/202607220005_uploads_evidence.sql:409-418`). Activation counts rows/roles but not distinct content hashes (`supabase/migrations/202607220004_workflow_invariants.sql:297-305`).
- **Impact:** Obsolete photos/storage accumulate, and one image can be uploaded under four roles to satisfy “four distinct photos.”
- **Correction:** Implement atomic per-role replacement/cleanup and enforce distinct finalized content hashes per listing.
- **Missing coverage:** Replace a role and verify cleanup; identical hashes under different roles must fail activation.

### I-21 — Final-step server validation can strand users on hidden invalid fields

- **Evidence:** Previously reached steps can be revisited/changed and the review step validates only itself; server field errors may map to controls on hidden steps (`src/lib/components/listing/ListingWizard.svelte:307-320,341-364,527-535`).
- **Impact:** Publication fails without exposing or focusing the corrective control, particularly for keyboard/screen-reader users.
- **Correction:** Revalidate every step before publish, navigate to the first invalid step, render its field error, and focus the control.
- **Missing coverage:** Invalidate an earlier field after reaching review and assert step navigation/focus recovery.

### I-22 — Non-deal moderation decisions and report closure are not atomic

- **Evidence:** The target-specific mutation RPC commits first; report closure is a second request (`src/routes/admin/moderation.server.ts:567-590,708-711`). Deal resolution already demonstrates the single-transaction pattern.
- **Impact:** Network/RLS/trigger failure can leave content changed and audited while the report remains investigating.
- **Correction:** Move target mutation, audit, resolution metadata, and report closure into each target-specific RPC transaction.
- **Missing coverage:** Injected closure failure, concurrent decisions, retry/idempotency, all-or-nothing state.

### I-23 — Users cannot attach evidence to reports

- **Evidence:** Contracts/repositories/admin support evidence paths (`src/lib/contracts/reports.ts:34-40`, `src/lib/server/repositories/reports.ts:46-59`), but the form has no upload and the action always sends an empty array (`src/routes/report/+page.svelte:12`, `src/routes/report/+page.server.ts:33-36`).
- **Impact:** Counterfeit/stolen-image reports arrive without primary evidence needed for defensible moderation.
- **Correction:** Add owner-scoped report-evidence quarantine/finalization and attach only validated finalized paths.
- **Missing coverage:** Upload-to-report E2E, ownership substitution denial, MIME/size rejection, signed-URL scoping, orphan cleanup.

### I-24 — Deal “open chat” links can select the wrong conversation

- **Evidence:** Deal cards link only to `/messages` (`src/routes/deals/+page.svelte:25`). Messages defaults to the first conversation unless a matching query parameter is provided (`src/routes/messages/+page.server.ts:63-69`).
- **Impact:** Users with multiple deals can discuss payment/delivery details with the wrong counterparty.
- **Correction:** Include conversation ID in the deal DTO and deep-link to `/messages?conversation=<id>`.
- **Missing coverage:** Multiple simultaneous deals and stale/inaccessible conversation IDs.

### I-25 — Deploy is not gated on the complete CI result

- **Evidence:** Deploy runs only `pnpm test` (`.github/workflows/deploy.yml:39-44`), which excludes Playwright/database validation (`package.json:14-17`). Hosted type drift checks and two Node contract suites are also absent from CI/deploy (`package.json:29-30`, `supabase/tests/*.contract.test.mjs`).
- **Impact:** A SHA with browser/database/type/operator test failures can reach staging if the narrower deploy-local check passes.
- **Correction:** Use a reusable complete pre-deploy workflow or require successful app/database/type/operator checks for the exact dispatched SHA.
- **Missing coverage:** Executable status-gate test and CI proof that hosted type drift and both Node contract suites can fail the pipeline.

### I-26 — Staging mutating commands do not enforce the documented inventory stop conditions

- **Evidence:** The runbook requires inventory of migrations, Auth, Storage, Realtime, jobs, functions, and data (`docs/STAGING-CREDENTIALS.md:225-239`), while the operator verifies project/key/link identity but not that inventory (`scripts/staging-db-operator.mjs:569-629`).
- **Impact:** Push/seed can proceed against the correct project despite unexpected shared-project state or real data.
- **Correction:** Bind every mutating command to a machine-validated, read-only inventory receipt and fail on every documented stop condition.
- **Missing coverage:** Unexpected Auth users, objects, migrations, rows, Realtime/jobs/functions, or signup configuration.

### I-27 — Storage restore is neither target-bound nor safely resumable

- **Evidence:** Restore accepts any Supabase URL/key after a generic flag and has no identity/empty-target preflight (`scripts/restore-finalized-storage.mjs:6-20`). Sequential `upsert:false` restore stops on already-restored objects after interruption (`scripts/restore-finalized-storage.mjs:34-46`).
- **Impact:** Operators can restore to the wrong project, and partial failure leaves no deterministic resume path.
- **Correction:** Require expected project identity, dry-run inventory, empty-target verification, and resumable verified-object accounting.
- **Missing coverage:** Wrong project, non-empty target, partial interruption/resume, duplicate destination, corrupt manifest, DB/Storage reconciliation.

### I-28 — Production readiness validates presence more than deployable identity

- **Evidence:** URL validation accepts credentials/path/query and provider values are checked mainly for presence (`scripts/check-production-readiness.mjs:72-93,150-177`).
- **Impact:** Wrong-project credentials, malformed origins, placeholders, or unreachable providers can satisfy the nominal gate.
- **Correction:** Require credential-free canonical origins, exact approved host/project identity, secret format classes, and read-only provider/runtime attestations.
- **Missing coverage:** Credentialed/path/query URLs, wrong Supabase project/key, placeholders, inaccessible providers.

## Minor findings

### M-01 — Payment purpose flags are not enforced at the gateway boundary

- **Evidence:** Checkout carries a purpose, but the factory checks only global/provider gates (`src/lib/server/payments/types.ts:2,15`, `src/lib/server/payments/factory.ts:17-24`).
- **Impact:** Future callers could process a disabled revenue purpose after global billing is enabled.
- **Correction:** Centralize purpose-to-feature gating before gateway invocation.
- **Missing coverage:** Every purpose denied unless both global and purpose flags are enabled.

### M-02 — `eurosToMoney` can construct an invalid large amount

- **Evidence:** It checks finite/non-negative but not safe integer cents (`src/lib/domain/money.ts:4-10`), while validation later requires safety (`src/lib/domain/money.ts:28-35`).
- **Impact:** The module can create a value violating its own invariant; no production caller currently uses it.
- **Correction:** Reject rounded cent values outside safe integer range.
- **Missing coverage:** Safe boundary and overflow.

### M-03 — HSTS is not configured in repository responses

- **Evidence:** Normal and fail-closed headers omit `Strict-Transport-Security` (`src/hooks.server.ts:26-37,71-81`). The live staging response inspected on 2026-07-29 also omitted HSTS.
- **Impact:** HTTPS persistence depends on an undocumented external Cloudflare control.
- **Correction:** Add production-domain HSTS or document and automatically verify the Cloudflare setting.
- **Missing coverage:** Production/fail-closed response or deployment-control assertion.

### M-04 — Root layout serializes full email and phone unnecessarily

- **Evidence:** Shared auth state includes raw contact fields and is returned to every page (`src/lib/server/auth/types.ts:50-70`, `src/routes/+layout.server.ts:4-10`).
- **Impact:** Private contact data is copied into hydration/navigation payloads without a current shell requirement.
- **Correction:** Keep shared state minimal; load masked contact data only on dedicated pages.
- **Missing coverage:** Root payload excludes raw email/phone.

### M-05 — Cleanup idempotency request records grow indefinitely

- **Evidence:** Each invocation inserts a UUID into `private.upload_cleanup_claim_requests`, and maintenance never retires detached old tokens (`supabase/migrations/202607220007_search_realtime_jobs.sql:961-1003,1176-1297`).
- **Impact:** Permanent operational table/index/backup growth.
- **Correction:** Retain only tokens still referenced by active/stale leases.
- **Missing coverage:** Age completed/outstanding claims and verify safe retention.

### M-06 — Search RPC accepts half a keyset cursor

- **Evidence:** SQL accepts one cursor component without the other (`supabase/migrations/202607220007_search_realtime_jobs.sql:323-328`), although the app contract rejects it.
- **Impact:** Direct authenticated callers can receive duplicate equal-timestamp rows.
- **Correction:** Require both-null or both-present and use tuple comparison.
- **Missing coverage:** Equal timestamps and both half-cursor combinations.

### M-07 — Catalogue pagination cannot traverse beyond 50 matches

- **Evidence:** The RPC request is capped at 50 and then locally offset/sliced (`src/lib/server/repositories/catalog.ts:71-76`).
- **Impact:** Advertised offsets at/above 50 return empty or short pages despite more matches.
- **Correction:** Add database pagination or reject unsupported offsets.
- **Missing coverage:** Offsets 48, 50, and above with more than 50 rows.

### M-08 — Header targets are 42px instead of the required 44px

- **Evidence:** Header controls use 42×42/min-height 42px (`src/lib/components/Header.svelte:295-300,313-319`).
- **Impact:** High-frequency controls miss the project touch-target acceptance rule.
- **Correction:** Increase to at least 44px.
- **Missing coverage:** Computed target sizes across breakpoints.

### M-09 — Canonical concentration label is inconsistent

- **Evidence:** `EXTRAIT` renders as “Extrait” rather than “Extrait de Parfum” (`src/lib/components/listing/presentation.ts:75-82`, spec line 47).
- **Impact:** User-visible normalized terminology drifts from the product contract.
- **Correction:** Use the canonical full label.
- **Missing coverage:** Every concentration label.

### M-10 — Upload endpoint bypasses existing privileged services

- **Evidence:** The endpoint invokes claim/finalize/reject RPCs directly despite dedicated services (`src/routes/api/listing-uploads/+server.ts:134-178`, `src/lib/server/services/privileged-uploads.ts:40-102`).
- **Impact:** Validation, typed mapping, error normalization, and rejection-failure handling can drift.
- **Correction:** Route database transitions through the privileged service boundary.
- **Missing coverage:** Static boundary and endpoint failure-normalization tests.

### M-11 — Generic report form permits invalid deal-dispute combinations

- **Evidence:** `deal_dispute` is unconditional and forwarded unchanged (`src/routes/report/+page.svelte:12`, `src/routes/report/+page.server.ts:33-36`).
- **Impact:** Nonsensical non-deal reports enter the queue; valid deal disputes can miss the atomic workflow.
- **Correction:** Validate the target/reason matrix and route disputes only through the deal action.
- **Missing coverage:** Complete target/reason matrix.

### M-12 — Backup completeness and manifest/path validation are incomplete

- **Evidence:** Backup is driven only by `listing_photos` and does not reconcile the bucket/checkpoint (`scripts/backup-finalized-storage.mjs:25-61`). Restore trusts descriptor/manifest names and paths without strict schema/containment validation (`scripts/storage-backup-crypto.mjs:50-63`, `scripts/restore-finalized-storage.mjs:20-43`).
- **Impact:** Orphans/mismatches are missed; malformed authenticated artifacts can target unintended local/object paths.
- **Correction:** Reconcile both directions, bind database checkpoint/project identity, validate a strict manifest schema, and enforce resolved-path containment.
- **Missing coverage:** Orphan/missing object, concurrent write/checkpoint mismatch, absolute/parent paths, duplicates, invalid bucket/count/salt.

### M-13 — Supported Node runtime is pinned only in Actions

- **Evidence:** CI pins Node 22, but `package.json` has no `engines` declaration or checked-in runtime file.
- **Impact:** Contributors can run unsupported Node 26, matching the observed post-bundle native termination.
- **Correction:** Declare/document Node 22 and fail early outside the supported line.
- **Missing coverage:** Supported runtime matrix and explicit unsupported-runtime failure.

### M-14 — Workflow contracts are brittle source-string checks

- **Evidence:** Deployment/staging contracts use `readFileSync`, substring order, and regex (`tests/contracts/deployment-hardening.contract.test.ts:69-137`, `tests/contracts/staging-smoke.contract.test.ts:283-309`). The staging contract currently fails on Windows CRLF because it searches for a literal LF after the smoke command.
- **Impact:** Platform line endings cause false failures, while YAML/expression semantics and actual status/cancellation behavior remain unproved. One Bulgarian smoke sentinel is also mojibake (`scripts/smoke-staging.mjs:18-23`).
- **Correction:** Parse YAML structurally, normalize line endings, exercise reusable workflows where possible, and repair/test UTF-8 sentinels.
- **Missing coverage:** Expression/status evaluation, cancellation/rollback failure, and each sentinel independently.

## Verification evidence

| Check | Result |
|---|---|
| Catalogue validation | Passed: 196 brands, 48 aliases, all collection memberships resolved |
| Vitest/unit/contracts | 236 passed, 1 failed; failure is the CRLF-sensitive staging workflow string assertion |
| Svelte/type check | Passed with 0 errors and 0 warnings |
| Production Vite/Cloudflare build | Bundle emitted successfully; local Node 26.5 then terminated with Windows status `-1073740791`; CI uses Node 22 |
| Demo Playwright suite | 13 passed, 1 configured mobile overflow case skipped |
| Production dependency audit | No known vulnerabilities |
| Full high-severity audit | No known vulnerabilities |
| Cloudflare staging dry-run | Passed; 156 assets and expected staging bindings recognized |
| Cloudflare production dry-run | Passed bundle/config validation; production runtime secrets remain external |
| Production-readiness script | Failed closed on 35 absent local production requirements, as expected without production secrets/providers |
| Local Supabase reset/lint/pgTAP | Not run: Supabase CLI present, Docker Desktop Linux engine unavailable |
| Real-beta Playwright | Not run: state-changing hosted test not authorized |
| Read-only staging smoke | Failed SHA attestation: deployed `ada151d1fe68a7d12402084818df2f9df15624cd`, reviewed `1ca6c64993b99fd63070cc51f471fdeabb0bdf68` |

## Test-gap matrix

| Workflow stage | Existing evidence | Required addition |
|---|---|---|
| Invite | SQL/contracts and bootstrap tests | Hosted invite email/callback, redemption race, delivery compensation |
| Onboarding | Unit/SQL contracts | Full confirmation → legal versions → phone → activation; suspended direct POST |
| Listing | Demo wizard and image unit tests | Real four-image finalization, official sample, replacement/cleanup, publish race |
| Offer | Real-beta opt-in path | Default behavioral DB concurrency and isolation tests |
| Chat | Demo responsive UI and opt-in messages | Authorization isolation, >50 conversations, audited report inspection |
| Deal | Atomic SQL and opt-in confirmations | Cancel/dispute/concurrent confirmation/rollback scenarios |
| Review | Opt-in submission | Duplicate, premature, wrong-party, cross-deal rejection |
| Moderation | Static/pgTAP contracts | Full report inspection/decision/closure transaction E2E |
| Backup/restore | Crypto unit tests | Wrong-target, completeness, Storage integration, interruption/resume, coordinated DB checkpoint |
| Deployment | Source-string contracts | Executable exact-SHA CI status gate, type drift, rollback/cancellation semantics |

## Recommended remediation order

1. Keep external invitations and legal approval disabled.
2. Implement chat/message investigation and atomic resolution, then finalize legally approved content.
3. Close database integrity gaps: active listing edits, notification canonical binding, upload/publish serialization, evidence uniqueness/replacement, cron verification.
4. Unify listing-kind/evidence/volume contracts and repair the official-sample path.
5. Correct search/inbox/offer query pagination and deal-to-chat routing.
6. Close suspended onboarding and central auth-policy/header gaps.
7. Repair mobile filter/favorite/wizard accessibility and state behavior.
8. Harden deploy status/type/test gates, staging inventory, production attestation, and resumable target-bound restore.
9. Run live Supabase behavioral/concurrency tests under Node 22 with Docker available.
10. Re-run the complete CI, Cloudflare dry-runs, read-only staging attestation, authorized real-beta lifecycle, and a restore rehearsal before changing the readiness verdict.

## Remediation update — 2026-07-29

This section records the report-first remediation pass requested after the
review. It supersedes the verification counts above but preserves the original
findings and evidence as the audit baseline.

### Finding disposition

| Finding | Disposition | Implemented correction |
|---|---|---|
| C-01 | Remediated | Added report-bound conversation inspection, staff UI/actions, and atomic message/conversation decisions through `resolve_conversation_report`; deleted message bodies are redacted in the application projection. |
| C-02 | External blocker; fail-closed gate strengthened | Legal draft markers remain intentionally unchanged pending Bulgarian counsel. Production release now requires approved content, controller/contact identity, a legal approval reference, and fresh release receipts. |
| I-01 | Remediated | Demo mode is development-only and the production gate requires `PUBLIC_DEMO_MODE=false`. |
| I-02 | Remediated | Redirects, authorization failures, unknown routes, and bootstrap 503 responses pass through the central security-header policy. |
| I-03 | Remediated | Only an explicit allow-list of authentication endpoints is public; unknown `/auth/*` paths default deny. |
| I-04 | Remediated | Expected failures remain normalized; unexpected failures now throw to the SvelteKit error boundary and produce sanitized structured logs with request ID, route, method, status, operation, and error type. |
| I-05 | Remediated | Wanted drafts allow no budget and persist no physical product format, bottle amount, remaining amount, or sealed state; the database constraint is validated. |
| I-06 | Remediated | Official-sample evidence uses the same four canonical roles in domain, UI, tests, and database activation, including `seal`. |
| I-07 | Remediated | Draft contracts enforce 0.1 ml precision and matching tests cover accepted/rejected values. |
| I-08 | Remediated | Active material edits and reserved edits are denied; pausing/removing an active listing expires pending offers against either side of its terms. |
| I-09 | Remediated locally; hosted race rehearsal pending | Added executable pgTAP role/RLS/workflow tests against a reset PostgreSQL 17 stack. The authorized hosted multi-connection concurrency rehearsal remains a release step. |
| I-10 | Remediated | Notification delivery claims recipient and message content from the canonical notification row; caller-supplied recipient/content is no longer trusted. |
| I-11 | Remediated | A service-only exact runtime inventory RPC and fresh, target/commit-bound receipt make missing cron or Realtime inventory release-blocking. |
| I-12 | Remediated | Sort-aware database keyset pagination supports newest, ascending price, and descending price without local window sorting. Legacy search execution is revoked. |
| I-13 | Remediated | Bounded latest-message hydration is performed for all selected conversations before inbox ordering/selection. |
| I-14 | Remediated | Received offers use a bounded report-shaped RPC instead of constructing an unbounded listing-ID filter. |
| I-15 | Remediated | Onboarding actions re-check request state, and suspended users are rejected at both route and consent-RPC boundaries. |
| I-16 | Remediated | Mobile filtering has a real submit path, dismiss behavior, focus handling, and acceptance coverage. |
| I-17 | Remediated | Discovery query state is preserved; wanted pagination is production keyset-only with malformed cursors rejected. |
| I-18 | Remediated | Favorite controls hydrate and render authoritative initial server state and update in place after enhanced actions. |
| I-19 | Remediated | Upload finalization locks and re-checks the listing before changing finalized evidence, closing the activation race. |
| I-20 | Remediated | Finalization replaces a role atomically, enforces canonical paths/source linkage, and activation requires four distinct finalized hashes. |
| I-21 | Remediated | Final validation maps server field errors back to the owning wizard step and focuses the invalid control. |
| I-22 | Remediated | Moderation decision audit and report closure occur in one database transaction; a closure failure rolls the audit insert back. |
| I-23 | Remediated | The report form accepts up to four validated JPEG/PNG/WebP/PDF evidence files; only the server service role can create report-evidence objects, and failed submissions clean them up. |
| I-24 | Remediated | Deal DTOs carry the persisted conversation ID and “open chat” links target that exact conversation. |
| I-25 | Remediated | Staging deploy verifies the complete successful GitHub Actions CI check set for the exact Git SHA before install/deploy. |
| I-26 | Remediated | Mutating staging commands require an exact migration/Auth/Storage/data/Realtime/job/function inventory receipt and refuse mismatched targets. |
| I-27 | Remediated | Restore requires an explicit target ref, coordinated database checkpoint, exact manifest/database inventory, path containment, empty target or verified resume state, and post-upload integrity checks. |
| I-28 | Remediated | Production readiness validates credential shapes and fresh JSON receipts bound to the exact commit, app host, Supabase ref, Cloudflare account, exact runtime inventory, and seven explicit provider checks. Receipt byte hashes are verified. |
| M-01 | Remediated | Payment access is purpose-gated; disabled or unrelated payment purposes cannot obtain a provider. |
| M-02 | Remediated | Euro conversion rejects any cent result outside `Number.isSafeInteger`. |
| M-03 | Remediated | Production HTTPS responses include one-year HSTS with subdomains, including bootstrap failures. |
| M-04 | Remediated | Root layout auth payload no longer serializes email or phone. |
| M-05 | Remediated | Old detached cleanup claim tokens are pruned in bounded batches. |
| M-06 | Remediated | Search v2 rejects half cursors at the database boundary; authenticated execution of the legacy RPC is revoked. |
| M-07 | Remediated | Catalogue search v2 supports database offset/limit pagination beyond 50 results; legacy execution is revoked. |
| M-08 | Remediated | Header and favorite controls meet the 44 px minimum target. |
| M-09 | Remediated | All concentration labels come from one canonical map, including “Extrait de Parfum” and the unspecified label. |
| M-10 | Remediated | The upload endpoint routes claim/finalize/reject transitions through privileged services and records rejection-ledger failures without skipping cleanup. |
| M-11 | Remediated | The report reason/target matrix is shared by parser and UI; `deal_dispute` remains exclusive to the atomic deal workflow. |
| M-12 | Remediated | Backup reconciles database and bucket in both directions, rechecks a database checkpoint, and uses strict encrypted descriptor/manifest validation. Restore validates identity, containment, inventory, resumability, and final content. |
| M-13 | Remediated | Node 22 is pinned in `package.json`, `.nvmrc`, `.node-version`, CI, and deploy workflows. |
| M-14 | Remediated | Workflow contracts parse YAML 1.2 structurally and assert jobs, triggers, steps, expressions, environments, order, and rollback semantics without line-ending-sensitive source matching. UTF-8 smoke sentinels are repaired. |

### Post-remediation verification

| Check | Result |
|---|---|
| Frozen dependency graph | `pnpm 11.9.0 install --frozen-lockfile` passed |
| Catalogue | Passed: 196 brands, 48 aliases, exact `80/80/80/80/15` collections |
| Vitest/component/contracts | 31 files, 257 tests passed |
| Node database contracts | 25 passed |
| Local PostgreSQL/Supabase | Reset through migration `011` passed |
| SQL lint | Zero warnings/errors with `--fail-on warning` |
| pgTAP | 4 files, 132 assertions passed, including new authenticated/service/staff behavior |
| Svelte/type check | 0 errors, 0 warnings |
| Production build | Passed with the Cloudflare adapter |
| Playwright | 13 stable tests passed in desktop Chromium/configured mobile; 5 opt-in/state-changing tests skipped by configuration |
| Cloudflare dry-runs | Staging and production passed; 157 assets and expected bindings recognized |
| Dependency audits | Production and full high-severity audits report no known vulnerabilities |
| Production readiness | Correctly remains failed closed without approved legal copy, production credentials, and fresh target-bound receipts |

The local verifier is running Node 26.5, so pnpm correctly reports an
unsupported-engine warning; the supported/runtime-pinned release line is Node
22. No lockfile exception was used.

### Remaining launch blockers and verdict

The code-remediable findings are closed, but the marketplace is still **Not
ready for production** because the following external or state-changing release
work is deliberately incomplete:

1. Bulgarian counsel has not approved the Terms, Privacy, and Appeals copy
   (C-02).
2. Forward migration `011` and its exact runtime inventory have not been
   applied/attested on the hosted production target.
3. Production Supabase, Cloudflare Images, Resend, Turnstile, Twilio, webhook,
   and cleanup provider checks have not produced fresh commit-bound receipts.
4. The real invite-to-review and AAL2 moderation Playwright suite was not run
   because it mutates hosted beta state and still requires separate
   authorization.
5. A coordinated remote backup/restore rehearsal and hosted multi-connection
   race suite remain release operations.

The readiness verdict can move to **Ready with fixes** only after these
artifacts and authorized rehearsals pass the fail-closed gate for one exact
release commit.
