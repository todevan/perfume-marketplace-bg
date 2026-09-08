import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve
} from 'node:path';
import process from 'node:process';
import { seedCatalog } from './seed-catalog.mjs';

/**
 * @typedef {{
 *   id?: string;
 *   ref?: string;
 *   linked?: boolean;
 *   organization_id?: string;
 *   region?: string;
 *   status?: string;
 *   database?: {
 *     postgres_engine?: string | number;
 *     version?: string;
 *   };
 * }} SupabaseProject
 *
 * @typedef {{
 *   type?: string;
 *   name?: string;
 *   api_key?: string;
 * }} SupabaseApiKey
 *
 * @typedef {{
 *   readLinkedProjectRef?: () => string;
 *   listProjects?: () => unknown;
 *   listApiKeys?: () => unknown;
 *   runSupabaseCli?: (args: string[], options?: SupabaseCliOptions) => void | Promise<void>;
 *   createPinnedWorkdir?: () => string;
 *   cleanupPinnedWorkdir?: (workdir: string) => void;
 *   seedCatalog?: (options: {
 *     projectUrl: string;
 *     serviceRoleKey: string;
 *     logger: Pick<Console, 'log'>;
 *   }) => Promise<unknown>;
 *   verifyInventoryReceipt?: (environment: NodeJS.ProcessEnv) => void;
 * }} StagingDependencies
 *
 * @typedef {{
 *   environment?: NodeJS.ProcessEnv;
 *   inherit?: boolean;
 *   purpose?: 'inventory' | 'push';
 *   cwd?: string;
 * }} SupabaseCliOptions
 *
 * @typedef {{
 *   environment?: NodeJS.ProcessEnv;
 *   requireServiceRole?: boolean;
 *   dependencies?: StagingDependencies;
 * }} VerifyStagingOptions
 *
 * @typedef {{
 *   info: (message: string) => void;
 * }} InfoLogger
 *
 * @typedef {{
 *   environment?: NodeJS.ProcessEnv;
 *   dependencies?: StagingDependencies;
 *   logger?: InfoLogger;
 * }} RunStagingOptions
 *
 * @typedef {{
 *   sourceSupabaseDirectory?: string;
 *   temporaryBase?: string;
 * }} PinnedWorkdirOptions
 *
 * @typedef {{
 *   ref?: unknown;
 *   role?: unknown;
 *   [key: string]: unknown;
 * }} JwtPayload
 */

export const STAGING_PROJECT = Object.freeze({
	ref: 'nuhkpqjjyuygiemrxbdp',
	organizationId: 'khazvscqabwvslnphbqp',
	region: 'eu-central-1',
	postgresMajor: 17,
	status: 'ACTIVE_HEALTHY',
	url: 'https://nuhkpqjjyuygiemrxbdp.supabase.co'
});

export const FORBIDDEN_PROJECT_REFS = Object.freeze(['zllqwlekadiuyejgbuxc']);

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceSupabaseDirectory = resolve(workspace, 'supabase');
const projectRefPath = resolve(workspace, 'supabase/.temp/project-ref');
const supabaseLauncher = resolve(workspace, 'node_modules/supabase/dist/supabase.js');
const PINNED_WORKDIR_PREFIX = 'perfume-marketplace-staging-';
const BASE_CHILD_ENVIRONMENT_KEYS = Object.freeze([
	'APPDATA',
	'CI',
	'ComSpec',
	'COMSPEC',
	'GITHUB_ACTIONS',
	'HOME',
	'HTTP_PROXY',
	'HTTPS_PROXY',
	'LANG',
	'LC_ALL',
	'LOCALAPPDATA',
	'NO_COLOR',
	'NO_PROXY',
	'Path',
	'PATH',
	'PATHEXT',
	'SSL_CERT_DIR',
	'SSL_CERT_FILE',
	'SystemDrive',
	'SystemRoot',
	'SYSTEMROOT',
	'TEMP',
	'TERM',
	'TMP',
	'TMPDIR',
	'USERPROFILE',
	'WINDIR',
	'XDG_CACHE_HOME',
	'XDG_CONFIG_HOME',
	'http_proxy',
	'https_proxy',
	'no_proxy'
]);

export class StagingTargetError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'StagingTargetError';
	}
}

const REQUIRED_INVENTORY_CATEGORIES = Object.freeze([
	'application_rows',
	'auth_configuration',
	'auth_users',
	'database_objects',
	'edge_functions',
	'extensions',
	'migrations',
	'realtime',
	'scheduled_jobs',
	'secrets',
	'storage'
]);

