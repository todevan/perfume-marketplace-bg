<script lang="ts">
  import { ArrowRight, BadgeCheck, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Store, UserRound } from '@lucide/svelte';
  import ScentMark from '$components/ScentMark.svelte';

  interface TurnstileApi {
    render: (element: HTMLElement, options: { sitekey: string; action: 'login' | 'register' }) => string;
    remove: (widgetId: string) => void;
  }

  let { data, form } = $props();
  let mode = $state<'login' | 'register'>('login');
  let accountKind = $state<'private' | 'merchant'>('private');
  let showPassword = $state(false);
  let email = $state('');
  let password = $state('');
  let ageAccepted = $state(false);
  let loading = $state(false);
  let initialized = $state(false);
  let turnstileElement = $state<HTMLDivElement>();
  let turnstileScriptLoaded = $state(false);

  function turnstileApi(): TurnstileApi | undefined {
    return (window as Window & { turnstile?: TurnstileApi }).turnstile;
  }

  $effect(() => {
    const sitekey = data.turnstileSiteKey;
    const action = mode;
    if (data.demoMode || !sitekey || !turnstileElement) return;

    const turnstile = turnstileApi();
    if (!turnstile && !turnstileScriptLoaded) return;
    if (!turnstile) return;

    const widgetId = turnstile.render(turnstileElement, { sitekey, action });
    return () => turnstile.remove(widgetId);
  });

  $effect(() => {
    if (initialized) return;
    email = form?.email ?? data.demoEmail ?? '';
    password = data.demoMode ? 'demo-beta' : '';
    initialized = true;
  });
</script>

