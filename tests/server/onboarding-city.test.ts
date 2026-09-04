import { describe, expect, it, vi } from 'vitest';
import { actions } from '../../src/routes/onboarding/+page.server';
import { REJECTED_CITY_FIXTURES } from '../fixtures/city-validation';

const MUTATING_RPCS = new Set(['accept_beta_consent', 'complete_beta_onboarding']);

function createClient() {
	return {
		from: vi.fn((table: string) => {
			if (table !== 'beta_legal_documents') throw new Error(`Unexpected table ${table}`);
			return {
				select: () => ({
					eq: () => ({
						order: async () => ({
							data: [{ document_code: 'terms', document_version: '2026-09' }],
							error: null
						})
					})
				})
			};
		}),
		rpc: vi.fn(async (_name: string, _args?: unknown) => ({ data: true, error: null }))
	};
}

function onboardingEvent(city: string, client: ReturnType<typeof createClient>) {
	const url = new URL('https://market.example/onboarding');
	return {
		request: new Request(url, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				next: '/dashboard',
				username: 'scent_archive',
				city,
				consent_terms: 'on'
			})
		}),
		url,
		locals: {
			runtime: { mode: 'production' },
			user: { id: 'user-1' },
			profile: {
				id: 'user-1',
				username: 'scent_archive',
				city: 'София',
				bio: null,
				avatarPath: null,
				accountKind: 'private',
				role: 'user',
				emailVerifiedAt: '2026-09-01T08:00:00Z',
				phoneVerifiedAt: null,
				merchantVerifiedAt: null,
				isSuspended: false
			},
			betaAccess: {
				profileId: 'user-1',
				status: 'pending',
				onboardingCompletedAt: null,
				activatedAt: null,
				expiresAt: null,
				hasCurrentConsents: false,
				isActive: false
			},
			supabase: client
		}
	} as never;
}

describe('onboarding city validation', () => {
	it.each(REJECTED_CITY_FIXTURES)(
		'rejects $name before consent or onboarding mutation',
		async ({ input }) => {
			const client = createClient();
			const result = await actions.default(onboardingEvent(input, client));

			expect(result).toMatchObject({ status: 400, data: { success: false } });
			expect(
				client.rpc.mock.calls.filter(([name]) => MUTATING_RPCS.has(String(name)))
			).toEqual([]);
		}
	);

	it('passes the normalized city to complete_beta_onboarding', async () => {
		const client = createClient();

		await expect(
			actions.default(onboardingEvent('  Стара\u00a0\u2007Загора  ', client))
		).rejects.toMatchObject({ status: 303, location: '/dashboard' });
		expect(client.rpc).toHaveBeenCalledWith('complete_beta_onboarding', {
			desired_username: 'scent_archive',
			home_city: 'Стара Загора'
		});
	});
});

