import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { PublicProfileDto, ReviewPageDto } from '$lib/contracts';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { browseListings, getProfileReviews, getPublicProfile } from '$lib/server/services';
import { browseDemoListings } from '../../listings/demo.server';

const demoProfile = (username: string): PublicProfileDto => ({
	id: '00000000-0000-4000-8000-000000000999',
	username,
	city: 'София',
	bio: 'Демонстрационен профил за локалните визуални тестове.',
	avatarUrl: null,
	accountKind: 'private',
	merchantVerified: false,
	ratingAverage: 0,
	ratingCount: 0,
	completedDealsCount: 0,
	memberSince: '2026-07-22T00:00:00.000Z'
});

const emptyReviews: ReviewPageDto = { items: [], total: 0, limit: 50, offset: 0, hasMore: false };

export const load: PageServerLoad = async ({ locals, params }) => {
	if (locals.runtime.mode === 'demo') {
		const all = browseDemoListings({ query: '', segments: [], sort: 'newest', limit: 100, offset: 0 });
		return {
			profile: demoProfile(params.username),
		listings: { ...all, items: all.items.slice(0, 3), total: Math.min(3, all.total), nextCursor: null, totalIsExact: true },
			reviews: emptyReviews,
			demoMode: true
		};
	}
	if (!locals.supabase) error(503, 'Профилът временно не е достъпен.');
	const client = locals.supabase as MarketplaceSupabaseClient;
	const profileResult = await getPublicProfile(client, { username: params.username });
	if (!profileResult.ok) error(503, profileResult.error.message);
	if (!profileResult.data) error(404, 'Профилът не е намерен.');
	const profile = profileResult.data;

	const [reviews, allListings] = await Promise.all([
		getProfileReviews(client, { profileId: profile.id, limit: 50, offset: 0 }),
		browseListings(client, { query: '', segments: [], sort: 'newest', limit: 100, offset: 0 })
	]);
	if (!reviews.ok || !allListings.ok) error(503, 'Профилът временно не е достъпен.');
	const items = allListings.data.items.filter((listing) => listing.seller.id === profile.id);
	return {
		profile,
		listings: { items, total: items.length, limit: 100, offset: 0, hasMore: false, nextCursor: null, totalIsExact: true },
		reviews: reviews.data,
		demoMode: false
	};
};
