<script lang="ts">
  import { page } from '$app/state';
  import '../app.css';
  import DemoBanner from '$components/DemoBanner.svelte';
  import Footer from '$components/Footer.svelte';
  import Header from '$components/Header.svelte';
  import MemberShell, { type MemberShellMode } from '$components/MemberShell.svelte';

  let { data, children } = $props();

  const standardMemberRoutes = new Set([
    '/dashboard',
    '/offers',
    '/deals',
    '/favorites',
    '/saved-searches',
    '/notifications',
    '/settings'
  ]);

  function resolveMemberMode(pathname: string): MemberShellMode | null {
    if (standardMemberRoutes.has(pathname)) return 'standard';
    if (pathname === '/messages') return 'workspace';
    if (pathname === '/publish') return 'focus';
    return null;
  }

  let memberMode = $derived(resolveMemberMode(page.url.pathname));
</script>

<a class="skip-link" href="#main-content">Към основното съдържание</a>
<Header auth={data.auth} demoMode={data.demoMode} />
{#if data.demoMode}
  <DemoBanner />
{/if}
<main id="main-content">
  {#if memberMode}
    <MemberShell
      auth={data.auth}
      pathname={page.url.pathname}
      mode={memberMode}
      demoMode={data.demoMode}
    >
      {@render children()}
    </MemberShell>
  {:else}
    {@render children()}
  {/if}
</main>
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
