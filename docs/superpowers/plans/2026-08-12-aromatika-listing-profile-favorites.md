# Aromatika Listing, Profile, and Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose listing detail, seller profile, and favorites around Aromatika’s product/transaction hierarchy while preserving existing offer, evidence, auth, moderation, and review semantics.

**Architecture:** Split the current large listing page into focused presentation components consuming existing DTOs and page actions. Do not rewrite listing server actions. Reuse the Plan 1 public listing card for similar/profile/favorites grids.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, existing listing/offer/profile/review contracts, Vitest, Testing Library, Playwright.

## Global Constraints

- Approved source spec: `docs/superpowers/specs/2026-08-12-aromatika-public-marketplace-design.md`.
- Brand: **Ароматика**.
- Public marketplace UI only. Dashboard/admin/messages/offers/deals/settings keep the existing visual system unless routing glue must change.
- Public typography: Inter. Public palette: ivory + charcoal + cognac. No premium/luxury or dark-editorial drift.
- Whole listing card is clickable; favorite is the only independent card action.
- Header hides on meaningful downward scroll and returns on upward scroll; top-of-page always shows it; reduced-motion removes nonessential transition.
- Search-first. No hero marketing copy, newsletters, testimonials, popular-brands section, or filler content.
- Minimum interactive target 44×44px. Preserve skip link, visible focus, semantic controls, Escape/focus-return for dialogs, and no document-level horizontal overflow.
- Preserve server-first architecture and current auth/RLS/Turnstile/upload/evidence/moderation/offer/review semantics.
- No payments, monetization, new review behavior, or public profile write expansion.
- **Owner choice A:** no Designer/Decant/Set model expansion. Homepage categories are exactly `Мъжки`, `Дамски`, `Унисекс`, `Нишови`, `Арабски`, `Флакони`, `Тестери`, `Мостри`.
- Do not add a migration merely to imitate Sharetribe. Never show a filter, relevance sort, or numeric page the backend cannot truthfully support.
- Stack: Node 22.x, pnpm 11.9.0, SvelteKit 2, Svelte 5, TypeScript, Vitest, Testing Library, Playwright, `@lucide/svelte`.
- At execution start obey `AGENTS.md`: read `docs/MASTER-PLAN.md` and `docs/PROJECT-STATUS.md`; reconcile the known stale phase/status record with current repository evidence before changing product code.

## File Structure

- Create `src/lib/components/public/listing/ListingGallery.svelte`
- Create `ListingSummary.svelte`
- Create `SellerSummary.svelte`
- Create `EvidenceSummary.svelte`
- Create `OfferPanel.svelte`
- Create `StickyTransactionBar.svelte`
- Modify `src/routes/listing/[slug]/+page.svelte`
- Modify `src/routes/profile/[username]/+page.svelte`
- Modify `src/routes/favorites/+page.svelte`
- Add focused component tests
- Modify `tests/e2e/marketplace.spec.ts`

---

### Task 1: Listing gallery

**Files:** create `ListingGallery.svelte`; test `tests/components/listing-gallery.test.ts`.

- [ ] **Step 1: RED test**

```ts
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import ListingGallery from '../../src/lib/components/public/listing/ListingGallery.svelte';

it('labels evidence photos and opens fullscreen gallery', async () => {
  const photos = [
    { id:'1', imageUrl:'https://images.example/full.jpg', role:'product_full', sortOrder:0 },
    { id:'2', imageUrl:'https://images.example/code.jpg', role:'batch_code', sortOrder:1 }
  ] as any;
  render(ListingGallery, { title:'Dior Sauvage', photos });
  expect(screen.getByRole('button', { name:'Покажи Цял флакон' })).toBeTruthy();
  expect(screen.getByRole('button', { name:'Покажи Batch code' })).toBeTruthy();
  await fireEvent.click(screen.getByRole('button', { name:'Отвори снимката на цял екран' }));
  expect(screen.getByRole('dialog', { name:'Снимки на Dior Sauvage' })).toBeTruthy();
});
```

- [ ] **Step 2: Implement exact photo roles**

```ts
const photoRoleLabels = {
  product_full:'Цял флакон',
  bottle_bottom:'Дъно',
  batch_code:'Batch code',
  fill_level:'Ниво',
  box_front:'Кутия',
  box_bottom:'Дъно на кутия',
  seal:'Пломба',
  manufacturer_label:'Етикет',
  manufacturer_markings:'Маркировки',
  other:'Друга'
} as const;
```

