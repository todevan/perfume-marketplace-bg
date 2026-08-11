import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parse as parseDevalue } from 'devalue';

const EXPECTED_STAGING_HOST =
	'perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev';
const EXPECTED_SUPABASE_HOST = 'nuhkpqjjyuygiemrxbdp.supabase.co';
const CLOUDFLARE_DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const TURNSTILE_REJECTION_MESSAGE =
	'\u041f\u043e\u0442\u0432\u044a\u0440\u0434\u0438, \u0447\u0435 \u043d\u0435 \u0441\u0438 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0437\u0438\u0440\u0430\u043d \u043a\u043b\u0438\u0435\u043d\u0442.';
const DOWNSTREAM_MESSAGES = {
	login: '\u041d\u0435\u0432\u0430\u043b\u0438\u0434\u0435\u043d \u0438\u043c\u0435\u0439\u043b \u0438\u043b\u0438 \u043f\u0430\u0440\u043e\u043b\u0430.',
	register:
		'\u041f\u0440\u043e\u0444\u0438\u043b\u044a\u0442 \u043d\u0435 \u043c\u043e\u0436\u0430 \u0434\u0430 \u0431\u044a\u0434\u0435 \u0441\u044a\u0437\u0434\u0430\u0434\u0435\u043d. \u041f\u0440\u043e\u0432\u0435\u0440\u0438 \u0434\u0430\u043d\u043d\u0438\u0442\u0435 \u0438\u043b\u0438 \u043e\u043f\u0438\u0442\u0430\u0439 \u043f\u043e-\u043a\u044a\u0441\u043d\u043e.'
};

/** @typedef {'login' | 'register'} EvidenceAction */
/** @typedef {{ type: 'failure'; status: number; data: { message: string } }} ActionFailureEnvelope */
/** @typedef {{ email: string; password: string; username: string }} EvidenceIdentity */
/**
 * @typedef {
 *   | { check: string; status: number }
 *   | { check: string; actionStatus: number }
 *   | { check: string; outcome: 'deferred'; reason: string }
 * } EvidenceReceipt
 */
/**
 * @typedef {{
 *   origin: string;
 *   expectedGitSha: string;
 *   supabaseSettingsUrl: string;
 *   supabasePublishableKey: string;
 *   requireDisabledSignup?: boolean;
 *   timeoutMs?: number;
 *   fetchImpl?: typeof fetch;
 *   logger?: Pick<Console, 'log' | 'warn'>;
 * }} TurnstileEvidenceOptions
 */

class TurnstileEvidenceError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'TurnstileEvidenceError';
	}
}

/**
 * @param {unknown} condition
 * @param {string} message
 */
function assertEvidence(condition, message) {
	if (!condition) throw new TurnstileEvidenceError(message);
}

/** @param {string} rawOrigin */
function normalizeOrigin(rawOrigin) {
	let parsed;
	try {
		parsed = new URL(rawOrigin);
	} catch {
		throw new TypeError('The staging Turnstile origin must be an absolute HTTP(S) URL.');
	}

	if (!['http:', 'https:'].includes(parsed.protocol)) {
		throw new TypeError('The staging Turnstile origin must use HTTP or HTTPS.');
	}
	if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
		throw new TypeError(
			'The staging Turnstile origin cannot contain credentials, a path, query, or hash.'
		);
	}
	return parsed.origin;
}

/** @param {string} value */
function normalizeExpectedGitSha(value) {
	const normalized = value.trim();
	if (!/^[0-9a-f]{40}$/.test(normalized)) {
		throw new TypeError('EXPECTED_GIT_SHA must be an exact lowercase 40-character Git SHA.');
	}
	return normalized;
}

/** @param {string} rawOrigin */
export function validateHostedStagingTurnstileOrigin(rawOrigin) {
	const origin = normalizeOrigin(rawOrigin);
	const parsed = new URL(origin);
	if (
		parsed.protocol !== 'https:' ||
		parsed.hostname !== EXPECTED_STAGING_HOST ||
		parsed.port !== ''
	) {
		throw new TypeError(
			`Refusing to verify an unexpected host. Expected https://${EXPECTED_STAGING_HOST}.`
		);
	}
	return origin;
}

/** @param {string} rawUrl */
function validateHostedSupabaseSettingsUrl(rawUrl) {
	let parsed;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new TypeError('The staging Supabase settings URL must be absolute.');
	}

	if (
		parsed.protocol !== 'https:' ||
		parsed.hostname !== EXPECTED_SUPABASE_HOST ||
		parsed.port !== '' ||
		parsed.pathname !== '/auth/v1/settings' ||
		parsed.search ||
		parsed.hash ||
		parsed.username ||
		parsed.password
	) {
		throw new TypeError(`Refusing unexpected Supabase settings target: ${EXPECTED_SUPABASE_HOST}.`);
	}
	return parsed.href;
}

