import type {
	ActorSummaryDto,
	CreateListingUploadInput,
	ListingCardDto,
	ListingDetailDto,
	ListingDraftInput,
	ListingPageDto,
	ListingPhotoDto,
	ListingUploadDto,
	ListingUploadIntentDto,
	ListingSearchInput,
	UpdateListingDraftInput
} from '../../contracts';
import type { Tables, TablesInsert, Views } from '../database.types';
import {
	oneRelation,
	pageDto,
	requireData,
	RepositoryError,
	signedListingImageUrls,
	throwIfError,
	type MarketplaceSupabaseClient
} from './shared';

type ProfileRelation = Pick<
	Views<'public_profiles'>,
	'id' | 'username' | 'avatar_path' | 'account_kind' | 'is_merchant_verified'
>;
type BrandRelation = Pick<Tables<'brands'>, 'id' | 'canonical_name' | 'slug'>;
type PhotoRelation = Pick<
	Tables<'listing_photos'>,
	'id' | 'storage_path' | 'role' | 'sort_order'
>;
type AuthenticityRelation = Pick<
	Tables<'listing_authenticity_reviews'>,
	'status' | 'public_note'
>;

export type ListingJoinedRow = Tables<'listings'> & {
	brand: BrandRelation | readonly BrandRelation[] | null;
	seller?: ProfileRelation | readonly ProfileRelation[] | null;
	photos: readonly PhotoRelation[] | null;
	authenticity: AuthenticityRelation | readonly AuthenticityRelation[] | null;
};

export const LISTING_PROJECTION = `
	id,slug,seller_id,kind,deal_mode,product_format,audience,segments,brand_id,fragrance_id,
	fragrance_name,concentration,concentration_label,fragrantica_url,title,description,city,
	bottle_volume_ml,remaining_ml,is_sealed,price_minor,estimated_value_minor,max_budget_minor,
	status,activated_at,expires_at,completed_at,created_at,updated_at,
	brand:brands!listings_brand_id_fkey(id,canonical_name,slug),
	photos:listing_photos(id,storage_path,role,sort_order),
	authenticity:listing_authenticity_reviews(status,public_note)
` as const;

function actorDto(profile: ProfileRelation): ActorSummaryDto {
	return {
		id: profile.id,
		username: profile.username,
		avatarUrl: profile.avatar_path,
		accountKind: profile.account_kind,
		merchantVerified: profile.is_merchant_verified
	};
}

function removedSeller(sellerId: string): ProfileRelation {
	return {
		id: sellerId,
		username: 'Премахнат потребител',
		avatar_path: null,
		account_kind: 'private',
		is_merchant_verified: false
	};
}

function money(amountMinor: number | null): { amountMinor: number; currency: 'EUR' } | null {
	return amountMinor === null ? null : { amountMinor, currency: 'EUR' };
}

function photoDtos(
	photos: readonly PhotoRelation[] | null,
	imageUrls: ReadonlyMap<string, string>
): readonly ListingPhotoDto[] {
	return [...(photos ?? [])]
		.sort((left, right) => left.sort_order - right.sort_order)
		.flatMap((photo) => {
			const imageUrl = imageUrls.get(photo.storage_path);
			return imageUrl
				? [{ id: photo.id, imageUrl, role: photo.role, sortOrder: photo.sort_order }]
				: [];
		});
}

export function toListingCardDto(
	row: ListingJoinedRow,
	imageUrls: ReadonlyMap<string, string> = new Map()
): ListingCardDto {
	const brand = oneRelation(row.brand);
	const seller = oneRelation(row.seller) ?? removedSeller(row.seller_id);
	if (!brand) throw new Error(`Listing ${row.id} has an incomplete public projection.`);
	const photos = photoDtos(row.photos, imageUrls);
	const authenticity = oneRelation(row.authenticity);
	return {
		id: row.id,
		slug: row.slug,
		kind: row.kind,
		dealMode: row.deal_mode,
		title: row.title,
		brandId: brand.id,
		brandName: brand.canonical_name,
		brandSlug: brand.slug,
		fragranceName: row.fragrance_name,
		concentration: row.concentration,
		city: row.city,
		price: money(row.price_minor),
		maxBudget: money(row.max_budget_minor),
		bottleVolumeMl: row.bottle_volume_ml,
		remainingMl: row.remaining_ml,
		isSealed: row.is_sealed,
		status: row.status,
		seller: actorDto(seller),
		primaryPhoto: photos[0] ?? null,
		authenticityReviewed: authenticity?.status === 'evidence_reviewed',
		createdAt: row.created_at
	};
}

