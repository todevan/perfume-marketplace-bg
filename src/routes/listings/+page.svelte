<script lang="ts">
  import { tick } from 'svelte';
  import { ChevronDown, Grid2X2, ListFilter, RotateCcw, SlidersHorizontal, X } from '@lucide/svelte';
  import ListingCard from '$components/ListingCard.svelte';
  import SearchBar from '$components/SearchBar.svelte';

  let { data } = $props();
  let filterOpen = $state(false);
  let filterPanel: HTMLFormElement | undefined;
  let filterOpener: HTMLButtonElement | undefined;
  const categories = [
    { slug: 'men', label: 'Мъжки' },
    { slug: 'women', label: 'Дамски' },
    { slug: 'unisex', label: 'Унисекс' },
    { slug: 'niche', label: 'Нишови' },
    { slug: 'arabic', label: 'Арабски' }
  ] as const;

  function categoryHref(category: string): string {
    const params = new URLSearchParams();
    if (data.filters.q) params.set('q', data.filters.q);
    if (data.filters.kind !== 'all') params.set('kind', data.filters.kind);
    if (data.filters.mode !== 'all') params.set('mode', data.filters.mode);
    if (data.filters.format !== 'all') params.set('format', data.filters.format);
    if (data.filters.city) params.set('city', data.filters.city);
    if (data.filters.minPrice) params.set('minPrice', data.filters.minPrice);
    if (data.filters.maxPrice) params.set('maxPrice', data.filters.maxPrice);
    if (data.filters.sort !== 'newest') params.set('sort', data.filters.sort);
    if (category !== 'all') params.set('category', category);
    const query = params.toString();
    return query ? `/listings?${query}` : '/listings';
  }

  async function openFilters(): Promise<void> {
    filterOpen = true;
    await tick();
    filterPanel?.querySelector<HTMLElement>('.filter-close')?.focus();
  }

  async function closeFilters(): Promise<void> {
    filterOpen = false;
    await tick();
    filterOpener?.focus();
  }

  function handleFilterKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && filterOpen) {
      event.preventDefault();
      void closeFilters();
    }
  }
</script>

<svelte:window onkeydown={handleFilterKeydown} />

<svelte:head>
  <title>Обяви за парфюми · продажба и размяна</title>
  <meta name="description" content="Филтрирай нови и употребявани парфюми по марка, категория, цена и остатък." />
</svelte:head>