Desktop: 1:1 main image + thumbnails. Fullscreen dialog supports arrows, Escape, focus return. Mobile thumbnail scrolling is contained inside the gallery and must not create document overflow.

- [ ] **Step 3: Verify and commit**

```bash
pnpm vitest run tests/components/listing-gallery.test.ts
pnpm check
git add src/lib/components/public/listing/ListingGallery.svelte tests/components/listing-gallery.test.ts
git commit -m "feat: add Aromatika listing gallery"
```

---

### Task 2: Listing summary, seller, and evidence

**Files:** create `ListingSummary.svelte`, `SellerSummary.svelte`, `EvidenceSummary.svelte`; test `tests/components/listing-summary.test.ts`.

- [ ] **Step 1: RED evidence test**

```ts
// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import EvidenceSummary from '../../src/lib/components/public/listing/EvidenceSummary.svelte';

it('never turns evidence review into authenticity guarantee', () => {
  render(EvidenceSummary, {
    listing:{
      authenticityReviewed:true,
      photos:[{ id:'1', imageUrl:'/x.webp', role:'product_full', sortOrder:0 }]
    } as any
  });
  expect(screen.getByText('Доказателствата са прегледани')).toBeTruthy();
  expect(screen.queryByText(/гарантирано оригинален/i)).toBeNull();
});
```

- [ ] **Step 2: Implement `ListingSummary`**

Show only brand/fragrance, concentration/volume, cognac price or wanted budget, remaining amount/percentage, city, and sealed/open state derived from existing fields.

- [ ] **Step 3: Implement seller block**

```text
Продавач
[avatar] @username →
         Частно лице / Проверен търговец
         София
```

Link to `/profile/{username}`.

- [ ] **Step 4: Implement evidence block**

List only photo roles actually present. If `authenticityReviewed`, show `Доказателствата са прегледани`. Keep report/safety actions secondary and never write `Оригинален` as a guarantee.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run tests/components/listing-summary.test.ts
pnpm check
git add src/lib/components/public/listing/ListingSummary.svelte src/lib/components/public/listing/SellerSummary.svelte src/lib/components/public/listing/EvidenceSummary.svelte tests/components/listing-summary.test.ts
git commit -m "feat: split Aromatika listing information"
```

---

### Task 3: Extract structured offer panel without business drift

**Files:** create `OfferPanel.svelte`; modify listing page; test `tests/components/offer-panel.test.ts`; regress `tests/server/listing-route-actions.test.ts`.

**Interface:** form continues POSTing to `?/submitOffer` with `listingId`, `kind`, `cashAmount`, `offeredListingId`, `message`.

- [ ] **Step 1: RED test**

```ts
// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import OfferPanel from '../../src/lib/components/public/listing/OfferPanel.svelte';

it('keeps the three structured offer modes', () => {
  render(OfferPanel, {
    listing:{ id:'l1', dealMode:'sale_or_swap', kind:'offer', price:{ amountMinor:18500, currency:'EUR' } } as any,
    offeredListings:[],
    turnstileSiteKey:null,
    demoMode:true,
    form:null,
    open:true,
    onclose:()=>undefined
  });
  expect(screen.getByRole('radio', { name:'Пари' })).toBeTruthy();
  expect(screen.getByRole('radio', { name:'Размяна' })).toBeTruthy();
  expect(screen.getByRole('radio', { name:'Пари + размяна' })).toBeTruthy();
  expect(screen.getByText(/неподвързващо/i)).toBeTruthy();
});
```

- [ ] **Step 2: Move existing UI behavior**

Preserve default offer kind, amount default, Turnstile field, server `form.offerResult`, success state, Escape, Tab focus trap, focus return, and no optimistic success. Do not rename the server action or fields.

- [ ] **Step 3: Verify and commit**

```bash
pnpm vitest run tests/components/offer-panel.test.ts
pnpm vitest run tests/server/listing-route-actions.test.ts
git add src/lib/components/public/listing/OfferPanel.svelte src/routes/listing/[slug]/+page.svelte tests/components/offer-panel.test.ts
git commit -m "refactor: extract structured offer panel"
```

---

### Task 4: Recompose listing detail and add mobile sticky action

**Files:** create `StickyTransactionBar.svelte`; modify listing page and E2E.

- [ ] **Step 1: E2E first**

```ts
await gotoHydrated(page,'/listing/lattafa-khamrah-edp-100ml');
await expect(page.getByRole('region', { name:'Снимки на обявата' })).toBeVisible();
await expect(page.getByText('Продавач', { exact:true })).toBeVisible();
await expect(page.getByText('Доказателства', { exact:true })).toBeVisible();
await expect(page.getByRole('button', { name:'Изпрати оферта' })).toBeVisible();
```

Keep current offer-variant assertions.

- [ ] **Step 2: Desktop composition**

```svelte
<section class="listing-layout a-container">
  <ListingGallery ... />
  <aside class="transaction-column">
    <ListingSummary {listing} />
    <div class="primary-actions">...</div>
    <SellerSummary seller={listing.seller} city={listing.city} />
  </aside>
