import type { PublicProfileDto, UpdateProfileInput } from '../../contracts';
import type { Views } from '../database.types';
import {
	requireData,
	throwIfError,
	type MarketplaceSupabaseClient
} from './shared';

const PUBLIC_PROFILE_COLUMNS =
	'id,username,city,bio,avatar_path,account_kind,is_merchant_verified,rating_average,rating_count,completed_deals_count,member_since' as const;

export function toPublicProfileDto(row: Views<'public_profiles'>): PublicProfileDto {
	return {
		id: row.id,
		username: row.username,
		city: row.city,
		bio: row.bio,
		avatarUrl: row.avatar_path,
		accountKind: row.account_kind,
		merchantVerified: row.is_merchant_verified,
		ratingAverage: Number(row.rating_average),
		ratingCount: row.rating_count,
		completedDealsCount: row.completed_deals_count,
		memberSince: row.member_since
	};
}

export async function findPublicProfileByUsername(
	client: MarketplaceSupabaseClient,
	username: string
): Promise<PublicProfileDto | null> {
	const { data, error } = await client
		.from('public_profiles')
		.select(PUBLIC_PROFILE_COLUMNS)
		.eq('username', username)
		.maybeSingle();
	throwIfError('profiles.findByUsername', error);
	return data ? toPublicProfileDto(data as Views<'public_profiles'>) : null;
}

export async function findPublicProfileById(
	client: MarketplaceSupabaseClient,
	profileId: string
): Promise<PublicProfileDto | null> {
	const { data, error } = await client
		.from('public_profiles')
		.select(PUBLIC_PROFILE_COLUMNS)
		.eq('id', profileId)
		.maybeSingle();
	throwIfError('profiles.findById', error);
	return data ? toPublicProfileDto(data as Views<'public_profiles'>) : null;
}

export async function updateOwnPublicProfile(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: UpdateProfileInput
): Promise<PublicProfileDto> {
	const patch = {
		username: input.username,
		...(input.city !== undefined ? { city: input.city } : {}),
		...(input.bio !== undefined ? { bio: input.bio } : {}),
		...(input.avatarUrl !== undefined ? { avatar_path: input.avatarUrl } : {})
	};
	const { error } = await client
		.from('profiles')
		.update(patch)
		.eq('id', profileId);
	throwIfError('profiles.updateOwn', error);
	return requireData('profiles.updateOwn', await findPublicProfileById(client, profileId));
}

export { PUBLIC_PROFILE_COLUMNS };
