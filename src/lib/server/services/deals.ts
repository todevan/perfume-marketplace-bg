import {
	cancelDealInputSchema,
	dealIdInputSchema,
	dealListInputSchema,
	openDealDisputeInputSchema,
	type ActionResult,
	type DealDisputeDto,
	type DealDto,
	type DealPageDto
} from '../../contracts';
import {
	cancelDeal as repoCancelDeal,
	completeDeal as repoCompleteDeal,
	findDealById,
	listDeals as repoListDeals,
	openDealDispute as repoOpenDealDispute,
	type MarketplaceSupabaseClient
} from '../repositories';
import { runAuthenticatedAction } from './action';

export function getDeals(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<DealPageDto>> {
	return runAuthenticatedAction(client, dealListInputSchema, rawInput, (profileId, input) =>
		repoListDeals(client, profileId, input)
	);
}

export function getDeal(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<DealDto | null>> {
	return runAuthenticatedAction(client, dealIdInputSchema, rawInput, (_profileId, { dealId }) =>
		findDealById(client, dealId)
	);
}

export function completeDeal(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<void>> {
	return runAuthenticatedAction(client, dealIdInputSchema, rawInput, (_profileId, { dealId }) =>
		repoCompleteDeal(client, dealId)
	);
}

export function cancelDeal(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<void>> {
	return runAuthenticatedAction(client, cancelDealInputSchema, rawInput, (_profileId, input) =>
		repoCancelDeal(client, input)
	);
}

export function openDealDispute(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<DealDisputeDto>> {
	return runAuthenticatedAction(client, openDealDisputeInputSchema, rawInput, (_profileId, input) =>
		repoOpenDealDispute(client, input)
	);
}