</section>

<section class="listing-information a-container">
  <section aria-labelledby="description-title">...</section>
  <EvidenceSummary {listing} />
</section>

<section class="similar a-container">...</section>
```

Similar listings use `MarketplaceListingCard`.

- [ ] **Step 3: Mobile transaction bar**

Use `role="region" aria-label="Действия по обявата"`, price left and exactly one primary action right. Add safe-area bottom padding. When transaction is unavailable, show `Обявата вече не е активна.` instead of an active-looking action.

- [ ] **Step 4: Verify and commit**

```bash
pnpm test:e2e -- --grep "listing offer panel|core pages do not create"
pnpm check
git add src/lib/components/public/listing/StickyTransactionBar.svelte src/routes/listing/[slug]/+page.svelte tests/e2e/marketplace.spec.ts
git commit -m "feat: redesign Aromatika listing detail"
```

---

### Task 5: Simplify public seller profile while keeping real reviews

**Files:** modify `src/routes/profile/[username]/+page.svelte`; test `tests/components/public-profile.test.ts`.

- [ ] **Step 1: RED source contract**

```ts
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('removes editorial profile copy while keeping listings and reviews', () => {
  const source = readFileSync('src/routes/profile/[username]/+page.svelte','utf8');
  expect(source).toContain('Обяви');
  expect(source).toContain('Отзиви');
  expect(source).toContain('ratingCount');
  expect(source).not.toContain('Активна колекция');
  expect(source).not.toContain('Профилната история е една част от прегледа.');
});
```

- [ ] **Step 2: Recompose**

Target:

```text
[avatar] @username
         Частно лице / Проверен търговец
         София · Член от <date>
         ★ 4.9 · 27 отзива   only if ratingCount > 0

Обяви
[public cards]

Отзиви
[existing transaction-derived reviews]
```

Keep report-profile secondary action. No followers/social/gamification.

- [ ] **Step 3: Verify and commit**

```bash
pnpm vitest run tests/components/public-profile.test.ts
pnpm check
git add src/routes/profile/[username]/+page.svelte tests/components/public-profile.test.ts
git commit -m "feat: simplify Aromatika public profile"
```

---

### Task 6: Favorites as marketplace grid

**Files:** modify `src/routes/favorites/+page.svelte`, E2E. Do not change favorites server action semantics.

- [ ] **Step 1: Recompose**

Use `MarketplaceListingCard`. Remove duplicate trash-overlay action. Empty state:

```svelte
<h2>Нямаш запазени обяви.</h2>
<a href="/listings">Разгледай обяви</a>
```

The card heart is the only removal action.

- [ ] **Step 2: Verify**

```bash
pnpm test:unit
pnpm test:e2e -- --grep "public marketplace|core pages do not create"
pnpm check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/favorites/+page.svelte tests/e2e/marketplace.spec.ts
git commit -m "feat: redesign Aromatika favorites"
```

---

### Task 7: Plan 3 exit gate

Run:

```bash
pnpm vitest run tests/components/listing-gallery.test.ts tests/components/listing-summary.test.ts tests/components/offer-panel.test.ts tests/components/public-profile.test.ts tests/server/listing-route-actions.test.ts
pnpm validate:catalog
pnpm test:unit
pnpm check
pnpm build
pnpm test:e2e -- --grep "public marketplace|core pages do not create"
```

Expected: all PASS.

Manual keyboard smoke:
1. Fullscreen gallery opens by keyboard, arrows change image, Escape closes, focus returns.
2. Offer dialog traps focus, Escape closes, focus returns.
3. Reduced-motion removes nonessential movement.
4. 320px has no document-level overflow and sticky action does not cover final content.

Business-layer drift check:

```bash
git diff --name-only -- src/lib/server src/lib/contracts supabase/migrations src/routes/listing/[slug]/+page.server.ts src/routes/profile/[username]/+page.server.ts src/routes/favorites/+page.server.ts
```

Expected: empty output.
