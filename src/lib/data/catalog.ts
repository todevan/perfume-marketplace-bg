import registryJson from '../../../catalog/brand-categories.json';

export type BrandAliasType =
	| 'searchAlias'
	| 'formerName'
	| 'misspelling'
	| 'transliteration'
	| 'productLine';

export interface BrandAlias {
	type: BrandAliasType;
	value: string;
}

export interface CatalogBrand {
	id: string;
	canonicalName: string;
	aliases: readonly BrandAlias[];
	parentBrandId?: string;
	originCountryCode?: string;
}

export interface BrandSearchResult {
	brand: CatalogBrand;
	matchedBy: 'canonical' | 'alias';
	matchedAlias?: BrandAlias;
}

export type CatalogCollectionKey = 'men' | 'women' | 'unisex' | 'niche' | 'arabic';

export interface CatalogCollection {
	key: CatalogCollectionKey;
	label: string;
	dimension: 'audience' | 'segment';
	value: CatalogCollectionKey;
	expectedBrandCount: number;
	brands: readonly CatalogBrand[];
	description: string;
	intro: string;
	glyph: string;
}

interface RegistryBrand {
	id: string;
	canonicalName: string;
	aliases: BrandAlias[];
	parentBrandId?: string;
	originCountryCode?: string;
}

interface RegistryCollection {
	label: string;
	dimension: 'audience' | 'segment';
	value: CatalogCollectionKey;
	expectedBrandCount: number;
	brandIds: string[];
}

const registry = registryJson as unknown as {
	otherBrandPolicy: {
		label: string;
		moderationState: 'pending_canonicalization';
	};
	brands: RegistryBrand[];
	collections: Record<CatalogCollectionKey, RegistryCollection>;
};

/** The canonical registry is deliberately independent from the editorial collections. */
export const catalogBrands: readonly CatalogBrand[] = Object.freeze(
	registry.brands
		.map((brand) => ({ ...brand, aliases: Object.freeze([...brand.aliases]) }))
		.sort((left, right) => left.canonicalName.localeCompare(right.canonicalName, 'bg-BG'))
);

export const otherBrandOption = Object.freeze({
	label: registry.otherBrandPolicy.label,
	moderationState: registry.otherBrandPolicy.moderationState
});

export const catalogCollectionKeys = Object.freeze([
	'men',
	'women',
	'unisex',
	'niche',
	'arabic'
] as const satisfies readonly CatalogCollectionKey[]);

const collectionPresentation: Readonly<
	Record<CatalogCollectionKey, Pick<CatalogCollection, 'description' | 'intro' | 'glyph'>>
> = Object.freeze({
	men: {
		description: 'Класически, свежи и дървесни парфюмни къщи',
		intro: 'Редакционен подбор на марки, в чиито каталози общността често открива мъжки аромати.',
		glyph: 'M'
	},
	women: {
		description: 'Флорални, гурме и модерни парфюмни подписи',
		intro: 'Подбрани марки с популярни дамски композиции — от утвърдени модни къщи до съвременни имена.',
		glyph: 'Д'
	},
	unisex: {
		description: 'Композиции отвъд традиционните категории',
		intro: 'Марки с богато присъствие на унисекс аромати, подбрани за по-свободно откриване.',
		glyph: 'У'
	},
	niche: {
		description: 'Авторски къщи и необичайни суровини',
		intro: 'Редакционна витрина за независими и луксозни парфюмни къщи с отличим творчески почерк.',
		glyph: 'Н'
	},
	arabic: {
		description: 'Петнадесет подбрани къщи от Близкия изток',
		intro: 'Компактна селекция на разпознаваеми арабски марки, без автоматично категоризиране на обявите им.',
		glyph: 'ع'
	}
});

const catalogBrandById = new Map(catalogBrands.map((brand) => [brand.id, brand]));

/** Stable public URL key derived from the canonical registry ID. */
export function brandSlug(brand: Pick<CatalogBrand, 'id'>): string {
	return brand.id.replace(/^brand-/, '');
}

