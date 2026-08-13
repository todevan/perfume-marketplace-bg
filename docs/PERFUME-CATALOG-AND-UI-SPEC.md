# Perfume marketplace — catalogue and UI contract

Status: implementation baseline, originally established 20 July 2026 and reconciled with later owner-approved product decisions.

## Role and authority

This document defines durable catalogue, listing, trust, interaction and UI behavior for the perfume marketplace.

It is a product/domain contract, not an execution workflow, release plan or source of current operational status.

When implementing or reviewing this contract:

- repository instructions and authoritative project documentation take precedence;
- unresolved changes that would materially alter user-visible product behavior remain subject to the applicable Human Gate;
- Superpowers remains the primary process authority;
- Matt Pocock skills may be used for deeper domain-modeling, codebase-design, debugging or review reasoning when useful;
- ECC/platform skills may be used for specialist security, backend, Supabase, E2E/Playwright or platform concerns when useful;
- skills support implementation and reasoning but do not independently redefine the product contract.

Do not introduce a second competing planning, debugging, TDD, execution or completion workflow from this document.

## Visual system

| Token               |     Value | Contract                                                            |
| ------------------- | --------: | ------------------------------------------------------------------- |
| `--brand-main`      | `#F3DFBF` | Warm highlights and selected surfaces; never the only state signal. |
| `--brand-secondary` | `#F4ECE1` | Main background.                                                    |
| `--brand-tertiary`  | `#D6CABA` | Muted panels and disabled tracks.                                   |
| `--ink`             | `#241C16` | Primary text and icons.                                             |
| `--action`          | `#4A3126` | Primary actions and selected control boundary.                      |
| `--success`         | `#2F6B4F` | Confirmed/approved states.                                          |
| `--warning`         | `#8A5B16` | Pending/caution states.                                             |
| `--danger`          | `#8D2F36` | Errors, reports and destructive actions.                            |

Use system Arial Bold Italic (`700 italic`) for headings, category labels and primary CTA text. Use Arial Regular for forms, descriptions, chat, reviews and any paragraph longer than one line. Body text is at least 16 px and interactive targets at least 44×44 px.

The visual direction is a refined premium marketplace: generous editorial spacing in hero areas, dense and scannable product information in catalogue cards, warm paper texture, dark brown controls and strong user photography.

## Catalogue contract

`catalog/brand-categories.json` is schema v2 and validates against `brand-categories.schema.json`.

- `brands` is the canonical registry. Every brand has a stable ID and canonical display name.
- Aliases are typed as `searchAlias`, `formerName`, `misspelling`, `transliteration` or `productLine`.
- `collections` contain brand IDs and are editorial discovery shelves, not factual classification.
- Counts are exactly 80 men, 80 women, 80 unisex, 80 niche and 15 Arabic memberships.
- A brand can appear in several collections. A membership never auto-assigns listing tags.
- `Други` publishes immediately as `pending_canonicalization`; the system retains original input, normalized key, provenance, candidate match and audit history.
- No third-party catalogue, imagery, reviews, ratings, descriptions or notes are imported or scraped.

The seller assigns `men | women | unisex` and optional `niche | arabic` tags to each listing. Moderators change them only after a report, spam or clear deception.

## Listing contract

An offer listing contains one physical item:

- `retail_bottle`;
- `tester`;
- `official_sample`.

Gift sets, arbitrary bundles, decants, splits, attar and CPO oils are out of MVP scope.

Deal modes are `sale`, `swap` and `sale_or_swap`. Sale modes require an integer EUR-cent asking price. Swap can include an optional estimated value. Wanted entries are separate records with an optional maximum EUR budget and do not require product photos.

Supported concentration values are EDT, EDP, Parfum, Extrait de Parfum, EDC and „Друга / непосочена“. Elixir, Intense and Absolu are name qualifiers, not normalized concentration values.

### Volume and condition

- Persist original volume and remaining volume to 0.1 ml; never persist percentage as independent truth.
- Slider edits calculate ml. Exact ml edits remain exact even when the slider displays a rounded percentage.
- Changing original bottle volume preserves the current full-precision ratio and recalculates remaining ml.
- Sealed means 100% and locks the remainder control.
- Active listings cannot have 0 ml remaining.
- Derived labels: 90–99% „Отворен, почти пълен“; 70–89% „Леко използван“; 30–69% „Частично използван“; 1–29% „Силно използван“.

### Evidence photos

Every offer listing requires at least four distinct files and all format-specific roles:

- opened bottle: full product, bottle bottom, batch code, fill level;
- sealed product: box front, box bottom, batch code, seal;
- official sample: full product, manufacturer label, manufacturer markings and seal; explicit `batchCodeAbsent` is allowed only for a sample without a separate factory code.

The upload pipeline must validate actual MIME content and size, re-encode images, remove EXIF and apply per-user rate limits before persistent storage.

### External references

Fragrantica is an optional recommended field. MVP accepts only an HTTPS URL on `www.fragrantica.com` whose path starts with `/perfume/`. It opens after a user click in a new tab with `noopener noreferrer`. No page data is fetched or copied.

Batch-code.com is an external manufacture-date/format reference. A valid result does not prove that the physical item is genuine. The strongest platform label is „Доказателствата са прегледани“, with review date and scope; never „Гарантирано оригинален“.

## Trust and interaction contract

- Normal users register publicly with email and password and complete email confirmation.
- No invitation is required for normal-user registration or marketplace use.
- No phone/SMS OTP verification is required for regular-user activation, first listing, offers or other ordinary marketplace actions.
- Staff/admin MFA/AAL2 requirements remain separate and mandatory.
- Public private-user identity: username, city, history, confirmed-deal rating and statuses. Email and any phone data remain private.
- Merchant self-declaration and free manual verification are separate from paid plans. Merchant verification is a free trust status and is not sold.
- An accepted structured offer only reserves a listing and starts or continues private chat; it does not create platform checkout or a binding perfume contract.
- The underlying perfume transaction remains off-platform.
- Payment, billing, listing-fee, subscription, boost, advertising and payment-provider scaffolding does not authorize those features for activation; they remain disabled until their applicable business, legal and production gates are satisfied.
- Only independent confirmation by both participants completes a deal and unlocks one review per participant.
- General profile comments are visually separate and do not affect the transaction rating.
- Chat is participant-only under RLS. A moderator receives scoped access only through an active report case; every access/action enters the audit log.

Legacy invite/bootstrap mechanisms may remain only where explicitly required for operator or first-admin compatibility. They must not be treated as the normal-user registration model.

## Responsive and accessibility acceptance

- No horizontal overflow at 320, 375, 768, 1024 and 1440 px.
- Search combobox, wizard, ranges, number inputs, upload roles, filter drawer, offer drawer and chat composer work by keyboard.
- Persistent visible labels; placeholders are not labels.
- One polite live region per linked-volume/wizard context; no repeated announcements.
- Selected states use boundary/text/icon in addition to colour.
- Visible focus meets WCAG 2.2 AA expectations and motion respects `prefers-reduced-motion`.

## Change discipline

Changes to catalogue facts, listing semantics, trust states, registration requirements, deal completion, moderation access or user-visible marketplace behavior must not be inferred from a skill, implementation convenience or stale historical document.

If an implementation task exposes a genuinely unresolved product choice, use the existing Human Gate process rather than silently changing this contract.

Implementation details that preserve the behavior above may be decided through the normal autonomous execution process and repository verification requirements.