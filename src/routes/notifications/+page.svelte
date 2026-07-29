<script lang="ts">
  import { Archive, ArrowRight, Bell, CheckCheck, MessageCircle, PackageCheck, ShieldCheck } from '@lucide/svelte';

  let { data, form } = $props();
  const kindIcon = (kind: string) => kind.includes('message') ? MessageCircle : kind.includes('report') ? ShieldCheck : kind.includes('listing') ? PackageCheck : Bell;
</script>

<svelte:head><title>Известия · Marketplace beta</title><meta name="robots" content="noindex,nofollow" /></svelte:head>

<section class="notifications-page container">
  <header><div><span class="eyebrow">Личен панел</span><h1>Известия</h1><p>Оферти, съобщения, сделки, сигнали и изтичащи обяви.</p></div><form method="POST" action="?/markAllRead"><button class="button secondary" type="submit"><CheckCheck size={18} /> Маркирай всички като прочетени</button></form></header>
  <nav aria-label="Филтър на известия"><a class:active={data.selectedStatus === 'all'} href="/notifications">Всички</a><a class:active={data.selectedStatus === 'unread'} href="/notifications?status=unread">Непрочетени</a><a class:active={data.selectedStatus === 'read'} href="/notifications?status=read">Прочетени</a><a class:active={data.selectedStatus === 'archived'} href="/notifications?status=archived">Архив</a></nav>
  {#if form?.error}<p class="feedback error" role="alert">{form.error.message}</p>{/if}
  {#if data.notifications.length}
    <div class="notification-list">
      {#each data.notifications as notification}
        {@const Icon = kindIcon(notification.kind)}
        <article class:unread={notification.status === 'unread'}>
          <span class="icon"><Icon size={20} /></span>
          <div><div class="meta"><strong>{notification.title}</strong><time datetime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString('bg-BG')}</time></div><p>{notification.body}</p>{#if notification.actionUrl}<a href={notification.actionUrl}>Отвори <ArrowRight size={15} /></a>{/if}</div>
          <div class="actions">
            {#if notification.status === 'unread'}<form method="POST" action="?/update"><input type="hidden" name="notificationId" value={notification.id} /><input type="hidden" name="status" value="read" /><button type="submit" aria-label="Маркирай като прочетено"><CheckCheck size={17} /></button></form>{/if}
            {#if notification.status !== 'archived'}<form method="POST" action="?/update"><input type="hidden" name="notificationId" value={notification.id} /><input type="hidden" name="status" value="archived" /><button type="submit" aria-label="Архивирай"><Archive size={17} /></button></form>{/if}
          </div>
        </article>
      {/each}
    </div>
  {:else}
    <div class="empty-state"><div><Bell size={36} /><h2>Няма известия в този изглед.</h2><p class="muted">Новите събития по обяви и сделки ще се появят тук.</p></div></div>
  {/if}
</section>

<style>
  .notifications-page { min-height: 70vh; padding-block: 6px 0; font-family: inherit; }
  header { display: flex; align-items: end; justify-content: space-between; gap: 30px; margin-bottom: 22px; padding-bottom: 1.6rem; border-bottom: 1px solid var(--line-strong); }
  header h1 { margin: .25rem 0 .5rem; font-size: clamp(2.45rem, 5vw, 4.4rem); }
  header p { margin: 0; color: var(--ink-soft); }
  nav { display: flex; gap: 7px; overflow-x: auto; margin-bottom: 20px; }
  nav a { min-height: 44px; padding: 12px 14px; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--ink-soft); background: var(--paper-strong); font-size: .76rem; font-weight: 700; white-space: nowrap; }
  nav a.active { border-color: var(--action); color: var(--paper-strong); background: var(--action); }
  .feedback { padding: 12px; border: 1px solid #d6a7aa; border-radius: var(--radius-sm); background: var(--danger-soft); }
  .feedback.error { color: var(--danger); }
  .notification-list { display: grid; gap: 8px; }
  article { display: grid; align-items: start; grid-template-columns: 46px 1fr auto; gap: 15px; padding: 19px 16px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--paper-strong); }
  article.unread { border-color: var(--action); background: var(--brand-main); }
  .icon { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 50%; color: var(--paper-strong); background: var(--action); }
  .meta { display: flex; justify-content: space-between; gap: 20px; }
  .meta time { color: var(--ink-faint); font-size: .67rem; }
  article p { margin: 6px 0; color: var(--ink-soft); }
  article a { display: inline-flex; min-height: 40px; align-items: center; gap: 6px; color: var(--action); font-size: .74rem; font-weight: 700; }
  .actions { display: flex; gap: 6px; }
  .actions button { display: grid; width: 44px; height: 44px; place-items: center; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--ink); background: var(--paper-strong); cursor: pointer; font: inherit; }
  @media (max-width: 700px) { header { align-items: flex-start; flex-direction: column; } article { grid-template-columns: 42px 1fr; } .actions { grid-column: 2; } .meta { flex-direction: column; gap: 3px; } }
</style>
