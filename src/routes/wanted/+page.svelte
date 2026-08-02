<script lang="ts">
  import { ArrowLeft, ArrowRight, BellRing, Plus, Search } from '@lucide/svelte';
  import ListingCard from '$components/ListingCard.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Търся парфюм · Затворена beta</title>
  <meta name="description" content="Активни заявки за парфюми от участниците в затворената beta." />
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<section class="wanted-hero">
  <div class="container hero-grid">
    <div class="reveal">
      <span class="eyebrow">Активни заявки</span>
      <h1>Точно този <em>аромат.</em></h1>
      <p>Виж какво търси общността. Бюджетът е ориентир, а всяко предложение остава неподвързващо до взаимно потвърдена сделка.</p>
      <div class="hero-actions"><a class="button primary" href="/publish?kind=wanted"><Plus size={18} /> Създай заявка</a><a class="button secondary" href="#requests"><Search size={18} /> Разгледай</a></div>
    </div>
    <aside class="request-note" aria-label="Как работи заявката"><BellRing size={28} /><span>WANTED / BETA</span><strong>Опиши марка, аромат и максимален бюджет.</strong><p>Контактът започва със структурирана оферта; чатът се отключва след приемане.</p></aside>
  </div>
</section>

<section class="filters" id="requests">
  <form class="container surface" method="GET">
    <label><span>Марка или аромат</span><div><Search size={18} /><input name="q" value={data.filters.query} maxlength="120" placeholder="Напр. Dior Homme Parfum" /></div></label>
    <label><span>Град</span><input name="city" value={data.filters.city} maxlength="100" placeholder="Напр. София" /></label>
    <button class="button primary" type="submit">Приложи</button>
  </form>
</section>

<section class="section">
  <div class="container">
    <div class="section-heading"><div><span class="eyebrow">Заявки от общността</span><h2>Намерени {data.listings.total}</h2></div><p><BellRing size={17} /> Заявката не е поръчка и не задължава никого към сделка.</p></div>
    {#if data.listings.items.length}
      <div class="listing-grid">{#each data.listings.items as listing}<ListingCard {listing} variant="compact" />{/each}</div>
      <nav class="pagination" aria-label="Страници с търсения">
        {#if data.previousHref}<a class="button secondary" href={data.previousHref}><ArrowLeft size={17} /> Назад</a>{/if}
        <span>Страница {data.filters.page}</span>
        {#if data.nextHref}<a class="button secondary" href={data.nextHref}>Напред <ArrowRight size={17} /></a>{/if}
      </nav>
    {:else}
      <div class="empty-state"><div><Search size={36} /><h2>Няма съвпадащи заявки.</h2><p class="muted">Промени търсенето или публикувай своя заявка.</p><a class="button primary" href="/publish?kind=wanted"><Plus size={18} /> Създай заявка</a></div></div>
    {/if}
  </div>
</section>

<style>
  .wanted-hero { overflow: hidden; border-bottom: 1px solid var(--line); background: var(--paper); }
  .hero-grid { display: grid; min-height: 520px; align-items: center; grid-template-columns: minmax(0, 1.15fr) minmax(300px, .58fr); gap: clamp(42px, 8vw, 110px); padding-block: 68px 86px; }
  h1 { max-width: 760px; margin-bottom: 23px; font-style: normal; letter-spacing: -.055em; }
  h1 em { display: block; color: var(--action); font-style: normal; }
  .hero-grid > div > p { max-width: 670px; color: var(--ink-soft); font-size: 1.02rem; }
  .hero-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 30px; }
  .request-note { display: grid; min-height: 310px; align-content: center; gap: 17px; padding: clamp(28px, 4vw, 42px); border: 1px solid var(--line-strong); border-radius: 6px; background: var(--paper-strong); }
  .request-note > :global(svg) { color: var(--action); }
  .request-note > span { color: var(--action); font-size: .65rem; font-weight: 800; letter-spacing: .14em; }
  .request-note > strong { font-size: clamp(1.35rem, 2.6vw, 2rem); font-style: normal; line-height: 1.25; }
  .request-note > p { margin: 0; color: var(--ink-soft); }
  .filters { position: relative; z-index: 2; margin-top: -28px; }
  .filters form { display: grid; align-items: end; grid-template-columns: 1.3fr .75fr auto; gap: 13px; padding: 18px; border-color: var(--line); border-radius: 6px; background: var(--paper-strong); }
  .filters label { display: grid; gap: 7px; color: var(--ink-faint); font-size: .66rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
  .filters label > div { position: relative; }
  .filters label > div :global(svg) { position: absolute; top: 14px; left: 13px; }
  .filters input { width: 100%; min-height: 46px; padding: 10px 13px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink); background: var(--paper); }
  .filters input:focus-visible { border-color: var(--action); outline: 2px solid var(--action); outline-offset: 2px; }
  .filters label > div input { padding-left: 42px; }
  .section-heading > p { display: flex; max-width: 400px; align-items: flex-start; gap: 8px; color: var(--ink-soft); }
  .listing-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 32px; }
  .pagination span { color: var(--ink-faint); font-size: .75rem; font-weight: 700; }
  @media (max-width: 900px) { .hero-grid { grid-template-columns: 1fr; } .request-note { max-width: 480px; } .listing-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 680px) { .hero-grid { min-height: auto; padding-block: 52px 72px; } .request-note { min-height: 260px; padding: 26px; } .filters form { grid-template-columns: 1fr; } .listing-grid { grid-template-columns: 1fr; } .pagination { flex-wrap: wrap; } }
</style>
