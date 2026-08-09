import { describe, expect, it, vi } from 'vitest';
import { actions as onboardingActions, load as loadOnboarding } from '../../src/routes/onboarding/+page.server';
import { load as loadLogin } from '../../src/routes/login/+page.server';
import { actions as passwordActions } from '../../src/routes/auth/update-password/+page.server';
import { load as loadMfa } from '../../src/routes/auth/mfa/+page.server';
import { load as loadRootLayout } from '../../src/routes/+layout.server';
import { requireStaffRequest } from '../../src/routes/admin/access.server';

let currentClient: any;

vi.mock('@supabase/ssr', () => ({
	createServerClient: () => currentClient
}));

vi.mock('$lib/server/env', () => ({
	getPlatformEnvironment: () => ({}),
	getRuntimeConfiguration: () => ({
		mode: 'production',
		demoMode: false,
		appEnvironment: 'development',
		publicSupabaseUrl: 'https://project.supabase.co',
		publicSupabaseKey: 'public-key',
		publicSupabaseAnonKey: 'public-key',
		supabaseSecretKey: 'server-secret',
		imageProcessorMode: 'disabled'
	})
}));

import { handle } from '../../src/hooks.server';

type ClientOptions = {
	user?: { id: string } | null;
	role?: 'user' | 'moderator' | 'admin';
	status?: 'pending' | 'active';
	isActive?: boolean;
	onboardingCompletedAt?: string | null;
	aal?: 'aal1' | 'aal2';
};

function createClient({
	user = { id: 'user-1' },
	role = 'user',
	status = 'active',
	isActive = true,
	onboardingCompletedAt = '2026-08-01T12:00:00Z',
	aal = 'aal1'
}: ClientOptions = {}) {
	const access = {
		profile_id: user?.id ?? 'user-1',
		membership_status: status,
		onboarding_completed_at: onboardingCompletedAt,
		is_active: isActive,
		has_current_consents: true,
		role,
		username: 'scent_archive',
		account_kind: 'private',
		is_suspended: false
	};
	const profile = {
		id: user?.id ?? 'user-1',
		username: 'scent_archive',
		city: 'Sofia',
		bio: null,
		avatar_path: null,
		account_kind: 'private'
	};

	const client = {
		auth: {
			getUser: vi.fn(async () => ({ data: { user }, error: null })),
			getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
			updateUser: vi.fn(async () => ({ error: null })),
			signOut: vi.fn(async () => ({ error: null })),
			mfa: {
				getAuthenticatorAssuranceLevel: vi.fn(async () => ({
					data: { currentLevel: aal, nextLevel: aal },
					error: null
				})),
				listFactors: vi.fn(async () => ({ data: { totp: [] }, error: null }))
			}
		},
		from: vi.fn((table: string) => {
			if (table === 'profiles') {
				return {
					select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) })
				};
			}
			if (table === 'beta_legal_documents') {
				return {
					select: () => ({
						eq: () => ({
							order: async () => ({
								data: [{ document_code: 'terms', document_version: '2026-08' }],
								error: null
							})
						})
					})
				};
			}
			throw new Error(`Unexpected table ${table}`);
		}),
		rpc: vi.fn(async (name: string) => {
			if (name === 'get_my_beta_access') return { data: [access], error: null };
			if (name === 'accept_beta_consent' || name === 'complete_beta_onboarding') {
				return { data: true, error: null };
			}
			throw new Error(`Unexpected RPC ${name}`);
		})
	};

	return client;
}

function lifecycleEvent(url: URL, request = new Request(url, { method: 'GET' })) {
	return {
		route: { id: url.pathname },
		url,
		request,
		platform: {},
		cookies: { getAll: () => [], set: () => {} },
		fetch,
		setHeaders: () => {},
		locals: {}
	} as any;
}

async function runLifecycle(
	url: URL,
	resolve: (event: any) => Promise<Response>,
	request?: Request
) {
	const event = lifecycleEvent(url, request);
	const response = await handle({ event, resolve });
	return { event, response };
}

