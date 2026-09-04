import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

/** @typedef {Record<string, string | undefined>} OperatorEnvironment */
/** @typedef {string[]} CommandArgs */
/** @typedef {{ stdout: string; stderr: string }} ExecFileResult */
/** @typedef {{ path: string, sha256: string }} TrackedFileSnapshot */
/** @typedef {readonly TrackedFileSnapshot[]} TrackedSurface */
/**
 * @typedef {{
 *   [key: string]: unknown,
 *   name?: string,
 *   workers_dev?: boolean,
 *   keep_vars?: boolean,
 *   observability?: {
 *     [key: string]: unknown,
 *     enabled?: boolean,
 *     logs?: {
 *       [key: string]: unknown,
 *       enabled?: boolean,
 *       invocation_logs?: boolean,
 *       persist?: boolean
 *     },
 *     traces?: {
 *       [key: string]: unknown,
 *       enabled?: boolean,
 *       persist?: boolean
 *     }
 *   },
 *   vars?: {
 *     [key: string]: string | undefined,
 *     RELEASE_COMMIT_SHA?: string
 *   },
 *   images?: unknown,
 *   routes?: unknown,
 *   route?: unknown
 * }} WranglerTemplateConfig */
/**
 * @typedef {{
 *   templatePath: string,
 *   outputPath: string,
 *   workerName: string,
 *   candidateOrigin: string,
 *   expectedSha: string,
 *   supabaseUrl: string,
 *   publishableKey: string
 * }} MaterializeInput */
/** @typedef {{ candidateSha: string, versionId: string, workerName: string }} WranglerDeploymentIdentity */
/**
 * @typedef {{
 *   cwd?: string,
 *   env?: OperatorEnvironment,
 *   exec?: (command: string, args: CommandArgs, options?: Record<string, unknown>) => Promise<ExecFileResult>
 * }} RunChildOptions */
/**
 * @typedef {{ [key: string]: string }} MarkerReplacements */

const execFile = promisify(execFileCallback);
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WORKER_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export class Issue22CandidateError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'Issue22CandidateError';
	}
}

/**
 * @param {string} cwd
 * @param {CommandArgs} args
 * @returns {Promise<ExecFileResult>}
 */
async function git(cwd, args) {
	return execFile('git', args, { cwd, windowsHide: true, encoding: 'utf8' });
}

/** Attest the immutable HEAD and tracked cleanliness without touching untracked WIP. */
/**
 * @param {string} cwd
 * @param {string} expectedSha
 * @returns {Promise<{ headSha: string; trackedClean: true }>}
 */
export async function attestCandidateWorktree(cwd, expectedSha) {
	if (!SHA_PATTERN.test(expectedSha)) {
		throw new Issue22CandidateError('Issue #22 candidate worktree does not match the expected SHA.');
	}
	let headSha;
	try {
		const result = await git(cwd, ['rev-parse', 'HEAD']);
		headSha = result.stdout.trim().toLowerCase();
	} catch {
		throw new Issue22CandidateError('Issue #22 candidate worktree could not be attested.');
	}
	if (headSha !== expectedSha) {
		throw new Issue22CandidateError('Issue #22 candidate worktree does not match the expected SHA.');
	}
	try {
		await git(cwd, ['diff', '--quiet', '--ignore-submodules', '--']);
		await git(cwd, ['diff', '--cached', '--quiet', '--ignore-submodules', '--']);
		const status = await git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']);
		if (status.stdout.length > 0) throw new Error('worktree is not clean');
	} catch {
		throw new Issue22CandidateError('Issue #22 candidate worktree is not clean.');
	}
	return { headSha, trackedClean: true };
}

/**
 * @param {string} cwd
 * @returns {Promise<TrackedSurface>}
 */
async function trackedSurface(cwd) {
	let names;
	try {
		const result = await git(cwd, ['ls-files', '-z']);
		names = result.stdout.split('\0').filter(Boolean);
	} catch {
		throw new Issue22CandidateError('Issue #22 candidate acceptance surface could not be read.');
	}
	const files = [];
	for (const path of names) {
		const body = await readFile(new URL(path.replaceAll('\\', '/'), `file:///${cwd.replaceAll('\\', '/')}/`));
		files.push({ path: path.replaceAll('\\', '/'), sha256: createHash('sha256').update(body).digest('hex') });
	}
	return files;
}

/** Snapshot every tracked input so post-check/build drift cannot reuse stale evidence. */
/**
 * @param {string} cwd
 * @param {string} expectedSha
 * @returns {Promise<{ headSha: string; files: TrackedSurface }>}
 */
export async function snapshotTrackedAcceptanceSurface(cwd, expectedSha) {
	await attestCandidateWorktree(cwd, expectedSha);
	return Object.freeze({ headSha: expectedSha, files: Object.freeze(await trackedSurface(cwd)) });
}

/**
 * @param {string} cwd
 * @param {{ headSha: string; files: TrackedSurface }} snapshot
 */