export function toListingDetailDto(
	row: ListingJoinedRow,
	imageUrls: ReadonlyMap<string, string> = new Map()
): ListingDetailDto {
	const photos = photoDtos(row.photos, imageUrls);
	const authenticity = oneRelation(row.authenticity);
	return {
		...toListingCardDto(row, imageUrls),
		productFormat: row.product_format,
		audience: row.audience,
		segments: row.segments,
		fragranceId: row.fragrance_id,
		concentrationLabel: row.concentration_label,
		description: row.description,
		estimatedValue: money(row.estimated_value_minor),
		referenceUrl: row.fragrantica_url,
		photos,
		authenticityNote: authenticity?.public_note ?? null,
		activatedAt: row.activated_at,
		expiresAt: row.expires_at,
		updatedAt: row.updated_at
	};
}

async function attachPublicSellers(
	client: MarketplaceSupabaseClient,
	rows: readonly ListingJoinedRow[]
): Promise<readonly ListingJoinedRow[]> {
	const missingSellerIds = [
		...new Set(rows.filter((row) => !oneRelation(row.seller)).map((row) => row.seller_id))
	];
	if (missingSellerIds.length === 0) return rows;
	const { data, error } = await client
		.from('public_profiles')
		.select('id,username,avatar_path,account_kind,is_merchant_verified')
		.in('id', missingSellerIds);
	throwIfError('listings.publicSellers', error);
	const sellers = new Map(
		((data ?? []) as unknown as ProfileRelation[]).map((seller) => [seller.id, seller])
	);
	return rows.map((row) => ({
		...row,
		seller: oneRelation(row.seller) ?? sellers.get(row.seller_id) ?? removedSeller(row.seller_id)
	}));
}

export async function hydrateListingCards(
	client: MarketplaceSupabaseClient,
	rows: readonly ListingJoinedRow[]
): Promise<readonly ListingCardDto[]> {
	const hydratedRows = await attachPublicSellers(client, rows);
	const urls = await signedListingImageUrls(
		client,
		hydratedRows.flatMap((row) => (row.photos ?? []).map((photo) => photo.storage_path))
	);
	return hydratedRows.map((row) => toListingCardDto(row, urls));
}

export async function hydrateListingDetails(
	client: MarketplaceSupabaseClient,
	rows: readonly ListingJoinedRow[]
): Promise<readonly ListingDetailDto[]> {
	const hydratedRows = await attachPublicSellers(client, rows);
	const urls = await signedListingImageUrls(
		client,
		hydratedRows.flatMap((row) => (row.photos ?? []).map((photo) => photo.storage_path))
	);
	return hydratedRows.map((row) => toListingDetailDto(row, urls));
}

