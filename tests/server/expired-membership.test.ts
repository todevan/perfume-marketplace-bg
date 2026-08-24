import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadRequestAuthContext } from '../../src/lib/server/auth/context';
import { enforceRoutePolicy } from '../../src/lib/server/auth/guards';
import { actions as onboardingActions, load as loadOnboarding } from '../../src/routes/onboarding/+page.server';

function expiredAccessClient() {
	return {
		auth: {
			getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
			mfa: {
				getAuthenticatorAssuranceLevel: vi.fn(async () => ({
					data: { currentLevel: 'aal2', nextLevel: 'aal2' },
					error: null
				}))
			}
		},
		from: vi.fn(() => ({
			select: () => ({
				eq: () => ({
					maybeSingle: async () => ({
						data: {
							id: 'user-1',
							username: 'expired_member',
							city: 'Sofia',
							bio: null,
							avatar_path: null,
							account_kind: 'private'
						},
						error: null
					})
				})
			})
		})),
		rpc: vi.fn(async () => ({
			data: [
				{
					profile_id: 'user-1',
					membership_status: 'expired',
					onboarding_completed_at: '2026-07-22T10:00:00Z',
					membership_expires_at: '2026-08-01T00:00:00Z',
					email_verified_at: '2026-07-22T09:00:00Z',
					role: 'admin',
					is_suspended: false,
					username: 'expired_member',
					account_kind: 'private',
					has_current_consents: false,
					is_active: false
				}
			],
			error: null
		}))
	} as unknown as SupabaseClient;
}

function expiredOnboardingLocals() {
	return {
		runtime: { mode: 'production' },
		user: { id: 'user-1' },
		profile: {
			id: 'user-1',
			username: 'expired_member',
			city: 'Sofia',
			emailVerifiedAt: '2026-07-22T09:00:00Z',
			isSuspended: false
		},
		betaAccess: {
			status: 'expired',
			onboardingCompletedAt: '2026-07-22T10:00:00Z',
			expiresAt: '2026-08-01T00:00:00Z',
			hasCurrentConsents: false,
			isActive: false
		},
		supabase: {
			from: vi.fn(),
			rpc: vi.fn()
		}
	} as any;
}

describe('expired membership authorization', () => {
	it('preserves the expired database status and denies beta and staff routes', async () => {
		const context = await loadRequestAuthContext(expiredAccessClient());

		expect(context.betaAccess?.status).toBe('expired');
		for (const path of ['/listings', '/admin/reports']) {
			try {
				enforceRoutePolicy(context, new URL(`https://market.example${path}`));
				expect.unreachable(`expired membership must not access ${path}`);
			} catch (reason) {
				expect(reason).toMatchObject({ status: 403 });
			}
		}
	});

	it('denies onboarding load and action without classifying expiry as re-consent', async () => {
		const appLocals = expiredOnboardingLocals();

		await expect(
			loadOnboarding({
				url: new URL('https://market.example/onboarding?next=%2Flistings'),
				locals: appLocals
			} as any)
		).rejects.toMatchObject({ status: 403 });

		const url = new URL('https://market.example/onboarding');
		const result = await onboardingActions.default({
			url,
			locals: appLocals,
			request: new Request(url, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ consent_beta_terms: 'on' })
			})
		} as any);

		expect(result).toMatchObject({ status: 403 });
		expect(appLocals.supabase.from).not.toHaveBeenCalled();
		expect(appLocals.supabase.rpc).not.toHaveBeenCalled();
	});
});
