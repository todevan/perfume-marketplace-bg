import {
	merchantApplicationIdSchema,
	merchantApplicationInputSchema,
	merchantDirectoryInputSchema,
	type ActionResult,
	type MerchantApplicationDto,
	type MerchantDirectoryPageDto
} from '../../contracts';
import {
	createMerchantApplication as repoCreateMerchantApplication,
	findOwnMerchantApplication,
	listVerifiedMerchants,
	updateMerchantApplication as repoUpdateMerchantApplication,
	withdrawMerchantApplication as repoWithdrawMerchantApplication,
	type MarketplaceSupabaseClient
} from '../repositories';
import { runAction, runAuthenticatedAction } from './action';

export function getMerchantDirectory(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<MerchantDirectoryPageDto>> {
	return runAction(merchantDirectoryInputSchema, rawInput, (input) => listVerifiedMerchants(client, input));
}

export function getOwnMerchantApplication(
	client: MarketplaceSupabaseClient
): Promise<ActionResult<MerchantApplicationDto | null>> {
	return runAuthenticatedAction(client, merchantApplicationIdSchema.partial(), {}, (profileId) =>
		findOwnMerchantApplication(client, profileId)
	);
}

export function createMerchantApplication(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<MerchantApplicationDto>> {
	return runAuthenticatedAction(
		client,
		merchantApplicationInputSchema,
		rawInput,
		(profileId, input) => repoCreateMerchantApplication(client, profileId, input)
	);
}

export function updateMerchantApplication(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<MerchantApplicationDto>> {
	const schema = merchantApplicationInputSchema.and(merchantApplicationIdSchema);
	return runAuthenticatedAction(client, schema, rawInput, (profileId, input) =>
		repoUpdateMerchantApplication(client, profileId, input.applicationId, input)
	);
}

export function withdrawMerchantApplication(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<void>> {
	return runAuthenticatedAction(
		client,
		merchantApplicationIdSchema,
		rawInput,
		(profileId, { applicationId }) =>
			repoWithdrawMerchantApplication(client, profileId, applicationId)
	);
}

