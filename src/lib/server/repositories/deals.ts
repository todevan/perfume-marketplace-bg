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
import { pageDto, throwIfError, type MarketplaceSupabaseClient } from './shared';

type DealRow = Tables<'deals'>;
type ProfileRow = Views<'public_profiles'>;
type ConfirmationRow = Tables<'deal_confirmations'>;

function actor(row: ProfileRow): ActorSummaryDto {
	return {
		id: row.id,
		username: row.username,
		avatarUrl: row.avatar_path,
		accountKind: row.account_kind,
		merchantVerified: row.is_merchant_verified
	};
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
	const dealIds = rows.map((row) => row.id);
	const [listingsResult, profilesResult, confirmationsResult] = await Promise.all([
		client.from('listings').select(LISTING_PROJECTION).in('id', listingIds),
		client
			.from('public_profiles')
			.select('id,username,avatar_path,account_kind,is_merchant_verified')
			.in('id', profileIds),
		client.from('deal_confirmations').select('*').in('deal_id', dealIds)
	]);
	throwIfError('deals.listings', listingsResult.error);
	throwIfError('deals.profiles', profilesResult.error);
	throwIfError('deals.confirmations', confirmationsResult.error);

	const listings = await hydrateListingCards(
		client,
		(listingsResult.data ?? []) as unknown as ListingJoinedRow[]
	);
	const listingById = new Map(listings.map((listing) => [listing.id, listing]));
	const profileById = new Map(
		((profilesResult.data ?? []) as unknown as ProfileRow[]).map((profile) => [profile.id, actor(profile)])
	);
	const confirmations = (confirmationsResult.data ?? []) as ConfirmationRow[];

	return rows.flatMap((row) => {
		const listing = listingById.get(row.listing_id);
		const partyA = profileById.get(row.party_a_id) ?? removedActor(row.party_a_id);
		const partyB = profileById.get(row.party_b_id) ?? removedActor(row.party_b_id);
		if (!listing) return [];
		return [{
			id: row.id,
			listing,
			offeredListing: row.offered_listing_id ? listingById.get(row.offered_listing_id) ?? null : null,
			partyA,
			partyB,
			status: row.status,
			confirmedBy: confirmations
				.filter((confirmation) => confirmation.deal_id === row.id)
				.map((confirmation) => confirmation.profile_id),
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

export async function confirmDeal(
	client: MarketplaceSupabaseClient,
	_profileId: string,
	dealId: string
): Promise<void> {
	const { error } = await client.rpc('confirm_deal', { target_deal_id: dealId });
	throwIfError('deals.confirm', error);
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
