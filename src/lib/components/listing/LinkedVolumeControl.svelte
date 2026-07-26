<script lang="ts">
	import {
		remainingPercent,
		remainingRatio,
		resizeBottle,
		roundMl,
		setRemainingMl,
		setRemainingPercent,
		setSealed
	} from '$domain/volume';

	let {
		bottleVolumeMl = $bindable(65),
		remainingMl = $bindable(29.9),
		sealed = $bindable(false),
		invalid = false,
		errorId
	}: {
		bottleVolumeMl?: number;
		remainingMl?: number;
		sealed?: boolean;
		invalid?: boolean;
		errorId?: string;
	} = $props();

	let previousOpenRatio = $state(0.46);

	const clamp = (value: number, minimum: number, maximum: number) =>
		Math.min(Math.max(value, minimum), maximum);

	function amount() {
		return { bottleVolumeMl, remainingMl, isSealed: sealed };
	}

	function ratio(): number {
		if (!Number.isFinite(bottleVolumeMl) || bottleVolumeMl <= 0) return 0;
		return remainingRatio(amount());
	}

	function percentage(): number {
		return remainingPercent(amount(), 1);
	}

	function conditionLabel(): string {
		if (sealed) return 'Запечатан';
		const value = percentage();
		if (value >= 100) return 'Отворен, пълен';
		if (value >= 90) return 'Отворен, почти пълен';
		if (value >= 70) return 'Леко използван';
		if (value >= 30) return 'Частично използван';
		if (value >= 1) return 'Силно използван';
		return 'Няма измерим остатък';
	}

	function parseNumber(value: string, fallback: number): number {
		const parsed = Number(value.replace(',', '.'));
		return Number.isFinite(parsed) ? parsed : fallback;
	}

	function changeBottle(value: string): void {
		const oldRatio = sealed ? 1 : ratio();
		const resized = resizeBottle(
			{ ...amount(), remainingMl: sealed ? bottleVolumeMl : roundMl(bottleVolumeMl * oldRatio) },
			parseNumber(value, bottleVolumeMl)
		);
		bottleVolumeMl = resized.bottleVolumeMl;
		remainingMl = resized.remainingMl;
	}

	function changeRemaining(value: string): void {
		const nextRemaining = setRemainingMl(amount(), parseNumber(value, remainingMl)).remainingMl;
		remainingMl = nextRemaining;
		if (!sealed && bottleVolumeMl > 0 && nextRemaining > 0) {
			previousOpenRatio = nextRemaining / bottleVolumeMl;
		}
	}

	function changePercentage(value: string): void {
		const nextPercentage = clamp(parseNumber(value, percentage()), 0, 100);
		remainingMl = setRemainingPercent(amount(), nextPercentage).remainingMl;
		if (!sealed && nextPercentage > 0) previousOpenRatio = nextPercentage / 100;
	}

	function toggleSealed(event: Event): void {
		const nextSealed = (event.currentTarget as HTMLInputElement).checked;
		if (nextSealed) {
			previousOpenRatio = ratio();
			const nextAmount = setSealed(amount(), true);
			sealed = nextAmount.isSealed;
			remainingMl = nextAmount.remainingMl;
			return;
		}

		sealed = false;
		remainingMl = roundMl(bottleVolumeMl * previousOpenRatio);
	}
</script>

<fieldset class="volume-card">
	<legend>Обем и остатък</legend>

	<div class="status-row">
		<span class="status-dot" aria-hidden="true"></span>
		<div>
			<span class="eyebrow">Автоматично състояние</span>
			<strong>{conditionLabel()}</strong>
		</div>
		<span class="percentage-pill">{percentage()}%</span>
	</div>

	<label class="switch-row">
		<span>
			<strong>Продуктът е фабрично запечатан</strong>
			<small>При запечатан продукт остатъкът е винаги 100%.</small>
		</span>
		<input type="checkbox" checked={sealed} onchange={toggleSealed} />
		<span class="switch" aria-hidden="true"></span>
	</label>

	<div class="control-block">
		<div class="control-heading">
			<label for="bottle-volume">Оригинален обем на флакона</label>
			<div class="number-unit">
				<input
					id="bottle-volume"
					type="number"
					min="0.1"
					max="500"
					step="0.1"
					inputmode="decimal"
					value={bottleVolumeMl}
					aria-invalid={invalid ? 'true' : undefined}
					aria-describedby={invalid ? errorId : undefined}
					oninput={(event) => changeBottle((event.currentTarget as HTMLInputElement).value)}
				/>
				<span>ml</span>
			</div>
		</div>
		<input
			class="range"
			type="range"
			min="0.1"
			max="500"
			step="0.1"
			value={bottleVolumeMl}
			oninput={(event) => changeBottle((event.currentTarget as HTMLInputElement).value)}
			aria-label="Оригинален обем на флакона в милилитри"
		/>
		<div class="scale"><span>0,1 ml</span><span>500 ml</span></div>
	</div>

	<div class="control-block" class:is-disabled={sealed}>
		<div class="control-heading">
			<label for="remaining-volume">Точен остатък</label>
			<div class="number-unit">
				<input
					id="remaining-volume"
					type="number"
					min="0"
					max={bottleVolumeMl}
					step="0.1"
					inputmode="decimal"
					value={remainingMl}
					disabled={sealed}
					aria-invalid={invalid ? 'true' : undefined}
					aria-describedby={invalid ? errorId : undefined}
					oninput={(event) => changeRemaining((event.currentTarget as HTMLInputElement).value)}
				/>
				<span>ml</span>
			</div>
		</div>
		<input
			class="range"
			type="range"
			min="0"
			max="100"
			step="0.1"
			value={percentage()}
			disabled={sealed}
			oninput={(event) => changePercentage((event.currentTarget as HTMLInputElement).value)}
			aria-label="Остатък като процент от оригиналния обем"
		/>
		<div class="scale"><span>0%</span><span>{percentage()}% · {remainingMl} ml</span><span>100%</span></div>
	</div>

	<p class="precision-note">
		Пазим точните милилитри с точност 0,1 ml. При промяна на размера на флакона запазваме
		съотношението, а не закръглена стойност.
	</p>
