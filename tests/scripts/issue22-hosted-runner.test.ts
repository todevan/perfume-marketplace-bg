import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

type HostedRunnerModule = typeof import('../../scripts/issue22-hosted/runner.mjs');

const runner = await import('../../scripts/issue22-hosted/runner.mjs').catch(
	() => ({}) as Partial<HostedRunnerModule>
);

function requiredFunction<Name extends keyof HostedRunnerModule>(name: Name): HostedRunnerModule[Name] {
	const value = runner[name];
	if (typeof value !== 'function') throw new Error(`${String(name)} is not implemented`);
	return value as HostedRunnerModule[Name];
}

const expectedSha = 'a'.repeat(40);
const candidateOrigin = 'https://aromatika-issue-22-a1b2c3d.workers.dev';
const confirmationLink = `${candidateOrigin}/auth/confirm?token_hash=private-token-value&type=email`;

function runnerEnvironment(overrides: Record<string, string> = {}) {
	return {
		ISSUE22_CANDIDATE_ORIGIN: candidateOrigin,
		ISSUE22_EXPECTED_SHA: expectedSha,
		ISSUE22_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
		ISSUE22_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only',
		ISSUE22_SUPABASE_PROJECT_ID: 'abcdefghijklmnopqrst',
		ISSUE22_MAILTRAP_READ_TOKEN: 'mailtrap-read-token-private',
		ISSUE22_MAILTRAP_API_BASE_URL: 'https://mailtrap.io',
		ISSUE22_MAILTRAP_ACCOUNT_ID: '1234567',
		ISSUE22_MAILTRAP_INBOX_ID: '4887168',
		ISSUE22_WORKER_NAME: 'aromatika-issue-22-a1b2c3d',
		ISSUE22_WORKER_VERSION_ID: '11111111-1111-4111-8111-111111111111',
		ISSUE22_MANIFEST_TRANSACTION_ID: '22222222-2222-4222-8222-222222222222',
		...overrides
	};
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Issue #22 unprivileged runner boundary', () => {
	test.each([
		'SUPABASE_SERVICE_ROLE_KEY',
		'SUPABASE_SECRET_KEY',
		'SUPABASE_ACCESS_TOKEN',
		'SUPABASE_DB_PASSWORD',
		'CLOUDFLARE_API_TOKEN',
		'CLOUDFLARE_ACCOUNT_ID',
		'MAILTRAP_SMTP_PASSWORD',
		'ISSUE22_UNDECLARED_INPUT'
	])('rejects privileged or undeclared input %s without echoing its value', (name) => {
		const validate = requiredFunction('validateRunnerEnvironment');
		const privateValue = 'must-never-appear-in-a-diagnostic';
		let thrown: unknown;
		try {
			validate(runnerEnvironment({ [name]: privateValue }));
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).toBe('Issue #22 runner environment is not permitted.');
		expect((thrown as Error).message).not.toContain(privateValue);
	});

	test('requires numeric manifest-bound Mailtrap account and exact sandbox IDs before polling', () => {
		const validate = requiredFunction('validateRunnerEnvironment');
		expect(() => validate(runnerEnvironment({ ISSUE22_MAILTRAP_ACCOUNT_ID: 'account-name' }))).toThrow(
			'Issue #22 runner configuration is invalid.'
		);
		expect(() => validate(runnerEnvironment({ ISSUE22_MAILTRAP_INBOX_ID: '4887169' }))).toThrow(
			'Issue #22 runner configuration is invalid.'
		);
		expect(validate(runnerEnvironment()).mailtrap.inboxId).toBe(4_887_168);
	});

	test('rejects a cross-origin Mailtrap API base rather than accepting a body URL from another host', async () => {
		const poll = requiredFunction('pollForConfirmationMessage');
		const fetchImpl = vi.fn(async () =>
			new Response(
				JSON.stringify([
					{
						id: 19,
						to_email: 'issue22@example.invalid',
						received_at: '2026-09-01T10:00:00.000Z',
						body_html_url: 'https://foreign.invalid/private-body'
					}
				]),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		);

		await expect(
			poll(
				{
					apiBaseUrl: 'https://mailtrap.io',
					accountId: 1_234_567,
					inboxId: 4_887_168,
					readToken: 'private-token',
					recipient: 'issue22@example.invalid',
					runStartedAt: '2026-09-01T10:00:00.000Z',
					pollIntervalMs: 1_000,
					timeoutMs: 3_000
				},
				{ fetchImpl, now: () => Date.parse('2026-09-01T10:00:00.000Z'), sleep: vi.fn() }
			)
		).rejects.toThrow('Issue #22 Mailtrap proof failed safely.');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});

describe('Mailtrap polling and confirmation-link handling', () => {
	test('filters by exact recipient and start time, then fetches HTML only after exactly one match', async () => {
		const poll = requiredFunction('pollForConfirmationMessage');
		const recipient = 'issue22-exact@example.invalid';
		const listUrl = 'https://mailtrap.io/api/accounts/1234567/inboxes/4887168/messages';
		const bodyUrl = 'https://mailtrap.io/api/accounts/1234567/inboxes/4887168/messages/33/body.html';
		const calls: string[] = [];
		const fetchImpl = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);
			if (url === listUrl) {
				return new Response(
					JSON.stringify([
						{ id: 11, to_email: 'other@example.invalid', received_at: '2026-09-01T10:00:01.000Z' },
						{ id: 22, to_email: recipient, received_at: '2026-09-01T09:59:59.999Z' },
						{ id: 33, to_email: recipient, received_at: '2026-09-01T10:00:00.000Z' }
					]),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			}
			if (url === bodyUrl) return new Response(`<a href="${confirmationLink}">Confirm</a>`, { status: 200 });
			return new Response(null, { status: 404 });
		});

		const selected = await poll(
			{
				apiBaseUrl: 'https://mailtrap.io',
				accountId: 1_234_567,
				inboxId: 4_887_168,
				readToken: 'private-token',
				recipient,
				runStartedAt: '2026-09-01T10:00:00.000Z',
				pollIntervalMs: 1_000,
				timeoutMs: 3_000
			},
			{ fetchImpl, now: () => Date.parse('2026-09-01T10:00:00.000Z'), sleep: vi.fn() }
		);

		expect(selected).toEqual({ messageId: 33, html: `<a href="${confirmationLink}">Confirm</a>` });
		expect(calls).toEqual([listUrl, bodyUrl]);
	});

	test('fails closed on more than one exact message without fetching either body', async () => {
		const poll = requiredFunction('pollForConfirmationMessage');
		const recipient = 'issue22-duplicate@example.invalid';
		const fetchImpl = vi.fn(async () =>
			new Response(
				JSON.stringify([
					{ id: 1, to_email: recipient, received_at: '2026-09-01T10:00:00.000Z' },
					{ id: 2, to_email: recipient, received_at: '2026-09-01T10:00:01.000Z' }
				]),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		);

		await expect(
			poll(
				{
					apiBaseUrl: 'https://mailtrap.io', accountId: 1, inboxId: 4_887_168, readToken: 'secret', recipient,
					runStartedAt: '2026-09-01T10:00:00.000Z', pollIntervalMs: 1_000, timeoutMs: 3_000
				},
				{ fetchImpl, now: () => Date.parse('2026-09-01T10:00:01.000Z'), sleep: vi.fn() }
			)
		).rejects.toThrow('Issue #22 Mailtrap proof failed safely.');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	test('uses a bounded interval and total timeout without an extra signup or unbounded request', async () => {
		const poll = requiredFunction('pollForConfirmationMessage');
		let now = 0;
		const sleep = vi.fn(async (duration: number) => {
			now += duration;
		});
		const fetchImpl = vi.fn(async () =>
			new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
		);

		await expect(
			poll(
				{
					apiBaseUrl: 'https://mailtrap.io', accountId: 1, inboxId: 4_887_168, readToken: 'secret',
					recipient: 'issue22-timeout@example.invalid', runStartedAt: '1970-01-01T00:00:00.000Z',
					pollIntervalMs: 1_000, timeoutMs: 3_000
				},
				{ fetchImpl, now: () => now, sleep }
			)
		).rejects.toThrow('Issue #22 Mailtrap proof timed out.');
		expect(fetchImpl).toHaveBeenCalledTimes(4);
		expect(sleep.mock.calls).toEqual([[1_000], [1_000], [1_000]]);
		expect(now).toBe(3_000);
	});

	test('extracts exactly one same-origin candidate confirmation link', () => {
		const extract = requiredFunction('extractConfirmationLink');
		expect(extract(`<p><a href="${confirmationLink.replaceAll('&', '&amp;')}">Confirm</a></p>`, candidateOrigin)).toBe(
			confirmationLink
		);
		expect(() => extract('<p>No confirmation link</p>', candidateOrigin)).toThrow(
			'Issue #22 confirmation link is invalid.'
		);
		expect(() =>
			extract(
				`<a href="${confirmationLink}">One</a><a href="${confirmationLink}&amp;duplicate=1">Two</a>`,
				candidateOrigin
			)
		).toThrow('Issue #22 confirmation link is invalid.');
		expect(() =>
			extract(
				'<a href="https://foreign.invalid/auth/confirm?token_hash=private&amp;type=email">Confirm</a>',
				candidateOrigin
			)
		).toThrow('Issue #22 confirmation link is invalid.');
	});
});

describe('exact hosted journey and sanitization', () => {
	test('records the start before one signup and reuses the same link only to prove denial', async () => {
		const run = requiredFunction('runHostedJourney');
		const events: string[] = [];
		const signup = vi.fn(async () => events.push('signup'));
		const poll = vi.fn(async ({ runStartedAt }: { runStartedAt: string }) => {
			events.push(`poll:${runStartedAt}`);
			return { messageId: 33, html: `<a href="${confirmationLink}">Confirm</a>` };
		});
		const confirm = vi.fn(async () => {
			events.push('confirm');
			return { redirectedTo: '/onboarding' };
		});
		const completeOnboarding = vi.fn(async () => events.push('onboarding'));
		const assertMarketplaceAccess = vi.fn(async () => events.push('marketplace'));
		const reuseConfirmationLink = vi.fn(async () => {
			events.push('reuse');
			return { denied: true };
		});

		const receipt = await run(validateRunnerEnvironmentForTest(), {
			now: () => Date.parse('2026-09-01T10:00:00.000Z'),
			signup,
			poll,
			confirm,
			completeOnboarding,
			assertMarketplaceAccess,
			reuseConfirmationLink,
			artifactPaths: []
		});

		expect(signup).toHaveBeenCalledTimes(1);
		expect(poll).toHaveBeenCalledTimes(1);
		expect(confirm).toHaveBeenCalledWith(confirmationLink);
		expect(reuseConfirmationLink).toHaveBeenCalledTimes(1);
		expect(reuseConfirmationLink).toHaveBeenCalledWith(confirmationLink);
		expect(events).toEqual([
			'signup',
			'poll:2026-09-01T10:00:00.000Z',
			'confirm',
			'onboarding',
			'marketplace',
			'reuse'
		]);
		expect(JSON.stringify(receipt)).not.toMatch(/example\.invalid|token_hash|private-token|authorization|cookie/iu);
	});

	test('fails if confirmation-link reuse succeeds', async () => {
		const run = requiredFunction('runHostedJourney');
		await expect(
			run(validateRunnerEnvironmentForTest(), {
				now: () => 0,
				signup: async () => undefined,
				poll: async () => ({ messageId: 1, html: `<a href="${confirmationLink}">Confirm</a>` }),
				confirm: async () => ({ redirectedTo: '/onboarding' }),
				completeOnboarding: async () => undefined,
				assertMarketplaceAccess: async () => undefined,
				reuseConfirmationLink: async () => ({ denied: false }),
				artifactPaths: []
			})
		).rejects.toThrow('Issue #22 confirmation reuse was not denied.');
	});

	test.each([
		'issue22-private@example.invalid',
		'https://candidate.invalid/auth/confirm?token_hash=private&type=email',
		'Authorization: Bearer private-token',
		'Cookie: sb-access-token=private-cookie',
		'Set-Cookie: session=private-cookie'
	])('rejects a produced artifact containing private material: %s', async (privateMaterial) => {
		const assertArtifacts = requiredFunction('assertSanitizedArtifacts');
		const directory = await mkdtemp(join(tmpdir(), 'issue22-artifacts-'));
		temporaryDirectories.push(directory);
		const artifact = join(directory, 'artifact.txt');
		await writeFile(artifact, privateMaterial, 'utf8');
		await expect(
			assertArtifacts([artifact], ['issue22-private@example.invalid', 'private-token', 'private-cookie'])
		).rejects.toThrow('Issue #22 artifact contains private material.');
	});

	test('rejects private browser console or error text without echoing it', () => {
		const assertText = requiredFunction('assertSanitizedText');
		const privateText = `request failed for ${confirmationLink}`;
		let thrown: unknown;
		try {
			assertText(privateText, ['private-token-value']);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).toBe('Issue #22 diagnostic contains private material.');
		expect((thrown as Error).message).not.toContain('private-token-value');
	});

	test('accepts a sanitized receipt artifact', async () => {
		const assertArtifacts = requiredFunction('assertSanitizedArtifacts');
		const directory = await mkdtemp(join(tmpdir(), 'issue22-artifacts-'));
		temporaryDirectories.push(directory);
		const artifact = join(directory, 'receipt.json');
		await writeFile(artifact, JSON.stringify({ status: 'passed', candidateSha: expectedSha }), 'utf8');
		await expect(assertArtifacts([artifact], ['private-value'])).resolves.toBeUndefined();
	});

	test('requires the live runtime header to match the immutable candidate SHA', async () => {
		const assertRuntime = requiredFunction('assertRuntimeCandidate');
		await expect(
			assertRuntime(candidateOrigin, expectedSha, async () =>
				new Response(null, { status: 200, headers: { 'x-deployed-git-sha': expectedSha } })
			)
		).resolves.toBeUndefined();
		await expect(
			assertRuntime(candidateOrigin, expectedSha, async () =>
				new Response(null, { status: 200, headers: { 'x-deployed-git-sha': 'b'.repeat(40) } })
			)
		).rejects.toThrow('Issue #22 deployed candidate does not match the expected SHA.');
	});
});

function validateRunnerEnvironmentForTest() {
	return requiredFunction('validateRunnerEnvironment')(runnerEnvironment());
}
