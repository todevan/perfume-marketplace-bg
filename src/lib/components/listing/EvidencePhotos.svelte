<script lang="ts">
	import { getEvidenceRoles, uniqueSelectedEvidenceCount } from './evidence';
	import type { ListingKind, PhotoMap, ProductFormat } from './types';

	let {
		productFormat,
		sealed,
		listingKind,
		photos = $bindable({}),
		invalid = false,
		errorId
	}: {
		productFormat: ProductFormat;
		sealed: boolean;
		listingKind: ListingKind;
		photos?: PhotoMap;
		invalid?: boolean;
		errorId?: string;
	} = $props();

	function roles() {
		return getEvidenceRoles(productFormat, sealed, listingKind);
	}

	function selectedCount(): number {
		return uniqueSelectedEvidenceCount(roles(), photos);
	}

	function selectFile(key: string, event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		photos[key] = input.files?.[0] ?? null;
	}

	function fileSize(file: File): string {
		if (file.size < 1024 * 1024) return `${Math.max(1, Math.round(file.size / 1024))} KB`;
		return `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<div class="evidence-heading">
	<div>
		<p class="eyebrow">Снимки от теб, без каталогови изображения</p>
		<h3>{listingKind === 'offer' ? 'Четири различни доказателства' : 'Ориентировъчна снимка'}</h3>
		<p>
			{listingKind === 'offer'
				? 'Всеки кадър има отделна роля. Така купувачите виждат реалния продукт, а сигналите се разглеждат по-бързо.'
				: 'Снимката не е задължителна. Не използвай чужди продуктови или рекламни изображения.'}
		</p>
	</div>
	<div class="counter" class:complete={listingKind === 'wanted' || selectedCount() === roles().length}>
		<strong>{selectedCount()}</strong>
		<span>от {roles().length}</span>
	</div>
</div>

<div class="privacy-note">
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<path d="M12 3 5 6v5c0 4.6 2.9 8.7 7 10 4.1-1.3 7-5.4 7-10V6l-7-3Z" />
		<path d="M9.5 12.2 11.2 14l3.6-4" />
	</svg>
	<span>При качване премахваме GPS/EXIF данните. Не показвай адрес, лични документи или товарителници.</span>
</div>

<div class="photo-grid">
	{#each roles() as role, index (role.key)}
		<div class="photo-card" class:has-file={Boolean(photos[role.key])}>
			<div class="photo-number" aria-hidden="true">{index + 1}</div>
			<div class="photo-copy">
				<label for={`evidence-${role.key}`}>{role.title}</label>
				<p>{role.helper}</p>
			</div>

			{#if photos[role.key]}
				<div class="file-chip">
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="m5 13 4-4 3 3 2-2 5 5" />
						<rect x="3" y="4" width="18" height="16" rx="2" />
					</svg>
					<span>
						<strong>{photos[role.key]?.name}</strong>
						<small>{fileSize(photos[role.key] as File)}</small>
					</span>
				</div>
			{/if}

			<input
				id={`evidence-${role.key}`}
				type="file"
				accept="image/jpeg,image/png,image/webp"
				required={listingKind === 'offer'}
				aria-invalid={invalid ? 'true' : undefined}
				aria-describedby={invalid ? errorId : undefined}
				onchange={(event) => selectFile(role.key, event)}
			/>
		</div>
	{/each}
</div>

{#if listingKind === 'offer' && selectedCount() < roles().length}
	<p class="requirement">
		Нужни са {roles().length} различни файла във формат JPG, PNG или WebP. Една и съща снимка не може да
		покрива две роли.
	</p>
{:else if listingKind === 'offer'}
	<p class="requirement success">Всички нужни кадри са добавени.</p>
{/if}

<style>
	.evidence-heading {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 1rem;
		align-items: start;
	}

	.eyebrow {
		margin: 0 0 0.35rem;
		color: var(--cta, #4a3126);
		font-size: 0.76rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	h3 {
		margin: 0;
		color: var(--text, #241c16);
		font: italic 700 clamp(1.2rem, 3vw, 1.55rem)/1.2 Arial, sans-serif;
	}

	.evidence-heading p:last-child {
		max-width: 42rem;
		margin: 0.5rem 0 0;
		color: var(--text-muted, #67584d);
		line-height: 1.55;
	}

	.counter {
		display: grid;
		place-items: center;
		min-width: 4.25rem;
		min-height: 4.25rem;
		border: 1px solid var(--border-strong, #b7a58f);
		border-radius: 50%;
		background: var(--panel, #d6caba);
		color: var(--text, #241c16);
		line-height: 1;
	}

	.counter strong {
		font-size: 1.2rem;
	}

	.counter span {
		font-size: 0.72rem;
	}

	.counter.complete {
		border-color: var(--success, #276749);
		background: color-mix(in srgb, var(--success, #276749) 12%, var(--surface, #fffaf3));
		color: var(--success, #276749);
	}

	.privacy-note {
		display: flex;
		gap: 0.65rem;
		align-items: flex-start;
		margin: 1.25rem 0;
		padding: 0.8rem 0.9rem;
		border-left: 3px solid var(--focus, #1f5c73);
		border-radius: 0 0.75rem 0.75rem 0;
		background: color-mix(in srgb, var(--focus, #1f5c73) 8%, var(--surface, #fffaf3));
		color: var(--text-muted, #67584d);
		font-size: 0.84rem;
		line-height: 1.45;
	}

	.privacy-note svg,
	.file-chip svg {
		flex: 0 0 auto;
		width: 1.25rem;
		height: 1.25rem;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.8;
	}

	.photo-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.85rem;
	}

	.photo-card {
		position: relative;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.75rem;
		align-content: start;
		min-width: 0;
		padding: 1rem;
		border: 1px dashed var(--border-strong, #b7a58f);
		border-radius: 1rem;
		background: color-mix(in srgb, var(--surface, #fffaf3) 78%, transparent);
		transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
	}

	.photo-card:focus-within,
	.photo-card:hover {
		border-color: var(--cta, #4a3126);
		box-shadow: 0 8px 24px rgb(54 38 29 / 0.08);
	}

	.photo-card.has-file {
		border-style: solid;
		border-color: color-mix(in srgb, var(--success, #276749) 55%, var(--border, #d8cbbb));
		background: color-mix(in srgb, var(--success, #276749) 5%, var(--surface, #fffaf3));
	}

	.photo-number {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: var(--accent-soft, #f3dfbf);
		color: var(--cta, #4a3126);
		font-weight: 700;
	}

	.photo-copy {
		min-width: 0;
	}

	.photo-copy label {
		display: inline-block;
		color: var(--text, #241c16);
		font-weight: 700;
		cursor: pointer;
	}

	.photo-copy p {
		margin: 0.3rem 0 0;
		color: var(--text-muted, #67584d);
		font-size: 0.8rem;
		line-height: 1.4;
	}

	.photo-card input[type='file'] {
		grid-column: 1 / -1;
		width: 100%;
		min-height: 2.75rem;
		color: var(--text-muted, #67584d);
		font: 400 0.82rem Arial, sans-serif;
		cursor: pointer;
	}

	.photo-card input[type='file']::file-selector-button {
		min-height: 2.75rem;
		margin-right: 0.7rem;
		padding: 0 0.85rem;
		border: 1px solid var(--border-strong, #b7a58f);
		border-radius: 0.65rem;
		background: var(--surface, #fffaf3);
		color: var(--text, #241c16);
		font-weight: 700;
		cursor: pointer;
	}

	.photo-card input[type='file']:focus-visible {
		outline: 3px solid var(--focus, #1f5c73);
		outline-offset: 3px;
	}

	.file-chip {
		grid-column: 1 / -1;
		display: flex;
		gap: 0.55rem;
		align-items: center;
		min-width: 0;
		padding: 0.55rem 0.65rem;
		border-radius: 0.65rem;
		background: var(--surface, #fffaf3);
		color: var(--success, #276749);
	}

	.file-chip span,
	.file-chip strong,
	.file-chip small {
		display: block;
		min-width: 0;
	}

	.file-chip span {
		overflow: hidden;
	}

	.file-chip strong {
		overflow: hidden;
		color: var(--text, #241c16);
		font-size: 0.8rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-chip small {
		margin-top: 0.1rem;
		color: var(--text-muted, #67584d);
	}

	.requirement {
		margin: 1rem 0 0;
		color: var(--warning-text, #6c4100);
		font-size: 0.85rem;
		line-height: 1.45;
	}

	.requirement.success {
		color: var(--success, #276749);
		font-weight: 700;
	}

	@media (max-width: 650px) {
		.photo-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 420px) {
		.evidence-heading {
			grid-template-columns: 1fr;
		}

		.counter {
			grid-auto-flow: column;
			place-items: center;
			justify-content: center;
			gap: 0.25rem;
			width: fit-content;
			min-width: 5rem;
			min-height: 2.75rem;
			border-radius: 999px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.photo-card {
			transition: none;
		}
	}
</style>
