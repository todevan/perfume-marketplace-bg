import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { getOwnListings } from '$lib/server/services';
import { demoOwnListings } from '../listings/demo.server';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.runtime.mode === 'demo') {
		return {
			listings: demoOwnListings(),
			profile: { username: 'north_notes', city: 'София', phoneVerified: true, accountKind: 'private' as const },
			demoMode: true
		};
	}
	if (!locals.supabase || !locals.profile) error(503, 'Личният панел временно не е достъпен.');
	const result = await getOwnListings(locals.supabase as MarketplaceSupabaseClient, { limit: 10, offset: 0 });
	if (!result.ok) error(503, result.error.message);
	return {
		listings: result.data,
		profile: {
			username: locals.profile.username,
			city: locals.profile.city,
			phoneVerified: Boolean(locals.profile.phoneVerifiedAt),
			accountKind: locals.profile.accountKind
		},
		demoMode: false
	};
};
