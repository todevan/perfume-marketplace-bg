<script lang="ts">
  import { ArrowRight, BadgeCheck, Camera, MessageCircle, Repeat2, ShieldCheck, Sparkles } from '@lucide/svelte';
  import ListingCard from '$components/ListingCard.svelte';
  import SearchBar from '$components/SearchBar.svelte';

  let { data } = $props();

  const categories = [
    { slug: 'men', label: 'Мъжки', count: 80, note: 'Свежи, дървесни и класически композиции', glyph: 'M' },
    { slug: 'women', label: 'Дамски', count: 80, note: 'Флорални, гурме и модерни подписи', glyph: 'Д' },
    { slug: 'unisex', label: 'Унисекс', count: 80, note: 'Аромати отвъд традиционните категории', glyph: 'У' },
    { slug: 'niche', label: 'Нишови', count: 80, note: 'Авторски къщи и необичайни суровини', glyph: 'Н' },
    { slug: 'arabic', label: 'Арабски', count: 15, note: 'Подбрани къщи от Близкия изток', glyph: 'ع' }
  ] as const;

  const notes = ['Реални снимки', 'Структурирани оферти', 'Без комисиона по сделката'];
</script>

<svelte:head>
  <title>Парфюми за продажба и размяна · България</title>
  <meta
    name="description"
    content="Открий нови и употребявани парфюми от частни колекционери и проверени търговци."
  />
</svelte:head>

