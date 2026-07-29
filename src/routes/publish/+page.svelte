<script lang="ts">
	import { page } from '$app/state';
	import type { ListingKind } from '$domain/types';
	import ListingWizard from '$lib/components/listing/ListingWizard.svelte';
	let { data } = $props();

	let initialKind: ListingKind = $derived(
		page.url.searchParams.get('kind') === 'wanted' ? 'wanted' : 'offer'
	);
</script>

<svelte:head>
	<title>Нова обява | Парфюмен marketplace</title>
	<meta
		name="description"
		content="Създай обява за продажба, размяна или търсене на парфюм в шест ясни стъпки."
	/>
	<meta name="robots" content="noindex,nofollow" />
	{#if data.turnstileSiteKey && !data.demoMode}
		<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
	{/if}
</svelte:head>

<section class="publish-page" aria-label="Създаване на обява">
	{#key initialKind}
		<ListingWizard
			{initialKind}
			catalogBrands={data.catalogBrands}
			phoneVerified={data.phoneVerified}
			initialCity={data.initialCity}
			turnstileSiteKey={data.turnstileSiteKey}
			demoMode={data.demoMode}
		/>
	{/key}
</section>

<style>
	.publish-page {
		min-height: 100vh;
		padding: clamp(1.5rem, 4vw, 3.25rem) clamp(0.75rem, 3vw, 2rem) clamp(3rem, 8vw, 6rem);
		background: var(--brand-secondary, #f4ece1);
		font-family: inherit;
		font-style: normal;
	}

	.publish-page :global(.wizard-shell),
	.publish-page :global(.wizard-shell *) {
		font-family: inherit !important;
		font-style: normal !important;
	}

	.publish-page :global(.wizard-shell form),
	.publish-page :global(.success-card),
	.publish-page :global(.brand-options),
	.publish-page :global(.choice-card),
	.publish-page :global(.photo-card),
	.publish-page :global(.primary-button) {
		box-shadow: none !important;
	}

	.publish-page :global(.hero-review) {
		background: var(--paper, #f8f3eb) !important;
	}
</style>
