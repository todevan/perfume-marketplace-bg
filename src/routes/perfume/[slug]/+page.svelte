<script lang="ts">
  import { ArrowRight, Bell, Info, Layers3, Repeat2, Scale } from '@lucide/svelte';
  import ListingCard from '$components/ListingCard.svelte';
  import PerfumeVisual from '$components/PerfumeVisual.svelte';
  import { visualThemeForListing } from '$lib/components/listing/presentation';

  let { data, form } = $props();
  const source = $derived(data.fragrance);
  const offers = $derived(data.listings.items);
  const audienceLabels = { men: 'Мъжки', women: 'Дамски', unisex: 'Унисекс' } as const;
  const segmentLabels = { niche: 'Нишов', arabic: 'Арабски' } as const;
</script>

<svelte:head><title>{source.brand.name} {source.name} · сравни обяви</title><meta name="robots" content="noindex,nofollow" /></svelte:head>

<section class="perfume-hero">
  <div class="container perfume-grid">
    <div class="visual-wrap"><PerfumeVisual visual={visualThemeForListing(source.id)} percent={100} label={`catalog-${source.id}`} /></div>
    <div class="perfume-copy"><span class="eyebrow">Страница на аромат</span><p class="brand">{source.brand.name}</p><h1>{source.name}</h1><div class="tags"><span class="pill">{audienceLabels[source.audience]}</span>{#each source.segments as segment}<span class="pill">{segmentLabels[segment]}</span>{/each}{#if source.concentration}<span class="pill">{source.concentrationLabel ?? source.concentration}</span>{/if}</div><p>Тази страница събира конкретните флакони, остатъци и продавачи, без да смесва каталожния аромат с физическата обява.</p><form method="POST" action="?/save"><input type="hidden" name="fragranceId" value={source.id} /><input type="hidden" name="fragranceName" value={`${source.brand.name} ${source.name}`} /><button class="button primary" type="submit"><Bell size={17} /> Извести ме за нов флакон</button></form>{#if form?.ok}<p class="feedback" role="status">Търсенето е запазено.</p>{:else if form?.error}<p class="feedback error" role="alert">{form.error.message}</p>{/if}</div>
  </div>
</section>

<section class="compare section"><div class="container"><div class="section-heading"><div><span class="eyebrow">Сравни наличните предложения</span><h2>{data.listings.total} активни флакона.</h2></div><p>Цената и остатъкът принадлежат на конкретната обява. Плащането и доставката остават извън платформата.</p></div>{#if offers.length}<div class="offer-grid">{#each offers as offer}<ListingCard listing={offer} variant="catalog" />{/each}</div>{:else}<div class="empty-state"><div><Bell size={34} /><h2>Няма активен флакон.</h2><p class="muted">Запази търсенето, за да получиш известие при нова обява.</p></div></div>{/if}</div></section>

<section class="catalog-facts"><div class="container facts-grid"><article><Layers3 size={25} /><span>Каталожен вариант</span><strong>{source.concentrationLabel ?? source.concentration ?? 'Неуточнен'}</strong><p>Етикетът следва изписването на производителя.</p></article><article><Scale size={25} /><span>Сравнение</span><strong>ml + %</strong><p>Точният остатък остава част от всяка отделна обява.</p></article><article><Repeat2 size={25} /><span>Видове сделки</span><strong>Продажба и размяна</strong><p>Структурирано намерение, после частен чат.</p></article><article class="notice"><Info size={22} /><p>Каталожната страница не удостоверява автентичността на физическия продукт. Проверявай доказателствата във всяка обява.</p><a href="/safety">Прочети ръководството <ArrowRight size={16} /></a></article></div></section>

<style>
  .perfume-hero { padding-block: 54px 74px; border-bottom: 1px solid var(--line); background: var(--paper); }
  .perfume-grid { display: grid; align-items: center; grid-template-columns: minmax(360px, .82fr) minmax(0, 1.18fr); gap: clamp(44px, 8vw, 112px); }
  .visual-wrap { overflow: hidden; border: 1px solid var(--line); border-radius: 6px; background: var(--paper-strong); }
  :global(.visual-wrap .visual) { min-height: 560px; }
  .perfume-copy { padding-block: 30px; border-block: 1px solid var(--line); }
  .brand { margin: 0; color: var(--ink-soft); font-size: 1.1rem; }
  h1 { margin: 8px 0 23px; font-style: normal; letter-spacing: -.06em; }
  .tags { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 26px; }
  .perfume-copy > p { max-width: 630px; color: var(--ink-soft); font-size: 1.05rem; }
  .perfume-copy form { margin-top: 15px; }
  .feedback { margin: 11px 0 0; color: var(--success); font-size: .74rem; font-weight: 700; }
  .feedback.error { color: var(--danger); }
  .offer-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  .catalog-facts { padding-block: 70px; color: var(--brand-secondary); background: var(--ink); }
  .facts-grid { display: grid; grid-template-columns: repeat(3, 1fr) 1.25fr; }
  .facts-grid article { display: grid; min-height: 250px; align-content: space-between; padding: 27px; border-right: 1px solid rgb(244 236 225 / 18%); }
  .facts-grid article:first-child { border-left: 1px solid rgb(244 236 225 / 18%); }
  .facts-grid span, .facts-grid p { color: rgb(244 236 225 / 54%); font-size: .72rem; }
  .facts-grid strong { font-size: 1.3rem; font-style: normal; }
  .facts-grid p { margin: 0; }
  .facts-grid .notice { border: 1px solid rgb(243 223 191 / 20%); background: rgb(243 223 191 / 8%); }
  .notice a { display: inline-flex; min-height: 44px; align-items: center; gap: 7px; color: var(--brand-main); font-size: .75rem; font-weight: 700; }
  @media (max-width: 980px) { .perfume-grid { grid-template-columns: 1fr; } .visual-wrap { width: min(100%, 620px); margin-inline: auto; } .offer-grid, .facts-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 560px) { .visual-wrap { border-radius: 4px; } :global(.visual-wrap .visual) { min-height: 430px; } .offer-grid, .facts-grid { grid-template-columns: 1fr; } }
</style>
