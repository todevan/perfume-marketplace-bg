import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const RUNNER_FILE = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(RUNNER_FILE), '../..');

const EXACT_MAILTRAP_INBOX_ID = 4_887_168;
const EXACT_MAILTRAP_API_ORIGIN = 'https://mailtrap.io';
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const PROJECT_REF_PATTERN = /^[a-z]{20}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WORKER_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const MAILTRAP_POLL_INTERVAL_MS = 1_000;
const MAILTRAP_POLL_TIMEOUT_MS = 30_000;

const ALLOWED_RUNNER_INPUTS = new Set([
	'ISSUE22_CANDIDATE_ORIGIN',
	'ISSUE22_EXPECTED_SHA',
	'ISSUE22_SUPABASE_URL',
	'ISSUE22_SUPABASE_PUBLISHABLE_KEY',
	'ISSUE22_SUPABASE_PROJECT_ID',
	'ISSUE22_MAILTRAP_READ_TOKEN',
	'ISSUE22_MAILTRAP_API_BASE_URL',
	'ISSUE22_MAILTRAP_ACCOUNT_ID',
	'ISSUE22_MAILTRAP_INBOX_ID',
	'ISSUE22_WORKER_NAME',
	'ISSUE22_WORKER_VERSION_ID',
	'ISSUE22_MANIFEST_TRANSACTION_ID'
]);
const ALLOWED_RUNNER_RUNTIME_INPUTS = Object.freeze([
	'PATH',
	'HOME',
	'TMPDIR',
	'TMP',
	'TEMP',
	'SystemRoot',
	'SYSTEMROOT',
	'COMSPEC',
	'PATHEXT',
	'LOCALAPPDATA',
	'USERPROFILE',
	'APPDATA',
	'PLAYWRIGHT_BROWSERS_PATH'
]);

const FORBIDDEN_RUNNER_INPUT =
	/(?:SUPABASE_(?:SERVICE_ROLE|SECRET|ACCESS_TOKEN|DB_PASSWORD)|CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)|MAILTRAP_(?:SMTP_PASSWORD|MANAGEMENT_TOKEN)|SERVICE_ROLE|MANAGEMENT_CREDENTIAL|DESTRUCTIVE)/iu;
const PRIVATE_ARTIFACT_PATTERN =
	/(?:authorization\s*:|bearer\s+|set-cookie\s*:|cookie\s*:|token_hash=|access[_-]?token|refresh[_-]?token|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/iu;

/** @typedef {Record<string, string | undefined>} RunnerEnvironment */
/** @typedef {'absent' | 'present'} PresenceStatus */
/**
 * @typedef {{
 *   url: string,
 *   projectId: string,
 *   publishableKey: string
 * }} SupabaseConfig
 */
/**
 * @typedef {{
 *   apiBaseUrl: string,
 *   accountId: number,
 *   inboxId: number,
 *   readToken: string
 * }} MailtrapConfig
 */
/**
 * @typedef {{ name: string, versionId: string }} WorkerConfig
 */
/** @typedef {{ candidateOrigin: string, expectedSha: string, supabase: SupabaseConfig, mailtrap: MailtrapConfig, worker: WorkerConfig, transactionId: string }} RunnerConfig */
/**
 * @typedef {{
 *   apiBaseUrl: string,
 *   accountId: number,
 *   inboxId: number,
 *   readToken: string,
 *   recipient: string,
 *   runStartedAt: string,
 *   pollIntervalMs: number,
 *   timeoutMs: number
 * }} MailtrapPollConfig
 */
/**
 * @typedef {{
 *   dependencyName?: string,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>
 * }} PollDependencies
 */

export class Issue22RunnerError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'Issue22RunnerError';
	}
}

/** @returns {never} */
function runnerInvalid() {
	throw new Issue22RunnerError('Issue #22 runner configuration is invalid.');
}

/**
 * @param {RunnerEnvironment} environment
 * @param {string} name
 * @returns {string}
 */
