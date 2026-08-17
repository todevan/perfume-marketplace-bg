# Aromatika Repository Truth + Launch Readiness Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active local repository tell one consistent Launch Readiness story: open registration, seller-completed deals, Bulgaria-only launch, off-platform perfume transactions, launch monetization, local-first authority, and clearly separated historical evidence.

**Architecture:** `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md` owns strategic launch direction; `PRODUCT.md` owns product behavior; `DESIGN.md` owns visual truth; `docs/PROJECT-STATUS.md` owns current state; `docs/LAUNCH-GATES.md` owns evidence required before launch; `docs/BUSINESS-MODEL.md` owns monetization. `MASTER-PLAN.md` becomes an index/roadmap. Historical plans/reviews/builder artifacts remain evidence but cannot override current authority.

**Tech Stack:** Markdown, Git, ripgrep, pnpm validation, existing SvelteKit/Supabase repository checks.

## Global Constraints

- Work from the owner's approved local-first Agent OS v2.
- Strategic objective is **Aromatika Launch Readiness**, not Open Beta / Beta 30.
- Normal users register publicly with email/password, confirm email, and complete onboarding.
- Invitations, waiting lists, normal-user phone verification, and SMS OTP are not required.
- Staff/admin MFA remains mandatory.
- After onboarding, normal users can publish immediately; no default first-listing manual approval.
- Existing perfume-specific evidence/proof rules remain unless a contradiction must be removed.
- Accepted offer opens private chat.
- Seller marks a deal completed.
- Either buyer or seller may cancel an accepted deal with a required reason.
- Cancelled deals do not unlock reviews.
- Perfume payment/delivery remains off-platform.
- Launch geography is Bulgaria.
- No courier API integration is required for launch.
- 10 qualifying active Sale/Exchange listings are free.
- Wanted listings do not consume the 10-listing allowance.
- 11th+ qualifying active listing is paid individually for 30 days.
- Paid Boost/Featured promotion is part of the launch business model.
- Exact launch prices and payment provider are owner-approved later.
- Merchant verification is a trust status and cannot be purchased.
- Verified Merchants participate from launch without a mandatory subscription.
- `DESIGN.md` is the sole visual authority.
- Historical evidence may remain, but active authority must not contradict current truth.
- `docs/PROJECT-STATUS.md` contains one current snapshot, not appended history.
- Do not claim hosted/staging/production readiness without fresh evidence.
- Preserve unknown local work and reconcile local/GitHub state before edits.

---

## File Structure

### Create or ensure current
- `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md`
- `docs/superpowers/README.md`
- `docs/reviews/README.md`
- `docs/testing/README.md` when needed

### Rewrite or materially revise
- `MASTER-PLAN.md`
- `PRODUCT.md`
- `docs/PROJECT-STATUS.md`
- `docs/LAUNCH-GATES.md`
- `docs/BUSINESS-MODEL.md`
- `README.md`

### Focused cleanup
- `docs/PERFUME-CATALOG-AND-UI-SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/PRODUCTION-SETUP.md`
- `docs/BACKUP-RESTORE.md`
- `docs/INCIDENT-RESPONSE.md`
- `docs/STAGING-CREDENTIALS.md`

### Mark historical/non-authoritative
- `.builder/progress.md`
- `.builder/architecture.md`
- dated files under `docs/superpowers/specs/`
- dated files under `docs/superpowers/plans/`
- dated files under `docs/reviews/`
- dated task-specific testing records under `docs/testing/`

---

### Task 1: Reconcile local/remote state and inventory current authority

**Files:**
- Read: all files listed above.
- No edits until sync state is understood.

**Interfaces:**
- Consumes: local workspace + `origin/main`.
- Produces: evidence map of active contradictions and current hosted certainty.

- [ ] **Step 1: Enter active local workspace and inspect state**

```powershell
Set-Location 'C:\Users\Admin\Documents\Сайт парфюми.worktrees\current-main-20260813'
git status --short
git fetch origin --prune
git rev-list --left-right --count HEAD...origin/main
git log -1 --format='%cI %H %s' HEAD
git log -1 --format='%cI %H %s' origin/main
```

Preserve unknown local work.

- [ ] **Step 2: Create isolated worktree from the approved local baseline**

After reconciling any remote-ahead/diverged state:

```powershell
git worktree add '..\repository-truth-launch-readiness' -b repository-truth-launch-readiness HEAD
Set-Location '..\repository-truth-launch-readiness'
```

