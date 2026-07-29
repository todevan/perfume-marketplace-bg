<script lang="ts">
  import { Heart, Trash2 } from '@lucide/svelte';
  import ListingCard from '$components/ListingCard.svelte';
  let { data, form } = $props();
</script>

<svelte:head><title>Любими обяви · Marketplace beta</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<section class="container page"><header><span class="eyebrow">Личен панел</span><h1>Любими обяви</h1><p>Запази флаконите, към които искаш да се върнеш.</p></header>{#if form?.error}<p class="error" role="alert">{form.error.message}</p>{/if}{#if data.favorites.items.length}<div class="grid">{#each data.favorites.items as favorite}<div class="favorite"><ListingCard listing={favorite.listing} /><form method="POST" action="?/remove"><input type="hidden" name="listingId" value={favorite.listing.id} /><button type="submit"><Trash2 size={16} /> Премахни</button></form></div>{/each}</div>{:else}<div class="empty-state"><div><Heart size={36} /><h2>Няма запазени обяви.</h2><p class="muted">Използвай бутона със сърце в конкретна обява.</p><a class="button primary" href="/listings">Разгледай каталога</a></div></div>{/if}</section>
<style>
  .page { min-height: 70vh; padding-block: 6px 0; font-family: inherit; }
  header { margin-bottom: 26px; padding-bottom: 1.6rem; border-bottom: 1px solid var(--line-strong); }
  header h1 { margin: .25rem 0 .5rem; font-size: clamp(2.45rem, 5vw, 4.4rem); }
  header p { margin: 0; color: var(--ink-soft); }
  .error { padding: 12px 14px; border: 1px solid #d6a7aa; border-radius: var(--radius-sm); color: var(--danger); background: var(--danger-soft); }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
  .favorite { position: relative; }
  .favorite form { position: absolute; top: 12px; right: 12px; z-index: 2; }
  .favorite form button { display: inline-flex; min-height: 44px; align-items: center; gap: 6px; padding: 8px 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--danger); background: var(--paper-strong); cursor: pointer; font: inherit; font-size: .7rem; font-weight: 700; }
  @media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:600px){.grid{grid-template-columns:1fr}}
</style>
