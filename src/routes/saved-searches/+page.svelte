<script lang="ts">
  import { Bell, BellOff, Search, Trash2 } from '@lucide/svelte';
  import type { ListingSearchInput } from '$lib/contracts';
  let { data, form } = $props();
  function href(filters: ListingSearchInput): string { const p = new URLSearchParams(); if(filters.query)p.set('q',filters.query); if(filters.kind)p.set('kind',filters.kind); if(filters.dealMode)p.set('mode',filters.dealMode); if(filters.audience)p.set('audience',filters.audience); if(filters.city)p.set('city',filters.city); if(filters.brandId)p.set('brandId',filters.brandId); for(const segment of filters.segments)p.append('segment',segment); return `/listings${p.size ? `?${p}` : ''}`; }
</script>
<svelte:head><title>Запазени търсения · Marketplace beta</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<section class="container page"><header><span class="eyebrow">Личен панел</span><h1>Запазени търсения</h1><p>Управлявай филтрите и известията си.</p></header>{#if form?.error}<p class="error" role="alert">{form.error.message}</p>{/if}{#if data.searches.items.length}<div class="list">{#each data.searches.items as search}<article><span class="icon"><Search size={20} /></span><div><strong>{search.name}</strong><small>Създадено {new Date(search.createdAt).toLocaleDateString('bg-BG')}</small><a href={href(search.filters)}>Отвори резултатите</a></div><div class="actions"><form method="POST" action="?/toggle"><input type="hidden" name="savedSearchId" value={search.id} /><input type="hidden" name="name" value={search.name} /><input type="hidden" name="filters" value={JSON.stringify(search.filters)} /><input type="hidden" name="notificationsEnabled" value={String(search.notificationsEnabled)} /><button type="submit">{#if search.notificationsEnabled}<Bell size={16} /> Известия включени{:else}<BellOff size={16} /> Известия изключени{/if}</button></form><form method="POST" action="?/remove"><input type="hidden" name="savedSearchId" value={search.id} /><button class="danger" type="submit"><Trash2 size={16} /> Изтрий</button></form></div></article>{/each}</div>{:else}<div class="empty-state"><div><Search size={36} /><h2>Няма запазени търсения.</h2><p class="muted">Можеш да запазиш марка или конкретен аромат.</p><a class="button primary" href="/listings">Към каталога</a></div></div>{/if}</section>
<style>
  .page { min-height: 70vh; padding-block: 6px 0; font-family: inherit; }
  header { margin-bottom: 26px; padding-bottom: 1.6rem; border-bottom: 1px solid var(--line-strong); }
  header h1 { margin: .25rem 0 .5rem; font-size: clamp(2.45rem, 5vw, 4.4rem); }
  header p { margin: 0; color: var(--ink-soft); }
  .error { padding: 12px 14px; border: 1px solid #d6a7aa; border-radius: var(--radius-sm); color: var(--danger); background: var(--danger-soft); }
  .list { display: grid; gap: 10px; }
  article { display: grid; align-items: center; grid-template-columns: 46px 1fr auto; gap: 15px; padding: 18px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--paper-strong); }
  .icon { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 50%; color: var(--paper-strong); background: var(--action); }
  article>div:nth-child(2) { display: grid; gap: 4px; }
  article small { color: var(--ink-faint); }
  article a { min-height: 38px; display: inline-flex; align-items: center; color: var(--action); font-size: .73rem; font-weight: 700; }
  .actions { display: flex; gap: 7px; }
  .actions form { margin: 0; }
  .actions button { display: inline-flex; min-height: 44px; align-items: center; gap: 6px; padding: 8px 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--paper-strong); cursor: pointer; font: inherit; font-size: .7rem; font-weight: 700; }
  .actions .danger { color: var(--danger); }
  @media(max-width:700px){article{grid-template-columns:42px 1fr}.actions{grid-column:2;flex-wrap:wrap}}
</style>
