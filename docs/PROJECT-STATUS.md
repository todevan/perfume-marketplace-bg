# Project Status

## Purpose

This file records verified product, repository, deployment, hosted-system, and
operational truth. GitHub Issues own tasks and engineering progress. Replace stale
facts; do not append session history.

## Approved launch behavior

Aromatika launches in Bulgaria with this core journey:

register → confirm email → onboarding → listing → publish → discover → offer →
accept → private chat → seller completion or either-party cancellation → review

Safety:

report or block → moderation → cross-user authorization denial

Monetization:

10 qualifying active listings → paid individual 11th+ 30-day listing → paid
promotion

Current product truth:

- normal users register with email/password and confirm email;
- onboarding requires username, meaningful city/location, current Terms, and current
  Marketplace Rules consent;
- normal users do not require an invitation, waitlist, manual approval, phone, or SMS;
- accepted offers open private chat;
- sellers complete deals; either party may cancel with a stored reason;
- perfume payment and delivery remain off-platform;
- Wanted listings do not consume the free allowance;
- merchant verification is a trust status, not a purchased subscription;
- staff/admin MFA remains mandatory;
- paid entitlements require trusted server-side confirmation.

## Verified repository behavior

Current source and tests contain implementation surfaces for registration,
confirmation, onboarding, listing/evidence, publishing, discovery, offers, deals,
private chat, reviews, merchant applications, reports, moderation, blocking,
notifications, backups, and hosted operators.

Known repository/product discrepancies remain:

- paid extra-listing and promotion scaffolding exists, but launch-ready trusted
  30-day entitlement journeys are not proven;
- billing, listing-fee, promotion, merchant-subscription, and provider feature flags
  remain disabled by default.

Implemented source is not proof of hosted deployment or end-to-end readiness.

## Verified operational truth

- GitHub main is protected by pull requests, required app/database CI, an up-to-date
  branch requirement, resolved review conversations, force-push prevention, and
  branch-deletion prevention.
- The repository contains deterministic application, database-contract, browser,
  Cloudflare dry-run, backup/restore, and security-check surfaces.
- Project-scoped Codex configuration provides isolated, project-locked Svelte and
  CodeGraph tooling plus bounded Cloudflare observability without embedding
  credentials.

## Hosted and deployment truth

Current hosted Auth configuration, deployed Worker SHA, database migration inventory,
production provider configuration, secrets, monitoring, backups, restore readiness,
DNS/domain state, and public-launch state are not freshly verified by this snapshot.

Historical hosted receipts and merged operator code do not establish current hosted
truth. Production deployment, provider mutation, secret rotation, billing changes,
destructive hosted operations, and public launch remain protected actions.

## Update rule

Update this file only when current product, repository, deployment, hosted-system, or
operational truth is verified. Do not record issues, branches, worktrees, labels,
percentages, agent activity, review rounds, or next-task ordering.
