import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { ListingCardDto, PublicProfileDto } from '$lib/contracts';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { browseListings, getMerchantDirectory } from '$lib/server/services';

function merchantCard(profile: PublicProfileDto, listings: readonly ListingCardDto[], index: number) {
	const ownListings = listings.filter((listing) => listing.seller.id === profile.id);
	const initials = profile.username
		.split(/[\s_.-]+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toLocaleUpperCase('bg-BG'))
		.join('');
	return {
		slug: profile.username,
		name: profile.username,
		city: profile.city ?? 'България',
		since: new Date(profile.memberSince).getUTCFullYear().toString(),
		rating: profile.ratingCount > 0 ? profile.ratingAverage.toLocaleString('bg-BG', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : 'Нов',
		deals: profile.completedDealsCount,
		active: ownListings.length,
		focus: 'Проверен търговец',
		note: profile.bio ?? 'Ръчно проверен търговски профил в затворената beta.',
		initials: initials || 'P',
		color: ['#cfb18f', '#b9b1cb', '#c99f6c', '#b8c7c1'][index % 4],
		scents: ownListings.slice(0, 3).map((listing) => listing.fragranceName)
	};
}

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.runtime.mode === 'demo') {
		return { merchants: [], merchantListings: [], demoMode: true };
	}
	if (!locals.supabase) error(503, 'Търговската директория временно не е достъпна.');
	const client = locals.supabase as MarketplaceSupabaseClient;
	const [directory, listings] = await Promise.all([
		getMerchantDirectory(client, { query: '', limit: 50, offset: 0 }),
		browseListings(client, { query: '', segments: [], kind: 'offer', sort: 'newest', limit: 100, offset: 0 })
	]);
	if (!directory.ok || !listings.ok) error(503, 'Търговската директория временно не е достъпна.');

	const merchantIds = new Set(directory.data.items.map((merchant) => merchant.id));
	const merchantListings = listings.data.items.filter((listing) => merchantIds.has(listing.seller.id));
	return {
		merchants: directory.data.items.map((merchant, index) => merchantCard(merchant, merchantListings, index)),
		merchantListings: merchantListings.slice(0, 4),
		demoMode: false
	};
};
