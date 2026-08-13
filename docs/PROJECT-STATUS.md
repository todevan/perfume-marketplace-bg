# Project Status

Last updated: 2026-08-13

## Current verdict

**Local engineering baseline: healthy.**
**Gate 3 staging reconciliation: active.**
**A7: closed. A8: closed. A9: unresolved.**
**Production readiness and production execution: not authorized.**

The active operational track is Gate 3 staging reconciliation, specifically the A9 authenticated hosted-actor evidence boundary. Local code or a locally verified operator foundation does not equal merged, deployed, hosted evidence, or gate closure. Current hosted Auth, migration, Worker, provider, actor, and deployment state must be freshly verified under the authorized gate; it must not be inferred from historical receipts.

Current repository evidence for this snapshot: branch `codex/current-main-20260813`; `HEAD` is `9cc7af960243fbecb5646b55c1bc4180df1f9098`; `origin/main` remains `b00516e6b7c8d870aa18da9e36775f1d13d3c542`. Graphify is indexed at the origin baseline `b00516e6b7c8d870aa18da9e36775f1d13d3c542` with 4,920 nodes, 11,781 edges, and 224 communities; its indexed tree was not available.

The full repository audit remains recorded in [AUDIT-2026-08-02.md](./AUDIT-2026-08-02.md). Its dated invite/phone observations are historical and are superseded by the 2026-08-02 owner decision for current behavior.

## Auth simplification completed locally

- Public registration now calls Supabase email/password `signUp`, persists validated username/account-kind metadata and sends users through email confirmation and onboarding.
- Login and confirmation claim invite-free pending membership through the authenticated `claim_open_registration()` RPC.
- Forward-only migration `202608020012_open_email_password_registration.sql` permits invite-free membership and preserves pending-to-active onboarding semantics.
- The admission RPC is restricted to direct email/password users; Supabase-invited users remain isolated for the operator-only first-administrator bootstrap.
- The phone OTP route and phone requirements were removed from account activation, listing drafts/uploads/publication, offers and merchant applications.
- Database-authoritative phone checks were removed only from the latest listing-activation and offer-write trigger functions. Their active-membership, evidence, quota, ownership, transition and moderation invariants remain unchanged.
- The ordinary admin beta-invitation action and UI were removed. Legacy invite records/RPCs remain only for compatibility and first-admin bootstrap.
- Invite/SMS feature flags and provider-readiness requirements were removed from current runtime and deployment documentation.
- Login, registration, onboarding, navigation and affected marketplace copy now describe open email/password access.

## Preserved security and product invariants

- Supabase session handling remains server-side through secure SSR cookies and authoritative `getUser()` validation.
- Email confirmation, current legal consents, the 18+ declaration and completed onboarding remain required before active marketplace access.
- Suspended or revoked membership is not reactivated by open-registration admission.
- Staff/admin routes and central database staff/admin predicates require the existing role checks and AAL2 MFA.
- Report-evidence Storage reads now require attached ledger state and are limited to the reporter or the assigned AAL2 moderator of an investigating case.
- Payments, monetisation and unrelated roadmap behavior were not changed.
- Legacy nullable phone state remains dormant for forward-migration compatibility; it is not an activation or marketplace-action gate.

## Completed local security evidence retained for provenance

The following Phase 2 sections record completed local evidence and preserved invariants. They are not the current operational phase; the current phase and gate are Gate 3/A9 above.

## Phase 2 staff MFA hardening completed locally

- Forward-only migration `202608020013_staff_mfa_enforcement.sql` adds a private, fail-closed current-request assurance helper.
- `public.is_staff(uuid)` and `public.is_admin(uuid)` retain their existing signatures, active-membership, role, suspension and caller-identity checks while requiring AAL2 for authenticated staff requests.
- The service role remains the explicit trusted-system bypass for scheduled and operator workflows.
- Existing privileged RLS policies and RPCs inherit the AAL2 boundary through the central staff/admin predicates; no existing policy or RPC definition was weakened.
- Hostile-client pgTAP coverage proves AAL1, missing-assurance and unknown-assurance staff JWTs are denied, including a direct moderation RPC attempt; AAL2 and service-role paths remain authorized.

## Phase 2 request and report-evidence hardening completed locally

