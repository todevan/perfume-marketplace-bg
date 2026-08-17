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
**Launch Readiness execution queue**

GitHub now provides the protected integration rail and a small evidence-backed queue. Queue creation does not prove that intended behavior is implemented or deployed.

## Local/GitHub sync state
**Synchronized.**

Verified operating state:
- GitHub `main` has an active repository ruleset requiring pull requests, current `app` and `database` CI checks, an up-to-date branch, and resolved review conversations;
- the ruleset has no bypass actor or human-approval requirement and blocks force pushes and branch deletion;
- Launch Readiness issues #22–#30 are the active synchronized engineering queue;
- unrelated untracked local work remains preserved.

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
- onboarding and authenticated route guards exist, but current onboarding accepts a blank city/location even though launch product truth requires it;
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
2. Require a nonblank city/location across onboarding UI, server validation, database workflow, and negative regression coverage.
3. Implement and prove the paid 11th+ 30-day listing entitlement and paid promotion journeys with trusted server-side confirmation.
4. Verify current staging deployment, Auth configuration, target identity, and the remaining A9 hosted evidence without inferring from merged code.
5. Re-run adversarial authorization/privacy checks and prove production monitoring, secrets, backups, restore, incident, and environment-isolation readiness.
6. Obtain owner decisions for the payment provider, commercial terms, and exact launch prices after technical comparison.
7. Verify the complete Bulgarian mobile golden path, legal/safety content, and honest loading/empty/error/success states.

## Next outcomes
1. Prove open registration, email confirmation, required city/location onboarding, and relevant hostile auth boundaries through issue #22.
2. Complete seller-only deal completion and either-party cancellation through issue #25 before claiming the core deal journey ready.
3. Prove cross-user privacy and the report/block/moderation safety journey through issues #23 and #24.
4. Implement trusted paid-extra listing and promotion entitlements through issues #26 and #27 after their verified dependencies are satisfied.
5. Close the remaining merchant, operational-readiness, and provider decisions through issues #28–#30.

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
