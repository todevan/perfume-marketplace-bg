import { describe, expect, it, vi } from 'vitest';
import {
	listingDraftInputSchema,
	listingSearchInputSchema,
	openDealDisputeInputSchema
} from '../../src/lib/contracts';
import { searchCatalog } from '../../src/lib/server/repositories/catalog';
import { openDealDispute } from '../../src/lib/server/repositories/deals';
import {
	createListingDraft,
	searchListings,
	updateListingDraft,
	type ListingJoinedRow
} from '../../src/lib/server/repositories/listings';
import type { MarketplaceSupabaseClient } from '../../src/lib/server/repositories/shared';
import {
	cashAmountMinor,
	offeredListingEligible,
	offerKindAllowed
} from '../../src/routes/listing/[slug]/offer-form';
import { parseListingRouteQuery } from '../../src/routes/listings/query';

const uuid = '11111111-1111-4111-8111-111111111111';

describe('listing route query and offer action helpers', () => {
	it('maps URL filters and EUR amounts to the browse service contract', () => {
		const { input } = parseListingRouteQuery(new URL(
			'https://example.test/listings?q=oud&category=niche&mode=swap&maxPrice=125.50&sort=price-asc'
		));
		expect(input).toMatchObject({
			query: 'oud',
			segments: ['niche'],
			dealMode: 'swap',
			maxPriceMinor: 12_550,
			sort: 'price_asc',
			limit: 12,
			offset: 0
		});
	});

	it('accepts a complete keyset cursor and ignores partial cursor input', () => {
		const valid = parseListingRouteQuery(new URL(
			`https://example.test/listings?cursorAt=2026-07-22T10%3A00%3A00.000Z&cursorId=${uuid}`
		)).input;
		expect(valid).toMatchObject({ cursorActivatedAt: '2026-07-22T10:00:00.000Z', cursorId: uuid });
		const partial = parseListingRouteQuery(new URL('https://example.test/listings?cursorAt=2026-07-22T10%3A00%3A00.000Z')).input;
		expect(partial.cursorActivatedAt).toBeUndefined();
	});

	it('enforces sort-specific cursor components at the contract boundary', () => {
		expect(listingSearchInputSchema.safeParse({
			sort: 'price_asc',
			cursorPriceMinor: 5000,
			cursorId: uuid
		}).success).toBe(true);
		expect(listingSearchInputSchema.safeParse({
			sort: 'price_asc',
			cursorActivatedAt: '2026-07-22T10:00:00.000Z',
			cursorId: uuid
		}).success).toBe(false);
	});

	it('enforces offer kinds from the persisted listing deal mode', () => {
		expect(offerKindAllowed({ dealMode: 'sale' }, 'cash')).toBe(true);
		expect(offerKindAllowed({ dealMode: 'sale' }, 'swap')).toBe(false);
		expect(offerKindAllowed({ dealMode: 'swap' }, 'swap')).toBe(true);
		expect(offerKindAllowed({ dealMode: 'swap' }, 'cash_plus_swap')).toBe(false);
		expect(offerKindAllowed({ dealMode: 'sale_or_swap' }, 'cash_plus_swap')).toBe(true);
		expect(cashAmountMinor('12,50')).toBe(1250);
		expect(cashAmountMinor('0')).toBeNull();
	});

	it('matches database eligibility for a listing offered in a swap', () => {
		const eligible = {
			kind: 'offer' as const,
			status: 'active' as const,
			dealMode: 'swap' as const,
			remainingMl: 1
		};
		expect(offeredListingEligible(eligible)).toBe(true);
		expect(offeredListingEligible({ ...eligible, kind: 'wanted' })).toBe(false);
		expect(offeredListingEligible({ ...eligible, status: 'reserved' })).toBe(false);
		expect(offeredListingEligible({ ...eligible, dealMode: 'sale' })).toBe(false);
		expect(offeredListingEligible({ ...eligible, remainingMl: 0 })).toBe(false);
		expect(offeredListingEligible({ ...eligible, remainingMl: null })).toBe(false);
		expect(offeredListingEligible({ ...eligible, dealMode: 'sale_or_swap' })).toBe(true);
	});
});

