# Aromatika Search and Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/listings` as a Sharetribe-inspired Aromatika discovery page with a desktop filter sidebar, mobile filter sheet, three-column result grid, URL-preserved state, truthful sorting, and backend-correct navigation.

**Architecture:** Keep `parseListingRouteQuery()` → `browseListings()` as source of truth. Add UI helpers around only supported filters/sorts. Preserve production cursor navigation; render numeric pages only when `pageCount` is exact.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, existing listing contracts/services, Vitest, Testing Library, Playwright.

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

## Capability Reconciliation

Current search truthfully supports category via audience/segments, product format, deal mode, city, price range, keyword, newest sort, and price asc/desc. Production navigation is cursor-based. This plan therefore does not show concentration, ml, remaining %, condition, a relevance sort, or fake numeric production pages.

## File Structure

- Create `src/lib/components/public/search/filter-links.ts`
- Create `SearchFilters.svelte`
- Create `SearchFilterSheet.svelte`
- Create `SortMenu.svelte`
- Create `SearchPagination.svelte`
- Modify `src/routes/listings/query.ts`
- Modify `src/routes/listings/+page.svelte`
- Add tests under `tests/components/` and `tests/server/`
- Modify `tests/e2e/marketplace.spec.ts`

---

### Task 1: Default `/listings` to offers

**Files:** modify `src/routes/listings/query.ts`; create `tests/server/listings-query.test.ts`.

- [ ] **Step 1: RED test**

```ts
import { expect, it } from 'vitest';
import { parseListingRouteQuery } from '../../src/routes/listings/query';

it('defaults catalog to offer listings', () => {
  const { filters, input } = parseListingRouteQuery(new URL('https://example.test/listings'));
  expect(filters.kind).toBe('offer');
  expect(input.kind).toBe('offer');
});
```

- [ ] **Step 2:** Run `pnpm vitest run tests/server/listings-query.test.ts`; expect FAIL.

- [ ] **Step 3: Minimal change**

```ts
kind: oneOf(url.searchParams.get('kind'), ['all','offer','wanted'], 'offer'),
```

Keep explicit old `kind=wanted` and `kind=all` URLs parseable.

- [ ] **Step 4: Verify and commit**

```bash
pnpm vitest run tests/server/listings-query.test.ts
git add src/routes/listings/query.ts tests/server/listings-query.test.ts
git commit -m "feat: default catalog to offers"
```

---

### Task 2: Deterministic filter URL helpers

**Files:** create `filter-links.ts`; test `tests/components/search-filter-links.test.ts`.

**Interfaces:** `setSearchParam`, `clearSearchParam`, `clearAllMarketplaceFilters`. Any filter/sort change clears `page`, `cursorAt`, `cursorPrice`, `cursorId`.

- [ ] **Step 1: RED tests**

```ts
import { expect, it } from 'vitest';
import { clearAllMarketplaceFilters, setSearchParam } from '../../src/lib/components/public/search/filter-links';

it('preserves keyword and clears paging state', () => {
  const url = new URL('https://example.test/listings?q=sauvage&page=4&cursorId=x');
  expect(setSearchParam(url,'format','tester')).toBe('/listings?q=sauvage&format=tester');
});

it('clears marketplace filters but keeps q', () => {
  const url = new URL('https://example.test/listings?q=sauvage&category=men&city=София&sort=price-desc');
  expect(clearAllMarketplaceFilters(url)).toBe('/listings?q=sauvage');
});
```

- [ ] **Step 2: Implement**

```ts
const PAGING = ['page','cursorAt','cursorPrice','cursorId'] as const;

function href(params:URLSearchParams) {
  const value = params.toString();
  return value ? `/listings?${value}` : '/listings';
}

export function setSearchParam(url:URL,key:string,value:string|null) {
  const params = new URLSearchParams(url.searchParams);
  value ? params.set(key,value) : params.delete(key);
  for (const pagingKey of PAGING) params.delete(pagingKey);
  return href(params);
}

export function clearSearchParam(url:URL,key:string) {
  return setSearchParam(url,key,null);
}

export function clearAllMarketplaceFilters(url:URL) {
  const params = new URLSearchParams();
  const q = url.searchParams.get('q')?.trim();
  if (q) params.set('q',q);
  return href(params);
}
```

- [ ] **Step 3: Verify and commit**

```bash
pnpm vitest run tests/components/search-filter-links.test.ts
git add src/lib/components/public/search/filter-links.ts tests/components/search-filter-links.test.ts
git commit -m "feat: add catalog URL helpers"
```

---

### Task 3: Desktop filters and mobile filter sheet

**Files:** create `SearchFilters.svelte`, `SearchFilterSheet.svelte`; test `tests/components/search-filters.test.ts`.

- [ ] **Step 1: RED test**

```ts
// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import SearchFilters from '../../src/lib/components/public/search/SearchFilters.svelte';

it('renders only backend-supported filters', () => {
  const filters = {
    q:'', category:'all', kind:'offer', mode:'all', format:'all', city:'',
    minPrice:'', maxPrice:'', sort:'newest', page:1,
    cursorActivatedAt:'', cursorPriceMinor:'', cursorId:''
  } as const;
  render(SearchFilters, { filters, url:new URL('https://example.test/listings') });
  expect(screen.getByRole('group', { name:'Категория' })).toBeTruthy();
  expect(screen.getByRole('group', { name:'Цена' })).toBeTruthy();
  expect(screen.getByLabelText('Град')).toBeTruthy();
  expect(screen.getByRole('group', { name:'Формат' })).toBeTruthy();
  expect(screen.getByRole('group', { name:'Сделка' })).toBeTruthy();
  expect(screen.queryByText('Остатък')).toBeNull();
  expect(screen.queryByText('Концентрация')).toBeNull();
});
```

