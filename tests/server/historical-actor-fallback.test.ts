import { describe, expect, it } from 'vitest';
import type { Tables } from '../../src/lib/server/database.types';
import {
	findDealById,
	findOfferById,
	hydrateListingCards,
	listConversations,
	listMessages,
	listReviewsForProfile,
	type ListingJoinedRow,
	type MarketplaceSupabaseClient
} from '../../src/lib/server/repositories';

const ownerId = '11111111-1111-4111-8111-111111111111';
const removedId = '22222222-2222-4222-8222-222222222222';
const listingId = '33333333-3333-4333-8333-333333333333';
const offerId = '44444444-4444-4444-8444-444444444444';
const conversationId = '55555555-5555-4555-8555-555555555555';
const dealId = '66666666-6666-4666-8666-666666666666';

const removedActor = {
	id: removedId,
	username: 'Премахнат потребител',
	avatarUrl: null,
	accountKind: 'private',
	merchantVerified: false
} as const;

const listing = {
	id: listingId,
	slug: 'historical-listing-3333333333',
	seller_id: removedId,
	kind: 'offer',
	deal_mode: 'sale',
	product_format: 'retail_bottle',
	audience: 'unisex',
	segments: [],
	brand_id: '77777777-7777-4777-8777-777777777777',
	fragrance_id: null,
	fragrance_name: 'Historical fragrance',
	concentration: 'EDP',
	concentration_label: null,
	fragrantica_url: null,
	title: 'Historical listing',
	description: 'Persisted domain record',
	city: 'Sofia',
	bottle_volume_ml: 100,
	remaining_ml: 75,
	is_sealed: false,
	price_minor: 7500,
	estimated_value_minor: null,
	max_budget_minor: null,
	status: 'completed',
	activated_at: '2026-07-01T10:00:00.000Z',
	expires_at: null,
	completed_at: '2026-07-10T10:00:00.000Z',
	created_at: '2026-07-01T09:00:00.000Z',
	updated_at: '2026-07-10T10:00:00.000Z',
	brand: {
		id: '77777777-7777-4777-8777-777777777777',
		canonical_name: 'Historical Brand',
		slug: 'historical-brand'
	},
	photos: [],
	authenticity: null
} as unknown as ListingJoinedRow;

type QueryResult = { data: unknown; error: null; count?: number | null };

function query(result: QueryResult): unknown {
	const chain: Record<string, unknown> = {};
	for (const method of ['select', 'eq', 'or', 'in', 'order', 'range', 'limit']) {
		chain[method] = () => chain;
	}
	chain.maybeSingle = async () => result;
	chain.single = async () => result;
	chain.then = (
		resolve: (value: QueryResult) => unknown,
		reject: (reason: unknown) => unknown
	) => Promise.resolve(result).then(resolve, reject);
	return chain;
}

function clientWith(results: Readonly<Record<string, QueryResult>>): MarketplaceSupabaseClient {
	return {
		from: (table: string) => query(results[table] ?? { data: [], error: null })
	} as unknown as MarketplaceSupabaseClient;
}