/** @param {NodeJS.ProcessEnv} environment */
export function verifyStagingInventoryReceipt(environment) {
	const receiptPath = requiredEnvironmentValue(environment, 'STAGING_INVENTORY_RECEIPT_PATH');
	const expectedHash = requiredEnvironmentValue(environment, 'STAGING_INVENTORY_RECEIPT_SHA256');
	if (!isAbsolute(receiptPath) || !/^[a-f0-9]{64}$/iu.test(expectedHash)) {
		throw new StagingTargetError('The staging inventory receipt path/hash is invalid.');
	}
	let bytes;
	try {
		bytes = readFileSync(receiptPath);
	} catch {
		throw new StagingTargetError('The staging inventory receipt cannot be read.');
	}
	const actualHash = createHash('sha256').update(bytes).digest('hex');
	if (actualHash !== expectedHash.toLowerCase()) {
		throw new StagingTargetError('The staging inventory receipt hash does not match.');
	}
	let receipt;
	try {
		receipt = JSON.parse(bytes.toString('utf8'));
	} catch {
		throw new StagingTargetError('The staging inventory receipt is not valid JSON.');
	}
	const age = Date.now() - Date.parse(receipt?.createdAt ?? '');
	const categories = Array.isArray(receipt?.completeCategories)
		? [...receipt.completeCategories].sort()
		: [];
	if (
		receipt?.projectRef !== STAGING_PROJECT.ref ||
		!Number.isFinite(age) ||
		age < -5 * 60_000 ||
		age > 30 * 60_000 ||
		receipt?.stopConditionsClear !== true ||
		receipt?.containsRealData !== false ||
		receipt?.publicSignupEnabled !== true ||
		!Array.isArray(receipt?.unexpectedObjects) ||
		receipt.unexpectedObjects.length !== 0 ||
		JSON.stringify(categories) !== JSON.stringify([...REQUIRED_INVENTORY_CATEGORIES].sort())
	) {
		throw new StagingTargetError(
			'The staging inventory receipt is incomplete, stale, or reports a stop condition.'
		);
	}
}

/**
 * @param {NodeJS.ProcessEnv} environment
 * @param {string} key
 */
function requiredEnvironmentValue(environment, key) {
	const value = environment[key]?.trim();
	if (!value) {
		throw new StagingTargetError(`${key} is required for every hosted staging command.`);
	}
	return value;
}

/**
 * Builds the smallest practical environment for the Supabase CLI. Application,
 * browser, email, payment, and service-role secrets are never inherited.
 *
 * @param {NodeJS.ProcessEnv} environment
 * @param {'inventory' | 'push'} purpose
 * @returns {NodeJS.ProcessEnv}
 */
export function buildSupabaseCliEnvironment(environment, purpose) {
	/** @type {NodeJS.ProcessEnv} */
	const childEnvironment = {};
	for (const key of BASE_CHILD_ENVIRONMENT_KEYS) {
		const value = environment[key];
		if (value !== undefined) childEnvironment[key] = value;
	}

	const accessToken = environment.SUPABASE_ACCESS_TOKEN;
	if (accessToken !== undefined) {
		childEnvironment.SUPABASE_ACCESS_TOKEN = accessToken;
	}
	if (purpose === 'push') {
		const databasePassword = environment.SUPABASE_DB_PASSWORD;
		if (databasePassword !== undefined) {
			childEnvironment.SUPABASE_DB_PASSWORD = databasePassword;
		}
	}
	return childEnvironment;
}

/**
 * @param {string[]} args
 * @param {SupabaseCliOptions} [options]
 * @returns {string}
 */
function runSupabaseCli(
	args,
	{
		environment = process.env,
		inherit = false,
		purpose = 'inventory',
		cwd = workspace
	} = {}
) {
	const result = spawnSync(process.execPath, [supabaseLauncher, ...args], {
		cwd,
		encoding: inherit ? undefined : 'utf8',
		env: buildSupabaseCliEnvironment(environment, purpose),
		stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']
	});

	if (result.error || result.status !== 0) {
		throw new StagingTargetError(
			'The Supabase CLI command failed closed. No provider output was echoed because it may contain credentials.'
		);
	}

	if (typeof result.stdout === 'string') return result.stdout;
	return result.stdout?.toString('utf8') ?? '';
}

