import { describe, expect, it, vi } from 'vitest';
import { openDealDisputeInputSchema } from '../../src/lib/contracts';
import { searchCatalog } from '../../src/lib/server/repositories/catalog';
import { openDealDispute } from '../../src/lib/server/repositories/deals';
import { searchListings } from '../../src/lib/server/repositories/listings';
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
	it('uses search_listings even for an empty search query', async () => {
		const rpc = vi.fn(async () => ({ data: [], error: null }));
		const client = { rpc } as unknown as MarketplaceSupabaseClient;
		const result = await searchListings(client, {
			query: '', segments: [], sort: 'newest', limit: 12, offset: 0
		});
		expect(rpc).toHaveBeenCalledWith('search_listings', expect.objectContaining({ page_size: 13 }));
		expect(result).toMatchObject({ items: [], nextCursor: null, totalIsExact: true });
	});

	it('uses alias-aware search_catalog for non-empty catalog queries', async () => {
		const rpc = vi.fn(async () => ({ data: [], error: null }));
		const client = { rpc } as unknown as MarketplaceSupabaseClient;
		await searchCatalog(client, { query: 'ysl', limit: 10, offset: 0 });
		expect(rpc).toHaveBeenCalledWith('search_catalog', { search_query: 'ysl', page_size: 10 });
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
