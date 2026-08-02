<script lang="ts">
  import {
    ArrowRight,
    BadgeCheck,
    Camera,
    MessageCircle,
    Repeat2,
    ShieldCheck,
    UserRound
  } from '@lucide/svelte';
  import ListingCard from '$components/ListingCard.svelte';
  import SearchBar from '$components/SearchBar.svelte';
  import {
    formatConcentration,
    formatListingPrice
  } from '$lib/components/listing/presentation';

  let { data } = $props();

  const categories = [
    { slug: 'men', label: 'Мъжки' },
    { slug: 'women', label: 'Дамски' },
    { slug: 'unisex', label: 'Унисекс' },
    { slug: 'niche', label: 'Нишови' },
    { slug: 'arabic', label: 'Арабски' }
  ] as const;

  let featured = $derived(data.latest.items[0] ?? null);
  let primaryListings = $derived(data.latest.items.slice(1, 3));
  let compactListings = $derived(data.latest.items.slice(3, 7));
</script>

<svelte:head>
  <title>Парфюми за продажба и размяна · България</title>
  <meta
    name="description"
    content="Открий нови и употребявани парфюми от частни колекционери и проверени търговци."
  />
</svelte:head>

<!--
THESIS: Общността се чете през конкретния флакон; отказваме storefront hero и checkout логика.
OWN-WORLD: Ivory хартия, тъмнокафяв текст, taupe линии, burgundy действия и плътни фотографски карти.
STORY: Посетителят търси аромат, вижда точния остатък и продавач, проверява доверието и отваря обява.
FIRST VIEWPORT: Компактна търсачка и категории водят към една featured обява, две стандартни и втори ред compact карти; публикуването остава в header.
FORM: Community curation, композиция №3; staging: featured bottle + adjacent pair + compact grid; seed bbcb391a.
-->

