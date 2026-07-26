<script lang="ts">
  import { ArrowLeft, Clock3, FileSearch, Scale, Send, TriangleAlert } from '@lucide/svelte';

  const steps = [
    { icon: FileSearch, title: 'Посочи решението', copy: 'Добави номера на сигнала или решението и конкретното съдържание или профил.' },
    { icon: Send, title: 'Представи факти', copy: 'Опиши защо решението е неправилно и приложи само относими доказателства.' },
    { icon: Clock3, title: 'Независим преглед', copy: 'Друг служител преглежда случая, когато е практически възможно, и записва мотивите.' },
    { icon: Scale, title: 'Мотивиран резултат', copy: 'Получаваш потвърждение, промяна или отмяна на решението и достъпните следващи стъпки.' }
  ];
</script>

<svelte:head>
  <title>Обжалване на решение — beta чернова</title>
  <meta name="description" content="Процес за обжалване на модераторски решения в затворената beta." />
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<section class="appeals-page">
  <div class="container narrow">
    <a class="back" href="/legal"><ArrowLeft size={16} /> Всички документи</a>
    <div class="warning"><TriangleAlert size={19} /><span>Работна beta чернова — сроковете и контактът трябва да бъдат одобрени преди външна покана.</span></div>
    <span class="eyebrow">APPEALS / DRAFT</span>
    <h1>Всяко решение има<br /><em>ясна следа.</em></h1>
    <p class="lead">Потребителят може да поиска повторен преглед на премахната обява, ограничен профил или друго модераторско решение. Подаването на жалба не отменя незабавна мярка за безопасност.</p>

    <ol class="steps">
      {#each steps as step, index}
        <li><span>{String(index + 1).padStart(2, '0')}</span><svelte:component this={step.icon} size={24} /><div><h2>{step.title}</h2><p>{step.copy}</p></div></li>
      {/each}
    </ol>

    <section class="contact">
      <h2>Канал и срок</h2>
      <p>В production интерфейсът използва идентификатора на модераторското решение и създава audit запис. Работният срок за първоначален отговор е <strong>[за правно и оперативно одобрение]</strong>, а официалният контакт е <strong>[INCIDENT_CONTACT_EMAIL]</strong>.</p>
      <p>Съдържание може да бъде запазено за доказателства и законови задължения дори когато вече не е публично. Достъпът остава ограничен според случая.</p>
    </section>
  </div>
</section>

<style>
  .appeals-page { min-height: 80vh; padding: clamp(3rem, 8vw, 7rem) 0; }
  .narrow { max-width: 920px; }
  .back { display: inline-flex; min-height: 44px; align-items: center; gap: .45rem; margin-bottom: 2rem; color: var(--ink-soft); }
  .warning { display: flex; align-items: flex-start; gap: .65rem; margin-bottom: 2.5rem; padding: 1rem; border: 1px solid rgb(141 47 54 / 28%); border-radius: var(--radius-sm); color: var(--danger); background: rgb(141 47 54 / 6%); font-size: .78rem; font-weight: 700; }
  .warning :global(svg) { flex: 0 0 auto; }
  h1 { margin: .6rem 0 1.4rem; }
  h1 em { color: var(--action); }
  .lead { max-width: 740px; color: var(--ink-soft); font-size: 1.02rem; }
  .steps { margin: 3rem 0; padding: 0; border-top: 1px solid var(--line-strong); list-style: none; }
  .steps li { display: grid; align-items: start; grid-template-columns: 40px 36px 1fr; gap: 1rem; padding: 1.6rem 0; border-bottom: 1px solid var(--line); }
  .steps li > span { color: var(--ink-faint); font-size: .66rem; font-weight: 700; letter-spacing: .12em; }
  .steps li > :global(svg) { color: var(--action); }
  .steps h2 { margin: 0 0 .35rem; font-size: 1.25rem; }
  .steps p, .contact p { margin: 0; color: var(--ink-soft); }
  .contact { padding: clamp(1.4rem, 4vw, 2.2rem); border-radius: var(--radius-md); background: var(--brand-tertiary); }
  .contact h2 { margin-top: 0; }
  .contact p + p { margin-top: 1rem; }
  @media (max-width: 560px) { .steps li { grid-template-columns: 28px 30px 1fr; gap: .65rem; } }
</style>
