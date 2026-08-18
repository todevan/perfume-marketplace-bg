<script lang="ts">import { Save, ShieldCheck } from '@lucide/svelte'; let { data, form } = $props(); const profile = $derived(form?.profile ?? data.profile);</script>
<svelte:head><title>Настройки на профила · Marketplace beta</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<section class="container page"><header><span class="eyebrow">Личен панел</span><h1>Профил и настройки</h1><p>Тук редактираш само публичните данни. Имейлът и телефонът не се показват.</p></header><form class="surface" method="POST">{#if form?.ok}<p class="success" role="status">Промените са запазени.</p>{:else if form?.error}<p class="error" role="alert">{form.error.message}</p>{/if}<label>Потребителско име<input name="username" minlength="3" maxlength="40" pattern="[A-Za-zА-Яа-я0-9_.-]+" value={profile?.username ?? ''} required /></label><label>Град<input name="city" minlength="2" maxlength="100" value={profile?.city ?? ''} required /></label><label>Описание<textarea name="bio" maxlength="1000" rows="7">{profile?.bio ?? ''}</textarea></label><div class="privacy"><ShieldCheck size={19} /><span>Публичният профил съдържа username, град, описание, рейтинг и история на потвърдените сделки.</span></div><button class="button primary" type="submit"><Save size={18} /> Запази</button></form></section>
<style>
  .page { max-width: 850px; min-height: 75vh; padding-block: 6px 0; font-family: inherit; }
  header { margin-bottom: 26px; padding-bottom: 1.6rem; border-bottom: 1px solid var(--line-strong); }
  header h1 { margin: .25rem 0 .5rem; font-size: clamp(2.45rem, 5vw, 4.4rem); }
  header p { margin: 0; color: var(--ink-soft); }
  form { display: grid; gap: 18px; padding: clamp(22px,5vw,42px); border-color: var(--line-strong); background: var(--paper-strong); }
  label { display: grid; gap: 7px; color: var(--ink-faint); font-size: .68rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
  input,textarea { width: 100%; padding: 13px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); color: var(--ink); background: var(--paper-strong); font: inherit; text-transform: none; }
  input:focus,textarea:focus { border-color: var(--action); outline: 3px solid rgb(117 29 43 / 14%); outline-offset: 1px; }
  textarea { resize: vertical; }
  .privacy { display: flex; align-items: flex-start; gap: 8px; padding: 13px; border: 1px solid var(--line); border-radius: var(--radius-sm); color: var(--ink-soft); background: var(--brand-main); font-size: .76rem; }
  .privacy :global(svg) { flex: 0 0 auto; color: var(--action); }
  .success { padding: 10px 12px; color: var(--success); background: var(--success-soft); }
  .error { padding: 10px 12px; color: var(--danger); background: var(--danger-soft); }
  form>.button { justify-self: start; }
</style>
