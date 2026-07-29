import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { ListingPageDto } from '$lib/contracts';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { browseListings } from '$lib/server/services';
import { browseDemoListings } from './listings/demo.server';

const EMPTY_PAGE: ListingPageDto = {
	items: [],
	total: 0,
	limit: 3,
	offset: 0,
	hasMore: false,
	nextCursor: null,
	totalIsExact: true
};

export const load: PageServerLoad = async ({ locals }) => {
	const common = { query: '', segments: [], offset: 0, sort: 'newest' as const };

	if (locals.runtime.mode === 'demo') {
		return {
			latest: browseDemoListings({ ...common, kind: 'offer', limit: 7 }),
			wanted: EMPTY_PAGE,
			demoMode: true
		};
	}

	if (!locals.supabase) error(503, 'Каталогът временно не е достъпен.');
	const client = locals.supabase as MarketplaceSupabaseClient;
	const [latest, wanted] = await Promise.all([
		browseListings(client, { ...common, kind: 'offer', limit: 7 }),
		browseListings(client, { ...common, kind: 'wanted', limit: 3 })
	]);
	if (!latest.ok || !wanted.ok) {
		error(503, 'Каталогът временно не е достъпен.');
	}

	return { latest: latest.data, wanted: wanted.data, demoMode: false };
};