- [ ] **Step 3: Inventory contradictions**

```powershell
rg -n -i "open beta|beta 30|controlled open beta|closed beta|invite-only|public registration is disabled|публичната регистрация е изключена|waiting list|phone|SMS|OTP|both confirm|mutual confirmation|mutually confirm|paid subscriptions/boosts/ads|not now|international|merchant subscription|Arial|#F3DFBF|#4A3126" `
  AGENTS.md PRODUCT.md DESIGN.md MASTER-PLAN.md README.md docs .builder
```

Store findings in task notes, not a permanent dump.

- [ ] **Step 4: Verify current application facts before rewriting status**

Inspect:
- current registration routes/actions;
- onboarding;
- listing creation;
- offer/accept/chat;
- deal completion/cancellation;
- merchant flow;
- existing E2E tests;
- existing monetization code, if any.

Use repository search:

```powershell
rg -n "register|sign.?up|confirm|onboard|listing|offer|accept|chat|complete|cancel|review|merchant|boost|payment|entitlement" src tests supabase
```

Do not turn design intent into a claim that runtime already implements it.

- [ ] **Step 5: Commit nothing**

---

### Task 2: Install the approved Launch Readiness design in the repository

**Files:**
- Create/replace: `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md`

**Interfaces:**
- Consumes: owner-approved 2026-08-17 design.
- Produces: strategic authority used by all later cleanup tasks.

- [ ] **Step 1: Copy the owner-approved file exactly**

Source package file:

`2026-08-17-aromatika-launch-readiness-design.md`

Destination:

`docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md`

Do not paraphrase or “improve” product decisions during the copy.

- [ ] **Step 2: Verify required decisions**

```powershell
rg -n "Aromatika Launch Readiness|local workspace|10 free active|30 days|seller marks the deal completed|Either buyer or seller|Bulgaria|off-platform|Verified Merchants|Sync status" docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md
```

- [ ] **Step 3: Commit**

```powershell
git add docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md
git commit -m "docs: add approved Aromatika Launch Readiness design"
```

---

### Task 3: Demote `MASTER-PLAN.md` to a roadmap/index

**Files:**
- Modify: `MASTER-PLAN.md`

**Interfaces:**
- Consumes: current authority map.
- Produces: stable old path that cannot compete with the new design.

- [ ] **Step 1: Replace the current body with this concise index**

```markdown
# Aromatika Roadmap Index

**Status:** Current index only. This file is no longer the strategic master authority.

## Current strategic authority
Use `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md`.

## Current concern-specific authority
- Product behavior: `PRODUCT.md`
- Visual/UX system: `DESIGN.md`
- Technical architecture: `docs/ARCHITECTURE.md`
- Current operational state: `docs/PROJECT-STATUS.md`
- Launch evidence/gates: `docs/LAUNCH-GATES.md`
- Monetization/business model: `docs/BUSINESS-MODEL.md`
- Agent process: `AGENTS.md` and `docs/agents/`

## Execution
The current owner task or highest-priority unblocked Launch Readiness issue defines executable work.

GitHub Issues are the synchronized engineering execution queue; they do not redefine product truth.

## Historical plans
Dated plans/specs/reviews and prior master-plan content are historical evidence after supersession. Do not recover obsolete beta, invite, transaction, owner-code-review, or monetization rules from history unless an active investigation explicitly needs them.
```

- [ ] **Step 2: Verify obsolete process authority is absent**

```powershell
rg -n "H3|R2 stops|owner.*merge|Open Beta|Beta 30|closed beta|invite-only" MASTER-PLAN.md
```

Expected: no obsolete authority rules.

- [ ] **Step 3: Commit**

```powershell
git add MASTER-PLAN.md
git commit -m "docs: demote master plan to current roadmap index"
```

---

### Task 4: Rewrite `PRODUCT.md` as the current product constitution

**Files:**
- Modify: `PRODUCT.md`

**Interfaces:**
- Consumes: approved Launch Readiness design + preserved perfume evidence rules.
- Produces: one current product behavior authority.

- [ ] **Step 1: Preserve unique current marketplace purpose/trust concepts**

Before rewriting, capture unique product rules that are not contradicted by the new design:

```powershell
git show HEAD:PRODUCT.md > $env:TEMP\aromatika-product-before.md
```

Use it only to preserve durable product semantics such as marketplace purpose, listing taxonomy, trust language, and current feature boundaries. Do not preserve stale invite/beta/visual authority.

- [ ] **Step 2: Rebuild `PRODUCT.md` with this required section structure**

```markdown
# Aromatika Product Constitution

