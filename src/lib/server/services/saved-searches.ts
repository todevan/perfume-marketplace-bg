import {
	savedSearchIdInputSchema,
	savedSearchListInputSchema,
	saveSearchInputSchema,
	updateSavedSearchInputSchema,
	type ActionResult,
	type SavedSearchDto,
	type SavedSearchPageDto
} from '../../contracts';
import {
	createSavedSearch,
	deleteSavedSearch,
	listSavedSearches,
	updateSavedSearch,
	type MarketplaceSupabaseClient
} from '../repositories';
import { runAuthenticatedAction } from './action';

export function getSavedSearches(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<SavedSearchPageDto>> {
	return runAuthenticatedAction(client, savedSearchListInputSchema, rawInput, (profileId, input) =>
		listSavedSearches(client, profileId, input)
	);
}

export function saveSearch(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<SavedSearchDto>> {
	return runAuthenticatedAction(client, saveSearchInputSchema, rawInput, (profileId, input) =>
		createSavedSearch(client, profileId, input)
	);
}

export function editSavedSearch(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<SavedSearchDto>> {
	return runAuthenticatedAction(
		client,
		updateSavedSearchInputSchema,
		rawInput,
		(profileId, input) => updateSavedSearch(client, profileId, input)
	);
}

export function removeSavedSearch(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<void>> {
	return runAuthenticatedAction(
		client,
		savedSearchIdInputSchema,
		rawInput,
		(profileId, { savedSearchId }) => deleteSavedSearch(client, profileId, savedSearchId)
	);
}

