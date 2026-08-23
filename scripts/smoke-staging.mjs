import { pathToFileURL } from 'node:url';

const EXPECTED_STAGING_HOST =
	'perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev';
const EXPECTED_PRE_AUTH_TURNSTILE_REJECTION =
	'Потвърди, че не си автоматизиран клиент.';

const PUBLIC_PAGE_PATHS = [
	'/login',
	'/legal',
	'/legal/terms',
	'/legal/privacy',
	'/legal/rules',
	'/legal/appeals',
	'/safety'
];

const ROLLBACK_PATHS = ['/login', '/', '/dashboard', '/robots.txt', '/sitemap.xml'];

const DEMO_SENTINELS = [
	'demo@example.bg',
	'demo-beta',
	'demo_user',
	'Демонстрационен вход',
	'chanel-coco-mademoiselle-edp-100ml'
];

/**
 * @typedef {{
 *   method: 'GET' | 'POST';
 *   path: string;
 *   status: number;
 * }} SmokeReceipt
 */

/**
 * @typedef {{
 *   origin: string;
 *   expectedGitSha: string;
 *   attempts?: number;
 *   delayMs?: number;
 *   timeoutMs?: number;
 *   fetchImpl?: typeof fetch;
 *   logger?: Pick<Console, 'log' | 'warn'>;
 * }} SmokeOptions
 */

/**
 * @typedef {Omit<SmokeOptions, 'expectedGitSha'>} RollbackSmokeOptions
 */

class SmokeAssertionError extends Error {
	/**
	 * @param {string} message
	 */
	constructor(message) {
		super(message);
		this.name = 'SmokeAssertionError';
	}
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {{ minimum: number; maximum: number }} range
 */
function integerInRange(value, name, range) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < range.minimum || parsed > range.maximum) {
		throw new TypeError(
			`${name} must be an integer from ${range.minimum} through ${range.maximum}.`
		);
	}
	return parsed;
}

/**
 * @param {string} rawOrigin
 */
function normalizeOrigin(rawOrigin) {
	let parsed;
	try {
		parsed = new URL(rawOrigin);
	} catch {
		throw new TypeError('The staging smoke origin must be an absolute HTTP(S) URL.');
	}

	if (!['http:', 'https:'].includes(parsed.protocol)) {
		throw new TypeError('The staging smoke origin must use HTTP or HTTPS.');
	}
	if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
		throw new TypeError('The staging smoke origin cannot contain credentials, a path, query, or hash.');
	}
	return parsed.origin;
}

/**
 * @param {string} value
 */
function normalizeExpectedGitSha(value) {
	const normalized = value.trim();
	if (!/^[0-9a-f]{40}$/.test(normalized)) {
		throw new TypeError('EXPECTED_GIT_SHA must be an exact lowercase 40-character Git SHA.');
	}
	return normalized;
}

/**
 * The CLI may only target the dedicated workers.dev staging host. Tests call
 * runStagingSmoke directly with a loopback origin.
 *
 * @param {string} rawOrigin
 */
export function validateHostedStagingOrigin(rawOrigin) {
	const origin = normalizeOrigin(rawOrigin);
	const parsed = new URL(origin);
	if (
		parsed.protocol !== 'https:' ||
		parsed.hostname !== EXPECTED_STAGING_HOST ||
		parsed.port !== ''
	) {
		throw new TypeError(
			`Refusing to smoke an unexpected host. Expected https://${EXPECTED_STAGING_HOST}.`
		);
	}
	return origin;
}

/**
 * @param {boolean} condition
 * @param {string} message
 */
function assertSmoke(condition, message) {
	if (!condition) throw new SmokeAssertionError(message);
}

/**
 * @param {Response} response
 * @param {string} context
 */
function assertSecurityHeaders(response, context) {
	const csp = response.headers.get('content-security-policy') ?? '';
	assertSmoke(csp.includes("frame-ancestors 'none'"), `${context}: missing restrictive CSP.`);
	assertSmoke(
		response.headers.get('permissions-policy')?.includes('payment=()') === true,
		`${context}: missing Permissions-Policy.`
	);
	assertSmoke(
		Boolean(response.headers.get('referrer-policy')),
		`${context}: missing Referrer-Policy.`
	);
	assertSmoke(
		response.headers.get('x-content-type-options')?.toLowerCase() === 'nosniff',
		`${context}: missing X-Content-Type-Options.`
	);
	assertSmoke(
		response.headers.get('x-frame-options')?.toUpperCase() === 'DENY',
		`${context}: missing X-Frame-Options.`
	);
	assertSmoke(Boolean(response.headers.get('x-request-id')), `${context}: missing X-Request-ID.`);
}

