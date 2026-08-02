<script lang="ts">
  import { Search } from '@lucide/svelte';
  export let value = '';
  export let compact = false;
  export let action = '/listings';
</script>

<form class:compact class="search-shell" method="GET" {action}>
  <Search size={compact ? 19 : 22} aria-hidden="true" />
  <label class="sr-only" for={compact ? 'catalog-search' : 'hero-search'}>Търси аромат или марка</label>
  <input
    id={compact ? 'catalog-search' : 'hero-search'}
    name="q"
    bind:value
    autocomplete="off"
    placeholder="Кой аромат търсиш?"
  />
  {#if !compact}<span class="hint">кирилица или латиница</span>{/if}
  <button type="submit" aria-label="Търси">Търси</button>
</form>

<style>
  .search-shell {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    min-height: 58px;
    align-items: center;
    gap: 12px;
    padding: 7px 7px 7px 18px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--paper-strong);
  }

  input {
    min-width: 0;
    border: 0;
    outline: 0;
    color: var(--ink);
    background: transparent;
    font-size: clamp(0.94rem, 1.5vw, 1.06rem);
  }

  input::placeholder {
    color: var(--ink-soft);
  }

  .hint {
    color: var(--ink-faint);
    font-size: 0.68rem;
  }

  button {
    display: inline-flex;
    min-width: 86px;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 6px;
    color: var(--paper-strong);
    background: var(--action);
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 700;
    transition: background 180ms ease;
  }

  button:hover {
    background: var(--action-hover);
  }

  .compact {
    min-height: 50px;
    padding: 4px 5px 4px 14px;
    border-color: var(--line);
  }

  .compact button {
    min-width: 74px;
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
      min-height: 54px;
      padding-left: 14px;
    }

    .hint {
      display: none;
    }

    button {
      min-width: 72px;
      height: 48px;
    }
  }
</style>