<section class="hero">
  <div class="hero-orbit orbit-one"></div>
  <div class="hero-orbit orbit-two"></div>
  <div class="container hero-grid">
    <div class="hero-copy reveal">
      <span class="eyebrow">Парфюмен marketplace · България</span>
      <h1>Всеки аромат има <em>следваща история.</em></h1>
      <p class="lead">
        Купувай, продавай и разменяй подредено — с точен остатък, реални снимки и профилна история.
      </p>
      <SearchBar />
      <div class="hero-notes">
        {#each notes as note}<span><BadgeCheck size={15} /> {note}</span>{/each}
      </div>
    </div>

    <div class="hero-art reveal" style="animation-delay: 120ms" aria-hidden="true">
      <div class="edition">01 / CURATED</div>
      <div class="hero-bottle bottle-back">
        <span class="cap"></span><span class="glass"><i></i></span>
      </div>
      <div class="hero-bottle bottle-main">
        <span class="cap"></span><span class="neck"></span><span class="glass"><i></i><b>EAU<br />DE<br />PARFUM</b></span>
      </div>
      <div class="scent-script">открий · размени · продължи</div>
      <div class="art-stats">
        <strong>335</strong><span>подбрани позиции<br />в категориите</span>
      </div>
    </div>
  </div>
</section>

<section class="category-section section" id="categories">
  <div class="container">
    <div class="section-heading">
      <div><span class="eyebrow">Разглеждай по усещане</span><h2>Пет входа към колекцията.</h2></div>
      <p>Марка може да присъства в повече от една витрина. Категорията на всяка обява се задава отделно.</p>
    </div>
    <div class="category-grid">
      {#each categories as category, index}
        <a class="category-card c-{index + 1}" href={`/brands/${category.slug}`}>
          <span class="glyph" aria-hidden="true">{category.glyph}</span>
          <span class="count">{category.count} марки</span>
          <h3>{category.label}</h3>
          <p>{category.note}</p>
          <span class="explore">Разгледай <ArrowRight size={17} /></span>
        </a>
      {/each}
    </div>
  </div>
</section>

<section class="section latest-section">
  <div class="container">
    <div class="section-heading">
      <div><span class="eyebrow">Нови в каталога</span><h2>Флакони с ясна история.</h2></div>
      <a class="button secondary" href="/listings">Всички обяви <ArrowRight size={17} /></a>
    </div>
    <div class="listing-grid">
      {#each data.latest.items as listing}
        <ListingCard {listing} />
      {/each}
    </div>
  </div>
</section>

<section class="trust-section section">
  <div class="container trust-grid">
    <div class="trust-copy">
      <span class="eyebrow">Доверие, без фалшиви обещания</span>
      <h2>Не удостоверяваме с един код. Подреждаме доказателствата.</h2>
      <p>
        Batch code показва ориентир за производство, но може да бъде копиран. Затова изискваме четири
        конкретни снимки и преглеждаме рисковите обяви.
      </p>
      <a class="button primary" href="/safety">Как работи проверката <ArrowRight size={17} /></a>
    </div>
    <div class="evidence-card surface">
      <div class="evidence-head"><ShieldCheck size={31} /><div><span>Статус</span><strong>Доказателствата са прегледани</strong></div></div>
      <div class="evidence-grid">
        <div><Camera size={21} /><span>01</span><strong>Цял флакон</strong></div>
        <div><Camera size={21} /><span>02</span><strong>Дъно</strong></div>
        <div><Camera size={21} /><span>03</span><strong>Batch code</strong></div>
        <div><Camera size={21} /><span>04</span><strong>Ниво</strong></div>
      </div>
      <p><Sparkles size={16} /> Прегледът не представлява гаранция за автентичност.</p>
    </div>
  </div>
</section>

<section class="section exchange-section">
  <div class="container exchange-grid">
    <div>
      <span class="eyebrow">Търсени аромати</span>
      <h2>Някой вече търси това, което стои на твоя рафт.</h2>
      <a class="button secondary" href="/wanted">Всички търсения <ArrowRight size={17} /></a>
    </div>
    <div class="wanted-list">
      {#each data.wanted.items as item, index}
        <a href={`/listing/${item.slug}`} class="wanted-row">
          <span class="number">0{index + 1}</span>
          <div><strong>{item.brandName} · {item.fragranceName}</strong><span>{item.seller.username} · {item.city}</span></div>
          <div class="budget"><span>до</span><strong>{item.maxBudget ? `€${(item.maxBudget.amountMinor / 100).toFixed(0)}` : 'размяна'}</strong></div>
          <ArrowRight size={18} />
        </a>
      {/each}
      {#if data.wanted.items.length === 0}
        <div class="wanted-empty"><strong>Все още няма активни търсения.</strong><a href="/publish?kind=wanted">Създай първото <ArrowRight size={16} /></a></div>
      {/if}
    </div>
  </div>
</section>

<section class="how-section section">
  <div class="container">
    <div class="section-heading"><div><span class="eyebrow">Без хаос в коментарите</span><h2>От аромат до договорка в три стъпки.</h2></div></div>
    <div class="steps">
      <div><span>01</span><Camera size={28} /><h3>Покажи точно</h3><p>Обем, остатък, batch code и реални снимки по ясен шаблон.</p></div>
      <div><span>02</span><Repeat2 size={28} /><h3>Предложи структурирано</h3><p>Цена, размяна или аромат с доплащане — без неясни нишки.</p></div>
      <div><span>03</span><MessageCircle size={28} /><h3>Уточнете насаме</h3><p>Плащането и доставката остават между участниците извън платформата.</p></div>
    </div>
  </div>
</section>

<section class="cta-section">
  <div class="container cta-inner">
    <div><span class="eyebrow">Твоята колекция може да диша</span><h2>Освободи място за следващия аромат.</h2></div>
    <a class="button primary" href="/publish">Публикувай обява <ArrowRight size={18} /></a>
  </div>
</section>

<style>
  .hero {
    position: relative;
    min-height: calc(100vh - var(--header-height));
    overflow: hidden;
    border-bottom: 1px solid rgb(138 121 103 / 22%);
  }

  .hero-grid {
    display: grid;
    min-height: calc(100vh - var(--header-height));
    align-items: center;
    grid-template-columns: minmax(0, 1.1fr) minmax(360px, 0.9fr);
    gap: 6vw;
    padding-block: 70px;
  }

  .hero-copy {
    position: relative;
    z-index: 2;
  }

  h1 {
    max-width: 850px;
    margin-bottom: 24px;
  }

  h1 em {
    display: block;
    color: var(--action);
    font-weight: 700;
  }

  .lead {
    max-width: 670px;
    margin-bottom: 34px;
    color: var(--ink-soft);
    font-size: clamp(1.05rem, 2vw, 1.28rem);
  }

  :global(.hero .search-shell) {
    max-width: 760px;
  }

  .hero-notes {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 22px;
    margin-top: 21px;
  }

  .hero-notes span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--ink-soft);
    font-size: 0.77rem;
    font-weight: 700;
  }

  .hero-art {
    position: relative;
    min-height: 620px;
  }

  .hero-art::before {
    position: absolute;
    inset: 7% -8% 1% 7%;
    border: 1px solid rgb(74 49 38 / 18%);
    border-radius: 52% 48% 32% 68% / 54% 38% 62% 46%;
    background: linear-gradient(135deg, rgb(243 223 191 / 78%), rgb(214 202 186 / 30%));
    content: '';
    transform: rotate(-6deg);
  }

  .hero-bottle {
    position: absolute;
    bottom: 13%;
    filter: drop-shadow(0 34px 24px rgb(36 28 22 / 20%));
  }

  .hero-bottle .cap,
  .hero-bottle .neck,
  .hero-bottle .glass {
    display: block;
    margin-inline: auto;
  }

  .hero-bottle .cap {
    width: 92px;
    height: 55px;
    border-radius: 3px 3px 9px 9px;
    background: linear-gradient(90deg, #2e211c, #6b5144 45%, #2a1d18);
  }

  .hero-bottle .neck {
    width: 68px;
    height: 25px;
    background: #b09573;
  }

  .hero-bottle .glass {
    position: relative;
    overflow: hidden;
    border: 2px solid rgb(255 255 255 / 62%);
    background: linear-gradient(135deg, rgb(255 255 255 / 60%), rgb(118 70 45 / 68%) 44%, rgb(76 42 28 / 92%));
  }

  .hero-bottle .glass i {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 52%;
    background: rgb(71 35 22 / 68%);
  }

  .hero-bottle .glass b {
    position: absolute;
    top: 35%;
    right: 16%;
    left: 16%;
    z-index: 1;
    padding: 18px 8px;
    color: #4a3126;
    background: rgb(244 236 225 / 88%);
    font-size: 0.72rem;
    line-height: 1.2;
    letter-spacing: 0.12em;
    text-align: center;
  }

  .bottle-main {
    right: 10%;
    z-index: 2;
  }

  .bottle-main .glass {
    width: 230px;
    height: 330px;
    border-radius: 34px 34px 18px 18px;
  }

  .bottle-back {
    right: 47%;
    bottom: 18%;
    opacity: 0.62;
    transform: scale(0.76) rotate(-8deg);
  }

  .bottle-back .glass {
    width: 210px;
    height: 290px;
    border-radius: 100px 100px 22px 22px;
    background: linear-gradient(145deg, rgb(255 255 255 / 75%), rgb(186 154 128 / 62%));
  }

  .edition {
    position: absolute;
    top: 13%;
    right: -7%;
    color: var(--ink-soft);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    transform: rotate(90deg);
  }

  .scent-script {
    position: absolute;
    bottom: 8%;
    left: -4%;
    z-index: 3;
    padding: 10px 17px;
    border: 1px solid rgb(74 49 38 / 28%);
    border-radius: 999px;
    background: rgb(244 236 225 / 78%);
    color: var(--ink-soft);
    font-size: 0.72rem;
    font-weight: 700;
    font-style: italic;
    backdrop-filter: blur(12px);
  }

  .art-stats {
    position: absolute;
    top: 15%;
    left: -3%;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .art-stats strong {
    font-size: 2.3rem;
    font-style: italic;
  }

  .art-stats span {
    color: var(--ink-soft);
    font-size: 0.7rem;
    line-height: 1.3;
  }

  .hero-orbit {
    position: absolute;
    border: 1px solid rgb(74 49 38 / 10%);
    border-radius: 50%;
  }

  .orbit-one {
    top: -28vw;
    left: -22vw;
    width: 65vw;
    height: 65vw;
  }

  .orbit-two {
    right: -32vw;
    bottom: -32vw;
    width: 78vw;
    height: 78vw;
  }

  .category-section {
    background: rgb(255 253 249 / 42%);
  }

  .category-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 14px;
  }

  .category-card {
    position: relative;
    min-height: 330px;
    overflow: hidden;
    padding: 24px;
    border: 1px solid rgb(74 49 38 / 18%);
    border-radius: var(--radius-md);
    background: var(--paper);
    transition: transform 230ms ease, box-shadow 230ms ease;
  }

  .category-card:nth-child(1),
  .category-card:nth-child(2) {
    grid-column: span 3;
  }

  .category-card:nth-child(n + 3) {
    grid-column: span 2;
  }

  .category-card:hover {
    z-index: 2;
    box-shadow: var(--shadow-lg);
    transform: translateY(-6px) rotate(-0.5deg);
  }

  .category-card::after {
    position: absolute;
    right: -80px;
    bottom: -110px;
    width: 260px;
    height: 260px;
    border: 1px solid rgb(74 49 38 / 15%);
    border-radius: 50%;
    content: '';
  }

  .c-1 { background: linear-gradient(145deg, #e2ddd3, #bec2c0); }
  .c-2 { background: linear-gradient(145deg, #f0ded8, #d6bdb3); }
  .c-3 { background: linear-gradient(145deg, #e7ddca, #cfc2a9); }
  .c-4 { background: linear-gradient(145deg, #dcd7ce, #bbb4a9); }
  .c-5 { background: linear-gradient(145deg, #ead2ae, #c9a473); }

  .glyph {
    position: absolute;
    right: 12px;
    bottom: -36px;
    color: rgb(36 28 22 / 9%);
    font-size: 12rem;
    font-weight: 700;
    font-style: italic;
    line-height: 1;
  }

  .count {
    color: var(--ink-soft);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .category-card h3 {
    margin: 90px 0 10px;
    font-size: clamp(1.8rem, 4vw, 3rem);
  }

  .category-card p {
    position: relative;
    z-index: 1;
    max-width: 280px;
    color: var(--ink-soft);
  }

  .explore {
    position: absolute;
    bottom: 24px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.8rem;
    font-weight: 700;
    font-style: italic;
  }

  .latest-section {
    background: linear-gradient(to bottom, transparent, rgb(243 223 191 / 28%), transparent);
  }

  .listing-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 18px;
  }

  .trust-section {
    color: var(--brand-secondary);
    background:
      radial-gradient(circle at 10% 10%, rgb(243 223 191 / 9%), transparent 30rem),
      var(--ink);
  }

  .trust-grid {
    display: grid;
    align-items: center;
    grid-template-columns: 0.92fr 1.08fr;
    gap: clamp(44px, 8vw, 110px);
  }

  .trust-copy .eyebrow,
  .trust-copy p {
    color: rgb(244 236 225 / 66%);
  }

  .trust-copy p {
    max-width: 590px;
    margin-bottom: 28px;
    font-size: 1.05rem;
  }

  .trust-copy .button.primary {
    color: var(--ink);
    background: var(--brand-main);
  }

  .evidence-card {
    padding: clamp(24px, 4vw, 44px);
    color: var(--ink);
    background: var(--brand-secondary);
  }

  .evidence-head {
    display: flex;
    align-items: center;
    gap: 16px;
    padding-bottom: 26px;
    border-bottom: 1px solid var(--line);
  }

  .evidence-head > div {
    display: grid;
  }

  .evidence-head span {
    color: var(--ink-faint);
    font-size: 0.68rem;
    text-transform: uppercase;
  }

  .evidence-head strong {
    font-style: italic;
  }

  .evidence-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
    padding-block: 18px;
  }

  .evidence-grid > div {
    position: relative;
    display: grid;
    min-height: 130px;
    align-content: space-between;
    padding: 18px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: rgb(255 253 249 / 52%);
  }

  .evidence-grid span {
    position: absolute;
    top: 14px;
    right: 14px;
    color: var(--ink-faint);
    font-size: 0.68rem;
  }

  .evidence-grid strong {
    font-size: 0.9rem;
  }

  .evidence-card > p {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 0;
    color: var(--ink-soft);
    font-size: 0.75rem;
  }

  .exchange-section {
    background: var(--brand-main);
  }

  .exchange-grid {
    display: grid;
    align-items: start;
    grid-template-columns: 0.8fr 1.2fr;
    gap: clamp(40px, 8vw, 110px);
  }

  .exchange-grid h2 {
    margin-bottom: 27px;
  }

  .wanted-list {
    border-top: 1px solid rgb(74 49 38 / 40%);
  }

  .wanted-empty {
    display: flex;
    min-height: 112px;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    border-bottom: 1px solid rgb(74 49 38 / 30%);
  }

  .wanted-empty a {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    gap: 7px;
    color: var(--action);
    font-weight: 700;
    font-style: italic;
  }

  .wanted-row {
    display: grid;
    min-height: 112px;
    align-items: center;
    grid-template-columns: 42px 1fr auto auto;
    gap: 18px;
    border-bottom: 1px solid rgb(74 49 38 / 30%);
    transition: padding 180ms ease, background 180ms ease;
  }

  .wanted-row:hover {
    padding-inline: 12px;
    background: rgb(255 253 249 / 24%);
  }

  .number,
  .wanted-row div span {
    color: var(--ink-soft);
    font-size: 0.7rem;
  }

  .wanted-row div:not(.budget) {
    display: grid;
  }

  .budget {
    display: flex;
    align-items: baseline;
    gap: 5px;
  }

  .budget strong {
    font-size: 1.15rem;
  }

  .how-section {
    background: rgb(255 253 249 / 55%);
  }

  .steps {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-top: 1px solid var(--line);
  }

  .steps > div {
    position: relative;
    min-height: 300px;
    padding: 36px 32px 26px 0;
    border-right: 1px solid var(--line);
  }

  .steps > div + div {
    padding-left: 32px;
  }

  .steps > div:last-child {
    border-right: 0;
  }

  .steps > div > span {
    position: absolute;
    top: 35px;
    right: 28px;
    color: var(--ink-faint);
    font-size: 0.7rem;
  }

  .steps h3 {
    margin: 75px 0 12px;
    font-size: 1.55rem;
  }

  .steps p {
    max-width: 290px;
    color: var(--ink-soft);
  }

  .cta-section {
    padding-block: 70px;
    border-top: 1px solid var(--line);
  }

  .cta-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 35px;
  }

  .cta-inner h2 {
    max-width: 760px;
    margin-bottom: 0;
  }

  @media (max-width: 1050px) {
    .hero-grid {
      min-height: auto;
      grid-template-columns: 1fr;
      padding-block: 80px 0;
    }

    .hero-art {
      min-height: 520px;
      margin-top: -40px;
    }

    .listing-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .trust-grid,
    .exchange-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 760px) {
    .hero-grid {
      padding-top: 60px;
    }

    .hero-art {
      min-height: 430px;
      margin-top: -10px;
    }

    .bottle-main {
      right: 3%;
      transform: scale(0.78);
      transform-origin: bottom right;
    }

    .bottle-back {
      right: 35%;
      transform: scale(0.57) rotate(-8deg);
      transform-origin: bottom right;
    }

    .art-stats {
      top: 20%;
      left: 0;
    }

    .category-grid {
      grid-template-columns: 1fr;
    }

    .category-card:nth-child(n) {
      min-height: 280px;
      grid-column: auto;
    }

    .category-card h3 {
      margin-top: 55px;
    }

    .listing-grid,
    .evidence-grid,
    .steps {
      grid-template-columns: 1fr;
    }

    .steps > div,
    .steps > div + div {
      min-height: 240px;
      padding: 30px 0;
      border-right: 0;
      border-bottom: 1px solid var(--line);
    }

    .steps > div:last-child {
      border-bottom: 0;
    }

    .wanted-row {
      grid-template-columns: 30px 1fr auto;
    }

    .wanted-row > :global(svg) {
      display: none;
    }

    .cta-inner {
      align-items: flex-start;
      flex-direction: column;
    }
  }

  @media (max-width: 520px) {
    .listing-grid {
      grid-template-columns: 1fr;
    }

    .hero-art {
      min-height: 390px;
    }

    .edition,
    .scent-script {
      display: none;
    }
  }
</style>
