<script lang="ts">
  import { ArrowLeft, Check, Flag, ShieldCheck } from '@lucide/svelte';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const reasonLabels = {
    counterfeit_suspected: 'Съмнение за фалшификат',
    misleading_content: 'Невярно описание или снимки',
    harassment: 'Тормоз или натиск',
    spam_fraud: 'Спам или опит за измама',
    other_violation: 'Друго нарушение'
  } as const;
</script>

<svelte:head><title>Подай сигнал · Marketplace beta</title><meta name="robots" content="noindex,nofollow" />{#if data.turnstileSiteKey && !data.demoMode}<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>{/if}</svelte:head>

<section class="report-page"><div class="container narrow"><a class="back" href="/safety"><ArrowLeft size={16} /> Безопасност</a><header><Flag size={38} /><span class="eyebrow">NOTICE & ACTION / BETA</span><h1>Подай конкретен сигнал.</h1><p>Опиши проверими факти. Не добавяй пароли, картови данни, лични документи или несвързани лични данни.</p></header>
  {#if form?.ok}<div class="success" role="status"><Check size={28} /><h2>Сигналът е приет.</h2><p>Номер: <code>{form.reportId ?? 'DEMO'}</code>. Ще получиш известие при промяна.</p><a class="button primary" href="/dashboard">Към профила</a></div>
  {:else if !data.targetType || !data.targetId}<div class="missing surface"><ShieldCheck size={34} /><h2>Избери конкретно съдържание.</h2><p>Сигналът трябва да започне от обява, профил, разговор, сделка или отзив, за да запазим точна одитна следа.</p><a class="button primary" href="/listings">Към обявите</a></div>
  {:else}<form class="surface" method="POST" enctype="multipart/form-data"><input type="hidden" name="targetType" value={data.targetType} /><input type="hidden" name="targetId" value={data.targetId} />{#if form?.error}<p class="error" role="alert">{form.error.message}</p>{/if}<div class="target"><span>Обект</span><strong>{data.targetType} · {data.targetId}</strong></div><label>Причина<select name="reasonCode" required>{#each data.reasonCodes as reason}<option value={reason}>{reasonLabels[reason]}</option>{/each}</select></label><label>Факти и контекст<textarea name="details" minlength="20" maxlength="4000" required placeholder="Какво се случи, кога и кои видими детайли го подкрепят?"></textarea></label><label>Доказателства (до 4 файла, по 10 MB)<input name="evidence" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" /></label><label class="confirm"><input type="checkbox" required /> Подавам сигнала добросъвестно и информацията е точна според знанието ми.</label>{#if data.turnstileSiteKey && !data.demoMode}<div class="cf-turnstile" data-sitekey={data.turnstileSiteKey} data-action="report_submit"></div>{/if}<button class="button primary" type="submit"><Flag size={17} /> Изпрати сигнала</button></form>{/if}
</div></section>

<style>
  .report-page{min-height:75vh;padding:clamp(3rem,8vw,6rem) 0}.narrow{max-width:820px}.back{display:inline-flex;min-height:44px;align-items:center;gap:.4rem;margin-bottom:2rem;color:var(--ink-soft)}header{padding-bottom:2rem;border-bottom:1px solid var(--line)}header>:global(svg){color:var(--danger)}header h1{margin:.5rem 0}header p{max-width:650px;color:var(--ink-soft)}form{display:grid;gap:1.2rem;margin-top:1.5rem;padding:clamp(1.2rem,4vw,2rem)}form label{display:grid;gap:.4rem;color:var(--ink-soft);font-size:.75rem;font-weight:700}select,textarea{min-height:46px;padding:.75rem;border:1px solid var(--line);border-radius:8px;background:white}textarea{min-height:150px;resize:vertical}.target{display:grid;gap:.25rem;padding:1rem;border-radius:8px;background:var(--brand-tertiary)}.target span{color:var(--ink-faint);font-size:.65rem;text-transform:uppercase}.target strong{overflow-wrap:anywhere;font-size:.75rem}.confirm{grid-template-columns:18px 1fr;align-items:start}.confirm input{width:18px;height:18px;accent-color:var(--action)}form>.button{justify-self:start}.error{padding:.8rem;color:var(--danger);background:rgb(141 47 54 / 8%)}.success,.missing{display:grid;min-height:340px;place-items:center;align-content:center;gap:.7rem;margin-top:1.5rem;padding:2rem;text-align:center}.success{color:var(--success);background:rgb(47 107 79 / 7%)}.success h2,.success p,.missing h2,.missing p{margin:0}.success p,.missing p{max-width:570px;color:var(--ink-soft)}
</style>
