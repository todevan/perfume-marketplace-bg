<script lang="ts">
  import { ArrowLeft, BadgeCheck, Check, FileLock2, Landmark, ShieldCheck } from '@lucide/svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let application = $derived(form?.application ?? data.application);
  const locked = $derived(Boolean(application && ['submitted', 'under_review', 'approved'].includes(application.status)));
  const statusLabel: Record<string, string> = { draft: 'Чернова', submitted: 'Изпратена', under_review: 'В ръчен преглед', approved: 'Одобрена', rejected: 'Отказана', withdrawn: 'Оттеглена' };
</script>

<svelte:head><title>Кандидатстване за търговец · Marketplace beta</title><meta name="description" content="Безплатна ръчна проверка на търговски профил." /><meta name="robots" content="noindex,nofollow" /></svelte:head>

<section class="application-hero"><div class="container hero-grid"><div><a class="back" href="/merchants"><ArrowLeft size={16} /> Към търговците</a><span class="eyebrow">Затворена beta</span><h1>Кандидатствай за <em>търговски профил.</em></h1><p>Търговският статус и провереният знак са ръчни, безплатни и напълно отделени от бъдещи VIP услуги.</p></div><aside><BadgeCheck size={38} /><h2>Прозрачност пред общността</h2><p>Публично се показват само одобрените търговски данни. Документни upload-и са изключени в beta.</p></aside></div></section>

