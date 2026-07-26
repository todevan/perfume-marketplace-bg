<script lang="ts">
  import {
    ArrowRight,
    BadgeCheck,
    Bell,
    ChartNoAxesColumnIncreasing,
    CircleHelp,
    Clock3,
    Heart,
    ListPlus,
    MessageCircle,
    MoreHorizontal,
    PackageCheck,
    Repeat2,
    Search,
    Settings,
    Star,
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
  let profileScore = $derived((data.profile.phoneVerified ? 50 : 0) + (data.profile.city ? 50 : 0));
  const nav = [
    { label: 'Преглед', icon: ChartNoAxesColumnIncreasing, active: true },
    { label: 'Моите обяви', icon: PackageCheck },
    { label: 'Оферти', icon: Repeat2, href: '/offers' },
    { label: 'Сделки', icon: PackageCheck, href: '/deals' },
    { label: 'Съобщения', icon: MessageCircle, href: '/messages' },
    { label: 'Любими', icon: Heart, href: '/favorites' },
    { label: 'Запазени търсения', icon: Search, href: '/saved-searches' },
    { label: 'Отзиви', icon: Star },
    { label: 'Известия', icon: Bell, href: '/notifications' },
    { label: 'Настройки', icon: Settings, href: '/settings' }
  ];
</script>

<svelte:head><title>Моят dashboard · Marketplace beta</title><meta name="robots" content="noindex,nofollow" /></svelte:head>

<div class="dashboard-shell container">
  <aside class="dashboard-nav surface">
    <div class="profile-mini"><div class="avatar">{data.profile.username.slice(0, 1).toUpperCase()}</div><div><strong>{data.profile.username}</strong><span class:pending={!data.profile.phoneVerified}><BadgeCheck size={13} /> {data.profile.phoneVerified ? 'Телефонът е потвърден' : 'Телефонът чака потвърждение'}</span></div></div>
    <nav aria-label="Потребителска зона">
      {#each nav as item}
        {@const Icon = item.icon}
        <a class:active={item.active} href={item.href ?? '/dashboard'}><Icon size={18} /><span>{item.label}</span></a>
      {/each}
    </nav>
    <a class="help" href="/safety"><CircleHelp size={17} /> Помощ и безопасност</a>
  </aside>

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

    <div class="lower-grid">
      <section class="dashboard-section offers">
        <div class="section-title"><div><h2>Оферти</h2><span>Предложения за продажба и размяна</span></div><a href="/offers">Управление <ArrowRight size={16} /></a></div>
        <a href="/offers"><div class="offer-avatar"><Repeat2 size={18} /></div><div><strong>Прегледай офертите</strong><span>Приемането резервира обявата, без да обработва плащане.</span></div><ArrowRight size={16} /></a>
      </section>
      <section class="dashboard-section profile-progress">
        <div class="section-title"><div><h2>Основи на профила</h2><span>Контактът остава скрит</span></div><span class="score">{profileScore}%</span></div>
        <div class="progress"><span style={`width:${profileScore}%`}></span></div>
        <ul><li class:done={data.profile.phoneVerified}><BadgeCheck size={17} /> {data.profile.phoneVerified ? 'Потвърден телефон' : 'Потвърди телефона'}</li><li class:done={Boolean(data.profile.city)}><UserRound size={17} /> {data.profile.city ? `Град: ${data.profile.city}` : 'Добави град'}</li></ul>
      </section>
    </div>

    <div class="beta-note"><Clock3 size={20} /><div><strong>Затворена beta</strong><p>Таксата над 10 активни обяви е изключена, докато пазарът достигне договорените прагове за ликвидност.</p></div></div>
  </section>
</div>

<style>
  .dashboard-shell {
    display: grid;
    align-items: start;
    grid-template-columns: 230px minmax(0, 1fr);
    gap: 34px;
    padding-block: 38px 90px;
  }

  .dashboard-nav {
    position: sticky;
    top: calc(var(--header-height) + 24px);
    overflow: hidden;
    box-shadow: none;
  }

  .profile-mini {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 18px;
    border-bottom: 1px solid var(--line);
  }

  .avatar,
  .offer-avatar {
    display: grid;
    width: 42px;
    height: 42px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 50%;
    color: white;
    background: var(--action);
    font-weight: 700;
    font-style: italic;
  }

  .profile-mini > div:last-child {
    display: grid;
    min-width: 0;
  }

  .profile-mini strong {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .profile-mini span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--success);
    font-size: 0.62rem;
  }

  .profile-mini span.pending {
    color: var(--warning);
  }

  nav {
    display: grid;
    padding: 9px;
  }

  nav a {
    display: grid;
    min-height: 44px;
    align-items: center;
    grid-template-columns: 22px 1fr auto;
    gap: 8px;
    padding: 9px 10px;
    border-radius: 8px;
    color: var(--ink-soft);
    font-size: 0.76rem;
    font-weight: 700;
  }

  nav a:hover,
  nav a.active {
    color: var(--ink);
    background: var(--brand-main);
  }

  .help {
    display: flex;
    min-height: 46px;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    border-top: 1px solid var(--line);
    color: var(--ink-soft);
    font-size: 0.72rem;
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
    font-size: clamp(2.8rem, 6vw, 5.2rem);
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
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: rgb(255 253 249 / 62%);
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
    font-size: 2rem;
    font-style: italic;
  }

  .stats small {
    color: var(--success);
    font-size: 0.64rem;
  }

  .dashboard-section {
    margin-top: 26px;
    padding: 22px;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: rgb(255 253 249 / 62%);
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
    font-style: italic;
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
    border: 1px solid rgb(138 91 22 / 28%);
    border-radius: 11px;
    color: var(--warning);
    background: rgb(138 91 22 / 6%);
  }

  .beta-note p {
    margin: 3px 0 0;
    font-size: 0.72rem;
  }

  @media (max-width: 1060px) {
    .dashboard-shell {
      grid-template-columns: 1fr;
    }

    .dashboard-nav {
      position: relative;
      top: auto;
    }

    .dashboard-nav nav {
      display: flex;
      overflow-x: auto;
    }

    .dashboard-nav nav a {
      min-width: fit-content;
      grid-template-columns: 20px auto auto;
    }

    .stats {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 760px) {
    .dashboard-shell {
      padding-top: 20px;
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
