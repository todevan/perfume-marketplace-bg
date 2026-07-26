import type { ListingCardDto } from '$lib/contracts';
import type { Audience, DealMode, ListingStatus, ProductFormat } from '$domain/types';

export interface PerfumeVisualTheme {
	glass: string;
	liquid: string;
	cap: string;
	backdrop: string;
	shape: 'square' | 'round' | 'tall' | 'wide';
}

const VISUAL_THEMES: readonly PerfumeVisualTheme[] = [
	{ glass: '#263743', liquid: '#16242c', cap: '#11191e', backdrop: '#d7d8d5', shape: 'square' },
	{ glass: '#a66a2c', liquid: '#6b3518', cap: '#bd8845', backdrop: '#ead4b4', shape: 'square' },
	{ glass: '#32261f', liquid: '#1e1713', cap: '#19110e', backdrop: '#cbb6a4', shape: 'wide' },
	{ glass: '#e4c4b5', liquid: '#d99d85', cap: '#d7c8bf', backdrop: '#f1ded4', shape: 'square' },
	{ glass: '#a53232', liquid: '#701d21', cap: '#c1a06b', backdrop: '#ead2c8', shape: 'tall' },
	{ glass: '#6e5c8f', liquid: '#4c3a70', cap: '#b5a365', backdrop: '#dcd4e5', shape: 'round' }
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