describe('RPC-backed marketplace boundaries', () => {
	it('uses the sort-aware keyset search RPC even for an empty search query', async () => {
		const rpc = vi.fn(async () => ({ data: [], error: null }));
		const client = { rpc } as unknown as MarketplaceSupabaseClient;
		const result = await searchListings(client, {
			query: '', segments: [], sort: 'newest', limit: 12, offset: 0
		});
		expect(rpc).toHaveBeenCalledWith('search_listings_v2', {
			page_size: 13,
			sort_mode: 'newest'
		});
		expect(result).toMatchObject({ items: [], nextCursor: null, totalIsExact: true });
	});

	it('omits absent search defaults and sends only populated RPC filters', async () => {
		const rpc = vi.fn(async () => ({ data: [], error: null }));
		const client = { rpc } as unknown as MarketplaceSupabaseClient;
		const result = await searchListings(client, {
			query: 'oud',
			audience: 'unisex',
			segments: ['niche'],
			dealMode: 'swap',
			city: 'Sofia',
			minPriceMinor: 1000,
			maxPriceMinor: 5000,
			cursorActivatedAt: '2026-07-22T10:00:00.000Z',
			cursorId: uuid,
			sort: 'newest',
			limit: 12,
			offset: 0
		});
		expect(rpc).toHaveBeenCalledWith('search_listings_v2', {
			search_query: 'oud',
			filter_audience: 'unisex',
			filter_segments: ['niche'],
			filter_deal_mode: 'swap',
			filter_city: 'Sofia',
			min_price_minor: 1000,
			max_price_minor: 5000,
			page_size: 13,
			sort_mode: 'newest',
			cursor_activated_at: '2026-07-22T10:00:00.000Z',
			cursor_id: uuid
		});
		expect(result.totalIsExact).toBe(false);
	});

	it('supplies the trigger placeholder on insert and never sends it during an update', async () => {
		const listingId = '22222222-2222-4222-8222-222222222222';
		const brandId = '33333333-3333-4333-8333-333333333333';
		const now = '2026-07-22T10:00:00.000Z';
		const row: ListingJoinedRow = {
			id: listingId,
			slug: 'example-fragrance-2222222222',
			seller_id: uuid,
			kind: 'offer',
			deal_mode: 'sale',
			product_format: 'retail_bottle',
			audience: 'unisex',
			segments: ['niche'],
			brand_id: brandId,
			brand_input_text: null,
			brand_normalized_key: null,
			suggested_brand_id: null,
			catalog_provenance: {},
			fragrance_id: null,
			fragrance_name: 'Example Fragrance',
			concentration: 'EDP',
			concentration_label: null,
			fragrantica_url: null,
			title: 'Example fragrance bottle',
			description: 'A test listing.',
			city: 'Sofia',
			bottle_volume_ml: 100,
			remaining_ml: 90,
			is_sealed: false,
			price_minor: 5000,
			estimated_value_minor: null,
			max_budget_minor: null,
			status: 'draft',
			activated_at: null,
			expires_at: null,
			completed_at: null,
			created_at: now,
			updated_at: now,
			brand: { id: brandId, canonical_name: 'Example Brand', slug: 'example-brand' },
			seller: {
				id: uuid,
				username: 'seller',
				avatar_path: null,
				account_kind: 'private',
				is_merchant_verified: false
			},
			photos: [],
			authenticity: null
		};
		const input = listingDraftInputSchema.parse({
			kind: 'offer',
			dealMode: 'sale',
			productFormat: 'retail_bottle',
			audience: 'unisex',
			segments: ['niche'],
			brandId,
			fragranceId: null,
			fragranceName: 'Example Fragrance',
			concentration: 'EDP',
			concentrationLabel: null,
			referenceUrl: null,
			title: 'Example fragrance bottle',
			description: 'A test listing.',
			city: 'Sofia',
			bottleVolumeMl: 100,
			remainingMl: 90,
			isSealed: false,
			priceMinor: 5000,
			estimatedValueMinor: null,
			maxBudgetMinor: null
		});

		const single = vi.fn(async () => ({ data: row, error: null }));
		const insert = vi.fn((_payload: unknown) => ({
			select: vi.fn(() => ({ single }))
		}));
		const updateChain = {
			eq: vi.fn(),
			in: vi.fn(),
			select: vi.fn(() => ({ single }))
		};
		updateChain.eq.mockReturnValue(updateChain);
		updateChain.in.mockReturnValue(updateChain);
		const update = vi.fn((_payload: unknown) => updateChain);
		const client = {
			from: vi.fn((table: string) =>
				table === 'favorites'
					? {
							select: vi.fn(() => ({
								in: vi.fn(async () => ({ data: [], error: null }))
							}))
						}
					: { insert, update }
			)
		} as unknown as MarketplaceSupabaseClient;

		await createListingDraft(client, uuid, input);
		await updateListingDraft(client, uuid, { listingId, patch: input });

		expect(insert).toHaveBeenCalledWith(expect.objectContaining({ slug: 'server-managed' }));
		const updatePayload = update.mock.calls[0]?.[0];
		expect(updatePayload).not.toHaveProperty('slug');
		expect(updatePayload).not.toHaveProperty('seller_id');
		expect(updatePayload).not.toHaveProperty('status');
	});

	it('uses paginated alias-aware catalog search for non-empty queries', async () => {
		const rpc = vi.fn(async () => ({ data: [], error: null }));
		const client = { rpc } as unknown as MarketplaceSupabaseClient;
		await searchCatalog(client, { query: 'ysl', limit: 10, offset: 0 });
		expect(rpc).toHaveBeenCalledWith('search_catalog_v2', {
			search_query: 'ysl',
			page_size: 10,
			page_offset: 0
		});
	});

	it('validates dispute detail and delegates the atomic transition to one RPC', async () => {
		expect(openDealDisputeInputSchema.safeParse({ dealId: uuid, details: 'too short' }).success).toBe(false);
		const rpc = vi.fn(async () => ({
			data: [{ deal_id: uuid, report_id: '22222222-2222-4222-8222-222222222222' }],
			error: null
		}));
		const result = await openDealDispute(
			{ rpc } as unknown as MarketplaceSupabaseClient,
			{ dealId: uuid, details: 'The parcel contents differ from the accepted offer.' }
		);
		expect(rpc).toHaveBeenCalledTimes(1);
		expect(result.reportId).toBe('22222222-2222-4222-8222-222222222222');
	});
});

