import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { editSavedSearch, getSavedSearches, removeSavedSearch } from '$lib/server/services';

function clientFrom(locals: App.Locals): MarketplaceSupabaseClient {
	if (!locals.supabase) error(503, 'Запазените търсения временно не са достъпни.');
	return locals.supabase as MarketplaceSupabaseClient;
}

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.runtime.mode === 'demo') return { searches: { items: [], total: 0, limit: 100, offset: 0, hasMore: false }, demoMode: true };
	const result = await getSavedSearches(clientFrom(locals), { limit: 100, offset: 0 });
	if (!result.ok) error(503, result.error.message);
	return { searches: result.data, demoMode: false };
};

export const actions: Actions = {
	toggle: async ({ request, locals }) => {
		if (locals.runtime.mode === 'demo') return { ok: true };
		const form = await request.formData();
		let filters: unknown;
		try { filters = JSON.parse(form.get('filters')?.toString() ?? 'null'); } catch { return fail(400, { ok: false, message: 'Невалидни филтри.' }); }
		const result = await editSavedSearch(clientFrom(locals), {
			savedSearchId: form.get('savedSearchId'), name: form.get('name'), filters,
			notificationsEnabled: form.get('notificationsEnabled') !== 'true'
		});
		if (!result.ok) return fail(result.error.code === 'VALIDATION' ? 400 : 500, { ok: false, error: result.error });
		return { ok: true };
	},
	remove: async ({ request, locals }) => {
		if (locals.runtime.mode === 'demo') return { ok: true };
		const form = await request.formData();
		const result = await removeSavedSearch(clientFrom(locals), { savedSearchId: form.get('savedSearchId') });
		if (!result.ok) return fail(result.error.code === 'VALIDATION' ? 400 : 500, { ok: false, error: result.error });
		return { ok: true };
	}
};
