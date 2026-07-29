<script lang="ts">
  import { enhance } from '$app/forms';
  import { ArrowRight, BadgeCheck, Heart, MapPin, Repeat2, UserRound } from '@lucide/svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { ListingCardDto } from '$lib/contracts';
  import {
    dealModeLabels,
    formatConcentration,
    formatListingPrice,
    remainingPercent,
    visualThemeForListing
  } from '$lib/components/listing/presentation';
  import PerfumeVisual from './PerfumeVisual.svelte';

  type ListingCardVariant = 'featured' | 'catalog' | 'compact';

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
  export let variant: ListingCardVariant | undefined = undefined;
  /** @deprecated Use `variant="compact"` for new callers. */
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
        username: value.seller.replace(/^@/, ''),
        avatarUrl: null,
        accountKind: value.sellerKind === 'Проверен търговец' ? 'merchant' : 'private',
        merchantVerified: value.sellerKind === 'Проверен търговец'
      },
      primaryPhoto: null,
      authenticityReviewed: value.verifiedEvidence === true,
      createdAt: '1970-01-01T00:00:00.000Z'
    };
  }

  function profileKindLabel(card: ListingCardDto): string {
    if (card.seller.merchantVerified) return 'Проверен търговец';
    return card.seller.accountKind === 'merchant' ? 'Търговец' : 'Частно лице';
  }

  function bottleVolumeLabel(card: ListingCardDto): string {
    if (card.bottleVolumeMl == null) {
      return card.kind === 'wanted' ? 'Желан обем не е посочен' : 'Обемът не е посочен';
    }
    return `${card.bottleVolumeMl} ml`;
  }

  function remainingLabel(card: ListingCardDto, percent: number): string {
    if (card.remainingMl == null) {
      return card.kind === 'wanted' ? 'Желан остатък не е посочен' : 'Остатъкът не е посочен';
    }
    return `${card.remainingMl} ml (${percent}%)`;
  }

  type FavoriteActionData = {
    favoriteState?: boolean;
    favoriteError?: string;
  };

  let favoriteState = false;
  let favoritePending = false;
  let favoriteError: string | null = null;

  const enhanceFavorite: SubmitFunction<FavoriteActionData, FavoriteActionData> = ({ cancel }) => {
    if (favoritePending) {
      cancel();
      return;
    }

    const requestedState = !favoriteState;
    favoritePending = true;
    favoriteError = null;

    return async ({ result }) => {
      favoritePending = false;

      if (result.type === 'success') {
        favoriteState = result.data?.favoriteState ?? requestedState;
        return;
      }

      if (result.type === 'failure') {
        favoriteError =
          result.data?.favoriteError ?? 'Не успяхме да обновим любимите. Опитай отново.';
        return;
      }

      favoriteError = 'Не успяхме да обновим любимите. Опитай отново.';
    };
  };

  $: card = normalizeListing(listing);
  $: resolvedVariant = variant ?? (compact ? 'compact' : 'catalog');
  $: percent = remainingPercent(card);
  $: visual = visualThemeForListing(card.id);
  $: sponsored = 'sponsored' in listing && listing.sponsored === true;
  $: syntheticPhoto = card.primaryPhoto?.imageUrl.startsWith('/demo/') === true;
  $: listingHref = `/listing/${card.slug}`;
  $: cleanUsername = card.seller.username.replace(/^@/, '');
  $: profileHref = `/profile/${encodeURIComponent(cleanUsername)}`;
  $: titleId = `listing-${card.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-title`;
</script>

<article
  class="listing-card"
  class:featured={resolvedVariant === 'featured'}
  class:catalog={resolvedVariant === 'catalog'}
  class:compact={resolvedVariant === 'compact'}
  class:wanted={card.kind === 'wanted'}
  data-variant={resolvedVariant}
  aria-labelledby={titleId}
