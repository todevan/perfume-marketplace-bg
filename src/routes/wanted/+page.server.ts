import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { browseListings } from '$lib/server/services';
import { browseDemoListings } from '../listings/demo.server';

export const load: PageServerLoad = async ({ locals, url }) => {
	const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
	const filters = {
		query: (url.searchParams.get('q') ?? '').trim().slice(0, 120),
		city: (url.searchParams.get('city') ?? '').trim().slice(0, 100),
		page
	};
	const input = {
		query: filters.query,
		kind: 'wanted' as const,
		segments: [],
		city: filters.city || undefined,
		sort: 'newest' as const,
		limit: 24,
		offset: (page - 1) * 24
	};
	const result = locals.runtime.mode === 'demo'
		? { ok: true as const, data: browseDemoListings(input) }
		: locals.supabase
			? await browseListings(locals.supabase as MarketplaceSupabaseClient, input)
			: null;
	if (!result) error(503, 'Търсенията временно не са достъпни.');
	if (!result.ok) error(result.error.code === 'VALIDATION' ? 400 : 503, result.error.message);

	const href = (targetPage: number) => {
		const params = new URLSearchParams();
		if (filters.query) params.set('q', filters.query);
		if (filters.city) params.set('city', filters.city);
		if (targetPage > 1) params.set('page', String(targetPage));
		return `/wanted${params.size ? `?${params}` : ''}`;
	};
	return {
		listings: result.data,
		filters,
		previousHref: page > 1 ? href(page - 1) : null,
		nextHref: result.data.hasMore ? href(page + 1) : null,
		demoMode: locals.runtime.mode === 'demo'
	};
};
