import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { updateProfile } from '$lib/server/services';

function clientFrom(locals: App.Locals): MarketplaceSupabaseClient {
	if (!locals.supabase) error(503, 'Настройките временно не са достъпни.');
	return locals.supabase as MarketplaceSupabaseClient;
}

export const load: PageServerLoad = ({ locals }) => ({ profile: locals.profile, demoMode: locals.runtime.mode === 'demo' });

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		if (locals.runtime.mode === 'demo') return { ok: true };
		const result = await updateProfile(clientFrom(locals), {
			username: form.get('username'), city: form.get('city')?.toString().trim() || null,
			bio: form.get('bio')?.toString().trim() || null
		});
		if (!result.ok) return fail(result.error.code === 'VALIDATION' ? 400 : 500, { ok: false, error: result.error });
		return { ok: true, profile: result.data };
	}
};