export async function searchListings(
	client: MarketplaceSupabaseClient,
	input: ListingSearchInput
): Promise<ListingPageDto> {
	const needsPostFilter = Boolean(input.kind || input.productFormat || input.brandId || input.fragranceId);
	const rpcPageSize = needsPostFilter ? 60 : Math.min(60, input.limit + 1);
	const { data: searchRows, error: searchError } = await client.rpc('search_listings', {
		search_query: input.query || null,
		filter_audience: input.audience ?? null,
		filter_segments: input.segments.length ? [...input.segments] : null,
		filter_deal_mode: input.dealMode ?? null,
		filter_city: input.city ?? null,
		min_price_minor: input.minPriceMinor ?? null,
		max_price_minor: input.maxPriceMinor ?? null,
		page_size: rpcPageSize,
		cursor_activated_at: input.cursorActivatedAt ?? null,
		cursor_id: input.cursorId ?? null
	});
	throwIfError('listings.searchRpc', searchError);
	const candidates = searchRows ?? [];
	if (candidates.length === 0) {
		return {
			items: [],
			total: input.offset,
			limit: input.limit,
			offset: input.offset,
			hasMore: false,
			nextCursor: null,
			totalIsExact: input.offset === 0
		};
	}

	let detailsQuery = client
		.from('listings')
		.select(LISTING_PROJECTION)
		.in('id', candidates.map((row) => row.listing_id));
	if (input.kind) detailsQuery = detailsQuery.eq('kind', input.kind);
	if (input.productFormat) detailsQuery = detailsQuery.eq('product_format', input.productFormat);
	if (input.brandId) detailsQuery = detailsQuery.eq('brand_id', input.brandId);
	if (input.fragranceId) detailsQuery = detailsQuery.eq('fragrance_id', input.fragranceId);
	const { data: listingRows, error: listingError } = await detailsQuery;
	throwIfError('listings.searchHydrate', listingError);
	const hydrated = await hydrateListingCards(
		client,
		(listingRows ?? []) as unknown as ListingJoinedRow[]
	);
	const byId = new Map(hydrated.map((listing) => [listing.id, listing]));
	let ordered = candidates.flatMap((candidate) => {
		const listing = byId.get(candidate.listing_id);
		return listing ? [listing] : [];
	});
	if (input.sort === 'price_asc' || input.sort === 'price_desc') {
		ordered = [...ordered].sort((left, right) => {
			const leftPrice = left.price?.amountMinor ?? left.maxBudget?.amountMinor ?? Number.POSITIVE_INFINITY;
			const rightPrice = right.price?.amountMinor ?? right.maxBudget?.amountMinor ?? Number.POSITIVE_INFINITY;
			return input.sort === 'price_asc' ? leftPrice - rightPrice : rightPrice - leftPrice;
		});
	}
	const items = ordered.slice(0, input.limit);
	const lastVisibleId = input.sort === 'newest' ? items.at(-1)?.id : null;
	const lastVisibleIndex = lastVisibleId
		? candidates.findIndex((candidate) => candidate.listing_id === lastVisibleId)
		: -1;
	const exhaustedCandidateWindow = candidates.length < rpcPageSize;
	const hasMore = input.sort === 'newest'
		? lastVisibleIndex >= 0
			? lastVisibleIndex < candidates.length - 1 || !exhaustedCandidateWindow
			: !exhaustedCandidateWindow
		: !exhaustedCandidateWindow || ordered.length > input.limit;
	const cursorRow = hasMore
		? input.sort === 'newest' && lastVisibleIndex >= 0
			? candidates[lastVisibleIndex]
			: candidates.at(-1)
		: null;
	return {
		items,
		total: input.offset + items.length + (hasMore ? 1 : 0),
		limit: input.limit,
		offset: input.offset,
		hasMore,
		nextCursor: cursorRow?.activated_at
			? { activatedAt: cursorRow.activated_at, id: cursorRow.listing_id }
			: null,
		totalIsExact: !hasMore && input.offset === 0
	};
}

export async function listOwnListings(
	client: MarketplaceSupabaseClient,
	profileId: string,
	limit = 50,
	offset = 0
): Promise<ListingPageDto> {
	const { data, error, count } = await client
		.from('listings')
		.select(LISTING_PROJECTION, { count: 'exact' })
		.eq('seller_id', profileId)
		.order('created_at', { ascending: false })
		.range(offset, offset + limit - 1);
	throwIfError('listings.listOwn', error);
	const items = await hydrateListingCards(client, (data ?? []) as unknown as ListingJoinedRow[]);
	return { ...pageDto(items, count, limit, offset), nextCursor: null, totalIsExact: true };
}

export async function findListingById(
	client: MarketplaceSupabaseClient,
	listingId: string
): Promise<ListingDetailDto | null> {
	const { data, error } = await client
		.from('listings')
		.select(LISTING_PROJECTION)
		.eq('id', listingId)
		.maybeSingle();
	throwIfError('listings.findById', error);
	if (!data) return null;
	return (await hydrateListingDetails(client, [data as unknown as ListingJoinedRow]))[0] ?? null;
}

export async function findListingBySlug(
	client: MarketplaceSupabaseClient,
	slug: string
): Promise<ListingDetailDto | null> {
	const { data, error } = await client
		.from('listings')
		.select(LISTING_PROJECTION)
		.eq('slug', slug)
		.maybeSingle();
	throwIfError('listings.findBySlug', error);
	if (!data) return null;
	return (await hydrateListingDetails(client, [data as unknown as ListingJoinedRow]))[0] ?? null;
}

function listingInsert(profileId: string, input: ListingDraftInput): TablesInsert<'listings'> {
	return {
		seller_id: profileId,
		kind: input.kind,
		deal_mode: input.dealMode,
		product_format: input.productFormat ?? null,
		audience: input.audience,
		segments: input.segments,
		brand_id: input.brandId,
		fragrance_id: input.fragranceId ?? null,
		fragrance_name: input.fragranceName,
		concentration: input.concentration,
		concentration_label: input.concentrationLabel ?? null,
		fragrantica_url: input.referenceUrl ?? null,
		title: input.title,
		description: input.description,
		city: input.city,
		bottle_volume_ml: input.bottleVolumeMl ?? null,
		remaining_ml: input.remainingMl ?? null,
		is_sealed: input.isSealed,
		price_minor: input.priceMinor ?? null,
		estimated_value_minor: input.estimatedValueMinor ?? null,
		max_budget_minor: input.maxBudgetMinor ?? null,
		status: 'draft'
	};
}

