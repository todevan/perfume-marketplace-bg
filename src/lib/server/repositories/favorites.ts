import type { FavoriteDto, FavoritePageDto } from '../../contracts';
import type { Tables } from '../database.types';
import {
	hydrateListingCards,
	LISTING_PROJECTION,
	type ListingJoinedRow
} from './listings';
import { pageDto, requireData, throwIfError, type MarketplaceSupabaseClient } from './shared';

export async function listFavorites(
	client: MarketplaceSupabaseClient,
	profileId: string,
	limit: number,
	offset: number
): Promise<FavoritePageDto> {
	const { data, error, count } = await client
		.from('favorites')
		.select('listing_id,created_at', { count: 'exact' })
		.eq('profile_id', profileId)
		.order('created_at', { ascending: false })
		.range(offset, offset + limit - 1);
	throwIfError('favorites.list', error);
	const favoriteRows = (data ?? []) as Pick<Tables<'favorites'>, 'listing_id' | 'created_at'>[];
	if (favoriteRows.length === 0) return pageDto([], count, limit, offset);

	const { data: listings, error: listingsError } = await client
		.from('listings')
		.select(LISTING_PROJECTION)
		.in('id', favoriteRows.map((row) => row.listing_id));
	throwIfError('favorites.listings', listingsError);
	const listingDtos = await hydrateListingCards(
		client,
		(listings ?? []) as unknown as ListingJoinedRow[]
	);
	const byId = new Map(listingDtos.map((listing) => [listing.id, listing]));
	const items: FavoriteDto[] = favoriteRows.flatMap((favorite) => {
		const listing = byId.get(favorite.listing_id);
		return listing ? [{ listing, createdAt: favorite.created_at }] : [];
	});
	return pageDto(items, count, limit, offset);
}

export async function isFavorite(
	client: MarketplaceSupabaseClient,
	profileId: string,
	listingId: string
): Promise<boolean> {
	const { data, error } = await client
		.from('favorites')
		.select('listing_id')
		.eq('profile_id', profileId)
		.eq('listing_id', listingId)
		.maybeSingle();
	throwIfError('favorites.isFavorite', error);
	return data !== null;
}

export async function addFavorite(
	client: MarketplaceSupabaseClient,
	profileId: string,
	listingId: string
): Promise<void> {
	const { data: listing, error: listingError } = await client
		.from('listings')
		.select('id')
		.eq('id', listingId)
		.eq('status', 'active')
		.maybeSingle();
	throwIfError('favorites.findListing', listingError);
	requireData('favorites.findListing', listing);
	const { error } = await client
		.from('favorites')
		.upsert({ profile_id: profileId, listing_id: listingId }, { onConflict: 'profile_id,listing_id' });
	throwIfError('favorites.add', error);
}

export async function removeFavorite(
	client: MarketplaceSupabaseClient,
	profileId: string,
	listingId: string
): Promise<void> {
	const { error } = await client
		.from('favorites')
		.delete()
		.eq('profile_id', profileId)
		.eq('listing_id', listingId);
	throwIfError('favorites.remove', error);
}
