import type {
	ListingCardDto,
	ListingDetailDto,
	ListingPageDto,
	ListingSearchInput
} from '$lib/contracts';
import { demoListings, type DemoListing } from '$lib/data/demo';

const UUID_PREFIX = '00000000-0000-4000-8000-';
const DEMO_IMAGE_PATHS = [
	'/demo/listings/sauvage-dark-bottle.webp',
	'/demo/listings/khamrah-amber-bottle.webp',
	'/demo/listings/oud-wood-smoky-bottle.webp',
	'/demo/listings/coco-rose-bottle.webp',
	'/demo/listings/baccarat-ruby-bottle.webp',
	'/demo/listings/libre-honey-bottle.webp',
	'/demo/listings/interlude-blue-bottle.webp',
	'/demo/listings/erba-violet-bottle.webp'
] as const;

function uuidFor(index: number, group = 0): string {
	return `${UUID_PREFIX}${String(group * 1000 + index + 1).padStart(12, '0')}`;
}

function concentration(value: DemoListing['concentration']): ListingCardDto['concentration'] {
	if (value === 'Parfum') return 'PARFUM';
	if (value === 'Extrait') return 'EXTRAIT';
	return value;
}

function dealMode(value: DemoListing['mode']): ListingCardDto['dealMode'] {
	return value === 'Продажба' ? 'sale' : value === 'Размяна' ? 'swap' : 'sale_or_swap';
}

function audience(value: DemoListing['audience']): ListingDetailDto['audience'] {
	return value === 'Мъжки' ? 'men' : value === 'Дамски' ? 'women' : 'unisex';
}

function demoCard(item: DemoListing, index: number): ListingCardDto {
	return {
		id: uuidFor(index),
		slug: item.slug,
		kind: 'offer',
		dealMode: dealMode(item.mode),
		title: `${item.brand} ${item.perfume}`,
		brandId: uuidFor(index, 1),
		brandName: item.brand,
		brandSlug: item.brand.toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
		fragranceName: item.perfume,
		concentration: concentration(item.concentration),
		city: item.city,
		price: item.price == null ? null : { amountMinor: item.price * 100, currency: 'EUR' },
		maxBudget: null,
		bottleVolumeMl: item.volumeMl,
		remainingMl: item.remainingMl,
		isSealed: item.remainingMl === item.volumeMl,
		status: 'active',
		seller: {
			id: uuidFor(index, 2),
			username: item.seller,
			avatarUrl: null,
			accountKind: item.sellerKind === 'Проверен търговец' ? 'merchant' : 'private',
			merchantVerified: item.sellerKind === 'Проверен търговец'
		},
		primaryPhoto: {
			id: uuidFor(index, 3),
			imageUrl: DEMO_IMAGE_PATHS[index],
			role: 'product_full',
			sortOrder: 0
		},
		authenticityReviewed: false,
		createdAt: new Date(Date.UTC(2026, 6, 22, 12 - index)).toISOString()
	};
}

const cards = demoListings.map(demoCard);

export function getDemoListingBySlug(slug: string): ListingDetailDto | null {
	const index = demoListings.findIndex((item) => item.slug === slug);
	if (index < 0) return null;
	const source = demoListings[index];
	return {
		...cards[index],
		productFormat: 'retail_bottle',
		audience: audience(source.audience),
		segments: source.segments.map((segment) => segment === 'Нишови' ? 'niche' as const : 'arabic' as const),
		fragranceId: null,
		concentrationLabel: null,
		description: source.description,
		estimatedValue: null,
		referenceUrl: source.fragranticaUrl ?? null,
		photos: cards[index].primaryPhoto ? [cards[index].primaryPhoto] : [],
		authenticityNote: null,
		activatedAt: cards[index].createdAt,
		expiresAt: null,
		updatedAt: cards[index].createdAt
	};
}

export function browseDemoListings(input: ListingSearchInput): ListingPageDto {
	const query = input.query.toLocaleLowerCase('bg-BG');
	let items = cards.filter((item, index) => {
		const detail = getDemoListingBySlug(item.slug);
		const source = demoListings[index];
		return (
			(!query || `${item.brandName} ${item.fragranceName}`.toLocaleLowerCase('bg-BG').includes(query)) &&
			(!input.kind || item.kind === input.kind) &&
			(!input.dealMode || item.dealMode === input.dealMode) &&
			(!input.audience || detail?.audience === input.audience) &&
			(input.segments.length === 0 || input.segments.every((segment) => detail?.segments.includes(segment))) &&
			(!input.productFormat || detail?.productFormat === input.productFormat) &&
			(!input.city || source.city.toLocaleLowerCase('bg-BG').includes(input.city.toLocaleLowerCase('bg-BG'))) &&
			(input.minPriceMinor === undefined || (item.price?.amountMinor ?? Number.POSITIVE_INFINITY) >= input.minPriceMinor) &&
			(input.maxPriceMinor === undefined || (item.price?.amountMinor ?? Number.POSITIVE_INFINITY) <= input.maxPriceMinor)
		);
	});

	if (input.sort !== 'newest') {
		items = [...items].sort((left, right) => {
			const leftPrice = left.price?.amountMinor ?? Number.POSITIVE_INFINITY;
			const rightPrice = right.price?.amountMinor ?? Number.POSITIVE_INFINITY;
			return input.sort === 'price_asc' ? leftPrice - rightPrice : rightPrice - leftPrice;
		});
	}
	const total = items.length;
	const pageItems = items.slice(input.offset, input.offset + input.limit);
	return {
		items: pageItems,
		total,
		limit: input.limit,
		offset: input.offset,
		hasMore: input.offset + pageItems.length < total,
		nextCursor: null,
		totalIsExact: true
	};
}

export function demoOwnListings(): ListingPageDto {
	const items = cards.slice(0, 3);
	return { items, total: items.length, limit: 10, offset: 0, hasMore: false, nextCursor: null, totalIsExact: true };
}