function required(environment, name) {
	const value = environment[name];
	if (typeof value !== 'string' || value.trim().length === 0) runnerInvalid();
	return value.trim();
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeHttpsOrigin(value) {
	try {
		const url = new URL(value);
		if (
			url.protocol !== 'https:' ||
			url.username ||
			url.password ||
			url.pathname !== '/' ||
			url.search ||
			url.hash
		) {
			runnerInvalid();
		}
		return url.origin;
	} catch (error) {
		if (error instanceof Issue22RunnerError) throw error;
		runnerInvalid();
	}
}

/** The proof runner accepts only public/browser inputs plus one sandbox-scoped read token. */
/**
 * @param {RunnerEnvironment} [environment]
 * @returns {RunnerConfig}
 */
export function validateRunnerEnvironment(environment = process.env) {
	for (const [name, value] of Object.entries(environment)) {
		if (!value) continue;
		if (FORBIDDEN_RUNNER_INPUT.test(name) || (name.startsWith('ISSUE22_') && !ALLOWED_RUNNER_INPUTS.has(name))) {
			throw new Issue22RunnerError('Issue #22 runner environment is not permitted.');
		}
	}

	const expectedSha = required(environment, 'ISSUE22_EXPECTED_SHA').toLowerCase();
	const projectId = required(environment, 'ISSUE22_SUPABASE_PROJECT_ID').toLowerCase();
	const candidateOrigin = normalizeHttpsOrigin(required(environment, 'ISSUE22_CANDIDATE_ORIGIN'));
	const supabaseUrl = normalizeHttpsOrigin(required(environment, 'ISSUE22_SUPABASE_URL'));
	const apiBaseUrl = normalizeHttpsOrigin(required(environment, 'ISSUE22_MAILTRAP_API_BASE_URL'));
	const workerName = required(environment, 'ISSUE22_WORKER_NAME').toLowerCase();
	const accountId = Number(required(environment, 'ISSUE22_MAILTRAP_ACCOUNT_ID'));
	const inboxId = Number(required(environment, 'ISSUE22_MAILTRAP_INBOX_ID'));
	const versionId = required(environment, 'ISSUE22_WORKER_VERSION_ID');
	const transactionId = required(environment, 'ISSUE22_MANIFEST_TRANSACTION_ID');

	if (
		!SHA_PATTERN.test(expectedSha) ||
		!PROJECT_REF_PATTERN.test(projectId) ||
		supabaseUrl !== `https://${projectId}.supabase.co` ||
		!WORKER_NAME_PATTERN.test(workerName) ||
		!new URL(candidateOrigin).hostname.startsWith(`${workerName}.`) ||
		!new URL(candidateOrigin).hostname.endsWith('.workers.dev') ||
		!Number.isSafeInteger(accountId) ||
		accountId <= 0 ||
		inboxId !== EXACT_MAILTRAP_INBOX_ID ||
		apiBaseUrl !== EXACT_MAILTRAP_API_ORIGIN ||
		!UUID_PATTERN.test(versionId) ||
		!UUID_PATTERN.test(transactionId)
	) {
		runnerInvalid();
	}

	return Object.freeze({
		candidateOrigin,
		expectedSha,
		supabase: Object.freeze({
			url: supabaseUrl,
			publishableKey: required(environment, 'ISSUE22_SUPABASE_PUBLISHABLE_KEY'),
			projectId
		}),
		mailtrap: Object.freeze({
			apiBaseUrl,
			accountId,
			inboxId,
			readToken: required(environment, 'ISSUE22_MAILTRAP_READ_TOKEN')
		}),
		worker: Object.freeze({ name: workerName, versionId }),
		transactionId
	});
}

/** Launch the executable Playwright proof in a process that cannot inherit ambient provider credentials. */
/**
 * @param {RunnerEnvironment} [environment]
 * @param {{ exec?: Function }} [dependencies]
 * @returns {Promise<void>}
 */
export async function launchHostedProofProcess(environment = process.env, dependencies = {}) {
	const names = [...ALLOWED_RUNNER_INPUTS, ...ALLOWED_RUNNER_RUNTIME_INPUTS];
	const childEnvironment = Object.fromEntries(
		names
			.filter((name) => Object.prototype.hasOwnProperty.call(environment, name))
			.map((name) => [name, environment[name]])
	);
	validateRunnerEnvironment(childEnvironment);
	const execute = dependencies.exec ?? execFile;
	try {
		await execute(
			process.execPath,
			[
				join(REPOSITORY_ROOT, 'node_modules/@playwright/test/cli.js'),
				'test',
				'--config',
				join(REPOSITORY_ROOT, 'scripts/issue22-hosted/playwright.config.mjs')
			],
			{
				cwd: REPOSITORY_ROOT,
				env: childEnvironment,
				windowsHide: true,
				encoding: 'utf8',
				maxBuffer: 1024 * 1024
			}
		);
	} catch {
		throw new Issue22RunnerError('Issue #22 executable proof failed safely.');
	}
}

/**
 * @param {string} baseUrl
 * @param {string} path
 * @returns {string}
 */
function safeMailtrapUrl(baseUrl, path) {
	const base = new URL(baseUrl);
	const url = new URL(path, `${base.origin}/`);
	if (
		base.origin !== EXACT_MAILTRAP_API_ORIGIN ||
		url.origin !== EXACT_MAILTRAP_API_ORIGIN ||
		url.username ||
		url.password
	) {
		throw new Issue22RunnerError('Issue #22 Mailtrap proof failed safely.');
	}
	return url.href;
}

/**
 * @param {unknown} payload
 * @returns {Array<{ id: number; to_email?: string; received_at?: string; body_html_url?: string }>}
 */
function messageArray(payload) {
	if (Array.isArray(payload)) return /** @type {Array<{ id: number; to_email?: string; received_at?: string; body_html_url?: string }>} */ (payload);
	if (payload && typeof payload === 'object') {
		const messages = /** @type {{ messages?: unknown }} */ (payload).messages;
		if (Array.isArray(messages)) return /** @type {Array<{ id: number; to_email?: string; received_at?: string; body_html_url?: string }>} */ (messages);
	}
	throw new Issue22RunnerError('Issue #22 Mailtrap proof failed safely.');
}

/**
 * @param {Array<{ id: string | number; to_email?: string; received_at?: string; body_html_url?: string }>} messages
 * @param {string} recipient
 * @param {number} startedAtMs
 * @param {string} baseOrigin
 * @returns {{ id: number }[]}
 */
function exactMessages(messages, recipient, startedAtMs, baseOrigin) {
	const matches = [];
	for (const message of messages) {
		if (message?.body_html_url) {
			let bodyUrl;
			try {
				bodyUrl = new URL(message.body_html_url);
			} catch {
				throw new Issue22RunnerError('Issue #22 Mailtrap proof failed safely.');
			}
			if (bodyUrl.origin !== baseOrigin) {
				throw new Issue22RunnerError('Issue #22 Mailtrap proof failed safely.');
			}
		}
		if (
			message?.to_email === recipient &&
			typeof message.received_at === 'string' &&
			Number.isSafeInteger(Number(message.id)) &&
			Date.parse(message.received_at) >= startedAtMs
		) {
			matches.push({ id: Number(message.id) });
		}
	}
	return matches;
}

/** Poll one exact Mailtrap sandbox with a fixed interval and total deadline. */
/**
 * @param {MailtrapPollConfig} config
 * @param {PollDependencies} [dependencies]
 * @returns {Promise<{ messageId: number; html: string; mailCount: number }>}
 */
export async function pollForConfirmationMessage(config, dependencies = {}) {
	const fetchImpl = dependencies.fetchImpl ?? fetch;
	const now = dependencies.now ?? Date.now;
	const sleep = dependencies.sleep ?? ((duration) => new Promise((resolve) => setTimeout(resolve, duration)));
	const startedAtMs = Date.parse(config.runStartedAt);
	const initialNow = now();
	const deadline = initialNow + config.timeoutMs;
	if (
		!Number.isFinite(startedAtMs) ||
		config.apiBaseUrl !== EXACT_MAILTRAP_API_ORIGIN ||
		!Number.isSafeInteger(config.accountId) ||
		config.accountId <= 0 ||
		config.inboxId !== EXACT_MAILTRAP_INBOX_ID ||
		!Number.isInteger(config.pollIntervalMs) ||
		config.pollIntervalMs <= 0 ||
		!Number.isInteger(config.timeoutMs) ||
		config.timeoutMs < config.pollIntervalMs
	) {
		throw new Issue22RunnerError('Issue #22 Mailtrap proof failed safely.');
	}

	const baseOrigin = new URL(config.apiBaseUrl).origin;
	const listUrl = safeMailtrapUrl(
		config.apiBaseUrl,
		`/api/accounts/${config.accountId}/inboxes/${config.inboxId}/messages`
	);
	while (true) {
		let response;
		let payload;
		try {
			response = await fetchImpl(listUrl, {
				method: 'GET',
				headers: { 'Api-Token': config.readToken, Accept: 'application/json' },
				redirect: 'error'
			});
			if (!response.ok) throw new Error('request failed');
			payload = await response.json();
		} catch {
			throw new Issue22RunnerError('Issue #22 Mailtrap proof failed safely.');
		}

		const matches = exactMessages(messageArray(payload), config.recipient, startedAtMs, baseOrigin);
		if (matches.length > 1) throw new Issue22RunnerError('Issue #22 Mailtrap proof failed safely.');
		if (matches.length === 1) {
			const messageId = matches[0].id;
			const bodyUrl = safeMailtrapUrl(
				config.apiBaseUrl,
				`/api/accounts/${config.accountId}/inboxes/${config.inboxId}/messages/${messageId}/body.html`
			);
			let html;
			try {
				const bodyResponse = await fetchImpl(bodyUrl, {
					method: 'GET',
					headers: { 'Api-Token': config.readToken, Accept: 'text/html' },
					redirect: 'error'
				});
				if (!bodyResponse.ok || new URL(bodyResponse.url || bodyUrl).origin !== baseOrigin) {
					throw new Error('request failed');
				}
				html = await bodyResponse.text();
			} catch {
				throw new Issue22RunnerError('Issue #22 Mailtrap proof failed safely.');
			}

			const current = now();
			if (current >= deadline) throw new Issue22RunnerError('Issue #22 Mailtrap proof timed out.');
			await sleep(Math.min(config.pollIntervalMs, deadline - current));
			let finalPayload;
			try {
				const finalResponse = await fetchImpl(listUrl, {
					method: 'GET',
					headers: { 'Api-Token': config.readToken, Accept: 'application/json' },
					redirect: 'error'
				});
				if (!finalResponse.ok) throw new Error('request failed');
				finalPayload = await finalResponse.json();
			} catch {
				throw new Issue22RunnerError('Issue #22 Mailtrap proof failed safely.');
			}
			const finalMatches = exactMessages(
				messageArray(finalPayload),
				config.recipient,
				startedAtMs,
				baseOrigin
			);
			if (finalMatches.length !== 1 || finalMatches[0].id !== messageId) {
				throw new Issue22RunnerError('Issue #22 Mailtrap proof failed safely.');
			}
			return { messageId, html, mailCount: finalMatches.length };
		}

		const current = now();
		if (current >= deadline) throw new Issue22RunnerError('Issue #22 Mailtrap proof timed out.');
		await sleep(Math.min(config.pollIntervalMs, deadline - current));
	}
}

/**
 * @param {string} value
 * @returns {string}
 */
function decodeHtmlAttribute(value) {
	return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
}

/** Select exactly one same-origin, token-hash email confirmation link. */
/**
 * @param {string} html
 * @param {string} candidateOrigin
 * @returns {string}
 */
export function extractConfirmationLink(html, candidateOrigin) {
	const allowedOrigin = normalizeHttpsOrigin(candidateOrigin);
	const links = [];
	const hrefPattern = /href\s*=\s*(["'])(.*?)\1/giu;
	for (const match of html.matchAll(hrefPattern)) {
		let url;
		try {
			url = new URL(decodeHtmlAttribute(match[2]), allowedOrigin);
		} catch {
			continue;
		}
		if (
			url.pathname === '/auth/confirm' &&
			url.searchParams.has('token_hash') &&
			url.searchParams.get('type') === 'email'
		) {
			links.push(url);
		}
	}
	if (links.length !== 1 || links[0].origin !== allowedOrigin) {
		throw new Issue22RunnerError('Issue #22 confirmation link is invalid.');
	}
	return links[0].href;
}

/** Scan every produced artifact before accepting the proof receipt. */
/**
 * @param {string[]} paths
 * @param {string[]} [sensitiveValues]
 * @returns {Promise<void>}
 */
export async function assertSanitizedArtifacts(paths, sensitiveValues = []) {
	for (const path of paths) {
		let body;
		try {
			body = await readFile(path, 'utf8');
		} catch {
			throw new Issue22RunnerError('Issue #22 artifact scan failed safely.');
		}
		if (PRIVATE_ARTIFACT_PATTERN.test(body)) {
			throw new Issue22RunnerError('Issue #22 artifact contains private material.');
		}
		for (const value of sensitiveValues) {
			if (typeof value === 'string' && value && body.includes(value)) {
				throw new Issue22RunnerError('Issue #22 artifact contains private material.');
			}
		}
	}
}

/**
 * @param {string} origin
 * @param {string} expectedSha
 * @param {(...args: any[]) => Promise<Response>} [fetchImpl]
 * @returns {Promise<void>}
 */
export async function assertRuntimeCandidate(origin, expectedSha, fetchImpl = fetch) {
	let response;
	try {
		response = await fetchImpl(origin, { method: 'GET', redirect: 'manual' });
	} catch {
		throw new Issue22RunnerError('Issue #22 deployed candidate could not be verified.');
	}
	if (!response.ok || response.headers.get('x-deployed-git-sha') !== expectedSha) {
		throw new Issue22RunnerError('Issue #22 deployed candidate does not match the expected SHA.');
	}
}

/**
 * @param {{ expectedSha: string; transactionId: string }} config
 * @returns {{ recipient: string; password: string; username: string; city: string }}
 */
export function createSyntheticIdentity(config) {
	const compact = config.transactionId.replaceAll('-', '');
	return Object.freeze({
		recipient: `issue22-${compact.slice(0, 16)}@example.invalid`,
		password: `I22!${config.expectedSha.slice(0, 16)}-${compact.slice(0, 8)}x`,
		username: `issue22_${compact.slice(0, 16)}`,
		city: 'София'
	});
}

/** Execute the one approved signup-confirm-onboard-access-reuse journey. */
/**
 * @param {RunnerConfig} config
 * @param {{
 *   now: () => number,
 *   assertForgedCaptchaRejected: (identity: { recipient: string; password: string; username: string; city: string }) => Promise<{ denied?: boolean }>,
 *   signup: (identity: { recipient: string; password: string; username: string; city: string }) => Promise<unknown>,
 *   poll: (config: MailtrapPollConfig & { recipient: string }) => Promise<{ messageId: number; html: string; mailCount: number }>,
 *   confirm: (link: string) => Promise<{ redirectedTo?: string }>,
 *   completeOnboarding: (input: { username: string; city: string }) => Promise<unknown>,
 *   assertMarketplaceAccess: () => Promise<unknown>,
 *   reuseConfirmationLink: (link: string) => Promise<{ denied?: boolean }>,
 *   artifactPaths?: string[]
 * }} dependencies
 * @returns {Promise<{ status: 'passed'; candidateSha: string; signupCount: number; mailCount: number; captchaForgery: string; confirmationReuse: string }>}
 */
export async function runHostedJourney(config, dependencies) {
	const identity = createSyntheticIdentity(config);
	const forgery = await dependencies.assertForgedCaptchaRejected(identity);
	if (forgery?.denied !== true) {
		throw new Issue22RunnerError('Issue #22 forged CAPTCHA token was not denied.');
	}
	const runStartedAt = new Date(dependencies.now()).toISOString();
	await dependencies.signup(identity);
	const message = await dependencies.poll({
		...config.mailtrap,
		recipient: identity.recipient,
		runStartedAt,
		pollIntervalMs: MAILTRAP_POLL_INTERVAL_MS,
		timeoutMs: MAILTRAP_POLL_TIMEOUT_MS
	});
	const link = extractConfirmationLink(message.html, config.candidateOrigin);
	const confirmation = await dependencies.confirm(link);
	if (confirmation?.redirectedTo !== '/onboarding') {
		throw new Issue22RunnerError('Issue #22 confirmation did not reach onboarding.');
	}
	await dependencies.completeOnboarding({ username: identity.username, city: identity.city });
	await dependencies.assertMarketplaceAccess();
	const reuse = await dependencies.reuseConfirmationLink(link);
	if (reuse?.denied !== true) {
		throw new Issue22RunnerError('Issue #22 confirmation reuse was not denied.');
	}
	await assertSanitizedArtifacts(dependencies.artifactPaths ?? [], [
		identity.recipient,
		identity.password,
		link,
		config.mailtrap.readToken
	]);
	return Object.freeze({
		status: 'passed',
		candidateSha: config.expectedSha,
		signupCount: 1,
		mailCount: message.mailCount,
		captchaForgery: 'denied',
		confirmationReuse: 'denied'
	});
}

/**
 * @param {string} text
 * @param {string[]} [sensitiveValues]
 */
export function assertSanitizedText(text, sensitiveValues = []) {
	if (PRIVATE_ARTIFACT_PATTERN.test(text)) {
		throw new Issue22RunnerError('Issue #22 diagnostic contains private material.');
	}
	for (const value of sensitiveValues) {
		if (typeof value === 'string' && value && text.includes(value)) {
			throw new Issue22RunnerError('Issue #22 diagnostic contains private material.');
		}
	}
}

if (process.argv[1] && resolve(process.argv[1]) === RUNNER_FILE) {
	try {
		await launchHostedProofProcess();
	} catch {
		process.stderr.write('Issue #22 executable proof failed safely.\n');
		process.exitCode = 1;
	}
}
