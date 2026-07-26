<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Проблем с входа · Marketplace beta</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<section class="section">
	<div class="container auth-message surface">
		<span class="eyebrow">Сигурен вход</span>
		<h1>Връзката не беше потвърдена.</h1>
		<p>{data.message}</p>
		<a class="button primary" href="/login">Към входа</a>
	</div>
</section>

<style>
	.auth-message { max-width: 680px; margin-inline: auto; padding: clamp(28px, 6vw, 64px); }
	.auth-message p { margin-block: 16px 28px; color: var(--ink-soft); }
</style>

