<script lang="ts">
	import { deserialize } from '$app/forms';
	import { onMount, tick } from 'svelte';
	import { isAllowedFragranticaUrl } from '$domain/listing';
	import type {
		ActionResult,
		BrandSummaryDto,
		ListingDetailDto,
		ListingDraftInput
	} from '$lib/contracts';
	import { normalizeBrandSearch, otherBrandOption } from '$lib/data/catalog';
	import EvidencePhotos from './EvidencePhotos.svelte';
	import LinkedVolumeControl from './LinkedVolumeControl.svelte';
	import { getEvidenceRoles, uniqueSelectedEvidenceCount } from './evidence';
	import type { Concentration, ListingDraft, ListingKind, PhotoMap, ProductFormat } from './types';

	interface TurnstileApi {
		render: (element: HTMLElement, options: Record<string, unknown>) => string;
		reset: (widgetId: string) => void;
		remove?: (widgetId: string) => void;
	}

	let {
		initialKind = 'offer',
		catalogBrands = [],
		phoneVerified = false,
		initialCity = '',
		turnstileSiteKey = null,
		demoMode = false
	}: {
		initialKind?: ListingKind;
		catalogBrands?: readonly BrandSummaryDto[];
		phoneVerified?: boolean;
		initialCity?: string;
		turnstileSiteKey?: string | null;
		demoMode?: boolean;
	} = $props();

	const steps = [
		{ short: 'Аромат', title: 'Кой е ароматът?', kicker: 'Стъпка 1 от 6' },
		{ short: 'Сделка', title: 'Каква обява създаваш?', kicker: 'Стъпка 2 от 6' },
		{ short: 'Продукт', title: 'Опиши физическия продукт', kicker: 'Стъпка 3 от 6' },
		{ short: 'Снимки', title: 'Покажи реалния продукт', kicker: 'Стъпка 4 от 6' },
		{ short: 'Детайли', title: 'Добави цена и описание', kicker: 'Стъпка 5 от 6' },
		{ short: 'Преглед', title: 'Провери преди публикуване', kicker: 'Стъпка 6 от 6' }
	];

	const cities = [
		'София',
		'Пловдив',
		'Варна',
		'Бургас',
		'Русе',
		'Стара Загора',
		'Плевен',
		'Сливен',
		'Добрич',
		'Шумен',
		'Перник',
		'Хасково',
		'Ямбол',
		'Благоевград',
		'Велико Търново'
	];

	const concentrationLabels: Record<Concentration, string> = {
		EDT: 'Eau de Toilette (EDT)',
		EDP: 'Eau de Parfum (EDP)',
		PARFUM: 'Parfum',
		EXTRAIT: 'Extrait de Parfum',
		EDC: 'Eau de Cologne (EDC)',
		OTHER_NOT_STATED: 'Друга / не е отбелязано'
	};

	const formatLabels: Record<ProductFormat, string> = {
		retail_bottle: 'Оригинален флакон',
		tester: 'Тестер',
		official_sample: 'Официална мостра'
	};

	function createDraft(): ListingDraft {
		return {
			brandId: '',
			brand: '',
			customBrand: '',
			fragranceName: '',
			audience: 'unisex',
			niche: false,
			arabic: false,
			listingKind: initialKind,
			dealMode: 'sale_or_swap',
			productFormat: 'retail_bottle',
			concentration: 'EDP',
			bottleVolumeMl: 65,
			remainingMl: 29.9,
			sealed: false,
			price: '',
			estimatedValue: '',
			maxBudget: '',
			city: initialCity,
			description: '',
			fragranticaUrl: ''
		};
	}

	let currentStep = $state(0);
	let furthestStep = $state(0);
	let draft = $state<ListingDraft>(createDraft());
	let photos = $state<PhotoMap>({});
	let errors = $state<Record<string, string>>({});
	let liveMessage = $state('');
	let submitted = $state(false);
	let busy = $state(false);
	let serverError = $state('');
	let draftId = $state<string | null>(null);
	let publishedSlug = $state<string | null>(null);
	let pendingBrandId = $state<string | null>(null);
	let pendingBrandName = $state('');
	let saveState = $state<'local' | 'unsaved' | 'saving' | 'saved' | 'uploading' | 'publishing' | 'error'>('unsaved');
	let uploadedFiles = $state<Record<string, File>>({});
	let stepHeading = $state<HTMLHeadingElement>();
	let brandInput = $state<HTMLInputElement>();
	let turnstileElement = $state<HTMLDivElement>();
	let brandComboboxOpen = $state(false);
	let activeBrandOption = $state(0);
	let turnstileWidgetId: string | null = null;
	let turnstileToken = '';
	let tokenResolver: ((token: string) => void) | null = null;
	let tokenRejecter: ((reason: Error) => void) | null = null;
	let brandMatches = $derived.by(() => {
		const query = normalizeBrandSearch(draft.brand);
		if (!query) return catalogBrands.slice(0, 8);
		return catalogBrands
			.filter((brand) => normalizeBrandSearch(`${brand.name} ${brand.slug}`).includes(query))
			.slice(0, 8);
	});
	let draftBadgeText = $derived(
		demoMode ? 'Локална демо чернова' :
		saveState === 'saving' ? 'Записване на чернова…' :
		saveState === 'uploading' ? 'Качване на снимки…' :
		saveState === 'publishing' ? 'Публикуване…' :
		saveState === 'saved' ? 'Черновата е записана' :
		saveState === 'error' ? 'Черновата има грешка' : 'Незаписана чернова'
	);

	function turnstileApi(): TurnstileApi | undefined {
		return (window as Window & { turnstile?: TurnstileApi }).turnstile;
	}

	onMount(() => {
		if (demoMode || !turnstileSiteKey) return;
		let cancelled = false;
		const initialize = async () => {
			for (let attempt = 0; attempt < 80 && !cancelled; attempt += 1) {
				const turnstile = turnstileApi();
				if (turnstile && turnstileElement) {
					turnstileWidgetId = turnstile.render(turnstileElement, {
						sitekey: turnstileSiteKey,
						action: 'listing_upload',
						callback: (token: string) => {
							turnstileToken = token;
							tokenResolver?.(token);
							tokenResolver = null;
							tokenRejecter = null;
						},
						'expired-callback': () => { turnstileToken = ''; },
						'error-callback': () => {
							tokenRejecter?.(new Error('captcha_failed'));
							tokenResolver = null;
							tokenRejecter = null;
						}
					});
					return;
				}
				await new Promise((resolve) => window.setTimeout(resolve, 100));
			}
		};
		void initialize();
		return () => {
			cancelled = true;
			if (turnstileWidgetId) turnstileApi()?.remove?.(turnstileWidgetId);
		};
	});

	function resolvedBrand(): string {
		return draft.brand === otherBrandOption.label ? draft.customBrand.trim() : draft.brand.trim();
	}

	function percentage(): number {
		if (draft.bottleVolumeMl <= 0) return 0;
		return Math.round((draft.remainingMl / draft.bottleVolumeMl) * 1000) / 10;
	}

	function conditionLabel(): string {
		if (draft.sealed) return 'Запечатан';
		const value = percentage();
		if (value >= 100) return 'Отворен, пълен';
		if (value >= 90) return 'Отворен, почти пълен';
		if (value >= 70) return 'Леко използван';
		if (value >= 30) return 'Частично използван';
		if (value >= 1) return 'Силно използван';
		return 'Няма измерим остатък';
	}

	function money(value: string): string {
		const amount = Number(value.replace(',', '.'));
		if (!Number.isFinite(amount)) return '—';
		return new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR' }).format(amount);
	}

	function validPositiveMoney(value: string): boolean {
		const parsed = Number(value.trim().replace(',', '.'));
		return Number.isFinite(parsed) && parsed > 0;
	}

	function moneyMinor(value: string): number | null {
		const parsed = Number(value.trim().replace(',', '.'));
		return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
	}

	function validFragranticaUrl(value: string): boolean {
		if (!value.trim()) return true;
		return isAllowedFragranticaUrl(value.trim());
	}

	function validateStep(step: number): boolean {
		const nextErrors: Record<string, string> = {};

		if (step === 0) {
			if (!draft.brand.trim()) nextErrors.brand = 'Избери марка или използвай „Други“.';
			if (draft.brand === otherBrandOption.label && draft.customBrand.trim().length < 2) {
				nextErrors.customBrand = 'Въведи пълното име на марката.';
			} else if (draft.brand && draft.brand !== otherBrandOption.label) {
				const resolved = catalogBrands.find((brand) => normalizeBrandSearch(brand.name) === normalizeBrandSearch(draft.brand));
				if (!resolved || !draft.brandId) {
					nextErrors.brand = 'Избери марка от резултатите или използвай „Други“.';
				} else {
					draft.brand = resolved.name;
					draft.brandId = resolved.id;
				}
			}
			if (draft.fragranceName.trim().length < 2) {
				nextErrors.fragranceName = 'Въведи името на аромата.';
			}
		}

		if (step === 2) {
			if (!Number.isFinite(draft.bottleVolumeMl) || draft.bottleVolumeMl <= 0) {
				nextErrors.volume = 'Оригиналният обем трябва да е над 0 ml.';
			}
			if (draft.listingKind === 'offer') {
				if (!Number.isFinite(draft.remainingMl) || draft.remainingMl <= 0) {
					nextErrors.volume = 'Активна обява не може да е за празен флакон.';
				} else if (draft.remainingMl > draft.bottleVolumeMl) {
					nextErrors.volume = 'Остатъкът не може да надвишава оригиналния обем.';
				}
			}
		}

		if (step === 3 && draft.listingKind === 'offer') {
			const roles = getEvidenceRoles(draft.productFormat, draft.sealed, draft.listingKind);
			if (uniqueSelectedEvidenceCount(roles, photos) !== roles.length) {
				nextErrors.photos = 'Добави четири различни снимки — по една за всяка роля.';
			}
		}

		if (step === 4) {
			if (
				draft.listingKind === 'offer' &&
				(draft.dealMode === 'sale' || draft.dealMode === 'sale_or_swap') &&
				!validPositiveMoney(draft.price)
			) {
				nextErrors.price = 'Въведи продажна цена над €0.';
			}
			if (draft.dealMode === 'swap' && draft.estimatedValue && !validPositiveMoney(draft.estimatedValue)) {
				nextErrors.estimatedValue = 'Ориентировъчната стойност трябва да е над €0.';
			}
			if (draft.listingKind === 'wanted' && !validPositiveMoney(draft.maxBudget)) {
				nextErrors.maxBudget = 'Въведи максимален бюджет над €0.';
			}
			if (draft.city.trim().length < 2) nextErrors.city = 'Посочи град.';
			if (draft.description.trim().length < 30) {
				nextErrors.description = 'Опиши продукта с поне 30 знака.';
			}
			if (!validFragranticaUrl(draft.fragranticaUrl)) {
				nextErrors.fragranticaUrl = 'Използвай пълен HTTPS линк към конкретен аромат във Fragrantica.';
			}
		}

		errors = nextErrors;
		return Object.keys(nextErrors).length === 0;
	}

	async function focusStepHeading(): Promise<void> {
		await tick();
		stepHeading?.focus();
	}

	async function focusFirstError(): Promise<void> {
		await tick();
		const element = document.querySelector<HTMLElement>(
			'[aria-invalid="true"], .photo-grid input[type="file"]'
		);
		element?.focus();
	}

	async function goToStep(step: number): Promise<void> {
		if (step < 0 || step > furthestStep || step >= steps.length) return;
		currentStep = step;
		errors = {};
		liveMessage = `${steps[step].kicker}: ${steps[step].title}`;
		await focusStepHeading();
	}

	async function nextStep(): Promise<void> {
		if (!validateStep(currentStep)) {
			liveMessage = Object.values(errors)[0] ?? 'Провери въведените данни.';
			await focusFirstError();
			return;
		}


		if (!demoMode && currentStep === 4) {
			if (!phoneVerified) {
				window.location.assign(`/phone-verification?next=${encodeURIComponent('/publish')}`);
				return;
			}
			busy = true;
			try {
				await persistDraft();
				await uploadSelectedPhotos();
			} catch {
				liveMessage = serverError || 'Черновата не можа да бъде записана.';
				await focusFirstError();
				return;
			} finally {
				busy = false;
			}
		}

		if (currentStep === steps.length - 1) {
			if (demoMode) {
				submitted = true;
				publishedSlug = null;
				liveMessage = 'Демо обявата е готова. Няма изпратени данни към сървър.';
			} else {
				busy = true;
				serverError = '';
				try {
					await persistDraft();
					await uploadSelectedPhotos();
					if (!draftId) throw new Error('missing_draft');
					saveState = 'publishing';
					const result = await callAction<ListingDetailDto>('publish', { listingId: draftId });
					if (!result.ok) throwActionError(result);
					publishedSlug = result.data.slug;
					submitted = true;
					liveMessage = 'Обявата е публикувана.';
				} catch {
					saveState = 'error';
					liveMessage = serverError || 'Обявата не можа да бъде публикувана.';
					return;
				} finally {
					busy = false;
				}
			}
			await tick();
			document.querySelector<HTMLElement>('.success-card h2')?.focus();
			return;
		}

		currentStep += 1;
		furthestStep = Math.max(furthestStep, currentStep);
		errors = {};
		liveMessage = `${steps[currentStep].kicker}: ${steps[currentStep].title}`;
		await focusStepHeading();
	}

	async function previousStep(): Promise<void> {
		if (currentStep === 0) return;
		currentStep -= 1;
		errors = {};
		liveMessage = `${steps[currentStep].kicker}: ${steps[currentStep].title}`;
		await focusStepHeading();
	}

	function submitStep(event: SubmitEvent): void {
		event.preventDefault();
		void nextStep();
	}

	function activeBrandOptionId(): string | undefined {
		if (!brandComboboxOpen) return undefined;
		const match = brandMatches[activeBrandOption];
		return match ? `brand-option-${match.id}` : 'brand-option-other';
	}

	function handleBrandInput(event: Event): void {
		const value = (event.currentTarget as HTMLInputElement).value;
		draft.brand = value;
		draft.brandId = '';
		if (value !== otherBrandOption.label) draft.customBrand = '';
		brandComboboxOpen = true;
		activeBrandOption = 0;
		errors.brand = '';
		errors.customBrand = '';
	}

	function openBrandCombobox(): void {
		brandComboboxOpen = true;
		activeBrandOption = 0;
	}

	function closeBrandCombobox(): void {
		brandComboboxOpen = false;
		const resolved = catalogBrands.find((brand) => normalizeBrandSearch(brand.name) === normalizeBrandSearch(draft.brand));
		if (resolved) {
			draft.brand = resolved.name;
			draft.brandId = resolved.id;
		}
	}

	function selectCatalogBrand(result: BrandSummaryDto): void {
		draft.brand = result.name;
		draft.brandId = result.id;
		draft.customBrand = '';
		brandComboboxOpen = false;
		errors.brand = '';
		liveMessage = `Избрана марка ${result.name}.`;
		brandInput?.focus();
	}

	function handleBrandKeydown(event: KeyboardEvent): void {
		const optionCount = brandMatches.length + 1;

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (!brandComboboxOpen) {
				openBrandCombobox();
				return;
			}
			activeBrandOption = (activeBrandOption + 1) % optionCount;
			return;
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (!brandComboboxOpen) {
				brandComboboxOpen = true;
				activeBrandOption = optionCount - 1;
				return;
			}
			activeBrandOption = (activeBrandOption - 1 + optionCount) % optionCount;
			return;
		}

		if (event.key === 'Enter' && brandComboboxOpen) {
			event.preventDefault();
			const match = brandMatches[activeBrandOption];
			if (match) selectCatalogBrand(match);
			else chooseOtherBrand();
			return;
		}

		if (event.key === 'Escape' && brandComboboxOpen) {
			event.preventDefault();
			brandComboboxOpen = false;
		}
	}

	function chooseOtherBrand(): void {
		draft.brand = otherBrandOption.label;
		draft.brandId = '';
		brandComboboxOpen = false;
		errors.brand = '';
		liveMessage = 'Избрана е марка извън каталога. Въведи пълното име.';
		void tick().then(() => document.getElementById('custom-brand')?.focus());
	}

	function chooseProductFormat(format: ProductFormat): void {
		draft.productFormat = format;
		if (format === 'official_sample' && draft.bottleVolumeMl > 20) {
			const currentRatio = draft.remainingMl / draft.bottleVolumeMl;
			draft.bottleVolumeMl = 2;
			draft.remainingMl = draft.sealed ? 2 : Math.round(2 * currentRatio * 10) / 10;
		}
	}

	function startAgain(): void {
		draft = createDraft();
		photos = {};
		errors = {};
		currentStep = 0;
		furthestStep = 0;
		submitted = false;
		busy = false;
		serverError = '';
		draftId = null;
		publishedSlug = null;
		pendingBrandId = null;
		pendingBrandName = '';
		uploadedFiles = {};
		saveState = demoMode ? 'local' : 'unsaved';
		liveMessage = demoMode ? 'Започната е нова демо обява.' : 'Започната е нова обява.';
		void focusStepHeading();
	}

	async function callAction<T>(name: string, fields: Record<string, string>): Promise<ActionResult<T>> {
		const formData = new FormData();
		for (const [key, value] of Object.entries(fields)) formData.set(key, value);
		const response = await fetch(`?/${name}`, { method: 'POST', body: formData });
		const decoded = deserialize(await response.text());
		if (decoded.type === 'redirect') {
			window.location.assign(decoded.location);
			throw new Error('redirected');
		}
		if (decoded.type === 'error') throw new Error('action_failed');
		const actionData = decoded.data as { result?: ActionResult<T>; phoneVerificationRequired?: boolean } | undefined;
		if (actionData?.phoneVerificationRequired) {
			window.location.assign(`/phone-verification?next=${encodeURIComponent('/publish')}`);
			throw new Error('phone_verification_required');
		}
		if (!actionData?.result) throw new Error('missing_action_result');
		return actionData.result;
	}

	function throwActionError<T>(result: ActionResult<T>): never {
		if (result.ok) throw new Error('unexpected_success');
		serverError = result.error.message;
		if (result.error.fieldErrors) {
			for (const [field, messages] of Object.entries(result.error.fieldErrors)) {
				errors[field] = messages[0] ?? result.error.message;
			}
		}
		throw new Error(result.error.code);
	}

	async function ensureBrandId(): Promise<string> {
		if (draft.brand !== otherBrandOption.label && draft.brandId) return draft.brandId;
		const displayName = draft.customBrand.trim();
		if (pendingBrandId && pendingBrandName === displayName) return pendingBrandId;
		const result = await callAction<BrandSummaryDto>('pendingBrand', { displayName });
		if (!result.ok) throwActionError(result);
		pendingBrandId = result.data.id;
		pendingBrandName = displayName;
		draft.brandId = result.data.id;
		return result.data.id;
	}

	function listingInput(brandId: string): ListingDraftInput {
		const priceMinor = moneyMinor(draft.price);
		const estimatedValueMinor = moneyMinor(draft.estimatedValue);
		const maxBudgetMinor = moneyMinor(draft.maxBudget);
		return {
			kind: draft.listingKind,
			dealMode: draft.dealMode,
			productFormat: draft.productFormat,
			audience: draft.audience,
			segments: [draft.niche ? 'niche' as const : null, draft.arabic ? 'arabic' as const : null].filter((segment): segment is 'niche' | 'arabic' => segment !== null),
			brandId,
			fragranceId: null,
			fragranceName: draft.fragranceName.trim(),
			concentration: draft.concentration,
			concentrationLabel: null,
			referenceUrl: draft.fragranticaUrl.trim() || null,
			title: `${resolvedBrand()} ${draft.fragranceName}`.trim(),
			description: draft.description.trim(),
			city: draft.city.trim(),
			bottleVolumeMl: draft.bottleVolumeMl,
			remainingMl: draft.listingKind === 'offer' ? draft.remainingMl : null,
			isSealed: draft.listingKind === 'offer' && draft.sealed,
			priceMinor: draft.listingKind === 'offer' && draft.dealMode !== 'swap' ? priceMinor : null,
			estimatedValueMinor: draft.listingKind === 'offer' ? estimatedValueMinor : null,
			maxBudgetMinor: draft.listingKind === 'wanted' ? maxBudgetMinor : null
		};
	}

	async function persistDraft(): Promise<void> {
		serverError = '';
		saveState = 'saving';
		const brandId = await ensureBrandId();
		const result = await callAction<ListingDetailDto>('autosave', {
			payload: JSON.stringify(listingInput(brandId)),
			...(draftId ? { listingId: draftId } : {})
		});
		if (!result.ok) throwActionError(result);
		draftId = result.data.id;
		saveState = 'saved';
	}

	function waitForTurnstileToken(): Promise<string> {
		if (turnstileToken) {
			const token = turnstileToken;
			turnstileToken = '';
			return Promise.resolve(token);
		}
		return new Promise((resolve, reject) => {
			tokenResolver = resolve;
			tokenRejecter = reject;
			window.setTimeout(() => {
				if (tokenResolver !== resolve) return;
				tokenResolver = null;
				tokenRejecter = null;
				reject(new Error('captcha_timeout'));
			}, 15_000);
		});
	}

	async function uploadSelectedPhotos(): Promise<void> {
		if (draft.listingKind !== 'offer' || demoMode) return;
		if (!draftId) throw new Error('missing_draft');
		if (!turnstileSiteKey || !turnstileWidgetId) {
			serverError = 'Проверката за качване на снимки временно не е достъпна.';
			throw new Error('captcha_unavailable');
		}
		for (const [role, file] of Object.entries(photos)) {
			if (!file || uploadedFiles[role] === file) continue;
			saveState = 'uploading';
			const token = await waitForTurnstileToken();
			const formData = new FormData();
			formData.set('file', file);
			formData.set('listingId', draftId);
			formData.set('role', role);
			formData.set('cf-turnstile-response', token);
			const response = await fetch('/api/listing-uploads', { method: 'POST', body: formData });
			const payload = await response.json() as { ok: boolean; code?: string };
			turnstileApi()?.reset(turnstileWidgetId);
			if (!response.ok || !payload.ok) {
				serverError = payload.code === 'captcha_failed'
					? 'Проверката за снимките изтече. Опитай отново.'
					: 'Една от снимките не можа да бъде обработена.';
				throw new Error(payload.code ?? 'upload_failed');
			}
			uploadedFiles[role] = file;
		}
		saveState = 'saved';
	}
