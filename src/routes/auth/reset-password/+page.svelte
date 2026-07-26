<script lang="ts">
	let { data, form } = $props();
</script>

<svelte:head>
	<title>Нова парола · Marketplace beta</title>
	<meta name="robots" content="noindex,nofollow" />
	{#if data.turnstileSiteKey && !data.demoMode}
		<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
	{/if}
</svelte:head>

<section class="section">
	<div class="container auth-card surface">
		<span class="eyebrow">Възстановяване</span>
		<h1>Заяви нова парола.</h1>
		<p>Ще изпратим еднократна връзка, ако имейлът принадлежи на beta профил.</p>
		{#if form?.message}<p class:success={form.success} role="status">{form.message}</p>{/if}
		<form method="POST">
			<label for="reset-email">Имейл</label>
			<input id="reset-email" class="input" name="email" type="email" value={form?.email ?? ''} autocomplete="email" required />
			{#if data.turnstileSiteKey && !data.demoMode}
				<div class="cf-turnstile" data-sitekey={data.turnstileSiteKey} data-action="password_reset"></div>
			{/if}
			<button class="button primary" type="submit">Изпрати връзка</button>
		</form>
		<a href="/login">Назад към входа</a>
	</div>
</section>

<style>
	.auth-card { display: grid; gap: 16px; max-width: 620px; margin-inline: auto; padding: clamp(28px, 6vw, 58px); }
	.auth-card > p { color: var(--ink-soft); }
	.auth-card p.success { color: var(--success); }
	form { display: grid; gap: 12px; margin-block: 8px; }
</style>

