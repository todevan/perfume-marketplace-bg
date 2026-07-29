<script lang="ts">
  import type { Component, Snippet } from 'svelte';
  import {
    ArrowLeft,
    BadgeCheck,
    Bell,
    ChartNoAxesColumnIncreasing,
    CircleHelp,
    Heart,
    ListPlus,
    MessageCircle,
    PackageCheck,
    Repeat2,
    Search,
    Settings,
    ShieldCheck,
    Star
  } from '@lucide/svelte';

  export type MemberShellMode = 'standard' | 'workspace' | 'focus';

  interface MemberAuth {
    profile: {
      username: string;
      phoneVerifiedAt: string | null;
    } | null;
  }

  interface NavigationItem {
    label: string;
    href: string;
    icon: Component;
    match?: string;
  }

  interface Props {
    auth: MemberAuth;
    pathname: string;
    mode?: MemberShellMode;
    demoMode?: boolean;
    children?: Snippet;
  }

  let {
    auth,
    pathname,
    mode = 'standard',
    demoMode = false,
    children
  }: Props = $props();

  const navigation: NavigationItem[] = [
    { label: 'Преглед', href: '/dashboard', icon: ChartNoAxesColumnIncreasing, match: '/dashboard' },
    { label: 'Моите обяви', href: '/dashboard', icon: PackageCheck },
    { label: 'Оферти', href: '/offers', icon: Repeat2, match: '/offers' },
    { label: 'Сделки', href: '/deals', icon: PackageCheck, match: '/deals' },
    { label: 'Съобщения', href: '/messages', icon: MessageCircle, match: '/messages' },
    { label: 'Любими', href: '/favorites', icon: Heart, match: '/favorites' },
    { label: 'Запазени търсения', href: '/saved-searches', icon: Search, match: '/saved-searches' },
    { label: 'Отзиви', href: '/dashboard', icon: Star },
    { label: 'Известия', href: '/notifications', icon: Bell, match: '/notifications' },
    { label: 'Настройки', href: '/settings', icon: Settings, match: '/settings' }
  ];

  let username = $derived(auth.profile?.username ?? (demoMode ? 'demo_user' : 'Моят профил'));
  let phoneVerified = $derived(demoMode || Boolean(auth.profile?.phoneVerifiedAt));
  let initial = $derived(username.slice(0, 1).toLocaleUpperCase('bg-BG'));

  function isActive(item: NavigationItem): boolean {
    return item.match ? pathname === item.match || pathname.startsWith(`${item.match}/`) : false;
  }
</script>

