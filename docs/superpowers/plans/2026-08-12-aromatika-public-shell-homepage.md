# Aromatika Public Shell and Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Aromatika public visual foundation, direction-aware header, eight functional categories, reusable public listing card, and simplified four-listing homepage without changing marketplace business rules.

**Architecture:** Introduce dedicated public components under `src/lib/components/public/` and select the public shell by route from `src/routes/+layout.svelte`. Keep private/member/admin presentation intact. Homepage data remains server-loaded and is reduced to four newest offer listings.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, `@lucide/svelte`, `@fontsource-variable/inter`, Vitest, Testing Library, Playwright.

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

- Create `src/lib/components/public/public-route.ts`
- Create `src/lib/components/public/PublicShell.svelte`
- Create `src/lib/components/public/public.css`
- Create `src/lib/components/public/PublicHeader.svelte`
- Create `src/lib/components/public/PublicFooter.svelte`
- Create `src/lib/components/public/MarketplaceSearch.svelte`
- Create `src/lib/components/public/CategoryGrid.svelte`
- Create `src/lib/components/public/MarketplaceListingCard.svelte`
- Create `src/lib/components/public/header-visibility.ts`
- Modify `src/routes/+layout.svelte`
- Modify `src/routes/+page.server.ts`
- Modify `src/routes/+page.svelte`
- Modify `package.json` and `pnpm-lock.yaml`
- Add focused component tests and update `tests/e2e/marketplace.spec.ts`

---

### Task 1: Public route boundary and scoped Inter theme

**Files:** create `public-route.ts`, `PublicShell.svelte`, `public.css`; modify root layout/package files; test `tests/components/public-route.test.ts`.

**Interfaces:** `usesAromatikaPublicShell(pathname: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { usesAromatikaPublicShell } from '../../src/lib/components/public/public-route';

describe('public shell routes', () => {
  it.each([
    ['/', true],
    ['/listings', true],
    ['/listing/lattafa-khamrah-edp-100ml', true],
    ['/wanted', true],
    ['/profile/north_notes', true],
    ['/favorites', true],
    ['/safety', true],
    ['/legal/privacy', true],
    ['/dashboard', false],
    ['/messages', false],
    ['/offers', false],
    ['/publish', false],
    ['/admin', false],
    ['/login', false]
  ])('%s', (pathname, expected) => {
    expect(usesAromatikaPublicShell(pathname)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/components/public-route.test.ts`

Expected: FAIL because `public-route.ts` does not exist.

- [ ] **Step 3: Implement route classifier**

```ts
const EXACT = new Set(['/', '/listings', '/wanted', '/favorites', '/brands', '/merchants', '/safety', '/legal']);
const PREFIXES = ['/listing/', '/profile/', '/brand/', '/brands/', '/legal/'];

export function usesAromatikaPublicShell(pathname: string): boolean {
  return EXACT.has(pathname) || PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
```

- [ ] **Step 4: Add Inter and scoped public tokens**

Run: `pnpm add @fontsource-variable/inter`

Import once in the root layout:

```ts
import '@fontsource-variable/inter';
```

Create `public.css`:

```css
.aromatika-public {
  --a-canvas:#f7f2ea;
  --a-surface:#fffdf9;
  --a-ink:#252321;
  --a-muted:#6c665f;
  --a-cognac:#8c552e;
  --a-cognac-hover:#744523;
  --a-line:rgb(37 35 33 / 12%);
  --a-shadow:0 4px 18px rgb(35 30 25 / 6%);
  --a-shadow-hover:0 10px 28px rgb(35 30 25 / 10%);
  --a-content:1480px;
  color:var(--a-ink);
  background:var(--a-canvas);
  font-family:"Inter Variable",Inter,ui-sans-serif,system-ui,sans-serif;
}
.aromatika-public .a-container {
  width:min(calc(100% - 32px),var(--a-content));
  margin-inline:auto;
}
@media (min-width:900px) {
  .aromatika-public .a-container { width:min(calc(100% - 96px),var(--a-content)); }
}
```

`PublicShell.svelte` wraps children in `.aromatika-public`. Remove `/favorites` from `standardMemberRoutes`; the route remains auth-protected but now uses public marketplace visuals.

- [ ] **Step 5: Verify and commit**

Run:
```bash
pnpm vitest run tests/components/public-route.test.ts
pnpm check
```

Commit:
```bash
git add package.json pnpm-lock.yaml src/routes/+layout.svelte src/lib/components/public tests/components/public-route.test.ts
git commit -m "feat: add Aromatika public shell"
```

---

### Task 2: Direction-aware header and keyword search

**Files:** create `header-visibility.ts`, `MarketplaceSearch.svelte`, `PublicHeader.svelte`; modify root layout; test `tests/components/public-header.test.ts`.

**Interfaces:** `nextHeaderVisibility(state,nextY,threshold?)`; `PublicHeader` consumes existing `data.auth`.