/**
 * @param {Response} response
 * @param {string} expectedGitSha
 * @param {string} context
 */
function assertDeploymentIdentity(response, expectedGitSha, context) {
	assertSecurityHeaders(response, context);
	assertSmoke(
		response.headers.get('x-deployed-git-sha') === expectedGitSha,
		`${context}: deployed Git SHA does not match the requested workflow SHA.`
	);
}

/**
 * @param {Response} response
 * @param {string} context
 */
function assertNoStore(response, context) {
	const cacheControl = response.headers.get('cache-control')?.toLowerCase() ?? '';
	assertSmoke(cacheControl.includes('no-store'), `${context}: response must be no-store.`);
}

/**
 * @param {string} body
 * @param {string} context
 */
function assertNoDemoData(body, context) {
	for (const sentinel of DEMO_SENTINELS) {
		assertSmoke(!body.includes(sentinel), `${context}: demo fixture data is exposed.`);
	}
}

/**
 * @param {Response} response
 * @param {number} expectedStatus
 * @param {string} context
 */
function assertStatus(response, expectedStatus, context) {
	assertSmoke(
		response.status === expectedStatus,
		`${context}: expected HTTP ${expectedStatus}, received ${response.status}.`
	);
}

/**
 * @param {Response} response
 * @param {string} origin
 * @param {string} expectedNext
 * @param {string} context
 */
function assertLoginRedirect(response, origin, expectedNext, context) {
	const location = response.headers.get('location');
	assertSmoke(Boolean(location), `${context}: missing redirect Location.`);
	const redirectUrl = new URL(/** @type {string} */ (location), origin);
	assertSmoke(redirectUrl.origin === origin, `${context}: redirect leaves the staging origin.`);
	assertSmoke(redirectUrl.pathname === '/login', `${context}: redirect does not target /login.`);
	assertSmoke(
		redirectUrl.searchParams.get('next') === expectedNext,
		`${context}: redirect does not preserve the expected next path.`
	);
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} origin
 * @param {string} path
 * @param {RequestInit} [init]
 * @param {number} [timeoutMs]
 */
async function request(fetchImpl, origin, path, init = {}, timeoutMs = 10_000) {
	return fetchImpl(new URL(path, origin), {
		redirect: 'manual',
		...init,
		headers: {
			accept: 'text/html,application/xhtml+xml',
			'user-agent': 'perfume-marketplace-staging-smoke/1.0',
			...init.headers
		},
		signal: AbortSignal.timeout(timeoutMs)
	});
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} origin
 * @param {string} expectedGitSha
 * @param {number} timeoutMs
 */
