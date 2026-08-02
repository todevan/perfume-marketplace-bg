<script lang="ts">
  import {
    ArrowLeft,
    Check,
    CircleAlert,
    Database,
    Eye,
    FileText,
    KeyRound,
    LockKeyhole,
    ShieldCheck,
    TriangleAlert,
    UserRound
  } from '@lucide/svelte';

  const sections = [
    ['controller', '1. Администратор'],
    ['data', '2. Какви данни'],
    ['purposes', '3. Цели и основания'],
    ['visibility', '4. Видимост'],
    ['recipients', '5. Получатели'],
    ['retention', '6. Срокове'],
    ['rights', '7. Права'],
    ['security', '8. Сигурност'],
    ['cookies', '9. Cookies'],
    ['contact', '10. Контакт']
  ];
</script>

<svelte:head>
  <title>Политика за поверителност — работна чернова</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<section class="document-hero">
  <div class="container">
    <a class="back-link" href="/legal"><ArrowLeft size={16} /> Всички документи</a>
    <div class="hero-grid">
      <div><span class="draft-pill"><TriangleAlert size={16} /> Неодобрена GDPR чернова</span><h1>Политика за поверителност</h1><p>Работна карта на данните за затворената beta. Текстът не е правен съвет, не е одобрен от адвокат и не трябва да бъде публикуван като финална политика.</p></div>
      <div class="privacy-mark" aria-hidden="true"><LockKeyhole size={48} strokeWidth={1.25} /><span>PRIVACY MAP</span><strong>DRAFT / 0.1</strong><i>controller pending</i></div>
    </div>
  </div>
</section>

<div class="legal-warning"><div class="container"><CircleAlert size={20} /><p><strong>Работните срокове и правни основания не са финални.</strong> Те трябва да следват от реалните цели, схемата, доставчиците, счетоводните задължения и одобрена retention policy.</p></div></div>

