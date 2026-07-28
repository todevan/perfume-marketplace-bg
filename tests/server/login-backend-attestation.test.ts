import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductionRuntimeConfiguration } from '../../src/lib/server/env';

const backendHealth = vi.hoisted(() => ({
	attestHostedBackendBaseline: vi.fn()
}));

vi.mock('$lib/server/services/backend-health', () => backendHealth);

import { load } from '../../src/routes/login/+page.server';

const stagingRuntime: ProductionRuntimeConfiguration = {
	mode: 'production',
	demoMode: false,
	appEnvironment: 'staging',
	publicSupabaseUrl: 'https://nuhkpqjjyuygiemrxbdp.supabase.co',
	publicSupabaseKey: 'browser-publishable-key',
	publicSupabaseAnonKey: 'browser-publishable-key',
	supabaseSecretKey: 'server-secret-key',
	imageProcessorMode: 'disabled'
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
