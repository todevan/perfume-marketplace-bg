import type {
	BrandCollectionItemDto,
	BrandSummaryDto,
	CatalogSearchDto,
	CatalogSearchInput,
	FragranceLookupInput,
	FragranceSummaryDto,
	PendingBrandInput
} from '../../contracts';
import type { Tables } from '../database.types';
import {
	escapeLikePattern,
	oneRelation,
	throwIfError,
	type MarketplaceSupabaseClient
} from './shared';

type BrandRow = Tables<'brands'>;
type FragranceRow = Tables<'fragrances'>;
type BrandRelation = Pick<BrandRow, 'id' | 'canonical_name' | 'slug' | 'parent_brand_id'>;
type FragranceJoinedRow = FragranceRow & { brand: BrandRelation | readonly BrandRelation[] | null };

const BRAND_COLUMNS = 'id,canonical_name,slug,parent_brand_id' as const;
const FRAGRANCE_COLUMNS =
	'id,slug,brand_id,name,audience,segments,concentration,concentration_label,fragrantica_url,brand:brands!fragrances_brand_id_fkey(id,canonical_name,slug,parent_brand_id)' as const;

export function toBrandSummaryDto(row: BrandRelation): BrandSummaryDto {
	return {
		id: row.id,
		name: row.canonical_name,
		slug: row.slug,
		parentBrandId: row.parent_brand_id
	};
}

export function toFragranceSummaryDto(row: FragranceJoinedRow): FragranceSummaryDto {
	const brand = oneRelation(row.brand);
	if (!brand) throw new Error(`Fragrance ${row.id} is missing its brand projection.`);
	return {
		id: row.id,
		slug: row.slug,
		brand: toBrandSummaryDto(brand),
		name: row.name,
		audience: row.audience,
		segments: row.segments,
		concentration: row.concentration,
		concentrationLabel: row.concentration_label,
		referenceUrl: row.fragrantica_url
	};
}

async function collectionBrandIds(
	client: MarketplaceSupabaseClient,
	collection: CatalogSearchInput['collection']
): Promise<readonly string[] | null> {
	if (!collection) return null;
	const { data, error } = await client
		.from('brand_collection_memberships')
		.select('brand_id')
		.eq('collection', collection)
		.order('display_order');
	throwIfError('catalog.collectionBrandIds', error);
	return (data ?? []).map((row) => row.brand_id);
}

export async function searchCatalog(
	client: MarketplaceSupabaseClient,
	input: CatalogSearchInput
): Promise<CatalogSearchDto> {
	if (input.query) {
		const { data: matches, error: searchError } = await client.rpc('search_catalog_v2', {
			search_query: input.query,
			page_size: input.limit,
			page_offset: input.offset
		});
		throwIfError('catalog.searchRpc', searchError);
		const pageMatches = matches ?? [];
		const brandIds = [...new Set(pageMatches.filter((row) => row.entity_type === 'brand').map((row) => row.id))];
		const fragranceIds = [...new Set(pageMatches.filter((row) => row.entity_type === 'fragrance').map((row) => row.id))];
		const brandRows = new Map<string, BrandSummaryDto>();
		const fragranceRows = new Map<string, FragranceSummaryDto>();
		if (brandIds.length) {
			const { data, error } = await client.from('brands').select(BRAND_COLUMNS).in('id', brandIds);
			throwIfError('catalog.searchRpcBrands', error);
			for (const row of (data ?? []) as unknown as BrandRelation[]) {
				brandRows.set(row.id, toBrandSummaryDto(row));
			}
		}
		if (fragranceIds.length) {
			const { data, error } = await client.from('fragrances').select(FRAGRANCE_COLUMNS).in('id', fragranceIds);
			throwIfError('catalog.searchRpcFragrances', error);
			for (const row of (data ?? []) as unknown as FragranceJoinedRow[]) {
				fragranceRows.set(row.id, toFragranceSummaryDto(row));
			}
		}
		return {
			brands: pageMatches.flatMap((match) => {
				const brand = match.entity_type === 'brand' ? brandRows.get(match.id) : undefined;
				return brand ? [brand] : [];
			}),
			fragrances: pageMatches.flatMap((match) => {
				const fragrance = match.entity_type === 'fragrance' ? fragranceRows.get(match.id) : undefined;
				return fragrance ? [fragrance] : [];
			})
		};
	}

	const allowedBrandIds = await collectionBrandIds(client, input.collection);
	if (allowedBrandIds?.length === 0) return { brands: [], fragrances: [] };

	let directBrands = client
		.from('brands')
		.select(BRAND_COLUMNS)
		.eq('status', 'canonical')
		.order('canonical_name')
		.range(input.offset, input.offset + input.limit - 1);
	if (allowedBrandIds) directBrands = directBrands.in('id', [...allowedBrandIds]);

	let aliases = client
		.from('brand_aliases')
		.select('brand:brands!brand_aliases_brand_id_fkey(id,canonical_name,slug,parent_brand_id)')
		.order('alias')
		.range(input.offset, input.offset + input.limit - 1);
	if (allowedBrandIds) aliases = aliases.in('brand_id', [...allowedBrandIds]);

	let fragrances = client
		.from('fragrances')
		.select(FRAGRANCE_COLUMNS)
		.eq('is_active', true)
		.order('name')
		.range(input.offset, input.offset + input.limit - 1);
	if (allowedBrandIds) fragrances = fragrances.in('brand_id', [...allowedBrandIds]);

	const [brandResult, aliasResult, fragranceResult] = await Promise.all([
		directBrands,
		aliases,
		fragrances
	]);
	throwIfError('catalog.searchBrands', brandResult.error);
	throwIfError('catalog.searchAliases', aliasResult.error);
	throwIfError('catalog.searchFragrances', fragranceResult.error);

	const brands = new Map<string, BrandSummaryDto>();
	for (const row of (brandResult.data ?? []) as unknown as BrandRelation[]) {
		brands.set(row.id, toBrandSummaryDto(row));
	}
	for (const row of (aliasResult.data ?? []) as unknown as Array<{
		brand: BrandRelation | readonly BrandRelation[] | null;
	}>) {
		const brand = oneRelation(row.brand);
		if (brand) brands.set(brand.id, toBrandSummaryDto(brand));
	}

	return {
		brands: [...brands.values()].slice(0, input.limit),
		fragrances: ((fragranceResult.data ?? []) as unknown as FragranceJoinedRow[]).map(
			toFragranceSummaryDto
		)
	};
}

