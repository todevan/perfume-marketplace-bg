import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import {
	runStagingRollbackSmoke,
	runStagingSmoke,
	validateHostedStagingOrigin
} from '../../scripts/smoke-staging.mjs';

const workspace = resolve(import.meta.dirname, '../..');
const workflowPath = resolve(workspace, '.github/workflows/deploy.yml');
const expectedOrigin =
	'https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev';
const expectedGitSha = 'a'.repeat(40);
const expectedTurnstileRejection = 'Потвърди, че не си автоматизиран клиент.';
type WorkflowStep = {
	id?: string;
	if?: string;
	run?: string;
};
type WorkflowJob = {
	if?: string;
	environment?: unknown;
	env?: Record<string, string>;
	steps: WorkflowStep[];
};
type Workflow = {
	on: Record<string, unknown>;
	jobs: Record<string, WorkflowJob>;
};

type StartedServer = {
	origin: string;
	close(): Promise<void>;
};

const openServers: StartedServer[] = [];

function applySecurityHeaders(response: ServerResponse): void {
	response.setHeader(
		'content-security-policy',
		"default-src 'self'; frame-ancestors 'none'; object-src 'none'"
	);
	response.setHeader(
		'permissions-policy',
		'camera=(), geolocation=(), microphone=(), payment=()'
	);
	response.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
	response.setHeader('x-content-type-options', 'nosniff');
	response.setHeader('x-frame-options', 'DENY');
	response.setHeader('x-request-id', crypto.randomUUID());
}

function finish(
	response: ServerResponse,
	status: number,
	body = '',
	headers: Record<string, string> = {}
): void {
	applySecurityHeaders(response);
	for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
	response.writeHead(status);
	response.end(body);
}

async function startSmokeServer(
	options: {
		exposeDemo?: boolean;
		deployedGitSha?: string;
		rollback?: boolean;
		loginBody?: string;
	} = {}
): Promise<StartedServer> {
	const publicPages = new Set([
		'/login',
		'/legal',
		'/legal/terms',
		'/legal/privacy',
		'/legal/rules',
		'/legal/appeals',
		'/safety'
	]);

	const server = createServer((request: IncomingMessage, response: ServerResponse) => {
		const url = new URL(request.url ?? '/', 'http://localhost');
		const respond = (
			status: number,
			body = '',
			headers: Record<string, string> = {}
		): void =>
			finish(response, status, body, {
				'x-deployed-git-sha': options.deployedGitSha ?? expectedGitSha,
				...headers
			});

		if (options.rollback) {
			request.resume();
			respond(503, 'Authentication service is unavailable.', {
				'cache-control': 'private, no-store',
				'retry-after': '60'
			});
			return;
		}

		if (request.method === 'POST' && url.pathname === '/login' && url.search === '?/login') {
			request.resume();
			respond(400, options.loginBody ?? expectedTurnstileRejection, {
				'cache-control': 'private, no-store'
			});
			return;
		}

		if (request.method === 'POST' && url.pathname === '/login' && url.search === '?/register') {
			request.resume();
			respond(400, 'Registration input validation failed.', {
				'cache-control': 'private, no-store'
			});
			return;
		}

		if (request.method !== 'GET') {
			respond(405);
			return;
		}

		if (publicPages.has(url.pathname)) {
			const body =
				options.exposeDemo && url.pathname === '/login'
					? '<html>demo@example.bg</html>'
					: '<html>Open email registration</html>';
			respond(200, body);
			return;
		}

		if (url.pathname === '/' || url.pathname === '/dashboard') {
			respond(303, '', {
				'cache-control': 'private, no-store',
				location: `/login?next=${encodeURIComponent(url.pathname)}`
			});
			return;
		}

		if (url.pathname === '/robots.txt') {
			respond(200, 'User-agent: *\nDisallow: /\n', {
				'cache-control': 'public, max-age=300',
				'x-robots-tag': 'noindex, nofollow'
			});
			return;
		}

		if (url.pathname === '/sitemap.xml') {
			respond(404, 'Not found', {
				'cache-control': 'private, no-store',
				'x-robots-tag': 'noindex, nofollow'
			});
			return;
		}

		respond(404);
	});

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once('error', rejectListen);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', rejectListen);
			resolveListen();
		});
	});

	const address = server.address();
	if (!address || typeof address === 'string') {
		server.close();
		throw new Error('Test smoke server did not expose a TCP port.');
	}

	const started: StartedServer = {
		origin: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise<void>((resolveClose, rejectClose) => {
				server.close((error) => (error ? rejectClose(error) : resolveClose()));
			})
	};
	openServers.push(started);
	return started;
}

afterEach(async () => {
	await Promise.all(openServers.splice(0).map((server) => server.close()));
});