## Purpose
Aromatika is a Bulgaria-first vertical marketplace for perfume and fragrance commerce. It models perfume-specific listing, condition, quantity, concentration, evidence, trust, offer, deal, and seller/merchant behavior rather than behaving like a generic classifieds site.

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
Preserve the repository's currently approved perfume-specific listing taxonomy and evidence/proof requirements. Do not claim platform authenticity guarantees beyond approved trust language.

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
- completed deal unlocks the applicable review flow.

Cancellation:
- buyer or seller may cancel an accepted deal;
- cancellation reason is required;
- cancelled deals do not unlock reviews;
- cancellation history may be retained privately for moderation/trust according to approved privacy/retention rules.

This supersedes prior mutual/both-side confirmation rules.

## Payment and delivery for perfume
Perfume payment and delivery are arranged directly by buyer and seller.
Aromatika does not collect the perfume purchase price, hold escrow, settle seller funds, or manage buyer refunds for the perfume itself.

No courier API integration is required for launch.

## Geography
Launch scope is Bulgaria.
International shipping, multi-country marketplace rules, global currencies/taxation, and full international expansion are deferred.

## Verified Merchants
Businesses register normally, may apply for verification, and may receive Verified Merchant status/storefront after Aromatika verification.
Verification is a trust status and cannot be purchased.
No merchant subscription is required for launch.

## Monetization boundary
Aromatika does not take commission from perfume sales.
Aromatika monetizes its own marketplace services:
- 10 free qualifying active listings;
- paid 11th+ qualifying active listings, individually valid for 30 days;
- paid time-limited listing promotion such as Boost/Featured.

Exact provider and launch prices are defined in `docs/BUSINESS-MODEL.md` after owner approval.

## Trust and safety
Preserve report/block/moderation flows, evidence handling, accurate trust copy, and no fabricated marketplace activity or authenticity guarantees.

## Current core launch journey
`register -> confirm email -> onboarding -> listing -> publish -> discover -> offer -> accept -> chat -> seller completion/cancellation -> review`

Safety:
`report/block -> moderation -> cross-user authorization denial`

## Deferred
Unless separately approved:
- platform checkout/escrow for perfume;
- courier integrations;
- merchant subscription tiers;
- advanced merchant analytics;
- recommendation AI/vector search;
- major social feed;
- complex decants/splits;
- chat attachments;
- mobile app;
- international expansion.
```

Then merge back only durable perfume-specific taxonomy/evidence material from the old file into the appropriate `Listing and evidence model` / trust sections. Do not reintroduce visual-system rules; `DESIGN.md` owns visuals.

- [ ] **Step 3: Verify stale product rules are gone**

```powershell
rg -n -i "closed beta|controlled open beta|invite-only|public registration is disabled|both confirm|mutually confirm|mutual confirmation|approved composition|sole visual north-star" PRODUCT.md
```

Expected: no stale authority matches.

- [ ] **Step 4: Verify required current rules**

```powershell
rg -n "10 free|30 days|seller marks|cancel|Bulgaria|email confirmation|Verified Merchant|off-platform|Boost|Featured" PRODUCT.md
```

- [ ] **Step 5: Independent product-truth review**

Check:
- no durable perfume evidence/taxonomy rule was lost;
- no visual authority remains;
- no old beta/invite/deal-confirmation rule survived.

- [ ] **Step 6: Commit**

```powershell
git add PRODUCT.md
git commit -m "docs: establish current Aromatika product constitution"
```

---

### Task 5: Rebuild `docs/PROJECT-STATUS.md` as one current Launch Readiness snapshot

**Files:**
- Modify: `docs/PROJECT-STATUS.md`

**Interfaces:**
- Consumes: fresh local/remote/runtime evidence.
- Produces: concise startup state.

- [ ] **Step 1: Gather fresh repository state**

```powershell
git fetch origin --prune
git rev-parse HEAD
git rev-parse origin/main
git log -1 --format='%cI %H %s' HEAD
git status --short
```

- [ ] **Step 2: Gather available staging evidence without mutating production**

If staging credentials are available:

```powershell
pnpm db:staging:verify-target
pnpm db:staging:types:check
pnpm db:staging:runtime:check
```

If unavailable, status must say `not freshly verified in this run`.

- [ ] **Step 3: Replace the file with this structure, filling evidence from Steps 1–2**

```markdown
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
Record the actual current phase from evidence. Use one of:
- Agent OS migration
- Repository truth reconciliation
- GitHub safety/queue setup
- Core product completion
- Monetization implementation
- Launch hardening
- Launch-ready pending owner decision

