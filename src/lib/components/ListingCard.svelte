<script lang="ts">
  import { ArrowRight, BadgeCheck, MapPin, Repeat2 } from '@lucide/svelte';
  import type { ListingCardDto } from '$lib/contracts';
  import {
    dealModeLabels,
    formatListingPrice,
    remainingPercent,
    visualThemeForListing
  } from '$lib/components/listing/presentation';
  import PerfumeVisual from './PerfumeVisual.svelte';

  interface LegacyListing {
    id: string;
    slug: string;
    brand: string;
    perfume: string;
    concentration: 'EDT' | 'EDP' | 'Parfum' | 'Extrait';
    mode: 'Продажба' | 'Размяна' | 'Продажба или размяна';
    price?: number;
    volumeMl: number;
    remainingMl: number;
    city: string;
    seller: string;
    sellerKind: 'Частно лице' | 'Проверен търговец';
    verifiedEvidence?: boolean;
    sponsored?: boolean;
  }

  export let listing: ListingCardDto | LegacyListing;
  export let compact = false;

  function normalizeListing(value: ListingCardDto | LegacyListing): ListingCardDto {
    if ('brandName' in value) return value;
    return {
      id: value.id,
      slug: value.slug,
      kind: 'offer',
      dealMode: value.mode === 'Продажба' ? 'sale' : value.mode === 'Размяна' ? 'swap' : 'sale_or_swap',
      title: `${value.brand} ${value.perfume}`,
      brandId: value.brand,
      brandName: value.brand,
      brandSlug: value.brand.toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, '-'),
      fragranceName: value.perfume,
      concentration: value.concentration === 'Parfum' ? 'PARFUM' : value.concentration === 'Extrait' ? 'EXTRAIT' : value.concentration,
      city: value.city,
      price: value.price == null ? null : { amountMinor: value.price * 100, currency: 'EUR' },
      maxBudget: null,
      bottleVolumeMl: value.volumeMl,
      remainingMl: value.remainingMl,
      isSealed: value.remainingMl === value.volumeMl,
      status: 'active',
      seller: {
        id: value.seller,
        username: value.seller,
        avatarUrl: null,
        accountKind: value.sellerKind === 'Проверен търговец' ? 'merchant' : 'private',
        merchantVerified: value.sellerKind === 'Проверен търговец'
      },
      primaryPhoto: null,
      authenticityReviewed: value.verifiedEvidence === true,
      createdAt: '1970-01-01T00:00:00.000Z'
    };
  }

  $: card = normalizeListing(listing);
  $: percent = remainingPercent(card);
  $: visual = visualThemeForListing(card.id);
  $: sponsored = 'sponsored' in listing && listing.sponsored === true;
</script>

<article class:compact class="listing-card">
  <a href={`/listing/${card.slug}`} class="image-link" aria-label={`${card.brandName} ${card.fragranceName}`}>
    {#if card.primaryPhoto}
      <div class:compact class="photo-visual"><img src={card.primaryPhoto.imageUrl} alt={`${card.brandName} ${card.fragranceName}`} loading="lazy" decoding="async" /></div>
    {:else}
      <PerfumeVisual {compact} {visual} {percent} label={`${card.brandName}-${card.id}`} />
    {/if}
    <div class="badges">
      {#if sponsored}<span class="pill sponsored">Спонсорирана</span>{/if}
      {#if card.kind === 'wanted'}<span class="pill sponsored">Търся</span>{/if}
      {#if card.authenticityReviewed}<span class="pill evidence"><BadgeCheck size={14} /> Доказателства</span>{/if}
    </div>
  </a>

  <div class="card-content">
    <div class="meta-line">
      <span>{card.concentration}</span><span>{card.bottleVolumeMl ? `${card.bottleVolumeMl} ml${card.kind === 'offer' ? ` · ${percent}%` : ''}` : 'Желан аромат'}</span>
    </div>
    <a class="title-link" href={`/listing/${card.slug}`}>
      <span>{card.brandName}</span>
      <h3>{card.fragranceName}</h3>
    </a>
    <div class="price-row">
      <strong>{formatListingPrice(card)}</strong>
      {#if card.dealMode !== 'sale'}<span title={dealModeLabels[card.dealMode]}><Repeat2 size={16} /> размяна</span>{/if}
    </div>
    <div class="seller-row">
      <span><MapPin size={14} /> {card.city}</span>
      <span class:merchant={card.seller.merchantVerified}>{card.seller.merchantVerified ? 'Проверен търговец' : 'Частно лице'}</span>
    </div>
    <a class="card-action" href={`/listing/${card.slug}`}>Виж обявата <ArrowRight size={16} /></a>
  </div>
</article>

<style>
  .listing-card {
    min-width: 0;
    overflow: hidden;
    border: 1px solid rgb(138 121 103 / 26%);
    border-radius: var(--radius-md);
    background: rgb(255 253 249 / 84%);
    box-shadow: var(--shadow-sm);
    transition: transform 240ms ease, box-shadow 240ms ease, border-color 240ms ease;
  }

  .listing-card:hover {
    border-color: rgb(74 49 38 / 36%);
    box-shadow: var(--shadow-lg);
    transform: translateY(-4px);
  }

  .image-link {
    position: relative;
    display: block;
  }

  .photo-visual {
    min-height: 280px;
    background: var(--brand-tertiary);
  }

  .photo-visual.compact {
    min-height: 220px;
  }

  .photo-visual img {
    display: block;
    width: 100%;
    height: 280px;
    object-fit: cover;
    transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .photo-visual.compact img {
    height: 220px;
  }

  .image-link:hover .photo-visual img {
    transform: scale(1.025);
  }

  .badges {
    position: absolute;
    top: 14px;
    right: 14px;
    left: 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .badges .pill:last-child:first-child {
    margin-left: auto;
  }

  .sponsored {
    border-color: var(--ink);
    color: var(--ink);
    background: var(--brand-main);
  }

  .evidence {
    border-color: rgb(47 107 79 / 40%);
    color: var(--success);
    background: rgb(255 253 249 / 92%);
  }

  .card-content {
    padding: 19px 19px 17px;
  }

  .meta-line,
  .seller-row,
  .price-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .meta-line {
    margin-bottom: 10px;
    color: var(--ink-faint);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .title-link > span {
    color: var(--ink-soft);
    font-size: 0.83rem;
  }

  h3 {
    margin: 3px 0 15px;
    overflow: hidden;
    font-size: 1.3rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .price-row {
    padding-block: 13px;
    border-top: 1px solid rgb(138 121 103 / 18%);
    border-bottom: 1px solid rgb(138 121 103 / 18%);
  }

  .price-row strong {
    font-size: 1.07rem;
  }

  .price-row span,
  .seller-row span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--ink-soft);
    font-size: 0.72rem;
  }

  .seller-row {
    padding-top: 13px;
  }

  .seller-row .merchant {
    color: var(--success);
    font-weight: 700;
  }

  .card-action {
    display: flex;
    min-height: 44px;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
    color: var(--action);
    font-size: 0.8rem;
    font-weight: 700;
    font-style: italic;
  }

  .compact .card-content {
    padding: 16px;
  }
</style>
