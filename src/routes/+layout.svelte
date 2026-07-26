<script lang="ts">
  import '../app.css';
  import DemoBanner from '$components/DemoBanner.svelte';
  import Footer from '$components/Footer.svelte';
  import Header from '$components/Header.svelte';

  let { data, children } = $props();
</script>

<a class="skip-link" href="#main-content">Към основното съдържание</a>
<Header auth={data.auth} demoMode={data.demoMode} />
{#if data.demoMode}
  <DemoBanner />
{/if}
<main id="main-content">{@render children()}</main>
<Footer />

<style>
  .skip-link {
    position: fixed;
    top: 10px;
    left: 10px;
    z-index: 100;
    padding: 10px 14px;
    border-radius: 8px;
    color: var(--paper-strong);
    background: var(--action);
    transform: translateY(-160%);
  }

  .skip-link:focus {
    transform: translateY(0);
  }
</style>
