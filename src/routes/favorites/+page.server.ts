import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { getFavorites, unfavoriteListing } from '$lib/server/services';

function clientFrom(locals: App.Locals): MarketplaceSupabaseClient {
	if (!locals.supabase) error(503, 'Любимите временно не са достъпни.');
	return locals.supabase as MarketplaceSupabaseClient;
}

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.runtime.mode === 'demo') return { favorites: { items: [], total: 0, limit: 100, offset: 0, hasMore: false }, demoMode: true };
	const result = await getFavorites(clientFrom(locals), { limit: 100, offset: 0 });
	if (!result.ok) error(503, result.error.message);
	return { favorites: result.data, demoMode: false };
};

export const actions: Actions = {
	remove: async ({ request, locals }) => {
		if (locals.runtime.mode === 'demo') return { ok: true };
		const form = await request.formData();
		const result = await unfavoriteListing(clientFrom(locals), { listingId: form.get('listingId') });
		if (!result.ok) return fail(result.error.code === 'VALIDATION' ? 400 : 500, { ok: false, error: result.error });
		return { ok: true };
	}
};
