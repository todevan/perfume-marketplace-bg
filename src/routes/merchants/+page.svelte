<script lang="ts">
  import {
    ArrowRight,
    BadgeCheck,
    Building2,
    Check,
    FileCheck2,
    MapPin,
    PackageCheck,
    Search,
    ShieldCheck,
    Star,
    Store,
    UserCheck
  } from '@lucide/svelte';
  import ListingCard from '$components/ListingCard.svelte';

  let { data } = $props();
  let query = $state('');

  const filteredMerchants = $derived.by(() => {
    const needle = query.trim().toLocaleLowerCase('bg');
    return data.merchants.filter((merchant) => !needle || `${merchant.name} ${merchant.city}`.toLocaleLowerCase('bg').includes(needle));
  });
</script>

<svelte:head>
  <title>Проверени търговци · Парфюми</title>
  <meta name="description" content="Разгледай парфюмни витрини от ръчно проверени търговски профили." />
</svelte:head>

<section class="merchant-hero">
  <div class="container hero-grid">
    <div class="hero-copy reveal">
      <span class="eyebrow">Търговски витрини</span>
      <h1>Познаваш <em>отсрещната страна.</em></h1>
      <p>Всеки профил със знак „Проверен търговец“ е прегледан ръчно. Знакът е безплатен и не може да бъде купен.</p>
      <div class="hero-actions">
        <a class="button primary" href="#directory"><Store size={18} /> Отвори директорията</a>
        <a class="button secondary" href="#verification"><ShieldCheck size={18} /> Как проверяваме</a>
      </div>
    </div>

    <div class="seal-stage reveal" style="animation-delay: 120ms" aria-hidden="true">
      <div class="seal-orbit"><span>IDENTITY</span><span>STATUS</span><span>REVIEW</span></div>
      <div class="seal">
        <BadgeCheck size={49} strokeWidth={1.35} />
        <strong>ПРОВЕРЕН</strong>
        <span>търговски профил</span>
      </div>
      <p>MANUAL REVIEW · BG BETA</p>
    </div>
  </div>
</section>