<section class="document-body section">
  <div class="container body-grid">
    <aside class="toc"><span>CONTENTS / 10</span><nav aria-label="Съдържание">{#each sections as section}<a href={`#${section[0]}`}>{section[1]}</a>{/each}</nav><a class="terms-link" href="/legal/terms"><FileText size={15} /> Условия за използване</a></aside>

    <article class="legal-copy">
      <div class="placeholder"><UserRound size={20} /><div><strong>Непопълнен администратор</strong><p>[Име на дружество], [ЕИК], [адрес], [имейл за поверителност], [лице за контакт/DPO, ако е приложимо].</p></div></div>

      <section id="controller"><span>01</span><h2>Кой отговаря за данните</h2><p>Администраторът определя целите и средствата за обработване на личните данни в marketplace-а. Финалният текст трябва да съдържа пълните му данни и канал за искания. Полетата по-горе са блокиращи за публичен launch.</p></section>

      <section id="data"><span>02</span><h2>Какви категории данни са планирани</h2><div class="data-grid"><article><UserRound size={21} /><strong>Профил и контакт</strong><p>Username, имейл, телефон, град, възрастова декларация и настройки.</p></article><article><Database size={21} /><strong>Съдържание</strong><p>Обяви, снимки, описания, оферти, чат, отзиви, коментари и сигнали.</p></article><article><ShieldCheck size={21} /><strong>Доверие и модерация</strong><p>Потвърждения, документи за търговец, case history, мотиви и audit log.</p></article><article><KeyRound size={21} /><strong>Технически данни</strong><p>IP, устройство, времеви маркери, login събития, security logs и Turnstile сигнали.</p></article></div><p>Снимките се re-encode-ват и EXIF метаданните се премахват преди публикуване по план. Това подлежи на технически тест.</p></section>

      <section id="purposes"><span>03</span><h2>Цели и работни правни основания</h2><div class="purpose-table" role="table" aria-label="Цели и основания"><div class="table-head" role="row"><span role="columnheader">Цел</span><span role="columnheader">Работно основание</span></div><div role="row"><span role="cell">Профил, обяви, оферти и чат</span><span role="cell">Изпълнение на услугата/договора</span></div><div role="row"><span role="cell">Сигурност, спам, измами и модерация</span><span role="cell">Законен интерес; нужен balancing test</span></div><div role="row"><span role="cell">Задължителни фирмени, данъчни и notice records</span><span role="cell">Правно задължение; законът трябва да е указан</span></div><div role="row"><span role="cell">Незадължителен маркетинг</span><span role="cell">Съгласие, оттегляемо по всяко време</span></div></div><p>Всяка цел и основание трябва да бъдат потвърдени спрямо реалния data flow и договорите с доставчици.</p></section>

      <section id="visibility"><span>04</span><h2>Какво е публично и какво е скрито</h2><div class="visibility-grid"><div><Eye size={22} /><strong>Публично</strong><p>Username/име на витрина, град, обяви, профилно описание, рейтинг, потвърдени сделки и общи коментари.</p></div><div><LockKeyhole size={22} /><strong>Непублично</strong><p>Имейл, телефон, чернови, чат, verification документи, moderation cases и технически логове.</p></div></div><p>Модераторският достъп до чат се планира само при активен report case, ограничени роли и задължителен audit log.</p></section>

      <section id="recipients"><span>05</span><h2>Получатели и доставчици</h2><p>Работната архитектура предвижда Cloudflare за hosting/security, Supabase за база, authentication, storage и realtime, Resend за имейл и [неизбран SMS доставчик] за телефонна проверка. Платежните функции са изключени в beta; преди активиране трябва да се опишат myPOS и евентуалният Stripe fallback.</p><p>За всеки доставчик трябва да се документират ролята, категориите данни, местоположението, правните механизми за трансфер и съответното договорно покритие.</p></section>

      <section id="retention"><span>06</span><h2>Срокове за съхранение</h2><p><strong>Няма одобрени срокове.</strong> Преди launch трябва да бъде приета retention schedule за активни и закрити профили, обяви и снимки, чат, оферти, сделки, отзиви, сигнали, verification документи, логове и бекъпи.</p><p>Сроковете следва да бъдат обвързани с целта, правното задължение, давността и нуждата от защита при спор, а не да се поставят произволно.</p></section>

      <section id="rights"><span>07</span><h2>Права на субектите на данни</h2><ul class="rights-list"><li><Check size={17} /> Достъп до личните данни и копие</li><li><Check size={17} /> Коригиране на неточни данни</li><li><Check size={17} /> Изтриване и ограничаване, когато са приложими</li><li><Check size={17} /> Преносимост за подходящите данни</li><li><Check size={17} /> Възражение срещу законен интерес и директен маркетинг</li><li><Check size={17} /> Оттегляне на съгласието за в бъдеще</li><li><Check size={17} /> Жалба до компетентния надзорен орган</li></ul><p>Финалният документ трябва да опише как се подава искане, как се потвърждава самоличността, какви са сроковете и в кои случаи правото е ограничено.</p></section>

      <section id="security"><span>08</span><h2>Мерки за сигурност и инциденти</h2><p>Планираните мерки включват Row Level Security, минимални служебни права, одитни записи, ограничен модераторски достъп, потвържден имейл и телефон, rate limits, Turnstile, валидиране на качваните файлове и премахване на EXIF.</p><p>Преди launch са нужни оценка на риска, incident-response процес, backup/restore тест, процедура за data breach и преценка дали е нужна DPIA.</p></section>

      <section id="cookies"><span>09</span><h2>Cookies, local storage и анализ</h2><p>Задължителните authentication/security cookies следва да бъдат описани по име, доставчик, цел и срок. Незадължителните analytics/marketing технологии не трябва да се активират, преди да има избран и правно оценен доставчик, consent UI и лесно оттегляне.</p></section>

      <section id="contact"><span>10</span><h2>Контакт и актуализации</h2><p>Исканията се планира да се изпращат до <strong>[имейл за поверителност]</strong> или чрез <strong>[форма в профила]</strong>. Тук трябва да бъдат посочени и данните за надзорния орган. Съществените промени в обработването трябва да водят до актуализирана политика и подходящо уведомяване.</p></section>

      <div class="review-checklist"><h2>Преди публикуване</h2><ul><li><Check size={17} /> Съпостави текста с живата data schema и RLS политиките</li><li><Check size={17} /> Попълни администратора и всички доставчици</li><li><Check size={17} /> Приеми retention schedule и процес за искания</li><li><Check size={17} /> Документирай трансферите и processor agreements</li><li><Check size={17} /> Правен, security и product sign-off</li></ul></div>
    </article>
  </div>
</section>

<footer class="document-footer"><div class="container"><TriangleAlert size={24} /><div><strong>Не е правен съвет и не е финална политика.</strong><p>Черновата трябва да бъде сверена с реалната система и одобрена от квалифициран български адвокат.</p></div></div></footer>

<style>
  .document-hero { padding-block: 44px 68px; border-bottom: 1px solid var(--line); }
  .back-link { display: inline-flex; min-height: 44px; align-items: center; gap: 7px; margin-bottom: 32px; color: var(--ink-soft); font-size: .74rem; font-weight: 700; }
  .hero-grid { display: grid; align-items: center; grid-template-columns: 1.15fr .5fr; gap: clamp(45px, 8vw, 120px); }
  .draft-pill { display: inline-flex; align-items: center; gap: 7px; margin-bottom: 19px; padding: 6px 10px; border: 1px solid rgb(141 47 54 / 32%); border-radius: 999px; color: var(--danger); background: rgb(141 47 54 / 6%); font-size: .67rem; font-weight: 700; }
  h1 { max-width: 920px; margin-bottom: 20px; font-size: clamp(3rem, 6.7vw, 6.1rem); }
  .hero-grid > div:first-child > p { max-width: 770px; margin: 0; color: var(--ink-soft); }
  .privacy-mark { position: relative; display: grid; width: min(100%, 320px); min-height: 330px; place-items: center; align-content: center; gap: 15px; justify-self: end; overflow: hidden; border: 1px solid var(--line-strong); border-radius: var(--radius-lg); color: var(--action); background: var(--paper-deep); }
  .privacy-mark::before,
  .privacy-mark::after { position: absolute; border: 1px solid rgb(74 49 38 / 13%); border-radius: 50%; content: ''; }
  .privacy-mark::before { width: 260px; height: 260px; }
  .privacy-mark::after { width: 205px; height: 205px; }
  .privacy-mark > * { z-index: 1; }
  .privacy-mark span,
  .privacy-mark strong { font-size: .68rem; font-weight: 700; letter-spacing: .15em; }
  .privacy-mark i { color: var(--ink-soft); font-size: .65rem; }
  .legal-warning { padding-block: 16px; color: var(--danger); background: rgb(141 47 54 / 7%); }
  .legal-warning .container { display: grid; align-items: start; grid-template-columns: 27px 1fr; gap: 9px; }
  .legal-warning p { margin: 0; color: var(--ink-soft); font-size: .71rem; }
  .body-grid { display: grid; align-items: start; grid-template-columns: 240px minmax(0, 800px); gap: clamp(45px, 8vw, 105px); justify-content: center; }
  .toc { position: sticky; top: calc(var(--header-height) + 25px); }
  .toc > span { display: block; padding-bottom: 13px; border-bottom: 1px solid var(--line-strong); color: var(--ink-faint); font-size: .62rem; font-weight: 700; letter-spacing: .14em; }
  .toc nav { display: grid; }
  .toc nav a { min-height: 44px; padding: 10px 4px; border-bottom: 1px solid rgb(138 121 103 / 19%); color: var(--ink-soft); font-size: .72rem; font-weight: 700; }
  .toc nav a:hover { color: var(--ink); padding-left: 9px; }
  .terms-link { display: flex; align-items: center; gap: 7px; margin-top: 18px; color: var(--action); font-size: .69rem; font-weight: 700; }
  .placeholder { display: grid; grid-template-columns: 28px 1fr; gap: 10px; margin-bottom: 55px; padding: 19px; border: 1px dashed var(--danger); border-radius: var(--radius-sm); color: var(--danger); background: rgb(141 47 54 / 5%); }
  .placeholder strong { font-size: .74rem; }
  .placeholder p { margin: 4px 0 0; color: var(--ink-soft); font-size: .7rem; }
  .legal-copy > section { position: relative; padding: 0 0 58px 62px; scroll-margin-top: 145px; }
  .legal-copy > section > span { position: absolute; top: 5px; left: 0; color: var(--ink-faint); font-size: .64rem; font-weight: 700; letter-spacing: .15em; }
  .legal-copy > section::before { position: absolute; top: 28px; bottom: 12px; left: 8px; width: 1px; background: var(--line); content: ''; }
  .legal-copy h2 { margin-bottom: 18px; font-size: clamp(1.65rem, 3vw, 2.3rem); }
  .legal-copy p { color: var(--ink-soft); }
  .legal-copy p strong { color: var(--ink); }
  .data-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px; }
  .data-grid article { padding: 18px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: rgb(255 253 249 / 55%); }
  .data-grid article > :global(svg) { margin-bottom: 18px; color: var(--action); }
  .data-grid strong { display: block; font-size: .76rem; }
  .data-grid p { margin: 5px 0 0; font-size: .72rem; }
  .purpose-table { margin-bottom: 19px; border: 1px solid var(--line); border-radius: var(--radius-sm); overflow: hidden; }
  .purpose-table > div { display: grid; grid-template-columns: 1fr .9fr; }
  .purpose-table > div span { padding: 13px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); color: var(--ink-soft); font-size: .72rem; }
  .purpose-table > div span:last-child { border-right: 0; }
  .purpose-table > div:last-child span { border-bottom: 0; }
  .purpose-table .table-head span { color: var(--ink); background: var(--brand-main); font-size: .65rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .visibility-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 13px; margin-bottom: 20px; }
  .visibility-grid > div { padding: 21px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: rgb(255 253 249 / 55%); }
  .visibility-grid > div > :global(svg) { margin-bottom: 17px; color: var(--action); }
  .visibility-grid strong { display: block; font-size: .8rem; }
  .visibility-grid p { margin: 5px 0 0; font-size: .73rem; }
  .rights-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 0 0 22px; padding: 0; list-style: none; }
  .rights-list li { display: flex; align-items: flex-start; gap: 7px; padding: 11px; border: 1px solid rgb(47 107 79 / 20%); border-radius: 8px; color: var(--ink-soft); background: rgb(47 107 79 / 5%); font-size: .72rem; font-weight: 700; }
  .rights-list li > :global(svg) { flex: 0 0 auto; color: var(--success); }
  .review-checklist { padding: 27px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--brand-main); }
  .review-checklist h2 { font-size: 1.45rem; }
  .review-checklist ul { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }
  .review-checklist li { display: flex; align-items: center; gap: 8px; color: var(--ink-soft); font-size: .76rem; font-weight: 700; }
  .review-checklist li > :global(svg) { color: var(--success); }
  .document-footer { padding-block: 27px; color: var(--danger); background: rgb(141 47 54 / 8%); }
  .document-footer .container { display: grid; align-items: start; grid-template-columns: 32px 1fr; gap: 10px; }
  .document-footer strong { font-size: .78rem; }
  .document-footer p { margin: 3px 0 0; color: var(--ink-soft); font-size: .7rem; }
  @media (max-width: 900px) { .hero-grid { grid-template-columns: 1fr; } .privacy-mark { justify-self: center; } .body-grid { grid-template-columns: 1fr; } .toc { position: static; } .toc nav { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 580px) { .document-hero { padding-top: 30px; } .toc nav, .data-grid, .visibility-grid, .rights-list { grid-template-columns: 1fr; } .legal-copy > section { padding-left: 35px; } .purpose-table > div { grid-template-columns: 1fr; } .purpose-table > div span { border-right: 0; } .privacy-mark { width: calc(100% - 20px); min-height: 300px; } }
</style>
