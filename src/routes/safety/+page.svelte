<script lang="ts">
  import {
    ArrowRight,
    BadgeCheck,
    Ban,
    Camera,
    Check,
    CircleAlert,
    ExternalLink,
    FileWarning,
    Flag,
    Handshake,
    Info,
    LockKeyhole,
    MessageCircle,
    PackageCheck,
    Scale,
    ShieldCheck,
    Truck
  } from '@lucide/svelte';

  const evidence = [
    { number: '01', title: 'Цял продукт', copy: 'Флаконът и кутията се виждат без скрити части.' },
    { number: '02', title: 'Дъно и етикет', copy: 'Печатът, стикерът и конструкцията са на фокус.' },
    { number: '03', title: 'Batch code', copy: 'Кодът върху флакона и кутията може да бъде сравнен.' },
    { number: '04', title: 'Ниво и състояние', copy: 'Остатъкът, пулверизаторът и видимите следи са описани.' }
  ];

  const rules = [
    ['Разрешено', 'Нови и употребявани оригинални флакони, тестери и официални мостри, описани точно.', true],
    ['Забранено', 'Фалшификати, реплики, „вдъхновени“ продукти, които имитират марка, и стоки с премахната следа.', false],
    ['Забранено в beta', 'Decants, splits, gift sets, пакети и attar/CPO масла не са част от първата версия.', false],
    ['Задължително', 'Собствени снимки, реален остатък, точен формат и всички известни дефекти.', true]
  ] as const;
</script>

<svelte:head>
  <title>Безопасност и автентичност · Парфюмен marketplace</title>
  <meta name="description" content="Как да разпознаеш риск, какви снимки да изискваш и как да подадеш сигнал." />
</svelte:head>

<section class="safety-hero">
  <div class="container hero-grid">
    <div class="hero-copy reveal">
      <span class="eyebrow">Доверие чрез доказателства</span>
      <h1>Проверявай <em>цялата история.</em></h1>
      <p>Няма един код, снимка или знак, който сам да докаже автентичност. Затова подреждаме произхода, състоянието, профилната история и сигналите в една картина.</p>
      <div class="hero-actions"><a class="button light" href="#authenticity"><ShieldCheck size={18} /> Виж проверката</a><a class="button outline" href="#report"><Flag size={18} /> Подай сигнал</a></div>
    </div>
    <div class="risk-card reveal" style="animation-delay: 120ms">
      <div class="risk-head"><span>TRUST FILE / 04</span><BadgeCheck size={26} /></div>
      <div class="risk-status"><span>Статус</span><strong>Доказателствата са прегледани</strong></div>
      <ul><li><Check size={15} /> 4 различни снимки</li><li><Check size={15} /> Съвпадащи кодове</li><li><Check size={15} /> Профилна история</li></ul>
      <p><CircleAlert size={16} /> Това не е гаранция за автентичност.</p>
    </div>
  </div>
</section>

<nav class="safety-nav" aria-label="Секции за безопасност">
  <div class="container"><a href="#authenticity">01 · Автентичност</a><a href="#trade">02 · Безопасна сделка</a><a href="#rules">03 · Правила</a><a href="#report">04 · Сигнал</a></div>
</nav>

