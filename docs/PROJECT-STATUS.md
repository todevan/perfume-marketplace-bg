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
# Project Status

## Purpose

This document is the repository's living operational status snapshot.

It answers:

- where the project is now;
- what was most recently completed;
- what is currently active;
- what is blocked;
- what the next authorized work is;
- which important boundaries must not be crossed.

It is not:

- the durable product roadmap;
- the architecture specification;
- the full audit history;
- the autonomous issue queue;
- a substitute for gate-specific evidence.

For those authorities, use:

- `docs/MASTER-PLAN.md`
- `docs/ARCHITECTURE.md`
- `docs/LAUNCH-GATES.md`
- applicable plans under `docs/superpowers/plans/`
- GitHub Issues
- applicable files under `docs/agents/`

Update this file when operational state materially changes.

Do not turn it into a chronological log of every command, test or agent session.

---

## Last updated

2026-08-11

---

# Current verdict

**Local engineering baseline: healthy.**

**Gate 3 staging reconciliation: active.**

**A7: complete.**

**A8: complete.**

**A9: active and not yet closed.**

**Production readiness: not yet achieved.**

Current execution is focused on completing the authenticated hosted-actor evidence required by A9 without crossing into later gate work or unrelated provider/production mutations.

Production remains outside the current authorized execution scope.

---

# Current phase and gate

Broad roadmap phase:

```text
Phase 3 — Activate and reconcile required staging providers
```

Current detailed work:

```text
Gate 3 staging reconciliation
```

Recent sequence:

```text
A7 — completed
A8 — completed
A9 — active
```

Named-gate scope remains authoritative.

If the current task says:

```text
A9 only
```

that does not authorize:

- earlier prerequisite mutations outside A9;
- later gate work;
- unrelated provider cleanup;
- production changes;
- architecture expansion;
- opportunistic remediation outside the applicable repair budget.

---

# Current merged baseline

The latest confirmed merged `main` baseline from the completed A8 closure is:

```text
8592c1524842b829b76a83df89a4b9b2cca47e5f
```

A8 merge:

```text
PR #11
```

The prior A7 release was merged through:

```text
PR #10
```

Do not assume a later local or isolated-worktree commit is part of `main` unless Git/GitHub evidence proves it.

Exact SHA and tree convergence remain required wherever a gate explicitly depends on them.

---

# Recently completed

## A7

A7 was completed on staging and durably merged.

Verified outcomes included:

- exact source/deployment convergence;
- canonical staging smoke passing;
- native Turnstile evidence for login and registration paths;
- safe rollback behavior;
- staging Worker deployment verification.

The authenticated `report_submit` path was intentionally deferred to the later authenticated-actor gate rather than being forced into A7 scope.

A7 evidence must not be rerun or rewritten merely because later gates are active unless the current gate explicitly requires it.

---

## A8

A8 was completed operationally on staging and durably merged into `main`.

Its closure resolved the A8-specific staging reconciliation boundary and produced the current confirmed merged baseline:

```text
8592c1524842b829b76a83df89a4b9b2cca47e5f
```

A8 is closed.

Do not reopen A8 implementation while working on A9 unless new verified evidence proves A8 itself is invalid.

A dependency discovered during A9 that belongs to A8 or an earlier provider step does not automatically authorize mutating that earlier scope.

---

# A9 current state

A9 is the active Gate 3 boundary.

The objective is to obtain the required authenticated hosted evidence using controlled synthetic actors and target-locked operations.

An earlier A9 preflight identified two distinct blockers:

1. hosted signup/provider state had to match the prerequisite sequence before A9 actor creation could proceed;
2. merged source did not yet contain all target-locked operator capabilities required for complete A9 actor preparation and attestation.

The missing A9 operator foundation was subsequently implemented and locally verified in an isolated exact-main worktree.

The A9 foundation result was:

```text
A9FoundationResult=PASS
```

The foundation work was based on:

```text
8592c1524842b829b76a83df89a4b9b2cca47e5f
```

and was intentionally limited to the A9 operator/evidence surface.

The confirmed foundation change set was limited to:

```text
scripts/hosted-report-evidence-operator.mjs
tests/scripts/hosted-report-evidence-operator.test.ts
tests/e2e/hosted-report-evidence.spec.ts
```

The foundation added or prepared target-locked capabilities needed for A9, including authenticated hosted actor/operator support.

This foundation result does **not** by itself mean A9 is complete.

A9 remains open until the required hosted execution, evidence, verification and durable repository closure have all passed.

Do not treat isolated-worktree preparation as merged or deployed state without independent Git/GitHub/provider evidence.

---

# Current A9 boundary

Before performing hosted mutation, verify the exact prerequisites required by the authoritative A9 plan.

Do not infer provider state from an earlier session.

In particular, verify rather than assume:

- the intended hosted Auth signup state;
- the exact staging Supabase target;
- required A9 credentials/secrets;
- required actor provenance;
- target-lock protections;
- current merged source;
- whether the required A9 operator implementation has been durably merged before relying on it for hosted execution.

If a prerequisite belongs to a prior gate or requires an owner/provider action outside current autonomous authority:

- stop at that exact boundary;
- preserve completed valid work;
- record the blocker;
- use the applicable Human Gate or dependency path;
- do not silently broaden A9.