/**
 * @param {string} body
 * @param {string} context
 * @returns {ActionFailureEnvelope}
 */
function parseActionEnvelope(body, context) {
	/** @type {any} */
	let envelope;
	try {
		envelope = JSON.parse(body);
		if (typeof envelope.data === 'string') envelope.data = parseDevalue(envelope.data);
	} catch {
		throw new TurnstileEvidenceError(`${context}: response is not a valid SvelteKit action envelope.`);
	}

	assertEvidence(envelope?.type === 'failure', `${context}: expected a failure action envelope.`);
	assertEvidence(envelope.status === 400, `${context}: expected embedded action status 400.`);
	assertEvidence(
		typeof envelope.data?.message === 'string' && envelope.data.message.length > 0,
		`${context}: failure message is missing.`
	);
	return /** @type {ActionFailureEnvelope} */ (envelope);
}

/**
 * @param {EvidenceAction} action
 * @param {EvidenceIdentity} identity
 * @param {string | undefined} token
 */
function actionForm(action, identity, token) {
	const form = new URLSearchParams({
		email: identity.email,
		password: identity.password,
		next: '/dashboard'
	});

	if (action === 'register') {
		form.set('username', identity.username);
		form.set('kind', 'private');
		form.set('ageAccepted', 'on');
	}
	if (token) form.set('cf-turnstile-response', token);
	return form;
}

/** @param {EvidenceAction} action */
function createEvidenceIdentity(action) {
	const identityId = randomUUID();
	return {
		email: `a7-${action}-${identityId}@example.invalid`,
		password: `A7-${randomUUID()}-xY9!`,
		username: `a7_${identityId.replaceAll('-', '').slice(0, 16)}`
	};
}

/**
 * @param {{
 *   fetchImpl: typeof fetch;
 *   origin: string;
 *   expectedGitSha: string;
 *   action: EvidenceAction;
 *   identity: EvidenceIdentity;
 *   token?: string;
 *   timeoutMs: number;
 * }} options
 */
async function postAction({ fetchImpl, origin, expectedGitSha, action, identity, token, timeoutMs }) {
	const path = `/login?/${action}`;
	const context = `POST ${path} (${token ? 'testing token' : 'missing token'})`;
	const response = await fetchImpl(new URL(path, origin), {
		method: 'POST',
		headers: {
			accept: 'application/json',
			'content-type': 'application/x-www-form-urlencoded',
			origin,
			referer: `${origin}/login`,
			'user-agent': 'perfume-marketplace-staging-turnstile-evidence/1.0',
			'x-sveltekit-action': 'true'
		},
		body: actionForm(action, identity, token),
		redirect: 'manual',
		signal: AbortSignal.timeout(timeoutMs)
	});

	assertEvidence(response.status === 200, `${context}: expected transport HTTP 200.`);
	assertEvidence(
		response.headers.get('x-deployed-git-sha') === expectedGitSha,
		`${context}: deployed Git SHA does not match.`
	);
	assertEvidence(Boolean(response.headers.get('x-request-id')), `${context}: request ID is missing.`);
	return parseActionEnvelope(await response.text(), context);
}

/**
 * @param {{
 *   fetchImpl: typeof fetch;
 *   supabaseSettingsUrl: string;
 *   supabasePublishableKey: string;
 *   timeoutMs: number;
 * }} options
 */
async function readSignupState({
	fetchImpl,
	supabaseSettingsUrl,
	supabasePublishableKey,
	timeoutMs
}) {
	const response = await fetchImpl(supabaseSettingsUrl, {
		headers: {
			accept: 'application/json',
			apikey: supabasePublishableKey,
			'user-agent': 'perfume-marketplace-staging-turnstile-evidence/1.0'
		},
		signal: AbortSignal.timeout(timeoutMs)
	});
	assertEvidence(response.status === 200, 'Supabase Auth settings must return HTTP 200.');

	/** @type {{ disable_signup?: boolean }} */
	let settings;
	try {
		settings = await response.json();
	} catch {
		throw new TurnstileEvidenceError('Supabase Auth settings response is not valid JSON.');
	}
	assertEvidence(
		typeof settings?.disable_signup === 'boolean',
		'Supabase Auth settings must declare disable_signup.'
	);
	return { disabled: settings.disable_signup, status: response.status };
}

