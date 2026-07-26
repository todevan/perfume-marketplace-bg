<script lang="ts">
	let { data, form } = $props();
	let verifyStep = $derived(form?.step === 'verify');
</script>

<svelte:head>
	<title>Потвърди телефон · Marketplace beta</title>
	<meta name="robots" content="noindex,nofollow" />
	{#if data.turnstileSiteKey && !data.demoMode}
		<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
	{/if}
</svelte:head>

<section class="section">
	<div class="container phone-card surface">
		<span class="eyebrow">Скрит контакт</span>
		<h1>{verifyStep ? 'Въведи получения код.' : 'Потвърди телефона си.'}</h1>
		<p>Телефонът не се показва публично. Нужен е преди първа обява или оферта.</p>
		{#if data.currentPhone}<p>Текущ номер: <strong>{data.currentPhone}</strong></p>{/if}
		{#if form?.message}<p class:success={form.success} role="status">{form.message}</p>{/if}

		{#if verifyStep}
			<form method="POST" action="?/verifyOtp">
				<input type="hidden" name="next" value={form?.next ?? data.next} />
				<input type="hidden" name="phone" value={form?.phone ?? ''} />
				<label for="phone-code">Шестцифрен код</label>
				<input id="phone-code" class="input" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required />
				<button class="button primary" type="submit">Потвърди телефона</button>
			</form>
			<form method="POST" action="?/resendOtp">
				<input type="hidden" name="next" value={form?.next ?? data.next} />
				<input type="hidden" name="phone" value={form?.phone ?? ''} />
				{#if data.turnstileSiteKey && !data.demoMode}
					<div class="cf-turnstile" data-sitekey={data.turnstileSiteKey} data-action="phone_change"></div>
				{/if}
				<button class="button secondary" type="submit">Изпрати нов код</button>
			</form>
		{:else}
			<form method="POST" action="?/requestOtp">
				<input type="hidden" name="next" value={data.next} />
				<label for="phone-number">Телефон в международен формат</label>
				<input id="phone-number" class="input" name="phone" type="tel" value={form?.phone ?? '+359'} autocomplete="tel" required />
				{#if data.turnstileSiteKey && !data.demoMode}
					<div class="cf-turnstile" data-sitekey={data.turnstileSiteKey} data-action="phone_change"></div>
				{/if}
				<button class="button primary" type="submit">Изпрати код</button>
			</form>
		{/if}
	</div>
</section>

<style>
	.phone-card { max-width: 640px; padding: clamp(28px, 6vw, 60px); }
	.phone-card > p { color: var(--ink-soft); }
	.phone-card p.success { color: var(--success); }
	form { display: grid; gap: 12px; margin-top: 24px; }
</style>