<section class="market-intro">
  <div class="container">
    <div class="intro-heading">
      <h1>Всеки аромат има следваща история.</h1>
      <p>Реални флакони, точен остатък и профил зад всяка оферта.</p>
    </div>

    <div class="discovery-bar">
      <SearchBar />
      <nav class="category-nav" id="categories" aria-label="Категории парфюми">
        {#each categories as category}
          <a href={`/brands/${category.slug}`}>{category.label}</a>
        {/each}
      </nav>
    </div>
  </div>
</section>

<section class="community-listings" aria-labelledby="community-listings-title">
  <div class="container">
    <div class="section-title-row">
      <div>
        <span class="eyebrow">Последно публикувани</span>
        <h2 id="community-listings-title">Нови флакони от общността</h2>
      </div>
      <a class="section-link" href="/listings">Виж всички обяви <ArrowRight size={17} /></a>
    </div>

    {#if featured}
      <div class="lead-market-grid">
        <div class="featured-slot">
          <ListingCard listing={featured} variant="featured" />
        </div>
        <div class="primary-slots">
          {#each primaryListings as listing (listing.id)}
            <ListingCard {listing} variant="catalog" />
          {/each}
        </div>
      </div>

      {#if compactListings.length}
        <div class="compact-market-grid">
          {#each compactListings as listing (listing.id)}
            <ListingCard {listing} variant="compact" />
          {/each}
        </div>
      {/if}
    {:else}
      <div class="empty-state">
        <div>
          <h2>Все още няма активни обяви.</h2>
          <p class="muted">Бъди първият човек в общността, който публикува конкретен флакон.</p>
          <a class="button primary" href="/publish">Публикувай обява</a>
        </div>
      </div>
    {/if}
  </div>
</section>

<section class="community-board section" id="requests" aria-labelledby="community-board-title">
  <div class="container board-grid">
    <div class="wanted-panel">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">Търся / Размяна</span>
          <h2 id="community-board-title">Аромати, които общността търси</h2>
        </div>
        <a href="/wanted">Всички търсения <ArrowRight size={16} /></a>
      </div>

      {#if data.wanted.items.length}
        <div class="wanted-list">
          {#each data.wanted.items as item (item.id)}
            <a class="wanted-row" href={`/listing/${item.slug}`}>
              <span class="wanted-mode"><Repeat2 size={16} /> Търся</span>
              <span class="wanted-title">
                <strong>{item.brandName} {item.fragranceName}</strong>
                <small>{formatConcentration(item.concentration)} · @{item.seller.username} · {item.city}</small>
              </span>
              <span class="wanted-budget">{formatListingPrice(item)}</span>
              <ArrowRight size={16} />
            </a>
          {/each}
        </div>
      {:else}
        <div class="wanted-empty">
          <Repeat2 size={26} />
          <div>
            <strong>Няма активни wanted обяви.</strong>
            <p>Опиши аромата, който търсиш, и общността ще може да ти предложи конкретен флакон.</p>
          </div>
          <a class="button secondary" href="/publish?kind=wanted">Публикувай „Търся“</a>
        </div>
      {/if}
    </div>

    <aside class="community-note" aria-label="Как работи общността">
      <UserRound size={24} />
      <span class="eyebrow">Профил преди обещание</span>
      <h2>Продавачът е част от обявата.</h2>
      <p>
        Виждаш username, град и вида на профила още докато разглеждаш. Чатът се отключва
        след приета структурирана оферта.
      </p>
      <a href="/safety">Как пазим общността <ArrowRight size={16} /></a>
    </aside>
  </div>
</section>

<section class="trust-section" aria-labelledby="trust-title">
  <div class="container trust-layout">
    <div class="trust-copy">
      <span class="eyebrow">Доверие с ясни граници</span>
      <h2 id="trust-title">Доказателствата се преглеждат. Автентичността не се обещава.</h2>
      <p>
        За отворен флакон очакваме снимки на целия продукт, дъното, batch кода и нивото.
        За запечатан продукт — лице, дъно на кутията, код и пломби.
      </p>
      <div class="trust-actions">
        <a class="button primary" href="/safety">Прочети ръководството</a>
        <a class="text-link" href="/legal/rules">Правила на marketplace <ArrowRight size={16} /></a>
      </div>
    </div>

    <div class="trust-process" aria-label="Процес за доверие">
      <div>
        <Camera size={21} />
        <span><strong>Различни снимки</strong><small>Флакон, дъно, код и ниво</small></span>
      </div>
      <div>
        <BadgeCheck size={21} />
        <span><strong>Преглед на доказателства</strong><small>Точно означен статус</small></span>
      </div>
      <div>
        <MessageCircle size={21} />
        <span><strong>Структурирана оферта</strong><small>След нея се отключва чатът</small></span>
      </div>
      <div>
        <ShieldCheck size={21} />
        <span><strong>Сигнал и модерация</strong><small>Видим процес за проблеми</small></span>
      </div>
    </div>
  </div>
</section>

<style>
  .market-intro {
    padding: 32px 0 24px;
    border-bottom: 1px solid var(--line);
  }

  .intro-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 30px;
    margin-bottom: 22px;
  }

  .intro-heading h1 {
    max-width: 760px;
    margin: 0;
    font-size: clamp(1.8rem, 3.2vw, 3.2rem);
  }

  .intro-heading p {
    margin: 0 0 4px;
    color: var(--ink-soft);
  }

  .discovery-bar {
    display: grid;
    grid-template-columns: minmax(320px, 1fr) auto;
    align-items: center;
    gap: 12px;
  }

  :global(.market-intro .search-shell) {
    width: 100%;
  }

  .category-nav {
    display: flex;
    min-height: 58px;
    align-items: center;
    gap: 2px;
    padding: 6px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--paper-strong);
  }

  .category-nav a {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    padding: 8px 15px;
    border-radius: 6px;
    color: var(--ink-soft);
    font-size: 0.77rem;
    font-weight: 600;
  }

  .category-nav a:hover {
    color: var(--action);
    background: var(--action-soft);
  }

  .community-listings {
    padding: 28px 0 64px;
  }

  .section-title-row,
  .panel-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 20px;
  }

  .section-title-row h2,
  .panel-heading h2 {
    margin: 0;
    font-size: clamp(1.55rem, 2.5vw, 2.5rem);
  }

  .section-link,
  .panel-heading > a,
  .community-note > a,
  .text-link {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    gap: 8px;
    color: var(--action);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .lead-market-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
    gap: 12px;
  }

  .featured-slot,
  .primary-slots {
    min-width: 0;
  }

  .primary-slots {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .compact-market-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-top: 12px;
  }

  .community-board {
    border-top: 1px solid var(--line);
    background: var(--paper-strong);
  }

  .board-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.65fr) minmax(280px, 0.7fr);
    gap: clamp(28px, 5vw, 72px);
  }

  .wanted-panel {
    min-width: 0;
  }

  .wanted-list {
    border-top: 1px solid var(--line);
  }

  .wanted-row {
    display: grid;
    min-height: 76px;
    align-items: center;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    gap: 16px;
    border-bottom: 1px solid var(--line);
  }

  .wanted-row:hover .wanted-title strong {
    color: var(--action);
  }

  .wanted-mode {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--action);
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .wanted-title {
    display: grid;
    min-width: 0;
  }

  .wanted-title strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wanted-title small {
    margin-top: 4px;
    color: var(--ink-faint);
  }

  .wanted-budget {
    font-weight: 700;
  }

  .wanted-empty {
    display: grid;
    min-height: 156px;
    align-items: center;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 18px;
    padding: 20px;
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-md);
    color: var(--ink-soft);
  }

  .wanted-empty p {
    margin: 4px 0 0;
    font-size: 0.86rem;
  }

  .community-note {
    align-self: start;
    padding: 28px 0 28px 28px;
    border-left: 1px solid var(--line);
  }

  .community-note > :global(svg) {
    margin-bottom: 36px;
    color: var(--action);
  }

  .community-note h2 {
    margin-bottom: 14px;
    font-size: clamp(1.5rem, 2.4vw, 2.3rem);
  }

  .community-note p {
    color: var(--ink-soft);
    font-size: 0.9rem;
  }

  .trust-section {
    padding: clamp(64px, 8vw, 108px) 0;
    color: var(--paper);
    background: #2b201a;
  }

  .trust-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(420px, 0.95fr);
    align-items: center;
    gap: clamp(48px, 8vw, 120px);
  }

  .trust-copy .eyebrow {
    color: #d8aab1;
  }

  .trust-copy h2 {
    max-width: 760px;
    color: var(--paper-strong);
  }

  .trust-copy p {
    color: rgb(248 243 235 / 70%);
  }

  .trust-actions {
    display: flex;
    align-items: center;
    gap: 22px;
    margin-top: 28px;
  }

  .trust-actions .primary {
    background: #9b3443;
  }

  .trust-actions .primary:hover {
    background: #b34454;
  }

  .trust-actions .text-link {
    color: var(--paper);
  }

  .trust-process {
    border-top: 1px solid rgb(248 243 235 / 22%);
  }

  .trust-process > div {
    display: grid;
    min-height: 82px;
    align-items: center;
    grid-template-columns: 32px 1fr;
    gap: 16px;
    border-bottom: 1px solid rgb(248 243 235 / 22%);
  }

  .trust-process > div > :global(svg) {
    color: #d8aab1;
  }

  .trust-process span {
    display: grid;
  }

  .trust-process strong {
    color: var(--paper-strong);
  }

  .trust-process small {
    margin-top: 3px;
    color: rgb(248 243 235 / 58%);
  }

  @media (max-width: 1120px) {
    .discovery-bar,
    .lead-market-grid,
    .board-grid,
    .trust-layout {
      grid-template-columns: 1fr;
    }

    .category-nav {
      overflow-x: auto;
      justify-content: flex-start;
    }

    .community-note {
      padding: 28px 0 0;
      border-top: 1px solid var(--line);
      border-left: 0;
    }

    .trust-layout {
      gap: 44px;
    }
  }

  @media (max-width: 900px) {
    .compact-market-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 700px) {
    .market-intro {
      padding-top: 24px;
    }

    .intro-heading,
    .section-title-row,
    .panel-heading,
    .trust-actions {
      align-items: flex-start;
      flex-direction: column;
    }

    .intro-heading p {
      font-size: 0.88rem;
    }

    .category-nav {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      overflow: visible;
      padding: 6px;
    }

    .category-nav a {
      justify-content: center;
      padding-inline: 6px;
      text-align: center;
    }

    .category-nav a:nth-child(-n + 3) {
      grid-column: span 2;
    }

    .category-nav a:nth-child(n + 4) {
      grid-column: span 3;
    }

    .primary-slots,
    .compact-market-grid {
      grid-template-columns: 1fr;
    }

    .wanted-row {
      grid-template-columns: 1fr auto;
      padding-block: 14px;
    }

    .wanted-mode,
    .wanted-title {
      grid-column: 1;
    }

    .wanted-budget {
      grid-row: 1 / span 2;
      grid-column: 2;
    }

    .wanted-row > :global(svg) {
      display: none;
    }

    .wanted-empty {
      align-items: start;
      grid-template-columns: 1fr;
    }
  }
</style>
