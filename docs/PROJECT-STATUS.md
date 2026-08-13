# Project Status

## Purpose and evidence hierarchy

This file is the concise living operational snapshot: current phase/gate, material blockers, important merged/released state, and the next authorized work. It is not the durable roadmap, an architecture specification, historical audit log, or executable queue.

When status claims conflict, prefer explicit current owner instructions, approved gate/plan evidence, verified hosted receipts, merged Git/GitHub state, and current issue/PR state over older prose in this snapshot. Do not infer provider, deployment, migration, or gate completion from local source alone.

GitHub Issues are the canonical executable queue. Update this file only for material state transitions; replace stale claims instead of appending routine command history.

Last updated: 2026-08-13

## Current repository evidence

PR #12, `feat: add hosted A9 provisioning runner`, is merged into `main` at `b828daf38252df9b33c7bb622c761c1ad827770e`.

This proves the A9 runner integration is present in the current main lineage. It does not prove Hosted A9 execution, provider convergence, or A9 gate closure; those require the applicable hosted evidence.

## Current verdict

**Gate 3 staging reconciliation: active.**
**A7 and A8: complete.**
**A9 runner integration: merged; Hosted A9 execution and closure remain outstanding.**
**Production readiness: not achieved.**

Gate 3 remains open at A9. PR #12 provides the merged target-locked runner foundation, but local implementation and merge evidence do not prove hosted actor provisioning, hosted acceptance, cleanup, or gate closure. Production and later gate work remain outside this status boundary.

The full repository audit remains recorded in [AUDIT-2026-08-02.md](./AUDIT-2026-08-02.md). Its dated invite/phone observations are historical and are superseded by the 2026-08-02 owner decision for current behavior.

The Phase 2 material below is retained as historical implementation evidence from the prior main snapshot. It is not the current executable queue or Gate 3 checklist.

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

## Historical Phase 2 hosted checklist

1. Apply migrations `012`, `013` and `014` to the authorized Frankfurt staging project with the updated cleanup Worker and report application cutover.
2. Enable public email/password signup in hosted Supabase Auth while keeping anonymous signup disabled and email confirmation enabled.
3. Configure and verify transactional email, Turnstile and the complete registration → confirmation → onboarding → marketplace lifecycle with synthetic accounts.
4. Regenerate hosted database types/receipts after migration and verify that the Worker deployment uses the updated auth and evidence behavior.
5. Run hostile hosted evidence acceptance for cross-user access, finalization, one-time attachment, assigned AAL2 reads, abandoned-object cleanup and malformed/chunked uploads.

No hosted database, Auth setting, Worker or provider was changed during this local implementation.

## Historical Phase 2 blocker snapshot

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

The next change batch should be selected through the authorized issue/gate scope rather than combining unrelated security, database, provider, legal and UX work. Ordinary reversible engineering does not require routine owner approval; Human Gates remain authoritative where autonomy ends.
