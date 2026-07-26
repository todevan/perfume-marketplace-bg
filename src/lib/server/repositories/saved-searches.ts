import {
	listingSearchInputSchema,
	type SavedSearchDto,
	type SavedSearchListInput,
	type SavedSearchPageDto,
	type SaveSearchInput,
	type UpdateSavedSearchInput
} from '../../contracts';
import type { Json, Tables } from '../database.types';
import { pageDto, requireData, throwIfError, type MarketplaceSupabaseClient } from './shared';

type SavedSearchRow = Tables<'saved_searches'>;

export function toSavedSearchDto(row: SavedSearchRow): SavedSearchDto {
	const filters = listingSearchInputSchema.safeParse(row.filters);
	return {
		id: row.id,
		name: row.name,
		filters: filters.success ? filters.data : listingSearchInputSchema.parse({}),
		notificationsEnabled: row.notifications_enabled,
		lastNotifiedAt: row.last_notified_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export async function listSavedSearches(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: SavedSearchListInput
): Promise<SavedSearchPageDto> {
	const { data, error, count } = await client
		.from('saved_searches')
		.select('*', { count: 'exact' })
		.eq('profile_id', profileId)
		.order('created_at', { ascending: false })
		.range(input.offset, input.offset + input.limit - 1);
	throwIfError('savedSearches.list', error);
	return pageDto(
		(data ?? []).map((row) => toSavedSearchDto(row as SavedSearchRow)),
		count,
		input.limit,
		input.offset
	);
}

export async function createSavedSearch(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: SaveSearchInput
): Promise<SavedSearchDto> {
	const { data, error } = await client
		.from('saved_searches')
		.insert({
			profile_id: profileId,
			name: input.name,
			filters: input.filters as unknown as Json,
			notifications_enabled: input.notificationsEnabled
		})
		.select('*')
		.single();
	throwIfError('savedSearches.create', error);
	return toSavedSearchDto(requireData('savedSearches.create', data) as SavedSearchRow);
}

export async function updateSavedSearch(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: UpdateSavedSearchInput
): Promise<SavedSearchDto> {
	const { data, error } = await client
		.from('saved_searches')
		.update({
			name: input.name,
			filters: input.filters as unknown as Json,
			notifications_enabled: input.notificationsEnabled
		})
		.eq('id', input.savedSearchId)
		.eq('profile_id', profileId)
		.select('*')
		.single();
	throwIfError('savedSearches.update', error);
	return toSavedSearchDto(requireData('savedSearches.update', data) as SavedSearchRow);
}

export async function deleteSavedSearch(
	client: MarketplaceSupabaseClient,
	profileId: string,
	savedSearchId: string
): Promise<void> {
	const { error } = await client
		.from('saved_searches')
		.delete()
		.eq('id', savedSearchId)
		.eq('profile_id', profileId);
	throwIfError('savedSearches.delete', error);
}