<div class:standard={mode === 'standard'} class:workspace={mode === 'workspace'} class:focus={mode === 'focus'} class="member-shell" data-member-mode={mode}>
  {#if mode === 'standard'}
    <div class="standard-frame">
      <aside class="member-rail" aria-label="Потребителска зона">
        <div class="member-profile">
          <span class="member-avatar" aria-hidden="true">{initial}</span>
          <span class="member-identity">
            <strong>{username}</strong>
            <small class:pending={!phoneVerified}>
              <BadgeCheck size={14} />
              {phoneVerified ? 'Телефонът е потвърден' : 'Телефонът чака потвърждение'}
            </small>
          </span>
        </div>

        <nav aria-label="Потребителска зона">
          {#each navigation as item}
            {@const Icon = item.icon}
            <a class:active={isActive(item)} aria-current={isActive(item) ? 'page' : undefined} href={item.href}>
              <Icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
            </a>
          {/each}
        </nav>

        <div class="member-rail-footer">
          <a class="publish-link" href="/publish"><ListPlus size={18} /> Нова обява</a>
          <a class="help-link" href="/safety"><CircleHelp size={17} /> Помощ и безопасност</a>
        </div>
      </aside>

      <div class="standard-content">
        {#if children}{@render children()}{/if}
      </div>
    </div>
  {:else if mode === 'workspace'}
    <div class="workspace-frame">
      <nav class="workspace-bar" aria-label="Навигация в работното пространство">
        <a class="workspace-back" href="/dashboard"><ArrowLeft size={18} /> Личен панел</a>
        <div class="workspace-title">
          <span aria-hidden="true"><MessageCircle size={18} /></span>
          <strong>Съобщения</strong>
          <small>Частно работно пространство</small>
        </div>
        <div class="workspace-links">
          <a href="/offers">Оферти</a>
          <a href="/deals">Сделки</a>
        </div>
      </nav>
      <div class="workspace-content">
        {#if children}{@render children()}{/if}
      </div>
    </div>
  {:else}
    <div class="focus-frame">
      <nav class="focus-bar" aria-label="Навигация при публикуване">
        <a href="/dashboard"><ArrowLeft size={18} /> Към личния панел</a>
        <div>
          <small>Фокус режим</small>
          <strong>Нова обява</strong>
        </div>
        <span class="focus-trust"><ShieldCheck size={17} /> Защитено публикуване</span>
      </nav>
      <div class="focus-content">
        {#if children}{@render children()}{/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .member-shell {
    --member-walnut: #2b201a;
    --member-taupe: #ad9d8b;
    --member-cream: #f4ece1;
    --member-ivory: #fffdf9;
    --member-burgundy: #751d2b;
    color: var(--ink);
    background: var(--member-cream);
    font-family: inherit;
    font-style: normal;
  }

  .standard-frame {
    display: grid;
    width: min(calc(100% - 40px), var(--content));
    min-height: 72vh;
    margin-inline: auto;
    grid-template-columns: 246px minmax(0, 1fr);
    gap: clamp(24px, 3vw, 44px);
    padding-block: 32px 88px;
  }

  .member-rail {
    position: sticky;
    top: calc(var(--header-height) + 22px);
    display: grid;
    max-height: calc(100vh - var(--header-height) - 44px);
    align-self: start;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
    border: 1px solid #3d3028;
    border-radius: var(--radius-md);
    color: var(--member-ivory);
    background: var(--member-walnut);
  }

  .member-profile {
    display: grid;
    min-width: 0;
    align-items: center;
    grid-template-columns: 42px minmax(0, 1fr);
    gap: 11px;
    padding: 17px;
    border-bottom: 1px solid rgb(255 253 249 / 15%);
  }

  .member-avatar {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    border: 1px solid rgb(255 253 249 / 22%);
    border-radius: 50%;
    color: var(--member-ivory);
    background: var(--member-burgundy);
    font-weight: 700;
  }

  .member-identity {
    display: grid;
    min-width: 0;
  }

  .member-identity strong {
    overflow: hidden;
    font-size: 0.82rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .member-identity small {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #b9d1c0;
    font-size: 0.59rem;
    line-height: 1.35;
  }

  .member-identity small.pending {
    color: #e5c895;
  }

  .member-rail nav {
    display: grid;
    align-content: start;
    gap: 2px;
    padding: 10px;
    overflow-y: auto;
  }

  .member-rail nav a {
    display: grid;
    min-height: 44px;
    align-items: center;
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 9px;
    padding: 9px 11px;
    border-radius: var(--radius-xs);
    color: rgb(255 253 249 / 70%);
    font-size: 0.74rem;
    font-weight: 650;
  }

  .member-rail nav a:hover {
    color: var(--member-ivory);
    background: rgb(255 253 249 / 8%);
  }

  .member-rail nav a.active {
    color: var(--member-walnut);
    background: var(--member-ivory);
  }

  .member-rail-footer {
    display: grid;
    gap: 8px;
    padding: 12px;
    border-top: 1px solid rgb(255 253 249 / 15%);
  }

  .publish-link,
  .help-link {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    gap: 8px;
    padding: 9px 11px;
    border-radius: var(--radius-xs);
    font-size: 0.7rem;
    font-weight: 650;
  }

  .publish-link {
    justify-content: center;
    color: var(--member-ivory);
    background: var(--member-burgundy);
  }

  .help-link {
    color: rgb(255 253 249 / 70%);
  }

  .standard-content {
    min-width: 0;
  }

  .standard-content :global(.container) {
    width: 100%;
    margin-inline: 0;
  }

  .workspace-frame {
    min-height: calc(100vh - var(--header-height));
    background: var(--paper-deep);
  }

  .workspace-bar,
  .focus-bar {
    display: grid;
    width: min(calc(100% - 40px), var(--content));
    min-height: 58px;
    align-items: center;
    margin-inline: auto;
    border-bottom: 1px solid var(--line-strong);
  }

  .workspace-bar {
    grid-template-columns: 1fr auto 1fr;
    gap: 18px;
  }

  .workspace-back,
  .focus-bar > a {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    gap: 7px;
    justify-self: start;
    color: var(--ink-soft);
    font-size: 0.72rem;
    font-weight: 700;
  }

  .workspace-title {
    display: grid;
    align-items: center;
    grid-template-columns: 34px auto;
    column-gap: 9px;
    text-align: left;
  }

  .workspace-title > span {
    display: grid;
    width: 34px;
    height: 34px;
    grid-row: 1 / 3;
    place-items: center;
    border-radius: 50%;
    color: var(--member-ivory);
    background: var(--member-burgundy);
  }

  .workspace-title strong {
    align-self: end;
    font-size: 0.78rem;
  }

  .workspace-title small {
    align-self: start;
    color: var(--ink-faint);
    font-size: 0.58rem;
  }

  .workspace-links {
    display: flex;
    gap: 8px;
    justify-self: end;
  }

  .workspace-links a {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    padding-inline: 10px;
    color: var(--ink-soft);
    font-size: 0.7rem;
    font-weight: 700;
  }

  .workspace-content :global(.container) {
    width: min(calc(100% - 40px), var(--content));
  }

  .focus-frame {
    min-height: 100vh;
    background: var(--member-cream);
  }

  .focus-bar {
    grid-template-columns: 1fr auto 1fr;
    gap: 18px;
  }

  .focus-bar > div {
    display: grid;
    justify-items: center;
  }

  .focus-bar small {
    color: var(--member-burgundy);
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .focus-bar strong {
    font-size: 0.78rem;
  }

  .focus-trust {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    justify-self: end;
    color: var(--success);
    font-size: 0.65rem;
    font-weight: 700;
  }

  @media (max-width: 1080px) {
    .standard-frame {
      grid-template-columns: 1fr;
      gap: 22px;
      padding-top: 22px;
    }

    .member-rail {
      position: relative;
      top: auto;
      max-height: none;
      grid-template-columns: 210px minmax(0, 1fr) auto;
      grid-template-rows: auto;
    }

    .member-profile {
      border-right: 1px solid rgb(255 253 249 / 15%);
      border-bottom: 0;
    }

    .member-rail nav {
      display: flex;
      align-items: center;
      padding: 7px;
      overflow-x: auto;
      overflow-y: hidden;
    }

    .member-rail nav a {
      min-width: max-content;
      border-bottom: 3px solid transparent;
      border-left: 0;
    }

    .member-rail nav a.active {
      border-bottom-color: var(--member-burgundy);
    }

    .member-rail-footer {
      display: flex;
      align-items: center;
      border-top: 0;
      border-left: 1px solid rgb(255 253 249 / 15%);
    }

    .help-link {
      display: none;
    }
  }

  @media (max-width: 760px) {
    .standard-frame,
    .workspace-bar,
    .focus-bar {
      width: min(calc(100% - 28px), var(--content));
    }

    .standard-frame {
      padding-bottom: 64px;
    }

    .member-rail {
      grid-template-columns: 1fr auto;
    }

    .member-profile {
      display: none;
    }

    .member-rail-footer {
      grid-column: 2;
      grid-row: 1;
    }

    .member-rail nav {
      grid-column: 1;
      grid-row: 1;
    }

    .publish-link {
      width: 44px;
      padding: 0;
      font-size: 0;
    }

    .workspace-bar,
    .focus-bar {
      grid-template-columns: 1fr auto;
    }

    .workspace-title,
    .focus-bar > div {
      display: none;
    }

    .workspace-links,
    .focus-trust {
      grid-column: 2;
    }

    .workspace-content :global(.container) {
      width: 100%;
    }
  }

  @media (max-width: 480px) {
    .workspace-links a:last-child,
    .focus-trust {
      display: none;
    }
  }
</style>
