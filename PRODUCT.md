# Aromatika Product Constitution

<!-- impeccable:product-schema 1 -->

## Platform
web

## Purpose
Aromatika is a Bulgaria-first vertical marketplace for perfume and fragrance commerce. It models perfume-specific listing, condition, quantity, concentration, evidence, trust, offer, deal, and seller or merchant behavior rather than behaving like a generic classifieds site.

The primary users are Bulgarian perfume enthusiasts and collectors buying, selling, or exchanging new and used perfumes. Private individuals and declared merchants participate with their account type shown clearly.

## Launch model
Aromatika is prepared for a normal public launch in Bulgaria. There is no normal-user invitation, waitlist, or permanent public-beta access model.

## Registration and onboarding
Normal flow:
`email/password registration -> email confirmation -> username + city/location + Terms/Marketplace Rules -> full marketplace access`

Normal users do not require invitation, waiting list, manual approval, phone verification, or SMS OTP.

Staff/admin MFA remains mandatory.

## User access after onboarding
A normal user may publish listings immediately after onboarding. No default first-listing manual approval gate exists.

## Listing and evidence model
One offer listing represents one physical perfume product. Supported formats are retail bottle, tester, and official sample. Gift sets, arbitrary bundles, decants, splits, attar, and CPO oils remain outside the launch scope unless separately approved.

The listing records concentration, original bottle volume, exact remaining volume, condition, price or exchange terms, seller identity, and evidence for that specific physical item. The seller assigns the applicable audience and optional niche or Arabic tags.

Offer listings require the repository's approved format-specific evidence-photo roles. Uploads must be validated by actual content, bounded, sanitized through re-encoding, stripped of EXIF metadata, and protected by per-user limits. Wanted listings are separate demand posts and do not require product photos.

Fragrantica may be linked as an optional external reference without importing its content. Batch-code references are informational only. The strongest approved trust statement is equivalent to “Evidence reviewed”; Aromatika does not guarantee authenticity.

## Listing types
Qualifying commercial listing types:
- For Sale
- For Exchange
- Sale or Exchange

Wanted / Looking For is a demand post and does not consume the commercial active-listing allowance.

## Offer, chat, deal, review
Core flow:
`listing -> offer -> seller accepts -> private chat opens -> buyer/seller arrange payment/delivery -> seller completes OR either party cancels`

Seller completion:
- seller marks the deal completed;
- a completed deal unlocks the applicable review flow.

Cancellation:
- buyer or seller may cancel an accepted deal;
- a cancellation reason is required;
- cancelled deals do not unlock reviews;
- cancellation history may be retained privately for moderation and trust according to approved privacy and retention rules.

This supersedes the prior dual-party completion rule.

## Payment and delivery for perfume
Perfume payment and delivery are arranged directly by buyer and seller.

Aromatika does not collect the perfume purchase price, hold escrow, settle seller funds, or manage buyer refunds for the perfume itself. A structured offer is not platform checkout or a binding perfume-sales contract.

No courier API integration is required for launch.

## Geography
Launch scope is Bulgaria.

International shipping, multi-country marketplace rules, global currencies and taxation, and full international expansion are deferred.

## Verified Merchants
Businesses register normally, may apply for verification, and may receive Verified Merchant status and a storefront after Aromatika verification.

Verification is a trust status and cannot be purchased. No merchant subscription is required for launch.

## Monetization boundary
Aromatika does not take commission from perfume sales.

Aromatika monetizes its own marketplace services:
- 10 free qualifying active listings;
- paid 11th+ qualifying active listings, individually valid for 30 days;
- paid time-limited listing promotion such as Boost or Featured placement.

Exact provider and launch prices are defined in `docs/BUSINESS-MODEL.md` after owner approval.

## Trust and safety
- Public profiles expose only approved marketplace identity and trust data. Email and phone data remain private.
- Chat is participant-only. Moderator access is report-bound, scoped, and audited.
- Reports, blocking, moderation, and private evidence handling remain part of launch safety.
- General profile comments remain separate from transaction reviews and do not affect the deal rating.
- Demo and empty states must not fabricate activity, testimonials, deal counts, reviews, or proof.

## Current core launch journey
`register -> confirm email -> onboarding -> listing -> publish -> discover -> offer -> accept -> chat -> seller completion/cancellation -> review`

Safety:
`report/block -> moderation -> cross-user authorization denial`

## Deferred
Unless separately approved:
- platform checkout or escrow for perfume;
- courier integrations;
- merchant subscription tiers;
- advanced merchant analytics;
- recommendation AI or vector search;
- major social feed;
- complex decants or splits;
- chat attachments;
- mobile app;
- international expansion.

## Product principles
1. The specific physical bottle matters more than a generic product promise.
2. Trust is supported by visible information and process, never absolute guarantees.
3. Community interactions are functional parts of the marketplace, not decorative social proof.
4. Every primary control must lead to a real action.
5. Empty states remain honest and useful; missing data is never replaced with invented metrics.