## Local/GitHub sync state
Record one:
- Synchronized
- Local ahead
- Remote ahead
- Diverged

Include the current local HEAD and `origin/main` SHA in concise form.

## Current product truth
- Public email/password registration with email confirmation.
- Onboarding: username, city/location, Terms + Marketplace Rules.
- No normal-user invite/waitlist/manual approval/phone/SMS gate.
- Immediate normal-user listing access after onboarding.
- Accepted offer opens private chat.
- Seller completes; either party may cancel with reason.
- Perfume payment/delivery remains off-platform.
- Bulgaria-only launch.
- 10 free qualifying active Sale/Exchange listings.
- 11th+ qualifying listing is paid for 30 days.
- Wanted does not consume the allowance.
- Paid promotion is part of launch.
- Verified Merchants are available without a mandatory subscription.
- Staff/admin MFA remains mandatory.

## Hosted/staging state
Record only freshly verified facts.
If a hosted fact was not verified, say so explicitly.

## Top launch blockers
List no more than seven evidence-backed blockers, ordered:
1. active safety/data-integrity/security;
2. provider/hosted;
3. core journey;
4. monetization;
5. moderation/observability/backup/legal;
6. major launch UX.

Do not list speculative future enhancements.

## Next outcomes
List 3–7 concrete outcomes that directly reduce the blockers.

## Not now
- platform perfume checkout/escrow;
- courier integrations;
- merchant subscriptions;
- advanced merchant analytics;
- recommendation AI/vector search;
- major social feed;
- complex decants/splits;
- chat attachments unless separately approved;
- mobile app;
- international expansion.

## Update rule
Replace stale state when material facts change. Do not append historical status sections.
```

Do not commit instruction placeholders such as “Record the actual...”. Replace them with real evidence/values.

- [ ] **Step 4: Verify one status document only**

```powershell
if ((rg -c '^# Project Status$' docs/PROJECT-STATUS.md) -ne 1) { throw "PROJECT-STATUS contains multiple top-level snapshots" }
rg -n "2026-08-11|2026-08-13|Open Beta|Beta 30|invite-only|public registration is disabled|both confirm|mutually confirm" docs/PROJECT-STATUS.md
```

Expected: no stale snapshot language unless a date is part of the freshly verified current repository evidence.

- [ ] **Step 5: Keep it concise**

```powershell
(Get-Content docs/PROJECT-STATUS.md).Count
```

Target: roughly 60–120 lines. Do not pad mechanically.

- [ ] **Step 6: Commit**

```powershell
git add docs/PROJECT-STATUS.md
git commit -m "docs: replace project status with Launch Readiness snapshot"
```

---

### Task 6: Rewrite `docs/LAUNCH-GATES.md` around real launch evidence

**Files:**
- Modify: `docs/LAUNCH-GATES.md`

**Interfaces:**
- Consumes: approved design.
- Produces: explicit PASS/BLOCKED evidence contract before final launch.

- [ ] **Step 1: Replace beta-era gate framing with these sections**

```markdown
# Aromatika Launch Gates

**Purpose:** Define evidence required before Aromatika is opened to real users. This is not a permanent feature wishlist.

A gate is `PASS`, `BLOCKED`, or `NOT FRESHLY VERIFIED`. Never infer PASS from merged code alone.

## Product
- Open registration works.
- Email confirmation works.
- Onboarding works.
- Listing creation/publishing works.
- Search/discovery works.
- Offers work.
- Accepted-offer chat works.
- Seller completion works.
- Either-party cancellation with reason works.
- Cancelled deals do not unlock reviews.
- Review flow works.
- Verified Merchant flow is sufficient for launch.
- Paid 11th+ listing entitlement works.
- Paid promotion works.

## Security
- No known critical cross-user authorization failure.
- Staff/admin MFA verified.
- Private data boundaries verified.
- Private uploads/evidence boundaries verified.
- Deal/chat/report/moderation ownership verified.
- Paid entitlement authorization verified.
- No unresolved critical security finding.

## Trust and moderation
- Report flow works.
- Block flow works.
- Moderation path works.
- Existing perfume evidence/trust flow works as designed.
- Trust copy does not make unsupported authenticity guarantees.

