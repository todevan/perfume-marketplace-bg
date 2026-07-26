<script lang="ts">
	let { data, form } = $props();
</script>

<svelte:head>
	<title>Смени паролата · Marketplace beta</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<section class="section">
	<div class="container auth-card surface">
		<span class="eyebrow">Сигурност</span>
		<h1>Избери нова парола.</h1>
		{#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
		<form method="POST">
			<input type="hidden" name="next" value={data.next} />
			<label for="new-password">Нова парола</label>
			<input id="new-password" class="input" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required />
			<label for="new-password-confirmation">Повтори паролата</label>
			<input id="new-password-confirmation" class="input" name="passwordConfirmation" type="password" minlength="12" maxlength="128" autocomplete="new-password" required />
			<button class="button primary" type="submit">Запази паролата</button>
		</form>
	</div>
</section>

<style>
	.auth-card { display: grid; gap: 16px; max-width: 620px; margin-inline: auto; padding: clamp(28px, 6vw, 58px); }
	form { display: grid; gap: 12px; }
	.error { color: var(--danger, #8b1e1e); }
</style>