<section class="directory section" id="directory">
  <div class="container">
    <div class="section-heading">
      <div><span class="eyebrow">Директория</span><h2>Магазини с лице и история.</h2></div>
      <p>{filteredMerchants.length} проверени търговски профила съвпадат с търсенето.</p>
    </div>

    <div class="directory-tools surface">
      <label class="search-box" for="merchant-search"><Search size={19} /><span>Търси име или град</span><input id="merchant-search" bind:value={query} placeholder="Напр. София" /></label>
      <a class="button secondary" href="/merchant-application">Кандидатствай <ArrowRight size={16} /></a>
    </div>

    {#if filteredMerchants.length}
      <div class="merchant-grid">
        {#each filteredMerchants as merchant, index}
          <article class="merchant-card" style={`--merchant:${merchant.color}; --delay:${index * 55}ms`}>
            <div class="storefront">
              <span class="store-number">STORE / {String(index + 1).padStart(2, '0')}</span>
              <div class="store-sign"><span>{merchant.initials}</span></div>
              <div class="shelf" aria-hidden="true">
                {#each merchant.scents as scent, scentIndex}<span class="bottle b-{scentIndex + 1}" title={scent}></span>{/each}
              </div>
            </div>
            <div class="merchant-content">
              <div class="merchant-name"><div><span>{merchant.focus}</span><h3>{merchant.name}</h3></div><span class="verified"><BadgeCheck size={17} /> Проверен</span></div>
              <p>{merchant.note}</p>
              <div class="merchant-meta">
                <span><MapPin size={15} /> {merchant.city}</span>
                <span><Star size={15} fill="currentColor" /> {merchant.rating}</span>
                <span><PackageCheck size={15} /> {merchant.deals} сделки</span>
              </div>
              <div class="store-bottom"><span>{merchant.active} активни обяви · от {merchant.since}</span><a href={`/profile/${merchant.slug}`}>Виж витрината <ArrowRight size={16} /></a></div>
            </div>
          </article>
        {/each}
      </div>
    {:else}
      <div class="empty-state"><div><Store size={34} /><h2>Няма такъв търговец.</h2><p class="muted">Избери друг тип селекция или промени търсенето.</p></div></div>
    {/if}
  </div>
</section>

<section class="featured-section section">
  <div class="container">
    <div class="section-heading">
      <div><span class="eyebrow">От витрините</span><h2>Прегледани доказателства.</h2></div>
      <a class="button secondary" href="/listings?merchant=true">Всички търговски обяви <ArrowRight size={17} /></a>
    </div>
    {#if data.merchantListings.length}
      <div class="listing-grid">{#each data.merchantListings as listing}<ListingCard {listing} />{/each}</div>
    {:else}
      <div class="empty-state"><div><PackageCheck size={34} /><h2>Няма активни търговски обяви.</h2><p class="muted">Проверените витрини ще се появят тук след публикуване.</p></div></div>
    {/if}
  </div>
</section>

<section class="verification-section section" id="verification">
  <div class="container verification-grid">
    <div class="verification-intro">
      <span class="eyebrow">Знакът не се купува</span>
      <h2>Ръчна проверка, отделна от VIP.</h2>
      <p>Провереният статус потвърждава данните за търговеца и прегледа на практиката му. Той не е гаранция за всеки отделен флакон.</p>
      <a class="button primary" href="/merchant-application"><Building2 size={18} /> Кандидатствай като търговец</a>
    </div>
    <ol class="verification-steps">
      <li><span>01</span><div class="step-icon"><Building2 size={22} /></div><div><h3>Търговски статус</h3><p>Декларирано юридическо лице, лице за контакт и право да предлага стоки.</p></div><Check size={19} /></li>
      <li><span>02</span><div class="step-icon"><FileCheck2 size={22} /></div><div><h3>Документи и оповестяване</h3><p>Преглед на фирмените данни и информацията, която клиентът трябва да вижда.</p></div><Check size={19} /></li>
      <li><span>03</span><div class="step-icon"><UserCheck size={22} /></div><div><h3>Ръчен преглед и наблюдение</h3><p>Обяви, история на сигналите и поведението на пазара се преглеждат периодично.</p></div><Check size={19} /></li>
    </ol>
  </div>
</section>

<section class="merchant-note">
  <div class="container note-inner"><ShieldCheck size={28} /><div><strong>Важно разграничение</strong><p>„Проверен търговец“ не означава „гарантирано оригинален“. Преглеждай доказателствата към всяка обява и подай сигнал при съмнение.</p></div><a href="/safety#authenticity">Научи повече <ArrowRight size={16} /></a></div>
</section>

<style>
  .merchant-hero { overflow: hidden; border-bottom: 1px solid rgb(138 121 103 / 22%); }
  .hero-grid { display: grid; min-height: 650px; align-items: center; grid-template-columns: 1.15fr .75fr; gap: clamp(50px, 8vw, 120px); padding-block: 72px; }
  .hero-copy h1 { max-width: 780px; margin-bottom: 25px; }
  .hero-copy h1 em { display: block; color: var(--action); }
  .hero-copy > p { max-width: 680px; color: var(--ink-soft); font-size: 1.08rem; }
  .hero-actions { display: flex; flex-wrap: wrap; gap: 11px; margin-top: 31px; }

  .seal-stage { position: relative; display: grid; min-height: 450px; place-items: center; }
  .seal-stage::before { position: absolute; width: 410px; height: 410px; border: 1px solid rgb(74 49 38 / 12%); border-radius: 50%; content: ''; }
  .seal-orbit { position: absolute; width: 355px; height: 355px; border: 1px dashed rgb(74 49 38 / 27%); border-radius: 50%; animation: spin 38s linear infinite; }
  .seal-orbit span { position: absolute; padding: 3px 7px; color: var(--ink-faint); background: var(--brand-secondary); font-size: .58rem; font-weight: 700; letter-spacing: .14em; }
  .seal-orbit span:nth-child(1) { top: 17px; left: 64px; }
  .seal-orbit span:nth-child(2) { top: 48%; right: -24px; }
  .seal-orbit span:nth-child(3) { bottom: 22px; left: 55px; }
  .seal { z-index: 1; display: grid; width: 245px; height: 245px; place-items: center; align-content: center; gap: 7px; border: 1px solid var(--action); border-radius: 50%; outline: 4px double rgb(74 49 38 / 28%); outline-offset: 10px; color: var(--action); background: var(--brand-main); box-shadow: var(--shadow-lg); transform: rotate(-6deg); }
  .seal strong { margin-top: 6px; font-size: 1rem; font-style: italic; letter-spacing: .16em; }
  .seal span { font-size: .67rem; font-weight: 700; letter-spacing: .05em; }
  .seal-stage > p { position: absolute; bottom: 14px; color: var(--ink-faint); font-size: .63rem; font-weight: 700; letter-spacing: .19em; }

  .directory { background: rgb(255 253 249 / 38%); }
  .directory-tools { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 24px; padding: 13px; }
  .search-box { display: grid; min-width: 310px; min-height: 50px; align-items: center; grid-template-columns: 25px 1fr; padding: 4px 12px; border-right: 1px solid var(--line); }
  .search-box > span { position: absolute; opacity: 0; pointer-events: none; }
  .search-box input { width: 100%; min-height: 44px; border: 0; background: transparent; outline: 0; font-weight: 700; }
  .merchant-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 19px; }
  .merchant-card { display: grid; overflow: hidden; grid-template-columns: 180px 1fr; border: 1px solid rgb(138 121 103 / 28%); border-radius: var(--radius-md); background: rgb(255 253 249 / 83%); box-shadow: var(--shadow-sm); animation: reveal-up 650ms cubic-bezier(.22, 1, .36, 1) both; animation-delay: var(--delay); transition: transform 220ms ease, box-shadow 220ms ease; }
  .merchant-card:hover { box-shadow: var(--shadow-lg); transform: translateY(-4px); }
  .storefront { position: relative; display: flex; min-height: 340px; align-items: center; flex-direction: column; justify-content: flex-end; overflow: hidden; padding: 24px 15px 32px; border-right: 1px solid rgb(74 49 38 / 16%); background: linear-gradient(155deg, rgb(255 255 255 / 45%), transparent 50%), var(--merchant); }
  .storefront::before { position: absolute; top: 0; right: 16px; left: 16px; height: 115px; border: 1px solid rgb(74 49 38 / 18%); border-top: 0; background: repeating-linear-gradient(90deg, rgb(255 253 249 / 68%) 0 16px, rgb(74 49 38 / 8%) 16px 27px); content: ''; clip-path: polygon(0 0,100% 0,100% 75%,92% 100%,84% 75%,76% 100%,68% 75%,60% 100%,52% 75%,44% 100%,36% 75%,28% 100%,20% 75%,12% 100%,0 75%); }
  .store-number { position: absolute; top: 15px; left: 15px; z-index: 1; color: var(--ink-soft); font-size: .57rem; font-weight: 700; letter-spacing: .12em; }
  .store-sign { position: absolute; top: 103px; display: grid; width: 80px; height: 80px; place-items: center; border: 1px solid rgb(74 49 38 / 21%); border-radius: 50%; background: rgb(255 253 249 / 86%); box-shadow: var(--shadow-sm); }
  .store-sign span { font-weight: 700; font-style: italic; }
  .shelf { display: flex; width: 100%; height: 105px; align-items: flex-end; justify-content: center; gap: 11px; border-bottom: 7px solid rgb(74 49 38 / 38%); }
  .bottle { position: relative; display: block; width: 31px; height: 68px; border: 1px solid rgb(255 255 255 / 55%); border-radius: 5px 5px 3px 3px; background: rgb(74 49 38 / 55%); box-shadow: 0 7px 10px rgb(74 49 38 / 18%); }
  .bottle::before { position: absolute; top: -12px; left: 8px; width: 14px; height: 13px; background: var(--ink); content: ''; }
  .bottle::after { position: absolute; top: 23px; right: 5px; left: 5px; height: 20px; background: rgb(255 253 249 / 70%); content: ''; }
  .b-2 { width: 38px; height: 83px; border-radius: 17px 17px 5px 5px; background: rgb(119 73 48 / 65%); }
  .b-3 { height: 74px; background: rgb(81 93 91 / 68%); }
  .merchant-content { display: flex; min-width: 0; flex-direction: column; padding: 23px; }
  .merchant-name { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .merchant-name > div > span { color: var(--ink-faint); font-size: .63rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .merchant-name h3 { margin: 4px 0 0; }
  .verified { display: inline-flex; min-height: 28px; align-items: center; gap: 5px; flex: 0 0 auto; color: var(--success); font-size: .67rem; font-weight: 700; }
  .merchant-content > p { flex: 1; margin: 16px 0; color: var(--ink-soft); font-size: .82rem; }
  .merchant-meta { display: flex; flex-wrap: wrap; gap: 9px 14px; padding-block: 13px; border-block: 1px solid rgb(138 121 103 / 20%); }
  .merchant-meta span { display: inline-flex; align-items: center; gap: 5px; color: var(--ink-soft); font-size: .69rem; font-weight: 700; }
  .store-bottom { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 14px; }
  .store-bottom > span { color: var(--ink-faint); font-size: .63rem; }
  .store-bottom a { display: inline-flex; min-height: 44px; align-items: center; gap: 6px; color: var(--action); font-size: .71rem; font-weight: 700; font-style: italic; white-space: nowrap; }

  .featured-section { border-top: 1px solid rgb(138 121 103 / 22%); }
  .listing-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
  .verification-section { color: var(--paper-strong); background: var(--ink); }
  .verification-grid { display: grid; grid-template-columns: .8fr 1.2fr; gap: clamp(45px, 8vw, 110px); }
  .verification-intro { position: sticky; top: calc(var(--header-height) + 35px); align-self: start; }
  .verification-intro .eyebrow { color: rgb(244 236 225 / 50%); }
  .verification-intro p { color: rgb(244 236 225 / 65%); }
  .verification-intro .button { margin-top: 19px; color: var(--ink); background: var(--brand-main); }
  .verification-steps { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
  .verification-steps li { display: grid; align-items: start; grid-template-columns: 34px 54px 1fr 24px; gap: 16px; padding: 29px 0; border-bottom: 1px solid rgb(244 236 225 / 15%); }
  .verification-steps li > span { color: rgb(244 236 225 / 38%); font-size: .65rem; font-weight: 700; letter-spacing: .12em; }
  .step-icon { display: grid; width: 48px; height: 48px; place-items: center; border: 1px solid rgb(244 236 225 / 25%); border-radius: 50%; color: var(--brand-main); }
  .verification-steps h3 { margin-bottom: 7px; color: var(--brand-main); font-size: 1.25rem; }
  .verification-steps p { margin: 0; color: rgb(244 236 225 / 60%); font-size: .84rem; }
  .verification-steps li > :global(svg) { color: var(--brand-main); }
  .merchant-note { padding-block: 28px; background: var(--brand-main); }
  .note-inner { display: grid; align-items: center; grid-template-columns: 35px 1fr auto; gap: 18px; }
  .note-inner strong { font-size: .8rem; }
  .note-inner p { margin: 3px 0 0; color: var(--ink-soft); font-size: .75rem; }
  .note-inner a { display: inline-flex; min-height: 44px; align-items: center; gap: 6px; font-size: .75rem; font-weight: 700; font-style: italic; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 1080px) { .merchant-card { grid-template-columns: 145px 1fr; } .storefront { min-height: 370px; } }
  @media (max-width: 900px) {
    .hero-grid,
    .verification-grid { grid-template-columns: 1fr; }
    .seal-stage { min-height: 410px; }
    .directory-tools { align-items: stretch; flex-direction: column; }
    .search-box { min-width: 0; border-right: 0; border-bottom: 1px solid var(--line); }
    .merchant-grid { grid-template-columns: 1fr; }
    .merchant-card { grid-template-columns: 180px 1fr; }
    .verification-intro { position: static; }
  }
  @media (max-width: 620px) {
    .hero-grid { padding-block: 55px; }
    .seal-stage { min-height: 350px; transform: scale(.82); }
    .merchant-card { grid-template-columns: 1fr; }
    .storefront { min-height: 260px; border-right: 0; border-bottom: 1px solid rgb(74 49 38 / 16%); }
    .merchant-name,
    .store-bottom { align-items: flex-start; flex-direction: column; }
    .listing-grid { grid-template-columns: 1fr; }
    .verification-steps li { grid-template-columns: 28px 45px 1fr; gap: 10px; }
    .verification-steps li > :global(svg) { display: none; }
    .note-inner { align-items: flex-start; grid-template-columns: 30px 1fr; }
    .note-inner a { grid-column: 2; }
  }
</style>