<section class="section authenticity" id="authenticity">
  <div class="container">
    <div class="section-heading"><div><span class="eyebrow">01 · Минимум за доказателства</span><h2>Четири кадъра. Един цялостен преглед.</h2></div><p>Снимките трябва да са реални, различни и достатъчно ясни за сравнение.</p></div>
    <div class="evidence-grid">
      {#each evidence as item}
        <article><div class="photo-placeholder"><Camera size={28} /><span>{item.number}</span><i></i></div><h3>{item.title}</h3><p>{item.copy}</p></article>
      {/each}
    </div>

    <div class="review-grid">
      <div class="review-card surface"><span class="eyebrow">Какво можем да направим</span><h3>Преглед на видимите доказателства</h3><ul><li><Check size={17} /> Да сравним флакон, кутия, код и описание</li><li><Check size={17} /> Да отбележим несъответствия и рискови сигнали</li><li><Check size={17} /> Да изискаме още данни или да спрем обявата</li></ul></div>
      <div class="review-card no-guarantee"><span class="eyebrow">Какво не твърдим</span><h3>Не издаваме сертификат за оригиналност</h3><ul><li><Ban size={17} /> Снимката не позволява физически или лабораторен тест</li><li><Ban size={17} /> Кодът и опаковката могат да бъдат копирани</li><li><Ban size={17} /> Статусът на профила не гарантира всяка негова стока</li></ul></div>
    </div>

    <aside class="batch-note">
      <div class="batch-icon"><Info size={28} /></div>
      <div><span class="eyebrow">Batch code е следа, не присъда</span><h3>Валиден код не доказва автентичност.</h3><p><strong>batch-code.com</strong> може да даде ориентир за дата на производство, но кодът може да бъде копиран върху фалшив продукт. Използвай справката само заедно с останалите доказателства.</p></div>
      <a class="button secondary" href="https://www.batch-code.com/" target="_blank" rel="noopener noreferrer">Информационна справка <ExternalLink size={16} /></a>
    </aside>
  </div>
</section>

<section class="section trade" id="trade">
  <div class="container">
    <div class="section-heading light-heading"><div><span class="eyebrow">02 · Договорка без прибързване</span><h2>Сделката е твоя. Процесът е видим.</h2></div><p>Платформата не приема плащането за парфюма и не организира доставката в beta.</p></div>
    <ol class="trade-steps">
      <li><span>01</span><div><MessageCircle size={25} /></div><h3>Оставай в чата</h3><p>Условията, снимките и промените в договорката остават видими за двамата.</p></li>
      <li><span>02</span><div><Handshake size={25} /></div><h3>Изпрати точна оферта</h3><p>Цена, размяна или флакон с доплащане. Приемането е неподвързващо и резервира обявата.</p></li>
      <li><span>03</span><div><Truck size={25} /></div><h3>Избери доставка с преглед</h3><p>Уточни опаковката, прегледа и кой поема разхода. Провери флакона преди приемане.</p></li>
      <li><span>04</span><div><PackageCheck size={25} /></div><h3>Потвърдете и двамата</h3><p>Отзив със звезди се отключва едва след взаимно потвърдена приключена сделка.</p></li>
    </ol>
    <div class="privacy-strip"><LockKeyhole size={24} /><div><strong>Имейлът и телефонът ти не са публични.</strong><p>Решаваш какво да споделиш в чата. Модератор може да прегледа разговор само при активен сигнал и с одитна следа.</p></div></div>
  </div>
</section>

<section class="section rules" id="rules">
  <div class="container rules-grid">
    <div class="rules-intro"><span class="eyebrow">03 · Правила на пазара</span><h2>Описвай точно. Не прикривай риск.</h2><p>Правилата важат еднакво за частни лица и търговци. Сигналите и рискът определят кога се налага допълнителен преглед.</p><a class="button secondary" href="/legal/terms"><Scale size={17} /> Чернова на условията</a></div>
    <div class="rule-list">
      {#each rules as rule, index}<article class:positive={rule[2]}><div><span>{String(index + 1).padStart(2, '0')}</span>{#if rule[2]}<Check size={20} />{:else}<Ban size={20} />{/if}</div><div><strong>{rule[0]}</strong><p>{rule[1]}</p></div></article>{/each}
    </div>
  </div>
</section>

<section class="section report" id="report">
  <div class="container report-grid">
    <div class="report-copy"><span class="eyebrow">04 · Сигнал и проследимост</span><h2>Кажи ни какво не е наред.</h2><p>Подай конкретен линк, опиши проблема и не премахвай съобщенията от чата. При непосредствена опасност или престъпление се обърни и към компетентните органи.</p><div class="report-points"><span><ShieldCheck size={18} /> Оценка според риска</span><span><FileWarning size={18} /> Одитна следа за действията</span><span><Scale size={18} /> Право на обжалване</span></div></div>
    <article class="report-form surface">
      <div class="form-head"><Flag size={24} /><div><span>REPORT / BETA</span><h3>Сигнал от контекста</h3></div></div>
      <p>Бутонът „Подай сигнал“ се намира в конкретната обява, профил, сделка или разговор. Така системата свързва сигнала с точния обект и пази проверима одитна следа.</p>
      <ol class="report-steps"><li><span>01</span>Отвори съдържанието, което искаш да докладваш.</li><li><span>02</span>Избери причина и опиши само проверими факти.</li><li><span>03</span>Следи статуса в профила си; решението може да бъде обжалвано.</li></ol>
      <div class="report-actions"><a class="button primary" href="/listings"><Flag size={17} /> Към обявите</a><a class="button secondary" href="/legal/appeals"><Scale size={17} /> Обжалване</a></div>
      <p class="form-caveat"><Info size={14} /> При непосредствен риск използвай и официалните канали на компетентните органи.</p>
    </article>
  </div>
</section>

<style>
  .safety-hero { color: var(--paper-strong); background: #2b201a; }
  .hero-grid { display: grid; min-height: 670px; align-items: center; grid-template-columns: 1.08fr .62fr; gap: clamp(55px, 9vw, 130px); padding-block: 75px; }
  .hero-copy .eyebrow { color: rgb(244 236 225 / 52%); }
  .hero-copy h1 { max-width: 820px; color: var(--paper-strong); }
  .hero-copy h1 em { display: block; color: #d8aab1; font-style: normal; }
  .hero-copy > p { max-width: 690px; color: rgb(244 236 225 / 65%); font-size: 1.07rem; }
  .hero-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 30px; }
  .button.light { color: var(--ink); background: var(--brand-main); }
  .button.outline { border-color: rgb(244 236 225 / 45%); color: var(--paper-strong); background: transparent; }
  .risk-card { position: relative; overflow: hidden; padding: 30px; border: 1px solid rgb(244 236 225 / 22%); border-radius: var(--radius-md); background: #352923; }
  .risk-card::before { position: absolute; top: -60px; right: -60px; width: 180px; height: 180px; border: 1px solid rgb(243 223 191 / 19%); border-radius: 50%; content: ''; }
  .risk-head { display: flex; align-items: center; justify-content: space-between; color: var(--brand-main); }
  .risk-head span { color: rgb(244 236 225 / 45%); font-size: .61rem; font-weight: 700; letter-spacing: .15em; }
  .risk-status { display: grid; gap: 4px; margin: 48px 0 25px; }
  .risk-status span { color: rgb(244 236 225 / 43%); font-size: .67rem; letter-spacing: .12em; text-transform: uppercase; }
  .risk-status strong { max-width: 300px; color: #e1b8bd; font-size: 1.25rem; line-height: 1.2; }
  .risk-card ul { display: grid; gap: 10px; margin: 0; padding: 18px 0; border-block: 1px solid rgb(244 236 225 / 15%); list-style: none; }
  .risk-card li { display: flex; align-items: center; gap: 8px; color: rgb(244 236 225 / 73%); font-size: .76rem; }
  .risk-card > p { display: flex; align-items: flex-start; gap: 7px; margin: 20px 0 0; color: rgb(244 236 225 / 48%); font-size: .7rem; }
  .risk-card > p :global(svg) { flex: 0 0 auto; }
  .safety-nav { position: sticky; top: var(--header-height); z-index: 30; border-bottom: 1px solid var(--line); background: var(--paper); }
  .safety-nav .container { display: flex; overflow-x: auto; scrollbar-width: none; }
  .safety-nav a { display: inline-flex; min-height: 54px; align-items: center; flex: 1 0 auto; justify-content: center; padding-inline: 18px; border-right: 1px solid var(--line); color: var(--ink-soft); font-size: .68rem; font-weight: 700; letter-spacing: .05em; }
  .safety-nav a:hover { color: var(--ink); background: rgb(255 253 249 / 60%); }
  .evidence-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; }
  .evidence-grid article { min-width: 0; }
  .photo-placeholder { position: relative; display: grid; min-height: 225px; place-items: center; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-md); color: var(--action); background: var(--paper-deep); }
  .photo-placeholder::before,
  .photo-placeholder::after { position: absolute; border: 1px solid rgb(74 49 38 / 13%); border-radius: 50%; content: ''; }
  .photo-placeholder::before { width: 180px; height: 180px; }
  .photo-placeholder::after { width: 110px; height: 110px; }
  .photo-placeholder :global(svg) { z-index: 1; }
  .photo-placeholder span { position: absolute; top: 14px; left: 15px; color: var(--ink-faint); font-size: .63rem; font-weight: 700; letter-spacing: .12em; }
  .photo-placeholder i { position: absolute; right: 16px; bottom: 13px; left: 16px; height: 1px; background: rgb(74 49 38 / 20%); }
  .evidence-grid h3 { margin: 17px 0 6px; font-size: 1.15rem; }
  .evidence-grid p { color: var(--ink-soft); font-size: .78rem; }
  .review-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-top: 64px; }
  .review-card { padding: 30px; }
  .review-card h3 { max-width: 480px; }
  .review-card ul { display: grid; gap: 12px; margin: 22px 0 0; padding: 20px 0 0; border-top: 1px solid var(--line); list-style: none; }
  .review-card li { display: flex; align-items: flex-start; gap: 9px; color: var(--ink-soft); font-size: .8rem; }
  .review-card li :global(svg) { flex: 0 0 auto; color: var(--success); }
  .review-card.no-guarantee { border: 1px solid rgb(141 47 54 / 25%); border-radius: var(--radius-md); background: rgb(141 47 54 / 5%); }
  .review-card.no-guarantee li :global(svg) { color: var(--danger); }
  .batch-note { display: grid; align-items: center; grid-template-columns: 70px 1fr auto; gap: 25px; margin-top: 18px; padding: 28px; border: 1px solid rgb(138 91 22 / 30%); border-radius: var(--radius-md); background: rgb(243 223 191 / 58%); }
  .batch-icon { display: grid; width: 62px; height: 62px; place-items: center; border: 1px solid rgb(74 49 38 / 25%); border-radius: 50%; }
  .batch-note .eyebrow { margin-bottom: 7px; }
  .batch-note h3 { margin-bottom: 8px; }
  .batch-note p { margin: 0; color: var(--ink-soft); font-size: .78rem; }
  .batch-note .button { white-space: nowrap; }
  .trade { color: var(--paper-strong); background: var(--ink); }
  .light-heading .eyebrow { color: rgb(244 236 225 / 50%); }
  .light-heading p { color: rgb(244 236 225 / 57%); }
  .trade-steps { display: grid; grid-template-columns: repeat(4, 1fr); margin: 0; padding: 0; border-block: 1px solid rgb(244 236 225 / 18%); list-style: none; }
  .trade-steps li { position: relative; padding: 28px 24px 30px 0; border-right: 1px solid rgb(244 236 225 / 14%); }
  .trade-steps li:not(:first-child) { padding-left: 24px; }
  .trade-steps li:last-child { border: 0; }
  .trade-steps li > span { color: rgb(244 236 225 / 35%); font-size: .61rem; font-weight: 700; letter-spacing: .12em; }
  .trade-steps li > div { display: grid; width: 50px; height: 50px; place-items: center; margin: 25px 0 24px; border: 1px solid rgb(244 236 225 / 22%); border-radius: 50%; color: var(--brand-main); }
  .trade-steps h3 { color: var(--brand-main); font-size: 1.2rem; }
  .trade-steps p { margin: 0; color: rgb(244 236 225 / 56%); font-size: .78rem; }
  .privacy-strip { display: grid; align-items: center; grid-template-columns: 40px 1fr; gap: 14px; margin-top: 28px; padding: 20px; border: 1px solid rgb(244 236 225 / 15%); border-radius: var(--radius-sm); background: rgb(244 236 225 / 6%); }
  .privacy-strip > :global(svg) { color: var(--brand-main); }
  .privacy-strip strong { color: var(--brand-main); font-size: .8rem; }
  .privacy-strip p { margin: 3px 0 0; color: rgb(244 236 225 / 52%); font-size: .72rem; }
  .rules-grid { display: grid; align-items: start; grid-template-columns: .72fr 1.28fr; gap: clamp(50px, 8vw, 120px); }
  .rules-intro { position: sticky; top: calc(var(--header-height) + 90px); }
  .rules-intro p { color: var(--ink-soft); }
  .rules-intro .button { margin-top: 15px; }
  .rule-list { border-top: 1px solid var(--line-strong); }
  .rule-list article { display: grid; grid-template-columns: 85px 1fr; gap: 22px; padding: 26px 0; border-bottom: 1px solid var(--line); }
  .rule-list article > div:first-child { display: flex; align-items: flex-start; justify-content: space-between; color: var(--danger); }
  .rule-list article.positive > div:first-child { color: var(--success); }
  .rule-list article > div:first-child span { color: var(--ink-faint); font-size: .62rem; font-weight: 700; letter-spacing: .12em; }
  .rule-list strong { font-size: .78rem; text-transform: uppercase; }
  .rule-list p { margin: 5px 0 0; color: var(--ink-soft); font-size: .82rem; }
  .report { border-top: 1px solid var(--line); background: rgb(255 253 249 / 40%); }
  .report-grid { display: grid; align-items: start; grid-template-columns: .8fr 1.1fr; gap: clamp(45px, 8vw, 110px); }
  .report-copy p { color: var(--ink-soft); }
  .report-points { display: grid; gap: 12px; margin-top: 28px; }
  .report-points span { display: flex; align-items: center; gap: 9px; color: var(--ink-soft); font-size: .78rem; font-weight: 700; }
  .report-form { display: grid; gap: 18px; padding: 30px; }
  .form-head { display: flex; align-items: center; gap: 12px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
  .form-head > :global(svg) { color: var(--danger); }
  .form-head span { color: var(--ink-faint); font-size: .6rem; font-weight: 700; letter-spacing: .13em; }
  .form-head h3 { margin: 2px 0 0; }
  .report-form > p { margin: 0; color: var(--ink-soft); }
  .report-steps { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
  .report-steps li { display: grid; min-height: 48px; align-items: center; grid-template-columns: 36px 1fr; gap: 10px; border-bottom: 1px solid var(--line); color: var(--ink-soft); font-size: .78rem; }
  .report-steps span { color: var(--action); font-weight: 700; letter-spacing: .1em; }
  .report-actions { display: flex; flex-wrap: wrap; gap: 9px; }
  .form-caveat { display: flex; align-items: flex-start; gap: 6px; margin: 0; color: var(--ink-faint); font-size: .65rem; }
  .form-caveat :global(svg) { flex: 0 0 auto; }

  @media (max-width: 960px) {
    .hero-grid,
    .rules-grid,
    .report-grid { grid-template-columns: 1fr; }
    .risk-card { max-width: 520px; }
    .evidence-grid,
    .trade-steps { grid-template-columns: repeat(2, 1fr); }
    .trade-steps li:nth-child(2) { border-right: 0; }
    .trade-steps li:nth-child(n + 3) { border-top: 1px solid rgb(244 236 225 / 14%); }
    .rules-intro { position: static; }
    .batch-note { align-items: flex-start; grid-template-columns: 60px 1fr; }
    .batch-note .button { grid-column: 2; justify-self: start; }
  }
  @media (max-width: 650px) {
    .hero-grid { min-height: auto; padding-block: 55px 70px; }
    .safety-nav a { justify-content: flex-start; }
    .evidence-grid,
    .review-grid,
    .trade-steps { grid-template-columns: 1fr; }
    .trade-steps li,
    .trade-steps li:not(:first-child) { padding: 25px 0; border-right: 0; border-top: 1px solid rgb(244 236 225 / 14%); }
    .trade-steps li:first-child { border-top: 0; }
    .batch-note { grid-template-columns: 1fr; }
    .batch-note .button { grid-column: 1; white-space: normal; }
    .rule-list article { grid-template-columns: 58px 1fr; gap: 13px; }
    .report-form { padding: 22px; }
  }
</style>
