<script lang="ts">
	import { ArrowLeft, ArrowRight, Layers3, Search, Sparkles } from '@lucide/svelte';
	import {
		brandSlug,
		catalogCollections,
		catalogCollectionKeys,
		normalizeBrandSearch,
		type CatalogBrand,
		type CatalogCollection
	} from '$lib/data/catalog';

	let { data }: { data: { collection: CatalogCollection } } = $props();
	let query = $state('');
	let activeLetter = $state('all');

	const firstLetter = (brand: CatalogBrand) =>
		brand.canonicalName.slice(0, 1).toLocaleUpperCase('bg-BG');
	const letters = $derived(
		[...new Set(data.collection.brands.map(firstLetter))].sort((left, right) =>
			left.localeCompare(right, 'bg-BG')
		)
	);
	const filteredBrands = $derived.by(() => {
		const searchKey = normalizeBrandSearch(query);
		return data.collection.brands.filter((brand) => {
			const matchesLetter = activeLetter === 'all' || firstLetter(brand) === activeLetter;
			if (!matchesLetter) return false;
			if (!searchKey) return true;

			return [brand.canonicalName, ...brand.aliases.map((alias) => alias.value)].some((value) =>
				normalizeBrandSearch(value).includes(searchKey)
			);
		});
	});

	$effect(() => {
		data.collection.key;
		query = '';
		activeLetter = 'all';
	});

	function clearFilters() {
		query = '';
		activeLetter = 'all';
	}
</script>

<svelte:head>
	<title>{data.collection.label} марки · Парфюмен каталог</title>
	<meta
		name="description"
		content={`${data.collection.expectedBrandCount} подбрани ${data.collection.label.toLocaleLowerCase('bg-BG')} парфюмни марки в българския marketplace.`}
	/>
</svelte:head>

<section class="collection-hero">
	<div class="hero-ring ring-one" aria-hidden="true"></div>
	<div class="hero-ring ring-two" aria-hidden="true"></div>
	<div class="container hero-grid">
		<div class="hero-copy">
			<a class="back-link" href="/#categories"><ArrowLeft size={17} /> Всички категории</a>
			<span class="eyebrow">Редакционна витрина · {data.collection.expectedBrandCount} марки</span>
			<h1>{data.collection.label}</h1>
			<p>{data.collection.intro}</p>
		</div>

		<div class="hero-mark" aria-hidden="true">
			<span>{data.collection.glyph}</span>
			<small>{data.collection.dimension === 'audience' ? 'AUDIENCE' : 'SEGMENT'} · CURATED</small>
		</div>
	</div>
</section>