/**
 * @param {string[]} args
 * @param {SupabaseCliOptions} [options]
 * @returns {unknown}
 */
function runSupabaseJson(args, options) {
	const output = runSupabaseCli(args, options);
	try {
		return JSON.parse(output);
	} catch {
		throw new StagingTargetError(
			'The Supabase CLI returned an invalid response. No hosted operation was started.'
		);
	}
}

function readLinkedProjectRef() {
	try {
		return readFileSync(projectRefPath, 'utf8').trim();
	} catch (error) {
		if (
			typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			error.code === 'ENOENT'
		) {
			throw new StagingTargetError(
				'No official Supabase link is present. Link the Frankfurt project before any hosted command.'
			);
		}
		throw error;
	}
}

/**
 * @param {string} path
 * @param {string} label
 */
function requiredTrimmedFile(path, label) {
	try {
		const value = readFileSync(path, 'utf8').trim();
		if (!value) throw new Error();
		return value;
	} catch {
		throw new StagingTargetError(`The pinned Supabase workdir is missing ${label}.`);
	}
}

/**
 * @param {string} workdir
 */
export function validatePinnedSupabaseWorkdir(workdir) {
	const pinnedSupabase = resolve(workdir, 'supabase');
	const pinnedTemp = resolve(pinnedSupabase, '.temp');
	const pinnedRef = requiredTrimmedFile(
		resolve(pinnedTemp, 'project-ref'),
		'the project ref'
	);
	if (pinnedRef !== STAGING_PROJECT.ref) {
		throw new StagingTargetError(
			'The pinned Supabase workdir does not target the verified Frankfurt project.'
		);
	}

	const poolerValue = requiredTrimmedFile(
		resolve(pinnedTemp, 'pooler-url'),
		'the pooler URL'
	);
	let pooler;
	try {
		pooler = new URL(poolerValue);
	} catch {
		throw new StagingTargetError('The pinned Supabase workdir has an invalid pooler URL.');
	}
	const poolerUsername = decodeURIComponent(pooler.username);
	if (
		!['postgres:', 'postgresql:'].includes(pooler.protocol) ||
		!pooler.hostname.endsWith('.pooler.supabase.com') ||
		!pooler.hostname.includes(STAGING_PROJECT.region) ||
		poolerUsername !== `postgres.${STAGING_PROJECT.ref}`
	) {
		throw new StagingTargetError(
			'The pinned Supabase pooler does not target the verified Frankfurt project.'
		);
	}

	const postgresVersion = requiredTrimmedFile(
		resolve(pinnedTemp, 'postgres-version'),
		'the PostgreSQL version'
	);
	if (Number(postgresVersion.match(/^\d+/u)?.[0]) !== STAGING_PROJECT.postgresMajor) {
		throw new StagingTargetError(
			'The pinned Supabase workdir does not use PostgreSQL major version 17.'
		);
	}

	const linkedProjectPath = resolve(pinnedTemp, 'linked-project.json');
	if (existsSync(linkedProjectPath)) {
		let linkedProject;
		try {
			linkedProject = JSON.parse(readFileSync(linkedProjectPath, 'utf8'));
		} catch {
			throw new StagingTargetError(
				'The pinned Supabase workdir has invalid linked-project metadata.'
			);
		}
		if (
			linkedProject?.ref !== STAGING_PROJECT.ref ||
			linkedProject?.organization_id !== STAGING_PROJECT.organizationId
		) {
			throw new StagingTargetError(
				'The pinned Supabase metadata does not match the verified Frankfurt project.'
			);
		}
	}

	if (
		!existsSync(resolve(pinnedSupabase, 'config.toml')) ||
		!existsSync(resolve(pinnedSupabase, 'migrations'))
	) {
		throw new StagingTargetError(
			'The pinned Supabase workdir is missing configuration or migrations.'
		);
	}
	return resolve(workdir);
}

/**
 * Removes only a directory created under the configured temporary base with
 * the operator's fixed prefix.
 *
 * @param {string} workdir
 * @param {string} [temporaryBase]
 */
export function cleanupPinnedSupabaseWorkdir(workdir, temporaryBase = tmpdir()) {
	const resolvedBase = resolve(temporaryBase);
	const resolvedWorkdir = resolve(workdir);
	const pathWithinBase = relative(resolvedBase, resolvedWorkdir);
	if (
		!pathWithinBase ||
		pathWithinBase.startsWith('..') ||
		isAbsolute(pathWithinBase) ||
		!basename(resolvedWorkdir).startsWith(PINNED_WORKDIR_PREFIX)
	) {
		throw new StagingTargetError('Refusing to clean an unrecognized temporary workdir.');
	}
	rmSync(resolvedWorkdir, { recursive: true, force: true });
}

