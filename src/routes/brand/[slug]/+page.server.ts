import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { brandSlug, catalogBrands } from '$lib/data/catalog';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { browseListings, saveSearch, searchCatalog } from '$lib/server/services';
import { browseDemoListings } from '../../listings/demo.server';

function clientFrom(locals: App.Locals): MarketplaceSupabaseClient {
	if (!locals.supabase) error(503, 'Каталогът временно не е достъпен.');
	return locals.supabase as MarketplaceSupabaseClient;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const registryBrand = catalogBrands.find((candidate) => brandSlug(candidate) === params.slug);
	if (!registryBrand) error(404, 'Марката не е намерена.');

	if (locals.runtime.mode === 'demo') {
		const all = browseDemoListings({ query: registryBrand.canonicalName, segments: [], sort: 'newest', limit: 100, offset: 0 });
		return { brand: registryBrand, databaseBrandId: null, listings: all, demoMode: true };
	}

	const client = clientFrom(locals);
	const catalog = await searchCatalog(client, { query: registryBrand.canonicalName, limit: 20, offset: 0 });
	if (!catalog.ok) error(503, catalog.error.message);
	const databaseBrand = catalog.data.brands.find(
		(candidate) => candidate.name.toLocaleLowerCase('bg-BG') === registryBrand.canonicalName.toLocaleLowerCase('bg-BG')
	);
	if (!databaseBrand) error(404, 'Марката още не е синхронизирана в beta каталога.');
	const listings = await browseListings(client, {
		query: '', segments: [], brandId: databaseBrand.id, sort: 'newest', limit: 100, offset: 0
	});
	if (!listings.ok) error(503, listings.error.message);
	return { brand: registryBrand, databaseBrandId: databaseBrand.id, listings: listings.data, demoMode: false };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		if (locals.runtime.mode === 'demo') return { ok: true, demo: true };
		const form = await request.formData();
		const brandId = form.get('brandId');
		const brandName = form.get('brandName')?.toString().trim() ?? 'Марка';
		const result = await saveSearch(clientFrom(locals), {
			name: `Марка: ${brandName}`.slice(0, 80),
			filters: { query: '', segments: [], brandId, sort: 'newest', limit: 24, offset: 0 },
			notificationsEnabled: form.get('notificationsEnabled') === 'true'
		});
		if (!result.ok) return fail(result.error.code === 'VALIDATION' ? 400 : 500, { ok: false, error: result.error });
		return { ok: true, savedSearchId: result.data.id };
	}
};
