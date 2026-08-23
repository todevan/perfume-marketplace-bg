<script lang="ts">
  import {
    ArrowRight,
    BadgeCheck,
    CalendarDays,
    Check,
    MapPin,
    PackageCheck,
    ShieldCheck,
    Star,
    Store,
    UserRound
  } from '@lucide/svelte';
  import ListingCard from '$components/ListingCard.svelte';

  let { data } = $props();
  let activeTab = $state<'listings' | 'reviews'>('listings');
  const profile = $derived(data.profile);
  const profileListings = $derived(data.listings.items);
  const reviews = $derived(data.reviews.items);
  const displayKind = $derived(profile.merchantVerified ? 'Проверен търговец' : 'Частно лице');
  const rating = $derived(profile.ratingCount > 0 ? profile.ratingAverage.toLocaleString('bg-BG', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—');
  const ratingRounded = $derived(profile.ratingCount > 0 ? Math.round(profile.ratingAverage) : 0);
  const since = $derived(new Date(profile.memberSince).toLocaleDateString('bg-BG', { month: 'long', year: 'numeric' }));
  const initials = $derived(profile.username.split(/[\s_.-]+/).filter(Boolean).slice(0, 2).map((part: string) => part[0]?.toLocaleUpperCase('bg-BG')).join('') || 'P');
  const tone = $derived(profile.merchantVerified ? '#d0b08a' : '#c6b5a5');
</script>

<svelte:head>
  <title>{profile.username} · Профил</title>
  <meta name="description" content={`Обяви, приключени сделки и отзиви за ${profile.username}.`} />
</svelte:head>

<section class="profile-hero" style={`--profile-tone:${tone}`}>
  <div class="container profile-grid">
    <div class="identity-block reveal">
      <div class="avatar" aria-hidden="true"><span>{initials}</span><i></i></div>
      <div class="identity-copy">
        <span class="eyebrow">Публичен профил</span>
        <div class="name-line"><h1>{profile.username}</h1>{#if profile.merchantVerified}<BadgeCheck size={28} aria-label="Проверен търговец" />{/if}</div>
        <div class="identity-meta"><span><MapPin size={15} /> {profile.city ?? 'България'}</span><span><CalendarDays size={15} /> Тук от {since}</span></div>
        <p>{profile.bio ?? 'Потребител в затворената beta.'}</p>
        <div class="profile-actions"><a class="button primary" href="#profile-listings"><Store size={18} /> Виж обявите</a><a class="button secondary" href={`/report?targetType=profile&targetId=${profile.id}`}><ShieldCheck size={18} /> Подай сигнал</a></div>
      </div>
    </div>

    <aside class="profile-score surface reveal" style="animation-delay: 120ms">
      <div class="score-top"><span>Рейтинг от сделки</span><strong>{rating}</strong><div class="stars" aria-label={profile.ratingCount > 0 ? `${rating} от 5` : 'Все още няма оценки'}>{#each Array(5) as _, index}<Star size={16} fill={index < ratingRounded ? 'currentColor' : 'none'} />{/each}</div></div>
      <div class="score-stats"><div><PackageCheck size={20} /><strong>{profile.completedDealsCount}</strong><span>приключени сделки</span></div><div><ShieldCheck size={20} /><strong>{profile.merchantVerified ? 'Проверен' : 'Активен'}</strong><span>{displayKind}</span></div></div>
      <p><Check size={16} /> Звездите са само от приключени от продавача сделки.</p>
    </aside>
  </div>
</section>

<nav class="profile-tabs" aria-label="Съдържание на профила">
  <div class="container">
    <button type="button" class:active={activeTab === 'listings'} aria-pressed={activeTab === 'listings'} onclick={() => (activeTab = 'listings')}><Store size={17} /> Обяви <span>{profileListings.length}</span></button>
    <button type="button" class:active={activeTab === 'reviews'} aria-pressed={activeTab === 'reviews'} onclick={() => (activeTab = 'reviews')}><Star size={17} /> Отзиви от сделки <span>{profile.ratingCount}</span></button>
  </div>
</nav>

<section class="profile-content section" id="profile-listings">
  <div class="container">
    {#if activeTab === 'listings'}
      <div class="content-heading"><div><span class="eyebrow">Активна колекция</span><h2>Обяви от {profile.username}</h2></div></div>
      {#if profileListings.length}<div class="listing-grid">{#each profileListings as listing}<ListingCard {listing} variant="catalog" />{/each}</div>{:else}<div class="empty-state"><div><Store size={34} /><h2>Няма активни обяви.</h2><p class="muted">Публикуваните обяви на този профил ще се появят тук.</p></div></div>{/if}
    {:else}
      <div class="content-heading"><div><span class="eyebrow">Приключени сделки</span><h2>Отзиви, които изграждат рейтинга.</h2></div><p>Само двамата участници в приключена от продавача сделка могат да дадат звезди.</p></div>
      <div class="review-list">
        {#each reviews as review, index}<article><div class="review-number">{String(index + 1).padStart(2, '0')}</div><div class="reviewer"><div class="mini-avatar"><UserRound size={18} /></div><div><strong>{review.reviewer.username}</strong><span>{new Date(review.createdAt).toLocaleDateString('bg-BG')}</span></div></div><div class="review-body"><div class="review-stars" aria-label={`${review.rating} от 5`}>{#each Array(review.rating) as _}<Star size={15} fill="currentColor" />{/each}</div><span class="deal-label"><PackageCheck size={14} /> Приключена сделка</span><p>{review.body ?? 'Оценка без допълнителен коментар.'}</p></div></article>{/each}
      </div>
    {/if}
  </div>
</section>

<section class="profile-trust">
  <div class="container trust-inner"><ShieldCheck size={26} /><div><strong>Профилната история е една част от прегледа.</strong><p>Проверявай и снимките, кода, описанието и условията на всяка отделна сделка.</p></div><a href="/safety">Към безопасността <ArrowRight size={16} /></a></div>
</section>

<style>
  .profile-hero { position: relative; overflow: hidden; border-bottom: 1px solid var(--line); background: var(--paper); }
  .profile-hero::after { display: none; }
  .profile-grid { position: relative; z-index: 1; display: grid; min-height: 550px; align-items: center; grid-template-columns: 1.15fr .55fr; gap: clamp(40px, 7vw, 95px); padding-block: 64px; }
  .identity-block { display: grid; align-items: center; grid-template-columns: 190px 1fr; gap: 38px; }
  .avatar { position: relative; display: grid; width: 190px; height: 220px; place-items: center; overflow: hidden; border: 1px solid var(--line); border-radius: 6px; color: var(--ink); background: var(--profile-tone); }
  .avatar::before,
  .avatar::after { display: none; }
  .avatar > span { z-index: 1; font-size: 2.8rem; font-weight: 700; font-style: normal; letter-spacing: -.07em; }
  .avatar i { position: absolute; right: 22px; bottom: 24px; left: 22px; height: 3px; background: var(--action); }
  .name-line { display: flex; align-items: center; gap: 12px; }
  .name-line h1 { margin-bottom: 15px; font-size: clamp(2.8rem, 5.2vw, 5rem); font-style: normal; letter-spacing: -.055em; overflow-wrap: anywhere; }
  .name-line > :global(svg) { flex: 0 0 auto; margin-bottom: 12px; color: var(--success); }
  .identity-meta { display: flex; flex-wrap: wrap; gap: 11px 18px; }
  .identity-meta span { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-faint); font-size: .71rem; font-weight: 700; }
  .identity-copy > p { max-width: 650px; margin: 25px 0; color: var(--ink-soft); }
  .profile-actions { display: flex; flex-wrap: wrap; gap: 10px; }
  .profile-score { padding: 28px; border-color: var(--line); border-radius: 6px; background: var(--paper-strong); }
  .score-top > span { color: var(--ink-faint); font-size: .67rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .score-top > strong { display: block; margin: 12px 0 4px; font-size: 4.2rem; font-style: normal; line-height: .9; letter-spacing: -.07em; }
  .stars { display: flex; gap: 2px; color: var(--warning); }
  .score-stats { display: grid; gap: 0; margin-top: 24px; border-block: 1px solid var(--line); }
  .score-stats > div { display: grid; align-items: center; grid-template-columns: 26px auto 1fr; gap: 8px; padding: 15px 0; border-bottom: 1px solid rgb(138 121 103 / 18%); }
  .score-stats > div:last-child { border: 0; }
  .score-stats :global(svg) { color: var(--success); }
  .score-stats strong { font-size: .84rem; }
  .score-stats span { color: var(--ink-faint); font-size: .67rem; text-align: right; }
  .profile-score > p { display: flex; align-items: flex-start; gap: 7px; margin: 18px 0 0; color: var(--ink-soft); font-size: .69rem; }
  .profile-score > p :global(svg) { flex: 0 0 auto; color: var(--success); }
  .profile-tabs { position: sticky; top: var(--header-height); z-index: 25; border-bottom: 1px solid var(--line); background: var(--paper-strong); }
  .profile-tabs .container { display: flex; overflow-x: auto; scrollbar-width: none; }
  .profile-tabs button { position: relative; display: inline-flex; min-height: 59px; align-items: center; gap: 7px; flex: 1 0 auto; justify-content: center; padding: 10px 20px; border: 0; border-right: 1px solid var(--line); color: var(--ink-soft); background: transparent; cursor: pointer; font-size: .75rem; font-weight: 700; }
  .profile-tabs button::after { position: absolute; right: 50%; bottom: 0; left: 50%; height: 3px; background: var(--action); content: ''; transition: inset 180ms ease; }
  .profile-tabs button.active { color: var(--ink); }
  .profile-tabs button.active::after { right: 0; left: 0; }
  .profile-tabs button span { display: grid; min-width: 24px; min-height: 24px; place-items: center; border-radius: 999px; background: var(--brand-tertiary); font-size: .65rem; }
  .content-heading { display: flex; align-items: end; justify-content: space-between; gap: 30px; margin-bottom: 32px; }
  .content-heading h2 { max-width: 780px; margin-bottom: 0; }
  .content-heading > p { max-width: 410px; margin: 0; color: var(--ink-soft); }
  .listing-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .review-list { border-top: 1px solid var(--line-strong); }
  .review-list article { display: grid; grid-template-columns: 48px 180px 1fr; gap: 24px; padding: 28px 0; border-bottom: 1px solid var(--line); }
  .review-number { color: var(--ink-faint); font-size: .64rem; font-weight: 700; letter-spacing: .15em; }
  .reviewer { display: flex; align-items: flex-start; gap: 9px; }
  .mini-avatar { display: grid; width: 38px; height: 38px; place-items: center; flex: 0 0 auto; border: 1px solid var(--line); border-radius: 50%; background: var(--brand-tertiary); }
  .reviewer strong { display: block; font-size: .77rem; }
  .reviewer span { color: var(--ink-faint); font-size: .65rem; }
  .review-body { display: grid; grid-template-columns: auto 1fr; gap: 8px 15px; }
  .review-stars { display: flex; gap: 2px; color: var(--warning); }
  .deal-label { display: inline-flex; align-items: center; gap: 5px; color: var(--success); font-size: .67rem; font-weight: 700; }
  .review-body p { grid-column: 1 / -1; margin: 3px 0 0; color: var(--ink-soft); }
  .profile-trust { padding-block: 26px; background: var(--brand-main); }
  .trust-inner { display: grid; align-items: center; grid-template-columns: 35px 1fr auto; gap: 17px; }
  .trust-inner strong { font-size: .8rem; }
  .trust-inner p { margin: 3px 0 0; color: var(--ink-soft); font-size: .73rem; }
  .trust-inner a { display: inline-flex; min-height: 44px; align-items: center; gap: 6px; font-size: .74rem; font-weight: 700; font-style: normal; }

  @media (max-width: 1000px) {
    .profile-grid { grid-template-columns: 1fr; }
    .profile-score { max-width: 560px; }
    .listing-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 720px) {
    .profile-grid { min-height: auto; padding-block: 55px; }
    .identity-block { grid-template-columns: 1fr; }
    .avatar { width: 160px; height: 184px; }
    .content-heading { align-items: flex-start; flex-direction: column; }
    .listing-grid { grid-template-columns: 1fr; }
    .review-list article { grid-template-columns: 35px 1fr; gap: 12px; }
    .reviewer { grid-column: 2; }
    .review-body { grid-column: 2; grid-template-columns: 1fr; }
    .review-body p { grid-column: 1; }
    .trust-inner { align-items: flex-start; grid-template-columns: 30px 1fr; }
    .trust-inner a { grid-column: 2; }
  }
</style>
