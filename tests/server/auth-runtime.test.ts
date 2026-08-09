import type { SupabaseClient, User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { handleError } from '../../src/hooks.server';
import { loadRequestAuthContext } from '../../src/lib/server/auth/context';
import {
	requireBetaAccess,
	requireMfa,
	requireRole,
	routeAccessPolicy
} from '../../src/lib/server/auth/guards';
import { safeRedirectPath } from '../../src/lib/server/auth/redirect';
import { verifyTurnstile } from '../../src/lib/server/auth/turnstile';
import type { RequestAuthContext } from '../../src/lib/server/auth/types';
import {
	getRuntimeConfiguration,
	RuntimeConfigurationError
} from '../../src/lib/server/env';
import { UnexpectedServiceError } from '../../src/lib/server/services/action';

const activeContext: RequestAuthContext = {
	user: { id: 'user-1' } as User,
	profile: {
		id: 'user-1',
		username: 'scent_archive',
		city: 'Sofia',
		bio: null,
		avatarPath: null,
		accountKind: 'private',
		role: 'user',
		emailVerifiedAt: '2026-07-22T10:00:00Z',
		phoneVerifiedAt: null,
		merchantVerifiedAt: null,
		isSuspended: false
	},
	betaAccess: {
		profileId: 'user-1',
		status: 'active',
		onboardingCompletedAt: '2026-07-22T10:00:00Z',
		activatedAt: '2026-07-22T10:00:00Z',
		expiresAt: null,
		hasCurrentConsents: true,
		isActive: true
	},
	currentAal: 'aal1',
	nextAal: 'aal2'
};

describe('private beta route policy', () => {
	it('defaults every unclassified route to active beta access', () => {
		expect(routeAccessPolicy('/')).toBe('beta');
		expect(routeAccessPolicy('/listings')).toBe('beta');
		expect(routeAccessPolicy('/profile/scent_archive')).toBe('beta');
	});

	it('keeps only explicit public and technical endpoints public', () => {
		for (const pathname of [
			'/login',
			'/auth/confirm',
			'/legal/privacy',
			'/safety',
			'/robots.txt',
			'/sitemap.xml'
		]) {
			expect(routeAccessPolicy(pathname)).toBe('public');
		}
	});

	it('separates onboarding from active membership and staff from ordinary marketplace routes', () => {
		expect(routeAccessPolicy('/onboarding')).toBe('authenticated');
		expect(routeAccessPolicy('/admin/reports')).toBe('staff');
	});
});

describe('authorization guards', () => {
	it('accepts only a complete server-authorized beta context', () => {
		expect(requireBetaAccess(activeContext, new URL('https://market.example/listings')).user.id).toBe(
			'user-1'
		);
		expect(() =>
			requireBetaAccess(
				{ ...activeContext, betaAccess: { ...activeContext.betaAccess!, isActive: false } },
				new URL('https://market.example/listings')
			)
		).toThrow();
	});

	it('requires both an allowed staff role and AAL2', () => {
		expect(() => requireRole(activeContext, new URL('https://market.example/admin'), ['admin'])).toThrow();
		expect(() => requireMfa(activeContext, new URL('https://market.example/admin'))).toThrow();

		const admin = {
			...activeContext,
			profile: { ...activeContext.profile!, role: 'admin' as const },
			currentAal: 'aal2' as const
		};
		expect(requireRole(admin, new URL('https://market.example/admin'), ['admin']).profile.role).toBe(
			'admin'
		);
		expect(() => requireMfa(admin, new URL('https://market.example/admin'))).not.toThrow();
	});
});

describe('request auth context projection', () => {
	it('reads privileged role and verification fields only from the access RPC', async () => {
		let selectedColumns = '';
		const client = {
			auth: {
				getUser: vi.fn(async () => ({
					data: { user: { id: 'user-1', email: 'member@example.bg' } },
					error: null
				})),
				mfa: {
					getAuthenticatorAssuranceLevel: vi.fn(async () => ({
						data: { currentLevel: 'aal1', nextLevel: 'aal2' },
						error: null
					}))
				}
			},
			from: vi.fn(() => ({
				select: (columns: string) => {
					selectedColumns = columns;
					return {
						eq: () => ({
							maybeSingle: async () => ({
								data: {
									id: 'user-1',
									username: 'public_name',
									city: 'Sofia',
									bio: null,
									avatar_path: null,
									account_kind: 'private',
									// These values must never be selected/trusted from the public profile row.
									role: 'user',
									phone_verified_at: null
								},
								error: null
							})
						})
					};
				}
			})),
			rpc: vi.fn(async () => ({
				data: [
					{
						profile_id: 'user-1',
						membership_status: 'active',
						onboarding_completed_at: '2026-07-22T10:00:00Z',
						membership_expires_at: null,
						email_verified_at: '2026-07-22T09:00:00Z',
						phone_verified_at: '2026-07-22T09:30:00Z',
						merchant_verified_at: '2026-07-22T09:45:00Z',
						role: 'admin',
						is_suspended: false,
						username: 'authoritative_name',
						account_kind: 'merchant',
						has_current_consents: true,
						is_active: true
					}
				],
				error: null
			}))
		} as unknown as SupabaseClient;

		const context = await loadRequestAuthContext(client);
		expect(selectedColumns).toBe('id, username, city, bio, avatar_path, account_kind');
		expect(selectedColumns).not.toMatch(/role|verified|suspended/);
		expect(context.profile).toMatchObject({
			username: 'authoritative_name',
			accountKind: 'merchant',
			role: 'admin',
			phoneVerifiedAt: '2026-07-22T09:30:00Z',
			merchantVerifiedAt: '2026-07-22T09:45:00Z',
			isSuspended: false
		});
	});
});

describe('safe redirects and runtime mode', () => {
	it('allows only same-origin absolute paths', () => {
		expect(safeRedirectPath('/listings?q=rose')).toBe('/listings?q=rose');
		expect(safeRedirectPath('//evil.example/path', '/')).toBe('/');
		expect(safeRedirectPath('https://evil.example/path', '/')).toBe('/');
		expect(safeRedirectPath('/\\evil.example/path', '/')).toBe('/');
	});

	it('enables demo only for the exact explicit value', () => {
		expect(getRuntimeConfiguration({ PUBLIC_DEMO_MODE: 'true' }).mode).toBe('demo');
		for (const value of ['1', 'true ', ' true', 'false ', ' false', 'TRUE', 'FALSE', 'yes', '']) {
			expect(() => getRuntimeConfiguration({ PUBLIC_DEMO_MODE: value })).toThrow(
				RuntimeConfigurationError
			);
		}
	});

	it('requires Supabase values in production mode', () => {
		const runtime = getRuntimeConfiguration({
			APP_ENV: 'staging',
			PUBLIC_DEMO_MODE: 'false',
			PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
			PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
			PUBLIC_SUPABASE_ANON_KEY: 'legacy-anon-key',
			SUPABASE_SECRET_KEY: 'server-secret',
			IMAGE_PROCESSOR_MODE: 'cloudflare-images'
		});
		expect(runtime.mode).toBe('production');
		if (runtime.mode === 'production') {
			expect(runtime.appEnvironment).toBe('staging');
			expect(runtime.publicSupabaseKey).toBe('publishable-key');
			expect(runtime.supabaseSecretKey).toBe('server-secret');
			expect(runtime.imageProcessorMode).toBe('cloudflare-images');
		}
	});

	it('defaults APP_ENV to development and rejects unknown deployment environments', () => {
		expect(
			getRuntimeConfiguration({
				PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
				PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key'
			}).appEnvironment
		).toBe('development');
		expect(() =>
			getRuntimeConfiguration({
				APP_ENV: 'preview',
				PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
				PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key'
			})
		).toThrow(RuntimeConfigurationError);
	});

	it('supports legacy keys only as explicit fallbacks and keeps processing disabled by default', () => {
		const runtime = getRuntimeConfiguration({
			PUBLIC_DEMO_MODE: 'false',
			PUBLIC_SUPABASE_URL: 'https://legacy.supabase.co',
			PUBLIC_SUPABASE_ANON_KEY: 'legacy-anon-key',
			SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-key'
		});
		expect(runtime).toMatchObject({
			mode: 'production',
			publicSupabaseKey: 'legacy-anon-key',
			supabaseSecretKey: 'legacy-service-key',
			imageProcessorMode: 'disabled'
		});
	});

	it('rejects unknown trusted image processor modes', () => {
		expect(() =>
			getRuntimeConfiguration({
				PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
				PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
				IMAGE_PROCESSOR_MODE: 'unsafe-pass-through'
			})
		).toThrow(RuntimeConfigurationError);
	});

	it('allows local HTTP origins but rejects other insecure or credentialed URLs', () => {
		expect(
			getRuntimeConfiguration({
				PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
				PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'local-key'
			}).mode
		).toBe('production');
		expect(() =>
			getRuntimeConfiguration({
				PUBLIC_SUPABASE_URL: 'ftp://localhost/project',
				PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'key'
			})
		).toThrow(RuntimeConfigurationError);
		expect(() =>
			getRuntimeConfiguration({
				PUBLIC_SUPABASE_URL: 'https://user:password@project.supabase.co',
				PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'key'
			})
		).toThrow(RuntimeConfigurationError);
	});
});

describe('global request error logging', () => {
	it('records sanitized request metadata and preserves the request ID', () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = handleError({
			error: new UnexpectedServiceError(
				'listings.search',
				new Error('database password must never be logged')
			),
			event: {
				locals: { requestId: 'request-123' },
				route: { id: '/listings' },
				request: new Request('https://market.example/listings'),
				url: new URL('https://market.example/listings')
			},
			status: 500,
			message: 'Internal Error'
		} as never);

		expect(result).toMatchObject({ requestId: 'request-123' });
		const logged = String(consoleError.mock.calls[0]?.[0]);
		expect(JSON.parse(logged)).toMatchObject({
			event: 'request_unexpected_failure',
			requestId: 'request-123',
			routeId: '/listings',
			method: 'GET',
			path: '/listings',
			status: 500,
			errorType: 'Error',
			operation: 'listings.search'
		});
		expect(logged).not.toContain('database password');
		consoleError.mockRestore();
	});
});