/**
 * Copies the verified link and migration snapshot into an isolated workdir.
 * Destination metadata is re-validated, closing a relink race between target
 * verification and the actual `db push`.
 *
 * @param {PinnedWorkdirOptions} [options]
 */
export function createPinnedSupabaseWorkdir({
	sourceSupabaseDirectory: sourceDirectory = sourceSupabaseDirectory,
	temporaryBase = tmpdir()
} = {}) {
	const resolvedSource = resolve(sourceDirectory);
	const resolvedTemporaryBase = resolve(temporaryBase);
	const workdir = mkdtempSync(join(resolvedTemporaryBase, PINNED_WORKDIR_PREFIX));
	try {
		try {
			chmodSync(workdir, 0o700);
		} catch {
			// Windows ACLs are inherited; the unpredictable directory name and
			// immediate cleanup still limit exposure.
		}

		const destination = resolve(workdir, 'supabase');
		mkdirSync(destination);
		copyFileSync(
			resolve(resolvedSource, 'config.toml'),
			resolve(destination, 'config.toml')
		);
		cpSync(resolve(resolvedSource, 'migrations'), resolve(destination, 'migrations'), {
			recursive: true
		});
		cpSync(resolve(resolvedSource, '.temp'), resolve(destination, '.temp'), {
			recursive: true
		});
		// config.toml resolves Auth template content_path values and function
		// declarations relative to the copied Supabase directory. Copy only
		// those runtime inputs; branches, tests, and snippets are unnecessary.
		for (const optionalDirectory of ['templates', 'functions']) {
			const sourceDirectory = resolve(resolvedSource, optionalDirectory);
			if (existsSync(sourceDirectory)) {
				cpSync(sourceDirectory, resolve(destination, optionalDirectory), {
					recursive: true
				});
			}
		}
		for (const optionalFile of ['roles.sql', 'seed.sql']) {
			const sourceFile = resolve(resolvedSource, optionalFile);
			if (existsSync(sourceFile)) {
				copyFileSync(sourceFile, resolve(destination, optionalFile));
			}
		}

		return validatePinnedSupabaseWorkdir(workdir);
	} catch (error) {
		cleanupPinnedSupabaseWorkdir(workdir, resolvedTemporaryBase);
		if (error instanceof StagingTargetError) throw error;
		throw new StagingTargetError(
			'Unable to create the isolated Supabase staging workdir.'
		);
	}
}

/** @param {NodeJS.ProcessEnv} environment */
function listProjects(environment) {
	return runSupabaseJson(['projects', 'list', '--output', 'json'], { environment });
}

/** @param {NodeJS.ProcessEnv} environment */
function listApiKeys(environment) {
	// This output contains credentials and therefore remains captured in memory.
	// Neither successful nor failed command output is ever forwarded to logs.
	return runSupabaseJson(
		[
			'projects',
			'api-keys',
			'--project-ref',
			STAGING_PROJECT.ref,
			'--output',
			'json'
		],
		{ environment }
	);
}

/** @param {string} value */
function normalizedSupabaseOrigin(value) {
	try {
		const url = new URL(value);
		if (
			url.protocol !== 'https:' ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			(url.pathname !== '/' && url.pathname !== '')
		) {
			throw new Error();
		}
		return url.origin;
	} catch {
		throw new StagingTargetError('PUBLIC_SUPABASE_URL must be a credential-free HTTPS origin.');
	}
}

/** @param {SupabaseProject} project */
function postgresMajor(project) {
	const engine = String(project?.database?.postgres_engine ?? '');
	const engineMatch = engine.match(/^\d+/u);
	if (engineMatch) return Number(engineMatch[0]);

	const version = String(project?.database?.version ?? '');
	const versionMatch = version.match(/^\d+/u);
	return versionMatch ? Number(versionMatch[0]) : Number.NaN;
}

/**
 * @param {SupabaseApiKey[]} apiKeys
 * @param {string} providedKey
 * @param {string} type
 * @param {string | null} [name]
 */