- [ ] **Step 1: Write RED tests**

```ts
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import PublicHeader from '../../src/lib/components/public/PublicHeader.svelte';
import { nextHeaderVisibility } from '../../src/lib/components/public/header-visibility';

afterEach(cleanup);

it('renders approved actions without notifications', () => {
  const auth = {
    user:{ id:'u1' },
    profile:{ username:'north_notes', role:'user' as const },
    betaAccess:{ status:'active' as const, onboardingCompletedAt:'2026-08-01T00:00:00Z', isActive:true }
  };
  render(PublicHeader, { auth, demoMode:true });
  expect(screen.getByRole('link', { name:'Ароматика' })).toBeTruthy();
  expect(screen.getByRole('textbox', { name:'Какво търсиш?' })).toBeTruthy();
  expect(screen.getByRole('link', { name:/Чат/ })).toBeTruthy();
  expect(screen.getByRole('link', { name:/Любими/ })).toBeTruthy();
  expect(screen.getByRole('link', { name:/Твоят профил/ })).toBeTruthy();
  expect(screen.getByRole('link', { name:/Добави обява/ })).toBeTruthy();
  expect(screen.queryByLabelText(/извест/i)).toBeNull();
});

it('hides down and restores up', () => {
  let s = { lastY:0, direction:0 as -1|0|1, accumulated:0, hidden:false };
  s = nextHeaderVisibility(s, 20);
  expect(s.hidden).toBe(true);
  s = nextHeaderVisibility(s, 4);
  expect(s.hidden).toBe(false);
});
```

- [ ] **Step 2: Implement reducer**

```ts
export interface HeaderVisibilityState {
  lastY:number; direction:-1|0|1; accumulated:number; hidden:boolean;
}

export function nextHeaderVisibility(
  state:HeaderVisibilityState,
  nextY:number,
  threshold=12
):HeaderVisibilityState {
  if (nextY <= 0) return { lastY:0, direction:0, accumulated:0, hidden:false };
  const delta = nextY - state.lastY;
  if (delta === 0) return { ...state, lastY:nextY };
  const direction:-1|1 = delta > 0 ? 1 : -1;
  const accumulated = direction === state.direction ? state.accumulated + delta : delta;
  return {
    lastY:nextY,
    direction,
    accumulated,
    hidden: accumulated >= threshold ? true : accumulated <= -threshold ? false : state.hidden
  };
}
```

- [ ] **Step 3: Implement header/search**

Approved desktop order:

```text
Ароматика | [Какво търсиш?  Търси] | Чат | Любими | Твоят профил | Добави обява
```

Use one search form in the DOM and CSS grid areas to move it to mobile row two. Authenticated targets: `/messages`, `/favorites`, `/dashboard`, `/publish`. Anonymous targets use existing safe `next`, e.g. `/login?next=%2Ffavorites`.

Use `svelte:window onscroll`; hide the entire header. Under `prefers-reduced-motion: reduce`, remove transform transition.

- [ ] **Step 4: Root-layout public branch**

```svelte
<PublicShell>
  <PublicHeader auth={data.auth} demoMode={data.demoMode} />
  {#if data.demoMode}<DemoBanner />{/if}
  <main id="main-content">{@render children()}</main>
  <PublicFooter />
</PublicShell>
```

Keep existing Header/MemberShell/Footer for non-public routes.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run tests/components/public-header.test.ts
pnpm check
git add src/lib/components/public src/routes/+layout.svelte tests/components/public-header.test.ts
git commit -m "feat: add Aromatika marketplace header"
```

---

### Task 3: Eight real categories and minimal footer

**Files:** create `CategoryGrid.svelte`, `PublicFooter.svelte`; test `tests/components/category-grid.test.ts`.

- [ ] **Step 1: RED test**

```ts
// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import CategoryGrid from '../../src/lib/components/public/CategoryGrid.svelte';

it('renders eight supported destinations', () => {
  render(CategoryGrid);
  expect(screen.getAllByRole('link')).toHaveLength(8);
  expect(screen.getByRole('link', { name:'Мъжки' }).getAttribute('href')).toBe('/listings?category=men');
  expect(screen.getByRole('link', { name:'Флакони' }).getAttribute('href')).toBe('/listings?format=retail_bottle');
  expect(screen.getByRole('link', { name:'Тестери' }).getAttribute('href')).toBe('/listings?format=tester');
  expect(screen.getByRole('link', { name:'Мостри' }).getAttribute('href')).toBe('/listings?format=official_sample');
});
```

- [ ] **Step 2: Implement exact category array**

```ts
const categories = [
  ['Мъжки','/listings?category=men'],
  ['Дамски','/listings?category=women'],
  ['Унисекс','/listings?category=unisex'],
  ['Нишови','/listings?category=niche'],
  ['Арабски','/listings?category=arabic'],
  ['Флакони','/listings?format=retail_bottle'],
  ['Тестери','/listings?format=tester'],
  ['Мостри','/listings?format=official_sample']
] as const;
```

Use Lucide line icons in circles. Desktop 8 columns; tablet/mobile 4×2; no horizontal scroll.

- [ ] **Step 3: Footer**

Only brand, `Как работи`, `Безопасност`, `Правила`, existing contact/support destination, `Поверителност`, `Общи условия`, copyright. Reuse existing real hrefs.

- [ ] **Step 4: Verify and commit**

```bash
pnpm vitest run tests/components/category-grid.test.ts
pnpm check
git add src/lib/components/public/CategoryGrid.svelte src/lib/components/public/PublicFooter.svelte tests/components/category-grid.test.ts
git commit -m "feat: add Aromatika categories and footer"
```

---

### Task 4: Whole-card public listing card

**Files:** create `MarketplaceListingCard.svelte`; test `tests/components/marketplace-listing-card.test.ts`.

- [ ] **Step 1: RED test**

```ts
// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import MarketplaceListingCard from '../../src/lib/components/public/MarketplaceListingCard.svelte';

