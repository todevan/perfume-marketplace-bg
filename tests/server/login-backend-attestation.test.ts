import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductionRuntimeConfiguration } from '../../src/lib/server/env';

const backendHealth = vi.hoisted(() => ({
	attestHostedBackendBaseline: vi.fn()
}));

vi.mock('$lib/server/services/backend-health', () => backendHealth);

import { actions, load } from '../../src/routes/login/+page.server';

const stagingRuntime: ProductionRuntimeConfiguration = {
	mode: 'production',
	demoMode: false,
	appEnvironment: 'staging',
	publicSupabaseUrl: 'https://nuhkpqjjyuygiemrxbdp.supabase.co',
	publicSupabaseKey: 'browser-publishable-key',
	publicSupabaseAnonKey: 'browser-publishable-key',
	supabaseSecretKey: 'server-secret-key',
	imageProcessorMode: 'disabled',
	turnstileExpectedHostname: 'market.example'
};

const verificationRuntime: ProductionRuntimeConfiguration = {
	...stagingRuntime,
	appEnvironment: 'verification',
	publicSupabaseUrl: 'https://msxlgyocdbtxmwowduhk.supabase.co'
};

function loadEvent(runtime: App.Locals['runtime']) {
	return {
		url: new URL('https://market.example/login?next=%2Fdashboard'),
		locals: {
			runtime,
			user: null,
			profile: null,
			betaAccess: null
		}
	} as Parameters<Exclude<typeof load, undefined>>[0];
}

describe('login backend attestation boundary', () => {
	beforeEach(() => {
		backendHealth.attestHostedBackendBaseline.mockReset();
		backendHealth.attestHostedBackendBaseline.mockResolvedValue(undefined);
	});

	it('attests the exact server-only staging configuration before rendering login', async () => {
		const result = await load(loadEvent(stagingRuntime));

		expect(backendHealth.attestHostedBackendBaseline).toHaveBeenCalledOnce();
		expect(backendHealth.attestHostedBackendBaseline).toHaveBeenCalledWith({
			appEnvironment: 'staging',
			publicSupabaseUrl: 'https://nuhkpqjjyuygiemrxbdp.supabase.co',
			supabaseSecretKey: 'server-secret-key'
		});
		expect(result).toMatchObject({
			next: '/dashboard',
			demoMode: false,
			demoEmail: ''
		});
		expect(JSON.stringify(result)).not.toContain('server-secret-key');
	});

	it('returns a generic 503 when the staging backend cannot be attested', async () => {
		backendHealth.attestHostedBackendBaseline.mockRejectedValueOnce(
			new Error('provider payload and key must stay private')
		);

		await expect(load(loadEvent(stagingRuntime))).rejects.toMatchObject({
			status: 503,
			body: { message: 'Входът временно не е достъпен.' }
		});
	});

	it('attests the exact disposable verification backend before rendering login', async () => {
		await expect(load(loadEvent(verificationRuntime))).resolves.toMatchObject({ demoMode: false });

		expect(backendHealth.attestHostedBackendBaseline).toHaveBeenCalledOnce();
		expect(backendHealth.attestHostedBackendBaseline).toHaveBeenCalledWith({
			appEnvironment: 'verification',
			publicSupabaseUrl: 'https://msxlgyocdbtxmwowduhk.supabase.co',
			supabaseSecretKey: 'server-secret-key'
		});
	});

	it.each(['development', 'production'] as const)(
		'does not pin the %s environment to the Frankfurt staging backend',
		async (appEnvironment) => {
			const runtime: ProductionRuntimeConfiguration = {
				...stagingRuntime,
				appEnvironment,
				publicSupabaseUrl:
					appEnvironment === 'development'
						? 'http://127.0.0.1:54321'
						: 'https://future-production.supabase.co'
			};

			await expect(load(loadEvent(runtime))).resolves.toMatchObject({ demoMode: false });
			expect(backendHealth.attestHostedBackendBaseline).not.toHaveBeenCalled();
		}
	);

	it('does not run the hosted probe in explicit local demo mode', async () => {
		await expect(
			load(
				loadEvent({
					mode: 'demo',
					demoMode: true,
					appEnvironment: 'development'
				})
			)
		).resolves.toMatchObject({ demoMode: true });
		expect(backendHealth.attestHostedBackendBaseline).not.toHaveBeenCalled();
	});
});