</script>

<section class="wizard-shell" aria-labelledby="wizard-title">
	<div class="sr-only" aria-live="polite" aria-atomic="true">{liveMessage}</div>

	<header class="wizard-intro">
		<div>
			<p class="overline">Нова обява</p>
			<h1 id="wizard-title">Разкажи историята на аромата</h1>
			<p>Шест кратки стъпки. Можеш да се върнеш и да редактираш всичко преди публикуване.</p>
		</div>
		<div class="draft-badge">
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M5 4h11l3 3v13H5z" />
				<path d="M8 4v6h8V4M8 20v-6h8v6" />
			</svg>
			<span>{draftBadgeText}</span>
		</div>
	</header>

	<nav class="progress" aria-label="Стъпки за публикуване">
		<ol>
			{#each steps as step, index}
				<li class:active={currentStep === index} class:done={index < currentStep || index < furthestStep}>
					<button
						type="button"
						disabled={index > furthestStep}
						aria-current={currentStep === index ? 'step' : undefined}
						onclick={() => goToStep(index)}
					>
						<span class="step-number">
							{#if index < currentStep || index < furthestStep}
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9" /></svg>
							{:else}
								{index + 1}
							{/if}
						</span>
						<span class="step-label">{step.short}</span>
					</button>
				</li>
			{/each}
		</ol>
	</nav>
	{#if turnstileSiteKey && !demoMode}
		<div class="turnstile-wrap" aria-label="Проверка преди качване на снимки">
			<div bind:this={turnstileElement}></div>
		</div>
	{/if}

	{#if submitted}
		<div class="success-card">
			<div class="success-icon" aria-hidden="true">
				<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>
			</div>
			<p class="overline">{demoMode ? 'Демо завършено' : 'Публикувана обява'}</p>
			<h2 tabindex="-1">{demoMode ? 'Обявата е подготвена' : 'Обявата е активна'}</h2>
			<p>{demoMode ? 'В демо режима нищо не е изпратено и снимките не са качени.' : 'Черновата, обработените снимки и публичната обява са записани успешно.'}</p>
			<div class="success-summary">
				<strong>{resolvedBrand()} {draft.fragranceName}</strong>
				<span>{draft.listingKind === 'wanted' ? 'Търся' : draft.dealMode === 'swap' ? 'Размяна' : 'Предлагам'} · {draft.city}</span>
			</div>
			<div class="success-actions">
				{#if publishedSlug}<a class="primary-button" href={`/listing/${publishedSlug}`}>Виж обявата</a>{/if}
				<button class="secondary-button" type="button" onclick={startAgain}>Създай нова обява</button>
			</div>
		</div>
	{:else}
		<form onsubmit={submitStep} novalidate>
			<div class="form-heading">
				<p>{steps[currentStep].kicker}</p>
				<h2 bind:this={stepHeading} tabindex="-1">{steps[currentStep].title}</h2>
			</div>
			{#if serverError}<p class="server-error" role="alert">{serverError}</p>{/if}

			{#if currentStep === 0}
				<div class="form-grid two-columns">
					<div class="field span-two">
						<div class="label-row">
							<label for="brand">Марка</label>
							<button class="text-button" type="button" onclick={chooseOtherBrand}>Марката липсва?</button>
						</div>
						<div class="brand-combobox">
							<input
								bind:this={brandInput}
								id="brand"
								role="combobox"
								placeholder="Започни да пишеш, напр. Dior"
								autocomplete="off"
								value={draft.brand}
								aria-autocomplete="list"
								aria-haspopup="listbox"
								aria-expanded={brandComboboxOpen}
								aria-controls="brand-options"
								aria-activedescendant={activeBrandOptionId()}
								aria-invalid={errors.brand ? 'true' : undefined}
								aria-describedby={errors.brand ? 'brand-hint brand-error' : 'brand-hint'}
								oninput={handleBrandInput}
								onfocus={openBrandCombobox}
								onblur={closeBrandCombobox}
								onkeydown={handleBrandKeydown}
							/>
							<span class="combobox-caret" aria-hidden="true"></span>

							{#if brandComboboxOpen}
								<div id="brand-options" class="brand-options" role="listbox" aria-label="Марки">
									{#each brandMatches as result, index (result.id)}
										<button
											id={`brand-option-${result.id}`}
											class:active={activeBrandOption === index}
											type="button"
											role="option"
											tabindex="-1"
											aria-selected={activeBrandOption === index}
											onpointerdown={(event) => event.preventDefault()}
											onclick={() => selectCatalogBrand(result)}
										>
											<strong>{result.name}</strong>
											<small>Канонична марка в каталога</small>
										</button>
									{/each}
									<button
										id="brand-option-other"
										class="other-option"
										class:active={activeBrandOption === brandMatches.length}
										type="button"
										role="option"
										tabindex="-1"
										aria-selected={activeBrandOption === brandMatches.length}
										onpointerdown={(event) => event.preventDefault()}
										onclick={chooseOtherBrand}
									>
										<strong>{otherBrandOption.label}</strong>
										<small>Въведи марка, която още не е в каталога</small>
									</button>
								</div>
							{/if}
						</div>
						<p id="brand-hint" class="hint">Търси в {catalogBrands.length} марки, заредени от каталога на marketplace-а.</p>
						{#if errors.brand}<p id="brand-error" class="error">{errors.brand}</p>{/if}
					</div>

					{#if draft.brand === otherBrandOption.label}
						<div class="field span-two custom-brand-panel">
							<label for="custom-brand">Пълно име на марката</label>
							<input
								id="custom-brand"
								placeholder="Изпиши марката както е върху опаковката"
								bind:value={draft.customBrand}
								aria-invalid={errors.customBrand ? 'true' : undefined}
								aria-describedby="custom-brand-hint custom-brand-error"
							/>
							<p id="custom-brand-hint" class="hint">Обявата се публикува веднага със статус <code>{otherBrandOption.moderationState}</code> („чака подреждане в каталога“).</p>
							{#if errors.customBrand}<p id="custom-brand-error" class="error">{errors.customBrand}</p>{/if}
						</div>
					{/if}

					<div class="field span-two">
						<label for="fragrance-name">Име на парфюма</label>
						<input
							id="fragrance-name"
							placeholder="Напр. Gris Charnel Extrait"
							bind:value={draft.fragranceName}
							aria-invalid={errors.fragranceName ? 'true' : undefined}
							aria-describedby="fragrance-error"
						/>
						{#if errors.fragranceName}<p id="fragrance-error" class="error">{errors.fragranceName}</p>{/if}
					</div>
				</div>

				<fieldset class="choice-fieldset">
					<legend>За кого е представен ароматът?</legend>
					<p class="legend-hint">Избери точно една основна категория.</p>
					<div class="choice-grid three">
						<label class="choice-card">
							<input type="radio" name="audience" value="men" bind:group={draft.audience} />
							<span><strong>Мъжки</strong><small>Представен основно за мъже</small></span>
						</label>
						<label class="choice-card">
							<input type="radio" name="audience" value="women" bind:group={draft.audience} />
							<span><strong>Дамски</strong><small>Представен основно за жени</small></span>
						</label>
						<label class="choice-card">
							<input type="radio" name="audience" value="unisex" bind:group={draft.audience} />
							<span><strong>Унисекс</strong><small>Представен за всички</small></span>
						</label>
					</div>
				</fieldset>

				<fieldset class="choice-fieldset compact-fieldset">
					<legend>Допълнителни категории</legend>
					<p class="legend-hint">Незадължително. Можеш да избереш и двете.</p>
					<div class="checkbox-row">
						<label><input type="checkbox" bind:checked={draft.niche} /><span><strong>Нишов</strong><small>Селективна или независима парфюмерия</small></span></label>
						<label><input type="checkbox" bind:checked={draft.arabic} /><span><strong>Арабски</strong><small>Марка или линия от арабската парфюмерийна традиция</small></span></label>
					</div>
				</fieldset>
			{:else if currentStep === 1}
				<fieldset class="choice-fieldset first-fieldset">
					<legend>Вид обява</legend>
					<div class="choice-grid two">
						<label class="choice-card large">
							<input type="radio" name="kind" value="offer" bind:group={draft.listingKind} />
							<span class="choice-icon" aria-hidden="true">
								<svg viewBox="0 0 24 24"><path d="M4 7h16v13H4zM8 7V4h8v3M8 12h8" /></svg>
							</span>
							<span><strong>Предлагам парфюм</strong><small>За продажба, размяна или и двете</small></span>
						</label>
						<label class="choice-card large">
							<input type="radio" name="kind" value="wanted" bind:group={draft.listingKind} />
							<span class="choice-icon" aria-hidden="true">
								<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg>
							</span>
							<span><strong>Търся парфюм</strong><small>Публикуваш желание, без да продаваш продукт</small></span>
						</label>
					</div>
				</fieldset>

				{#if draft.listingKind === 'offer'}
					<fieldset class="choice-fieldset">
						<legend>Начин на сделката</legend>
						<div class="choice-grid three">
							<label class="choice-card">
								<input type="radio" name="deal" value="sale" bind:group={draft.dealMode} />
								<span><strong>Продажба</strong><small>Посочваш цена в EUR</small></span>
							</label>
							<label class="choice-card">
								<input type="radio" name="deal" value="swap" bind:group={draft.dealMode} />
								<span><strong>Размяна</strong><small>Приемаш структурирани предложения</small></span>
							</label>
							<label class="choice-card">
								<input type="radio" name="deal" value="sale_or_swap" bind:group={draft.dealMode} />
								<span><strong>Продажба или размяна</strong><small>Отворен си и за двата варианта</small></span>
							</label>
						</div>
					</fieldset>
				{:else}
					<div class="info-panel">
						<strong>Това е обява „Търся“</strong>
						<p>На следващите стъпки ще опишеш желаното издание, бюджет и град. Не са нужни снимки на чужд продукт.</p>
					</div>
				{/if}

				<div class="trust-panel">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.9 8.7 7 10 4.1-1.3 7-5.4 7-10V6z" /><path d="M9 12h6M12 9v6" /></svg>
					<div><strong>Офертата не е плащане</strong><p>Приета оферта само резервира обявата. Цената, доставката и плащането се уточняват между профилите в чата.</p></div>
				</div>
			{:else if currentStep === 2}
				<fieldset class="choice-fieldset first-fieldset">
					<legend>{draft.listingKind === 'wanted' ? 'Желан формат' : 'Формат на продукта'}</legend>
					<div class="choice-grid three">
						{#each (Object.keys(formatLabels) as ProductFormat[]) as format}
							<label class="choice-card">
								<input
									type="radio"
									name="format"
									value={format}
									checked={draft.productFormat === format}
									onchange={() => chooseProductFormat(format)}
								/>
								<span><strong>{formatLabels[format]}</strong><small>{format === 'retail_bottle' ? 'Стандартно търговско издание' : format === 'tester' ? 'Оригинален тестер, с или без капачка' : 'Фабрично произведена мостра'}</small></span>
							</label>
						{/each}
					</div>
				</fieldset>

				<div class="field concentration-field">
					<label for="concentration">Концентрация</label>
					<select id="concentration" bind:value={draft.concentration}>
						{#each Object.entries(concentrationLabels) as [value, label]}
							<option value={value}>{label}</option>
						{/each}
					</select>
				</div>

				{#if draft.listingKind === 'offer'}
					<LinkedVolumeControl
						bind:bottleVolumeMl={draft.bottleVolumeMl}
						bind:remainingMl={draft.remainingMl}
						bind:sealed={draft.sealed}
						invalid={Boolean(errors.volume)}
						errorId="volume-error"
					/>
					{#if errors.volume}<p id="volume-error" class="error standalone">{errors.volume}</p>{/if}
				{:else}
					<div class="field wanted-volume">
						<label for="wanted-volume">Предпочитан оригинален обем</label>
						<div class="input-unit"><input id="wanted-volume" type="number" min="0.1" max="500" step="0.1" inputmode="decimal" bind:value={draft.bottleVolumeMl} aria-invalid={errors.volume ? 'true' : undefined} /><span>ml</span></div>
						<p class="hint">Посочи размера на изданието, което търсиш.</p>
						{#if errors.volume}<p class="error">{errors.volume}</p>{/if}
					</div>
				{/if}

				<div class="batch-panel">
					<div><strong>Batch code проверката е ориентир, не гаранция</strong><p>Валиден код може да покаже производствена дата, но сам по себе си не доказва автентичност.</p></div>
					<a href="https://www.batch-code.com/" target="_blank" rel="noreferrer">Провери в batch-code.com <span aria-hidden="true">↗</span></a>
				</div>
			{:else if currentStep === 3}
				<EvidencePhotos
					productFormat={draft.productFormat}
					sealed={draft.sealed}
					listingKind={draft.listingKind}
					bind:photos
					invalid={Boolean(errors.photos)}
					errorId="photos-error"
				/>
				{#if errors.photos}<p id="photos-error" class="error standalone">{errors.photos}</p>{/if}
				<p class="upload-note">Снимките остават само в този браузър, докато не запишеш валидна чернова на следващата стъпка. След това се качват една по една за безопасна обработка.</p>
			{:else if currentStep === 4}
				<div class="form-grid two-columns">
					{#if draft.listingKind === 'offer' && (draft.dealMode === 'sale' || draft.dealMode === 'sale_or_swap')}
						<div class="field">
							<label for="price">Продажна цена</label>
							<div class="input-unit"><input id="price" type="text" inputmode="decimal" placeholder="0,00" bind:value={draft.price} aria-invalid={errors.price ? 'true' : undefined} aria-describedby="price-error" /><span>EUR</span></div>
							{#if errors.price}<p id="price-error" class="error">{errors.price}</p>{/if}
						</div>
					{:else if draft.listingKind === 'offer'}
						<div class="field">
							<label for="estimated-value">Ориентировъчна стойност <span>(по желание)</span></label>
							<div class="input-unit"><input id="estimated-value" type="text" inputmode="decimal" placeholder="0,00" bind:value={draft.estimatedValue} aria-invalid={errors.estimatedValue ? 'true' : undefined} /><span>EUR</span></div>
							{#if errors.estimatedValue}<p class="error">{errors.estimatedValue}</p>{/if}
						</div>
					{:else}
						<div class="field">
							<label for="max-budget">Максимален бюджет</label>
							<div class="input-unit"><input id="max-budget" type="text" inputmode="decimal" placeholder="0,00" bind:value={draft.maxBudget} aria-invalid={errors.maxBudget ? 'true' : undefined} /><span>EUR</span></div>
							{#if errors.maxBudget}<p class="error">{errors.maxBudget}</p>{/if}
						</div>
					{/if}

					<div class="field">
						<label for="city">Град</label>
						<input id="city" list="city-list" placeholder="Напр. София" bind:value={draft.city} aria-invalid={errors.city ? 'true' : undefined} aria-describedby="city-error" />
						<datalist id="city-list">{#each cities as city}<option value={city}></option>{/each}</datalist>
						{#if errors.city}<p id="city-error" class="error">{errors.city}</p>{/if}
					</div>

					<div class="field span-two">
						<div class="label-row"><label for="description">Описание</label><span class:limit-near={draft.description.length > 1800}>{draft.description.length} / 2000</span></div>
						<textarea id="description" rows="7" maxlength="2000" placeholder={draft.listingKind === 'offer' ? 'История, произход, кога е отворен, съхранение, забележки по флакона или кутията…' : 'Кое издание търсиш, приемливо състояние, предпочитания за кутия и година…'} bind:value={draft.description} aria-invalid={errors.description ? 'true' : undefined} aria-describedby="description-hint description-error"></textarea>
						<p id="description-hint" class="hint">Опиши продукта ясно и конкретно. Не добавяй телефон, имейл или външен начин за контакт.</p>
						{#if errors.description}<p id="description-error" class="error">{errors.description}</p>{/if}
					</div>

					<div class="field span-two">
						<label for="fragrantica-url">Линк към конкретния аромат във Fragrantica <span>(препоръчително)</span></label>
						<input id="fragrantica-url" type="url" inputmode="url" placeholder="https://www.fragrantica.com/perfume/…" bind:value={draft.fragranticaUrl} aria-invalid={errors.fragranticaUrl ? 'true' : undefined} aria-describedby="fragrantica-hint fragrantica-error" />
						<p id="fragrantica-hint" class="hint">Линкът е само ориентир за нотки и издание. Не копираме текст, снимки или оценки.</p>
						{#if errors.fragranticaUrl}<p id="fragrantica-error" class="error">{errors.fragranticaUrl}</p>{/if}
					</div>
				</div>
			{:else}
				<div class="review-layout">
					<section class="review-card hero-review">
						<div class="bottle-visual" aria-hidden="true"><span></span></div>
						<div>
							<p class="overline">{resolvedBrand()}</p>
							<h3>{draft.fragranceName}</h3>
							<p>{concentrationLabels[draft.concentration]} · {formatLabels[draft.productFormat]}</p>
							<div class="tag-row">
								<span>{draft.audience === 'men' ? 'Мъжки' : draft.audience === 'women' ? 'Дамски' : 'Унисекс'}</span>
								{#if draft.niche}<span>Нишов</span>{/if}
								{#if draft.arabic}<span>Арабски</span>{/if}
								{#if draft.brand === otherBrandOption.label}<span>Чака каталогизиране</span>{/if}
							</div>
						</div>
						<button class="edit-button" type="button" onclick={() => goToStep(0)}>Редактирай</button>
					</section>

					<div class="review-grid">
						<section class="review-card">
							<div class="review-title"><span>Сделка</span><button class="edit-button" type="button" onclick={() => goToStep(1)}>Редактирай</button></div>
							<strong>{draft.listingKind === 'wanted' ? 'Търся' : draft.dealMode === 'sale' ? 'Продажба' : draft.dealMode === 'swap' ? 'Размяна' : 'Продажба или размяна'}</strong>
							{#if draft.listingKind === 'offer' && draft.price}<p>{money(draft.price)}</p>{/if}
							{#if draft.listingKind === 'wanted' && draft.maxBudget}<p>До {money(draft.maxBudget)}</p>{/if}
						</section>
						<section class="review-card">
							<div class="review-title"><span>Продукт</span><button class="edit-button" type="button" onclick={() => goToStep(2)}>Редактирай</button></div>
							<strong>{formatLabels[draft.productFormat]}</strong>
							<p>{draft.listingKind === 'offer' ? `${draft.remainingMl} от ${draft.bottleVolumeMl} ml · ${percentage()}%` : `${draft.bottleVolumeMl} ml предпочитан обем`}</p>
							{#if draft.listingKind === 'offer'}<small>{conditionLabel()}</small>{/if}
						</section>
						<section class="review-card">
							<div class="review-title"><span>Снимки</span><button class="edit-button" type="button" onclick={() => goToStep(3)}>Редактирай</button></div>
							<strong>{uniqueSelectedEvidenceCount(getEvidenceRoles(draft.productFormat, draft.sealed, draft.listingKind), photos)} файла</strong>
							<p>{draft.listingKind === 'offer' ? 'Всички доказателствени роли са попълнени' : 'Снимките са незадължителни за „Търся“'}</p>
						</section>
						<section class="review-card">
							<div class="review-title"><span>Локация</span><button class="edit-button" type="button" onclick={() => goToStep(4)}>Редактирай</button></div>
							<strong>{draft.city}</strong>
							<p>{draft.description}</p>
						</section>
					</div>

					<div class="publish-note">
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 7v5c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V7z" /><path d="M9 12.5 11 14l4-4" /></svg>
						<div><strong>Преди публикуване</strong><p>{phoneVerified || demoMode ? 'Телефонът е потвърден. ' : 'Ще се изисква потвърден телефон. '}Модератор може да поиска допълнителни доказателства, но прегледът им не е гаранция за автентичност.</p></div>
					</div>
				</div>
			{/if}

			<footer class="form-actions">
				<button class="secondary-button" type="button" onclick={previousStep} disabled={currentStep === 0 || busy}>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
					Назад
				</button>
				<div class="action-copy">
					<span>{currentStep + 1} / {steps.length}</span>
					<button class="primary-button" type="submit" disabled={busy} aria-busy={busy}>
						{busy ? (saveState === 'uploading' ? 'Качване на снимки…' : saveState === 'publishing' ? 'Публикуване…' : 'Записване…') : currentStep === steps.length - 1 ? (demoMode ? 'Завърши демо обявата' : 'Публикувай обявата') : 'Продължи'}
						<svg viewBox="0 0 24 24" aria-hidden="true">{#if currentStep === steps.length - 1}<path d="M12 19V5M6 11l6-6 6 6M5 21h14" />{:else}<path d="m9 18 6-6-6-6" />{/if}</svg>
					</button>
				</div>
			</footer>
		</form>
	{/if}
</section>

<style>
	:global(*) { box-sizing: border-box; }

	.wizard-shell {
		--surface: var(--paper-strong, #fffdf9);
		--surface-soft: var(--paper, #f8f3eb);
		--accent-soft: var(--action-soft, #f4e4e5);
		--panel: var(--brand-secondary, #f4ece1);
		--text: var(--ink, #2b201a);
		--text-muted: var(--ink-soft, #66584e);
		--cta: var(--action, #751d2b);
		--cta-hover: var(--action-hover, #59131f);
		--border: var(--line, #d8ccbd);
		--border-strong: var(--line-strong, #ad9d8b);
		--focus: var(--action, #751d2b);
		--warning-text: var(--warning, #8b591e);
		width: min(100%, 72rem);
		margin: 0 auto;
		color: var(--text);
		font-size: 1rem;
		line-height: 1.5;
	}

	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

	.wizard-intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 2rem; margin-bottom: 1.75rem; }
	.overline { margin: 0 0 0.35rem; color: var(--cta); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
	.wizard-intro h1 { max-width: 45rem; margin: 0; font-size: clamp(2rem, 5vw, 3.75rem); font-weight: 700; letter-spacing: -0.035em; line-height: 1.02; }
	.wizard-intro p:last-child { max-width: 40rem; margin: 0.75rem 0 0; color: var(--text-muted); }
	.draft-badge { display: flex; flex: 0 0 auto; align-items: center; gap: 0.5rem; min-height: 2.75rem; padding: 0.55rem 0.8rem; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text-muted); font-size: 0.8rem; }
	.draft-badge svg { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }

	.progress { overflow-x: auto; margin-bottom: 1.2rem; padding: 0.15rem; scrollbar-width: thin; }
	.progress ol { position: relative; display: grid; grid-template-columns: repeat(6, minmax(5.25rem, 1fr)); min-width: 36rem; margin: 0; padding: 0; list-style: none; }
	.progress ol::before { position: absolute; z-index: 0; top: 1.35rem; right: 8%; left: 8%; height: 1px; background: var(--border-strong); content: ''; }
	.progress li { position: relative; z-index: 1; text-align: center; }
	.progress button { display: inline-flex; flex-direction: column; align-items: center; gap: 0.35rem; min-width: 4.75rem; min-height: 3.75rem; padding: 0; border: 0; background: transparent; color: var(--text-muted); font: inherit; font-size: 0.76rem; font-weight: 700; cursor: pointer; }
	.progress button:disabled { cursor: not-allowed; opacity: 0.58; }
	.progress button:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; border-radius: 0.6rem; }
	.step-number { display: grid; place-items: center; width: 2.7rem; height: 2.7rem; border: 1px solid var(--border-strong); border-radius: 50%; background: var(--surface); color: var(--text-muted); }
	.step-number svg { width: 1.1rem; height: 1.1rem; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2.2; }
	.progress li.active .step-number { border-color: var(--cta); background: var(--cta); color: var(--surface); outline: 3px solid var(--accent-soft); outline-offset: 1px; }
	.progress li.active .step-label { color: var(--text); }
	.progress li.done .step-number { border-color: var(--success); color: var(--success); }
	.turnstile-wrap { display: flex; justify-content: flex-end; min-height: 4.1rem; margin: -0.35rem 0 0.8rem; }

	form, .success-card { border: 1px solid var(--border); border-radius: var(--radius-md, 12px); background: var(--surface); }
	form { padding: clamp(1.15rem, 4vw, 2.25rem); }
	.form-heading { margin-bottom: 1.75rem; }
	.form-heading p { margin: 0 0 0.35rem; color: var(--cta); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
	.form-heading h2 { margin: 0; outline: none; font-size: clamp(1.65rem, 4vw, 2.45rem); font-weight: 700; letter-spacing: -0.025em; line-height: 1.1; }

	.form-grid { display: grid; gap: 1.15rem; }
	.form-grid.two-columns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.span-two { grid-column: 1 / -1; }
	.field label, .choice-fieldset legend { color: var(--text); font-weight: 700; }
	.field > label, .label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 0.45rem; }
	.field label span { color: var(--text-muted); font-size: 0.82rem; font-weight: 400; }
	.label-row > span { color: var(--text-muted); font-size: 0.78rem; }
	.label-row > span.limit-near { color: var(--warning-text); font-weight: 700; }
	.field input, .field select, .field textarea { width: 100%; min-height: 2.9rem; border: 1px solid var(--border-strong); border-radius: var(--radius-sm, 8px); background: var(--surface); color: var(--text); font: inherit; }
	.field input, .field select { padding: 0 0.85rem; }
	.field textarea { display: block; min-height: 9rem; padding: 0.85rem; line-height: 1.55; resize: vertical; }
	.field input::placeholder, .field textarea::placeholder { color: var(--ink-faint, #7d6f64); opacity: 1; }
	.field input:focus, .field select:focus, .field textarea:focus { border-color: var(--focus); outline: 3px solid var(--focus); outline-offset: 1px; }
	.field input[aria-invalid='true'], .field textarea[aria-invalid='true'] { border-color: var(--danger, #9c3037); }
	.brand-combobox { position: relative; }
	.brand-combobox > input { padding-right: 2.8rem; }
	.combobox-caret { position: absolute; top: 1.1rem; right: 1.05rem; width: 0.55rem; height: 0.55rem; border-right: 1.5px solid var(--text-muted); border-bottom: 1.5px solid var(--text-muted); transform: rotate(45deg); pointer-events: none; }
	.brand-options { position: absolute; z-index: 20; top: calc(100% + 0.4rem); right: 0; left: 0; display: grid; overflow-y: auto; max-height: min(25rem, 55vh); padding: 0.35rem; border: 1px solid var(--border-strong); border-radius: var(--radius-sm, 8px); background: var(--surface); }
	.brand-options button { display: flex; flex-direction: column; justify-content: center; align-items: flex-start; min-height: 3.35rem; padding: 0.6rem 0.75rem; border: 1px solid transparent; border-radius: var(--radius-sm, 8px); background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
	.brand-options button:hover, .brand-options button.active { background: var(--accent-soft); }
	.brand-options button[aria-selected='true'] { border-color: var(--cta); background: var(--accent-soft); color: var(--cta); }
	.brand-options button strong { font-size: 0.92rem; line-height: 1.25; }
	.brand-options button small { margin-top: 0.18rem; color: var(--text-muted); font-size: 0.75rem; line-height: 1.3; }
	.brand-options .other-option { margin-top: 0.25rem; border-top: 1px solid var(--border); border-radius: 0 0 var(--radius-sm, 8px) var(--radius-sm, 8px); }
	.hint, .error { margin: 0.4rem 0 0; font-size: 0.8rem; line-height: 1.4; }
	.hint { color: var(--text-muted); }
	.error { color: var(--danger, #9c3037); font-weight: 700; }
	.server-error { margin: -0.7rem 0 1.25rem; padding: 0.8rem 0.9rem; border: 1px solid var(--danger, #9c3037); border-radius: var(--radius-sm, 8px); color: var(--danger, #9c3037); background: var(--danger-soft, #f8e5e6); font-size: 0.86rem; font-weight: 700; }
	.upload-note { margin: 1rem 0 0; padding: 0.85rem 1rem; border: 1px solid var(--border); border-radius: var(--radius-sm, 8px); color: var(--text-muted); background: var(--surface-soft); font-size: 0.82rem; }
	.error.standalone { margin-top: 0.75rem; padding: 0.75rem; border: 1px solid var(--danger, #9c3037); border-radius: var(--radius-sm, 8px); background: var(--danger-soft, #f8e5e6); }
	.text-button, .edit-button { min-height: 2.75rem; padding: 0 0.25rem; border: 0; background: transparent; color: var(--cta); font: inherit; font-size: 0.82rem; font-weight: 700; text-decoration: underline; text-underline-offset: 0.2rem; cursor: pointer; }
	.text-button:hover, .edit-button:hover { color: var(--text); }
	.text-button:focus-visible, .edit-button:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-radius: 0.3rem; }
	.custom-brand-panel { padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius-sm, 8px); background: var(--surface-soft); }
	.custom-brand-panel code { padding: 0.08rem 0.25rem; border-radius: 4px; background: var(--surface); color: var(--text); font: inherit; font-size: 0.75rem; font-weight: 700; line-height: 1.4; }

	.choice-fieldset { min-width: 0; margin: 1.5rem 0 0; padding: 1.1rem 0 0; border: 0; border-top: 1px solid var(--border); }
	.choice-fieldset.first-fieldset { margin-top: 0; }
	.choice-fieldset legend { padding: 0 0.4rem 0 0; font-size: 1.05rem; font-weight: 700; }
	.legend-hint { margin: 0.2rem 0 0.8rem; color: var(--text-muted); font-size: 0.8rem; }
	.choice-grid { display: grid; gap: 0.75rem; }
	.choice-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.choice-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
	.choice-card { position: relative; display: flex; gap: 0.7rem; align-items: flex-start; min-height: 5.2rem; padding: 0.9rem; border: 1px solid var(--border-strong); border-radius: var(--radius-sm, 8px); background: var(--surface); cursor: pointer; transition: border-color 160ms ease, background 160ms ease; }
	.choice-card.large { align-items: center; min-height: 7rem; }
	.choice-card:hover { border-color: var(--cta); }
	.choice-card:has(input:checked) { border-color: var(--cta); background: var(--accent-soft); }
	.choice-card:has(input:focus-visible) { outline: 3px solid var(--focus); outline-offset: 3px; }
	.choice-card input { flex: 0 0 auto; width: 1.15rem; height: 1.15rem; margin: 0.15rem 0 0; accent-color: var(--cta); }
	.choice-card strong, .choice-card small { display: block; }
	.choice-card strong { line-height: 1.25; }
	.choice-card small { margin-top: 0.35rem; color: var(--text-muted); line-height: 1.35; }
	.choice-icon { display: grid; flex: 0 0 auto; place-items: center; width: 2.75rem; height: 2.75rem; border-radius: var(--radius-sm, 8px); background: var(--accent-soft); color: var(--cta); }
	.choice-icon svg { width: 1.35rem; height: 1.35rem; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
	.compact-fieldset { padding-bottom: 0; }
	.checkbox-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; }
	.checkbox-row label { display: flex; gap: 0.7rem; align-items: flex-start; min-height: 4.5rem; padding: 0.85rem; border: 1px solid var(--border-strong); border-radius: var(--radius-sm, 8px); background: var(--surface); cursor: pointer; }
	.checkbox-row label:has(input:checked) { border-color: var(--cta); background: var(--accent-soft); }
	.checkbox-row label:has(input:focus-visible) { outline: 3px solid var(--focus); outline-offset: 2px; }
	.checkbox-row input { width: 1.2rem; height: 1.2rem; accent-color: var(--cta); }
	.checkbox-row strong, .checkbox-row small { display: block; }
	.checkbox-row small { margin-top: 0.2rem; color: var(--text-muted); line-height: 1.35; }

	.info-panel, .trust-panel, .batch-panel, .publish-note { display: flex; gap: 0.85rem; align-items: flex-start; margin-top: 1.4rem; padding: 1rem; border-radius: var(--radius-sm, 8px); }
	.info-panel { display: block; border: 1px solid var(--border); background: var(--surface-soft); }
	.trust-panel, .publish-note { border: 1px solid var(--success, #315f47); background: var(--success-soft, #e7f0e9); }
	.batch-panel { align-items: center; justify-content: space-between; border: 1px solid var(--border); background: var(--surface-soft); }
	.info-panel p, .trust-panel p, .batch-panel p, .publish-note p { margin: 0.25rem 0 0; color: var(--text-muted); line-height: 1.5; }
	.trust-panel svg, .publish-note svg { flex: 0 0 auto; width: 1.5rem; height: 1.5rem; fill: none; stroke: var(--success); stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
	.batch-panel a { display: inline-flex; flex: 0 0 auto; align-items: center; min-height: 2.75rem; color: var(--cta); font-weight: 700; }
	.batch-panel a:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; border-radius: 0.3rem; }
	.concentration-field { max-width: 32rem; margin: 1.4rem 0; }
	.wanted-volume { max-width: 28rem; margin-top: 1.3rem; }
	.input-unit { display: flex; overflow: hidden; border: 1px solid var(--border-strong); border-radius: var(--radius-sm, 8px); background: var(--surface); }
	.input-unit:focus-within { border-color: var(--focus); outline: 3px solid var(--focus); outline-offset: 1px; }
	.input-unit input { min-width: 0; border: 0; border-radius: 0; outline: 0; }
	.input-unit span { display: grid; place-items: center; min-width: 3.4rem; padding: 0 0.7rem; border-left: 1px solid var(--border); color: var(--text-muted); font-size: 0.8rem; font-weight: 700; }

	.review-layout { display: grid; gap: 0.9rem; }
	.review-card { position: relative; min-width: 0; padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius-sm, 8px); background: var(--surface); }
	.hero-review { display: grid; grid-template-columns: auto 1fr auto; gap: 1rem; align-items: center; background: var(--surface-soft); }
	.bottle-visual { position: relative; display: grid; place-items: end center; width: 5.2rem; height: 6.5rem; }
	.bottle-visual::before { position: absolute; bottom: 0; width: 4.4rem; height: 5rem; border: 1px solid var(--cta); border-radius: var(--radius-md, 12px) var(--radius-md, 12px) var(--radius-sm, 8px) var(--radius-sm, 8px); background: var(--surface); content: ''; }
	.bottle-visual::after { position: absolute; top: 0; width: 2.1rem; height: 1.8rem; border-radius: 0.25rem; background: var(--cta); content: ''; }
	.bottle-visual span { z-index: 1; width: 3.2rem; height: 2.1rem; margin-bottom: 0.65rem; border-radius: 0.25rem; background: var(--panel); }
	.hero-review h3 { margin: 0; font-size: clamp(1.35rem, 3vw, 1.9rem); font-weight: 700; line-height: 1.15; }
	.hero-review p:not(.overline) { margin: 0.3rem 0 0; color: var(--text-muted); }
	.tag-row { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.75rem; }
	.tag-row span { padding: 0.3rem 0.55rem; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); font-size: 0.72rem; font-weight: 700; }
	.review-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.9rem; }
	.review-title { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.75rem; color: var(--text-muted); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
	.review-title .edit-button { font-size: 0.75rem; letter-spacing: normal; text-transform: none; }
	.review-card > strong { font-size: 1.05rem; }
	.review-card > p { display: -webkit-box; overflow: hidden; margin: 0.3rem 0 0; color: var(--text-muted); -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; }
	.review-card > small { display: inline-block; margin-top: 0.5rem; color: var(--success); font-weight: 700; }

	.form-actions { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid var(--border); }
	.action-copy { display: flex; align-items: center; gap: 0.8rem; }
	.action-copy > span { color: var(--text-muted); font-size: 0.78rem; font-weight: 700; }
	.primary-button, .secondary-button { display: inline-flex; align-items: center; justify-content: center; gap: 0.55rem; min-height: 3rem; padding: 0 1.15rem; border-radius: var(--radius-sm, 8px); font: inherit; font-size: 0.92rem; font-weight: 700; cursor: pointer; transition: background 160ms ease, border-color 160ms ease, color 160ms ease; }
	.primary-button { border: 1px solid var(--cta); background: var(--cta); color: var(--surface); }
	.primary-button:hover { border-color: var(--cta-hover); background: var(--cta-hover); }
	.primary-button:disabled { cursor: wait; opacity: 0.62; }
	.secondary-button { border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); }
	.secondary-button:hover:not(:disabled) { border-color: var(--cta); background: var(--accent-soft); }
	.secondary-button:disabled { cursor: not-allowed; opacity: 0.45; }
	.primary-button:focus-visible, .secondary-button:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
	.primary-button svg, .secondary-button svg { width: 1.15rem; height: 1.15rem; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }

	.success-card { display: grid; justify-items: center; padding: clamp(2rem, 7vw, 4.5rem); text-align: center; }
	.success-icon { display: grid; place-items: center; width: 4.5rem; height: 4.5rem; margin-bottom: 1rem; border-radius: 50%; background: var(--success-soft, #e7f0e9); color: var(--success, #315f47); }
	.success-icon svg { width: 2.2rem; height: 2.2rem; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }
	.success-card h2 { margin: 0; outline: none; font-size: clamp(1.8rem, 5vw, 3rem); font-weight: 700; line-height: 1.1; }
	.success-card > p:not(.overline) { max-width: 38rem; margin: 0.8rem auto 0; color: var(--text-muted); }
	.success-summary { display: grid; gap: 0.15rem; min-width: min(100%, 22rem); margin: 1.5rem 0; padding: 1rem; border: 1px solid var(--success, #315f47); border-radius: var(--radius-sm, 8px); background: var(--success-soft, #e7f0e9); }
	.success-summary span { color: var(--text-muted); font-size: 0.85rem; }
	.success-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.7rem; }

	@media (max-width: 760px) {
		.wizard-intro { align-items: flex-start; flex-direction: column; gap: 1rem; }
		.form-grid.two-columns, .choice-grid.three, .review-grid { grid-template-columns: 1fr; }
		.span-two { grid-column: auto; }
		.choice-grid.two { grid-template-columns: 1fr; }
		.hero-review { grid-template-columns: auto 1fr; }
		.hero-review > .edit-button { grid-column: 1 / -1; justify-self: start; }
		.batch-panel { align-items: flex-start; flex-direction: column; }
	}

	@media (max-width: 520px) {
		.wizard-intro h1 { font-size: 2.1rem; }
		.draft-badge { align-self: stretch; justify-content: center; }
		.progress { overflow: visible; }
		.progress ol { grid-template-columns: repeat(6, minmax(0, 1fr)); min-width: 0; }
		.progress ol::before { top: 1.15rem; right: 6%; left: 6%; }
		.progress button { width: 100%; min-width: 0; font-size: 0.64rem; }
		.step-number { width: 2.3rem; height: 2.3rem; }
		.checkbox-row { grid-template-columns: 1fr; }
		.form-actions { align-items: stretch; flex-direction: column-reverse; }
		.action-copy { align-items: stretch; flex-direction: column; }
		.action-copy > span { text-align: center; }
		.primary-button, .secondary-button { width: 100%; }
		.hero-review { grid-template-columns: 1fr; }
		.bottle-visual { display: none; }
	}

	@media (prefers-reduced-motion: reduce) {
		.choice-card, .primary-button, .secondary-button { transition: none; }
	}
</style>