- [ ] **Step 2: Implement exact hierarchy**

1. Категория: all / men / women / unisex / niche / arabic
2. Цена: min/max
3. Град
4. Формат: all / `retail_bottle=Флакони` / `tester=Тестери` / `official_sample=Мостри`
5. Сделка: all / sale / swap / sale_or_swap

Price/city GET form preserves current q/category/format/mode/sort via hidden inputs and never preserves paging cursor fields.

- [ ] **Step 3: Mobile sheet**

Trigger `Филтри`; dialog with `aria-modal="true"` and heading `Филтри`; close `Затвори`; reuse `SearchFilters`; Escape closes and focus returns. Footer says `Покажи N обяви` only for exact total, otherwise `Покажи резултатите`.

- [ ] **Step 4: Verify and commit**

```bash
pnpm vitest run tests/components/search-filters.test.ts
pnpm check
git add src/lib/components/public/search tests/components/search-filters.test.ts
git commit -m "feat: add Aromatika catalog filters"
```

---

### Task 4: Truthful sort and pagination/navigation

**Files:** create `SortMenu.svelte`, `SearchPagination.svelte`; test `tests/components/search-pagination.test.ts`.

- [ ] **Step 1: RED test**

```ts
// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import SearchPagination from '../../src/lib/components/public/search/SearchPagination.svelte';

it('does not invent page numbers when count is unknown', () => {
  render(SearchPagination, {
    pageCount:null,
    page:1,
    previousHref:null,
    nextHref:'/listings?cursorId=abc',
    url:new URL('https://example.test/listings')
  });
  expect(screen.queryByRole('link', { name:'2' })).toBeNull();
  expect(screen.getByRole('link', { name:'Следваща страница' })).toBeTruthy();
});
```

- [ ] **Step 2: Implement sort options only**

```svelte
<option value="newest">Най-нови</option>
<option value="price-asc">Цена: ниска → висока</option>
<option value="price-desc">Цена: висока → ниска</option>
```

Do not add `Най-релевантни`.

- [ ] **Step 3: Implement truthful navigation**

When `pageCount !== null`, render numeric pages using `listingPageHref(url,n)`. When `pageCount === null`, render only server-provided previous/next cursor links.

- [ ] **Step 4: Verify and commit**

```bash
pnpm vitest run tests/components/search-pagination.test.ts
pnpm check
git add src/lib/components/public/search/SortMenu.svelte src/lib/components/public/search/SearchPagination.svelte tests/components/search-pagination.test.ts
git commit -m "feat: add catalog sort and navigation"
```

---

### Task 5: Compose Sharetribe-style catalog page

**Files:** modify `src/routes/listings/+page.svelte`, `tests/e2e/marketplace.spec.ts`.

- [ ] **Step 1: E2E first**

```ts
await gotoHydrated(page,'/listings');
await expect(page.getByRole('heading', { name:'Обяви' })).toBeVisible();
await expect(page.getByRole('complementary', { name:'Филтри' })).toBeVisible();
await page.getByRole('link', { name:'Арабски', exact:true }).click();
await expect(page).toHaveURL(/category=arabic/);
await expect(page.getByText('Khamrah', { exact:true })).toBeVisible();
```

For the mobile Playwright project, assert `page.getByRole('button', { name:'Филтри' })`.

- [ ] **Step 2: Compose page**

```svelte
<section class="catalog a-container">
  <header class="catalog-head">
    <div>
      <h1>Обяви</h1>
      <p>{data.listings.totalIsExact ? `${data.listings.total} обяви` : 'Активни обяви'}</p>
    </div>
    <SortMenu ... />
  </header>

  <div class="catalog-layout">
    <aside aria-label="Филтри"><SearchFilters ... /></aside>
    <div>
      {#if data.listings.items.length}
        <div class="results-grid" data-results-grid>
          {#each data.listings.items as listing (listing.id)}
            <MarketplaceListingCard {listing} />
          {/each}
        </div>
        <SearchPagination ... />
      {:else}
        <section class="empty-state">
          <h2>Няма обяви по тези критерии.</h2>
          <a href={clearAllMarketplaceFilters(page.url)}>Изчисти филтрите</a>
        </section>
      {/if}
    </div>
  </div>
</section>
```

Desktop: ~270px sidebar + 3-column grid, 22–24px gaps. <=900px: fixed sidebar hidden, sheet visible, 2-column cards when readable. At 320px use 1 column if 2 columns would violate readability/44px controls.

- [ ] **Step 3: Preserve service-error semantics**

Do not catch `+page.server.ts` 503 into an empty state. `Каталогът временно не е достъпен.` stays a service error.

- [ ] **Step 4: Verify and commit**

```bash
pnpm test:e2e -- --grep "catalog filters|core pages do not create"
pnpm check
pnpm build
git add src/routes/listings/+page.svelte tests/e2e/marketplace.spec.ts
git commit -m "feat: redesign Aromatika catalog"
```

---

### Task 6: Plan 2 exit gate

```bash
pnpm vitest run tests/server/listings-query.test.ts tests/components/search-filter-links.test.ts tests/components/search-filters.test.ts tests/components/search-pagination.test.ts
pnpm test:unit
pnpm check
pnpm build
pnpm test:e2e -- --grep "public marketplace|core pages do not create"
```

Expected: all PASS.

Confirm redesign-only scope:

```bash
git diff --name-only -- supabase/migrations src/lib/contracts src/lib/server/repositories
```

Expected: empty output.
