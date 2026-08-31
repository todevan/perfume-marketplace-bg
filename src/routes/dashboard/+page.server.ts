import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { getOwnListings, getOwnReports } from '$lib/server/services';
import { demoOwnListings } from '../listings/demo.server';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.runtime.mode === 'demo') {
		return {
			listings: demoOwnListings(),
			reports: {
				items: [
					{
						id: '00000000-0000-4000-8000-000000000024',
						targetType: 'listing' as const,
						reasonCode: 'counterfeit_suspected',
						evidenceCount: 1,
						status: 'investigating' as const,
						outcome: 'pending' as const,
						resolvedAt: null,
						createdAt: '2026-08-24T10:00:00.000Z',
						updatedAt: '2026-08-24T11:00:00.000Z'
					}
				],
				total: 1,
				limit: 10,
				offset: 0,
					hasMore: false
				},
				reportContinuation: { previousHref: null, nextHref: null },
				profile: { username: 'north_notes', city: 'София', accountKind: 'private' as const },
			demoMode: true
		};
	}
	if (!locals.supabase || !locals.profile) error(503, 'Личният панел временно не е достъпен.');
	const client = locals.supabase as MarketplaceSupabaseClient;
	const reportOffset = Number(url.searchParams.get('reportOffset') ?? 0);
	const [listingsResult, reportsResult] = await Promise.all([
		getOwnListings(client, { limit: 10, offset: 0 }),
		getOwnReports(client, { limit: 10, offset: reportOffset })
	]);
	if (!listingsResult.ok) error(503, listingsResult.error.message);
	const reports = reportsResult.ok
		? reportsResult.data
		: {
			items: [],
			total: 0,
			limit: 10,
			offset: reportOffset,
			hasMore: false,
			error: 'Сигналите временно не са достъпни.'
		};
	const reportContinuation = reportsResult.ok
		? {
				previousHref: reports.offset > 0
					? reports.offset <= reports.limit
						? '/dashboard'
						: `/dashboard?reportOffset=${reports.offset - reports.limit}`
					: null,
				nextHref: reports.hasMore
					? `/dashboard?reportOffset=${reports.offset + reports.limit}`
					: null
			}
		: { previousHref: null, nextHref: null };
	return {
		listings: listingsResult.data,
		reports,
		reportContinuation,
		profile: {
			username: locals.profile.username,
			city: locals.profile.city,
			accountKind: locals.profile.accountKind
		},
		demoMode: false
	};
};
