import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { browseListings } from '$lib/server/services';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { browseDemoListings } from './demo.server';
import { listingCursorHref, listingPageHref, listingStartHref, parseListingRouteQuery } from './query';

export const load: PageServerLoad = async ({ locals, url }) => {
	const { filters, input } = parseListingRouteQuery(url);
	const result = locals.runtime.mode === 'demo'
		? { ok: true as const, data: browseDemoListings(input) }
		: locals.supabase
			? await browseListings(locals.supabase as MarketplaceSupabaseClient, input)
			: null;

	if (!result) error(503, 'Каталогът временно не е достъпен.');
	if (!result.ok) error(result.error.code === 'VALIDATION' ? 400 : 503, result.error.message);

	const pageCount = result.data.totalIsExact
		? Math.max(1, Math.ceil(result.data.total / result.data.limit))
		: null;
	const usesCursor = locals.runtime.mode === 'production';
	return {
		listings: result.data,
		filters,
		pageCount,
		previousHref: usesCursor
			? filters.cursorId ? listingStartHref(url) : null
			: filters.page > 1 ? listingPageHref(url, filters.page - 1) : null,
		nextHref: result.data.hasMore
			? usesCursor && result.data.nextCursor
				? listingCursorHref(url, result.data.nextCursor)
				: listingPageHref(url, filters.page + 1)
			: null,
		demoMode: locals.runtime.mode === 'demo'
	};
};
