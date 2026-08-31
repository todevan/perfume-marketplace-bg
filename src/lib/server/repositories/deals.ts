import type {
	ActorSummaryDto,
	CancelDealInput,
	DealDisputeDto,
	DealDto,
	DealListInput,
	DealPageDto,
	OpenDealDisputeInput
} from '../../contracts';
import type { Tables, Views } from '../database.types';
import {
	hydrateListingCards,
	LISTING_PROJECTION,
	type ListingJoinedRow
} from './listings';
import { toActorSummaryDto } from './profiles';
import { pageDto, throwIfError, type MarketplaceSupabaseClient } from './shared';

type DealRow = Tables<'deals'>;
type ProfileRow = Views<'public_profiles'>;

function actor(row: ProfileRow): ActorSummaryDto {
	return toActorSummaryDto(row, 'deals.actor');
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

async function hydrateDeals(
	client: MarketplaceSupabaseClient,
	rows: readonly DealRow[]
): Promise<readonly DealDto[]> {
	if (rows.length === 0) return [];
	const listingIds = [
		...new Set(rows.flatMap((row) => [row.listing_id, row.offered_listing_id].filter(Boolean) as string[]))
	];
	const profileIds = [...new Set(rows.flatMap((row) => [row.party_a_id, row.party_b_id]))];
	const acceptedOfferIds = rows.map((row) => row.accepted_offer_id);
	const [listingsResult, profilesResult, conversationsResult] = await Promise.all([
		client.from('listings').select(LISTING_PROJECTION).in('id', listingIds),
		client
			.from('public_profiles')
			.select('id,username,avatar_path,account_kind,is_merchant_verified')
			.in('id', profileIds),
		client
			.from('conversations')
			.select('id,accepted_offer_id')
			.in('accepted_offer_id', acceptedOfferIds)
	]);
	throwIfError('deals.listings', listingsResult.error);
	throwIfError('deals.profiles', profilesResult.error);
	throwIfError('deals.conversations', conversationsResult.error);

	const listings = await hydrateListingCards(
		client,
		(listingsResult.data ?? []) as unknown as ListingJoinedRow[]
	);
	const listingById = new Map(listings.map((listing) => [listing.id, listing]));
	const profileById = new Map(
		((profilesResult.data ?? []) as unknown as ProfileRow[]).map((profile) => {
			const summary = actor(profile);
			return [summary.id, summary] as const;
		})
	);
	const conversationByOffer = new Map(
		(conversationsResult.data ?? []).map((conversation) => [
			conversation.accepted_offer_id,
			conversation.id
		])
	);

	return rows.flatMap((row) => {
		const listing = listingById.get(row.listing_id);
		const partyA = profileById.get(row.party_a_id) ?? removedActor(row.party_a_id);
		const partyB = profileById.get(row.party_b_id) ?? removedActor(row.party_b_id);
		const conversationId = conversationByOffer.get(row.accepted_offer_id);
		if (!listing || !conversationId) return [];
		return [{
			id: row.id,
			listing,
			offeredListing: row.offered_listing_id ? listingById.get(row.offered_listing_id) ?? null : null,
			partyA,
			partyB,
			conversationId,
			status: row.status,
			completedAt: row.completed_at,
			disputedAt: row.disputed_at,
			cancelledAt: row.cancelled_at,
			cancellationReason: row.cancellation_reason,
			createdAt: row.created_at
		}];
	});
}

export async function listDeals(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: DealListInput
): Promise<DealPageDto> {
	let query = client
		.from('deals')
		.select('*', { count: 'exact' })
		.or(`party_a_id.eq.${profileId},party_b_id.eq.${profileId}`)
		.order('created_at', { ascending: false })
		.range(input.offset, input.offset + input.limit - 1);
	if (input.status) query = query.eq('status', input.status);
	const { data, error, count } = await query;
	throwIfError('deals.list', error);
	const items = await hydrateDeals(client, (data ?? []) as DealRow[]);
	return pageDto(items, count, input.limit, input.offset);
}

export async function findDealById(
	client: MarketplaceSupabaseClient,
	dealId: string
): Promise<DealDto | null> {
	const { data, error } = await client.from('deals').select('*').eq('id', dealId).maybeSingle();
	throwIfError('deals.findById', error);
	return data ? (await hydrateDeals(client, [data as DealRow]))[0] ?? null : null;
}

export async function completeDeal(
	client: MarketplaceSupabaseClient,
	dealId: string
): Promise<void> {
	const { error } = await client.rpc('complete_deal', { target_deal_id: dealId });
	throwIfError('deals.complete', error);
}

export async function cancelDeal(
	client: MarketplaceSupabaseClient,
	input: CancelDealInput
): Promise<void> {
	const { error } = await client.rpc('cancel_deal', {
		target_deal_id: input.dealId,
		reason: input.reason
	});
	throwIfError('deals.cancel', error);
}

export async function openDealDispute(
	client: MarketplaceSupabaseClient,
	input: OpenDealDisputeInput
): Promise<DealDisputeDto> {
	const { data, error } = await client.rpc('open_deal_dispute', {
		target_deal_id: input.dealId,
		details: input.details
	});
	throwIfError('deals.openDispute', error);
	const row = data?.[0];
	if (!row) throw new Error('Deal dispute RPC returned no result.');
	return { dealId: row.deal_id, reportId: row.report_id };
}