<svelte:head>
  <title>{mode === 'login' ? 'Вход' : 'Регистрация'} · Marketplace beta</title>
  <meta name="robots" content="noindex,nofollow" />
  {#if data.turnstileSiteKey && !data.demoMode}
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer onload={() => (turnstileScriptLoaded = true)}></script>
  {/if}
</svelte:head>

<section class="auth-page">
  <div class="auth-art">
    <div class="art-inner">
      <ScentMark size={68} inverted />
      <span class="eyebrow">Отворена регистрация</span>
      <h1>Колекцията ти заслужава подредена история.</h1>
      <div class="trust-points"><span><ShieldCheck size={20} /> Имейлът остава скрит</span><span><BadgeCheck size={20} /> Рейтинг само от потвърдени сделки</span><span><LockKeyhole size={20} /> Частни разговори с RLS защита</span></div>
      <p>Плащането и доставката за парфюма остават извън платформата.</p>
    </div>
  </div>

  <div class="auth-form-wrap">
    <div class="auth-form">
      <a class="mobile-mark" href="/" aria-label="Начало"><ScentMark size={48} /></a>
      <div class="mode-tabs"><button class:active={mode === 'login'} onclick={() => (mode = 'login')}>Вход</button><button class:active={mode === 'register'} onclick={() => (mode = 'register')}>Нова регистрация</button></div>

      <div class="form-heading"><span class="eyebrow">{mode === 'login' ? 'Добре дошъл обратно' : 'Отворена регистрация'}</span><h2>{mode === 'login' ? 'Влез в профила си.' : 'Създай профил.'}</h2><p>{mode === 'login' ? 'Продължи към обявите, офертите и разговорите си.' : 'Публично ще се вижда username, не личните ти контакти.'}</p></div>

      {#if mode === 'register'}
        <fieldset><legend>Вид профил</legend><div class="account-types"><label class:active={accountKind === 'private'}><input type="radio" name="kind" value="private" bind:group={accountKind} /><UserRound size={22} /><span><strong>Частно лице</strong><small>Колекция, продажба и размяна</small></span></label><label class:active={accountKind === 'merchant'}><input type="radio" name="kind" value="merchant" bind:group={accountKind} /><Store size={22} /><span><strong>Търговец</strong><small>Фирмени данни и проверка</small></span></label></div></fieldset>
      {/if}

      {#if form?.message}<p class="auth-feedback" class:success={form.success} role={form.success ? 'status' : 'alert'}>{form.message}</p>{/if}

      <form method="POST" action={mode === 'login' ? '?/login' : '?/register'} onsubmit={() => (loading = true)}>
        <input type="hidden" name="next" value={data.next} />
        {#if mode === 'register'}<input type="hidden" name="kind" value={accountKind} />{/if}
        {#if mode === 'register'}<div class="field"><label for="username">Потребителско име</label><div class="with-icon"><UserRound size={18} /><input id="username" class="input" name="username" autocomplete="username" placeholder="например scent_archive" required /></div></div>{/if}
        <div class="field"><label for="email">Имейл</label><div class="with-icon"><Mail size={18} /><input id="email" class="input" name="email" type="email" autocomplete="email" bind:value={email} required /></div></div>
        <div class="field"><label for="password">Парола</label><div class="with-icon password"><LockKeyhole size={18} /><input id="password" class="input" name="password" type={showPassword ? 'text' : 'password'} autocomplete={mode === 'login' ? 'current-password' : 'new-password'} bind:value={password} minlength={mode === 'register' ? 12 : 8} maxlength="128" required /><button type="button" onclick={() => (showPassword = !showPassword)} aria-label={showPassword ? 'Скрий паролата' : 'Покажи паролата'}>{#if showPassword}<EyeOff size={18} />{:else}<Eye size={18} />{/if}</button></div></div>
        {#if mode === 'register'}
          <label class="age-check"><input type="checkbox" name="ageAccepted" bind:checked={ageAccepted} required /><span>Потвърждавам, че съм навършил/а 18 години и приемам правилата.</span></label>
          {#if data.turnstileSiteKey && !data.demoMode}
            <div class="cf-turnstile" bind:this={turnstileElement} data-sitekey={data.turnstileSiteKey} data-action="register"></div>
          {/if}
        {:else}
          <div class="login-row"><span>Сесията се пази със защитена cookie.</span><a href="/auth/reset-password">Забравена парола?</a></div>
          {#if data.turnstileSiteKey && !data.demoMode}
            <div class="cf-turnstile" bind:this={turnstileElement} data-sitekey={data.turnstileSiteKey} data-action="login"></div>
          {/if}
        {/if}
        <button class="button primary submit" type="submit" disabled={loading || (mode === 'register' && !ageAccepted)}>{loading ? 'Проверка...' : mode === 'login' ? 'Влез в профила' : 'Създай профил'} <ArrowRight size={18} /></button>
      </form>

      {#if data.demoMode}
        <div class="demo-note"><strong>Демонстрационен вход</strong><span>Полето е предварително попълнено — натисни „Влез“, за да разгледаш dashboard-а.</span></div>
      {:else}
        <div class="demo-note"><strong>Регистрация с имейл и парола</strong><span>Всеки може да създаде профил. След регистрация потвърди имейла си и завърши профила.</span></div>
      {/if}
    </div>
  </div>
</section>

<style>
  .auth-page {
    display: grid;
    min-height: calc(100vh - var(--header-height));
    grid-template-columns: minmax(360px, 0.9fr) minmax(460px, 1.1fr);
  }

  .auth-art {
    position: relative;
    display: grid;
    place-items: center;
    overflow: hidden;
    padding: 60px;
    color: var(--brand-secondary);
    background: #2b201a;
  }

  .auth-art::after {
    display: none;
  }

  .art-inner {
    position: relative;
    z-index: 1;
    max-width: 560px;
  }

  .art-inner .eyebrow {
    display: flex;
    margin-top: 60px;
    color: rgb(244 236 225 / 54%);
  }

  .art-inner h1 {
    margin-bottom: 38px;
    color: var(--paper-strong);
    font-size: clamp(2.8rem, 5vw, 5rem);
  }

  .trust-points {
    display: grid;
    gap: 12px;
  }

  .trust-points span {
    display: flex;
    align-items: center;
    gap: 9px;
    color: rgb(244 236 225 / 78%);
    font-size: 0.84rem;
  }

  .art-inner > p {
    max-width: 430px;
    margin: 44px 0 0;
    color: rgb(244 236 225 / 45%);
    font-size: 0.72rem;
  }

  .auth-form-wrap {
    display: grid;
    place-items: center;
    padding: 50px 30px;
    background: var(--paper);
  }

  .auth-form {
    width: min(100%, 550px);
  }

  .mobile-mark {
    display: none;
    width: fit-content;
    margin-bottom: 25px;
  }

  .mode-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--paper-deep);
  }

  .mode-tabs button {
    min-height: 44px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 700;
  }

  .mode-tabs button.active {
    background: var(--paper-strong);
    color: var(--action);
  }


  .form-heading {
    margin-block: 38px 30px;
  }

  .form-heading .eyebrow {
    margin-bottom: 9px;
  }

  h2 {
    margin-bottom: 12px;
    font-size: clamp(2.4rem, 4vw, 3.7rem);
  }

  .form-heading p {
    margin: 0;
    color: var(--ink-soft);
  }

  fieldset {
    margin: 0 0 24px;
    padding: 0;
    border: 0;
  }

  legend {
    margin-bottom: 9px;
    color: var(--ink-soft);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .account-types {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .account-types label {
    display: grid;
    min-height: 86px;
    align-items: center;
    grid-template-columns: 28px 1fr;
    gap: 9px;
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: 11px;
    background: var(--paper-strong);
    cursor: pointer;
  }

  .account-types label.active {
    border: 2px solid var(--action);
    background: var(--action-soft);
  }

  .account-types label:has(input:focus-visible) {
    outline: 3px solid var(--action);
    outline-offset: 3px;
  }

  .account-types input {
    position: absolute;
    opacity: 0;
  }

  .account-types span {
    display: grid;
  }

  .account-types small {
    color: var(--ink-soft);
    font-size: 0.62rem;
  }

  form {
    display: grid;
    gap: 18px;
  }

  .with-icon {
    position: relative;
  }

  .with-icon > :global(svg) {
    position: absolute;
    top: 15px;
    left: 14px;
    z-index: 1;
    color: var(--ink-faint);
  }

  .with-icon .input {
    padding-left: 43px;
  }

  .password .input {
    padding-right: 48px;
  }

  .password button {
    position: absolute;
    top: 2px;
    right: 2px;
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  .age-check,
  .login-row {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 10px;
    color: var(--ink-soft);
    font-size: 0.72rem;
  }

  .age-check input {
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    accent-color: var(--action);
  }


  .submit {
    width: 100%;
  }

  .submit:disabled {
    cursor: not-allowed;
    opacity: 0.5;
    transform: none;
  }

  .demo-note {
    display: grid;
    margin-top: 22px;
    padding-top: 18px;
    border-top: 1px solid var(--line);
    color: var(--success);
    text-align: center;
  }

  .demo-note span {
    color: var(--ink-soft);
    font-size: 0.67rem;
  }

  @media (max-width: 900px) {
    .auth-page {
      grid-template-columns: 1fr;
    }

    .auth-art {
      display: none;
    }

    .mobile-mark {
      display: block;
    }
  }

  @media (max-width: 520px) {
    .auth-form-wrap {
      padding: 32px 18px 60px;
    }

    .account-types {
      grid-template-columns: 1fr;
    }
  }
</style>
