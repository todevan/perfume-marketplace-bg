import type { ActorSummaryDto, CreateOfferInput, OfferDto, OfferListInput, OfferPageDto } from '../../contracts';
import type { Tables, Views } from '../database.types';
import {
	hydrateListingCards,
	LISTING_PROJECTION,
	type ListingJoinedRow
} from './listings';
import { toActorSummaryDto } from './profiles';
import { pageDto, requireData, throwIfError, type MarketplaceSupabaseClient } from './shared';

type OfferRow = Tables<'offers'>;
type ProfileRow = Views<'public_profiles'>;

function actor(row: ProfileRow): ActorSummaryDto {
	return toActorSummaryDto(row, 'offers.actor');
}

function removedActor(profileId: string): ActorSummaryDto {
	return {
		id: profileId,
		username: 'Премахнат потребител',
		avatarUrl: null,
		accountKind: 'private',
		merchantVerified: false
	};
}

async function hydrateOffers(
	client: MarketplaceSupabaseClient,
	rows: readonly OfferRow[]
): Promise<readonly OfferDto[]> {
	if (rows.length === 0) return [];
	const listingIds = [
		...new Set(rows.flatMap((row) => [row.listing_id, row.offered_listing_id].filter(Boolean) as string[]))
	];
	const profileIds = [...new Set(rows.map((row) => row.offerer_id))];
	const [listingResult, profileResult] = await Promise.all([
		client.from('listings').select(LISTING_PROJECTION).in('id', listingIds),
		client
			.from('public_profiles')
			.select('id,username,avatar_path,account_kind,is_merchant_verified')
			.in('id', profileIds)
	]);
	throwIfError('offers.listings', listingResult.error);
	throwIfError('offers.profiles', profileResult.error);
	const listings = await hydrateListingCards(
		client,
		(listingResult.data ?? []) as unknown as ListingJoinedRow[]
	);
	const listingById = new Map(listings.map((listing) => [listing.id, listing]));
	const profileById = new Map(
		((profileResult.data ?? []) as unknown as ProfileRow[]).map((profile) => {
			const summary = actor(profile);
			return [summary.id, summary] as const;
		})
	);

	return rows.flatMap((row) => {
		const listing = listingById.get(row.listing_id);
		const offerer = profileById.get(row.offerer_id) ?? removedActor(row.offerer_id);
		if (!listing) return [];
		return [
			{
				id: row.id,
				listing,
				offerer,
				kind: row.kind,
				cash: row.cash_amount_minor === null
					? null
					: { amountMinor: row.cash_amount_minor, currency: 'EUR' as const },
				offeredListing: row.offered_listing_id
					? listingById.get(row.offered_listing_id) ?? null
					: null,
				message: row.message,
				status: row.status,
				expiresAt: row.expires_at,
				respondedAt: row.responded_at,
				createdAt: row.created_at
			}
		];
	});
}

export async function listOffers(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: OfferListInput
): Promise<OfferPageDto> {
	if (input.direction === 'received') {
		const { data, error } = await client.rpc('list_received_offers', {
			page_size: Math.min(51, input.limit + 1),
			page_offset: input.offset,
			...(input.status ? { filter_status: input.status } : {})
		});
		throwIfError('offers.listReceived', error);
		const rows = (data ?? []) as OfferRow[];
		const hasMore = rows.length > input.limit;
		const items = await hydrateOffers(client, rows.slice(0, input.limit));
		return {
			items,
			total: input.offset + items.length + (hasMore ? 1 : 0),
			limit: input.limit,
			offset: input.offset,
			hasMore
		};
	}

	let query = client
		.from('offers')
		.select('*', { count: 'exact' })
		.order('created_at', { ascending: false })
		.range(input.offset, input.offset + input.limit - 1);

	query = query.eq('offerer_id', profileId);
	if (input.status) query = query.eq('status', input.status);

	const { data, error, count } = await query;
	throwIfError('offers.list', error);
	const items = await hydrateOffers(client, (data ?? []) as OfferRow[]);
	return pageDto(items, count, input.limit, input.offset);
}

export async function findOfferById(
	client: MarketplaceSupabaseClient,
	offerId: string
): Promise<OfferDto | null> {
	const { data, error } = await client.from('offers').select('*').eq('id', offerId).maybeSingle();
	throwIfError('offers.findById', error);
	if (!data) return null;
	return (await hydrateOffers(client, [data as OfferRow]))[0] ?? null;
}

export async function createOffer(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: CreateOfferInput
): Promise<OfferDto> {
	const { data, error } = await client
		.from('offers')
		.insert({
			listing_id: input.listingId,
			offerer_id: profileId,
			kind: input.kind,
			cash_amount_minor: input.cashAmountMinor ?? null,
			offered_listing_id: input.offeredListingId ?? null,
			message: input.message ?? null,
			expires_at: input.expiresAt ?? null,
			status: 'pending'
		})
		.select('*')
		.single();
	throwIfError('offers.create', error);
	const item = (await hydrateOffers(client, [requireData('offers.create', data) as OfferRow]))[0];
	return requireData('offers.create.hydrate', item ?? null);
}

export async function withdrawOffer(
	client: MarketplaceSupabaseClient,
	profileId: string,
	offerId: string
): Promise<void> {
	const { data, error } = await client
		.from('offers')
		.update({ status: 'withdrawn' })
		.eq('id', offerId)
		.eq('offerer_id', profileId)
		.eq('status', 'pending')
		.select('id')
		.maybeSingle();
	throwIfError('offers.withdraw', error);
	requireData('offers.withdraw', data);
}

export async function acceptOffer(
	client: MarketplaceSupabaseClient,
	offerId: string
): Promise<string> {
	const { data, error } = await client.rpc('accept_offer', { target_offer_id: offerId });
	throwIfError('offers.accept', error);
	return requireData('offers.accept', data);
}

export async function declineOffer(
	client: MarketplaceSupabaseClient,
	offerId: string
): Promise<void> {
	const { error } = await client.rpc('decline_offer', { target_offer_id: offerId });
	throwIfError('offers.decline', error);
}