function apiKeyMatches(apiKeys, providedKey, type, name = null) {
	return apiKeys.some(
		(key) =>
			key?.type === type &&
			(name === null || key?.name === name) &&
			typeof key?.api_key === 'string' &&
			key.api_key === providedKey
	);
}

/**
 * @param {string} value
 * @returns {JwtPayload | null}
 */
function decodeJwtPayload(value) {
	const parts = value.split('.');
	if (parts.length !== 3) return null;

	try {
		return /** @type {JwtPayload} */ (
			JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
		);
	} catch {
		return null;
	}
}

/**
 * @param {NodeJS.ProcessEnv} environment
 * @param {SupabaseApiKey[]} apiKeys
 */
function assertServiceRoleKey(environment, apiKeys) {
	const serviceRoleKey = requiredEnvironmentValue(environment, 'SUPABASE_SERVICE_ROLE_KEY');
	const payload = decodeJwtPayload(serviceRoleKey);

	if (
		payload?.ref !== STAGING_PROJECT.ref ||
		payload?.role !== 'service_role' ||
		!apiKeyMatches(apiKeys, serviceRoleKey, 'legacy', 'service_role')
	) {
		throw new StagingTargetError(
			'SUPABASE_SERVICE_ROLE_KEY does not belong to the allowed Frankfurt staging project.'
		);
	}
}

/** @param {SupabaseProject} project */
function assertProjectMetadata(project) {
	if (project?.organization_id !== STAGING_PROJECT.organizationId) {
		throw new StagingTargetError('The linked project belongs to an unexpected Supabase organization.');
	}
	if (project?.region !== STAGING_PROJECT.region) {
		throw new StagingTargetError('The linked project is not in the required Frankfurt region.');
	}
	if (postgresMajor(project) !== STAGING_PROJECT.postgresMajor) {
		throw new StagingTargetError('The linked project is not running PostgreSQL major version 17.');
	}
	if (project?.status !== STAGING_PROJECT.status) {
		throw new StagingTargetError('The linked project is not ACTIVE_HEALTHY.');
	}
	if (project?.linked !== true) {
		throw new StagingTargetError(
			'The Supabase CLI does not identify the Frankfurt project as the active local link.'
		);
	}
}

/**
 * Verifies every immutable staging identity signal before returning.
 * API keys are compared in memory and are never part of the returned summary.
 *
 * @param {VerifyStagingOptions} [options]
 * @returns {Readonly<typeof STAGING_PROJECT>}
 */
export function verifyStagingTarget({
	environment = process.env,
	requireServiceRole = false,
	dependencies = {}
} = {}) {
	const readRef = dependencies.readLinkedProjectRef ?? readLinkedProjectRef;
	const getProjects = dependencies.listProjects ?? (() => listProjects(environment));
	const getApiKeys = dependencies.listApiKeys ?? (() => listApiKeys(environment));

	const linkedRef = readRef();
	if (!linkedRef) {
		throw new StagingTargetError(
			'No official Supabase link is present. Link the Frankfurt project before any hosted command.'
		);
	}
	if (FORBIDDEN_PROJECT_REFS.includes(linkedRef)) {
		throw new StagingTargetError('The Stockholm project is explicitly forbidden for staging operations.');
	}
	if (linkedRef !== STAGING_PROJECT.ref) {
		throw new StagingTargetError('The linked Supabase project ref is not the allowed staging target.');
	}

	const projects = getProjects();
	if (!Array.isArray(projects)) {
		throw new StagingTargetError('Supabase project inventory has an unexpected shape.');
	}
	const project = /** @type {SupabaseProject | undefined} */ (projects.find(
		(candidate) => candidate?.ref === STAGING_PROJECT.ref || candidate?.id === STAGING_PROJECT.ref
	));
	if (!project) {
		throw new StagingTargetError('The allowed Frankfurt project is absent from Supabase inventory.');
	}
	assertProjectMetadata(project);

	const configuredUrl = normalizedSupabaseOrigin(
		requiredEnvironmentValue(environment, 'PUBLIC_SUPABASE_URL')
	);
	if (configuredUrl !== STAGING_PROJECT.url) {
		throw new StagingTargetError(
			'PUBLIC_SUPABASE_URL does not match the allowed Frankfurt staging project.'
		);
	}

	const publishableKey = requiredEnvironmentValue(
		environment,
		'PUBLIC_SUPABASE_PUBLISHABLE_KEY'
	);
	const apiKeys = getApiKeys();
	if (!Array.isArray(apiKeys)) {
		throw new StagingTargetError('Supabase API-key inventory has an unexpected shape.');
	}
	const typedApiKeys = /** @type {SupabaseApiKey[]} */ (apiKeys);
	if (!apiKeyMatches(typedApiKeys, publishableKey, 'publishable')) {
		throw new StagingTargetError(
			'PUBLIC_SUPABASE_PUBLISHABLE_KEY does not belong to the allowed Frankfurt staging project.'
		);
	}

	if (requireServiceRole) {
		assertServiceRoleKey(environment, typedApiKeys);
	}

	return Object.freeze({
		ref: STAGING_PROJECT.ref,
		organizationId: STAGING_PROJECT.organizationId,
		region: STAGING_PROJECT.region,
		postgresMajor: STAGING_PROJECT.postgresMajor,
		status: STAGING_PROJECT.status,
		url: STAGING_PROJECT.url
	});
}

