import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { Tables, Views } from '../../src/lib/server/database.types';
import {
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

	it('projects reports without evidence paths, assignment, or moderator notes', () => {
		const dto = toReportDto({
			id: 'report-id',
			reporter_id: profileRow.id,
			target_type: 'listing',
			target_id: '22222222-2222-4222-8222-222222222222',
			reason_code: 'counterfeit',
			details: null,
			evidence_paths: ['private/evidence.jpg'],
			status: 'investigating',
			assigned_to: '33333333-3333-4333-8333-333333333333',
			resolution_code: null,
			resolution_notes: 'internal note',
			resolved_at: null,
			created_at: '2026-07-20T00:00:00.000Z',
			updated_at: '2026-07-20T00:00:00.000Z'
		});
		expect(dto.evidenceCount).toBe(1);
		expect(dto).not.toHaveProperty('evidencePaths');
		expect(dto).not.toHaveProperty('assignedTo');
		expect(dto).not.toHaveProperty('resolutionNotes');
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
});