describe('listing draft parsing boundary', () => {
	const baseDraft = {
		kind: 'wanted' as const,
		dealMode: 'sale' as const,
		productFormat: null,
		audience: 'unisex' as const,
		segments: ['niche' as const],
		brandId: uuid,
		fragranceId: null,
		fragranceName: 'Wanted fragrance',
		concentration: 'EDP' as const,
		concentrationLabel: null,
		referenceUrl: null,
		title: 'Wanted fragrance listing',
		description: '',
		city: 'Sofia',
		bottleVolumeMl: null,
		remainingMl: null,
		isSealed: false,
		priceMinor: null,
		estimatedValueMinor: null,
		maxBudgetMinor: null
	};

	it('allows a wanted listing without a budget and rejects physical item state', () => {
		expect(listingDraftInputSchema.safeParse(baseDraft).success).toBe(true);
		expect(listingDraftInputSchema.safeParse({
			...baseDraft,
			productFormat: 'retail_bottle',
			bottleVolumeMl: 100
		}).success).toBe(false);
	});

	it('accepts only 0.1 ml precision for offer volumes', () => {
		const offer = {
			...baseDraft,
			kind: 'offer' as const,
			productFormat: 'retail_bottle' as const,
			bottleVolumeMl: 100,
			remainingMl: 90,
			priceMinor: 5000
		};
		expect(listingDraftInputSchema.safeParse(offer).success).toBe(true);
		expect(listingDraftInputSchema.safeParse({ ...offer, remainingMl: 89.95 }).success).toBe(
			false
		);
	});
});