async function runSmokeAttempt(fetchImpl, origin, expectedGitSha, timeoutMs) {
	/** @type {SmokeReceipt[]} */
	const receipts = [];

	for (const path of PUBLIC_PAGE_PATHS) {
		const response = await request(fetchImpl, origin, path, {}, timeoutMs);
		const context = `GET ${path}`;
		assertStatus(response, 200, context);
		assertDeploymentIdentity(response, expectedGitSha, context);
		assertNoDemoData(await response.text(), context);
		receipts.push({ method: 'GET', path, status: response.status });
	}

	for (const [path, expectedNext] of [
		['/', '/'],
		['/dashboard', '/dashboard']
	]) {
		const response = await request(fetchImpl, origin, path, {}, timeoutMs);
		const context = `GET ${path}`;
		assertStatus(response, 303, context);
		assertLoginRedirect(response, origin, expectedNext, context);
		assertDeploymentIdentity(response, expectedGitSha, context);
		assertNoStore(response, context);
		receipts.push({ method: 'GET', path, status: response.status });
	}

	{
		const path = '/robots.txt';
		const response = await request(fetchImpl, origin, path, {}, timeoutMs);
		const context = `GET ${path}`;
		assertStatus(response, 200, context);
		assertDeploymentIdentity(response, expectedGitSha, context);
		assertSmoke(
			(await response.text()) === 'User-agent: *\nDisallow: /\n',
			`${context}: crawler policy is not the closed-beta policy.`
		);
		assertSmoke(
			response.headers.get('x-robots-tag') === 'noindex, nofollow',
			`${context}: missing noindex/no-follow header.`
		);
		receipts.push({ method: 'GET', path, status: response.status });
	}

	{
		const path = '/sitemap.xml';
		const response = await request(fetchImpl, origin, path, {}, timeoutMs);
		const context = `GET ${path}`;
		assertStatus(response, 404, context);
		assertDeploymentIdentity(response, expectedGitSha, context);
		assertNoStore(response, context);
		assertSmoke(
			response.headers.get('x-robots-tag') === 'noindex, nofollow',
			`${context}: missing noindex/no-follow header.`
		);
		assertNoDemoData(await response.text(), context);
		receipts.push({ method: 'GET', path, status: response.status });
	}

	{
		const path = '/login?/register';
		const response = await request(
			fetchImpl,
			origin,
			path,
			{
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
					origin
				},
				body: new URLSearchParams({
					email: 'staging-registration-validation@example.invalid',
					next: '/dashboard'
				})
			},
			timeoutMs
		);
		const context = `POST ${path}`;
		assertStatus(response, 400, context);
		assertDeploymentIdentity(response, expectedGitSha, context);
		assertNoStore(response, context);
		assertNoDemoData(await response.text(), context);
		receipts.push({ method: 'POST', path, status: response.status });
	}

	{
		const path = '/login?/login';
		const password = 'staging-smoke-not-a-user';
		const response = await request(
			fetchImpl,
			origin,
			path,
			{
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
					origin
				},
				body: new URLSearchParams({
					email: 'staging-smoke@example.invalid',
					password,
					next: '/dashboard'
				})
			},
			timeoutMs
		);
		const context = `POST ${path}`;
		assertStatus(response, 400, context);
		assertDeploymentIdentity(response, expectedGitSha, context);
		assertNoStore(response, context);
		const body = await response.text();
		assertNoDemoData(body, context);
		assertSmoke(
			body.includes(EXPECTED_PRE_AUTH_TURNSTILE_REJECTION),
			`${context}: pre-auth Turnstile rejection was not attested.`
		);
		assertSmoke(!body.includes(password), `${context}: submitted password was reflected.`);
		receipts.push({ method: 'POST', path, status: response.status });
	}

	return receipts;
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} origin
 * @param {number} timeoutMs
 */
async function runRollbackSmokeAttempt(fetchImpl, origin, timeoutMs) {
	/** @type {SmokeReceipt[]} */
	const receipts = [];

	for (const path of ROLLBACK_PATHS) {
		const response = await request(fetchImpl, origin, path, {}, timeoutMs);
		const context = `GET ${path}`;
		assertStatus(response, 503, context);
		assertSecurityHeaders(response, context);
		assertNoStore(response, context);
		assertSmoke(response.headers.get('retry-after') === '60', `${context}: missing Retry-After.`);
		const body = await response.text();
		assertSmoke(
			body === 'Authentication service is unavailable.',
			`${context}: rollback body does not match the fail-closed baseline.`
		);
		assertNoDemoData(body, context);
		receipts.push({ method: 'GET', path, status: response.status });
	}

	return receipts;
}

/**
 * @param {SmokeOptions} options
 */
export async function runStagingSmoke(options) {
	const origin = normalizeOrigin(options.origin);
	const expectedGitSha = normalizeExpectedGitSha(options.expectedGitSha);
	const attempts = integerInRange(options.attempts ?? 1, 'attempts', {
		minimum: 1,
		maximum: 30
	});
	const delayMs = integerInRange(options.delayMs ?? 0, 'delayMs', {
		minimum: 0,
		maximum: 30_000
	});
	const timeoutMs = integerInRange(options.timeoutMs ?? 10_000, 'timeoutMs', {
		minimum: 1_000,
		maximum: 60_000
	});
	const fetchImpl = options.fetchImpl ?? fetch;
	const logger = options.logger ?? console;

	/** @type {unknown} */
	let lastFailure;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const receipts = await runSmokeAttempt(
				fetchImpl,
				origin,
				expectedGitSha,
				timeoutMs
			);
			for (const receipt of receipts) {
				logger.log(`${receipt.method} ${receipt.path} -> ${receipt.status}`);
			}
			logger.log(
				`Staging smoke passed: ${receipts.length} checks against ${new URL(origin).hostname}.`
			);
			return receipts;
		} catch (cause) {
			lastFailure = cause;
			if (attempt === attempts) break;
			const message = cause instanceof Error ? cause.message : 'unknown smoke failure';
			logger.warn(`Staging smoke attempt ${attempt}/${attempts} failed: ${message}`);
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}

	throw lastFailure;
}

