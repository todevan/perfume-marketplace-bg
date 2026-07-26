<script lang="ts">
  import { page } from '$app/state';
  import { ArrowLeft, Search } from '@lucide/svelte';
</script>

<svelte:head><title>{page.status} · Нещо се обърка</title></svelte:head>

<section class="error-page container">
  <span class="code">{page.status}</span>
  <div><span class="eyebrow">Изгубена ароматна следа</span><h1>{page.status === 404 ? 'Тази страница вече не е на рафта.' : 'Нещо не се зареди правилно.'}</h1><p>{page.error?.message ?? 'Опитай отново или се върни към активните обяви.'}</p><div class="actions"><a class="button primary" href="/listings"><Search size={18} /> Към обявите</a><a class="button secondary" href="/"><ArrowLeft size={18} /> Начало</a></div></div>
</section>

<style>
  .error-page {
    display: grid;
    min-height: 68vh;
    align-items: center;
    grid-template-columns: .65fr 1.35fr;
    gap: 50px;
    padding-block: 80px;
  }

  .code {
    color: rgb(74 49 38 / 13%);
    font-size: clamp(9rem, 25vw, 24rem);
    font-weight: 700;
    font-style: italic;
    letter-spacing: -.12em;
    line-height: .7;
  }

  h1 {
    max-width: 760px;
  }

  p {
    max-width: 560px;
    color: var(--ink-soft);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
    margin-top: 28px;
  }

  @media (max-width: 700px) {
    .error-page {
      grid-template-columns: 1fr;
      gap: 20px;
    }

    .code {
      font-size: 9rem;
    }
  }
</style>
