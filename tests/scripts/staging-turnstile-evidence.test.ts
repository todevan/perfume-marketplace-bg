import { describe, expect, it, vi } from 'vitest';
import {
	runStagingTurnstileEvidence,
	validateHostedStagingTurnstileOrigin
} from '../../scripts/verify-staging-turnstile.mjs';

const expectedOrigin =
	'https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev';
const expectedGitSha = 'a'.repeat(40);
const dummyToken = 'XXXX.DUMMY.TOKEN.XXXX';
const turnstileRejection = '\u041f\u043e\u0442\u0432\u044a\u0440\u0434\u0438, \u0447\u0435 \u043d\u0435 \u0441\u0438 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0437\u0438\u0440\u0430\u043d \u043a\u043b\u0438\u0435\u043d\u0442.';
const invalidCredentials = '\u041d\u0435\u0432\u0430\u043b\u0438\u0434\u0435\u043d \u0438\u043c\u0435\u0439\u043b \u0438\u043b\u0438 \u043f\u0430\u0440\u043e\u043b\u0430.';
const signupDisabled =
	'\u041f\u0440\u043e\u0444\u0438\u043b\u044a\u0442 \u043d\u0435 \u043c\u043e\u0436\u0430 \u0434\u0430 \u0431\u044a\u0434\u0435 \u0441\u044a\u0437\u0434\u0430\u0434\u0435\u043d. \u041f\u0440\u043e\u0432\u0435\u0440\u0438 \u0434\u0430\u043d\u043d\u0438\u0442\u0435 \u0438\u043b\u0438 \u043e\u043f\u0438\u0442\u0430\u0439 \u043f\u043e-\u043a\u044a\u0441\u043d\u043e.';

function actionFailure(message: string, email: string): string {
	return JSON.stringify({
		type: 'failure',
		status: 400,
		data: JSON.stringify([
			{ success: 1, email: 2, message: 3 },
			false,
			email,
			message
		])
	});
}

