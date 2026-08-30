<script lang="ts">
  import {
    ArrowRight,

    ChartNoAxesColumnIncreasing,
    Clock3,
    Flag,
    Heart,
    ListPlus,
    MoreHorizontal,
    PackageCheck,
    Repeat2,
    UserRound
  } from '@lucide/svelte';
  import PerfumeVisual from '$components/PerfumeVisual.svelte';
  import {
    formatListingPrice,
    listingStatusLabels,
    remainingPercent,
    visualThemeForListing
  } from '$lib/components/listing/presentation';

  let { data } = $props();
  let activeCount = $derived(data.listings.items.filter((listing) => listing.status === 'active').length);
  let reservedCount = $derived(data.listings.items.filter((listing) => listing.status === 'reserved').length);
  let draftCount = $derived(data.listings.items.filter((listing) => listing.status === 'draft').length);
  let profileScore = $derived(data.profile.city ? 100 : 0);
  const reportStatusLabels = {
    open: 'Получен',
    investigating: 'В проверка',
    resolved: 'Приключен',
    dismissed: 'Приключен'
  } as const;
  const reportOutcomeLabels = {
    pending: 'Очаква решение',
    action_taken: 'Предприето е действие',
    no_action: 'Не е предприето действие',
    completed: 'Проверката е приключена'
  } as const;
  const reportTargetLabels = {
    profile: 'Профил',
    brand: 'Марка',
    listing: 'Обява',
    offer: 'Оферта',
    conversation: 'Разговор',
    message: 'Съобщение',
    deal: 'Сделка',
    review: 'Отзив',
    profile_comment: 'Коментар'
  } as const;
  const reportDate = new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium' });
</script>

<svelte:head><title>Моят dashboard · Marketplace beta</title><meta name="robots" content="noindex,nofollow" /></svelte:head>

