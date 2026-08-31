import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { Tables, Views } from '../../src/lib/server/database.types';
import {
	createReport as createReportRepository,
	listOwnReports,
	RepositoryError,
	toListingCardDto,
	toPublicProfileDto,
	toReportDto,
	type ListingJoinedRow,
	type MarketplaceSupabaseClient
} from '../../src/lib/server/repositories';
import {
	runAction,
	runAuthenticatedAction,
	UnexpectedServiceError,
	toActionError
} from '../../src/lib/server/services/action';

const profileRow: Tables<'profiles'> = {
	id: '11111111-1111-4111-8111-111111111111',
	username: 'public_name',
	city: 'Sofia',
	bio: 'Public bio',
	avatar_path: null,
	account_kind: 'private',
	role: 'admin',
	email_verified_at: '2026-07-20T00:00:00.000Z',
	phone_verified_at: '2026-07-20T00:00:00.000Z',
	merchant_verified_at: null,
	is_suspended: false,
	rating_average: 4.5,
	rating_count: 4,
	completed_deals_count: 3,
	created_at: '2026-07-20T00:00:00.000Z',
	updated_at: '2026-07-20T00:00:00.000Z',
	last_seen_at: '2026-07-22T00:00:00.000Z'
};

const publicProfileRow: Views<'public_profiles'> = {
	id: profileRow.id,
	username: profileRow.username,
	city: profileRow.city,
	bio: profileRow.bio,
	avatar_path: profileRow.avatar_path,
	account_kind: profileRow.account_kind,
	is_merchant_verified: false,
	rating_average: profileRow.rating_average,
	rating_count: profileRow.rating_count,
	completed_deals_count: profileRow.completed_deals_count,
	member_since: profileRow.created_at
};

describe('DTO repository boundary', () => {
	it('projects public profiles without privileged or activity columns', () => {
		const dto = toPublicProfileDto(publicProfileRow);
		expect(dto).toMatchObject({ username: 'public_name', ratingAverage: 4.5 });
		expect(dto).not.toHaveProperty('role');
		expect(dto).not.toHaveProperty('phone_verified_at');
		expect(dto).not.toHaveProperty('phoneVerifiedAt');
		expect(dto).not.toHaveProperty('last_seen_at');
	});

	it('fails closed for missing profile identity while defaulting non-trust aggregates safely', () => {
		expect(() => toPublicProfileDto({ ...publicProfileRow, username: null })).toThrowError(
			RepositoryError
		);

		const dto = toPublicProfileDto({
			...publicProfileRow,
			is_merchant_verified: null,
			rating_average: null,
			rating_count: null,
			completed_deals_count: null
		});
		expect(dto).toMatchObject({
			merchantVerified: false,
			ratingAverage: 0,
			ratingCount: 0,
			completedDealsCount: 0
		});
	});

	it('projects only the reporter-safe RPC fields and generic outcome', () => {
		const dto = toReportDto({
			report_id: '22222222-2222-4222-8222-222222222222',
			target_type: 'listing',
			reason_code: 'counterfeit',
			evidence_count: 1,
			status: 'investigating',
			outcome: 'pending',
			resolved_at: null,
			created_at: '2026-07-20T00:00:00.000Z',
			updated_at: '2026-07-20T00:00:00.000Z'
		} as never);
		expect(dto.evidenceCount).toBe(1);
		expect(dto).toMatchObject({ outcome: 'pending' });
		expect(dto).not.toHaveProperty('targetId');
		expect(dto).not.toHaveProperty('details');
		expect(dto).not.toHaveProperty('assignedTo');
		expect(dto).not.toHaveProperty('resolutionCode');
		expect(dto).not.toHaveProperty('resolutionNotes');
	});

	it('lists own reports through the safe RPC without a reports table read', async () => {
		const rpc = vi.fn(async () => ({
			data: [{
				report_id: '22222222-2222-4222-8222-222222222222',
				target_type: 'listing',
				reason_code: 'counterfeit_suspected',
				evidence_count: 1,
				status: 'open',
				outcome: 'pending',
				resolved_at: null,
				created_at: '2026-07-20T00:00:00.000Z',
				updated_at: '2026-07-20T00:00:00.000Z',
				total_count: 1
			}],
			error: null
		}));
		const from = vi.fn();
		const result = await listOwnReports(
			{ rpc, from } as unknown as MarketplaceSupabaseClient,
			profileRow.id,
			{ limit: 10, offset: 0 }
		);

		expect(result.items).toHaveLength(1);
		expect(rpc).toHaveBeenCalledWith('list_my_reports', {
			p_page_size: 10,
			p_page_offset: 0,
			p_status: null
		});
		expect(from).not.toHaveBeenCalled();
	});

	it('paginates the complete status-filtered report history without duplicates or gaps', async () => {
		const mixedRows = [
			['30000000-0000-4000-8000-000000000001', 'open'],
			['30000000-0000-4000-8000-000000000002', 'resolved'],
			['30000000-0000-4000-8000-000000000003', 'open'],
			['30000000-0000-4000-8000-000000000004', 'resolved'],
			['30000000-0000-4000-8000-000000000005', 'open'],
			['30000000-0000-4000-8000-000000000006', 'resolved']
		] as const;
		const row = ([report_id, status]: (typeof mixedRows)[number]) => ({
			report_id,
			target_type: 'listing' as const,
			reason_code: 'counterfeit_suspected',
			evidence_count: 0,
			status,
			outcome: status === 'resolved' ? 'completed' : 'pending',
			resolved_at: status === 'resolved' ? '2026-07-20T01:00:00.000Z' : null,
			created_at: '2026-07-20T00:00:00.000Z',
			updated_at: '2026-07-20T01:00:00.000Z',
			total_count: 3
		});
		const rpc = vi.fn(async (_name: string, args: { p_page_offset: number; p_page_size: number; p_status?: string }) => {
			const source = args.p_status === 'resolved'
				? mixedRows.filter(([, status]) => status === 'resolved')
				: mixedRows;
			return {
				data: source.slice(args.p_page_offset, args.p_page_offset + args.p_page_size).map(row),
				error: null
			};
		});
		const client = { rpc, from: vi.fn() } as unknown as MarketplaceSupabaseClient;

		const first = await listOwnReports(client, profileRow.id, {
			limit: 2,
			offset: 0,
			status: 'resolved'
		});
		const second = await listOwnReports(client, profileRow.id, {
			limit: 2,
			offset: 2,
			status: 'resolved'
		});

		expect(first).toMatchObject({ total: 3, hasMore: true, limit: 2, offset: 0 });
		expect(second).toMatchObject({ total: 3, hasMore: false, limit: 2, offset: 2 });
		expect([...first.items, ...second.items].map((report) => report.id)).toEqual([
			'30000000-0000-4000-8000-000000000002',
			'30000000-0000-4000-8000-000000000004',
			'30000000-0000-4000-8000-000000000006'
		]);
		expect([...first.items, ...second.items].every((report) => report.status === 'resolved')).toBe(true);
		expect(rpc).toHaveBeenNthCalledWith(1, 'list_my_reports', {
			p_page_size: 2,
			p_page_offset: 0,
			p_status: 'resolved'
		});
		expect(rpc).toHaveBeenNthCalledWith(2, 'list_my_reports', {
			p_page_size: 2,
			p_page_offset: 2,
			p_status: 'resolved'
		});
	});

	it('creates a report receipt without INSERT RETURNING or a direct report SELECT', async () => {
		const select = vi.fn();
		const insert = vi.fn(async () => ({ data: null, error: null }));
		const from = vi.fn(() => ({ insert, select }));
		const result = await createReportRepository(
			{ from } as unknown as MarketplaceSupabaseClient,
			profileRow.id,
			{
				targetType: 'listing',
				targetId: '22222222-2222-4222-8222-222222222222',
				reasonCode: 'counterfeit_suspected',
				details: 'Visible evidence supports this report.',
				evidencePaths: ['private/evidence.jpg']
			}
		);

		expect(result).toMatchObject({
			targetType: 'listing',
			reasonCode: 'counterfeit_suspected',
			evidenceCount: 1,
			status: 'open',
			outcome: 'pending'
		});
		expect(insert).toHaveBeenCalledWith(expect.objectContaining({
			id: expect.any(String),
			reporter_id: profileRow.id,
			status: 'open'
		}));
		expect(select).not.toHaveBeenCalled();
	});

	it('projects the immutable persisted listing slug instead of regenerating it from title', () => {
		const row = {
			id: '22222222-2222-4222-8222-222222222222',
			slug: 'persisted-marketplace-slug-2222222222',
			title: 'A title that can change while the slug stays stable',
			kind: 'offer', deal_mode: 'sale', concentration: 'EDP', city: 'Sofia',
			fragrance_name: 'Example', price_minor: 5000, max_budget_minor: null,
			bottle_volume_ml: 100, remaining_ml: 90, is_sealed: false, status: 'active',
			created_at: '2026-07-20T00:00:00.000Z',
			brand: { id: '33333333-3333-4333-8333-333333333333', canonical_name: 'Brand', slug: 'brand' },
			seller: { id: profileRow.id, username: profileRow.username, avatar_path: null, account_kind: 'private', is_merchant_verified: false },
			photos: [], authenticity: null
		} as unknown as ListingJoinedRow;
		expect(toListingCardDto(row).slug).toBe(row.slug);
	});
});

