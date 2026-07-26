import {
	createReviewInputSchema,
	reviewListInputSchema,
	updateReviewInputSchema,
	type ActionResult,
	type ReviewDto,
	type ReviewPageDto
} from '../../contracts';
import {
	createReview as repoCreateReview,
	listReviewsForProfile,
	updateOwnReview,
	type MarketplaceSupabaseClient
} from '../repositories';
import { runAction, runAuthenticatedAction } from './action';

export function getProfileReviews(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<ReviewPageDto>> {
	return runAction(reviewListInputSchema, rawInput, (input) => listReviewsForProfile(client, input));
}

export function submitReview(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<ReviewDto>> {
	return runAuthenticatedAction(client, createReviewInputSchema, rawInput, (profileId, input) =>
		repoCreateReview(client, profileId, input)
	);
}

export function editReview(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<ReviewDto>> {
	return runAuthenticatedAction(client, updateReviewInputSchema, rawInput, (profileId, input) =>
		updateOwnReview(client, profileId, input)
	);
}