---

# A9 completion criteria

A9 must not be marked complete merely because:

- local tests pass;
- actor helper code exists;
- a synthetic user can log in;
- an operator script runs;
- a specialist reports success.

Closure requires the evidence defined by the authoritative Gate 3 reconciliation plan.

At minimum, the A9 closure must distinguish:

```text
local implementation evidence
≠
merged repository evidence
≠
hosted staging evidence
≠
complete gate closure
```

Where the plan requires authenticated hosted actors, AAL2 moderator behavior, report evidence, provenance or target-locked provider operations, those conditions must be proven directly.

---

# Security and architecture invariants still in force

The following remain non-negotiable while staging work continues:

- authentication identity is server-validated;
- active membership remains required for marketplace access;
- staff/moderator privileged behavior remains role-bound and AAL2-protected;
- RLS remains an authoritative data-access boundary;
- report evidence remains private and report/case scoped;
- moderation access remains target-specific, report-bound and audited;
- real secrets must never be committed;
- staging and production credentials/data remain separate;
- provider mutations must target the explicitly authorized project/environment;
- payments and monetisation remain disabled;
- deferred features must not be activated incidentally.

A hosted test does not justify weakening these invariants for convenience.

---

# Production boundary

Production is not the current execution target.

Do not perform production mutations as part of Gate 3 staging reconciliation unless an explicitly authorized later release step requires them.

Protected actions include, as applicable:

- production deployments;
- production database mutations;
- production Auth configuration;
- production secrets;
- production DNS/domain changes;
- monetisation activation;
- destructive provider actions.

Use the repository's R3/Human Gate rules when execution eventually reaches those boundaries.

---

# Current blockers

The active blockers should remain limited to blockers that affect current executable work.

For A9, the relevant unresolved boundary is:

1. verify that all prerequisite hosted/provider state required by the authoritative A9 sequence is satisfied;
2. ensure the locally verified A9 operator foundation is available through the correct durable repository path before hosted execution depends on it;
3. execute and verify the required authenticated hosted A9 evidence;
4. durably close A9 only after all required repository and hosted evidence passes.

Do not carry old Phase 2 findings forward as "current blockers" merely because they appear in historical audits.

Independent unresolved work belongs in GitHub Issues with its own priority, risk and dependencies.

---

# Deferred and later work

The following categories remain outside the current A9-only boundary unless explicitly required as dependencies:

- later Gate 3 steps;
- legal/privacy completion;
- final message/blocking product semantics;
- UX completion;
- production backup rehearsal;
- production monitoring;
- production deployment;
- payments;
- delivery integration;
- chat attachments;
- boosts;
- subscriptions;
- ads;
- other monetisation.

Their existence must not expand the active issue automatically.

---

# Historical baseline

The full initial repository audit remains available at:

`docs/AUDIT-2026-08-02.md`

That document is historical evidence.

Some findings from it have since been:

- fixed;
- superseded;
- converted into later remediation/gate work;
- changed by explicit owner decisions.

Do not use an August 2 finding as current truth without reconciling it against newer repository state.

In particular, old invite-only or phone-verification assumptions are superseded by the durable owner decision recorded in `docs/MASTER-PLAN.md`.

---

# Operational evidence policy

Current status must be based on evidence appropriate to the claim.

Examples:

```text
Code exists
→ inspect repository state

Merged
→ verify Git/GitHub state

Deployed
→ verify provider deployment state

Database mutation applied
→ verify target database/provider state

Hosted flow passes
→ run the required hosted evidence

Gate complete
→ satisfy the gate's complete acceptance contract
```

Do not infer one level from another.

A clean local test suite does not prove hosted state.

A successful hosted operation does not prove the corresponding source is merged.

A merged PR does not prove the intended deployment is active.

---

# Queue and execution

This document does not choose the next autonomous ticket.

GitHub Issues are the canonical executable queue.

Use:

`docs/agents/issue-tracker.md`

for selection and state transitions.

Use:

`docs/agents/EXECUTION-LOOP.md`

for the normal execution lifecycle.

Use:

`docs/agents/SKILL-ROUTER.md`

for Superpowers / Matt Pocock / ECC routing.

Do not duplicate those workflows here.

---

# Updating this file

Update `PROJECT-STATUS.md` when a material state transition occurs, such as:

- a named gate closes;
- a new gate becomes active;
- the current merged/released baseline changes materially;
- a genuine active blocker appears or is resolved;
- staging or production readiness materially changes.

Keep exact receipts in their appropriate durable artifacts when they are too detailed for this snapshot.

Do not append every test run or command.

Replace stale operational claims rather than accumulating contradictory snapshots.

---

# Current next step

The next work should remain inside the authoritative A9 scope.

Conceptually:

```text
verify exact A9 prerequisites
→ ensure required A9 operator source is durably available
→ perform target-locked hosted actor/evidence execution
→ run required verification
→ close A9 only if every acceptance condition passes
```

If any step requires authority outside A9, stop at the exact boundary rather than crossing it.

---

# Core status invariant

```text
A7 is closed.
A8 is closed.
A9 is active.
Gate 3 staging reconciliation is still in progress.
Production is not yet authorized for normal execution.
Current claims require current evidence.
GitHub Issues define executable work.
Named-gate scope defines what may be mutated.
```
