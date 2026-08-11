import { describe, expect, it, vi } from 'vitest';
import {
	runStagingTurnstileEvidence,
	validateHostedStagingTurnstileOrigin
} from '../../scripts/verify-staging-turnstile.mjs';

const expectedOrigin =
	'https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev';
const expectedGitSha = 'a'.repeat(40);
const dummyToken = 'XXXX.DUMMY.TOKEN.XXXX';
const syntheticEmail = 'a7-turnstile-evidence@example.invalid';
const syntheticPassword = 'Synthetic-A7-Evidence-Password';

function actionFailure(message: string): string {
	return JSON.stringify({
		type: 'failure',
		status: 400,
		data: JSON.stringify([
			{ success: 1, email: 2, message: 3 },
			false,
			syntheticEmail,
			message
		])
	});
}

function stagingFetch(
	options: { disableSignup?: boolean; keepTestingAtTurnstile?: boolean } = {}
): typeof fetch {
	return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : input);
		const headers = new Headers(init?.headers);

		if (url.pathname === '/auth/v1/settings') {
			expect(headers.get('apikey')).toBe('public-staging-key');
			return new Response(JSON.stringify({ disable_signup: options.disableSignup ?? true }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}

		expect(url.origin).toBe('http://127.0.0.1:54321');
		expect(headers.get('accept')).toBe('application/json');
		expect(headers.get('origin')).toBe('http://127.0.0.1:54321');
		expect(headers.get('referer')).toBe('http://127.0.0.1:54321/login');
		expect(headers.get('x-sveltekit-action')).toBe('true');

		const formData = new URLSearchParams(String(init?.body ?? ''));
		const token = formData.get('cf-turnstile-response');
		const action = url.search === '?/login' ? 'login' : 'register';
		const message = token && !options.keepTestingAtTurnstile
			? action === 'login'
				? 'invalid credentials'
				: 'public signup disabled'
			: `${action} turnstile rejection`;

		return new Response(actionFailure(message), {
			status: 200,
			headers: {
				'content-type': 'application/json',
				'x-deployed-git-sha': expectedGitSha,
				'x-request-id': `${action}-${token ? 'testing' : 'missing'}`
			}
		});
	}) as unknown as typeof fetch;
}

describe('A7 staging Turnstile evidence', () => {
	it('uses direct SvelteKit actions to prove missing-token rejection and downstream testing-token branches', async () => {
		const logger = { log: vi.fn(), warn: vi.fn() };

		await expect(
			runStagingTurnstileEvidence({
				origin: 'http://127.0.0.1:54321',
				expectedGitSha,
				supabaseSettingsUrl: 'https://staging.supabase.co/auth/v1/settings',
				supabasePublishableKey: 'public-staging-key',
				fetchImpl: stagingFetch(),
				logger
			})
		).resolves.toEqual([
			{ check: 'supabase-signup-disabled', status: 200 },
			{ check: 'login-missing-token', actionStatus: 400 },
			{ check: 'login-testing-token', actionStatus: 400 },
			{ check: 'register-missing-token', actionStatus: 400 },
			{ check: 'register-testing-token', actionStatus: 400 }
		]);

		const output = JSON.stringify(logger.log.mock.calls);
		expect(output).not.toContain(dummyToken);
		expect(output).not.toContain(syntheticEmail);
		expect(output).not.toContain(syntheticPassword);
	});

	it('fails when the official testing token remains in the Turnstile rejection branch', async () => {
		await expect(
			runStagingTurnstileEvidence({
				origin: 'http://127.0.0.1:54321',
				expectedGitSha,
				supabaseSettingsUrl: 'https://staging.supabase.co/auth/v1/settings',
				supabasePublishableKey: 'public-staging-key',
				fetchImpl: stagingFetch({ keepTestingAtTurnstile: true }),
				logger: { log() {}, warn() {} }
			})
		).rejects.toThrow('official testing token did not reach the downstream Auth branch');
	});

	it('stops before registration evidence unless hosted public signup is disabled', async () => {
		const fetchImpl = stagingFetch({ disableSignup: false });
		await expect(
			runStagingTurnstileEvidence({
				origin: 'http://127.0.0.1:54321',
				expectedGitSha,
				supabaseSettingsUrl: 'https://staging.supabase.co/auth/v1/settings',
				supabasePublishableKey: 'public-staging-key',
				fetchImpl,
				logger: { log() {}, warn() {} }
			})
		).rejects.toThrow('Public Supabase signup must remain disabled');
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it('rejects an inexact Git ref before making a hosted request', async () => {
		const fetchImpl = vi.fn() as unknown as typeof fetch;
		await expect(
			runStagingTurnstileEvidence({
				origin: 'http://127.0.0.1:54321',
				expectedGitSha: 'main',
				supabaseSettingsUrl: 'https://staging.supabase.co/auth/v1/settings',
				supabasePublishableKey: 'public-staging-key',
				fetchImpl
			})
		).rejects.toThrow('EXPECTED_GIT_SHA');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('allows the CLI to target only the exact canonical staging Worker', () => {
		expect(validateHostedStagingTurnstileOrigin(expectedOrigin)).toBe(expectedOrigin);
		expect(() => validateHostedStagingTurnstileOrigin('https://example.com')).toThrow(
			'unexpected host'
		);
		expect(() => validateHostedStagingTurnstileOrigin(`${expectedOrigin}/login`)).toThrow(
			'cannot contain'
		);
	});
});
