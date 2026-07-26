import {
	favoriteInputSchema,
	favoriteListInputSchema,
	type ActionResult,
	type FavoritePageDto
} from '../../contracts';
import {
	addFavorite,
	isFavorite,
	listFavorites as repoListFavorites,
	removeFavorite,
	type MarketplaceSupabaseClient
} from '../repositories';
import { runAuthenticatedAction } from './action';

export function getFavorites(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<FavoritePageDto>> {
	return runAuthenticatedAction(client, favoriteListInputSchema, rawInput, (profileId, input) =>
		repoListFavorites(client, profileId, input.limit, input.offset)
	);
}

export function getFavoriteState(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<boolean>> {
	return runAuthenticatedAction(client, favoriteInputSchema, rawInput, (profileId, input) =>
		isFavorite(client, profileId, input.listingId)
	);
}

export function favoriteListing(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<void>> {
	return runAuthenticatedAction(client, favoriteInputSchema, rawInput, (profileId, input) =>
		addFavorite(client, profileId, input.listingId)
	);
}

export function unfavoriteListing(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<void>> {
	return runAuthenticatedAction(client, favoriteInputSchema, rawInput, (profileId, input) =>
		removeFavorite(client, profileId, input.listingId)
	);
}

