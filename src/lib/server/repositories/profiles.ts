import type { ActorSummaryDto, PublicProfileDto, UpdateProfileInput } from '../../contracts';
import type { Views } from '../database.types';
import {
	RepositoryError,
	requireData,
	throwIfError,
	type MarketplaceSupabaseClient
} from './shared';

export type PublicProfileActorRow = Pick<
	Views<'public_profiles'>,
	'id' | 'username' | 'avatar_path' | 'account_kind' | 'is_merchant_verified'
>;

export type ValidPublicProfileActorRow = {
	readonly id: string;
	readonly username: string;
	readonly avatar_path: string | null;
	readonly account_kind: NonNullable<PublicProfileActorRow['account_kind']>;
	readonly is_merchant_verified: boolean;
};

const PUBLIC_PROFILE_COLUMNS =
	'id,username,city,bio,avatar_path,account_kind,is_merchant_verified,rating_average,rating_count,completed_deals_count,member_since' as const;

export function requirePublicProfileActor(
	row: PublicProfileActorRow,
	operation: string
): ValidPublicProfileActorRow {
	if (!row.id || !row.username || row.account_kind === null) {
		throw new RepositoryError(
			operation,
			'23502',
			'Public profile projection is missing required identity fields.'
		);
	}
	return {
		id: row.id,
		username: row.username,
		avatar_path: row.avatar_path,
		account_kind: row.account_kind,
		// A missing verification projection must never grant merchant trust.
		is_merchant_verified: row.is_merchant_verified ?? false
	};
}

export function toActorSummaryDto(
	row: PublicProfileActorRow,
	operation = 'profiles.actor'
): ActorSummaryDto {
	const profile = requirePublicProfileActor(row, operation);
	return {
		id: profile.id,
		username: profile.username,
		avatarUrl: profile.avatar_path,
		accountKind: profile.account_kind,
		merchantVerified: profile.is_merchant_verified
	};
}

export function toPublicProfileDto(row: Views<'public_profiles'>): PublicProfileDto {
	const profile = requirePublicProfileActor(row, 'profiles.toPublicProfileDto');
	if (!row.member_since) {
		throw new RepositoryError(
			'profiles.toPublicProfileDto',
			'23502',
			'Public profile projection is missing its membership timestamp.'
		);
	}
	return {
		id: profile.id,
		username: profile.username,
		city: row.city,
		bio: row.bio,
		avatarUrl: profile.avatar_path,
		accountKind: profile.account_kind,
		merchantVerified: profile.is_merchant_verified,
		ratingAverage: Number(row.rating_average ?? 0),
		ratingCount: row.rating_count ?? 0,
		completedDealsCount: row.completed_deals_count ?? 0,
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
