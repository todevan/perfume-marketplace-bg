import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { browseListings } from '$lib/server/services';
import { browseDemoListings } from '../listings/demo.server';

export const load: PageServerLoad = async ({ locals, url }) => {
	const usesCursor = locals.runtime.mode === 'production';
	const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
	const filters = {
		query: (url.searchParams.get('q') ?? '').trim().slice(0, 120),
		city: (url.searchParams.get('city') ?? '').trim().slice(0, 100),
		page,
		cursorActivatedAt: (url.searchParams.get('cursorAt') ?? '').trim(),
		cursorId: (url.searchParams.get('cursorId') ?? '').trim()
	};
	const input = {
		query: filters.query,
		kind: 'wanted' as const,
		segments: [],
		city: filters.city || undefined,
		sort: 'newest' as const,
		limit: 24,
		offset: usesCursor ? 0 : (page - 1) * 24
	};
	const hasCursorPart = Boolean(filters.cursorActivatedAt || filters.cursorId);
	const hasValidCursor = Boolean(
		filters.cursorActivatedAt &&
		!Number.isNaN(Date.parse(filters.cursorActivatedAt)) &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
			.test(filters.cursorId)
	);
	if (usesCursor && hasCursorPart && !hasValidCursor) {
		error(400, 'Невалиден курсор за следващата страница.');
	}
	if (hasValidCursor) {
		Object.assign(input, {
			cursorActivatedAt: filters.cursorActivatedAt,
			cursorId: filters.cursorId,
			offset: 0
		});
	}
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
	const cursorHref = result.data.nextCursor?.activatedAt
		? (() => {
				const params = new URLSearchParams();
				if (filters.query) params.set('q', filters.query);
				if (filters.city) params.set('city', filters.city);
				params.set('cursorAt', result.data.nextCursor.activatedAt);
				params.set('cursorId', result.data.nextCursor.id);
				return `/wanted?${params}`;
			})()
		: null;
	return {
		listings: result.data,
		filters,
		previousHref: usesCursor
			? filters.cursorId ? href(1) : null
			: page > 1 ? href(page - 1) : null,
		nextHref: result.data.hasMore
			? usesCursor ? cursorHref : href(page + 1)
			: null,
		demoMode: locals.runtime.mode === 'demo'
	};
};