export async function assertTrackedAcceptanceSurfaceUnchanged(cwd, snapshot) {
	try {
		const head = (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim().toLowerCase();
		const files = await trackedSurface(cwd);
		const status = await git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']);
		if (head !== snapshot.headSha || status.stdout.length > 0 || JSON.stringify(files) !== JSON.stringify(snapshot.files)) {
			throw new Error('surface changed');
		}
	} catch {
		throw new Issue22CandidateError('Issue #22 candidate acceptance surface changed.');
	}
}

/** Wrangler must fall back to its encrypted OAuth profile, not a stale machine token. */
/**
 * @param {OperatorEnvironment} [environment]
 * @returns {OperatorEnvironment}
 */
export function buildWranglerChildEnvironment(environment = process.env) {
	const child = { ...environment };
	delete child.CLOUDFLARE_API_TOKEN;
	return child;
}

/** Every other privileged child receives only explicitly named variables. */
/**
 * @param {OperatorEnvironment} environment
 * @param {string[]} allowlist
 * @returns {OperatorEnvironment}
 */
export function buildAllowlistedChildEnvironment(environment, allowlist) {
	return Object.fromEntries(
		allowlist
			.filter((name) => Object.prototype.hasOwnProperty.call(environment, name))
			.map((name) => [name, environment[name]])
	);
}

/**
 * @param {Record<string, unknown>} actual
 * @param {WranglerDeploymentIdentity} expected
 * @returns {WranglerDeploymentIdentity}
 */
export function assertWranglerDeploymentIdentity(actual, expected) {
	const workerName = actual?.workerName;
	const versionId = actual?.versionId;
	const candidateSha = actual?.candidateSha;
	if (
		typeof workerName !== 'string' ||
		typeof versionId !== 'string' ||
		typeof candidateSha !== 'string' ||
		!WORKER_NAME_PATTERN.test(workerName) ||
		!UUID_PATTERN.test(versionId) ||
		!SHA_PATTERN.test(candidateSha) ||
		workerName !== expected.workerName ||
		versionId !== expected.versionId ||
		candidateSha !== expected.candidateSha
	) {
		throw new Issue22CandidateError('Issue #22 Wrangler deployment identity is invalid.');
	}
	return { workerName, versionId, candidateSha };
}

/**
 * @param {unknown} value
 * @param {MarkerReplacements} replacements
 * @returns {unknown}
 */
function replaceMarkers(value, replacements) {
	if (Array.isArray(value)) return value.map((entry) => replaceMarkers(entry, replacements));
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, replaceMarkers(entry, replacements)])
		);
	}
	if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(replacements, value)) {
		return replacements[value];
	}
	return value;
}

/**
 * @param {WranglerTemplateConfig} config
 * @returns {WranglerTemplateConfig}
 */
export function validateWranglerConfig(config) {
	if (
		!WORKER_NAME_PATTERN.test(config?.name ?? '') ||
		config?.workers_dev !== true ||
		config?.keep_vars !== false ||
		config?.observability?.enabled !== false ||
		config?.observability?.logs?.enabled !== false ||
		config?.observability?.logs?.invocation_logs !== false ||
		config?.observability?.logs?.persist !== false ||
		config?.observability?.traces?.enabled !== false ||
		config?.observability?.traces?.persist !== false ||
		config?.vars?.APP_ENV !== 'development' ||
		config?.vars?.PUBLIC_DEMO_MODE !== 'false' ||
		!SHA_PATTERN.test(config?.vars?.RELEASE_COMMIT_SHA ?? '') ||
		config.images ||
		config.routes ||
		config.route
	) {
		throw new Issue22CandidateError('Issue #22 Wrangler config is not safe.');
	}
	return config;
}

/** Materialize the tracked template into a private run directory. */
/**
 * @param {MaterializeInput} input
 */
export async function materializeWranglerConfig({
	templatePath,
	outputPath,
	workerName,
	candidateOrigin,
	expectedSha,
	supabaseUrl,
	publishableKey
}) {
	let template;
	try {
		template = JSON.parse(await readFile(templatePath, 'utf8'));
	} catch {
		throw new Issue22CandidateError('Issue #22 Wrangler template is invalid.');
	}
	const config = replaceMarkers(template, {
		__ISSUE22_WORKER_NAME__: workerName,
		__ISSUE22_CANDIDATE_ORIGIN__: candidateOrigin,
		__ISSUE22_EXPECTED_SHA__: expectedSha,
		__ISSUE22_SUPABASE_URL__: supabaseUrl,
		__ISSUE22_SUPABASE_PUBLISHABLE_KEY__: publishableKey
	});
	validateWranglerConfig(/** @type {WranglerTemplateConfig} */ (config));
	await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
	return outputPath;
}

/** Run a child without surfacing provider stdout/stderr or secret-bearing errors. */
/**
 * @param {string} command
 * @param {CommandArgs} args
 * @param {RunChildOptions} [options]
 */
export async function runSilentChild(command, args, { cwd, env, exec = execFile } = {}) {
	try {
		await exec(command, args, {
			cwd,
			env,
			windowsHide: true,
			encoding: 'utf8',
			maxBuffer: 1024 * 1024
		});
	} catch {
		throw new Issue22CandidateError('Issue #22 provider child failed safely.');
	}
}
