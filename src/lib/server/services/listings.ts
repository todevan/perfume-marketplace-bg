import { z } from 'zod';
import {
	cancelListingUploadInputSchema,
	createListingUploadInputSchema,
	listingDraftInputSchema,
	listingIdInputSchema,
	listingSearchInputSchema,
	listingUploadsInputSchema,
	updateListingDraftInputSchema,
	type ActionResult,
	type ListingDetailDto,
	type ListingPageDto,
	type ListingUploadDto,
	type ListingUploadIntentDto
} from '../../contracts';
import {
	cancelListingUpload as repoCancelListingUpload,
	createListingDraft as repoCreateListingDraft,
	createListingUpload as repoCreateListingUpload,
	deleteListingDraft as repoDeleteListingDraft,
	findListingById,
	findListingBySlug,
	listOwnListings as repoListOwnListings,
	listListingUploads,
	pauseListing as repoPauseListing,
	publishListing as repoPublishListing,
	searchListings as repoSearchListings,
	updateListingDraft as repoUpdateListingDraft,
	type MarketplaceSupabaseClient
} from '../repositories';
import { runAction, runAuthenticatedAction } from './action';

const listingSlugInputSchema = z.object({ slug: z.string().trim().min(1).max(220) });
const ownListingPageSchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).max(10_000).default(0)
});

export function browseListings(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<ListingPageDto>> {
	return runAction(listingSearchInputSchema, rawInput, (input) => repoSearchListings(client, input));
}

export function getListing(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<ListingDetailDto | null>> {
	return runAction(listingIdInputSchema, rawInput, ({ listingId }) => findListingById(client, listingId));
}

export function getListingBySlug(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<ListingDetailDto | null>> {
	return runAction(listingSlugInputSchema, rawInput, ({ slug }) => findListingBySlug(client, slug));
}

export function getOwnListings(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<ListingPageDto>> {
	return runAuthenticatedAction(client, ownListingPageSchema, rawInput, (profileId, input) =>
		repoListOwnListings(client, profileId, input.limit, input.offset)
	);
}

export function saveListingDraft(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<ListingDetailDto>> {
	return runAuthenticatedAction(client, listingDraftInputSchema, rawInput, (profileId, input) =>
		repoCreateListingDraft(client, profileId, input)
	);
}

export function editListingDraft(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<ListingDetailDto>> {
	return runAuthenticatedAction(
		client,
		updateListingDraftInputSchema,
		rawInput,
		(profileId, input) => repoUpdateListingDraft(client, profileId, input)
	);
}

export function publishListing(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<ListingDetailDto>> {
	return runAuthenticatedAction(client, listingIdInputSchema, rawInput, (profileId, { listingId }) =>
		repoPublishListing(client, profileId, listingId)
	);
}

export function deleteListingDraft(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<void>> {
	return runAuthenticatedAction(client, listingIdInputSchema, rawInput, (profileId, { listingId }) =>
		repoDeleteListingDraft(client, profileId, listingId)
	);
}

export function pauseListing(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<ListingDetailDto>> {
	return runAuthenticatedAction(client, listingIdInputSchema, rawInput, (profileId, { listingId }) =>
		repoPauseListing(client, profileId, listingId)
	);
}

export function prepareListingUpload(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<ListingUploadIntentDto>> {
	return runAuthenticatedAction(client, createListingUploadInputSchema, rawInput, (_profileId, input) =>
		repoCreateListingUpload(client, input)
	);
}

export function getListingUploads(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<readonly ListingUploadDto[]>> {
	return runAuthenticatedAction(client, listingUploadsInputSchema, rawInput, (profileId, input) =>
		listListingUploads(client, profileId, input.listingId)
	);
}

export function cancelListingUpload(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<void>> {
	return runAuthenticatedAction(client, cancelListingUploadInputSchema, rawInput, (_profileId, input) =>
		repoCancelListingUpload(client, input.uploadId)
	);
}