## Operations
- Monitoring/error reporting works.
- Backups exist.
- Restore has been rehearsed.
- Staging and production are distinguishable.
- Production secrets/config are verified.
- Incident response is usable.

## Business and legal
- Terms/Privacy/Safety content is launch-ready.
- Payment provider is owner-approved.
- Launch prices are owner-approved.
- Merchant/business wording is accurate.
- Required provider/business setup is complete.

## UX
- Core mobile journey is usable.
- Loading/empty/error/success states exist where applicable.
- Bulgarian copy is understandable.
- No fake activity, reviews, deals, trust, or fabricated proof.
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
```

- [ ] **Step 2: Verify obsolete beta/mutual-confirm framing is gone**

```powershell
rg -n -i "open beta|beta 30|cohort|both confirm|mutually confirm|mutual confirmation" docs/LAUNCH-GATES.md
```

Expected: no obsolete rule.

- [ ] **Step 3: Commit**

```powershell
git add docs/LAUNCH-GATES.md
git commit -m "docs: define real Aromatika launch gates"
```

---

### Task 7: Rewrite `docs/BUSINESS-MODEL.md` with launch monetization

**Files:**
- Modify: `docs/BUSINESS-MODEL.md`

**Interfaces:**
- Consumes: approved monetization design.
- Produces: business-model authority without hard-coding unapproved provider/prices.

- [ ] **Step 1: Preserve any unique durable business/legal constraints**

Before rewrite:

```powershell
git show HEAD:docs/BUSINESS-MODEL.md > $env:TEMP\aromatika-business-before.md
```

Retain non-conflicting durable rules. Do not preserve “monetization disabled/not now” as current launch truth.

- [ ] **Step 2: Rebuild the current business model around this structure**

```markdown
# Aromatika Business Model

## Launch principle
Aromatika does not take commission from the perfume sale.
Perfume payment/delivery remain buyer-to-seller.

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
- removed/cancelled
- expired

## Paid additional listings
When an account already has 10 qualifying active listings, each additional qualifying active listing requires payment.

A paid additional listing:
- is purchased individually;
- is valid for 30 days;
- ends earlier if sold or removed;
- may be renewed after expiry if still unsold.

Permanent slot purchases are not part of launch.
Seller subscriptions are not required for launch.

## Paid promotion
Aromatika offers paid time-limited visibility products such as:
- Boost/bump;
- Featured/promoted placement.

Exact product names, price, duration, placement, bundles, discounts and launch availability are commercial settings requiring owner approval.

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
- card/wallet support;
- invoicing/accounting implications;
- refunds;
- webhook/callback reliability;
- implementation complexity.

Provider selection, acceptance of commercial terms, meaningful spending and launch prices are owner decisions.

## Entitlement safety
Aromatika grants paid listing/promotion entitlements only after trusted server-side payment confirmation.

Required behavior:
- failed/abandoned payment -> no entitlement;
- duplicate provider callback -> no duplicate entitlement;
- forged client request -> no entitlement;
- expiry -> entitlement ends according to product rules;
- refund/cancellation state -> auditable.

Card data should remain with the provider when possible.

## Deferred commercial features
Unless separately approved:
- merchant subscriptions;
- private-user subscription tiers;
- advanced merchant analytics;
- complex bulk packages;
- commission on perfume sales;
- escrow/buyer-protection payment flow.
```

- [ ] **Step 3: Verify launch monetization is current**

```powershell
rg -n "10 free|30 days|Boost|Featured|Verified Merchants|no merchant subscription|server-side payment confirmation" docs/BUSINESS-MODEL.md
```

- [ ] **Step 4: Verify obsolete disablement is gone**

```powershell
rg -n -i "monetization.*disabled|paid subscriptions/boosts/ads.*not now|boosts.*disabled|advertising.*disabled" docs/BUSINESS-MODEL.md
```

Expected: no current disablement claim unless clearly labeled historical.

- [ ] **Step 5: Commit**

```powershell
git add docs/BUSINESS-MODEL.md
git commit -m "docs: define launch listing and promotion monetization"
```

---

### Task 8: Reconcile `README.md` with current launch model

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: PRODUCT/status truth.
- Produces: repository landing page that no longer teaches obsolete beta/invite behavior.

- [ ] **Step 1: Replace obsolete title/opening**

Use:

```markdown
# Aromatika — Bulgarian perfume marketplace

Aromatika is a Bulgaria-first perfume marketplace being prepared for public launch.