<section class="catalog-hero">
  <div class="container">
    <span class="eyebrow">Каталог на общността</span>
    <div class="catalog-title"><h1>Обяви</h1><span>{data.listings.totalIsExact ? '' : 'Поне '}{data.listings.total.toString().padStart(2, '0')} резултата</span></div>
    <SearchBar value={data.filters.q} compact />
    <div class="quick-categories" id="categories">
      <a class:active={data.filters.category === 'all'} href={categoryHref('all')}>Всички</a>
      {#each categories as category}
        <a class:active={data.filters.category === category.slug} href={categoryHref(category.slug)}>{category.label}</a>
      {/each}
    </div>
  </div>
</section>

<section class="catalog-body container">
  <button bind:this={filterOpener} class="mobile-filter button secondary" type="button" onclick={openFilters} aria-expanded={filterOpen}><SlidersHorizontal size={17} /> Филтри</button>

  <form bind:this={filterPanel} method="GET" class:open={filterOpen} class="filters" aria-label="Филтри">
    <div class="filter-head"><div><ListFilter size={19} /><strong>Филтри</strong></div><button class="filter-close" type="button" onclick={closeFilters} aria-label="Затвори филтрите"><X size={21} /></button></div>
    <input type="hidden" name="q" value={data.filters.q} />
    <input type="hidden" name="category" value={data.filters.category === 'all' ? '' : data.filters.category} />
    <div class="filter-block">
      <label for="listing-kind">Посока</label>
      <div class="select-wrap"><select id="listing-kind" name="kind" value={data.filters.kind}><option value="all">Всички</option><option value="offer">Предлагам</option><option value="wanted">Търся</option></select><ChevronDown size={16} /></div>
    </div>
    <div class="filter-block">
      <label for="deal-mode">Начин на сделката</label>
      <div class="select-wrap"><select id="deal-mode" name="mode" value={data.filters.mode}><option value="all">Всички</option><option value="sale">Продажба</option><option value="swap">Размяна</option><option value="sale_or_swap">Продажба или размяна</option></select><ChevronDown size={16} /></div>
    </div>
    <div class="filter-block">
      <label for="product-format">Формат</label>
      <div class="select-wrap"><select id="product-format" name="format" value={data.filters.format}><option value="all">Всички</option><option value="retail_bottle">Оригинален флакон</option><option value="tester">Тестер</option><option value="official_sample">Официална мостра</option></select><ChevronDown size={16} /></div>
    </div>
    <div class="filter-block">
      <label for="city">Град</label>
      <input class="filter-input" id="city" name="city" value={data.filters.city} placeholder="Напр. София" />
    </div>
    <div class="filter-block price-pair">
      <label for="min-price">Цена в EUR</label>
      <div><input class="filter-input" id="min-price" name="minPrice" type="number" min="1" step="1" value={data.filters.minPrice} placeholder="От" /><input class="filter-input" name="maxPrice" type="number" min="1" step="1" value={data.filters.maxPrice} placeholder="До" aria-label="Максимална цена" /></div>
    </div>
    <button class="button primary filter-submit" type="submit">Приложи филтрите</button>
    <a class="reset" href="/listings"><RotateCcw size={15} /> Изчисти филтрите</a>
  </form>

  {#if filterOpen}<button class="filter-scrim" type="button" aria-label="Затвори филтрите" onclick={closeFilters}></button>{/if}

  <div class="results">
    <div class="results-head">
      <p><strong>{data.listings.totalIsExact ? data.listings.total : `поне ${data.listings.total}`}</strong> активни обяви</p>
      <form method="GET" class="sort-form">
        {#if data.filters.q}<input type="hidden" name="q" value={data.filters.q} />{/if}
        {#if data.filters.category !== 'all'}<input type="hidden" name="category" value={data.filters.category} />{/if}
        {#if data.filters.kind !== 'all'}<input type="hidden" name="kind" value={data.filters.kind} />{/if}
        {#if data.filters.mode !== 'all'}<input type="hidden" name="mode" value={data.filters.mode} />{/if}
        {#if data.filters.format !== 'all'}<input type="hidden" name="format" value={data.filters.format} />{/if}
        {#if data.filters.city}<input type="hidden" name="city" value={data.filters.city} />{/if}
        {#if data.filters.minPrice}<input type="hidden" name="minPrice" value={data.filters.minPrice} />{/if}
        {#if data.filters.maxPrice}<input type="hidden" name="maxPrice" value={data.filters.maxPrice} />{/if}
        <span>Подреждане</span><select name="sort" aria-label="Подреждане" value={data.filters.sort} onchange={(event) => (event.currentTarget as HTMLSelectElement).form?.requestSubmit()}><option value="newest">Най-нови</option><option value="price-asc">Най-ниска цена</option><option value="price-desc">Най-висока цена</option></select><Grid2X2 size={18} />
      </form>
    </div>

    {#if data.listings.items.length}
      <div class="results-grid">
        {#each data.listings.items as listing (listing.id)}<ListingCard {listing} variant="catalog" />{/each}
      </div>
      {#if data.previousHref || data.nextHref}
        <nav class="pagination" aria-label="Страници с обяви">
          {#if data.previousHref}<a class="button secondary" href={data.previousHref}>{data.pageCount ? 'Предишна' : 'Към началото'}</a>{/if}
          <span>{data.pageCount ? `Страница ${data.filters.page} от ${data.pageCount}` : 'Още резултати по същите филтри'}</span>
          {#if data.nextHref}<a class="button secondary" href={data.nextHref}>Следваща</a>{/if}
        </nav>
      {/if}
    {:else}
      <div class="empty-state"><div><h2>Няма точно такъв флакон.</h2><p class="muted">Изчисти част от филтрите или опитай с друга марка.</p>{#if data.nextHref}<a class="button primary" href={data.nextHref}>Провери следващите резултати</a>{:else}<a class="button primary" href="/listings">Изчисти филтрите</a>{/if}</div></div>
    {/if}
  </div>
</section>

<style>
  .catalog-hero {
    padding: clamp(42px, 6vw, 76px) 0 28px;
    border-bottom: 1px solid var(--line);
    background: var(--paper);
  }

  .catalog-title {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 26px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--line);
  }

  h1 {
    margin-bottom: 0;
    font-size: clamp(2.8rem, 6vw, 5.25rem);
    font-style: normal;
    letter-spacing: -0.055em;
  }

  .catalog-title > span {
    padding-bottom: 6px;
    color: var(--ink-soft);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  :global(.catalog-hero .search-shell) {
    max-width: none;
  }

  .quick-categories {
    display: flex;
    gap: 8px;
    padding-top: 18px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .quick-categories a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 9px 15px;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--paper-strong);
    white-space: nowrap;
    transition: border-color 160ms ease, color 160ms ease, background 160ms ease;
  }

  .quick-categories a:hover {
    border-color: var(--action);
    color: var(--action);
  }

  .quick-categories a.active {
    border-color: var(--action);
    color: var(--paper-strong);
    background: var(--action);
    font-weight: 700;
  }

  .catalog-body {
    display: grid;
    align-items: start;
    grid-template-columns: 258px minmax(0, 1fr);
    gap: clamp(28px, 4vw, 52px);
    padding-block: 36px 96px;
  }

  .filters {
    position: sticky;
    top: calc(var(--header-height) + 24px);
    display: grid;
    gap: 0;
    padding: 0 18px 18px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper-strong);
  }

  .filter-head {
    display: flex;
    min-height: 58px;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--line);
  }

  .filter-head > div {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .filter-head button {
    display: none;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
  }

  .filter-block {
    padding-block: 17px;
    border-bottom: 1px solid var(--line);
  }

  .filter-input {
    width: 100%;
    min-height: 44px;
    padding: 9px 11px;
    border: 1px solid var(--line);
    border-radius: 4px;
    color: var(--ink);
    background: var(--paper-strong);
  }

  .filter-input:focus-visible,
  .select-wrap select:focus-visible,
  .results-head select:focus-visible {
    border-color: var(--action);
    outline: 2px solid var(--action);
    outline-offset: 2px;
  }

  .price-pair > div {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .filter-submit {
    width: 100%;
    margin-top: 18px;
  }

  .filter-block > label:not(:has(input[type='checkbox'])) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    color: var(--ink-soft);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .select-wrap {
    position: relative;
  }

  .select-wrap select,
  .results-head select {
    width: 100%;
    min-height: 44px;
    padding: 9px 34px 9px 11px;
    border: 1px solid var(--line);
    border-radius: 4px;
    appearance: none;
    color: var(--ink);
    background: var(--paper-strong);
  }

  .select-wrap :global(svg) {
    position: absolute;
    top: 14px;
    right: 11px;
    pointer-events: none;
  }

  .reset {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    gap: 7px;
    justify-self: start;
    padding: 0;
    border: 0;
    color: var(--ink-soft);
    background: transparent;
    cursor: pointer;
    font-size: 0.75rem;
    text-decoration: underline;
    text-underline-offset: 4px;
  }

  .results {
    min-width: 0;
  }

  .results-head {
    display: flex;
    min-height: 50px;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--line);
  }

  .results-head p {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.78rem;
  }

  .sort-form {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .sort-form span {
    color: var(--ink-faint);
    font-size: 0.69rem;
  }

  .results-head select {
    width: auto;
    min-height: 44px;
    padding: 5px 8px;
    border: 0;
    background: transparent;
    font-size: 0.76rem;
    font-weight: 700;
  }

  .results-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    margin-top: 32px;
  }

  .pagination span {
    color: var(--ink-soft);
    font-size: 0.76rem;
  }

  .mobile-filter,
  .filter-scrim {
    display: none;
  }

  @media (max-width: 1080px) {
    .results-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .catalog-hero {
      padding-top: 45px;
    }

    .catalog-body {
      grid-template-columns: 1fr;
      padding-top: 20px;
    }

    .mobile-filter {
      display: inline-flex;
      width: fit-content;
    }

    .filters {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 90;
      width: min(88vw, 380px);
      padding: 18px 22px 28px;
      border-width: 0 0 0 1px;
      border-radius: 0;
      overflow-y: auto;
      background: var(--paper-strong);
      transform: translateX(110%);
      visibility: hidden;
      transition: transform 220ms ease;
    }

    .filters.open {
      transform: translateX(0);
      visibility: visible;
    }

    .filter-head button {
      display: grid;
    }

    .filter-scrim {
      position: fixed;
      inset: 0;
      z-index: 80;
      display: block;
      border: 0;
      background: rgb(36 28 22 / 42%);
    }

    .results-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 540px) {
    .quick-categories {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      overflow: visible;
    }

    .quick-categories a {
      justify-content: center;
      padding-inline: 6px;
      text-align: center;
    }

    .results-grid {
      grid-template-columns: 1fr;
    }

    .sort-form span,
    .sort-form > :global(svg) {
      display: none;
    }
  }
</style>