describe('open email registration', () => {
	it('rejects a registration without a Turnstile response before account creation', async () => {
		const signUp = vi.fn();
		const formData = new FormData();
		formData.set('email', 'new.member@example.bg');
		formData.set('password', 'correct-horse-battery-staple');
		formData.set('username', 'scent_archive');
		formData.set('ageAccepted', 'on');

		const result = await actions.register({
			request: new Request('https://market.example/login?/register', {
				method: 'POST',
				body: formData
			}),
			url: new URL('https://market.example/login?/register'),
			locals: {
				runtime: {
					...stagingRuntime,
					turnstileSecretKey: 'turnstile-secret-key'
				},
				supabase: { auth: { signUp } }
			}
		} as never);

		expect(result).toMatchObject({ status: 400, data: { success: false } });
		expect(signUp).not.toHaveBeenCalled();
	});

	it('creates an email-password account and requests confirmation before onboarding', async () => {
		const signUp = vi.fn(async () => ({
			data: { user: { id: 'new-user' }, session: null },
			error: null
		}));
		const formData = new FormData();
		formData.set('email', ' New.Member@Example.BG ');
		formData.set('password', 'correct-horse-battery-staple');
		formData.set('username', 'scent_archive');
		formData.set('kind', 'merchant');
		formData.set('ageAccepted', 'on');
		formData.set('next', '/dashboard');
		formData.set('cf-turnstile-response', 'verified-registration-token');

		const eventFetch = vi.fn();
		const result = await actions.register({
			request: new Request('https://market.example/login?/register', {
				method: 'POST',
				body: formData
			}),
			url: new URL('https://market.example/login?/register'),
			fetch: eventFetch,
			locals: {
				runtime: {
					...stagingRuntime,
					publicAppUrl: 'https://market.example',
					turnstileSecretKey: 'turnstile-secret-key'
				},
				supabase: { auth: { signUp } }
			}
		} as never);

		expect(signUp).toHaveBeenCalledWith({
			email: 'new.member@example.bg',
			password: 'correct-horse-battery-staple',
			options: {
				captchaToken: 'verified-registration-token',
				emailRedirectTo: 'https://market.example/auth/confirm?next=%2Fonboarding%3Fnext%3D%252Fdashboard',
				data: { username: 'scent_archive', account_kind: 'merchant' }
			}
		});
		expect(eventFetch).not.toHaveBeenCalled();
		expect(result).toMatchObject({ success: true, email: 'new.member@example.bg' });
	});

	it('fails closed and signs out when signup unexpectedly returns an immediate session', async () => {
		const signUp = vi.fn(async () => ({
			data: { user: { id: 'new-user' }, session: { access_token: 'session' } },
			error: null
		}));
		const rpc = vi.fn(async () => ({ data: true, error: null }));
		const signOut = vi.fn(async () => ({ error: null }));
		const formData = new FormData();
		formData.set('email', 'member@example.bg');
		formData.set('password', 'correct-horse-battery-staple');
		formData.set('username', 'scent_archive');
		formData.set('kind', 'private');
		formData.set('ageAccepted', 'on');
		formData.set('next', '/dashboard');
		formData.set('cf-turnstile-response', 'verified-registration-token');

		const result = await actions.register({
			request: new Request('https://market.example/login?/register', {
				method: 'POST',
				body: formData
			}),
			url: new URL('https://market.example/login?/register'),
			fetch: vi.fn(async () =>
				new Response(JSON.stringify({ success: true, action: 'register', hostname: 'market.example' }), { status: 200 })
			),
			locals: {
				runtime: {
					...stagingRuntime,
					publicAppUrl: 'https://market.example',
					turnstileSecretKey: 'turnstile-secret-key'
				},
				supabase: { auth: { signUp, signOut }, rpc }
			}
		} as never);

		expect(result).toMatchObject({ status: 503, data: { success: false } });
		expect(rpc).not.toHaveBeenCalled();
		expect(signOut).toHaveBeenCalledOnce();
	});
});