describe('historical actor fallback', () => {
	it('keeps a listing whose seller is no longer in public_profiles', async () => {
		const items = await hydrateListingCards(
			clientWith({ public_profiles: { data: [], error: null } }),
			[listing]
		);

		expect(items).toHaveLength(1);
		expect(items[0]?.seller).toEqual(removedActor);
	});

	it('keeps a deal and pseudonymizes missing parties', async () => {
		const row = {
			id: dealId,
			listing_id: listingId,
			offered_listing_id: null,
			party_a_id: ownerId,
			party_b_id: removedId,
			status: 'completed',
			completed_at: '2026-07-10T10:00:00.000Z',
			disputed_at: null,
			cancelled_at: null,
			cancellation_reason: null,
			created_at: '2026-07-01T09:00:00.000Z'
		} as Tables<'deals'>;
		const item = await findDealById(clientWith({
			deals: { data: row, error: null },
			listings: { data: [listing], error: null },
			public_profiles: { data: [], error: null },
			deal_confirmations: { data: [], error: null }
		}), dealId);

		expect(item?.listing.id).toBe(listingId);
		expect(item?.partyB).toEqual(removedActor);
		expect(item?.partyA.username).toBe('Премахнат потребител');
	});

	it('keeps an offer whose offerer is no longer public', async () => {
		const row = {
			id: offerId,
			listing_id: listingId,
			offerer_id: removedId,
			kind: 'cash',
			cash_amount_minor: 7000,
			offered_listing_id: null,
			message: null,
			status: 'accepted',
			expires_at: null,
			responded_at: '2026-07-05T10:00:00.000Z',
			created_at: '2026-07-04T10:00:00.000Z'
		} as Tables<'offers'>;
		const item = await findOfferById(clientWith({
			offers: { data: row, error: null },
			listings: { data: [listing], error: null },
			public_profiles: { data: [], error: null }
		}), offerId);

		expect(item?.listing.id).toBe(listingId);
		expect(item?.offerer).toEqual(removedActor);
	});

	it('keeps published reviews without exposing a removed reviewer profile', async () => {
		const row = {
			id: '88888888-8888-4888-8888-888888888888',
			deal_id: dealId,
			reviewer_id: removedId,
			reviewee_id: ownerId,
			rating: 5,
			body: 'Historical review',
			status: 'published',
			created_at: '2026-07-11T10:00:00.000Z',
			updated_at: '2026-07-11T10:00:00.000Z'
		} as Tables<'reviews'>;
		const page = await listReviewsForProfile(clientWith({
			reviews: { data: [row], error: null, count: 1 },
			public_profiles: { data: [], error: null }
		}), { profileId: ownerId, limit: 20, offset: 0 });

		expect(page.total).toBe(1);
		expect(page.items).toHaveLength(1);
		expect(page.items[0]?.reviewer).toEqual(removedActor);
	});

	it('keeps messages sent before the sender left public_profiles', async () => {
		const row = {
			id: '99999999-9999-4999-8999-999999999999',
			conversation_id: conversationId,
			sender_id: removedId,
			body: 'Historical message',
			reply_to_id: null,
			created_at: '2026-07-05T10:00:00.000Z',
			edited_at: null,
			deleted_at: null
		} as Tables<'messages'>;
		const page = await listMessages(clientWith({
			messages: { data: [row], error: null, count: 1 },
			public_profiles: { data: [], error: null }
		}), { conversationId, limit: 20, offset: 0 });

		expect(page.total).toBe(1);
		expect(page.items).toHaveLength(1);
		expect(page.items[0]?.sender).toEqual(removedActor);
	});

	it('keeps conversation summaries and their last message', async () => {
		const membership = {
			conversation_id: conversationId,
			profile_id: ownerId,
			joined_at: '2026-07-05T09:00:00.000Z',
			last_read_at: null,
			muted_at: null,
			blocked_at: null
		} as Tables<'conversation_members'>;
		const conversation = {
			id: conversationId,
			listing_id: listingId,
			accepted_offer_id: offerId,
			status: 'open',
			created_at: '2026-07-05T09:00:00.000Z',
			updated_at: '2026-07-05T10:00:00.000Z'
		} as Tables<'conversations'>;
		const message = {
			id: '99999999-9999-4999-8999-999999999999',
			conversation_id: conversationId,
			sender_id: removedId,
			body: 'Historical message',
			reply_to_id: null,
			created_at: '2026-07-05T10:00:00.000Z',
			edited_at: null,
			deleted_at: null
		} as Tables<'messages'>;
		const page = await listConversations(clientWith({
			conversation_members: { data: [membership], error: null, count: 1 },
			conversations: { data: [conversation], error: null },
			offers: { data: [{ id: offerId, offerer_id: removedId }], error: null },
			listings: { data: [{ id: listingId, title: 'Historical listing', seller_id: ownerId }], error: null },
			messages: { data: [message], error: null },
			public_profiles: { data: [], error: null }
		}), ownerId, { limit: 20, offset: 0 });

		expect(page.total).toBe(1);
		expect(page.items).toHaveLength(1);
		expect(page.items[0]?.counterpart).toEqual(removedActor);
		expect(page.items[0]?.lastMessage?.sender).toEqual(removedActor);
	});
});