</fieldset>

<style>
	.volume-card {
		margin: 0;
		padding: clamp(1rem, 3vw, 1.5rem);
		border: 1px solid var(--border-strong, #b7a58f);
		border-radius: 1.25rem;
		background: color-mix(in srgb, var(--surface, #fffaf3) 90%, transparent);
	}

	legend {
		padding: 0 0.5rem;
		font: italic 700 1rem/1.2 Arial, sans-serif;
		color: var(--text, #241c16);
	}

	.status-row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.75rem;
		padding: 0.9rem 1rem;
		border-radius: 1rem;
		background: var(--accent-soft, #f3dfbf);
	}

	.status-row strong,
	.status-row span {
		display: block;
	}

	.status-dot {
		width: 0.75rem;
		height: 0.75rem;
		border: 3px solid color-mix(in srgb, var(--success, #276749) 25%, transparent);
		border-radius: 999px;
		background: var(--success, #276749);
		box-sizing: content-box;
	}

	.eyebrow {
		margin-bottom: 0.15rem;
		color: var(--text-muted, #67584d);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.percentage-pill {
		min-width: 3.6rem;
		padding: 0.45rem 0.6rem;
		border: 1px solid color-mix(in srgb, var(--cta, #4a3126) 35%, transparent);
		border-radius: 999px;
		background: var(--surface, #fffaf3);
		color: var(--cta, #4a3126);
		font-weight: 700;
		text-align: center;
	}

	.switch-row {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: 1rem;
		min-height: 4.25rem;
		margin: 1rem 0 1.25rem;
		cursor: pointer;
	}

	.switch-row strong,
	.switch-row small {
		display: block;
	}

	.switch-row small {
		margin-top: 0.25rem;
		color: var(--text-muted, #67584d);
		line-height: 1.4;
	}

	.switch-row input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.switch {
		position: relative;
		width: 3.3rem;
		height: 1.85rem;
		border: 1px solid var(--border-strong, #b7a58f);
		border-radius: 999px;
		background: var(--panel, #d6caba);
		transition: background 180ms ease;
	}

	.switch::after {
		position: absolute;
		top: 0.2rem;
		left: 0.2rem;
		width: 1.35rem;
		height: 1.35rem;
		border-radius: 50%;
		background: var(--surface, #fffaf3);
		box-shadow: 0 2px 6px rgb(36 28 22 / 0.18);
		content: '';
		transition: transform 180ms ease;
	}

	.switch-row input:checked + .switch {
		background: var(--cta, #4a3126);
	}

	.switch-row input:checked + .switch::after {
		transform: translateX(1.42rem);
	}

	.switch-row input:focus-visible + .switch {
		outline: 3px solid var(--focus, #1f5c73);
		outline-offset: 3px;
	}

	.control-block + .control-block {
		margin-top: 1.35rem;
	}

	.control-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.55rem;
	}

	.control-heading label {
		font-weight: 700;
	}

	.number-unit {
		display: flex;
		align-items: center;
		overflow: hidden;
		border: 1px solid var(--border-strong, #b7a58f);
		border-radius: 0.7rem;
		background: var(--surface, #fffaf3);
	}

	.number-unit:focus-within {
		outline: 3px solid var(--focus, #1f5c73);
		outline-offset: 2px;
	}

	.number-unit input {
		width: 5.3rem;
		min-height: 2.75rem;
		padding: 0 0.35rem 0 0.75rem;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--text, #241c16);
		font: 400 1rem Arial, sans-serif;
		text-align: right;
	}

	.number-unit span {
		padding-right: 0.7rem;
		color: var(--text-muted, #67584d);
		font-size: 0.85rem;
	}

	.range {
		width: 100%;
		height: 2.75rem;
		margin: 0;
		accent-color: var(--cta, #4a3126);
		cursor: pointer;
	}

	.range:focus-visible {
		outline: 3px solid var(--focus, #1f5c73);
		outline-offset: 2px;
		border-radius: 999px;
	}

	.scale {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		margin-top: -0.25rem;
		color: var(--text-muted, #67584d);
		font-size: 0.78rem;
	}

	.is-disabled {
		opacity: 0.62;
	}

	.precision-note {
		margin: 1.1rem 0 0;
		padding-top: 1rem;
		border-top: 1px solid var(--border, #d8cbbb);
		color: var(--text-muted, #67584d);
		font-size: 0.84rem;
		line-height: 1.5;
	}

	@media (max-width: 420px) {
		.control-heading {
			align-items: flex-start;
			flex-direction: column;
			gap: 0.5rem;
		}

		.number-unit,
		.number-unit input {
			width: 100%;
		}

		.number-unit input {
			text-align: left;
		}

		.status-row {
			grid-template-columns: auto 1fr;
		}

		.percentage-pill {
			grid-column: 2;
			justify-self: start;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.switch,
		.switch::after {
			transition: none;
		}
	}
</style>
