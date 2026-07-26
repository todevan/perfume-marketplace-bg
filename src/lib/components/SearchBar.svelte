<script lang="ts">
  import { ArrowRight, Search, Sparkles } from '@lucide/svelte';
  export let value = '';
  export let compact = false;
  export let action = '/listings';
</script>

<form class:compact class="search-shell" method="GET" {action}>
  <Search size={compact ? 20 : 24} aria-hidden="true" />
  <label class="sr-only" for={compact ? 'catalog-search' : 'hero-search'}>Търси аромат или марка</label>
  <input
    id={compact ? 'catalog-search' : 'hero-search'}
    name="q"
    bind:value
    autocomplete="off"
    placeholder="Кой аромат търсиш?"
  />
  {#if !compact}<span class="hint"><Sparkles size={14} /> кирилица или латиница</span>{/if}
  <button type="submit" aria-label="Търси"><ArrowRight size={21} /></button>
</form>

<style>
  .search-shell {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    min-height: 76px;
    align-items: center;
    gap: 14px;
    padding: 10px 11px 10px 24px;
    border: 1px solid rgb(74 49 38 / 34%);
    border-radius: 999px;
    background: rgb(255 253 249 / 92%);
    box-shadow: 0 18px 52px rgb(74 49 38 / 16%);
  }

  input {
    min-width: 0;
    border: 0;
    outline: 0;
    color: var(--ink);
    background: transparent;
    font-size: clamp(1rem, 2vw, 1.2rem);
  }

  input::placeholder {
    color: var(--ink-soft);
  }

  .hint {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--ink-faint);
    font-size: 0.72rem;
  }

  button {
    display: grid;
    width: 54px;
    height: 54px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    color: var(--paper-strong);
    background: var(--action);
    cursor: pointer;
    transition: transform 180ms ease, background 180ms ease;
  }

  button:hover {
    background: var(--action-hover);
    transform: rotate(-8deg) scale(1.04);
  }

  .compact {
    min-height: 56px;
    padding: 6px 7px 6px 16px;
    border-color: var(--line);
    box-shadow: none;
  }

  .compact button {
    width: 44px;
    height: 44px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 640px) {
    .search-shell {
      min-height: 64px;
      padding-left: 18px;
    }

    .hint {
      display: none;
    }

    button {
      width: 48px;
      height: 48px;
    }
  }
</style>