export async function createListingDraft(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: ListingDraftInput
): Promise<ListingDetailDto> {
	const { data, error } = await client
		.from('listings')
		.insert(listingInsert(profileId, input))
		.select(LISTING_PROJECTION)
		.single();
	throwIfError('listings.createDraft', error);
	const row = requireData('listings.createDraft', data) as unknown as ListingJoinedRow;
	return (await hydrateListingDetails(client, [row]))[0]!;
}

export async function updateListingDraft(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: UpdateListingDraftInput
): Promise<ListingDetailDto> {
	const patch = listingInsert(profileId, input.patch);
	delete (patch as Partial<TablesInsert<'listings'>>).seller_id;
	delete (patch as Partial<TablesInsert<'listings'>>).status;
	const { data, error } = await client
		.from('listings')
		.update(patch)
		.eq('id', input.listingId)
		.eq('seller_id', profileId)
		.in('status', ['draft', 'paused'])
		.select(LISTING_PROJECTION)
		.single();
	throwIfError('listings.updateDraft', error);
	const row = requireData('listings.updateDraft', data) as unknown as ListingJoinedRow;
	return (await hydrateListingDetails(client, [row]))[0]!;
}

export async function publishListing(
	client: MarketplaceSupabaseClient,
	profileId: string,
	listingId: string
): Promise<ListingDetailDto> {
	const { error } = await client.rpc('publish_listing', { target_listing_id: listingId });
	throwIfError('listings.publish', error);
	const listing = requireData('listings.publish.read', await findListingById(client, listingId));
	if (listing.seller.id !== profileId) {
		throw new RepositoryError('listings.publish.read', '42501', 'Published listing owner mismatch.');
	}
	return listing;
}

export async function deleteListingDraft(
	client: MarketplaceSupabaseClient,
	profileId: string,
	listingId: string
): Promise<void> {
	const { data, error } = await client
		.from('listings')
		.delete()
		.eq('id', listingId)
		.eq('seller_id', profileId)
		.eq('status', 'draft')
		.select('id')
		.maybeSingle();
	throwIfError('listings.deleteDraft', error);
	requireData('listings.deleteDraft', data);
}

export async function pauseListing(
	client: MarketplaceSupabaseClient,
	profileId: string,
	listingId: string
): Promise<ListingDetailDto> {
	const { data, error } = await client
		.from('listings')
		.update({ status: 'paused' })
		.eq('id', listingId)
		.eq('seller_id', profileId)
		.eq('status', 'active')
		.select(LISTING_PROJECTION)
		.single();
	throwIfError('listings.pause', error);
	const row = requireData('listings.pause', data) as unknown as ListingJoinedRow;
	return (await hydrateListingDetails(client, [row]))[0]!;
}

export async function createListingUpload(
	client: MarketplaceSupabaseClient,
	input: CreateListingUploadInput
): Promise<ListingUploadIntentDto> {
	const { data, error } = await client.rpc('create_listing_upload', {
		target_listing_id: input.listingId,
		requested_role: input.role,
		declared_mime_type: input.mimeType,
		declared_byte_size: input.byteSize
	});
	throwIfError('listings.createUpload', error);
	const intent = requireData('listings.createUpload', data?.[0] ?? null);
	return {
		uploadId: intent.upload_id,
		bucketId: 'listing-image-quarantine',
		storagePath: intent.storage_path,
		expiresAt: intent.expires_at
	};
}

export async function listListingUploads(
	client: MarketplaceSupabaseClient,
	profileId: string,
	listingId: string
): Promise<readonly ListingUploadDto[]> {
	const { data, error } = await client
		.from('upload_quarantine')
		.select('id,uploader_id,listing_id,requested_role,status,rejection_code,expires_at,finalized_at,created_at')
		.eq('uploader_id', profileId)
		.eq('listing_id', listingId)
		.order('created_at', { ascending: false });
	throwIfError('listings.listUploads', error);
	return (data ?? []).map((row) => ({
		id: row.id,
		listingId: row.listing_id,
		role: row.requested_role,
		status: row.status,
		rejectionCode: row.rejection_code,
		expiresAt: row.expires_at,
		finalizedAt: row.finalized_at,
		createdAt: row.created_at
	}));
}

export async function cancelListingUpload(
	client: MarketplaceSupabaseClient,
	uploadId: string
): Promise<void> {
	const { error } = await client.rpc('cancel_listing_upload', { target_upload_id: uploadId });
	throwIfError('listings.cancelUpload', error);
}
