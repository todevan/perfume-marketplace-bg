<script lang="ts">
  import { Heart, Trash2 } from '@lucide/svelte';
  import ListingCard from '$components/ListingCard.svelte';
  let { data, form } = $props();
</script>

<svelte:head><title>Любими обяви · Marketplace beta</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<section class="container page"><header><span class="eyebrow">Личен панел</span><h1>Любими обяви</h1><p>Запази флаконите, към които искаш да се върнеш.</p></header>{#if form?.error}<p class="error" role="alert">{form.error.message}</p>{/if}{#if data.favorites.items.length}<div class="grid">{#each data.favorites.items as favorite}<div class="favorite"><ListingCard listing={favorite.listing} /><form method="POST" action="?/remove"><input type="hidden" name="listingId" value={favorite.listing.id} /><button type="submit"><Trash2 size={16} /> Премахни</button></form></div>{/each}</div>{:else}<div class="empty-state"><div><Heart size={36} /><h2>Няма запазени обяви.</h2><p class="muted">Използвай бутона със сърце в конкретна обява.</p><a class="button primary" href="/listings">Разгледай каталога</a></div></div>{/if}</section>
<style>
  .page { min-height: 70vh; padding-block: 58px 100px; } header { margin-bottom: 30px; } header h1 { margin-bottom: 8px; } header p { margin: 0; color: var(--ink-soft); } .error { color: var(--danger); } .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; } .favorite { position: relative; } .favorite form { position: absolute; top: 12px; right: 12px; z-index: 2; } .favorite form button { display: inline-flex; min-height: 44px; align-items: center; gap: 6px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 999px; color: var(--danger); background: rgb(255 253 249 / 92%); cursor: pointer; font-size: .7rem; font-weight: 700; } @media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}} @media(max-width:600px){.grid{grid-template-columns:1fr}}
</style>
