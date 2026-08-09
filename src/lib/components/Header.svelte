<script lang="ts">
  import { page } from '$app/state';
  import {
    Bell,
    ClipboardCheck,
    LogIn,
    LogOut,
    Menu,
    MessageCircle,
    Plus,
    Search,
    UserRound,
    X
  } from '@lucide/svelte';
  import ScentMark from './ScentMark.svelte';

  interface HeaderAuth {
    user: { id: string } | null;
    profile: {
      username: string;
      role: 'user' | 'moderator' | 'admin';
    } | null;
    betaAccess: {
      status: 'pending' | 'active' | 'suspended' | 'revoked';
      onboardingCompletedAt: string | null;
      isActive: boolean;
    } | null;
  }

  interface Props {
    auth: HeaderAuth;
    demoMode?: boolean;
  }

  const betaLinks = [
    { href: '/listings', label: 'Обяви' },
    { href: '/listings#categories', label: 'Категории' },
    { href: '/wanted', label: 'Търся' },
    { href: '/merchants', label: 'Търговци' },
    { href: '/safety', label: 'Безопасност' }
  ];

  const publicLinks = [
    { href: '/safety', label: 'Безопасност' },
    { href: '/legal', label: 'Правила' },
    { href: '/legal/privacy', label: 'Поверителност' }
  ];

  const onboardingLinks = [
    { href: '/onboarding', label: 'Завърши профила' },
    { href: '/legal', label: 'Правила' },
    { href: '/safety', label: 'Безопасност' }
  ];

  let { auth, demoMode = false }: Props = $props();
  let open = $state(false);
  let isAuthenticated = $derived(Boolean(auth.user));
  let hasBetaAccess = $derived(demoMode || auth.betaAccess?.isActive === true);
  let needsOnboarding = $derived(isAuthenticated && !auth.betaAccess?.isActive);
  let links = $derived(hasBetaAccess ? betaLinks : needsOnboarding ? onboardingLinks : publicLinks);
  let homeHref = $derived(hasBetaAccess ? '/' : needsOnboarding ? '/onboarding' : '/login');

  function isActive(href: string) {
    const pathname = href.split('#', 1)[0];
    return page.url.pathname === pathname;
  }

  function closeMenu() {
    open = false;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeMenu();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<header class="site-header">
  <div class="header-inner container">
    <a
      class="mark"
      href={homeHref}
      aria-label={hasBetaAccess ? 'Начална страница' : 'Към входа'}
      onclick={closeMenu}
    >
      <span class="mark-symbol"><ScentMark size={34} /></span>
      <span class="brand-lockup">
        <strong>Парфюмен marketplace</strong>
        <small>България · Beta</small>
      </span>
    </a>

    <nav class="desktop-nav" aria-label="Основна навигация">
      {#each links as link}
        <a class:active={isActive(link.href)} href={link.href}>{link.label}</a>
      {/each}
    </nav>

    <div class="header-actions">
      {#if hasBetaAccess}
        <a class="icon-action desktop-action" href="/listings" aria-label="Търсене"><Search size={19} /></a>
        <a class="icon-action desktop-action" href="/messages" aria-label="Съобщения"><MessageCircle size={19} /></a>
        <a class="icon-action desktop-action" href="/notifications" aria-label="Известия"><Bell size={19} /></a>
        <a class="icon-action desktop-action" href="/dashboard" aria-label="Моят профил"><UserRound size={19} /></a>
        <a class="button primary publish desktop-action" href="/publish">
          <Plus size={17} /> Публикувай обява
        </a>
      {:else if needsOnboarding}
        <a class="button primary account-cta desktop-action" href="/onboarding">
          <ClipboardCheck size={17} /> Завърши профила
        </a>
      {:else}
        <a class="button primary account-cta desktop-action" href="/login">
          <LogIn size={17} /> Вход
        </a>
      {/if}

      {#if isAuthenticated && !demoMode}
        <form class="logout-form desktop-action" method="POST" action="/auth/logout">
          <button class="icon-action" type="submit" aria-label="Изход"><LogOut size={19} /></button>
        </form>
      {/if}

      <button
        class="menu-button"
        type="button"
        aria-label={open ? 'Затвори менюто' : 'Отвори менюто'}
        aria-expanded={open}
        aria-controls="mobile-navigation"
        onclick={() => (open = !open)}
      >
        {#if open}<X size={22} />{:else}<Menu size={22} />{/if}
      </button>
    </div>
  </div>

  {#if open}
    <nav id="mobile-navigation" class="mobile-nav" aria-label="Мобилна навигация">
      <div class="container">
        {#if isAuthenticated && auth.profile}
          <div class="mobile-account">
            <span aria-hidden="true"><UserRound size={17} /></span>
            <div><small>Влязъл профил</small><strong>@{auth.profile.username}</strong></div>
          </div>
        {/if}

        {#each links as link}
          <a class:active={isActive(link.href)} href={link.href} onclick={closeMenu}>{link.label}</a>
        {/each}

        {#if hasBetaAccess}
          <a href="/messages" onclick={closeMenu}>Съобщения</a>
          <a href="/notifications" onclick={closeMenu}>Известия</a>
          <a href="/dashboard" onclick={closeMenu}>Моят профил</a>
          <a class="button primary" href="/publish" onclick={closeMenu}>
            <Plus size={18} /> Публикувай обява
          </a>
        {:else if needsOnboarding}
          <a class="button primary" href="/onboarding" onclick={closeMenu}>
            <ClipboardCheck size={18} /> Към onboarding
          </a>
        {:else}
          <a class="button primary" href="/login" onclick={closeMenu}>
            <LogIn size={18} /> Вход или регистрация
          </a>
        {/if}

        {#if isAuthenticated && !demoMode}
          <form class="mobile-logout" method="POST" action="/auth/logout">
            <button class="button logout-button" type="submit"><LogOut size={18} /> Изход</button>
          </form>
        {/if}
      </div>
    </nav>
  {/if}
</header>

<style>
  .site-header {
    position: sticky;
    top: 0;
    z-index: 50;
    min-height: var(--header-height);
    border-bottom: 1px solid var(--line);
    background: var(--paper);
  }

  .header-inner {
    display: flex;
    min-height: var(--header-height);
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }

  .mark {
    display: flex;
    min-width: max-content;
    align-items: center;
    gap: 10px;
    color: var(--ink);
  }

  .mark-symbol {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border: 1px solid var(--action);
    border-radius: var(--radius-sm);
    color: var(--action);
  }

  .brand-lockup {
    display: grid;
    line-height: 1.1;
  }

  .brand-lockup strong {
    font-size: 0.81rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .brand-lockup small {
    margin-top: 4px;
    color: var(--ink-faint);
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .desktop-nav {
    display: flex;
    align-items: center;
    gap: clamp(16px, 2vw, 30px);
    margin-left: auto;
  }

  .desktop-nav a {
    position: relative;
    display: grid;
    min-height: var(--header-height);
    align-items: center;
    color: var(--ink-soft);
    font-size: 0.84rem;
    font-weight: 600;
  }

  .desktop-nav a::after {
    position: absolute;
    right: 50%;
    bottom: 0;
    left: 50%;
    height: 2px;
    background: var(--action);
    content: '';
    transition: inset 180ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .desktop-nav a:hover,
  .desktop-nav a.active {
    color: var(--ink);
  }

  .desktop-nav a:hover::after,
  .desktop-nav a.active::after {
    right: 0;
    left: 0;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .icon-action,
  .menu-button {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
  }

  .icon-action:hover,
  .menu-button:hover {
    color: var(--action);
    background: var(--action-soft);
  }

  .publish,
  .account-cta {
    min-height: 44px;
    margin-left: 4px;
    padding-inline: 17px;
  }

  .logout-form,
  .mobile-logout {
    margin: 0;
  }


  .menu-button,
  .mobile-nav {
    display: none;
  }

  @media (max-width: 1160px) {
    .desktop-nav,
    .desktop-action {
      display: none;
    }

    .menu-button {
      display: grid;
    }

    .mobile-nav {
      display: block;
      border-top: 1px solid var(--line);
      background: var(--paper-strong);
      box-shadow: var(--shadow-lg);
    }

    .mobile-nav .container {
      display: grid;
      padding-block: 14px 22px;
    }

    .mobile-nav a:not(.button) {
      min-height: 48px;
      padding: 13px 4px;
      border-bottom: 1px solid var(--line);
      font-weight: 600;
    }

    .mobile-nav a.active {
      color: var(--action);
    }

    .mobile-nav .button {
      margin-top: 16px;
    }

    .mobile-account {
      display: grid;
      min-height: 58px;
      align-items: center;
      grid-template-columns: 34px 1fr;
      gap: 8px;
      margin-bottom: 8px;
      padding: 9px 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--paper);
    }

    .mobile-account > span {
      display: grid;
      width: 32px;
      height: 32px;
      place-items: center;
      border-radius: 50%;
      color: var(--paper-strong);
      background: var(--action);
    }

    .mobile-account div {
      display: grid;
    }

    .mobile-account small {
      color: var(--ink-faint);
      font-size: 0.62rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .mobile-account strong {
      font-size: 0.8rem;
    }

    .mobile-logout {
      margin-top: 8px;
    }

    .mobile-logout .logout-button {
      width: 100%;
      min-height: 44px;
      margin-top: 0;
      border: 1px solid var(--line);
      background: transparent;
    }
  }

  @media (max-width: 480px) {
    .brand-lockup strong {
      font-size: 0.7rem;
    }

    .brand-lockup small {
      display: none;
    }
  }
</style>