describe('auth context lifecycle regressions', () => {
	it('loads the onboarding loader with pending member profile and beta context', async () => {
		currentClient = createClient({ status: 'pending', isActive: false, onboardingCompletedAt: null });
		let loaderResult: Awaited<ReturnType<typeof loadOnboarding>> | undefined;

		await runLifecycle(new URL('https://market.example/onboarding?next=%2Fdashboard'), async (event) => {
			expect(event.locals.profile?.username).toBe('scent_archive');
			expect(event.locals.betaAccess?.status).toBe('pending');
			loaderResult = await loadOnboarding(event);
			return new Response('ok');
		});

		expect(loaderResult).toMatchObject({ next: '/dashboard', profile: { username: 'scent_archive' } });
	});

	it('loads the onboarding POST with the same pending member context', async () => {
		currentClient = createClient({ status: 'pending', isActive: false, onboardingCompletedAt: null });
		const form = new URLSearchParams({
			next: '/dashboard',
			username: 'scent_archive',
			city: 'Sofia',
			consent_terms: 'on'
		});
		const url = new URL('https://market.example/onboarding');

		await expect(
			runLifecycle(
				url,
				async (event) => {
					expect(event.locals.profile?.username).toBe('scent_archive');
					expect(event.locals.betaAccess?.status).toBe('pending');
					await onboardingActions.default(event);
					return new Response('unreachable');
				},
				new Request(url, {
					method: 'POST',
					headers: { 'content-type': 'application/x-www-form-urlencoded' },
					body: form
				})
			)
		).rejects.toMatchObject({ status: 303, location: '/dashboard' });
	});

	it('redirects an active user from login to the safe requested route', async () => {
		currentClient = createClient();
		await expect(
			runLifecycle(new URL('https://market.example/login?next=%2Fmessages'), async (event) => {
				await loadLogin(event);
				return new Response('unreachable');
			})
		).rejects.toMatchObject({ status: 303, location: '/messages' });
	});

	it('redirects an active password-reset user to the safe requested route after updating', async () => {
		currentClient = createClient();
		const url = new URL('https://market.example/auth/update-password');
		const form = new URLSearchParams({
			next: '/dashboard',
			password: 'correct-horse-battery-staple',
			passwordConfirmation: 'correct-horse-battery-staple'
		});

		await expect(
			runLifecycle(
				url,
				async (event) => {
					await passwordActions.default(event);
					return new Response('unreachable');
				},
				new Request(url, {
					method: 'POST',
					headers: { 'content-type': 'application/x-www-form-urlencoded' },
					body: form
				})
			)
		).rejects.toMatchObject({ status: 303, location: '/dashboard' });
		expect(currentClient.auth.updateUser).toHaveBeenCalledExactlyOnceWith({
			password: 'correct-horse-battery-staple'
		});
		expect(currentClient.auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'others' });
	});

	it('redirects an already-AAL2 staff user from MFA to the safe requested route', async () => {
		currentClient = createClient({ role: 'admin', aal: 'aal2' });
		await expect(
			runLifecycle(new URL('https://market.example/auth/mfa?next=%2Fadmin'), async (event) => {
				await loadMfa(event);
				return new Response('unreachable');
			})
		).rejects.toMatchObject({ status: 303, location: '/admin' });
	});

	it('projects active beta state into the public legal root layout without loading profile or AAL', async () => {
		currentClient = createClient();
		let layout: Awaited<ReturnType<typeof loadRootLayout>> | undefined;

		await runLifecycle(new URL('https://market.example/legal/privacy'), async (event) => {
			layout = loadRootLayout(event);
			return new Response('ok');
		});

		expect(layout?.auth.betaAccess?.isActive).toBe(true);
		expect(currentClient.from).not.toHaveBeenCalled();
		expect(currentClient.rpc).toHaveBeenCalledWith('get_my_beta_access');
		expect(currentClient.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
	});

	it('keeps anonymous public routes lazy', async () => {
		currentClient = createClient({ user: null });
		await runLifecycle(new URL('https://market.example/legal/privacy'), async (event) => {
			const layout = await loadRootLayout(event);
			expect(layout).toMatchObject({ auth: { user: null, betaAccess: null } });
			return new Response('ok');
		});

		expect(currentClient.auth.getUser).toHaveBeenCalledOnce();
		expect(currentClient.from).not.toHaveBeenCalled();
		expect(currentClient.rpc).not.toHaveBeenCalled();
		expect(currentClient.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
	});

	it.each(['/auth/confirm', '/auth/callback', '/robots.txt', '/sitemap.xml'])(
		'keeps the authenticated technical public endpoint %s free of optional auth data queries',
		async (pathname) => {
			currentClient = createClient();
			await runLifecycle(new URL(`https://market.example${pathname}`), async () => new Response('ok'));

			expect(currentClient.auth.getUser).toHaveBeenCalledOnce();
			expect(currentClient.from).not.toHaveBeenCalled();
			expect(currentClient.rpc).not.toHaveBeenCalled();
			expect(currentClient.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
		}
	);

	it('preserves AAL2 for the real admin route authorization consumer', async () => {
		currentClient = createClient({ role: 'admin', aal: 'aal2' });
		let actor: ReturnType<typeof requireStaffRequest>['actor'] | undefined;

		await runLifecycle(new URL('https://market.example/admin'), async (event) => {
			actor = requireStaffRequest(event.locals, event.url).actor;
			return new Response('ok');
		});

		expect(actor).toMatchObject({ id: 'user-1', role: 'admin' });
		expect(currentClient.auth.mfa.getAuthenticatorAssuranceLevel).toHaveBeenCalledOnce();
	});
});
