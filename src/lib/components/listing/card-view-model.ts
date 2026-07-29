import type { ListingCardDto } from '$lib/contracts';

export interface LegacyListing {
	id: string;
	slug: string;
	brand: string;
	perfume: string;
	concentration: 'EDT' | 'EDP' | 'Parfum' | 'Extrait';
	mode: 'Продажба' | 'Размяна' | 'Продажба или размяна';
	price?: number;
	volumeMl: number;
	remainingMl: number;
	city: string;
	seller: string;
	sellerKind: 'Частно лице' | 'Проверен търговец';
	verifiedEvidence?: boolean;
	sponsored?: boolean;
}

export function normalizeListing(value: ListingCardDto | LegacyListing): ListingCardDto {
	if ('brandName' in value) return value;
	return {
		id: value.id,
		slug: value.slug,
		kind: 'offer',
		dealMode: value.mode === 'Продажба' ? 'sale' : value.mode === 'Размяна' ? 'swap' : 'sale_or_swap',
		title: `${value.brand} ${value.perfume}`,
		brandId: value.brand,
		brandName: value.brand,
		brandSlug: value.brand.toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, '-'),
		fragranceName: value.perfume,
		concentration: value.concentration === 'Parfum' ? 'PARFUM' : value.concentration === 'Extrait' ? 'EXTRAIT' : value.concentration,
		city: value.city,
		price: value.price == null ? null : { amountMinor: value.price * 100, currency: 'EUR' },
		maxBudget: null,
		bottleVolumeMl: value.volumeMl,
		remainingMl: value.remainingMl,
		isSealed: value.remainingMl === value.volumeMl,
		status: 'active',
		seller: {
			id: value.seller,
			username: value.seller.replace(/^@/, ''),
			avatarUrl: null,
			accountKind: value.sellerKind === 'Проверен търговец' ? 'merchant' : 'private',
			merchantVerified: value.sellerKind === 'Проверен търговец'
		},
		primaryPhoto: null,
		authenticityReviewed: value.verifiedEvidence === true,
		isFavorite: false,
		createdAt: '1970-01-01T00:00:00.000Z'
	};
}

export function profileKindLabel(card: Pick<ListingCardDto, 'seller'>): string {
	if (card.seller.merchantVerified) return 'Проверен търговец';
	return card.seller.accountKind === 'merchant' ? 'Търговец' : 'Частно лице';
}

export function bottleVolumeLabel(card: Pick<ListingCardDto, 'bottleVolumeMl' | 'kind'>): string {
	if (card.bottleVolumeMl == null) {
		return card.kind === 'wanted' ? 'Желан обем не е посочен' : 'Обемът не е посочен';
	}
	return `${card.bottleVolumeMl} ml`;
}

export function remainingLabel(card: Pick<ListingCardDto, 'remainingMl' | 'kind'>, percent: number): string {
	if (card.remainingMl == null) {
		return card.kind === 'wanted' ? 'Желан остатък не е посочен' : 'Остатъкът не е посочен';
	}
	return `${card.remainingMl} ml (${percent}%)`;
}