function stagingFetch(
	options: {
		candidateActionFailures?: number;
		disableSignup?: boolean;
		keepTestingAtTurnstile?: boolean;
		staleActionResponses?: number;
		wrongDistinctMessages?: boolean;
		onAction?: (value: { action: string; email: string; password: string }) => void;
	} = {}
): typeof fetch {
	let remainingCandidateActionFailures = options.candidateActionFailures ?? 0;
	let remainingStaleActionResponses = options.staleActionResponses ?? 0;
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
		if (remainingStaleActionResponses > 0) {
			remainingStaleActionResponses -= 1;
			return new Response('Authentication service is unavailable.', {
				status: 503,
				headers: { 'retry-after': '60' }
			});
		}
		if (remainingCandidateActionFailures > 0) {
			remainingCandidateActionFailures -= 1;
			return new Response('Authentication service is unavailable.', {
				status: 503,
				headers: {
					'x-deployed-git-sha': expectedGitSha,
					'x-request-id': 'candidate-failure'
				}
			});
		}

		const formData = new URLSearchParams(String(init?.body ?? ''));
		const token = formData.get('cf-turnstile-response');
		const action = url.search === '?/login' ? 'login' : 'register';
		const email = formData.get('email') ?? '';
		const password = formData.get('password') ?? '';
		options.onAction?.({ action, email, password });
		const message = options.wrongDistinctMessages
			? `${action}-${token ? 'testing' : 'missing'}-wrong-branch`
			: token && !options.keepTestingAtTurnstile
				? action === 'login'
					? invalidCredentials
					: signupDisabled
				: turnstileRejection;

		return new Response(actionFailure(message, email), {
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
		const actions: Array<{ action: string; email: string; password: string }> = [];

		await expect(
			runStagingTurnstileEvidence({
				origin: 'http://127.0.0.1:54321',
				expectedGitSha,
				supabaseSettingsUrl: 'https://staging.supabase.co/auth/v1/settings',
				supabasePublishableKey: 'public-staging-key',
				fetchImpl: stagingFetch({ onAction: (value) => actions.push(value) }),
				requireDisabledSignup: true,
				logger
			})
		).resolves.toEqual([
			{ check: 'supabase-signup-disabled-before', status: 200 },
			{ check: 'login-missing-token', actionStatus: 400 },
			{ check: 'login-testing-token', actionStatus: 400 },
			{ check: 'register-missing-token', actionStatus: 400 },
			{ check: 'register-testing-token', actionStatus: 400 },
			{ check: 'supabase-signup-disabled-after', status: 200 },
			{
				check: 'report-submit-testing-token',
				outcome: 'deferred',
				reason: 'authenticated-actor-requires-later-gate'
			}
		]);

		const output = JSON.stringify(logger.log.mock.calls);
		expect(output).not.toContain(dummyToken);
		const loginIdentity = actions.find((value) => value.action === 'login');
		const registerIdentity = actions.find((value) => value.action === 'register');
		expect(loginIdentity?.email).toMatch(/^a7-login-[0-9a-f-]+@example\.invalid$/);
		expect(registerIdentity?.email).toMatch(/^a7-register-[0-9a-f-]+@example\.invalid$/);
		expect(loginIdentity?.email).not.toBe(registerIdentity?.email);
		expect(loginIdentity?.password).not.toBe(registerIdentity?.password);
		expect(output).not.toContain(loginIdentity?.email ?? 'missing-login-identity');
		expect(output).not.toContain(registerIdentity?.email ?? 'missing-register-identity');
		expect(output).not.toContain(loginIdentity?.password ?? 'missing-login-password');
		expect(output).not.toContain(registerIdentity?.password ?? 'missing-register-password');
		expect(output).toContain('authenticated-actor-requires-later-gate');
	});

	it('retries when a stale safe Worker serves an action during deployment propagation', async () => {
		const logger = { log: vi.fn(), warn: vi.fn() };

		await expect(
			runStagingTurnstileEvidence({
				origin: 'http://127.0.0.1:54321',
				expectedGitSha,
				supabaseSettingsUrl: 'https://staging.supabase.co/auth/v1/settings',
				supabasePublishableKey: 'public-staging-key',
				fetchImpl: stagingFetch({ staleActionResponses: 1 }),
				requireDisabledSignup: true,
				attempts: 2,
				delayMs: 0,
				logger
			})
		).resolves.toContainEqual({ check: 'login-missing-token', actionStatus: 400 });
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('stale Worker version')
		);
	});

	it('fails after the bounded retry budget when the stale Worker does not converge', async () => {
		await expect(
			runStagingTurnstileEvidence({
				origin: 'http://127.0.0.1:54321',
				expectedGitSha,
				supabaseSettingsUrl: 'https://staging.supabase.co/auth/v1/settings',
				supabasePublishableKey: 'public-staging-key',
				fetchImpl: stagingFetch({ staleActionResponses: 2 }),
				attempts: 2,
				delayMs: 0,
				logger: { log() {}, warn() {} }
			})
		).rejects.toThrow('exact staging deployment did not converge after 2 attempts');
	});

	it('does not retry an application failure from the exact candidate SHA', async () => {
		const fetchImpl = stagingFetch({ candidateActionFailures: 1 });

		await expect(
			runStagingTurnstileEvidence({
				origin: 'http://127.0.0.1:54321',
				expectedGitSha,
				supabaseSettingsUrl: 'https://staging.supabase.co/auth/v1/settings',
				supabasePublishableKey: 'public-staging-key',
				fetchImpl,
				attempts: 2,
				delayMs: 0,
				logger: { log() {}, warn() {} }
			})
		).rejects.toThrow('expected transport HTTP 200');
		expect(fetchImpl).toHaveBeenCalledTimes(2);
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

	it('rejects distinct 400 messages that do not prove the expected application branches', async () => {
		await expect(
			runStagingTurnstileEvidence({
				origin: 'http://127.0.0.1:54321',
				expectedGitSha,
				supabaseSettingsUrl: 'https://staging.supabase.co/auth/v1/settings',
				supabasePublishableKey: 'public-staging-key',
				fetchImpl: stagingFetch({ wrongDistinctMessages: true }),
				requireDisabledSignup: true,
				logger: { log() {}, warn() {} }
			})
		).rejects.toThrow('expected the exact Turnstile rejection branch');
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
				requireDisabledSignup: true,
				logger: { log() {}, warn() {} }
			})
		).rejects.toThrow('Public Supabase signup must remain disabled');
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it('keeps later staging deploys usable after public signup is enabled', async () => {
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
		).resolves.toContainEqual({
			check: 'register-testing-token',
			outcome: 'deferred',
			reason: 'public-signup-enabled'
		});
		expect(fetchImpl).toHaveBeenCalledTimes(3);
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
