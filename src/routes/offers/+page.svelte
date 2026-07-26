<script lang="ts">
  import { ArrowRight, BadgeEuro, Check, Clock3, RotateCcw, X } from '@lucide/svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const kindLabel = { cash: 'Цена', swap: 'Размяна', cash_plus_swap: 'Парфюм + доплащане' } as const;
  const statusLabel = { pending: 'Чака отговор', accepted: 'Приета', declined: 'Отказана', withdrawn: 'Оттеглена', expired: 'Изтекла' } as const;

  function money(amountMinor: number): string {
    return new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR' }).format(amountMinor / 100);
  }
</script>

<svelte:head><title>Оферти · Marketplace beta</title><meta name="robots" content="noindex,nofollow" /></svelte:head>

<section class="offers-page">
  <div class="container">
    <header class="page-head"><div><span class="eyebrow">Структурирани намерения</span><h1>Оферти</h1><p>Приемането резервира обявата и отключва частен чат. То не е плащане или checkout.</p></div><BadgeEuro size={52} strokeWidth={1.2} /></header>
    <nav class="tabs" aria-label="Вид оферти"><a class:active={data.direction === 'received'} href="/offers?direction=received">Получени</a><a class:active={data.direction === 'sent'} href="/offers?direction=sent">Изпратени</a></nav>

    {#if form?.error}<p class="action-error" role="alert">{form.error.message}</p>{/if}
    {#if form?.ok}<p class="action-success" role="status">Действието по офертата е записано.</p>{/if}

    {#if data.offers.length}
      <div class="offer-list">
        {#each data.offers as offer}
          <article class="offer-card surface">
            <div class="offer-main"><div class="avatar">{offer.offerer.username.slice(0, 1).toUpperCase()}</div><div><span>{data.direction === 'received' ? 'От' : 'Към обява'} · {offer.offerer.username}</span><h2>{offer.listing.title}</h2><p>{offer.message ?? 'Няма допълнително съобщение.'}</p></div></div>
            <dl><div><dt>Вид</dt><dd>{kindLabel[offer.kind]}</dd></div>{#if offer.cash}<div><dt>Сума</dt><dd>{money(offer.cash.amountMinor)}</dd></div>{/if}{#if offer.offeredListing}<div><dt>Предлага</dt><dd>{offer.offeredListing.title}</dd></div>{/if}<div><dt>Статус</dt><dd><Clock3 size={14} /> {statusLabel[offer.status]}</dd></div></dl>
            <div class="actions">
              <a href={`/listing/${offer.listing.slug}`}>Виж обявата <ArrowRight size={15} /></a>
              {#if offer.status === 'pending' && data.direction === 'received'}
                <form method="POST" action="?/decline"><input type="hidden" name="offerId" value={offer.id} /><button class="decline" type="submit"><X size={16} /> Откажи</button></form>
                <form method="POST" action="?/accept"><input type="hidden" name="offerId" value={offer.id} /><button class="accept" type="submit"><Check size={16} /> Приеми и резервирай</button></form>
              {:else if offer.status === 'pending'}
                <form method="POST" action="?/withdraw"><input type="hidden" name="offerId" value={offer.id} /><button class="decline" type="submit"><RotateCcw size={16} /> Оттегли</button></form>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {:else}
      <div class="empty surface"><BadgeEuro size={38} /><h2>Няма оферти в този раздел.</h2><p>Изпрати структурирана оферта от активна обява.</p><a class="button primary" href="/listings">Към обявите</a></div>
    {/if}
  </div>
</section>

<style>
  .offers-page { min-height: 75vh; padding: clamp(2.5rem, 7vw, 6rem) 0; }
  .page-head { display: flex; align-items: end; justify-content: space-between; gap: 2rem; padding-bottom: 2rem; border-bottom: 1px solid var(--line); }
  .page-head h1 { margin: .3rem 0; }
  .page-head p { max-width: 650px; color: var(--ink-soft); }
  .page-head > :global(svg) { color: var(--action); }
  .tabs { display: flex; gap: .5rem; padding: 1.25rem 0; }
  .tabs a { min-height: 44px; padding: .72rem 1rem; border: 1px solid var(--line); border-radius: 999px; font-size: .78rem; font-weight: 700; }
  .tabs a.active { color: white; background: var(--action); }
  .offer-list { display: grid; gap: 1rem; }
  .offer-card { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(230px, .7fr); gap: 1.2rem; padding: clamp(1.1rem, 3vw, 1.8rem); }
  .offer-main { display: grid; grid-template-columns: 46px 1fr; gap: .85rem; }
  .avatar { display: grid; width: 46px; height: 46px; place-items: center; border-radius: 50%; color: white; background: var(--action); font-weight: 700; }
  .offer-main span, dt { color: var(--ink-faint); font-size: .66rem; text-transform: uppercase; letter-spacing: .07em; }
  .offer-main h2 { margin: .25rem 0; font-size: 1.35rem; }
  .offer-main p { margin: 0; color: var(--ink-soft); }
  dl { display: grid; gap: .45rem; margin: 0; }
  dl div { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-bottom: .45rem; border-bottom: 1px solid var(--line); }
  dd { display: flex; align-items: center; gap: .35rem; margin: 0; font-size: .78rem; font-weight: 700; }
  .actions { display: flex; align-items: center; justify-content: flex-end; gap: .5rem; grid-column: 1 / -1; padding-top: .8rem; border-top: 1px solid var(--line); }
  .actions a, .actions button { display: inline-flex; min-height: 44px; align-items: center; gap: .4rem; padding: .65rem .9rem; border-radius: 8px; font-size: .72rem; font-weight: 700; }
  .actions a { margin-right: auto; color: var(--action); }
  .actions button { border: 1px solid var(--line); cursor: pointer; background: white; }
  .actions .accept { border-color: var(--success); color: white; background: var(--success); }
  .actions .decline { color: var(--danger); }
  .action-error, .action-success { padding: .9rem; border-radius: 8px; }
  .action-error { color: var(--danger); background: rgb(141 47 54 / 8%); }
  .action-success { color: var(--success); background: rgb(47 107 79 / 8%); }
  .empty { display: grid; min-height: 340px; place-items: center; align-content: center; gap: .7rem; padding: 2rem; text-align: center; }
  .empty h2, .empty p { margin: 0; }
  .empty p { color: var(--ink-soft); }
  @media (max-width: 760px) { .offer-card { grid-template-columns: 1fr; } .actions { justify-content: flex-start; flex-wrap: wrap; } .actions a { width: 100%; } }
</style>
