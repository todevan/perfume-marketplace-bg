import {
	createOfferInputSchema,
	offerIdInputSchema,
	offerListInputSchema,
	type ActionResult,
	type OfferDto,
	type OfferPageDto
} from '../../contracts';
import {
	acceptOffer as repoAcceptOffer,
	createOffer as repoCreateOffer,
	declineOffer as repoDeclineOffer,
	listOffers as repoListOffers,
	withdrawOffer as repoWithdrawOffer,
	type MarketplaceSupabaseClient
} from '../repositories';
import { runAuthenticatedAction } from './action';

export function getOffers(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<OfferPageDto>> {
	return runAuthenticatedAction(client, offerListInputSchema, rawInput, (profileId, input) =>
		repoListOffers(client, profileId, input)
	);
}

export function submitOffer(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<OfferDto>> {
	return runAuthenticatedAction(client, createOfferInputSchema, rawInput, (profileId, input) =>
		repoCreateOffer(client, profileId, input)
	);
}

export function withdrawOffer(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<void>> {
	return runAuthenticatedAction(client, offerIdInputSchema, rawInput, (profileId, { offerId }) =>
		repoWithdrawOffer(client, profileId, offerId)
	);
}

export function acceptOffer(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<{ dealId: string }>> {
	return runAuthenticatedAction(client, offerIdInputSchema, rawInput, async (_profileId, { offerId }) => ({
		dealId: await repoAcceptOffer(client, offerId)
	}));
}

export function declineOffer(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<void>> {
	return runAuthenticatedAction(client, offerIdInputSchema, rawInput, (_profileId, { offerId }) =>
		repoDeclineOffer(client, offerId)
	);
}