<section class="application-body"><div class="container layout"><aside class="trust"><ShieldCheck size={24} /><div><strong>Минимални данни</strong><p>Събираме юридическо име, ЕИК, адрес, сайт и декларация. Не изпращай лична карта или фирмени документи през чат.</p></div></aside><div>
  {#if form?.error}<p class="notice error" role="alert">{form.error.message}</p>{/if}
  {#if form?.ok}<p class="notice success" role="status">{form.submitted ? 'Кандидатурата е изпратена за ръчен преглед.' : form.withdrawn ? 'Кандидатурата е оттеглена.' : 'Черновата е запазена.'}</p>{/if}

  {#if locked && application}
    <article class="status-card surface"><BadgeCheck size={42} /><span>{statusLabel[application.status]}</span><h2>{application.legalName}</h2><p>Номер за проследяване: <code>{application.id}</code>. Ще получиш известие при промяна.</p>{#if application.status !== 'approved'}<form method="POST" action="?/withdraw"><input type="hidden" name="applicationId" value={application.id} /><button type="submit">Оттегли кандидатурата</button></form>{/if}</article>
  {:else}
    <form class="application-form surface" method="POST">
      {#if application}<input type="hidden" name="applicationId" value={application.id} />{/if}
      <header><Landmark size={25} /><div><span>MERCHANT / BETA</span><h2>Фирмени данни</h2></div></header>
      <div class="fields">
        <label>Официално юридическо име <input name="legalName" minlength="2" maxlength="200" value={application?.legalName ?? ''} autocomplete="organization" required /></label>
        <label>ЕИК / Булстат <input name="registrationNumber" minlength="4" maxlength="64" value={application?.registrationNumber ?? ''} autocomplete="off" required /></label>
        <label class="wide">Адрес на регистрация <textarea name="registeredAddress" minlength="5" maxlength="500" autocomplete="street-address" required>{application?.registeredAddress ?? ''}</textarea></label>
        <label class="wide">Уебсайт или публичен бизнес профил <span>(по желание)</span><input name="websiteUrl" type="url" maxlength="500" value={application?.websiteUrl ?? ''} placeholder="https://" /></label>
      </div>
      <div class="document-note"><FileLock2 size={22} /><div><strong>Документни upload-и са изключени</strong><p>При нужда екипът ще използва отделен одобрен канал. Не ги качвай като снимка на обява.</p></div></div>
      <fieldset><legend>Задължителни декларации</legend><label><input type="checkbox" name="authorityDeclaration" required /><span><Check size={14} /></span> Имам право да представлявам посочения търговец и данните са точни.</label><label><input type="checkbox" name="rulesDeclaration" required /><span><Check size={14} /></span> Приемам <a href="/legal/rules">правилата</a> и ще се обозначавам като търговец.</label><label><input type="checkbox" name="verificationDeclaration" required /><span><Check size={14} /></span> Разбирам, че проверката не гарантира всеки отделен продукт.</label><label><input type="checkbox" name="privacyAcknowledgement" required /><span><Check size={14} /></span> Прочетох <a href="/legal/privacy">политиката за поверителност</a>.</label></fieldset>
      <footer><button class="button secondary" type="submit" formaction="?/draft">Запази чернова</button><button class="button primary" type="submit" formaction="?/submit"><BadgeCheck size={18} /> Изпрати за преглед</button></footer>
    </form>
  {/if}
</div></div></section>

<style>
  .application-hero { padding: clamp(3.5rem, 8vw, 7rem) 0; border-bottom: 1px solid var(--line); background: radial-gradient(circle at 85% 12%, rgb(243 223 191 / 82%), transparent 28rem); }
  .hero-grid { display: grid; align-items: end; grid-template-columns: 1.2fr .65fr; gap: clamp(2.5rem, 8vw, 7rem); }
  .back { display: inline-flex; min-height: 44px; align-items: center; gap: .4rem; margin-bottom: 2rem; color: var(--ink-soft); }
  h1 { margin: .6rem 0 1rem; } h1 em { display: block; color: var(--action); }.hero-grid>div>p{max-width:680px;color:var(--ink-soft)}
  .hero-grid aside { padding: 1.7rem; border: 1px solid rgb(74 49 38 / 24%); border-radius: var(--radius-md); background: var(--brand-main); }.hero-grid aside :global(svg){color:var(--action)}.hero-grid aside h2{margin:.8rem 0}.hero-grid aside p{margin:0;color:var(--ink-soft)}
  .application-body { padding: clamp(3rem, 7vw, 6rem) 0; }.layout{display:grid;align-items:start;grid-template-columns:260px 1fr;gap:1.5rem}.trust{position:sticky;top:calc(var(--header-height) + 24px);display:grid;grid-template-columns:28px 1fr;gap:.7rem;padding:1.2rem;border:1px solid rgb(47 107 79 / 25%);border-radius:var(--radius-sm);color:var(--success);background:rgb(47 107 79 / 7%)}.trust p{margin:.35rem 0 0;color:var(--ink-soft);font-size:.75rem}
  .application-form{overflow:hidden}.application-form>header{display:flex;align-items:center;gap:.8rem;padding:1.5rem;border-bottom:1px solid var(--line);background:var(--brand-tertiary)}.application-form header span{color:var(--ink-faint);font-size:.62rem;letter-spacing:.12em}.application-form h2{margin:.2rem 0 0}
  .fields{display:grid;grid-template-columns:1fr 1fr;gap:1rem;padding:1.5rem}.fields label{display:grid;gap:.4rem;color:var(--ink-soft);font-size:.72rem;font-weight:700}.fields label span{font-weight:400}.fields .wide{grid-column:1/-1}.fields input,.fields textarea{min-height:46px;padding:.75rem;border:1px solid var(--line);border-radius:8px;background:white}.fields textarea{min-height:95px;resize:vertical}
  .document-note{display:grid;grid-template-columns:28px 1fr;gap:.7rem;margin:0 1.5rem;padding:1rem;border-radius:8px;color:var(--warning);background:rgb(243 223 191 / 45%)}.document-note p{margin:.3rem 0 0;color:var(--ink-soft);font-size:.72rem}
  fieldset{display:grid;gap:.7rem;margin:1.5rem;padding:1.2rem;border:1px solid var(--line);border-radius:8px}legend{padding:0 .4rem;font-weight:700;font-style:italic}fieldset label{display:grid;min-height:44px;align-items:center;grid-template-columns:18px 24px 1fr;gap:.5rem;color:var(--ink-soft);font-size:.75rem}fieldset input{width:18px;height:18px;accent-color:var(--action)}fieldset label>span{display:none}
  .application-form footer{display:flex;justify-content:flex-end;gap:.7rem;padding:1.2rem 1.5rem;border-top:1px solid var(--line)}.status-card{display:grid;min-height:390px;place-items:center;align-content:center;gap:.6rem;padding:2rem;text-align:center}.status-card>span{color:var(--success);font-size:.7rem;font-weight:700;text-transform:uppercase}.status-card h2,.status-card p{margin:0}.status-card p{color:var(--ink-soft)}.status-card button{min-height:44px;margin-top:1rem;padding:.7rem 1rem;border:1px solid var(--danger);border-radius:8px;color:var(--danger);background:white;cursor:pointer}
  .notice{padding:.9rem;border-radius:8px}.notice.error{color:var(--danger);background:rgb(141 47 54 / 8%)}.notice.success{color:var(--success);background:rgb(47 107 79 / 8%)}
  @media(max-width:800px){.hero-grid,.layout{grid-template-columns:1fr}.trust{position:static}.fields{grid-template-columns:1fr}.fields .wide{grid-column:auto}}@media(max-width:520px){.application-form footer{align-items:stretch;flex-direction:column}.application-form footer .button{width:100%}}
</style>
