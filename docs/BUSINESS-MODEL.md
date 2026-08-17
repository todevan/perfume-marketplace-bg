# Aromatika Business Model

## Launch principle
Aromatika does not take commission from the perfume sale.

Perfume payment and delivery remain buyer-to-seller. Aromatika is not the payment intermediary, escrow holder, inventory holder, or refund manager for the perfume transaction.

Aromatika monetizes its own marketplace services.

## Free commercial listing allowance
Each account receives 10 free simultaneously active qualifying listings.

Qualifying:
- For Sale
- For Exchange
- Sale or Exchange

Not counted:
- Wanted / Looking For
- sold
- removed or cancelled
- expired

## Paid additional listings
When an account already has 10 qualifying active listings, each additional qualifying active listing requires payment.

A paid additional listing:
- is purchased individually;
- is valid for 30 days;
- ends earlier if sold or removed;
- may be renewed after expiry if still unsold.

Permanent slot purchases are not part of launch. Seller subscriptions are not required for launch.

## Paid promotion
Aromatika offers paid time-limited visibility products such as:
- Boost or bump;
- Featured or promoted placement.

Exact product names, prices, durations, placements, bundles, discounts, and launch availability are commercial settings requiring owner approval.

Promoted content must be clearly identified and must not purchase verification, evidence status, ratings, or other trust signals.

## Verified Merchants
Merchant verification is a trust status and cannot be purchased.

At launch, Verified Merchants use the same base listing model:
`10 free qualifying active listings -> paid additional listings -> optional paid promotion`

No merchant subscription is required for launch.

## Payment-provider boundary
Aromatika requires a provider only for purchases of Aromatika services.

The exact provider is selected in a dedicated implementation design after comparing:
- Bulgarian availability;
- transaction fees;
- card and wallet support;
- invoicing and accounting implications;
- refunds;
- webhook or callback reliability;
- implementation complexity.

Provider selection, acceptance of commercial terms, meaningful spending, and launch prices are owner decisions.

## Entitlement safety
Aromatika grants paid listing and promotion entitlements only after trusted server-side payment confirmation.

Required behavior:
- failed or abandoned payment -> no entitlement;
- duplicate provider callback -> no duplicate entitlement;
- forged client request -> no entitlement;
- expiry -> entitlement ends according to product rules;
- refund or cancellation state -> auditable.

Entitlement grant, renewal, expiry, cancellation, and refund transitions must record sufficient trusted provenance to reconstruct the decision. Card data should remain with the provider when possible.

## Activation prerequisites
Before production activation:
- Bulgarian legal review covers consumer and e-commerce duties, private-versus-merchant wording, withdrawal and refund rules for Aromatika services, privacy, and retention;
- accounting review covers VAT, invoicing, provider fees, reconciliation, and refunds;
- provider sandbox behavior, idempotency, callback verification, refund behavior, and failure handling are proven;
- production security, observability, backup, rollback, and incident gates pass;
- approved prices and commercial terms are recorded.

Existing payment or entitlement scaffolding is not authorization to activate monetization.

## Commercial measurement
Track paid conversion, renewal, refund rate, provider cost, support burden, promotion effectiveness, and marketplace-quality impact without fabricating demand or exposing private user data.

Technical integration success alone does not prove commercial viability.

## Deferred commercial features
Unless separately approved:
- merchant subscriptions;
- private-user subscription tiers;
- advanced merchant analytics;
- complex bulk packages;
- commission on perfume sales;
- escrow or buyer-protection payment flow.