describe('Turnstile verification', () => {
	it('checks the server response action and hostname', async () => {
		const fetcher = vi.fn(async () =>
			new Response(
				JSON.stringify({ success: true, action: 'login', hostname: 'market.example' }),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		) as unknown as typeof fetch;

		await expect(
			verifyTurnstile({
				token: 'verified-token',
				secretKey: 'secret',
				expectedAction: 'login',
				expectedHostname: 'market.example',
				fetch: fetcher
			})
		).resolves.toEqual({ success: true });
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it('fails closed for absent configuration and mismatched actions', async () => {
		await expect(verifyTurnstile({ token: '', secretKey: '' })).resolves.toMatchObject({
			success: false,
			reason: 'not_configured'
		});
		await expect(verifyTurnstile({ token: 'token', secretKey: '' })).resolves.toMatchObject({
			success: false,
			reason: 'not_configured'
		});

		const fetcher = vi.fn(async () =>
			new Response(JSON.stringify({ success: true, action: 'other' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		) as unknown as typeof fetch;
		await expect(
			verifyTurnstile({
				token: 'token',
				secretKey: 'secret',
				expectedAction: 'login',
				fetch: fetcher
			})
		).resolves.toMatchObject({ success: false, reason: 'rejected' });
	});

	it.each(['expired', 'replayed'])('rejects a %s single-use token', async () => {
		const fetcher = vi.fn(async () =>
			new Response(
				JSON.stringify({
					success: false,
					action: 'login',
					hostname: 'market.example',
					'error-codes': ['timeout-or-duplicate']
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		) as unknown as typeof fetch;

		await expect(
			verifyTurnstile({
				token: 'single-use-token',
				secretKey: 'secret',
				expectedAction: 'login',
				expectedHostname: 'market.example',
				fetch: fetcher
			})
		).resolves.toEqual({
			success: false,
			reason: 'rejected',
			errorCodes: ['timeout-or-duplicate']
		});
	});
});
