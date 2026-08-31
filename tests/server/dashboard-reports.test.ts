import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
	getOwnListings: vi.fn(),
	getOwnReports: vi.fn()
}));

vi.mock('$lib/server/services', () => services);

import { load } from '../../src/routes/dashboard/+page.server';

const listings = { items: [], total: 0, limit: 10, offset: 0, hasMore: false };

function locals(): App.Locals {
	return {
		runtime: { mode: 'production' },
		supabase: {},
		profile: {
			username: 'reporter',
			city: 'Sofia',
			accountKind: 'private'
		}
	} as unknown as App.Locals;
}

describe('dashboard My reports section', () => {
	beforeEach(() => {
		services.getOwnListings.mockReset();
		services.getOwnReports.mockReset();
		services.getOwnListings.mockResolvedValue({ ok: true, data: listings });
	});

	it('loads reporter-safe receipts alongside the existing dashboard data', async () => {
		services.getOwnReports.mockResolvedValue({
			ok: true,
			data: {
				items: [{
					id: '24500000-0000-4000-8000-000000000001',
					targetType: 'listing',
					reasonCode: 'counterfeit_suspected',
					evidenceCount: 1,
					status: 'investigating',
					outcome: 'pending',
					resolvedAt: null,
					createdAt: '2026-08-30T10:00:00.000Z',
					updatedAt: '2026-08-30T10:05:00.000Z'
				}],
				total: 1,
				limit: 10,
				offset: 0,
				hasMore: false
			}
		});

		const result = await load({ locals: locals(), url: new URL('https://market.example/dashboard') } as never);
		if (!result) throw new Error('dashboard load returned no data');
		expect(result.reports).toMatchObject({ items: [expect.objectContaining({ outcome: 'pending' })] });
		expect(services.getOwnReports).toHaveBeenCalledWith(expect.anything(), { limit: 10, offset: 0 });
	});

	it('keeps listings and profile usable when only My reports fails', async () => {
		services.getOwnReports.mockResolvedValue({
			ok: false,
			error: { code: 'UNAVAILABLE', message: 'private database detail' }
		});

		const result = await load({ locals: locals(), url: new URL('https://market.example/dashboard') } as never);
		if (!result) throw new Error('dashboard load returned no data');
		expect(result.listings).toEqual(listings);
		expect(result.profile).toMatchObject({ username: 'reporter' });
		expect(result.reports).toEqual({
			items: [],
			error: 'Сигналите временно не са достъпни.'
		});
		expect(JSON.stringify(result)).not.toContain('private database detail');
	});

	it('uses the report continuation offset on the next dashboard request', async () => {
		services.getOwnReports.mockResolvedValue({
			ok: true,
			data: { items: [], total: 11, limit: 10, offset: 10, hasMore: false }
		});

		await load({
			locals: locals(),
			url: new URL('https://market.example/dashboard?reportOffset=10')
		} as never);

		expect(services.getOwnReports).toHaveBeenCalledWith(expect.anything(), {
			limit: 10,
			offset: 10
		});
	});

	it('exposes the next report continuation path when another page exists', async () => {
		services.getOwnReports.mockResolvedValue({
			ok: true,
			data: { items: [], total: 11, limit: 10, offset: 0, hasMore: true }
		});

		const result = await load({
			locals: locals(),
			url: new URL('https://market.example/dashboard')
		} as never);
		if (!result) throw new Error('dashboard load returned no data');

		expect(result.reportContinuation).toEqual({
			previousHref: null,
			nextHref: '/dashboard?reportOffset=10'
		});
	});

});
