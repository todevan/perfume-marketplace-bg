import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { FragranceSummaryDto } from '$lib/contracts';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { browseListings, getFragranceBySlug, saveSearch } from '$lib/server/services';
import { browseDemoListings, getDemoListingBySlug } from '../../listings/demo.server';

function clientFrom(locals: App.Locals): MarketplaceSupabaseClient {
	if (!locals.supabase) error(503, 'Каталогът временно не е достъпен.');
	return locals.supabase as MarketplaceSupabaseClient;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	if (locals.runtime.mode === 'demo') {
		const listing = getDemoListingBySlug(params.slug);
		if (!listing) error(404, 'Ароматът не е намерен.');
		const fragrance: FragranceSummaryDto = {
			id: listing.id,
			slug: params.slug,
			brand: { id: listing.brandId, name: listing.brandName, slug: listing.brandSlug, parentBrandId: null },
			name: listing.fragranceName,
			audience: listing.audience,
			segments: listing.segments,
			concentration: listing.concentration,
			concentrationLabel: listing.concentrationLabel,
			referenceUrl: listing.referenceUrl
		};
		const listings = browseDemoListings({ query: listing.fragranceName, segments: [], sort: 'newest', limit: 100, offset: 0 });
		return { fragrance, listings, demoMode: true };
	}

	const client = clientFrom(locals);
	const fragranceResult = await getFragranceBySlug(client, { slug: params.slug });
	if (!fragranceResult.ok) error(503, fragranceResult.error.message);
	if (!fragranceResult.data) error(404, 'Ароматът не е намерен.');
	const fragrance = fragranceResult.data;
	const listings = await browseListings(client, {
		query: '', segments: [], fragranceId: fragrance.id, sort: 'newest', limit: 100, offset: 0
	});
	if (!listings.ok) error(503, listings.error.message);
	return { fragrance, listings: listings.data, demoMode: false };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		if (locals.runtime.mode === 'demo') return { ok: true, demo: true };
		const form = await request.formData();
		const fragranceId = form.get('fragranceId');
		const fragranceName = form.get('fragranceName')?.toString().trim() ?? 'Аромат';
		const result = await saveSearch(clientFrom(locals), {
			name: `Аромат: ${fragranceName}`.slice(0, 80),
			filters: { query: '', segments: [], fragranceId, sort: 'newest', limit: 24, offset: 0 },
			notificationsEnabled: true
		});
		if (!result.ok) return fail(result.error.code === 'VALIDATION' ? 400 : 500, { ok: false, error: result.error });
		return { ok: true, savedSearchId: result.data.id };
	}
};
