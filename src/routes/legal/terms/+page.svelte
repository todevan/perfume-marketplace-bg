<script lang="ts">
  import { ArrowLeft, Check, CircleAlert, FileText, Gavel, Scale, TriangleAlert } from '@lucide/svelte';

  const sections = [
    ['role', '1. Роля на платформата'],
    ['accounts', '2. Профили и възраст'],
    ['listings', '3. Обяви и стоки'],
    ['offers', '4. Оферти и сделки'],
    ['traders', '5. Търговци'],
    ['trust', '6. Доверие'],
    ['moderation', '7. Модерация'],
    ['fees', '8. Такси'],
    ['liability', '9. Отговорност'],
    ['contact', '10. Контакт']
  ];
</script>

<svelte:head>
  <title>Условия за използване — временна продуктова чернова</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<section class="document-hero">
  <div class="container">
    <a class="back-link" href="/legal"><ArrowLeft size={16} /> Всички документи</a>
    <div class="hero-grid">
      <div><span class="draft-pill"><TriangleAlert size={16} /> Временна продуктова чернова</span><h1>Условия за използване</h1><p>Одобрена от собственика временна продуктова чернова. Не е прегледана или одобрена от адвокат.</p></div>
      <div class="doc-meta"><Gavel size={33} /><dl><div><dt>Версия</dt><dd>2026-08-24-provisional.1</dd></div><div><dt>Дата</dt><dd>24.08.2026</dd></div><div><dt>Приложимост</dt><dd>Текущ продукт</dd></div><div><dt>Одобрение</dt><dd>Собственик — временно</dd></div></dl></div>
    </div>
  </div>
</section>

<div class="legal-warning"><div class="container"><CircleAlert size={20} /><p><strong>Текстът не е правно финален.</strong> Преди публичното или търговското стартиране е задължителен преглед от квалифициран български адвокат.</p></div></div>