>
  <div class="media">
    <a
      href={listingHref}
      class="image-link"
      aria-label={`Виж ${card.brandName} ${card.fragranceName}`}
    >
      {#if card.primaryPhoto}
        <img
          src={card.primaryPhoto.imageUrl}
          alt={`${card.brandName} ${card.fragranceName}`}
          loading="lazy"
          decoding="async"
        />
      {:else}
        <PerfumeVisual
          compact={resolvedVariant === 'compact'}
          {visual}
          {percent}
          label={`${card.brandName}-${card.id}`}
        />
      {/if}
    </a>

    <div class="media-labels">
      {#if sponsored}<span class="sponsored-label">Спонсорирана</span>{/if}
      <span class="deal-label">{card.kind === 'wanted' ? 'Търся' : dealModeLabels[card.dealMode]}</span>
    </div>

    {#if syntheticPhoto}<span class="synthetic-label">СИНТЕТИЧНА СНИМКА</span>{/if}

    <form
      class="favorite-form"
      method="POST"
      action={`${listingHref}?/${favoriteState ? 'unfavorite' : 'favorite'}`}
      use:enhance={enhanceFavorite}
    >
      <input type="hidden" name="listingId" value={card.id} />
      <button
        class="favorite-control"
        class:active={favoriteState}
        type="submit"
        disabled={favoritePending}
        aria-busy={favoritePending}
        aria-label={`${favoriteState ? 'Премахни' : 'Добави'} ${card.brandName} ${card.fragranceName} ${favoriteState ? 'от' : 'в'} любими`}
        aria-pressed={favoriteState}
      >
        <Heart
          size={20}
          strokeWidth={1.8}
          fill={favoriteState ? 'currentColor' : 'none'}
          aria-hidden="true"
        />
      </button>
    </form>
    {#if favoriteError}<p class="favorite-error" role="alert">{favoriteError}</p>{/if}
  </div>

  <div class="card-content">
    <header class="listing-identity">
      <a class="title-link" id={titleId} href={listingHref}>
        <span class="brand-name">{card.brandName}</span>
        <h3>{card.fragranceName}</h3>
      </a>
      <p class="bottle-spec">
        <span>{formatConcentration(card.concentration)}</span>
        <span aria-hidden="true">·</span>
        <span>{bottleVolumeLabel(card)}</span>
      </p>
    </header>

    <div class="remaining-row">
      <span>{card.kind === 'wanted' ? 'Желан остатък' : 'Остатък'}</span>
      <strong>{remainingLabel(card, percent)}</strong>
    </div>

    <div class="value-row">
      <strong class="listing-price">{formatListingPrice(card)}</strong>
      <span class="deal-mode">
        <Repeat2 size={15} strokeWidth={1.8} aria-hidden="true" />
        {dealModeLabels[card.dealMode]}
      </span>
    </div>

    <div class="location-row">
      <MapPin size={15} strokeWidth={1.8} aria-hidden="true" />
      <span>{card.city}</span>
    </div>

    <div class="seller-row">
      <UserRound size={16} strokeWidth={1.8} aria-hidden="true" />
      <div>
        <a href={profileHref}>@{cleanUsername}</a>
        <span>{profileKindLabel(card)}</span>
      </div>
    </div>

    {#if card.authenticityReviewed}
      <div class="trust-row">
        <BadgeCheck size={17} strokeWidth={1.8} aria-hidden="true" />
        <span>Доказателствата са прегледани</span>
      </div>
    {/if}

    <a class="card-action" href={listingHref} aria-label="Виж обявата">
      <span>Виж обявата</span>
      <ArrowRight size={17} strokeWidth={1.8} aria-hidden="true" />
    </a>
  </div>
</article>

<style>
  .listing-card {
    display: grid;
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    color: var(--ink);
    background: var(--paper-strong);
    transition: border-color 180ms ease;
  }

  .listing-card:hover {
    border-color: var(--line-strong);
  }

  .listing-card.featured {
    height: 100%;
    min-height: 330px;
    grid-template-columns: minmax(0, 1.45fr) minmax(250px, 0.85fr);
  }

  .listing-card.catalog {
    grid-template-rows: auto 1fr;
  }

  .listing-card.compact {
    min-height: 238px;
    grid-template-columns: minmax(132px, 0.92fr) minmax(0, 1.08fr);
  }

  .media {
    position: relative;
    display: flex;
    min-width: 0;
    min-height: 214px;
    overflow: hidden;
    background: var(--brand-tertiary);
  }

  .featured .media {
    min-height: 330px;
  }

  .compact .media {
    min-height: 238px;
  }

  .image-link {
    display: block;
    width: 100%;
    min-width: 0;
  }

  .image-link img {
    width: 100%;
    height: 100%;
    min-height: inherit;
    object-fit: cover;
    transition: transform 260ms ease;
  }

  .image-link:hover img {
    transform: scale(1.018);
  }

  .media :global(.visual) {
    width: 100%;
    height: 100%;
    min-height: inherit;
  }

  .media-labels {
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    max-width: calc(100% - 72px);
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 6px;
    pointer-events: none;
  }

  .deal-label,
  .sponsored-label {
    display: inline-flex;
    min-height: 25px;
    align-items: center;
    padding: 4px 8px;
    border: 1px solid var(--action);
    color: var(--paper-strong);
    background: var(--action);
    font-size: 0.64rem;
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: 0.035em;
    text-transform: uppercase;
  }

  .sponsored-label {
    border-color: var(--ink);
    color: var(--paper-strong);
    background: var(--ink);
  }

  .favorite-form {
    position: absolute;
    top: 8px;
    right: 8px;
    margin: 0;
  }

  .synthetic-label {
    position: absolute;
    bottom: 7px;
    left: 8px;
    display: inline-flex;
    min-height: 20px;
    align-items: center;
    padding: 3px 6px;
    border: 1px solid var(--paper-strong);
    color: var(--paper-strong);
    background: var(--ink);
    font-size: 0.55rem;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.03em;
  }

  .favorite-control {
    display: grid;
    width: 44px;
    height: 44px;
    padding: 0;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: 50%;
    color: var(--ink);
    background: var(--paper-strong);
    cursor: pointer;
    transition: border-color 160ms ease, color 160ms ease, background 160ms ease;
  }

  .favorite-control:hover {
    border-color: var(--action);
    color: var(--action);
    background: var(--brand-main);
  }

  .favorite-control.active {
    border-color: var(--action);
    color: var(--action);
    background: var(--action-soft);
  }

  .favorite-control:disabled {
    cursor: wait;
    opacity: 0.68;
  }

  .favorite-error {
    position: absolute;
    top: 60px;
    right: 8px;
    z-index: 2;
    max-width: min(240px, calc(100% - 16px));
    margin: 0;
    padding: 7px 9px;
    border: 1px solid var(--danger);
    border-radius: var(--radius-xs);
    color: var(--danger);
    background: var(--paper-strong);
    font-size: 0.67rem;
    line-height: 1.35;
  }

  .card-content {
    display: flex;
    min-width: 0;
    flex-direction: column;
    padding: 18px;
  }

  .featured .card-content {
    padding: 25px 24px 20px;
  }

  .compact .card-content {
    padding: 15px 16px 13px;
  }

  .listing-identity {
    min-width: 0;
  }

  .title-link {
    display: block;
    min-width: 0;
  }

  .brand-name {
    display: block;
    margin-bottom: 2px;
    color: var(--ink-soft);
    font-size: 0.78rem;
    line-height: 1.25;
  }

  h3 {
    margin: 0;
    overflow-wrap: anywhere;
    font-size: 1.25rem;
    font-style: normal;
    font-weight: 600;
    line-height: 1.13;
    letter-spacing: -0.02em;
  }

  .featured h3 {
    font-size: clamp(1.4rem, 2.2vw, 1.85rem);
  }

  .compact h3 {
    font-size: 1.05rem;
  }

  .bottle-spec {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
    margin: 7px 0 0;
    color: var(--ink-soft);
    font-size: 0.72rem;
    line-height: 1.35;
  }

  .remaining-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }

  .remaining-row > span {
    color: var(--ink-faint);
    font-size: 0.67rem;
  }

  .remaining-row strong {
    text-align: right;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .value-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 10px;
    margin-top: 11px;
  }

  .listing-price {
    font-size: 1.18rem;
    font-weight: 600;
    line-height: 1.1;
  }

  .featured .listing-price {
    font-size: 1.42rem;
  }

  .deal-mode {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
    color: var(--action);
    font-size: 0.67rem;
    font-weight: 700;
    line-height: 1.25;
    text-align: right;
  }

  .deal-mode :global(svg) {
    flex: 0 0 auto;
  }

  .location-row,
  .seller-row {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--ink-soft);
    font-size: 0.69rem;
  }

  .location-row {
    margin-top: 12px;
  }

  .seller-row {
    align-items: flex-start;
    margin-top: 7px;
  }

  .location-row :global(svg),
  .seller-row > :global(svg) {
    flex: 0 0 auto;
  }

  .seller-row > div {
    display: flex;
    min-width: 0;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 3px 7px;
  }

  .seller-row a {
    color: var(--ink);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .seller-row span {
    color: var(--ink-faint);
  }

  .trust-row {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 11px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    color: var(--success);
    font-size: 0.68rem;
    font-weight: 600;
    line-height: 1.3;
  }

  .trust-row :global(svg) {
    flex: 0 0 auto;
  }

  .card-action {
    display: flex;
    min-height: 44px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: auto;
    padding-top: 10px;
    color: var(--action);
    font-size: 0.72rem;
    font-style: normal;
    font-weight: 700;
  }

  .card-action :global(svg) {
    flex: 0 0 auto;
    transition: transform 160ms ease;
  }

  .card-action:hover :global(svg) {
    transform: translateX(3px);
  }

  @media (max-width: 720px) {
    .listing-card.featured {
      grid-template-columns: 1fr;
    }

    .featured .media {
      min-height: 260px;
    }
  }

  @media (max-width: 420px) {
    .listing-card.compact {
      grid-template-columns: minmax(112px, 0.72fr) minmax(0, 1.28fr);
    }

    .compact .media {
      min-height: 220px;
    }

    .compact .card-content {
      padding-inline: 13px;
    }

    .compact .value-row {
      align-items: flex-start;
      flex-direction: column;
      gap: 6px;
    }

    .compact .deal-mode {
      justify-content: flex-start;
      text-align: left;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .image-link img,
    .card-action :global(svg) {
      transition: none;
    }
  }
</style>