<nav class="collection-nav" aria-label="Категории марки">
	<div class="container">
		{#each catalogCollectionKeys as key}
			<a href={`/brands/${key}`} aria-current={key === data.collection.key ? 'page' : undefined}>
				{catalogCollections[key].label}
				<span>{catalogCollections[key].expectedBrandCount}</span>
			</a>
		{/each}
	</div>
</nav>

<section class="section" aria-label={data.collection.label}>
	<div class="container">
		<div class="collection-heading">
			<div>
				<span class="eyebrow">Каноничен каталог</span>
				<h2>{data.collection.description}</h2>
			</div>
			<p>
				Търси по канонично име, познато изписване или транслитерация. Всяка марка води към
				собствената си страница с активни обяви.
			</p>
		</div>

		<div class="catalog-tools surface">
			<label class="search-field">
				<span>Търси марка в тази витрина</span>
				<span class="search-input">
					<Search size={19} aria-hidden="true" />
					<input bind:value={query} type="search" placeholder="Например Dior, MFK или Lattafa" />
				</span>
			</label>

			<div class="letter-filter">
				<span id="letter-filter-label">Филтрирай по начална буква</span>
				<div role="group" aria-labelledby="letter-filter-label">
					<button
						class:active={activeLetter === 'all'}
						aria-pressed={activeLetter === 'all'}
						onclick={() => (activeLetter = 'all')}>Всички</button
					>
					{#each letters as letter}
						<button
							class:active={activeLetter === letter}
							aria-pressed={activeLetter === letter}
							onclick={() => (activeLetter = letter)}
						>
							{letter}
						</button>
					{/each}
				</div>
			</div>
		</div>

		<div class="result-line" aria-live="polite">
			<strong>{filteredBrands.length}</strong>
			<span>{filteredBrands.length === 1 ? 'намерена марка' : 'намерени марки'}</span>
		</div>

		{#if filteredBrands.length > 0}
			<div class="brand-grid">
				{#each filteredBrands as brand, index (brand.id)}
					<a class="brand-card" href={`/brand/${brandSlug(brand)}`}>
						<span class="brand-index">{String(index + 1).padStart(2, '0')}</span>
						<span class="monogram" aria-hidden="true">{brand.canonicalName.slice(0, 2)}</span>
						<span class="brand-copy">
							<strong>{brand.canonicalName}</strong>
							<small>
								{brand.aliases.length > 0
									? `${brand.aliases.length} ${brand.aliases.length === 1 ? 'познато изписване' : 'познати изписвания'}`
									: 'Канонично име'}
							</small>
						</span>
						<ArrowRight class="card-arrow" size={19} aria-hidden="true" />
					</a>
				{/each}
			</div>
		{:else}
			<div class="empty-state">
				<Search size={32} aria-hidden="true" />
				<h2>Няма съвпадение в тази витрина.</h2>
				<p class="muted">Провери изписването или покажи отново всички подбрани марки.</p>
				<button class="button secondary" onclick={clearFilters}>Изчисти филтрите</button>
			</div>
		{/if}
	</div>
</section>

<section class="catalog-note">
	<div class="container note-grid">
		<div class="note-icon"><Layers3 size={28} aria-hidden="true" /></div>
		<div>
			<span class="eyebrow">Как работят витрините</span>
			<h2>Припокриването е умишлено.</h2>
		</div>
		<p>
			Една марка може да присъства в няколко редакционни колекции. Това не определя
			автоматично категорията на конкретен парфюм — продавачът я задава при публикуване на
			обявата.
		</p>
		<a class="button primary" href="/publish"><Sparkles size={17} /> Публикувай обява</a>
	</div>
	<div class="container other-note">
		<strong>Не откриваш марката?</strong>
		<span>Избери „Други“ при публикуване и напиши името свободно. Обявата се публикува веднага и се отбелязва за каталогизация.</span>
	</div>
</section>

<style>
	.collection-hero {
		position: relative;
		display: grid;
		min-height: 450px;
		align-items: center;
		overflow: hidden;
		border-bottom: 1px solid var(--line);
		background: var(--paper);
	}

	.hero-grid {
		display: grid;
		align-items: center;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: clamp(40px, 8vw, 110px);
		padding-block: 64px;
	}

	.hero-copy {
		position: relative;
		z-index: 1;
		display: grid;
		justify-items: start;
	}

	.back-link {
		display: inline-flex;
		min-height: 44px;
		align-items: center;
		gap: 7px;
		margin-bottom: 28px;
		color: var(--ink-soft);
		font-size: 0.78rem;
		font-weight: 700;
	}

	.collection-hero h1 {
		margin-block: 12px 18px;
		font-size: clamp(3.5rem, 8vw, 6.25rem);
		font-style: normal;
		line-height: 0.92;
		letter-spacing: -0.06em;
	}

	.collection-hero p {
		max-width: 660px;
		margin: 0;
		color: var(--ink-soft);
		font-size: clamp(1rem, 2vw, 1.2rem);
	}

	.hero-mark {
		position: relative;
		display: grid;
		width: 290px;
		height: 310px;
		place-items: center;
		border: 1px solid var(--action);
		border-radius: 6px;
		color: var(--paper-strong);
		background: var(--action);
		justify-self: end;
	}

	.hero-mark span {
		font-size: 6rem;
		font-weight: 700;
		font-style: normal;
	}

	.hero-mark small {
		position: absolute;
		right: 18px;
		bottom: 17px;
		color: rgb(255 253 249 / 70%);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.17em;
	}

	.hero-ring {
		display: none;
	}

	.ring-one {
		top: -490px;
		right: -260px;
		width: 860px;
		height: 860px;
	}

	.ring-two {
		bottom: -420px;
		left: -260px;
		width: 650px;
		height: 650px;
	}

	.collection-nav {
		position: sticky;
		top: var(--header-height);
		z-index: 8;
		border-bottom: 1px solid var(--line);
		background: var(--paper-strong);
	}

	.collection-nav .container {
		display: flex;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.collection-nav .container::-webkit-scrollbar {
		display: none;
	}

	.collection-nav a {
		display: inline-flex;
		min-width: max-content;
		min-height: 58px;
		align-items: center;
		gap: 8px;
		padding-inline: 22px;
		border-bottom: 2px solid transparent;
		color: var(--ink-soft);
		font-size: 0.8rem;
		font-weight: 700;
		font-style: normal;
	}

	.collection-nav a[aria-current='page'] {
		border-color: var(--action);
		color: var(--action);
		background: var(--brand-secondary);
	}

	.collection-nav a span {
		color: var(--ink-faint);
		font-size: 0.66rem;
		font-style: normal;
	}

	.collection-heading {
		display: grid;
		align-items: end;
		grid-template-columns: minmax(0, 1fr) minmax(280px, 0.65fr);
		gap: 44px;
		margin-bottom: 34px;
	}

	.collection-heading h2 {
		max-width: 760px;
		margin-bottom: 0;
	}

	.collection-heading p {
		margin: 0;
		color: var(--ink-soft);
	}

	.catalog-tools {
		display: grid;
		gap: 26px;
		padding: clamp(20px, 4vw, 34px);
		border-color: var(--line);
		border-radius: 6px;
		background: var(--paper-strong);
	}

	.search-field,
	.letter-filter {
		display: grid;
		gap: 10px;
	}

	.search-field > span:first-child,
	.letter-filter > span {
		color: var(--ink-soft);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.03em;
	}

	.search-input {
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-input :global(svg) {
		position: absolute;
		left: 16px;
		z-index: 1;
		color: var(--ink-faint);
		pointer-events: none;
	}

	.search-input input {
		width: 100%;
		min-height: 52px;
		padding: 12px 16px 12px 48px;
		border: 1px solid var(--line-strong);
		border-radius: 4px;
		color: var(--ink);
		background: var(--paper);
		font: inherit;
	}

	.search-input input:focus-visible {
		border-color: var(--action);
		outline: 2px solid var(--action);
		outline-offset: 2px;
	}

	.letter-filter > div {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
	}

	.letter-filter button {
		min-width: 44px;
		min-height: 44px;
		padding-inline: 12px;
		border: 1px solid var(--line);
		border-radius: 4px;
		color: var(--ink-soft);
		background: var(--paper);
		font: inherit;
		font-size: 0.72rem;
		font-weight: 700;
		cursor: pointer;
	}

	.letter-filter button.active {
		border-color: var(--action);
		color: var(--brand-secondary);
		background: var(--action);
	}

	.result-line {
		display: flex;
		align-items: baseline;
		gap: 7px;
		min-height: 66px;
		padding-top: 22px;
		color: var(--ink-soft);
		font-size: 0.74rem;
	}

	.result-line strong {
		color: var(--ink);
		font-size: 1.2rem;
		font-style: normal;
	}

	.brand-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
	}

	.brand-card {
		position: relative;
		display: grid;
		min-height: 210px;
		align-content: space-between;
		padding: 19px;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--paper-strong);
		transition: border-color 180ms ease, background 180ms ease;
	}

	.brand-card:hover {
		border-color: var(--action);
		background: var(--paper);
	}

	.brand-index {
		position: relative;
		z-index: 1;
		color: var(--ink-faint);
		font-size: 0.66rem;
		letter-spacing: 0.1em;
	}

	.monogram {
		position: absolute;
		top: 17px;
		right: 14px;
		color: rgb(74 49 38 / 8%);
		font-size: 5rem;
		font-weight: 700;
		font-style: normal;
		line-height: 0.9;
		text-transform: uppercase;
	}

	.brand-copy {
		position: relative;
		z-index: 1;
		display: grid;
		gap: 4px;
		padding-right: 28px;
	}

	.brand-copy strong {
		font-size: 1.05rem;
		font-style: normal;
		line-height: 1.2;
	}

	.brand-copy small {
		color: var(--ink-faint);
		font-size: 0.66rem;
	}

	:global(.card-arrow) {
		position: absolute;
		right: 17px;
		bottom: 18px;
		transition: transform 180ms ease;
	}

	.brand-card:hover :global(.card-arrow) {
		transform: translateX(3px);
	}

	.catalog-note {
		padding-block: 64px 30px;
		color: var(--brand-secondary);
		background: var(--ink);
	}

	.note-grid {
		display: grid;
		align-items: center;
		grid-template-columns: 58px minmax(230px, 0.8fr) minmax(320px, 1.2fr) auto;
		gap: 30px;
	}

	.note-icon {
		display: grid;
		width: 54px;
		height: 54px;
		place-items: center;
		border: 1px solid rgb(244 236 225 / 20%);
		border-radius: 4px;
		color: var(--brand-main);
	}

	.catalog-note .eyebrow,
	.catalog-note p,
	.other-note span {
		color: rgb(244 236 225 / 62%);
	}

	.catalog-note h2 {
		margin: 4px 0 0;
		font-size: clamp(1.8rem, 4vw, 2.5rem);
	}

	.catalog-note p {
		margin: 0;
	}

	.catalog-note .button.primary {
		color: var(--ink);
		background: var(--brand-main);
	}

	.other-note {
		display: flex;
		gap: 12px;
		margin-top: 42px;
		padding-top: 25px;
		border-top: 1px solid rgb(244 236 225 / 14%);
		font-size: 0.78rem;
	}

	@media (max-width: 1100px) {
		.brand-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.note-grid {
			grid-template-columns: 58px 1fr 1fr;
		}

		.note-grid .button {
			grid-column: 2;
			justify-self: start;
		}
	}

	@media (max-width: 820px) {
		.hero-grid,
		.collection-heading {
			grid-template-columns: 1fr;
		}

		.hero-mark {
			display: none;
		}

		.brand-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.note-grid {
			align-items: start;
			grid-template-columns: 54px 1fr;
		}

		.note-grid p,
		.note-grid .button {
			grid-column: 2;
		}
	}

	@media (max-width: 520px) {
		.collection-hero {
			min-height: 390px;
		}

		.collection-hero h1 {
			font-size: clamp(3.8rem, 20vw, 6rem);
		}

		.collection-nav .container {
			width: 100%;
		}

		.brand-grid {
			grid-template-columns: 1fr;
		}

		.brand-card {
			min-height: 174px;
		}

		.note-grid {
			grid-template-columns: 1fr;
		}

		.note-grid p,
		.note-grid .button {
			grid-column: 1;
		}

		.other-note {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
