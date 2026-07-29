import type { ListingCardDto } from '$lib/contracts';
import type {
	Audience,
	Concentration,
	DealMode,
	ListingStatus,
	ProductFormat
} from '$domain/types';

export interface PerfumeVisualTheme {
	glass: string;
	liquid: string;
	cap: string;
	backdrop: string;
	shape: 'square' | 'round' | 'tall' | 'wide';
}

const VISUAL_THEMES: readonly PerfumeVisualTheme[] = [
	{
		glass: 'var(--ink-soft)',
		liquid: 'var(--ink)',
		cap: 'var(--ink)',
		backdrop: 'var(--brand-tertiary)',
		shape: 'square'
	},
	{
		glass: 'var(--action)',
		liquid: 'var(--action-hover)',
		cap: 'var(--ink)',
		backdrop: 'var(--brand-main)',
		shape: 'square'
	},
	{
		glass: 'var(--ink)',
		liquid: 'var(--action)',
		cap: 'var(--ink)',
		backdrop: 'var(--paper-deep)',
		shape: 'wide'
	},
	{
		glass: 'var(--line-strong)',
		liquid: 'var(--action)',
		cap: 'var(--ink-soft)',
		backdrop: 'var(--paper-strong)',
		shape: 'square'
	},
	{
		glass: 'var(--action)',
		liquid: 'var(--action-hover)',
		cap: 'var(--line-strong)',
		backdrop: 'var(--action-soft)',
		shape: 'tall'
	},
	{
		glass: 'var(--ink-soft)',
		liquid: 'var(--action)',
		cap: 'var(--line-strong)',
		backdrop: 'var(--brand-secondary)',
		shape: 'round'
	}
];

export const dealModeLabels: Readonly<Record<DealMode, string>> = {
	sale: 'Продажба',
	swap: 'Размяна',
	sale_or_swap: 'Продажба или размяна'
};

export const productFormatLabels: Readonly<Record<ProductFormat, string>> = {
	retail_bottle: 'Оригинален флакон',
	tester: 'Тестер',
	official_sample: 'Официална мостра'
};

export const concentrationLabels: Readonly<Record<Concentration, string>> = {
	EDT: 'Eau de Toilette (EDT)',
	EDP: 'Eau de Parfum (EDP)',
	PARFUM: 'Parfum',
	EXTRAIT: 'Extrait de Parfum',
	EDC: 'Eau de Cologne (EDC)',
	OTHER_NOT_STATED: 'Концентрацията не е посочена'
};

export function formatConcentration(concentration: Concentration): string {
	return concentrationLabels[concentration];
}

export const listingStatusLabels: Readonly<Record<ListingStatus, string>> = {
	draft: 'Чернова',
	active: 'Активна',
	reserved: 'Резервирана',
	paused: 'Пауза',
	completed: 'Завършена',
	expired: 'Изтекла',
	rejected: 'Отхвърлена',
	removed: 'Премахната'
};

export function formatMoney(amountMinor: number): string {
	return new Intl.NumberFormat('bg-BG', {
		style: 'currency',
		currency: 'EUR'
	}).format(amountMinor / 100);
}

export function formatListingPrice(listing: ListingCardDto): string {
	if (listing.kind === 'wanted') {
		return listing.maxBudget ? `До ${formatMoney(listing.maxBudget.amountMinor)}` : 'Търся размяна';
	}
	return listing.price ? formatMoney(listing.price.amountMinor) : 'Само размяна';
}

export function remainingPercent(listing: Pick<ListingCardDto, 'bottleVolumeMl' | 'remainingMl' | 'isSealed'>): number {
	if (listing.isSealed) return 100;
	if (!listing.bottleVolumeMl || listing.remainingMl == null) return 0;
	return Math.max(0, Math.min(100, Math.round((listing.remainingMl / listing.bottleVolumeMl) * 100)));
}

export function visualThemeForListing(id: string): PerfumeVisualTheme {
	let hash = 0;
	for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
	return VISUAL_THEMES[Math.abs(hash) % VISUAL_THEMES.length];
}

export function audienceLabel(audience: Audience): string {
	return audience === 'men' ? 'Мъжки' : audience === 'women' ? 'Дамски' : 'Унисекс';
}

export function segmentLabel(segment: 'niche' | 'arabic'): string {
	return segment === 'niche' ? 'Нишов' : 'Арабски';
}
