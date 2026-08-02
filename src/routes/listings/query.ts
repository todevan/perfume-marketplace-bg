import type { ListingSearchInput } from '$lib/contracts';

export const LISTINGS_PAGE_SIZE = 12;

export interface ListingRouteFilters {
	q: string;
	category: 'all' | 'men' | 'women' | 'unisex' | 'niche' | 'arabic';
	kind: 'all' | 'offer' | 'wanted';
	mode: 'all' | 'sale' | 'swap' | 'sale_or_swap';
	format: 'all' | 'retail_bottle' | 'tester' | 'official_sample';
	city: string;
	minPrice: string;
	maxPrice: string;
	sort: 'newest' | 'price-asc' | 'price-desc';
	page: number;
	cursorActivatedAt: string;
	cursorPriceMinor: string;
	cursorId: string;
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
	return value && allowed.includes(value as T) ? (value as T) : fallback;
}

function pageNumber(value: string | null): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 834) : 1;
}

function euroToMinor(value: string): number | undefined {
	const parsed = Number(value.replace(',', '.'));
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
	return Math.round(parsed * 100);
}

export function parseListingRouteQuery(url: URL): {
	filters: ListingRouteFilters;
	input: ListingSearchInput;
} {
	const filters: ListingRouteFilters = {
		q: (url.searchParams.get('q') ?? '').trim().slice(0, 120),
		category: oneOf(url.searchParams.get('category'), ['all', 'men', 'women', 'unisex', 'niche', 'arabic'], 'all'),
		kind: oneOf(url.searchParams.get('kind'), ['all', 'offer', 'wanted'], 'all'),
		mode: oneOf(url.searchParams.get('mode'), ['all', 'sale', 'swap', 'sale_or_swap'], 'all'),
		format: oneOf(url.searchParams.get('format'), ['all', 'retail_bottle', 'tester', 'official_sample'], 'all'),
		city: (url.searchParams.get('city') ?? '').trim().slice(0, 100),
		minPrice: (url.searchParams.get('minPrice') ?? '').trim().slice(0, 12),
		maxPrice: (url.searchParams.get('maxPrice') ?? '').trim().slice(0, 12),
		sort: oneOf(url.searchParams.get('sort'), ['newest', 'price-asc', 'price-desc'], 'newest'),
		page: pageNumber(url.searchParams.get('page')),
		cursorActivatedAt: (url.searchParams.get('cursorAt') ?? '').trim(),
		cursorPriceMinor: (url.searchParams.get('cursorPrice') ?? '').trim(),
		cursorId: (url.searchParams.get('cursorId') ?? '').trim()
	};

	const input: ListingSearchInput = {
		query: filters.q,
		segments: filters.category === 'niche' || filters.category === 'arabic' ? [filters.category] : [],
		sort: filters.sort === 'price-asc' ? 'price_asc' : filters.sort === 'price-desc' ? 'price_desc' : 'newest',
		limit: LISTINGS_PAGE_SIZE,
		offset: (filters.page - 1) * LISTINGS_PAGE_SIZE
	};
	if (filters.category === 'men' || filters.category === 'women' || filters.category === 'unisex') input.audience = filters.category;
	if (filters.kind !== 'all') input.kind = filters.kind;
	if (filters.mode !== 'all') input.dealMode = filters.mode;
	if (filters.format !== 'all') input.productFormat = filters.format;
	if (filters.city) input.city = filters.city;
	const minPriceMinor = euroToMinor(filters.minPrice);
	const maxPriceMinor = euroToMinor(filters.maxPrice);
	if (minPriceMinor !== undefined) input.minPriceMinor = minPriceMinor;
	if (maxPriceMinor !== undefined) input.maxPriceMinor = maxPriceMinor;
	const cursorIdIsValid =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
			.test(filters.cursorId);
	if (cursorIdIsValid) {
		if (
			input.sort === 'newest' &&
			filters.cursorActivatedAt &&
			!Number.isNaN(Date.parse(filters.cursorActivatedAt))
		) {
			input.cursorActivatedAt = filters.cursorActivatedAt;
			input.cursorId = filters.cursorId;
			input.offset = 0;
		} else if (input.sort !== 'newest') {
			const cursorPriceMinor = Number(filters.cursorPriceMinor);
			if (
				Number.isInteger(cursorPriceMinor) &&
				cursorPriceMinor >= -1 &&
				cursorPriceMinor <= 2_147_483_647
			) {
				input.cursorPriceMinor = cursorPriceMinor;
				input.cursorId = filters.cursorId;
				input.offset = 0;
			}
		}
	}

	return { filters, input };
}

export function listingCursorHref(
	url: URL,
	cursor: {
		readonly sort?: 'newest' | 'price_asc' | 'price_desc';
		readonly activatedAt?: string | null;
		readonly priceMinor?: number | null;
		readonly id: string;
	}
): string {
	const params = new URLSearchParams(url.searchParams);
	params.delete('page');
	params.delete('cursorAt');
	params.delete('cursorPrice');
	if ((cursor.sort ?? 'newest') === 'newest' && cursor.activatedAt) {
		params.set('cursorAt', cursor.activatedAt);
	} else if (cursor.priceMinor !== null && cursor.priceMinor !== undefined) {
		params.set('cursorPrice', String(cursor.priceMinor));
	}
	params.set('cursorId', cursor.id);
	return `/listings?${params.toString()}`;
}

export function listingStartHref(url: URL): string {
	const params = new URLSearchParams(url.searchParams);
	params.delete('page');
	params.delete('cursorAt');
	params.delete('cursorPrice');
	params.delete('cursorId');
	const query = params.toString();
	return query ? `/listings?${query}` : '/listings';
}

export function listingPageHref(url: URL, page: number): string {
	const params = new URLSearchParams(url.searchParams);
	if (page <= 1) params.delete('page');
	else params.set('page', String(page));
	const query = params.toString();
	return query ? `/listings?${query}` : '/listings';
}