describe('service action boundary', () => {
	it('returns structured field errors instead of throwing validation errors', async () => {
		const result = await runAction(
			z.object({ rating: z.number().int().min(1).max(5) }),
			{ rating: 10 },
			async () => 'unreachable'
		);
		expect(result).toEqual({
			ok: false,
			error: expect.objectContaining({
				code: 'VALIDATION',
				fieldErrors: expect.objectContaining({ rating: expect.any(Array) })
			})
		});
	});

	it('derives the actor from the request client, not submitted input', async () => {
		const getUser = vi.fn(async () => ({
			data: { user: { id: profileRow.id } },
			error: null
		}));
		const client = { auth: { getUser } } as unknown as MarketplaceSupabaseClient;
		const handler = vi.fn(async (profileId: string, input: { value: string }) => ({ profileId, ...input }));
		const result = await runAuthenticatedAction(
			client,
			z.object({ value: z.string() }),
			{ value: 'ok', profileId: 'attacker-controlled' },
			handler
		);
		expect(result).toEqual({ ok: true, data: { profileId: profileRow.id, value: 'ok' } });
		expect(handler).toHaveBeenCalledWith(profileRow.id, { value: 'ok' });
	});

	it('maps database authorization and conflict codes consistently', () => {
		expect(toActionError(new RepositoryError('test', '42501', 'denied')).code).toBe('FORBIDDEN');
		expect(toActionError(new RepositoryError('test', '23505', 'duplicate')).code).toBe('CONFLICT');
	});

	it('surfaces unexpected failures to the global request error boundary', async () => {
		const failure = runAction(
			z.object({ value: z.string() }),
			{ value: 'ok' },
			async () => {
				throw new TypeError('sensitive backend detail');
			},
			{ operation: 'listings.search' }
		);
		await expect(failure).rejects.toBeInstanceOf(UnexpectedServiceError);
		await expect(failure).rejects.toMatchObject({
			name: 'UnexpectedServiceError',
			operation: 'listings.search',
			errorType: 'TypeError'
		});
	});
});