- Listing/report multipart parsing now bounds the actual Web Stream, total bytes, per-file bytes, file/part counts and multipart header bytes instead of trusting `Content-Length` or materializing an unbounded form first; hostile rejection or non-settling upstream cancellation cannot mask or delay HTTP 413.
- The notification email webhook requires a secret of at least 32 bytes, bounds the actual JSON stream and provider I/O to ten seconds, durably records transport/non-2xx failures, and treats a provider 2xx with unusable response metadata as terminally accepted with an auditable internal sentinel to prevent duplicate retries, without logging recipient data.
- The owner-approved report policy accepts JPEG, PNG, WebP and AVIF sources, decodes and re-encodes them to a non-animated WebP no larger than 10 MiB or 2,400 pixels per dimension, and rejects PDFs until a dedicated scanner exists.
- Forward-only migration `202608020014_report_evidence_hardening.sql` adds server-generated allocations, service-only finalization/rejection/expiry, one-time atomic report attachment and case-bound evidence reads.
- Rejected, deleted and expired evidence is placed on the existing leased cleanup queue; the cleanup Worker now sweeps abandoned allocations in bounded batches and accepts the `report-evidence` bucket.
- Thrown allocation, upload, finalization and ambiguous report-submission failures reconcile only unattached allocations through a service-only batch RPC; reconciliation transport failures are logged and bounded expiry remains the fallback, while evidence already attached by a committed report is never directly deleted by the route.
- Hostile pgTAP coverage proves raw-path and reuse rejection, object-existence finalization, ledger ACLs, owner reads, unassigned/AAL1 moderator denial, assigned AAL2 access, cross-staff assignment compatibility and durable rejection/expiry cleanup.

## Verification snapshot

| Command/check | Result |
| --- | --- |
| Node version | `v22.23.2` |
| pnpm version | `11.9.0` |
| `pnpm validate:catalog` | Passed; 196 brands and 48 aliases |
| `pnpm run test` | Passed; 35 files and 286 tests, plus Svelte check and production build |
| `pnpm run check` | Passed; 0 errors and 0 warnings |
| `pnpm run db:lint` | Passed; no warnings in `extensions`, `private` or `public` |
| `pnpm run db:test` | Passed; 6 pgTAP files and 185 assertions |
| `pnpm run test:db:contracts` | Passed; 25 tests |
| Clean local database reset | Passed; migrations `001` through `014` applied successfully |
| `pnpm run test:e2e` | Passed; 13 passed and 5 intentional skips |
| Focused request/Edge contracts | Passed; 4 files and 28 tests |

## Hosted staging work still required

1. Apply migrations `012`, `013` and `014` to the authorized Frankfurt staging project with the updated cleanup Worker and report application cutover.
2. Enable public email/password signup in hosted Supabase Auth while keeping anonymous signup disabled and email confirmation enabled.
3. Configure and verify transactional email, Turnstile and the complete registration → confirmation → onboarding → marketplace lifecycle with synthetic accounts.
4. Regenerate hosted database types/receipts after migration and verify that the Worker deployment uses the updated auth and evidence behavior.
5. Run hostile hosted evidence acceptance for cross-user access, finalization, one-time attachment, assigned AAL2 reads, abandoned-object cleanup and malformed/chunked uploads.

No hosted database, Auth setting, Worker or provider was changed during this local implementation.

## Highest-priority unresolved blockers

1. Treat the credential-shaped Resend value in `.env.example` as exposed: rotate it, inspect provider activity, and blank the example.
2. Verify report evidence ownership and cleanup against hosted Supabase.
3. Obtain owner/legal decisions for immutable moderation evidence retention and message edit/delete/block behavior.
4. Add hostile-client coverage for the remaining direct messaging boundaries and real multi-session offer/block/report races.
5. Finalize legal documents, retention, data export, and account deletion/anonymization.
6. Configure and verify Turnstile, Resend, Cloudflare Images, webhooks, Edge Functions and schedulers. SMS is no longer required.
7. Prove backups through a restore rehearsal and configure monitoring/alerts.
8. Add a protected production deployment path and complete real hosted lifecycle tests.

## Scope boundary and known deferred copy

The legal Phase 4 pages still contain draft closed-beta/verified-phone language. They were deliberately not changed because the owner excluded unrelated Phase 4 work; those pages must be reconciled during legal review before external launch. Historical audits and reviews were not rewritten.

The next change batch should remain independently selected and approved rather than combining the remaining security, database, provider, legal and UX work.

## Reconciled owner guidance

Owner-maintained documentation confirms durable boundaries that remain applicable: the marketplace is off-platform for payment and delivery; verified-merchant status is a trust signal rather than monetization; backup completeness requires PostgreSQL plus compatible finalized Storage objects; and hosted or destructive operations require explicit gate/Human Gate authorization. These are durable constraints, not replacements for the operational facts above.

The current operational facts in this file remain authoritative for this repository baseline: Phase 2 local hardening is complete, hosted evidence acceptance and owner decisions on messaging/moderation/blocking remain blockers, and no hosted provider or production state is inferred from manual documentation.

Manual Gate 3/A9 documents remain historical planning material. They are not current evidence of hosted Auth, migration, Worker, provider, deployment, or environment health and do not authorize hosted mutation.
