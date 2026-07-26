import {
	brandCollectionSchema,
	catalogSearchInputSchema,
	fragranceLookupInputSchema,
	fragranceSlugInputSchema,
	pendingBrandInputSchema,
	type ActionResult,
	type BrandCollectionItemDto,
	type BrandSummaryDto,
	type CatalogSearchDto,
	type FragranceSummaryDto
} from '../../contracts';
import {
	createPendingBrand as repoCreatePendingBrand,
	listBrandCollection as repoListBrandCollection,
	listFragrancesByBrand,
	findFragranceBySlug,
	searchCatalog as repoSearchCatalog,
	type MarketplaceSupabaseClient
} from '../repositories';
import { runAction, runAuthenticatedAction } from './action';

export function searchCatalog(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<CatalogSearchDto>> {
	return runAction(catalogSearchInputSchema, rawInput, (input) => repoSearchCatalog(client, input));
}

export function getBrandCollection(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<readonly BrandCollectionItemDto[]>> {
	return runAction(brandCollectionSchema, rawInput, (collection) =>
		repoListBrandCollection(client, collection)
	);
}

export function getBrandFragrances(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<readonly FragranceSummaryDto[]>> {
	return runAction(fragranceLookupInputSchema, rawInput, (input) =>
		listFragrancesByBrand(client, input)
	);
}

export function getFragranceBySlug(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<FragranceSummaryDto | null>> {
	return runAction(fragranceSlugInputSchema, rawInput, ({ slug }) =>
		findFragranceBySlug(client, slug)
	);
}

export function submitPendingBrand(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<BrandSummaryDto>> {
	return runAuthenticatedAction(client, pendingBrandInputSchema, rawInput, (profileId, input) =>
		repoCreatePendingBrand(client, profileId, input)
	);
}