it('has one overlay listing link plus independent favorite', () => {
  const listing = {
    id:'l1', slug:'dior-sauvage', kind:'offer', dealMode:'sale',
    title:'Dior Sauvage', brandId:'b1', brandName:'Dior', brandSlug:'dior',
    fragranceName:'Sauvage', concentration:'EDP', city:'София',
    price:{ amountMinor:18500, currency:'EUR' }, maxBudget:null,
    bottleVolumeMl:60, remainingMl:55, isSealed:false, status:'active',
    seller:{ id:'s1', username:'north_notes', avatarUrl:null, accountKind:'private', merchantVerified:false },
    primaryPhoto:null, authenticityReviewed:false, isFavorite:false, createdAt:'2026-08-01T00:00:00Z'
  } as any;
  render(MarketplaceListingCard, { listing });
  expect(screen.getByRole('link', { name:'Отвори Dior Sauvage' }).getAttribute('href')).toBe('/listing/dior-sauvage');
  expect(screen.getByRole('button', { name:'Добави Dior Sauvage в любими' })).toBeTruthy();
  expect(screen.queryByRole('link', { name:/Виж обявата/ })).toBeNull();
});
```

- [ ] **Step 2: Implement semantic structure**

Use an absolute overlay `<a class="card-hit-area">` and put the favorite form above it with higher z-index. Show image, name, `ml · %`, city, cognac price, heart only.

Required visual rules: ~24px card radius, 1:1 image, 18–20px image radius, no resting border, subtle shadow, desktop lift max 2px, image scale max 1.01, reduced-motion disables transform.

- [ ] **Step 3: Verify and commit**

```bash
pnpm vitest run tests/components/marketplace-listing-card.test.ts
pnpm check
git add src/lib/components/public/MarketplaceListingCard.svelte tests/components/marketplace-listing-card.test.ts
git commit -m "feat: add Aromatika public listing card"
```

---

### Task 5: Four-listing homepage

**Files:** modify `src/routes/+page.server.ts`, `src/routes/+page.svelte`, `tests/e2e/marketplace.spec.ts`.

- [ ] **Step 1: Update E2E first**

```ts
await gotoHydrated(page, '/');
await expect(page.getByRole('link', { name:'Ароматика' })).toBeVisible();
await expect(page.getByRole('navigation', { name:'Категории парфюми' }).getByRole('link')).toHaveCount(8);
await expect(page.getByRole('heading', { name:'Последно публикувани' })).toBeVisible();
await expect(page.locator('[data-marketplace-card]')).toHaveCount(4);
await expect(page.getByText('Всеки аромат има следваща история.')).toHaveCount(0);
```

- [ ] **Step 2: Simplify loader**

Use:

```ts
const common = { query:'', segments:[], offset:0, sort:'newest' as const, kind:'offer' as const };
```

Load `limit:4` in demo and real mode. Remove homepage wanted query/payload.

- [ ] **Step 3: Replace homepage composition**

Only:
1. `CategoryGrid`
2. `Последно публикувани` + `Виж всички →`
3. four cards when available

Desktop 4 columns; mobile 2×2. No additional content section.

- [ ] **Step 4: Verify and commit**

```bash
pnpm test:e2e -- --grep "home search leads|core pages do not create"
pnpm check
pnpm build
git add src/routes/+page.server.ts src/routes/+page.svelte tests/e2e/marketplace.spec.ts
git commit -m "feat: simplify Aromatika homepage"
```

---

### Task 6: Plan 1 exit gate

Run:

```bash
pnpm validate:catalog
pnpm test:unit
pnpm check
pnpm build
pnpm test:e2e -- --grep "public marketplace|core pages do not create"
```

Expected: all PASS.

Scope check:

```bash
git diff --name-only -- src/routes/dashboard src/routes/admin src/lib/components/MemberShell.svelte
```

Expected: no redesign changes.