Normal users register with email/password, confirm their email, complete onboarding, and can use the marketplace without an invitation, waiting list, phone verification, or SMS OTP. Staff/admin access remains separately protected with MFA.

Perfume payment and delivery are arranged directly between buyer and seller. Aromatika monetizes its own marketplace services rather than taking commission from the perfume sale.

Current operational readiness is documented in `docs/PROJECT-STATUS.md`.
```

- [ ] **Step 2: Preserve legitimate first-admin/bootstrap compatibility**

If legacy admin invitation/bootstrap documentation is still required, label it explicitly:

```markdown
Legacy/bootstrap invitation mechanisms may remain for first-admin/operator compatibility. They are not the normal-user admission model.
```

- [ ] **Step 3: Remove stale hosted claims unless freshly verified**

Do not say staging has signup enabled/disabled unless current evidence proves it. Point to `docs/PROJECT-STATUS.md`.

- [ ] **Step 4: Verify stale language is gone**

```powershell
rg -n -i "closed beta|open beta|invite-only authentication|Публичната регистрация е изключена|flow започва с покана|both confirm|mutually confirm" README.md
```

- [ ] **Step 5: Commit**

```powershell
git add README.md
git commit -m "docs: align README with Aromatika public launch model"
```

---

### Task 9: Make `DESIGN.md` the sole visual authority

**Files:**
- Modify: `docs/PERFUME-CATALOG-AND-UI-SPEC.md`
- Read: `DESIGN.md`

**Interfaces:**
- Consumes: current DESIGN.
- Produces: domain spec without conflicting typography/palette.

- [ ] **Step 1: Remove duplicate authority and obsolete visual system blocks**

Delete conflicting visual tokens/rules including old `Arial`, `#F3DFBF`, `#4A3126`, `--brand-main`, and any duplicate `Role and authority` section.

- [ ] **Step 2: Insert this authority statement**

```markdown
## Visual and UX authority

`DESIGN.md` is the sole authority for palette, typography, spacing, layout, component appearance, and responsive visual direction.

This document remains authoritative for catalogue semantics, listing behavior, trust/evidence states, interaction requirements, and accessibility acceptance specific to these domain flows.

If a visual rule here conflicts with `DESIGN.md`, follow `DESIGN.md` without changing the product/domain behavior defined here.
```

- [ ] **Step 3: Replace stale deal-completion semantics**

Where this spec says both sides/mutual confirmation completes a deal, replace with:

```markdown
Accepted-offer chat leads to either seller completion or cancellation by either party with a required reason. Seller completion unlocks the applicable review flow. Cancelled deals do not unlock reviews.
```

Do not otherwise redesign the evidence system.

- [ ] **Step 4: Verify obsolete tokens/rules are gone**

```powershell
rg -n "Arial|#F3DFBF|#4A3126|--brand-main|--brand-secondary|both confirm|mutually confirm|mutual confirmation|two confirmations|both parties.*confirm" docs/PERFUME-CATALOG-AND-UI-SPEC.md
```

Expected: no stale authority/transaction rule.

- [ ] **Step 5: Verify durable trust rules remain**

Search current trust/evidence terms already used by the repository and ensure they still exist.

- [ ] **Step 6: Commit**

```powershell
git add docs/PERFUME-CATALOG-AND-UI-SPEC.md
git commit -m "docs: reconcile catalog spec with current design and deal model"
```

---

### Task 10: Mark historical artifacts and dated plans non-authoritative

**Files:**
- Modify: `.builder/progress.md`
- Modify: `.builder/architecture.md`
- Create/modify: `docs/superpowers/README.md`
- Create/modify: `docs/reviews/README.md`
- Create/modify: `docs/testing/README.md` when needed
- Mark the August 15 Agent OS files superseded if they are stored in the repo.

**Interfaces:**
- Consumes: current authority hierarchy.
- Produces: history that cannot silently override current truth.

- [ ] **Step 1: Add banner below `.builder` titles**

```markdown
> **Historical artifact — not current authority.**
>
> This file records an earlier implementation state and may contain obsolete beta, invite, phone, transaction, monetization, or governance assumptions. Do not use it for current product, security, architecture, registration, release, or agent decisions. Use `AGENTS.md`, `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md`, `PRODUCT.md`, `DESIGN.md`, `docs/ARCHITECTURE.md`, and `docs/PROJECT-STATUS.md`.
```

Do not rewrite the historical body.

- [ ] **Step 2: Create/update `docs/superpowers/README.md`**