describe('hosted staging smoke runner', () => {
	it('verifies the complete open-registration HTTP contract without following redirects', async () => {
		const server = await startSmokeServer();
		const fetchImpl = vi.fn(
			(input: string | URL | Request, init?: RequestInit) => fetch(input, init)
		) as unknown as typeof fetch;
		const receipts = await runStagingSmoke({
			origin: server.origin,
			expectedGitSha,
			attempts: 1,
			fetchImpl,
			logger: { log() {}, warn() {} }
		});

		expect(receipts).toHaveLength(13);
		expect(fetchImpl).toHaveBeenCalledTimes(13);
		expect(receipts).toContainEqual({ method: 'GET', path: '/', status: 303 });
		expect(receipts).toContainEqual({
			method: 'POST',
			path: '/login?/register',
			status: 400
		});
		expect(receipts).toContainEqual({
			method: 'POST',
			path: '/login?/login',
			status: 400
		});
	});

	it('fails when a runtime page exposes demo fixture data', async () => {
		const server = await startSmokeServer({ exposeDemo: true });
		await expect(
			runStagingSmoke({
				origin: server.origin,
				expectedGitSha,
				attempts: 1,
				logger: { log() {}, warn() {} }
			})
		).rejects.toThrow('demo fixture data is exposed');
	});

	it('rejects a generic 400 that does not attest the pre-auth Turnstile boundary', async () => {
		const server = await startSmokeServer({ loginBody: 'Authentication request rejected.' });
		await expect(
			runStagingSmoke({
				origin: server.origin,
				expectedGitSha,
				attempts: 1,
				logger: { log() {}, warn() {} }
			})
		).rejects.toThrow('pre-auth Turnstile rejection was not attested');
	});

	it('fails when any response comes from a different deployed Git SHA', async () => {
		const server = await startSmokeServer({ deployedGitSha: 'b'.repeat(40) });
		await expect(
			runStagingSmoke({
				origin: server.origin,
				expectedGitSha,
				attempts: 1,
				logger: { log() {}, warn() {} }
			})
		).rejects.toThrow('deployed Git SHA does not match');
	});

	it('refuses an invalid expected SHA before making an HTTP request', async () => {
		const fetchImpl = vi.fn() as unknown as typeof fetch;
		await expect(
			runStagingSmoke({
				origin: 'http://127.0.0.1:54321',
				expectedGitSha: 'main',
				fetchImpl
			})
		).rejects.toThrow('EXPECTED_GIT_SHA');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('allows the CLI to target only the dedicated HTTPS staging Worker', () => {
		expect(validateHostedStagingOrigin(expectedOrigin)).toBe(expectedOrigin);
		expect(() =>
			validateHostedStagingOrigin(
				'https://perfume-marketplace-bg.perfume-marketplace-bg.workers.dev'
			)
		).toThrow('unexpected host');
		expect(() =>
			validateHostedStagingOrigin('https://example.com')
		).toThrow('unexpected host');
		expect(() =>
			validateHostedStagingOrigin(`${expectedOrigin}/login`)
		).toThrow('cannot contain');
	});
});

describe('hosted staging rollback smoke runner', () => {
	it('verifies the exact fail-closed bootstrap contract', async () => {
		const server = await startSmokeServer({ rollback: true });
		const fetchImpl = vi.fn(
			(input: string | URL | Request, init?: RequestInit) => fetch(input, init)
		) as unknown as typeof fetch;
		const receipts = await runStagingRollbackSmoke({
			origin: server.origin,
			attempts: 1,
			fetchImpl,
			logger: { log() {}, warn() {} }
		});

		expect(receipts).toHaveLength(5);
		expect(fetchImpl).toHaveBeenCalledTimes(5);
		expect(receipts).toContainEqual({ method: 'GET', path: '/robots.txt', status: 503 });
		expect(receipts).toContainEqual({ method: 'GET', path: '/dashboard', status: 503 });
	});

	it('rejects a functional response when rollback verification is expected', async () => {
		const server = await startSmokeServer();
		await expect(
			runStagingRollbackSmoke({
				origin: server.origin,
				attempts: 1,
				logger: { log() {}, warn() {} }
			})
		).rejects.toThrow('expected HTTP 503');
	});
});

describe('manual staging deploy workflow smoke contract', () => {
	it('runs the hosted smoke after deploy and restores the safe version on failure', () => {
		const workflow = parse(readFileSync(workflowPath, 'utf8')) as Workflow;
		const job = workflow.jobs.staging;
		const commands = job.steps.flatMap((step) => (step.run ? [step.run] : []));
		const deploy = commands.indexOf('pnpm exec wrangler deploy --env staging');
		const smoke = commands.indexOf('node scripts/smoke-staging.mjs');
		const rollback = commands.findIndex((command) =>
			command.includes('pnpm exec wrangler versions deploy "$SAFE_ROLLBACK_VERSION"')
		);
		const rollbackSmoke = commands.indexOf('node scripts/smoke-staging.mjs --mode rollback');

		expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
		expect(job.if).toBe("github.ref == 'refs/heads/main'");
		expect(job.env).toMatchObject({
			STAGING_ORIGIN: expectedOrigin,
			EXPECTED_GIT_SHA: '${{ github.sha }}',
			SAFE_ROLLBACK_VERSION: '75593db4-12fd-486d-ae8a-bdf9ebbb3ece'
		});
		expect(job).not.toHaveProperty('environment');
		expect(commands.some((command) => command.includes('wrangler deploy --env production'))).toBe(
			false
		);
		expect(deploy).toBeGreaterThan(-1);
		expect(smoke).toBeGreaterThan(deploy);
		expect(rollback).toBeGreaterThan(smoke);
		expect(rollbackSmoke).toBeGreaterThan(rollback);
		expect(job.steps.find((step) => step.id === 'rollback')?.if).toBe(
			"failure() && steps.deploy.outcome == 'success'"
		);
		expect(
			job.steps.find((step) => step.run === 'node scripts/smoke-staging.mjs --mode rollback')?.if
		).toBe("failure() && steps.rollback.outcome == 'success'");
		expect(commands.filter((command) => command === 'pnpm exec wrangler deploy --env staging')).toHaveLength(
			1
		);
		expect(commands.filter((command) => command.startsWith('node scripts/smoke-staging.mjs'))).toHaveLength(
			2
		);
	});
});
