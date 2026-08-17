# Project Status

**Purpose:** Current operational snapshot only. Historical progress belongs in Git/GitHub and dated historical records.

## Current objective
**Aromatika Launch Readiness**

Safely reach the point where real Bulgarian users can complete:
`register -> confirm email -> onboarding -> listing -> publish -> discover -> offer -> accept -> chat -> seller completion/cancellation -> review`

Safety:
`report/block -> moderation -> cross-user authorization denial`

Monetization:
`10 qualifying active listings -> paid 11th+ 30-day listing -> paid promotion`

## Current phase
**Repository truth reconciliation**

This phase aligns current authority with the approved Launch Readiness design. It does not prove that intended behavior is implemented or deployed.

## Local/GitHub sync state
**Local ahead.**

Evidence gathered before this snapshot commit:
- local branch `codex/repository-truth-launch-readiness`: `dd6aa15`
- `origin/main`: `fd3165f`

The branch began from synchronized `origin/main`; unrelated untracked local work remains preserved.

## Approved product truth
- Public email/password registration with email confirmation.
- Onboarding: username, city/location, Terms and Marketplace Rules.
- No normal-user invitation, waitlist, manual approval, phone, or SMS gate.
- Immediate normal-user listing access after onboarding.
- Accepted offer opens private chat.
- Seller completes; either party may cancel with a reason.
- Perfume payment and delivery remain off-platform.
- Bulgaria-only launch.
- 10 free qualifying active Sale/Exchange listings.
- Each 11th+ qualifying listing is paid individually for 30 days.
- Wanted does not consume the allowance.
- Paid promotion is part of launch.
- Verified Merchants participate without a mandatory subscription.
- Staff/admin MFA remains mandatory.

## Implemented repository behavior
Current source and tests show:
- public email/password registration requests email confirmation and routes to onboarding;
- onboarding and authenticated route guards exist;
- listing drafts, evidence uploads, publishing, discovery, structured offers, accepted-offer deals, private chat, cancellation, reviews, merchant applications, reports, moderation, and blocking have implementation surfaces;
- the database/domain/UI still complete deals through confirmation by both participants, not seller-only completion;
- a 10-active-listing quota and payment/entitlement scaffolding exist;
- billing, listing fees, promotions, merchant subscriptions, and payment-provider flags remain disabled by default;
- no evidence in this run proves the approved paid 30-day extra-listing and promotion journeys are launch-ready.

Implemented source is not equivalent to hosted deployment or end-to-end readiness.

## Hosted/staging state
Hosted and provider state was **not freshly verified in this run** because required staging credentials were not present in the active environment.

Repository history contains merged A9 operator source from PRs #12 and #19, but this does not prove deployment, hosted execution, or A9 closure. Production state, public signup state, provider configuration, secrets, backups, restore readiness, monitoring, and domain/DNS remain unverified here.

## Top launch blockers
1. Replace the implemented mutual-confirmation deal flow with seller completion while preserving either-party cancellation and review safety.
2. Implement and prove the paid 11th+ 30-day listing entitlement and paid promotion journeys with trusted server-side confirmation.
3. Verify current staging deployment, Auth configuration, target identity, and the remaining A9 hosted evidence without inferring from merged code.
4. Re-run adversarial cross-user, staff MFA, private-data, upload/evidence, chat, report, moderation, and paid-entitlement checks against the release candidate.
5. Prove production operations: monitoring, secrets/configuration, backups, restore rehearsal, incident readiness, and staging/production isolation.
6. Obtain owner decisions for the payment provider, commercial terms, and exact launch prices after technical comparison.
7. Verify the complete Bulgarian mobile golden path, legal/safety content, and honest loading/empty/error/success states.

## Next outcomes
1. Complete and merge this repository-truth reconciliation.
2. Execute the approved GitHub Safety + Launch Readiness Queue plan.
3. Convert each evidence-backed launch blocker into a prioritized issue with dependencies and risk.
4. Complete the seller-completion/cancellation product gap before claiming the core deal journey ready.
5. Design and implement launch monetization only after provider and price decisions reach their protected owner gates.

## Not now
- platform perfume checkout or escrow;
- courier integrations;
- merchant subscriptions;
- advanced merchant analytics;
- recommendation AI or vector search;
- major social feed;
- complex decants or splits;
- chat attachments unless separately approved;
- mobile app;
- international expansion.

## Update rule
Replace stale state when material facts change. Do not append historical status sections. Always distinguish approved intent, implemented repository behavior, and freshly verified hosted/provider state.
