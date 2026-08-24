# Aromatika Launch Gates

**Purpose:** Define evidence required before Aromatika is opened to real users. This is not a permanent feature wishlist.

A gate is `PASS`, `BLOCKED`, or `NOT FRESHLY VERIFIED`. Never infer PASS from merged code alone.

## Product
- Open registration works.
- Email confirmation works.
- Onboarding works.
- Listing creation and publishing work.
- Search and discovery work.
- Offers work.
- Accepted-offer chat works.
- Seller completion works.
- Either-party cancellation with a reason works.
- Cancelled deals do not unlock reviews.
- Review flow works.
- Verified Merchant flow is sufficient for launch.
- Paid 11th+ listing entitlement works.
- Paid promotion works.

## Security
- No known critical cross-user authorization failure.
- Staff/admin MFA is verified.
- Private-data boundaries are verified.
- Private uploads and evidence boundaries are verified.
- Deal, chat, report, and moderation ownership is verified.
- Paid-entitlement authorization is verified.
- No unresolved release-affecting security finding remains. A security finding blocks completion until disproved or fixed with regression coverage.

## Trust and moderation
- Report flow works.
- Block flow works.
- Moderation path works.
- Existing perfume evidence and trust flow works as designed.
- Trust copy does not make unsupported authenticity guarantees.

## Operations
- Monitoring and error reporting work.
- Backups exist.
- Restore has been rehearsed.
- Staging and production are distinguishable.
- Production secrets and configuration are verified.
- Incident response is usable.

## Business and legal
- Terms, Privacy, Marketplace Rules, and Safety content is launch-ready.
- Qualified Bulgarian legal review is complete and the final lawyer-reviewed Terms
  and Marketplace Rules versions are activated before public or commercial launch.
- Materially changed active legal versions require affirmative re-consent before
  authenticated marketplace actions, preserve each historical acceptance as
  separate evidence, keep public and legal access available, and fail closed when
  consent state cannot be established.
- Payment provider is owner-approved.
- Launch prices are owner-approved.
- Merchant and business wording is accurate.
- Required provider and business setup is complete.

## UX
- Core mobile journey is usable.
- Loading, empty, error, and success states exist where applicable.
- Bulgarian copy is understandable.
- No fake activity, reviews, deals, trust, or fabricated proof appears.
- No engineering jargon leaks into the UI.

## Golden path
`register -> confirm email -> onboarding -> listing -> upload/publish -> discover -> seller/trust view -> offer -> accept -> chat -> seller completes -> review`

Cancellation path:
`accepted deal -> either party cancels -> reason stored -> review remains locked`

Safety:
`report/block -> moderation -> cross-user denial`

Monetization:
`10 active qualifying listings -> attempt 11th -> trusted payment -> 30-day entitlement -> publish`

## Final launch
Agents determine technical gate state.

The owner makes the final real-world business decision to launch.

A failed or unverified required gate blocks launch. Do not invent additional gates merely to keep engineering busy.

During engineering, the current Terms and Marketplace Rules are owner-approved
provisional product drafts with stable internal version identifiers. They are not
counsel-approved or legally final. The deferred legal review gate does not block
ordinary implementation, review, verification, or merge; it remains fail-closed for
public or commercial launch.