```markdown
# Superpowers records

Files under `specs/` and `plans/` are dated design and implementation records.

After supersession or task completion they are historical evidence, not current repository authority, unless the active owner task/issue explicitly references them.

Do not scan all historical files at session startup.

Current authority starts with:
- `../../AGENTS.md`
- `../AROMATIKA-LAUNCH-READINESS-DESIGN.md`
- `../../PRODUCT.md`
- `../PROJECT-STATUS.md`
- the active task/issue
- relevant current design/architecture/security/business documents.
```

- [ ] **Step 3: Create/update `docs/reviews/README.md`**

```markdown
# Reviews

Dated review files are point-in-time evidence, not current status.
Do not treat a historical finding as still open or still fixed without checking current code and current status.
Use `../PROJECT-STATUS.md` for current operational state.
```

- [ ] **Step 4: Create/update `docs/testing/README.md` if needed**

```markdown
# Testing records

Dated task-specific testing contracts and remediation notes are historical evidence unless an active task explicitly references them.
Current test behavior is defined by repository tests, current product/security requirements, and the active task.
```

- [ ] **Step 5: Mark August 15 package files when present**

Add below each title:

```markdown
> **Superseded historical design/plan.**
>
> This document is retained as evidence of the 2026-08-15 Agent OS design cycle. Current strategy is `docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md` and current execution uses the 2026-08-17 plans.
```

Do not mutate the old body.

- [ ] **Step 6: Commit**

```powershell
git add .builder docs/superpowers docs/reviews docs/testing
git commit -m "docs: mark superseded plans and builder artifacts historical"
```

---

### Task 11: Deduplicate active architecture/operations without changing durable meaning

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/PRODUCTION-SETUP.md`
- Modify: `docs/BACKUP-RESTORE.md`
- Modify: `docs/INCIDENT-RESPONSE.md`
- Modify: `docs/STAGING-CREDENTIALS.md`

**Interfaces:**
- Consumes: each file's unique operational rules.
- Produces: focused runbooks with no duplicate Agent OS/product authority.

- [ ] **Step 1: List repeated headings**

```powershell
$files = @(
  'docs/ARCHITECTURE.md',
  'docs/PRODUCTION-SETUP.md',
  'docs/BACKUP-RESTORE.md',
  'docs/INCIDENT-RESPONSE.md',
  'docs/STAGING-CREDENTIALS.md'
)
foreach ($f in $files) {
  "=== $f ==="
  rg '^#{1,3} ' $f | Sort-Object | Group-Object | Sort-Object Count -Descending | Select-Object -First 30
}
```

- [ ] **Step 2: Remove duplicate copies and generic agent-process/product boilerplate only**

Preserve unique:
- architecture boundaries;
- exact staging target identifiers;
- backup encryption/restore rules;
- incident severity/containment/evidence rules;
- production isolation;
- RLS/Storage/security boundaries.

Do not redesign runtime architecture.

- [ ] **Step 3: Verify durable markers remain**

Use repository-specific existing markers, including known staging identifiers if still current:

```powershell
rg -n "RLS|Supabase|Cloudflare" docs/ARCHITECTURE.md
rg -n "AES-256-GCM|encrypted" docs/BACKUP-RESTORE.md
rg -n "incident|contain" docs/INCIDENT-RESPONSE.md
```

For staging identifiers, compare to the current file before editing and verify the same exact identifiers remain unless current provider evidence proves they changed.

- [ ] **Step 4: Review diff for lost unique paragraphs**

```powershell
git diff --word-diff -- docs/ARCHITECTURE.md docs/PRODUCTION-SETUP.md docs/BACKUP-RESTORE.md docs/INCIDENT-RESPONSE.md docs/STAGING-CREDENTIALS.md
```

- [ ] **Step 5: Commit**

```powershell
git add docs/ARCHITECTURE.md docs/PRODUCTION-SETUP.md docs/BACKUP-RESTORE.md docs/INCIDENT-RESPONSE.md docs/STAGING-CREDENTIALS.md
git commit -m "docs: deduplicate active architecture and operations"
```

---

### Task 12: Run repository-wide truth contradiction checks

**Files:**
- Test: active Markdown authority.

**Interfaces:**
- Consumes: Tasks 2–11.
- Produces: evidence that current authority is coherent.

- [ ] **Step 1: Find obsolete normal-user/beta claims outside history**

```powershell
rg -n -i "open beta|beta 30|closed beta|invite-only authentication|public registration is disabled|публичната регистрация е изключена|regular user.*phone.*required|normal user.*invite.*required" `
  --glob '*.md' `
  --glob '!docs/superpowers/plans/**' `
  --glob '!docs/superpowers/specs/**' `
  --glob '!docs/reviews/**' `
  --glob '!docs/testing/**' `
  --glob '!.builder/**'
