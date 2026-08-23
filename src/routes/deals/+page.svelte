<script lang="ts">
  import { AlertTriangle, CheckCheck, MessageCircle, PackageCheck, Star, X } from '@lucide/svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const labels = { pending_confirmation: 'Активна', completed: 'Приключена', disputed: 'В спор', cancelled: 'Отказана' } as const;
  const counterpart = (deal: PageData['deals'][number]) => deal.partyA.id === data.viewerId ? deal.partyB : deal.partyA;
  const isSeller = (deal: PageData['deals'][number]) => deal.listing.seller.id === data.viewerId;
</script>

<svelte:head><title>Сделки · Marketplace beta</title><meta name="robots" content="noindex,nofollow" /></svelte:head>

<section class="deals-page"><div class="container">
  <header><span class="eyebrow">Сделка между участниците</span><h1>Сделки</h1><p>Плащането и доставката остават извън платформата. Продавачът отбелязва реалното приключване, а всеки участник може да откаже активна сделка с причина.</p></header>
  {#if form?.error}<p class="notice error" role="alert">{form.error.message}</p>{/if}
  {#if form?.ok}<p class="notice success" role="status">Действието е записано.</p>{/if}

  <div class="deal-list">
    {#each data.deals as deal}
      <article class:highlighted={data.highlight === deal.id} class="deal-card surface">
        <div class="deal-head"><div><span>{labels[deal.status]}</span><h2>{deal.listing.title}</h2><p>С {counterpart(deal).username}</p></div><PackageCheck size={34} /></div>
        {#if deal.status === 'pending_confirmation'}
          <div class="deal-actions">
            <a href={`/messages?conversation=${encodeURIComponent(deal.conversationId)}`}><MessageCircle size={16} /> Към чата</a>
            <details class="dispute-details"><summary><AlertTriangle size={16} /> Отвори спор</summary><form method="POST" action="?/dispute"><input type="hidden" name="dealId" value={deal.id} /><label>Какъв е проблемът?<textarea name="details" minlength="20" maxlength="4000" required placeholder="Опиши конкретно какво се случи…"></textarea></label><p>Това едновременно маркира сделката като спорна и отваря модераторски случай.</p><button type="submit">Изпрати към модератор</button></form></details>
            <details><summary><X size={16} /> Откажи сделката</summary><form method="POST" action="?/cancel"><input type="hidden" name="dealId" value={deal.id} /><label>Причина<textarea name="reason" minlength="2" maxlength="1000" required></textarea></label><button type="submit">Потвърди отказа</button></form></details>
            {#if isSeller(deal)}<form method="POST" action="?/complete"><input type="hidden" name="dealId" value={deal.id} /><button class="confirm" type="submit"><CheckCheck size={17} /> Отбележи като приключена</button></form>{:else}<p class="seller-guidance">Продавачът отбелязва сделката като приключена.</p>{/if}
          </div>
        {:else if deal.status === 'disputed'}
          <div class="deal-actions"><a href={`/messages?conversation=${encodeURIComponent(deal.conversationId)}`}><MessageCircle size={16} /> Към чата</a><details><summary><X size={16} /> Откажи сделката</summary><form method="POST" action="?/cancel"><input type="hidden" name="dealId" value={deal.id} /><label>Причина<textarea name="reason" minlength="2" maxlength="1000" required></textarea></label><button type="submit">Потвърди отказа</button></form></details></div>
        {:else if deal.status === 'completed'}
          <form class="review" method="POST" action="?/review"><input type="hidden" name="dealId" value={deal.id} /><input type="hidden" name="revieweeId" value={counterpart(deal).id} /><div><Star size={20} /><strong>Оцени {counterpart(deal).username}</strong></div><label>Оценка<select name="rating" required><option value="5">5 — Отлично</option><option value="4">4 — Много добре</option><option value="3">3 — Добре</option><option value="2">2 — Незадоволително</option><option value="1">1 — Лошо</option></select></label><label>Отзив<textarea name="body" maxlength="2000"></textarea></label><button type="submit">Публикувай отзив</button></form>
        {:else}<p class="closed-note">{deal.cancellationReason ?? 'Тази сделка е приключена.'}</p>{/if}
      </article>
    {/each}
  </div>
  {#if data.deals.length === 0}<div class="empty surface"><PackageCheck size={40} /><h2>Още няма сделки.</h2><p>Приета оферта създава сделка, резервира обявата и отключва чат.</p><a class="button primary" href="/offers">Към офертите</a></div>{/if}
</div></section>

<style>
  .deals-page { min-height: 72vh; padding: 6px 0 0; font-family: inherit; }
  header { padding-bottom: 1.6rem; border-bottom: 1px solid var(--line-strong); }
  header h1 { margin: .25rem 0 .5rem; font-size: clamp(2.45rem, 5vw, 4.4rem); }
  header p { max-width: 700px; color: var(--ink-soft); }
  .deal-list { display: grid; gap: 1rem; margin-top: 1.5rem; }
  .deal-card { padding: clamp(1.2rem, 3vw, 2rem); border-color: var(--line-strong); }
  .deal-card.highlighted { outline: 2px solid var(--action); outline-offset: 3px; }
  .deal-head { display: flex; align-items: start; justify-content: space-between; gap: 1rem; }
  .deal-head span { color: var(--ink-faint); font-size: .68rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .deal-head h2 { margin: .35rem 0; }
  .deal-head p { margin: 0; color: var(--ink-soft); }
  .deal-head > :global(svg) { color: var(--action); }
  .deal-actions { display: flex; align-items: flex-start; gap: .55rem; flex-wrap: wrap; padding-top: 1rem; border-top: 1px solid var(--line); }
  .deal-actions > a, .deal-actions button, summary, .review button { display: inline-flex; min-height: 44px; align-items: center; gap: .4rem; padding: .65rem .85rem; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--paper-strong); cursor: pointer; font: inherit; font-size: .72rem; font-weight: 700; }
  .dispute-details summary { color: var(--warning); }
  .deal-actions form:last-child { margin-left: auto; }
  .deal-actions .confirm { border-color: var(--success); color: var(--paper-strong); background: var(--success); }
  .seller-guidance { align-self: center; margin: 0 0 0 auto; color: var(--ink-soft); font-size: .75rem; }
  details { position: relative; }
  summary { list-style: none; color: var(--danger); }
  details form { position: absolute; z-index: 5; top: 50px; left: 0; display: grid; width: min(82vw, 340px); gap: .7rem; padding: 1rem; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--paper-strong); }
  details form p { margin: 0; color: var(--ink-soft); font-size: .7rem; line-height: 1.45; }
  details label, .review label { display: grid; gap: .35rem; color: var(--ink-soft); font-size: .7rem; font-weight: 700; }
  textarea, select { min-height: 44px; padding: .7rem; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--paper-strong); font: inherit; }
  textarea { min-height: 80px; resize: vertical; }
  .review { display: grid; grid-template-columns: auto 180px 1fr auto; align-items: end; gap: .8rem; padding-top: 1rem; border-top: 1px solid var(--line); }
  .review > div { display: flex; align-items: center; gap: .45rem; color: var(--action); }
  .review button { color: var(--paper-strong); background: var(--action); }
  .closed-note { padding: 1rem; border: 1px solid var(--line); color: var(--ink-soft); background: var(--paper-deep); }
  .notice { padding: .9rem; border-radius: var(--radius-sm); }.notice.error { color: var(--danger); background: var(--danger-soft); }.notice.success { color: var(--success); background: var(--success-soft); }
  .empty { display: grid; min-height: 340px; place-items: center; align-content: center; gap: .7rem; margin-top: 1.5rem; padding: 2rem; border-color: var(--line-strong); text-align: center; }.empty h2,.empty p{margin:0}.empty p{color:var(--ink-soft)}
  @media (max-width: 780px) { .review { grid-template-columns: 1fr; }.deal-actions form:last-child{margin-left:0}.seller-guidance{margin-left:0} }
</style>