/**
 * Verifies the explicit safe Worker version after an automated rollback.
 * The bootstrap version predates Git-SHA response headers, so identity is
 * established by the preceding exact version deployment command and the
 * intentionally narrow HTTP contract below.
 *
 * @param {RollbackSmokeOptions} options
 */
export async function runStagingRollbackSmoke(options) {
	const origin = normalizeOrigin(options.origin);
	const attempts = integerInRange(options.attempts ?? 1, 'attempts', {
		minimum: 1,
		maximum: 30
	});
	const delayMs = integerInRange(options.delayMs ?? 0, 'delayMs', {
		minimum: 0,
		maximum: 30_000
	});
	const timeoutMs = integerInRange(options.timeoutMs ?? 10_000, 'timeoutMs', {
		minimum: 1_000,
		maximum: 60_000
	});
	const fetchImpl = options.fetchImpl ?? fetch;
	const logger = options.logger ?? console;

	/** @type {unknown} */
	let lastFailure;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const receipts = await runRollbackSmokeAttempt(fetchImpl, origin, timeoutMs);
			for (const receipt of receipts) {
				logger.log(`${receipt.method} ${receipt.path} -> ${receipt.status}`);
			}
			logger.log(
				`Staging rollback smoke passed: ${receipts.length} checks against ${new URL(origin).hostname}.`
			);
			return receipts;
		} catch (cause) {
			lastFailure = cause;
			if (attempt === attempts) break;
			const message = cause instanceof Error ? cause.message : 'unknown rollback smoke failure';
			logger.warn(
				`Staging rollback smoke attempt ${attempt}/${attempts} failed: ${message}`
			);
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}

	throw lastFailure;
}

/**
 * @param {string[]} argumentsList
 */
function parseCliOptions(argumentsList) {
	/** @type {Record<string, string>} */
	const values = {};
	for (let index = 0; index < argumentsList.length; index += 1) {
		const argument = argumentsList[index];
		if (!argument.startsWith('--')) throw new TypeError(`Unexpected argument: ${argument}`);
		const [rawName, inlineValue] = argument.slice(2).split('=', 2);
		const value = inlineValue ?? argumentsList[index + 1];
		if (!value || (inlineValue === undefined && value.startsWith('--'))) {
			throw new TypeError(`Missing value for --${rawName}.`);
		}
		values[rawName] = value;
		if (inlineValue === undefined) index += 1;
	}
	return values;
}

async function main() {
	const cli = parseCliOptions(process.argv.slice(2));
	const origin = validateHostedStagingOrigin(cli.origin ?? process.env.STAGING_ORIGIN ?? '');
	const mode = cli.mode ?? 'functional';
	const commonOptions = {
		origin,
		attempts: Number(cli.attempts ?? process.env.STAGING_SMOKE_ATTEMPTS ?? 6),
		delayMs: Number(cli['delay-ms'] ?? process.env.STAGING_SMOKE_DELAY_MS ?? 5_000),
		timeoutMs: Number(cli['timeout-ms'] ?? process.env.STAGING_SMOKE_TIMEOUT_MS ?? 5_000)
	};

	if (mode === 'rollback') {
		await runStagingRollbackSmoke(commonOptions);
		return;
	}
	if (mode !== 'functional') {
		throw new TypeError('Smoke mode must be "functional" or "rollback".');
	}
	await runStagingSmoke({
		...commonOptions,
		expectedGitSha: cli['expected-git-sha'] ?? process.env.EXPECTED_GIT_SHA ?? ''
	});
}

const isCli =
	Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
	main().catch((cause) => {
		const message = cause instanceof Error ? cause.message : 'Unknown staging smoke failure.';
		console.error(`Staging smoke failed: ${message}`);
		process.exitCode = 1;
	});
}