```

Expected: no active-authority contradictions.

- [ ] **Step 2: Find obsolete mutual-confirmation rules outside history**

```powershell
rg -n -i "both confirm|mutually confirm|mutual confirmation|dual confirmation|two confirmations|both parties.*confirm" `
  --glob '*.md' `
  --glob '!docs/superpowers/plans/**' `
  --glob '!docs/superpowers/specs/**' `
  --glob '!docs/reviews/**' `
  --glob '!docs/testing/**' `
  --glob '!.builder/**'
```

Expected: no active product-authority rule requiring dual confirmation.

- [ ] **Step 3: Find obsolete monetization disablement**

```powershell
rg -n -i "paid subscriptions/boosts/ads.*not now|monetization.*disabled|boosts.*disabled|advertising.*disabled" `
  --glob '*.md' `
  --glob '!docs/superpowers/**' `
  --glob '!docs/reviews/**' `
  --glob '!.builder/**'
```

Expected: no active claim that contradicts launch monetization.

- [ ] **Step 4: Find visual authority conflicts**

```powershell
rg -n "Arial Bold Italic|--brand-main|#F3DFBF|#4A3126" `
  --glob '*.md' `
  --glob '!docs/superpowers/**' `
  --glob '!docs/reviews/**' `
  --glob '!.builder/**'
```

Expected: no active visual-authority conflict.

- [ ] **Step 5: Verify master/status roles**

```powershell
rg -n "no longer the strategic master authority|AROMATIKA-LAUNCH-READINESS-DESIGN" docs/MASTER-PLAN.md
if ((rg -c '^# Project Status$' docs/PROJECT-STATUS.md) -ne 1) { throw "Invalid project status snapshot count" }
```

- [ ] **Step 6: Run repository checks**

```powershell
pnpm validate:catalog
pnpm test:unit
pnpm test:db:contracts
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Independent documentation/product review**

Review:
- product truth;
- monetization truth;
- launch scope;
- local/GitHub authority;
- visual authority;
- security/operational invariants;
- historical/current boundaries;
- preservation of perfume-specific evidence rules.

- [ ] **Step 8: Commit review fixes**

```powershell
git add MASTER-PLAN.md PRODUCT.md README.md docs .builder
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m "docs: resolve Launch Readiness truth review findings" }
```

---

### Task 13: PR, CI, merge, synchronize, and handoff

**Files:**
- No new file changes expected.

**Interfaces:**
- Consumes: complete repository truth cleanup.
- Produces: reviewed shared truth and ready next phase.

- [ ] **Step 1: Run full verification**

```powershell
pnpm validate:catalog
pnpm test:unit
pnpm test:db:contracts
pnpm check
pnpm test:e2e
```

Expected: PASS for applicable local tests. Hosted verification must remain explicitly unverified if credentials/evidence are absent.

- [ ] **Step 2: Push and open PR**

```powershell
git push -u origin repository-truth-launch-readiness
gh pr create `
  --base main `
  --head repository-truth-launch-readiness `
  --title "docs: reconcile Aromatika Launch Readiness truth" `
  --body "Reconciles current product, registration, transaction, monetization, launch scope, visual authority, local-first workflow, project status, launch gates, and historical-document boundaries under the approved 2026-08-17 Launch Readiness design. No application behavior is intentionally changed."
```

- [ ] **Step 3: Merge only after required review/CI passes**

- [ ] **Step 4: Reconcile the owner's local workspace safely**

Fetch and compare. Preserve any unrelated intentional local work.

- [ ] **Step 5: End with**

```text
What changed:
The active Aromatika repository now tells one consistent story: normal public registration, seller-completed deals, Bulgaria-only launch, 10 free qualifying listings plus paid 30-day extras and promotion, and one clear document-authority model.

Your action: none.

Sync status:
Synchronized.

Next autonomous steps:
Configure and verify GitHub safety rails, create the evidence-backed Launch Readiness Queue, and exercise one R1 and one R2 autonomous workflow.

Stop condition:
If hosted/runtime facts were not freshly verified, keep that uncertainty visible and create a launch issue instead of claiming the feature is ready.
```