<div class="dashboard-shell container">
  <section class="dashboard-main" aria-label="Личен панел">
    <div class="dashboard-head"><div><span class="eyebrow">Личен панел</span><h1>Здравей, {data.profile.username}.</h1><p>Управлявай обявите и състоянието на профила си.</p></div><a class="button primary" href="/publish"><ListPlus size={18} /> Нова обява</a></div>

    <section class="stats" aria-label="Статистика">
      <article><span><PackageCheck size={18} /> Всички обяви</span><strong>{data.listings.total}</strong><small>до 10 са включени в beta</small></article>
      <article><span><ChartNoAxesColumnIncreasing size={18} /> Активни</span><strong>{activeCount}</strong><small>видими в каталога</small></article>
      <article><span><Repeat2 size={18} /> Резервирани</span><strong>{reservedCount}</strong><small>след приета оферта</small></article>
      <article><span><Heart size={18} /> Чернови</span><strong>{draftCount}</strong><small>видими само за теб</small></article>
    </section>

    <section class="dashboard-section">
      <div class="section-title"><div><h2>Моите обяви</h2><span>{activeCount} от 10 активни слота</span></div><a href="/listings">Виж каталога <ArrowRight size={16} /></a></div>
      <div class="quota" aria-label={`Използвани ${activeCount} от 10 активни слота`}><span style={`width:${Math.min(100, activeCount * 10)}%`}></span></div>
      <div class="listing-table">
        {#each data.listings.items as listing (listing.id)}
          <article>
            <a class="mini-visual" href={`/listing/${listing.slug}`}>{#if listing.primaryPhoto}<img src={listing.primaryPhoto.imageUrl} alt="" />{:else}<PerfumeVisual visual={visualThemeForListing(listing.id)} percent={remainingPercent(listing)} label={`dash-${listing.id}`} compact />{/if}</a>
            <div class="listing-name"><span>{listing.brandName}</span><strong>{listing.fragranceName}</strong><small>{listing.bottleVolumeMl ? `${listing.bottleVolumeMl} ml · ${remainingPercent(listing)}%` : 'Желан аромат'}</small></div>
            <div class="metric"><span>Условия</span><strong>{formatListingPrice(listing)}</strong></div>
            <div class="metric"><span>Статус</span><strong>{listingStatusLabels[listing.status]}</strong></div>
            <span class:success={listing.status === 'active'} class="pill">{listing.kind === 'wanted' ? 'Търся' : 'Предлагам'}</span>
            <button aria-label="Още действия"><MoreHorizontal size={19} /></button>
          </article>
        {/each}
        {#if !data.listings.items.length}<div class="empty-listings"><strong>Все още нямаш обяви.</strong><a href="/publish">Създай първата</a></div>{/if}
      </div>
    </section>

    <section class="dashboard-section reports-section">
      <div class="section-title"><div><h2>Моите сигнали</h2><span>Виждаш само безопасен статус и общ резултат</span></div></div>
      {#if 'error' in data.reports}
        <div class="reports-message" role="status">{data.reports.error}</div>
      {:else if data.reports.items.length}
        <div class="reports-list">
          {#each data.reports.items as report (report.id)}
            <article>
              <div class="report-icon"><Flag size={18} /></div>
              <div class="report-summary">
                <strong>{reportTargetLabels[report.targetType]}</strong>
                <span>Подаден на {reportDate.format(new Date(report.createdAt))} · {report.evidenceCount} доказателства</span>
              </div>
              <div class="report-state">
                <span>{reportStatusLabels[report.status]}</span>
                <strong>{reportOutcomeLabels[report.outcome]}</strong>
              </div>
            </article>
          {/each}
        </div>
      {:else}
        <div class="reports-message">Все още нямаш подадени сигнали.</div>
      {/if}
    </section>

    <div class="lower-grid">
      <section class="dashboard-section offers">
        <div class="section-title"><div><h2>Оферти</h2><span>Предложения за продажба и размяна</span></div><a href="/offers">Управление <ArrowRight size={16} /></a></div>
        <a href="/offers"><div class="offer-avatar"><Repeat2 size={18} /></div><div><strong>Прегледай офертите</strong><span>Приемането резервира обявата, без да обработва плащане.</span></div><ArrowRight size={16} /></a>
      </section>
      <section class="dashboard-section profile-progress">
        <div class="section-title"><div><h2>Основи на профила</h2><span>Личните контакти остават скрити</span></div><span class="score">{profileScore}%</span></div>
        <div class="progress"><span style={`width:${profileScore}%`}></span></div>
        <ul><li class:done={Boolean(data.profile.city)}><UserRound size={17} /> {data.profile.city ? `Град: ${data.profile.city}` : 'Добави град'}</li></ul>
      </section>
    </div>

    <div class="beta-note"><Clock3 size={20} /><div><strong>Етап на разработка</strong><p>Таксата над 10 активни обяви е изключена, докато пазарът достигне договорените прагове за ликвидност.</p></div></div>
  </section>
</div>

<style>
  .dashboard-shell {
    padding-block: 6px 0;
  }

  .dashboard-main {
    min-width: 0;
  }

  .dashboard-head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 30px;
  }

  h1 {
    margin-bottom: 8px;
    font-size: clamp(2.45rem, 5vw, 4.4rem);
  }

  .dashboard-head p {
    margin: 0;
    color: var(--ink-soft);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  .stats article {
    display: grid;
    min-height: 165px;
    padding: 18px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--paper-strong);
  }

  .stats article > span {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--ink-soft);
    font-size: 0.7rem;
  }

  .stats strong {
    align-self: end;
    color: var(--action);
    font-size: 2rem;
  }

  .stats small {
    color: var(--success);
    font-size: 0.64rem;
  }

  .dashboard-section {
    margin-top: 26px;
    padding: 22px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--paper-strong);
  }

  .section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding-bottom: 18px;
  }

  .section-title > div {
    display: grid;
  }

  h2 {
    margin: 0;
    font-size: 1.45rem;
  }

  .section-title span {
    color: var(--ink-faint);
    font-size: 0.67rem;
  }

  .section-title > a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.72rem;
    font-weight: 700;
  }

  .quota,
  .progress {
    height: 5px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--brand-tertiary);
  }

  .quota span,
  .progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--success);
  }

  .listing-table {
    margin-top: 12px;
  }

  .listing-table article {
    display: grid;
    min-height: 92px;
    align-items: center;
    grid-template-columns: 64px minmax(180px, 1fr) 100px 90px auto 40px;
    gap: 13px;
    border-top: 1px solid var(--line);
  }

  .mini-visual {
    overflow: hidden;
    border-radius: 8px;
  }

  :global(.mini-visual .visual) {
    min-height: 64px;
  }

  .mini-visual img {
    display: block;
    width: 64px;
    height: 64px;
    object-fit: cover;
  }

  .empty-listings {
    display: flex;
    min-height: 90px;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    border-top: 1px solid var(--line);
    color: var(--ink-soft);
  }

  .empty-listings a {
    color: var(--action);
    font-weight: 700;
  }

  .listing-name,
  .metric {
    display: grid;
  }

  .listing-name span,
  .listing-name small,
  .metric span {
    color: var(--ink-faint);
    font-size: 0.63rem;
  }

  .listing-name strong {
    overflow: hidden;
    font-size: 0.83rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .metric strong {
    font-size: 0.86rem;
  }

  .listing-table article > button {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
  }

  .lower-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
  }

  .reports-list article {
    display: grid;
    min-height: 78px;
    align-items: center;
    grid-template-columns: 42px minmax(0, 1fr) minmax(150px, auto);
    gap: 12px;
    border-top: 1px solid var(--line);
  }

  .report-icon {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border-radius: 50%;
    color: var(--warning);
    background: var(--warning-soft);
  }

  .report-summary,
  .report-state {
    display: grid;
    gap: 3px;
  }

  .report-summary span,
  .report-state span {
    color: var(--ink-faint);
    font-size: 0.64rem;
  }

  .report-state {
    justify-items: end;
    text-align: right;
  }

  .report-state strong {
    color: var(--ink-soft);
    font-size: 0.76rem;
  }

  .reports-message {
    min-height: 74px;
    padding-top: 22px;
    border-top: 1px solid var(--line);
    color: var(--ink-soft);
    font-size: 0.76rem;
  }

  .offer-avatar {
    display: grid;
    width: 42px;
    height: 42px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 50%;
    color: var(--paper-strong);
    background: var(--action);
  }

  .offers > a {
    display: grid;
    min-height: 76px;
    align-items: center;
    grid-template-columns: 42px 1fr auto;
    gap: 11px;
    border-top: 1px solid var(--line);
  }

  .offers > a > div:nth-child(2) {
    display: grid;
  }

  .offers > a span {
    color: var(--ink-faint);
    font-size: 0.64rem;
  }

  .score {
    color: var(--success) !important;
    font-size: 1.1rem !important;
    font-weight: 700;
  }

  .profile-progress ul {
    display: grid;
    gap: 9px;
    padding: 15px 0 0;
    list-style: none;
  }

  .profile-progress li {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ink-soft);
    font-size: 0.72rem;
  }

  .profile-progress li.done {
    color: var(--success);
  }

  .beta-note {
    display: grid;
    align-items: start;
    grid-template-columns: 22px 1fr;
    gap: 11px;
    margin-top: 24px;
    padding: 16px;
    border: 1px solid #c5a16f;
    border-radius: 11px;
    color: var(--warning);
    background: var(--warning-soft);
  }

  .beta-note p {
    margin: 3px 0 0;
    font-size: 0.72rem;
  }

  @media (max-width: 1060px) {
    .stats {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 760px) {
    .dashboard-shell {
      padding-top: 0;
    }

    .dashboard-head {
      align-items: flex-start;
      flex-direction: column;
    }

    .listing-table article {
      grid-template-columns: 58px 1fr auto;
      padding-block: 10px;
    }

    .listing-table .metric,
    .listing-table .pill {
      display: none;
    }

    .lower-grid {
      grid-template-columns: 1fr;
    }

    .reports-list article {
      grid-template-columns: 38px 1fr;
      padding-block: 10px;
    }

    .report-state {
      grid-column: 2;
      justify-items: start;
      text-align: left;
    }
  }

  @media (max-width: 500px) {
    .stats {
      grid-template-columns: 1fr 1fr;
    }

    .stats article {
      min-height: 145px;
      padding: 14px;
    }

    .stats strong {
      font-size: 1.7rem;
    }
  }
</style>