export async function listBrandCollection(
	client: MarketplaceSupabaseClient,
	collection: CatalogSearchInput['collection']
): Promise<readonly BrandCollectionItemDto[]> {
	if (!collection) return [];
	const { data, error } = await client
		.from('brand_collection_memberships')
		.select(
			'collection,display_order,brand:brands!brand_collection_memberships_brand_id_fkey(id,canonical_name,slug,parent_brand_id)'
		)
		.eq('collection', collection)
		.order('display_order');
	throwIfError('catalog.listCollection', error);
	return ((data ?? []) as unknown as Array<{
		collection: BrandCollectionItemDto['collection'];
		display_order: number;
		brand: BrandRelation | readonly BrandRelation[] | null;
	}>).flatMap((row) => {
		const brand = oneRelation(row.brand);
		return brand
			? [{ ...toBrandSummaryDto(brand), collection: row.collection, displayOrder: row.display_order }]
			: [];
	});
}

export async function listFragrancesByBrand(
	client: MarketplaceSupabaseClient,
	input: FragranceLookupInput
): Promise<readonly FragranceSummaryDto[]> {
	let query = client
		.from('fragrances')
		.select(FRAGRANCE_COLUMNS)
		.eq('brand_id', input.brandId)
		.eq('is_active', true)
		.order('name')
		.range(input.offset, input.offset + input.limit - 1);
	if (input.query) query = query.ilike('name', `%${escapeLikePattern(input.query)}%`);
	const { data, error } = await query;
	throwIfError('catalog.listFragrances', error);
	return ((data ?? []) as unknown as FragranceJoinedRow[]).map(toFragranceSummaryDto);
}

export async function findFragranceBySlug(
	client: MarketplaceSupabaseClient,
	slug: string
): Promise<FragranceSummaryDto | null> {
	const { data, error } = await client
		.from('fragrances')
		.select(FRAGRANCE_COLUMNS)
		.eq('slug', slug)
		.eq('is_active', true)
		.maybeSingle();
	throwIfError('catalog.findFragranceBySlug', error);
	return data ? toFragranceSummaryDto(data as unknown as FragranceJoinedRow) : null;
}

export async function createPendingBrand(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: PendingBrandInput
): Promise<BrandSummaryDto> {
	const id = crypto.randomUUID();
	const { data, error } = await client
		.from('brands')
		.insert({
			id,
			canonical_name: input.displayName,
			slug: `pending-${id}`,
			normalized_key: input.displayName.toLocaleLowerCase('bg-BG'),
			status: 'pending_canonicalization',
			submitted_display_name: input.displayName,
			suggested_brand_id: input.suggestedBrandId ?? null,
			created_by: profileId,
			provenance: { source: 'seller' }
		})
		.select(BRAND_COLUMNS)
		.single();
	throwIfError('catalog.createPendingBrand', error);
	if (!data) throw new Error('Pending brand insert returned no row.');
	return toBrandSummaryDto(data as BrandRelation);
}
