import {
	publicProfileLookupSchema,
	updateProfileInputSchema,
	type ActionResult,
	type PublicProfileDto
} from '../../contracts';
import {
	findPublicProfileByUsername,
	updateOwnPublicProfile,
	type MarketplaceSupabaseClient
} from '../repositories';
import { runAction, runAuthenticatedAction } from './action';

export function getPublicProfile(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<PublicProfileDto | null>> {
	return runAction(publicProfileLookupSchema, rawInput, ({ username }) =>
		findPublicProfileByUsername(client, username)
	);
}

export function updateProfile(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<PublicProfileDto>> {
	return runAuthenticatedAction(client, updateProfileInputSchema, rawInput, (profileId, input) =>
		updateOwnPublicProfile(client, profileId, input)
	);
}