/**
 * @param {string} command
 * @returns {string[] | null}
 */
export function stagingCommandArguments(command) {
	switch (command) {
		case 'verify-target':
			return null;
		case 'push-dry-run':
			return ['db', 'push', '--linked', '--dry-run'];
		case 'push':
			return ['db', 'push', '--linked', '--yes'];
		case 'seed':
			return null;
		default:
			throw new StagingTargetError(
				'Choose exactly one staging command: verify-target, push-dry-run, push, or seed.'
			);
	}
}

/**
 * @param {string} command
 * @param {RunStagingOptions} [options]
 * @returns {Promise<Readonly<typeof STAGING_PROJECT>>}
 */
export async function runStagingCommand(
	command,
	{
		environment = process.env,
		dependencies = {},
		logger = console
	} = {}
) {
	const commandArguments = stagingCommandArguments(command);
	const requireServiceRole = command === 'seed';
	const target = verifyStagingTarget({
		environment,
		requireServiceRole,
		dependencies
	});
	if (command !== 'verify-target') {
		(dependencies.verifyInventoryReceipt ?? verifyStagingInventoryReceipt)(environment);
	}

	logger.info(
		`Verified hosted target ${target.ref} (${target.region}, PostgreSQL ${target.postgresMajor}, ${target.status}).`
	);

	if (commandArguments) {
		const executeSupabase =
			dependencies.runSupabaseCli ??
			((args, options) => runSupabaseCli(args, options));
		const createWorkdir =
			dependencies.createPinnedWorkdir ?? (() => createPinnedSupabaseWorkdir());
		const cleanupWorkdir =
			dependencies.cleanupPinnedWorkdir ??
			((workdir) => cleanupPinnedSupabaseWorkdir(workdir));
		const pinnedWorkdir = createWorkdir();
		try {
			await executeSupabase(
				[...commandArguments, '--workdir', pinnedWorkdir],
				{
					environment,
					inherit: false,
					purpose: 'push',
					cwd: pinnedWorkdir
				}
			);
			logger.info(
				command === 'push'
					? 'Verified Frankfurt migrations were applied successfully.'
					: 'Verified Frankfurt migration dry-run completed successfully.'
			);
		} catch {
			throw new StagingTargetError(
				'The Supabase staging migration command failed. Provider output was withheld.'
			);
		} finally {
			cleanupWorkdir(pinnedWorkdir);
		}
		return target;
	}

	if (command === 'seed') {
		const executeSeed =
			dependencies.seedCatalog ?? seedCatalog;
		try {
			await executeSeed({
				projectUrl: target.url,
				serviceRoleKey: requiredEnvironmentValue(
					environment,
					'SUPABASE_SERVICE_ROLE_KEY'
				),
				logger: { log: (message) => logger.info(message) }
			});
		} catch {
			throw new StagingTargetError(
				'Staging catalogue seed failed. Inspect trusted operator logs.'
			);
		}
	}

	return target;
}

async function main() {
	try {
		process.loadEnvFile?.('.env');
	} catch (error) {
		if (
			!(
				typeof error === 'object' &&
				error !== null &&
				'code' in error &&
				error.code === 'ENOENT'
			)
		) {
			throw error;
		}
	}

	await runStagingCommand(process.argv[2] ?? '');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === resolve(fileURLToPath(import.meta.url))) {
	main().catch((error) => {
		const message =
			error instanceof StagingTargetError
				? error.message
				: 'The staging database command failed closed.';
		console.error(message);
		process.exitCode = 1;
	});
}