<section class="document-body section">
  <div class="container body-grid">
    <aside class="toc"><span>CONTENTS / 10</span><nav aria-label="Съдържание">{#each sections as section}<a href={`#${section[0]}`}>{section[1]}</a>{/each}</nav><a class="privacy-link" href="/legal/privacy"><FileText size={15} /> Политика за поверителност</a></aside>

    <article class="legal-copy">
      <div class="placeholder"><Scale size={20} /><div><strong>Липсващи задължителни данни</strong><p>[Име на дружество], [ЕИК], [седалище и адрес], [имейл за контакт], [канал за notice-and-action] и [компетентен съд].</p></div></div>

      <section id="role"><span>01</span><h2>Роля на платформата</h2><p>Платформата предоставя дигитално място, в което частни лица и търговци могат да публикуват обяви, да изпращат неподвързващи оферти и да общуват. В beta платформата не е продавач, купувач, платежен посредник или куриер по сделката за парфюм.</p><p>Страните сами договарят цената, размяната, плащането, доставката и прегледа. Това разграничение подлежи на правно потвърждение.</p></section>

      <section id="accounts"><span>02</span><h2>Профили, възраст и сигурност</h2><p>Разглеждането е свободно. Нормалният потребител се регистрира с имейл и парола, потвърждава имейла си и завършва въвеждането в платформата. Не се изискват покана, списък на чакащи, потвърждение на телефон или SMS код. Създаването на обява, оферта или съобщение изисква завършен профил и декларация за навършени 18 години. Потребителят пази данните си за достъп и не използва профила за заобикаляне на ограничение.</p></section>

      <section id="listings"><span>03</span><h2>Обяви и допустими стоки</h2><p>Една продаваща обява описва един физически продукт. В beta са допустими оригинални нови и употребявани флакони, тестери и официални мостри. Gift sets, пакети, decants, splits и attar/CPO масла не са допуснати.</p><p>Обявата трябва да показва точните марка, име, концентрация, оригинален обем, остатък, състояние, дефекти, цена/вид сделка и поне четири собствени снимки. Фалшификати, копирани снимки и подвеждащи твърдения са забранени.</p></section>

      <section id="offers"><span>04</span><h2>Оферти, чат и потвърждени сделки</h2><p>Структурираната оферта е неподвързващо изразяване на интерес. Приемането резервира обявата и отваря възможност за договорка, но не създава автоматично задължение за покупка.</p><p>Продавачът отбелязва сделката като приключена. Преди приключването всеки от участниците може да я откаже, като посочи причина, която се запазва в платформата. Само приключените от продавача сделки отключват възможност за отзив; отменените сделки не отключват отзив. Общите профилни коментари не влияят на рейтинга.</p></section>

      <section id="traders"><span>05</span><h2>Частни лица и търговци</h2><p>Всеки, който действа като търговец, трябва да декларира статуса си и да предостави изискуемата преддоговорна и следпродажбена информация. „Проверен търговец“ е ръчен и безплатен статус, отделен от всяка платена услуга и без гаранция за всяка отделна стока.</p></section>

      <section id="trust"><span>06</span><h2>Доказателства и автентичност</h2><p>Статусът „Доказателствата са прегледани“ означава само, че видимите материали са прегледани по рисков процес. Той не е сертификат или гаранция за автентичност. Валиден batch code или добър профилен рейтинг също не са самостоятелни доказателства.</p></section>

      <section id="moderation"><span>07</span><h2>Сигнали, модерация и обжалване</h2><p>Платформата може да поиска допълнителни данни, да ограничи видимостта, да спре обява или профил и да запази нужни доказателства. Модераторски достъп до чат е допустим само при активен case и със задължителен audit log.</p><p>Засегнатият потребител трябва да получи ясно основание и достъпен канал за обжалване, освен когато законът не позволява това.</p></section>

      <section id="fees"><span>08</span><h2>Безплатна beta и бъдещи такси</h2><p>В затворената beta платените функции са изключени. Планираните бъдещи услуги включват допълнителна активна обява, търговски планове и boost. Цените, правото на отказ/refund, фактурирането и платежният доставчик трябва да бъдат описани в отделна, одобрена версия преди активирането им.</p></section>

      <section id="liability"><span>09</span><h2>Достъпност и отговорност</h2><p>Платформата се стреми към точна и достъпна услуга, но beta може да има прекъсвания и промени. Клаузите за отговорност, обезщетение, непреодолима сила, приложимо право и компетентен съд са задължително за изготвяне от адвокат и не са фиксирани с тази чернова.</p></section>

      <section id="contact"><span>10</span><h2>Контакт, сигнали и промени</h2><p>Работни полета за попълване преди launch: <strong>[общ имейл]</strong>, <strong>[имейл за поверителност]</strong>, <strong>[канал за сигнали]</strong>, <strong>[адрес]</strong> и <strong>[процес за обжалване]</strong>. Съществените промени в условията трябва да бъдат съобщавани по ясен и правно прегледан начин.</p></section>

      <div class="review-checklist"><h2>Задължителен пред-launch преглед</h2><ul><li><Check size={17} /> DSA notice-and-action, мотиви и обжалване</li><li><Check size={17} /> GPSR и информация за търговци/продукти</li><li><Check size={17} /> Trader/private деклариране и потребителски права</li><li><Check size={17} /> DAC7 приложимост и отчитане</li><li><Check size={17} /> Платени услуги, refund и фактуриране</li></ul></div>
    </article>
  </div>
</section>

<footer class="document-footer"><div class="container"><TriangleAlert size={24} /><div><strong>Този текст остава временна продуктова чернова.</strong><p>Професионалният правен преглед е задължителна стъпка преди публичното или търговското стартиране.</p></div></div></footer>

<style>
  .document-hero { padding-block: 44px 68px; border-bottom: 1px solid var(--line); }
  .back-link { display: inline-flex; min-height: 44px; align-items: center; gap: 7px; margin-bottom: 32px; color: var(--ink-soft); font-size: .74rem; font-weight: 700; }
  .hero-grid { display: grid; align-items: end; grid-template-columns: 1.2fr .55fr; gap: clamp(45px, 8vw, 120px); }
  .draft-pill { display: inline-flex; align-items: center; gap: 7px; margin-bottom: 19px; padding: 6px 10px; border: 1px solid rgb(141 47 54 / 32%); border-radius: 999px; color: var(--danger); background: rgb(141 47 54 / 6%); font-size: .67rem; font-weight: 700; }
  h1 { max-width: 900px; margin-bottom: 20px; font-size: clamp(3.1rem, 7vw, 6.3rem); }
  .hero-grid > div:first-child > p { max-width: 760px; margin: 0; color: var(--ink-soft); }
  .doc-meta { display: grid; grid-template-columns: 42px 1fr; gap: 15px; padding: 22px; border: 1px solid var(--line); border-radius: var(--radius-md); background: rgb(255 253 249 / 64%); }
  .doc-meta > :global(svg) { color: var(--action); }
  .doc-meta dl { display: grid; gap: 9px; margin: 0; }
  .doc-meta dl div { display: flex; justify-content: space-between; gap: 10px; padding-bottom: 8px; border-bottom: 1px solid rgb(138 121 103 / 18%); }
  .doc-meta dl div:last-child { padding: 0; border: 0; }
  .doc-meta dt { color: var(--ink-faint); font-size: .62rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .doc-meta dd { margin: 0; font-size: .69rem; font-weight: 700; text-align: right; }
  .legal-warning { padding-block: 16px; color: var(--danger); background: rgb(141 47 54 / 7%); }
  .legal-warning .container { display: grid; align-items: start; grid-template-columns: 27px 1fr; gap: 9px; }
  .legal-warning p { margin: 0; color: var(--ink-soft); font-size: .71rem; }
  .body-grid { display: grid; align-items: start; grid-template-columns: 240px minmax(0, 790px); gap: clamp(45px, 8vw, 105px); justify-content: center; }
  .toc { position: sticky; top: calc(var(--header-height) + 25px); }
  .toc > span { display: block; padding-bottom: 13px; border-bottom: 1px solid var(--line-strong); color: var(--ink-faint); font-size: .62rem; font-weight: 700; letter-spacing: .14em; }
  .toc nav { display: grid; }
  .toc nav a { min-height: 44px; padding: 10px 4px; border-bottom: 1px solid rgb(138 121 103 / 19%); color: var(--ink-soft); font-size: .72rem; font-weight: 700; }
  .toc nav a:hover { color: var(--ink); padding-left: 9px; }
  .privacy-link { display: flex; align-items: center; gap: 7px; margin-top: 18px; color: var(--action); font-size: .69rem; font-weight: 700; }
  .placeholder { display: grid; grid-template-columns: 28px 1fr; gap: 10px; margin-bottom: 55px; padding: 19px; border: 1px dashed var(--danger); border-radius: var(--radius-sm); color: var(--danger); background: rgb(141 47 54 / 5%); }
  .placeholder strong { font-size: .74rem; }
  .placeholder p { margin: 4px 0 0; color: var(--ink-soft); font-size: .7rem; }
  .legal-copy > section { position: relative; padding: 0 0 58px 62px; scroll-margin-top: 145px; }
  .legal-copy > section > span { position: absolute; top: 5px; left: 0; color: var(--ink-faint); font-size: .64rem; font-weight: 700; letter-spacing: .15em; }
  .legal-copy > section::before { position: absolute; top: 28px; bottom: 12px; left: 8px; width: 1px; background: var(--line); content: ''; }
  .legal-copy h2 { margin-bottom: 18px; font-size: clamp(1.65rem, 3vw, 2.3rem); }
  .legal-copy p { color: var(--ink-soft); }
  .legal-copy p strong { color: var(--ink); }
  .review-checklist { padding: 27px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--brand-main); }
  .review-checklist h2 { font-size: 1.45rem; }
  .review-checklist ul { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }
  .review-checklist li { display: flex; align-items: center; gap: 8px; color: var(--ink-soft); font-size: .76rem; font-weight: 700; }
  .review-checklist :global(svg) { color: var(--success); }
  .document-footer { padding-block: 27px; color: var(--danger); background: rgb(141 47 54 / 8%); }
  .document-footer .container { display: grid; align-items: start; grid-template-columns: 32px 1fr; gap: 10px; }
  .document-footer strong { font-size: .78rem; }
  .document-footer p { margin: 3px 0 0; color: var(--ink-soft); font-size: .7rem; }
  @media (max-width: 900px) { .hero-grid { grid-template-columns: 1fr; } .doc-meta { max-width: 550px; } .body-grid { grid-template-columns: 1fr; } .toc { position: static; } .toc nav { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 560px) { .document-hero { padding-top: 30px; } .toc nav { grid-template-columns: 1fr; } .legal-copy > section { padding-left: 35px; } }
</style>
