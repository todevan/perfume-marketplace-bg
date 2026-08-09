<script lang="ts">
  import { tick } from 'svelte';
  import {
    ArrowLeft,
    ArrowRight,
    BadgeCheck,
    Check,
    ChevronRight,
    ExternalLink,
    Flag,
    Heart,
    Info,
    MapPin,
    PackageCheck,
    Repeat2,
    ShieldCheck,
    X
  } from '@lucide/svelte';
  import ListingCard from '$components/ListingCard.svelte';
  import PerfumeVisual from '$components/PerfumeVisual.svelte';
  import {
    audienceLabel,
    dealModeLabels,
    formatListingPrice,
    listingStatusLabels,
    productFormatLabels,
    remainingPercent,
    segmentLabel,
    visualThemeForListing
  } from '$lib/components/listing/presentation';

  let { data, form } = $props();
  let listing = $derived(data.listing);
  let percent = $derived(remainingPercent(listing));
  let visual = $derived(visualThemeForListing(listing.id));
  let offerOpen = $state(false);
  let offerType = $state<'cash' | 'swap' | 'cash_plus_swap'>('cash');
  let offerAmount = $state(20);
  let offerDefaultsSet = false;
  let favorite = $derived(form?.favoriteState ?? data.favorite);
  let selectedPhoto = $state(0);
  let offerTrigger = $state<HTMLButtonElement>();
  let offerCloseButton = $state<HTMLButtonElement>();

  $effect(() => {
    if (form?.offerResult) offerOpen = true;
    if (!offerDefaultsSet) {
      offerType = listing.dealMode === 'sale' ? 'cash' : listing.dealMode === 'swap' ? 'swap' : 'cash';
      offerAmount = Math.max(1, Math.round((listing.price?.amountMinor ?? 2000) / 100));
      offerDefaultsSet = true;
    }
  });

  const photoRoleLabels: Record<string, string> = {
    product_full: 'Цял флакон', bottle_bottom: 'Дъно', batch_code: 'Batch code', fill_level: 'Ниво',
    box_front: 'Кутия', box_bottom: 'Дъно на кутия', seal: 'Пломба', manufacturer_label: 'Етикет',
    manufacturer_markings: 'Маркировки', other: 'Друга'
  };

  function dateLabel(value: string): string {
    return new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value));
  }

  async function openOffer() {
    offerOpen = true;
    await tick();
    offerCloseButton?.focus();
  }

  async function closeOffer() {
    offerOpen = false;
    await tick();
    offerTrigger?.focus();
  }

  function handleOfferKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      void closeOffer();
      return;
    }

    if (event.key === 'Tab') {
      const dialog = event.currentTarget as HTMLElement;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      const first = focusable[0];
      const last = focusable.at(-1);

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

</script>

<svelte:head>
  <title>{listing.brandName} {listing.fragranceName} · {formatListingPrice(listing)}</title>
  <meta name="description" content={listing.description} />
  {#if data.turnstileSiteKey && !data.demoMode}<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>{/if}
</svelte:head>

<div class="container breadcrumbs">
  <a href="/listings"><ArrowLeft size={15} /> Обяви</a><ChevronRight size={14} /><span>{listing.brandName}</span><ChevronRight size={14} /><strong>{listing.fragranceName}</strong>
</div>

<section class="listing-detail container">
    <div class="gallery">
      <div class="main-visual">
        {#if listing.photos[selectedPhoto]}
          <img class="main-photo" src={listing.photos[selectedPhoto].imageUrl} alt={`${listing.brandName} ${listing.fragranceName} — ${photoRoleLabels[listing.photos[selectedPhoto].role] ?? 'снимка'}`} />
          {#if data.demoMode && listing.photos[selectedPhoto].imageUrl.startsWith('/demo/')}
            <span class="synthetic-label main-synthetic">СИНТЕТИЧНА СНИМКА</span>
          {/if}
        {:else}
          <PerfumeVisual {visual} {percent} label={`${listing.brandName}-${listing.id}-detail`} />
        {/if}
        <span class="photo-count">{listing.photos.length ? selectedPhoto + 1 : 1} / {Math.max(1, listing.photos.length)}</span>
        {#if listing.authenticityReviewed}<span class="pill evidence"><BadgeCheck size={15} /> Доказателствата са прегледани</span>{/if}
      </div>
      <div class="thumbs" aria-label="Снимки на обявата">
        {#if listing.photos.length}
          {#each listing.photos as photo, index (photo.id)}
            <button class:active={index === selectedPhoto} aria-label={`Покажи ${photoRoleLabels[photo.role] ?? 'снимката'}`} onclick={() => (selectedPhoto = index)}>
              <img class="thumb-photo" src={photo.imageUrl} alt="" loading="lazy" />
              {#if data.demoMode && photo.imageUrl.startsWith('/demo/')}
                <span class="synthetic-label thumb-synthetic">СИНТЕТИЧНА СНИМКА</span>
              {/if}
              <span class="photo-role">{photoRoleLabels[photo.role] ?? 'Снимка'}</span>
            </button>
          {/each}
        {:else}
          <button class="active" aria-label="Илюстрация на продукта"><PerfumeVisual {visual} {percent} label={`${listing.id}-thumb`} compact /><span>Илюстрация</span></button>
        {/if}
      </div>
    </div>

    <div class="detail-copy">
      <div class="listing-flags">
        <span class="pill">{audienceLabel(listing.audience)}</span>
        {#each listing.segments as segment}<span class="pill">{segmentLabel(segment)}</span>{/each}
        {#if listing.dealMode !== 'sale'}<span class="pill swap"><Repeat2 size={14} /> Размяна</span>{/if}
      </div>
      <p class="brand">{listing.brandName}</p>
      <h1>{listing.fragranceName}</h1>
      <p class="variant">{listing.concentrationLabel ?? listing.concentration}{listing.bottleVolumeMl ? ` · ${listing.bottleVolumeMl} ml` : ''}</p>

      <div class="price-line">
        <strong>{formatListingPrice(listing)}</strong>
        {#if listing.dealMode === 'sale_or_swap'}<span>или подходяща размяна</span>{/if}
      </div>

      {#if listing.bottleVolumeMl}
        <div class="quantity surface">
          <div class="fill-track"><span style={`width:${percent}%`}></span></div>
          <div><span>Оригинален обем<strong>{listing.bottleVolumeMl} ml</strong></span><span>{listing.kind === 'wanted' ? 'Желан обем' : 'Остатък'}<strong>{listing.remainingMl == null ? '—' : `~${listing.remainingMl} ml (${percent}%)`}</strong></span></div>
          <p>{listing.isSealed ? 'Запечатан продукт' : percent >= 90 ? 'Отворен, почти пълен' : percent >= 70 ? 'Леко използван' : 'Частично използван'}</p>
        </div>
      {/if}

      <div class="primary-actions">
        <button bind:this={offerTrigger} class="button primary" aria-haspopup="dialog" aria-expanded={offerOpen} onclick={openOffer}>{listing.kind === 'wanted' ? 'Имам този аромат' : listing.dealMode === 'swap' ? 'Предложи размяна' : 'Изпрати оферта'} <ArrowRight size={18} /></button>
        <form method="POST" action={favorite ? '?/unfavorite' : '?/favorite'}><input type="hidden" name="listingId" value={listing.id} /><button type="submit" class:active={favorite} class="favorite" aria-label={favorite ? 'Премахни от любими' : 'Добави в любими'} aria-pressed={favorite}><Heart size={20} fill={favorite ? 'currentColor' : 'none'} /></button></form>
      </div>
      {#if form?.favoriteError}<p class="favorite-error" role="alert">{form.favoriteError}</p>{/if}

      <div class="seller-card surface">
        <div class="avatar">{listing.seller.username.slice(0, 1).toUpperCase()}</div>
        <div class="seller-info"><span>{listing.seller.merchantVerified ? 'Проверен търговец' : 'Частно лице'}</span><a href={`/profile/${listing.seller.username}`}>{listing.seller.username}</a><p>{listing.seller.merchantVerified ? 'Търговският профил е прегледан' : 'Профил от общността'}</p></div>
        <a class="view-profile" href={`/profile/${listing.seller.username}`} aria-label="Виж профила"><ArrowRight size={18} /></a>
        <div class="seller-meta"><span><MapPin size={15} /> {listing.city}</span><span><PackageCheck size={15} /> {listingStatusLabels[listing.status]}</span></div>
      </div>
    </div>
  </section>

  <section class="container info-grid">
    <div class="description">
      <span class="eyebrow">Описание от продавача</span>
      <p>{listing.description}</p>
      <dl>
        <div><dt>Формат</dt><dd>{listing.productFormat ? productFormatLabels[listing.productFormat] : 'Не е посочен'}</dd></div>
        <div><dt>Сделка</dt><dd>{dealModeLabels[listing.dealMode]}</dd></div>
        <div><dt>Доказателства</dt><dd>{listing.photos.length ? `${listing.photos.length} снимки` : 'Няма качени снимки'}</dd></div>
        <div><dt>Публикувана</dt><dd>{dateLabel(listing.activatedAt ?? listing.createdAt)}</dd></div>
      </dl>
      {#if listing.referenceUrl}
        <a class="external-reference" href={listing.referenceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={17} /><span><strong>Виж конкретния аромат във Fragrantica</strong><small>Външен ориентир, не доказателство за автентичност</small></span></a>
      {/if}
    </div>

    <aside class="safety-note">
      <ShieldCheck size={30} />
      <h2>Преди да се договориш</h2>
      <ul><li><Check size={16} /> Сравни batch code на флакона и кутията.</li><li><Check size={16} /> Не плащай, преди да уточниш доставка и преглед.</li><li><Check size={16} /> Валидният код не доказва сам по себе си оригиналност.</li></ul>
      <a href="https://www.batch-code.com/" target="_blank" rel="noopener noreferrer">Провери дата/формат на кода <ExternalLink size={15} /></a>
      <a class="report-link" href={`/report?targetType=listing&targetId=${listing.id}`}><Flag size={15} /> Докладвай обявата</a>
    </aside>
  </section>

  <section class="similar section">
    <div class="container">
      <div class="section-heading"><div><span class="eyebrow">Още от общността</span><h2>Може да ти допаднат.</h2></div></div>
      <div class="similar-grid">{#each data.similar as item (item.id)}<ListingCard listing={item} variant="compact" />{/each}</div>
    </div>
  </section>

  {#if offerOpen}
    <button class="offer-scrim" aria-label="Затвори офертата" onclick={closeOffer}></button>
    <div class="offer-panel" role="dialog" aria-modal="true" aria-labelledby="offer-title" tabindex="-1" onkeydown={handleOfferKeydown}>
      <div class="offer-head"><div><span>Неподвързващо намерение</span><h2 id="offer-title">{listing.kind === 'wanted' ? 'Предложи своя флакон' : 'Твоята оферта'}</h2></div><button bind:this={offerCloseButton} aria-label="Затвори" onclick={closeOffer}><X size={22} /></button></div>
      {#if form?.offerResult?.ok}
        <div class="offer-success" role="status"><div><Check size={32} /></div><h3>Офертата е изпратена.</h3><p>Продавачът трябва първо да я приеме. Едва тогава може да бъде създадена защитена нишка за уточняване на сделката.</p><a class="button primary" href="/offers?direction=sent">Виж изпратените оферти <ArrowRight size={17} /></a></div>
      {:else}
        <form method="POST" action="?/submitOffer">
          <input type="hidden" name="listingId" value={listing.id} />
          <div class="intent-note"><Info size={18} /><p>Приемането резервира обявата, но не създава договор или плащане през платформата.</p></div>
          <fieldset><legend>Вид предложение</legend><div class="offer-types">
            {#if listing.dealMode !== 'swap'}<label class:active={offerType === 'cash'}><input type="radio" name="kind" value="cash" bind:group={offerType} />Цена</label>{/if}
            {#if listing.dealMode !== 'sale'}<label class:active={offerType === 'swap'}><input type="radio" name="kind" value="swap" bind:group={offerType} />Размяна</label>{/if}
            {#if listing.dealMode === 'sale_or_swap'}<label class:active={offerType === 'cash_plus_swap'}><input type="radio" name="kind" value="cash_plus_swap" bind:group={offerType} />Аромат + сума</label>{/if}
          </div></fieldset>
          {#if offerType !== 'swap'}<div class="field"><label for="offer-amount">Предложена сума</label><div class="money-input"><span>€</span><input id="offer-amount" name="cashAmount" type="number" min="1" step="0.01" bind:value={offerAmount} required /></div></div>{/if}
          {#if offerType !== 'cash'}<div class="field"><label for="swap-listing">Твоя активна обява</label><select id="swap-listing" name="offeredListingId" class="select" required><option value="">Избери обява</option>{#each data.offeredListings as own (own.id)}<option value={own.id}>{own.brandName} · {own.fragranceName}</option>{/each}</select>{#if !data.offeredListings.length}<p class="muted">Нямаш друга активна обява за размяна.</p>{/if}</div>{/if}
          <div class="field"><label for="offer-note">Кратка бележка (по избор)</label><textarea id="offer-note" name="message" maxlength="1000" class="textarea" placeholder="Например: мога да изпратя утре..."></textarea></div>
          {#if data.turnstileSiteKey && !data.demoMode}<div class="cf-turnstile" data-sitekey={data.turnstileSiteKey} data-action="offer_submit"></div>{/if}
          {#if form?.offerResult && !form.offerResult.ok}<p class="form-error" role="alert">{form.offerResult.error.message}</p>{/if}
          <button class="button primary submit-offer" type="submit">Изпрати намерение <ArrowRight size={17} /></button>
        </form>
      {/if}
    </div>
  {/if}

<style>
  .breadcrumbs {
    display: flex;
    min-height: 58px;
    align-items: center;
    gap: 7px;
    overflow: hidden;
    color: var(--ink-faint);
    font-size: 0.73rem;
    white-space: nowrap;
  }

  .breadcrumbs a {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .breadcrumbs strong {
    overflow: hidden;
    color: var(--ink-soft);
    text-overflow: ellipsis;
  }

  .listing-detail {
    display: grid;
    align-items: start;
    grid-template-columns: minmax(0, 1.06fr) minmax(380px, 0.94fr);
    gap: clamp(34px, 5vw, 72px);
    padding-bottom: 76px;
  }

  .gallery {
    position: sticky;
    top: calc(var(--header-height) + 24px);
  }

  .main-visual {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper-strong);
  }

  .main-photo {
    display: block;
    width: 100%;
    height: min(68vh, 660px);
    min-height: 460px;
    object-fit: cover;
    background: var(--brand-tertiary);
  }

  :global(.main-visual .visual) {
    min-height: min(67vh, 680px);
  }

  .photo-count,
  .main-visual > .evidence,
  .main-synthetic {
    position: absolute;
    z-index: 2;
  }

  .photo-count {
    right: 18px;
    bottom: 18px;
    padding: 7px 10px;
    border: 1px solid rgb(255 253 249 / 42%);
    border-radius: 4px;
    color: var(--paper-strong);
    background: rgb(36 28 22 / 88%);
    font-size: 0.7rem;
  }

  .main-visual > .evidence {
    top: 18px;
    left: 18px;
    color: var(--success);
    background: var(--paper-strong);
  }

  .synthetic-label {
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

  .main-synthetic {
    bottom: 18px;
    left: 18px;
  }

  .thumbs {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 9px;
    margin-top: 10px;
  }

  .thumbs button {
    position: relative;
    min-width: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: 4px;
    background: var(--paper-strong);
    cursor: pointer;
  }

  .thumbs button.active {
    border-color: var(--action);
    outline: 1px solid var(--action);
    outline-offset: 2px;
  }

  :global(.thumbs .visual) {
    min-height: 120px;
  }

  .thumb-photo {
    display: block;
    width: 100%;
    height: 120px;
    object-fit: cover;
  }

  .thumbs .photo-role {
    position: absolute;
    right: 4px;
    bottom: 4px;
    left: 4px;
    padding: 4px;
    border-radius: 2px;
    color: white;
    background: rgb(36 28 22 / 65%);
    font-size: 0.62rem;
  }

  .thumbs .thumb-synthetic {
    position: absolute;
    top: 4px;
    right: 4px;
    left: 4px;
    min-height: 0;
    justify-content: center;
    padding: 3px;
    font-size: 0.44rem;
    line-height: 1.1;
    text-align: center;
  }

  .detail-copy {
    padding: 28px 0 0;
    border-top: 4px solid var(--action);
  }

  .listing-flags {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-bottom: 28px;
  }

  .listing-flags .swap {
    color: var(--warning);
  }

  .brand {
    margin-bottom: 5px;
    color: var(--ink-soft);
    font-size: 1rem;
  }

  h1 {
    margin-bottom: 10px;
    font-size: clamp(2.75rem, 5.4vw, 4.8rem);
    font-style: normal;
    letter-spacing: -0.06em;
  }

  .variant {
    color: var(--ink-soft);
  }

  .price-line {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin-block: 32px;
  }

  .price-line strong {
    font-size: 2rem;
    font-style: normal;
  }

  .price-line span {
    color: var(--ink-soft);
    font-size: 0.76rem;
  }

  .quantity {
    padding: 18px;
    border-color: var(--line);
    border-radius: 6px;
    background: var(--paper-strong);
  }

  .fill-track {
    height: 8px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--brand-tertiary);
  }

  .fill-track span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--action);
  }

  .quantity > div:nth-child(2) {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    padding-top: 13px;
  }

  .quantity > div:nth-child(2) span {
    display: grid;
    color: var(--ink-faint);
    font-size: 0.68rem;
  }

  .quantity strong {
    color: var(--ink);
    font-size: 0.9rem;
  }

  .quantity p {
    margin: 13px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    color: var(--success);
    font-size: 0.75rem;
    font-weight: 700;
  }

  .primary-actions {
    display: grid;
    grid-template-columns: 1fr 48px;
    gap: 9px;
    margin-block: 22px;
  }

  .form-error {
    margin: 14px 0 0;
    color: var(--danger);
    font-size: 0.78rem;
    font-weight: 700;
  }


  .submit-offer:disabled {
    cursor: not-allowed;
    opacity: 0.56;
  }

  .favorite {
    display: grid;
    width: 48px;
    height: 48px;
    place-items: center;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    background: var(--paper-strong);
    cursor: pointer;
  }

  .favorite.active {
    color: var(--danger);
    background: rgb(141 47 54 / 8%);
  }

  .primary-actions > form {
    margin: 0;
  }

  .favorite-error {
    margin: -12px 0 18px;
    color: var(--danger);
    font-size: 0.76rem;
    font-weight: 700;
  }

  .seller-card {
    display: grid;
    align-items: center;
    grid-template-columns: 48px 1fr 42px;
    gap: 13px;
    padding: 18px;
    border-color: var(--line);
    border-radius: 6px;
    background: var(--paper-strong);
  }

  .avatar {
    display: grid;
    width: 48px;
    height: 48px;
    place-items: center;
    border-radius: 4px;
    color: var(--paper-strong);
    background: var(--action);
    font-weight: 700;
    font-style: normal;
  }

  .seller-info {
    display: grid;
  }

  .seller-info > span {
    color: var(--success);
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .seller-info > a {
    font-weight: 700;
  }

  .seller-info p {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 2px 0 0;
    color: var(--ink-soft);
    font-size: 0.69rem;
  }

  .view-profile {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--brand-main);
  }

  .seller-meta {
    display: flex;
    grid-column: 1 / -1;
    flex-wrap: wrap;
    gap: 10px 18px;
    padding-top: 13px;
    border-top: 1px solid var(--line);
  }

  .seller-meta span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--ink-soft);
    font-size: 0.7rem;
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 360px;
    gap: clamp(42px, 7vw, 84px);
    padding-block: 64px 96px;
    border-top: 1px solid var(--line);
  }

  .description > p {
    max-width: 740px;
    font-size: 1.12rem;
    line-height: 1.75;
  }

  dl {
    margin-top: 35px;
    border-top: 1px solid var(--line);
  }

  dl div {
    display: grid;
    grid-template-columns: 160px 1fr;
    padding-block: 14px;
    border-bottom: 1px solid var(--line);
  }

  dt {
    color: var(--ink-soft);
    font-size: 0.76rem;
  }

  dd {
    margin: 0;
    font-weight: 700;
  }

  .external-reference {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    margin-top: 22px;
    padding: 14px 17px;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--paper-strong);
  }

  .external-reference span {
    display: grid;
  }

  .external-reference small {
    color: var(--ink-soft);
  }

  .safety-note {
    padding: 28px;
    border-radius: 6px;
    color: var(--brand-secondary);
    background: var(--ink);
  }

  .safety-note h2 {
    margin: 22px 0 18px;
    font-size: 1.75rem;
  }

  .safety-note ul {
    display: grid;
    gap: 11px;
    padding: 0;
    list-style: none;
  }

  .safety-note li {
    display: grid;
    align-items: start;
    grid-template-columns: 18px 1fr;
    gap: 9px;
    color: rgb(244 236 225 / 74%);
    font-size: 0.79rem;
  }

  .safety-note a,
  .safety-note .report-link {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    gap: 7px;
    margin-top: 12px;
    border: 0;
    color: var(--brand-main);
    background: transparent;
    cursor: pointer;
    font-size: 0.76rem;
    font-weight: 700;
  }

  .safety-note .report-link {
    color: rgb(244 236 225 / 55%);
  }

  .similar {
    border-top: 1px solid var(--line);
    background: var(--brand-secondary);
  }

  .similar-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
  }

  .offer-scrim {
    position: fixed;
    inset: 0;
    z-index: 80;
    border: 0;
    background: rgb(36 28 22 / 52%);
  }

  .offer-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 90;
    width: min(92vw, 520px);
    padding: 28px;
    border-left: 1px solid var(--line);
    overflow-y: auto;
    background: var(--paper-strong);
  }

  .offer-head {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 20px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--line);
  }

  .offer-head span {
    color: var(--warning);
    font-size: 0.67rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .offer-head h2 {
    margin: 5px 0 0;
    font-size: 2.5rem;
  }

  .offer-head button {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 0;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--brand-tertiary);
    cursor: pointer;
  }

  .offer-panel form {
    display: grid;
    gap: 24px;
    padding-top: 25px;
  }

  .intent-note {
    display: grid;
    align-items: start;
    grid-template-columns: 20px 1fr;
    gap: 10px;
    padding: 14px;
    border: 1px solid rgb(138 91 22 / 30%);
    border-radius: 4px;
    color: var(--warning);
    background: rgb(138 91 22 / 7%);
  }

  .intent-note p {
    margin: 0;
    font-size: 0.75rem;
  }

  fieldset {
    padding: 0;
    border: 0;
  }

  legend,
  .field label {
    margin-bottom: 9px;
    color: var(--ink-soft);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .offer-types {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 7px;
  }

  .offer-types label {
    display: grid;
    min-height: 64px;
    place-items: center;
    padding: 7px;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--paper-strong);
    cursor: pointer;
    font-size: 0.72rem;
    font-weight: 700;
    text-align: center;
  }

  .offer-types label.active {
    border: 2px solid var(--action);
    background: var(--brand-main);
  }

  .offer-types input {
    position: absolute;
    opacity: 0;
  }

  .offer-types label:has(input:focus-visible) {
    outline: 3px solid var(--action);
    outline-offset: 3px;
  }

  .money-input {
    display: grid;
    grid-template-columns: auto 1fr;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--paper-strong);
  }

  .money-input span {
    display: grid;
    min-width: 48px;
    place-items: center;
    border-right: 1px solid var(--line);
    font-weight: 700;
  }

  .money-input input {
    min-height: 54px;
    padding: 10px 14px;
    border: 0;
    outline: 0;
    background: transparent;
    font-size: 1.15rem;
  }

  .submit-offer {
    width: 100%;
  }

  .offer-success {
    display: grid;
    min-height: 70vh;
    place-items: center;
    align-content: center;
    text-align: center;
  }

  .offer-success > div {
    display: grid;
    width: 70px;
    height: 70px;
    place-items: center;
    border-radius: 50%;
    color: var(--paper-strong);
    background: var(--success);
  }

  .offer-success h3 {
    margin: 22px 0 10px;
    font-size: 2rem;
  }

  .offer-success p {
    max-width: 360px;
    color: var(--ink-soft);
  }

  @media (max-width: 1000px) {
    .listing-detail {
      grid-template-columns: 1fr;
    }

    .gallery {
      position: relative;
      top: auto;
    }

    .detail-copy {
      padding-top: 0;
    }

    .info-grid {
      grid-template-columns: 1fr;
      gap: 40px;
    }

    .similar-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 600px) {
    :global(.main-visual .visual) {
      min-height: 440px;
    }

    .thumbs {
      gap: 5px;
    }

    :global(.thumbs .visual) {
      min-height: 86px;
    }

    .thumbs span {
      display: none;
    }

    .primary-actions {
      grid-template-columns: 1fr 48px;
    }

    .similar-grid {
      grid-template-columns: 1fr;
    }

    dl div {
      grid-template-columns: 110px 1fr;
    }

    .offer-panel {
      width: 100%;
      padding: 20px;
    }

    .offer-types {
      grid-template-columns: 1fr;
    }
  }
</style>