function createCatalogCollection(key: CatalogCollectionKey): CatalogCollection {
	const source = registry.collections[key];
	const brands = source.brandIds.map((id) => {
		const brand = catalogBrandById.get(id);
		if (!brand) throw new Error(`Collection ${key} references unknown brand ${id}`);
		return brand;
	});
	if (brands.length !== source.expectedBrandCount) {
		throw new Error(
			`Collection ${key} contains ${brands.length} brands; expected ${source.expectedBrandCount}`
		);
	}

	return Object.freeze({
		key,
		label: source.label,
		dimension: source.dimension,
		value: source.value,
		expectedBrandCount: source.expectedBrandCount,
		brands: Object.freeze(brands),
		...collectionPresentation[key]
	});
}

/** Exact editorial vitrines from brand-categories.json; overlaps are intentional. */
export const catalogCollections: Readonly<Record<CatalogCollectionKey, CatalogCollection>> =
	Object.freeze(
		Object.fromEntries(
			catalogCollectionKeys.map((key) => [key, createCatalogCollection(key)])
		) as Record<CatalogCollectionKey, CatalogCollection>
	);

export function getCatalogCollection(value: string): CatalogCollection | null {
	return catalogCollectionKeys.includes(value as CatalogCollectionKey)
		? catalogCollections[value as CatalogCollectionKey]
		: null;
}

export const brandAliasTypeLabels: Readonly<Record<BrandAliasType, string>> = Object.freeze({
	searchAlias: 'познато име',
	formerName: 'предишно име',
	misspelling: 'често изписване',
	transliteration: 'транслитерация',
	productLine: 'продуктова линия'
});

/** Normalization mirrors the catalogue search policy and is safe for Cyrillic and Latin input. */
export function normalizeBrandSearch(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLocaleLowerCase('bg-BG')
		.replace(/&/g, ' and ')
		.replace(/[’'`]/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

function matchScore(searchKey: string, candidateKey: string, alias: boolean): number | null {
	if (!searchKey) return alias ? null : 10;
	if (candidateKey === searchKey) return alias ? 1 : 0;
	if (candidateKey.startsWith(searchKey)) return alias ? 3 : 2;
	if (candidateKey.includes(searchKey)) return alias ? 5 : 4;

	const tokens = searchKey.split(' ');
	if (tokens.length > 1 && tokens.every((token) => candidateKey.includes(token))) {
		return alias ? 7 : 6;
	}

	return null;
}

/**
 * Returns one result per canonical brand. Aliases only affect matching and never become stored names.
 */
export function searchCatalogBrands(query: string, limit = 8): BrandSearchResult[] {
	const searchKey = normalizeBrandSearch(query);
	const safeLimit = Math.max(0, Math.min(8, Math.trunc(limit)));

	return catalogBrands
		.map((brand) => {
			const canonicalScore = matchScore(
				searchKey,
				normalizeBrandSearch(brand.canonicalName),
				false
			);
			let bestScore = canonicalScore;
			let matchedAlias: BrandAlias | undefined;

			for (const alias of brand.aliases) {
				const aliasScore = matchScore(searchKey, normalizeBrandSearch(alias.value), true);
				if (aliasScore !== null && (bestScore === null || aliasScore < bestScore)) {
					bestScore = aliasScore;
					matchedAlias = alias;
				}
			}

			if (bestScore === null) return null;
			return {
				result: {
					brand,
					matchedBy: matchedAlias ? ('alias' as const) : ('canonical' as const),
					...(matchedAlias ? { matchedAlias } : {})
				},
				score: bestScore
			};
		})
		.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
		.sort(
			(left, right) =>
				left.score - right.score ||
				left.result.brand.canonicalName.localeCompare(right.result.brand.canonicalName, 'bg-BG')
		)
		.slice(0, safeLimit)
		.map(({ result }) => result);
}

/** Resolves only an exact canonical name or exact typed alias. */
export function resolveCatalogBrand(value: string): BrandSearchResult | null {
	const searchKey = normalizeBrandSearch(value);
	if (!searchKey) return null;

	for (const brand of catalogBrands) {
		if (normalizeBrandSearch(brand.canonicalName) === searchKey) {
			return { brand, matchedBy: 'canonical' };
		}

		const alias = brand.aliases.find(
			(candidate) => normalizeBrandSearch(candidate.value) === searchKey
		);
		if (alias) return { brand, matchedBy: 'alias', matchedAlias: alias };
	}

	return null;
}
