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
- issue #22 remains the first authoritative product-queue outcome, followed by issue #25;
- the active Gate 3 workspace branch `codex/gate3-hosted-orchestrator-design` is synchronized with its upstream at `3a481d48b6faed64dca24981a9c6ba098dcb3c70`, 43 commits ahead and 0 behind `origin/main` at `747decc3a23385b3c9f0569f8f60327a23424221`;
- its five unrelated untracked paths (`.playwright-mcp/`, `aromatika-desktop-smoke.png`, `aromatika-mobile-smoke.png`, `staging-desktop-login.png`, and `staging-mobile-login.png`) remain preserved.

## Gate 3 evidence-support track

Gate 3 is staging-only evidence infrastructure, not an independent product-readiness score or a replacement for launch-gate acceptance.

- Tasks 1–8 have recorded branch-plan verification at parent `f69686442f482270606ecf853f05795e485bbde0`; those records are historical until revalidated for the exact candidate.
- Task 9 code is present at `3a481d48b6faed64dca24981a9c6ba098dcb3c70` across six files: lifecycle, scenario runner, operator, and their three tests.
- The implementation is technically structured so lifecycle selects the scenario checkpoint and the runner receives that selection.
- Task 9 changed lifecycle and its test in addition to the original four-file task scope. The scope authority for that expansion, focused and broad test results, independent engineering review, adversarial R2 review, GitHub CI, and any required hosted evidence are not established here. Task 9 is therefore not complete.
- The branch has no associated pull request or GitHub workflow run for `3a481d48`; no hosted mutation or acceptance is authorized by this status.
- The active implementation plan remains `docs/superpowers/plans/2026-08-20-gate3-hosted-orchestrator.md` on the Gate 3 branch; its verified 2026-08-23 Git blob is `bb2ff08d937f15aba24cb4d3a4646206bab8ba9d` and must be revalidated before use.

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
1. Complete issue #22: prove open registration, email confirmation, required city/location onboarding, and hostile auth boundaries against the current reviewed baseline and exact hosted target.
2. Replace the implemented mutual-confirmation deal flow with seller completion while preserving either-party cancellation and review safety through issue #25; this is the leading transaction-model contradiction, but does not displace issue #22 in the authoritative queue.
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