/** @param {TurnstileEvidenceOptions} options */
export async function runStagingTurnstileEvidence(options) {
	const origin = normalizeOrigin(options.origin);
	const expectedGitSha = normalizeExpectedGitSha(options.expectedGitSha);
	const timeoutMs = Number(options.timeoutMs ?? 10_000);
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
		throw new TypeError('timeoutMs must be an integer from 1000 through 60000.');
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const logger = options.logger ?? console;

	const signupBefore = await readSignupState({
		fetchImpl,
		supabaseSettingsUrl: options.supabaseSettingsUrl,
		supabasePublishableKey: options.supabasePublishableKey,
		timeoutMs
	});
	if (options.requireDisabledSignup === true) {
		assertEvidence(signupBefore.disabled, 'Public Supabase signup must remain disabled.');
	}

	/** @type {EvidenceReceipt[]} */
	const receipts = [
		{
			check: `supabase-signup-${signupBefore.disabled ? 'disabled' : 'enabled'}-before`,
			status: signupBefore.status
		}
	];
	/** @type {EvidenceAction[]} */
	const actions = signupBefore.disabled ? ['login', 'register'] : ['login'];

	for (const action of actions) {
		const identity = createEvidenceIdentity(action);
		const missing = await postAction({
			fetchImpl,
			origin,
			expectedGitSha,
			action,
			identity,
			timeoutMs
		});
		assertEvidence(
			missing.data.message === TURNSTILE_REJECTION_MESSAGE,
			`${action}: expected the exact Turnstile rejection branch.`
		);
		receipts.push({ check: `${action}-missing-token`, actionStatus: missing.status });

		const testing = await postAction({
			fetchImpl,
			origin,
			expectedGitSha,
			action,
			identity,
			token: CLOUDFLARE_DUMMY_TOKEN,
			timeoutMs
		});
		assertEvidence(
			testing.data.message === DOWNSTREAM_MESSAGES[action],
			`${action}: official testing token did not reach the downstream Auth branch.`
		);
		receipts.push({ check: `${action}-testing-token`, actionStatus: testing.status });
	}
	if (signupBefore.disabled) {
		const signupAfter = await readSignupState({
			fetchImpl,
			supabaseSettingsUrl: options.supabaseSettingsUrl,
			supabasePublishableKey: options.supabasePublishableKey,
			timeoutMs
		});
		assertEvidence(
			signupAfter.disabled,
			'Public Supabase signup changed during registration evidence.'
		);
		receipts.push({ check: 'supabase-signup-disabled-after', status: signupAfter.status });
	} else {
		receipts.push({
			check: 'register-testing-token',
			outcome: 'deferred',
			reason: 'public-signup-enabled'
		});
	}
	receipts.push({
		check: 'report-submit-testing-token',
		outcome: 'deferred',
		reason: 'authenticated-actor-requires-later-gate'
	});

	for (const receipt of receipts) {
		if ('actionStatus' in receipt) logger.log(`${receipt.check} -> ${receipt.actionStatus}`);
		else if ('status' in receipt) logger.log(`${receipt.check} -> ${receipt.status}`);
		else logger.log(`${receipt.check} -> ${receipt.outcome}:${receipt.reason}`);
	}
	logger.log(
		`Staging Turnstile action evidence completed against ${new URL(origin).hostname}; report_submit remains deferred to the approved authenticated-actor gate.`
	);
	return receipts;
}

/**
 * @param {string[]} argumentsList
 * @returns {Record<string, string>}
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

/**
 * @param {string | undefined} value
 * @param {string} name
 */
function parseBooleanOption(value, name) {
	if (value === undefined || value === 'false') return false;
	if (value === 'true') return true;
	throw new TypeError(`${name} must be true or false.`);
}

async function main() {
	const cli = parseCliOptions(process.argv.slice(2));
	const origin = validateHostedStagingTurnstileOrigin(
		cli.origin ?? process.env.STAGING_ORIGIN ?? ''
	);
	const wrangler = /** @type {any} */ (JSON.parse(
		await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
	));
	const stagingVariables = wrangler?.env?.staging?.vars ?? {};
	const supabaseSettingsUrl = validateHostedSupabaseSettingsUrl(
		`${stagingVariables.PUBLIC_SUPABASE_URL ?? ''}/auth/v1/settings`
	);
	const supabasePublishableKey = stagingVariables.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	assertEvidence(
		typeof supabasePublishableKey === 'string' && supabasePublishableKey.length > 0,
		'Staging Supabase publishable key is missing from Wrangler configuration.'
	);

	await runStagingTurnstileEvidence({
		origin,
		expectedGitSha: cli['expected-git-sha'] ?? process.env.EXPECTED_GIT_SHA ?? '',
		supabaseSettingsUrl,
		supabasePublishableKey,
		requireDisabledSignup: parseBooleanOption(
			cli['require-disabled-signup'] ?? process.env.A7_REQUIRE_DISABLED_SIGNUP,
			'A7_REQUIRE_DISABLED_SIGNUP'
		),
		timeoutMs: Number(cli['timeout-ms'] ?? process.env.STAGING_SMOKE_TIMEOUT_MS ?? 10_000)
	});
}

const isCli =
	Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
	main().catch((cause) => {
		const message = cause instanceof Error ? cause.message : 'Unknown Turnstile evidence failure.';
		console.error(`Staging Turnstile evidence failed: ${message}`);
		process.exitCode = 1;
	});
}
