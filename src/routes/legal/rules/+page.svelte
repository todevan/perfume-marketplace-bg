<script lang="ts">
  import { ArrowLeft, Ban, Check, TriangleAlert } from '@lucide/svelte';

  const allowed = [
    'Един оригинален retail флакон, tester или официална мостра в една обява.',
    'Собствени актуални снимки, точно количество, дефекти и реален тип сделка.',
    'Коректно деклариран частен или търговски статус.',
    'Спокойна комуникация и договорка в отключения след приета оферта чат.'
  ];

  const forbidden = [
    'Фалшификати, реплики, преливани аромати, decants, splits, масла и gift sets.',
    'Чужди или подвеждащи снимки, скрит дефект и невярно количество.',
    'Натиск за плащане, phishing, спам, тормоз или заобикаляне на ограничение.',
    'Твърдение за доказана автентичност само заради batch code или профилен рейтинг.'
  ];
</script>

<svelte:head>
  <title>Правила на marketplace — временна продуктова чернова</title>
  <meta name="description" content="Правила за допустими парфюми, обяви, доказателства и поведение." />
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<section class="document-page">
  <div class="container narrow">
    <a class="back" href="/legal"><ArrowLeft size={16} /> Всички документи</a>
    <div class="warning"><TriangleAlert size={19} /><span>Одобрена от собственика временна продуктова чернова. Не е прегледана или одобрена от адвокат. Преди публичното или търговското стартиране е задължителен преглед от квалифициран български адвокат.</span></div>
    <span class="eyebrow">MARKETPLACE RULES / 2026-08-24-provisional.1 / 24.08.2026</span>
    <h1>Точна обява.<br /><em>Честна договорка.</em></h1>
    <p class="lead">Правилата важат за частни лица и търговци. Платформата може да паузира съдържание, да поиска доказателства и да ограничи профил при риск или нарушение.</p>

    <div class="rules-grid">
      <section class="rule-card allowed"><h2><Check size={22} /> Допустимо</h2><ul>{#each allowed as item}<li>{item}</li>{/each}</ul></section>
      <section class="rule-card forbidden"><h2><Ban size={22} /> Забранено</h2><ul>{#each forbidden as item}<li>{item}</li>{/each}</ul></section>
    </div>

    <section class="copy">
      <h2>Доказателства и автентичност</h2>
      <p>За активиране са нужни поне четири различни снимки според формата на продукта. Статусът „Доказателствата са прегледани“ описва преглед на видимите материали и никога не е гаранция за оригиналност.</p>
      <h2>Оферти, чат и сделка</h2>
      <p>Офертата е неподвързващо намерение. Приемането резервира обявата и отключва частен текстов чат. Продавачът отбелязва сделката като приключена. Преди приключването всеки от участниците може да я откаже, като посочи причина, която се запазва в платформата. Само приключените от продавача сделки отключват възможност за отзив; отменените сделки не отключват отзив.</p>
      <h2>Сигнали и последствия</h2>
      <p>Сигналите се разглеждат според риска. Възможните мерки включват искане за корекция, пауза или премахване на обява и временно или постоянно ограничаване на профил. Решенията подлежат на описания процес за обжалване.</p>
    </section>
  </div>
</section>

<style>
  .document-page { min-height: 80vh; padding: clamp(3rem, 8vw, 7rem) 0; }
  .narrow { max-width: 980px; }
  .back { display: inline-flex; min-height: 44px; align-items: center; gap: .45rem; margin-bottom: 2rem; color: var(--ink-soft); }
  .warning { display: flex; align-items: flex-start; gap: .65rem; margin-bottom: 2.5rem; padding: 1rem; border: 1px solid rgb(141 47 54 / 28%); border-radius: var(--radius-sm); color: var(--danger); background: rgb(141 47 54 / 6%); font-size: .78rem; font-weight: 700; }
  .warning :global(svg) { flex: 0 0 auto; }
  h1 { margin: .6rem 0 1.4rem; }
  h1 em { color: var(--action); }
  .lead { max-width: 740px; color: var(--ink-soft); font-size: 1.02rem; }
  .rules-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 3rem 0; }
  .rule-card { padding: clamp(1.4rem, 4vw, 2.2rem); border: 1px solid var(--line); border-radius: var(--radius-md); background: rgb(255 253 249 / 68%); }
  .rule-card h2 { display: flex; align-items: center; gap: .6rem; font-size: 1.45rem; }
  .rule-card.allowed h2 { color: var(--success); }
  .rule-card.forbidden h2 { color: var(--danger); }
  .rule-card ul { display: grid; gap: .9rem; margin: 1.4rem 0 0; padding-left: 1.2rem; color: var(--ink-soft); }
  .copy { display: grid; gap: .7rem; padding-top: 2rem; border-top: 1px solid var(--line); }
  .copy h2 { margin-top: 1.8rem; }
  .copy p { max-width: 780px; color: var(--ink-soft); }
  @media (max-width: 700px) { .rules-grid { grid-template-columns: 1fr; } }
</style>
