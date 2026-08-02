<script lang="ts">
  import { ArrowRight, Bell, BookmarkPlus, Search } from '@lucide/svelte';
  import ListingCard from '$components/ListingCard.svelte';
  import SearchBar from '$components/SearchBar.svelte';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form: { ok?: boolean; error?: { message: string } } | null } = $props();
  let brand = $derived(data.brand.canonicalName);
  let listings = $derived(data.listings.items);
</script>

<svelte:head><title>{brand} · обяви и аромати</title><meta name="description" content={`Активни обяви за парфюми ${brand} в България.`} /></svelte:head>

<section class="brand-hero">
  <div class="brand-orbit"></div>
  <div class="container brand-grid">
    <div><span class="eyebrow">Канонична марка</span><h1>{brand}</h1><p>Всички активни флакони, предложения за размяна и търсения от общността на едно място.</p><div class="actions">{#if data.databaseBrandId}<form method="POST" action="?/save"><input type="hidden" name="brandId" value={data.databaseBrandId} /><input type="hidden" name="brandName" value={brand} /><input type="hidden" name="notificationsEnabled" value="true" /><button class="button primary" type="submit"><Bell size={17} /> Следи марката</button></form>{/if}<a class="button secondary" href={`/listings?q=${encodeURIComponent(brand)}`}><BookmarkPlus size={17} /> В каталога</a></div>{#if form?.ok}<p class="action-feedback" role="status">Търсенето е запазено и известията са включени.</p>{:else if form?.error}<p class="action-feedback error" role="alert">{form.error.message}</p>{/if}</div>
    <div class="brand-monogram" aria-hidden="true"><span>{brand.slice(0, 2).toUpperCase()}</span><small>BG · CATALOGUE</small></div>
  </div>
</section>

<section class="brand-stats"><div class="container"><div><strong>{data.listings.total}</strong><span>активни обяви</span></div><div><strong>{new Set(listings.map((item) => item.fragranceName)).size}</strong><span>аромата</span></div><div><strong>{listings.filter((item) => item.dealMode !== 'sale').length}</strong><span>възможни размени</span></div><div><strong>—</strong><span>без комисиона по сделката</span></div></div></section>

<section class="section">
  <div class="container">
    <div class="section-heading"><div><span class="eyebrow">Налични сега</span><h2>Флакони от {brand}.</h2></div><div class="mini-search"><SearchBar compact /></div></div>
    {#if listings.length}<div class="listing-grid">{#each listings as listing}<ListingCard {listing} variant="catalog" />{/each}</div>{:else}<div class="empty-state"><div><Search size={30} /><h2>Все още няма активен флакон.</h2><p class="muted">Запази търсенето и ще получиш известие при нова обява.</p></div></div>{/if}
  </div>
</section>

<section class="brand-note"><div class="container"><div><span class="eyebrow">За каталога</span><h2>Марката не определя аудиторията.</h2></div><p>Мъжки, дамски, унисекс, нишов и арабски се задават за конкретната обява. Така една марка може коректно да присъства в повече от една витрина.</p><a href="/listings">Към целия каталог <ArrowRight size={17} /></a></div></section>

<style>
  .brand-hero {
    position: relative;
    min-height: 480px;
    display: grid;
    align-items: center;
    overflow: hidden;
    border-bottom: 1px solid var(--line);
    background: var(--paper);
  }

  .brand-grid {
    display: grid;
    align-items: center;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: clamp(40px, 8vw, 104px);
    padding-block: 64px;
  }

  h1 {
    margin-bottom: 18px;
    font-style: normal;
    letter-spacing: -0.06em;
  }

  .brand-grid p {
    max-width: 600px;
    color: var(--ink-soft);
    font-size: 1.03rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
    margin-top: 30px;
  }

  .actions form { margin: 0; }
  .action-feedback { margin: 12px 0 0; color: var(--success); font-size: .75rem; font-weight: 700; }
  .action-feedback.error { color: var(--danger); }

  .brand-monogram {
    position: relative;
    display: grid;
    width: 300px;
    height: 330px;
    place-items: center;
    border: 1px solid var(--action);
    border-radius: 6px;
    color: var(--paper-strong);
    background: var(--action);
    justify-self: end;
  }

  .brand-monogram span {
    font-size: 5rem;
    font-weight: 700;
    font-style: normal;
    letter-spacing: -0.1em;
  }

  .brand-monogram small {
    position: absolute;
    right: 20px;
    bottom: 18px;
    color: rgb(255 253 249 / 70%);
    font-size: 0.62rem;
    letter-spacing: 0.18em;
  }

  .brand-orbit {
    display: none;
  }

  .brand-stats {
    border-bottom: 1px solid var(--line);
    background: var(--paper-strong);
  }

  .brand-stats .container {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
  }

  .brand-stats .container > div {
    display: grid;
    min-height: 105px;
    align-content: center;
    padding-inline: 24px;
    border-right: 1px solid var(--line);
  }

  .brand-stats .container > div:first-child {
    border-left: 1px solid var(--line);
  }

  .brand-stats strong {
    font-size: 1.6rem;
    font-style: normal;
  }

  .brand-stats span {
    color: var(--ink-faint);
    font-size: 0.68rem;
  }

  .mini-search {
    width: min(100%, 380px);
  }

  .listing-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
  }

  .brand-note {
    padding-block: 68px;
    color: var(--brand-secondary);
    background: var(--ink);
  }

  .brand-note .container {
    display: grid;
    align-items: end;
    grid-template-columns: 1fr 1fr auto;
    gap: 40px;
  }

  .brand-note .eyebrow,
  .brand-note p {
    color: rgb(244 236 225 / 58%);
  }

  .brand-note h2 {
    margin-bottom: 0;
    font-size: 2.2rem;
  }

  .brand-note p {
    margin: 0;
  }

  .brand-note a {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--brand-main);
    font-weight: 700;
    font-style: normal;
    white-space: nowrap;
  }

  @media (max-width: 900px) {
    .brand-grid {
      grid-template-columns: 1fr;
    }

    .brand-monogram {
      display: none;
    }

    .brand-stats .container {
      grid-template-columns: repeat(2, 1fr);
    }

    .listing-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .brand-note .container {
      grid-template-columns: 1fr;
      align-items: start;
    }
  }

  @media (max-width: 520px) {
    .brand-stats .container {
      width: 100%;
    }

    .listing-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
