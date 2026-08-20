import { createHash, createHmac } from 'node:crypto';
import { readFile, stat, unlink } from 'node:fs/promises';
import { isPromise, isProxy } from 'node:util/types';
import {
	atomicPrivateWrite,
	reservePrivateFile,
	resolveOutsideRepositoryFile
} from './hosted-private-file.mjs';
import { verifyStagingTarget } from './staging-db-operator.mjs';

/** @typedef {Record<string, string | undefined>} OperatorEnvironment */
/** @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient */
/** @typedef {import('@supabase/supabase-js').User} SupabaseUser */
/** @typedef {{ email: string, password: string, username: string }} ActorEnvironmentNames */
/** @typedef {{ email: string, password: string, username: string }} ActorCredentials */
/** @typedef {{ accounts: number, reports: number, uploads: number, objects: number, queueRows: number, foreignArtifacts: number, preExistingAccounts: number }} InventoryCounts */
/** @typedef {{ target: typeof HOSTED_STAGING, runId: string, actorRoles: Readonly<Record<string, Readonly<ActorCredentials>>>, serviceKey: string, provisioningNonce: string, provisionedAfter: string }} HostedOperatorConfig */
/** @typedef {{ role: string, userId: string, createdAt: string, provisioningAttemptId?: string }} ManifestActor */
/** @typedef {{ role: string, provisioningAttemptId: string }} PendingManifestActor */
/** @typedef {{ id: string, actorRole: string }} ManifestReport */
/** @typedef {{ id: string, actorRole: string, uploaderId: string, objectPath: string }} ManifestUpload */
/** @typedef {{ id: number, uploadId: string }} ManifestQueueRow */
/** @typedef {{ targetProjectRef: string, runId: string, provisioningAttemptId: string, credentialStoreId: string, pendingActors: readonly PendingManifestActor[], actors: readonly ManifestActor[], reports: readonly ManifestReport[], uploads: readonly ManifestUpload[], queueRows: readonly ManifestQueueRow[] }} HostedRunManifest */
/** @typedef {{ pendingActors?: readonly PendingManifestActor[], actors?: readonly ManifestActor[], reports?: readonly ManifestReport[], uploads?: readonly ManifestUpload[], queueRows?: readonly ManifestQueueRow[] }} ManifestChanges */
/** @typedef {{ event: string, runId: string, actorRole: string, status: string, boundary: string, actualResult: string, requestId: string, before: Partial<InventoryCounts>, after: Partial<InventoryCounts>, cleanup: string } & Record<string, unknown>} OperatorRecordInput */
/** @typedef {{ info: (record: ReturnType<typeof createSanitizedOperatorRecord>) => void }} OperatorLogger */

const ALLOWED_SERVICE_ROLE_OPERATIONS = new Set(['provision', 'inspect', 'cleanup']);
const ACTOR_CREDENTIAL_NAME_PATTERN =
	/^E2E_REAL_[A-Z0-9_]+_(?:EMAIL|PASSWORD|USERNAME|TOTP_SECRET)$/u;
/** @type {Readonly<Record<string, Readonly<ActorEnvironmentNames>>>} */
const ACTOR_ENVIRONMENT = Object.freeze({
	reporter: Object.freeze({
		email: 'E2E_REAL_REPORTER_EMAIL',
		password: 'E2E_REAL_REPORTER_PASSWORD',
		username: 'E2E_REAL_REPORTER_USERNAME'
	}),
	'cross-user': Object.freeze({
		email: 'E2E_REAL_CROSS_USER_EMAIL',
		password: 'E2E_REAL_CROSS_USER_PASSWORD',
		username: 'E2E_REAL_CROSS_USER_USERNAME'
	}),
	'assigned-moderator': Object.freeze({
		email: 'E2E_REAL_ASSIGNED_MODERATOR_EMAIL',
		password: 'E2E_REAL_ASSIGNED_MODERATOR_PASSWORD',
		username: 'E2E_REAL_ASSIGNED_MODERATOR_USERNAME'
	}),
	'unassigned-moderator': Object.freeze({
		email: 'E2E_REAL_UNASSIGNED_MODERATOR_EMAIL',
		password: 'E2E_REAL_UNASSIGNED_MODERATOR_PASSWORD',
		username: 'E2E_REAL_UNASSIGNED_MODERATOR_USERNAME'
	})
});
const APPROVED_ACTOR_ENVIRONMENT_NAMES = new Set(
	Object.values(ACTOR_ENVIRONMENT).flatMap((names) => Object.values(names))
);
/** @type {readonly (keyof InventoryCounts)[]} */
const INVENTORY_FIELDS = Object.freeze([
	'accounts',
	'reports',
	'uploads',
	'objects',
	'queueRows',
	'foreignArtifacts',
	'preExistingAccounts'
]);
/** @type {readonly (keyof InventoryCounts)[]} */
const MUTABLE_INVENTORY_FIELDS = Object.freeze([
	'accounts',
	'reports',
	'uploads',
	'objects',
	'queueRows'
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_EVENTS = /^(?:hosted_scenario_(?:10|[1-9])|cleanup_(?:verified|required))$/u;
const SAFE_ACTOR_ROLES = new Set([
	'reporter',
	'cross-user',
	'assigned-moderator',
	'assigned-moderator-aal1',
	'assigned-moderator-aal2',
	'unassigned-moderator',
	'unassigned-moderator-aal2',
	'cleanup-operator',
	'operator'
]);
const SAFE_BOUNDARIES = new Set(['HTTP', 'Storage', 'database', 'operator']);
const SAFE_RESULTS = new Set([
	'HTTP 200',
	'HTTP 400',
	'HTTP 413',
	'Storage 200 bytes',
	'Storage denied non-2xx',
	'database transition verified',
	'zero residual artifacts',
	'cleanup required',
	'verified'
]);
const SAFE_CLEANUP_STATES = new Set(['none', 'pending-A11', 'verified']);
const PRIVATE_RESPONSE_PATTERN =
	/(?:supabase|cloudflare\s+images|storage[_ -]?path|report-evidence\/|bearer|authorization|service[_ -]?role|password|credential|stack|exception|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|gate3-[a-z0-9-]{8,64}|[a-z0-9._-]+\.(?:png|jpe?g|webp|avif)|(?:sb_(?:publishable|secret)|eyJ)[a-z0-9._-]{16,})/iu;

export const HOSTED_STAGING = Object.freeze({
	projectRef: 'nuhkpqjjyuygiemrxbdp',
	organizationId: 'khazvscqabwvslnphbqp',
	region: 'eu-central-1',
	supabaseUrl: 'https://nuhkpqjjyuygiemrxbdp.supabase.co',
	workerOrigin: 'https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev'
});

export class HostedEvidenceOperatorError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'HostedEvidenceOperatorError';
	}
}

/**
 * @param {OperatorEnvironment} environment
 * @param {string} name
 * @param {string} expected
 * @param {string} message
 */
function requireExact(environment, name, expected, message) {
	if (environment[name] !== expected) {
		throw new HostedEvidenceOperatorError(message);
	}
}

/** @param {OperatorEnvironment} environment @param {string} name */
function requirePrivateValue(environment, name) {
	const value = environment[name];
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new HostedEvidenceOperatorError('required hosted operator configuration is incomplete');
	}
	return value.trim();
}

/** @param {string} value */
function normalizeOrigin(value) {
	try {
		const parsed = new URL(value);
		if (
			parsed.protocol !== 'https:' ||
			parsed.username ||
			parsed.password ||
			parsed.pathname !== '/' ||
			parsed.search ||
			parsed.hash
		) {
			throw new Error('invalid origin');
		}
		return parsed.origin;
	} catch {
		throw new HostedEvidenceOperatorError('hosted operator target does not match approved staging');
	}
}

/**
 * @param {OperatorEnvironment} environment
 */
function loadActorRoles(environment) {
	/** @type {Record<string, Readonly<ActorCredentials>>} */
	const actors = Object.fromEntries(
		Object.entries(ACTOR_ENVIRONMENT).map(([role, names]) => [
			role,
			Object.freeze({
				email: requirePrivateValue(environment, names.email).toLowerCase(),
				password: requirePrivateValue(environment, names.password),
				username: requirePrivateValue(environment, names.username)
			})
		])
	);
	const emails = Object.values(actors).map((actor) => actor.email);
	const usernames = Object.values(actors).map((actor) => actor.username.toLowerCase());
	for (const actor of Object.values(actors)) {
		const at = actor.email.lastIndexOf('@');
		const local = actor.email.slice(0, at);
		const domain = actor.email.slice(at + 1);
		const domainLabels = domain.split('.');
		if (
			actor.email.length > 254 ||
			at < 1 ||
			local.length > 64 ||
			!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(local) ||
			local.startsWith('.') ||
			local.endsWith('.') ||
			local.includes('..') ||
			domain.length > 253 ||
			domainLabels.length < 2 ||
			domainLabels.some(
				(label) =>
					label.length < 1 ||
					label.length > 63 ||
					!/^[a-z0-9-]+$/u.test(label) ||
					label.startsWith('-') ||
					label.endsWith('-')
			) ||
			actor.password.length < 12 ||
			actor.password.length > 128 ||
			!/^[\p{L}\p{N}_.-]{3,40}$/u.test(actor.username)
		) {
			throw new HostedEvidenceOperatorError('synthetic hosted actor configuration is invalid');
		}
	}
	if (new Set(emails).size !== emails.length || new Set(usernames).size !== usernames.length) {
		throw new HostedEvidenceOperatorError('synthetic hosted actors must be unique');
	}
	return Object.freeze(actors);
}

/** @param {OperatorEnvironment} environment */
function assertExactActorEnvironment(environment) {
	for (const name of [
		'E2E_REAL_ADMIN_EMAIL',
		'E2E_REAL_ADMIN_PASSWORD',
		'E2E_REAL_ADMIN_TOTP_SECRET'
	]) {
		if (environment[name]) {
			throw new HostedEvidenceOperatorError('administrator actor is outside the approved hosted scope');
		}
	}
	for (const [name, value] of Object.entries(environment)) {
		if (
			value &&
			ACTOR_CREDENTIAL_NAME_PATTERN.test(name) &&
			!APPROVED_ACTOR_ENVIRONMENT_NAMES.has(name)
		) {
			throw new HostedEvidenceOperatorError('actor is outside the approved hosted scope');
		}
	}
}

/** @param {string} secret */
function decodeBase32Secret(secret) {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	const normalized =
		typeof secret === 'string' ? secret.toUpperCase().replace(/[\s=-]/gu, '') : '';
	if (!normalized || [...normalized].some((character) => !alphabet.includes(character))) {
		throw new HostedEvidenceOperatorError('TOTP input is invalid');
	}
	let bits = '';
	for (const character of normalized) {
		bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
	}
	const bytes = [];
	for (let index = 0; index + 8 <= bits.length; index += 8) {
		bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
	}
	if (bytes.length === 0) throw new HostedEvidenceOperatorError('TOTP input is invalid');
	return Buffer.from(bytes);
}

/**
 * Generate the six-digit SHA-1 TOTP used by hosted staff MFA.
 * @param {string} secret base32-encoded seed
 * @param {number} timestamp Unix timestamp in milliseconds
 */
export function generateTotpCode(secret, timestamp) {
	if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
		throw new HostedEvidenceOperatorError('TOTP timestamp is invalid');
	}
	const counterBytes = Buffer.alloc(8);
	counterBytes.writeBigUInt64BE(BigInt(Math.floor(timestamp / 30_000)));
	const digest = createHmac('sha1', decodeBase32Secret(secret)).update(counterBytes).digest();
	const offset = digest[digest.length - 1] & 0x0f;
	const binary = digest.readUInt32BE(offset) & 0x7fffffff;
	return String(binary % 1_000_000).padStart(6, '0');
}

/**
 * @param {OperatorEnvironment} environment
 * @returns {Readonly<HostedOperatorConfig>}
 */
function validateHostedBaseEnvironment(environment) {
	requireExact(
		environment,
		'APP_ENV',
		'staging',
		'hosted report-evidence operator is disabled'
	);
	requireExact(
		environment,
		'E2E_REAL_RUN',
		'true',
		'hosted report-evidence operator is disabled'
	);
	requireExact(
		environment,
		'E2E_REAL_REPORT_EVIDENCE_RUN',
		'true',
		'hosted report-evidence operator is disabled'
	);

	const runId = requirePrivateValue(environment, 'E2E_REAL_REPORT_EVIDENCE_RUN_ID');
	if (!/^gate3-[a-z0-9-]{8,64}$/u.test(runId)) {
		throw new HostedEvidenceOperatorError('hosted run ID is not an approved synthetic scope');
	}

	requireExact(
		environment,
		'EXPECTED_SUPABASE_PROJECT_REF',
		HOSTED_STAGING.projectRef,
		'hosted operator target does not match approved staging'
	);
	if (
		normalizeOrigin(requirePrivateValue(environment, 'PUBLIC_SUPABASE_URL')) !==
		HOSTED_STAGING.supabaseUrl ||
		normalizeOrigin(requirePrivateValue(environment, 'E2E_REAL_BASE_URL')) !==
		HOSTED_STAGING.workerOrigin
	) {
		throw new HostedEvidenceOperatorError('hosted operator target does not match approved staging');
	}

	assertExactActorEnvironment(environment);
	const provisionedAfter = requireIsoTimestamp(
		requirePrivateValue(environment, 'E2E_REAL_REPORT_EVIDENCE_PROVISIONED_AFTER')
	);
	if (Date.parse(provisionedAfter) > Date.now() + 5 * 60_000) {
		throw new HostedEvidenceOperatorError('actor provisioning timestamp is in the future');
	}

	return Object.freeze({
		target: HOSTED_STAGING,
		runId,
		actorRoles: loadActorRoles(environment),
		serviceKey: requirePrivateValue(environment, 'SUPABASE_SECRET_KEY'),
		provisioningNonce: requireUuid(
			requirePrivateValue(environment, 'E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE'),
			'provisioning nonce'
		),
		provisionedAfter
	});
}

/** @param {OperatorEnvironment} [environment] @returns {Readonly<HostedOperatorConfig>} */
export function validateHostedOperatorEnvironment(environment = process.env) {
	return validateHostedBaseEnvironment(environment);
}

/** @param {OperatorEnvironment} [environment] @returns {Readonly<HostedOperatorConfig>} */
export function validateHostedA9Environment(environment = process.env) {
	const config = validateHostedBaseEnvironment(environment);
	if (
		environment.E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_RUN !== 'true' ||
		environment.E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_APPROVAL !== 'A9' ||
		environment.E2E_REAL_REPORT_EVIDENCE_SCENARIO_RUN ||
		environment.E2E_REAL_REPORT_EVIDENCE_SCENARIO_APPROVAL ||
		environment.E2E_REAL_REPORT_EVIDENCE_CLEANUP_RUN ||
		environment.E2E_REAL_REPORT_EVIDENCE_CLEANUP_APPROVAL
	) {
		throw new HostedEvidenceOperatorError('A9 account-provisioning gate is disabled');
	}
	return config;
}

/** @param {OperatorEnvironment} [environment] */
export function validateHostedCleanupEnvironment(environment = process.env) {
	const config = validateHostedBaseEnvironment(environment);
	if (
		environment.E2E_REAL_REPORT_EVIDENCE_CLEANUP_RUN !== 'true' ||
		environment.E2E_REAL_REPORT_EVIDENCE_CLEANUP_APPROVAL !== 'A11' ||
		environment.E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_RUN ||
		environment.E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_APPROVAL ||
		environment.E2E_REAL_REPORT_EVIDENCE_SCENARIO_RUN ||
		environment.E2E_REAL_REPORT_EVIDENCE_SCENARIO_APPROVAL
	) {
		throw new HostedEvidenceOperatorError('A11 cleanup gate is disabled');
	}
	return config;
}

/** @param {OperatorEnvironment} [environment] */
export function validateHostedProvisionEnvironment(environment = process.env) {
	return validateHostedA9Environment(environment);
}

/** @param {OperatorEnvironment} [environment] */
export function isHostedA10ScenarioApproved(environment = process.env) {
	return (
		environment.E2E_REAL_RUN === 'true' &&
		environment.E2E_REAL_REPORT_EVIDENCE_RUN === 'true' &&
		environment.E2E_REAL_REPORT_EVIDENCE_SCENARIO_RUN === 'true' &&
		environment.E2E_REAL_REPORT_EVIDENCE_SCENARIO_APPROVAL === 'A10' &&
		!environment.E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_RUN &&
		!environment.E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_APPROVAL &&
		!environment.E2E_REAL_REPORT_EVIDENCE_CLEANUP_RUN &&
		!environment.E2E_REAL_REPORT_EVIDENCE_CLEANUP_APPROVAL
	);
}

/** @param {OperatorEnvironment} [environment] */
export function validateHostedA10Environment(environment = process.env) {
	const config = validateHostedBaseEnvironment(environment);
	if (!isHostedA10ScenarioApproved(environment)) {
		throw new HostedEvidenceOperatorError('A10 scenario gate is disabled');
	}
	return config;
}

/**
 * @param {HostedOperatorConfig} config
 * @param {{ provisioningAttemptId?: string, credentialStoreId?: string }} [binding]
 * @returns {Readonly<HostedRunManifest>}
 */
export function createHostedRunManifest(config, binding = {}) {
	const provisioningAttemptId = requireUuid(
		binding.provisioningAttemptId ?? config.provisioningNonce,
		'provisioning attempt ID'
	);
	const credentialStoreId = binding.credentialStoreId ?? '0'.repeat(64);
	if (!/^[a-f0-9]{64}$/u.test(credentialStoreId)) {
		throw new HostedEvidenceOperatorError('credential store binding is invalid');
	}
	return Object.freeze({
		targetProjectRef: config.target.projectRef,
		runId: config.runId,
		provisioningAttemptId,
		credentialStoreId,
		pendingActors: Object.freeze([]),
		actors: Object.freeze([]),
		reports: Object.freeze([]),
		uploads: Object.freeze([]),
		queueRows: Object.freeze([])
	});
}

/** @param {string} value @param {string} label */
function requireUuid(value, label) {
	if (!UUID_PATTERN.test(value)) {
		throw new HostedEvidenceOperatorError(`${label} is not an approved opaque identifier`);
	}
	return value;
}

/** @param {string} value */
function requireIsoTimestamp(value) {
	const match =
		/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/u.exec(value);

	if (!match) {
		throw new HostedEvidenceOperatorError('actor provisioning timestamp is invalid');
	}

	const parsed = Date.parse(value);
	const milliseconds = (match[2] ?? '').padEnd(3, '0').slice(0, 3);
	const canonicalMilliseconds = `${match[1]}.${milliseconds}Z`;

	if (
		!Number.isFinite(parsed) ||
		new Date(parsed).toISOString() !== canonicalMilliseconds
	) {
		throw new HostedEvidenceOperatorError('actor provisioning timestamp is invalid');
	}

	return value;
}

/** @param {HostedRunManifest} manifest @param {ManifestChanges} [changes] */
function cloneManifest(manifest, changes = {}) {
	return Object.freeze({
		targetProjectRef: manifest.targetProjectRef,
		runId: manifest.runId,
		provisioningAttemptId: manifest.provisioningAttemptId,
		credentialStoreId: manifest.credentialStoreId,
		pendingActors: Object.freeze([...(changes.pendingActors ?? manifest.pendingActors)]),
		actors: Object.freeze([...(changes.actors ?? manifest.actors)]),
		reports: Object.freeze([...(changes.reports ?? manifest.reports)]),
		uploads: Object.freeze([...(changes.uploads ?? manifest.uploads)]),
		queueRows: Object.freeze([...(changes.queueRows ?? manifest.queueRows)])
	});
}

/**
 * @param {HostedRunManifest} manifest
 * @param {string} role
 * @param {string} userId
 * @param {string} createdAt
 */
export function registerHostedActor(manifest, role, userId, createdAt) {
	if (!SAFE_ACTOR_ROLES.has(role) || !Object.hasOwn(ACTOR_ENVIRONMENT, role)) {
		throw new HostedEvidenceOperatorError('actor role is outside the approved hosted matrix');
	}
	requireUuid(userId, 'actor ID');
	requireIsoTimestamp(createdAt);
	if (
		manifest.actors.some((actor) => actor.role === role || actor.userId === userId)
	) {
		throw new HostedEvidenceOperatorError('actor is already present in the exact run manifest');
	}
	return cloneManifest(manifest, {
		pendingActors: manifest.pendingActors.filter((actor) => actor.role !== role),
		actors: [
			...manifest.actors,
			Object.freeze({
				role,
				userId,
				createdAt,
				provisioningAttemptId: manifest.provisioningAttemptId
			})
		]
	});
}

/** @param {HostedRunManifest} manifest @param {string} role */
function manifestActor(manifest, role) {
	const actor = manifest.actors.find((entry) => entry.role === role);
	if (!actor) throw new HostedEvidenceOperatorError('actor is outside the exact run manifest');
	return actor;
}

/** @param {HostedRunManifest} manifest @param {string} reportId @param {string} actorRole */
export function registerHostedReport(manifest, reportId, actorRole) {
	requireUuid(reportId, 'report ID');
	manifestActor(manifest, actorRole);
	if (manifest.reports.some((report) => report.id === reportId)) {
		throw new HostedEvidenceOperatorError('report is already present in the exact run manifest');
	}
	return cloneManifest(manifest, {
		reports: [...manifest.reports, Object.freeze({ id: reportId, actorRole })]
	});
}

/**
 * @param {HostedRunManifest} manifest
 * @param {string} uploadId
 * @param {string} actorRole
 * @param {string} objectPath
 */
export function registerHostedUpload(manifest, uploadId, actorRole, objectPath) {
	requireUuid(uploadId, 'upload ID');
	const actor = manifestActor(manifest, actorRole);
	const expectedPath = `${actor.userId}/${uploadId}.webp`;
	if (objectPath !== expectedPath) {
		throw new HostedEvidenceOperatorError('object path is outside the exact run manifest');
	}
	if (manifest.uploads.some((upload) => upload.id === uploadId)) {
		throw new HostedEvidenceOperatorError('upload is already present in the exact run manifest');
	}
	return cloneManifest(manifest, {
		uploads: [
			...manifest.uploads,
			Object.freeze({ id: uploadId, actorRole, uploaderId: actor.userId, objectPath })
		]
	});
}

/** @param {HostedRunManifest} manifest @param {number} queueId @param {string} uploadId */
export function registerHostedQueueRow(manifest, queueId, uploadId) {
	if (!Number.isSafeInteger(queueId) || queueId < 1) {
		throw new HostedEvidenceOperatorError('queue ID is not an approved opaque identifier');
	}
	if (!manifest.uploads.some((upload) => upload.id === uploadId)) {
		throw new HostedEvidenceOperatorError('queue upload is outside the exact run manifest');
	}
	if (manifest.queueRows.some((queue) => queue.id === queueId)) {
		throw new HostedEvidenceOperatorError('queue row is already present in the exact run manifest');
	}
	return cloneManifest(manifest, {
		queueRows: [...manifest.queueRows, Object.freeze({ id: queueId, uploadId })]
	});
}

/** @param {string} filePath */
export function resolveHostedManifestPath(filePath) {
	try {
		return resolveOutsideRepositoryFile(filePath, { extension: '.json' });
	} catch {
		throw new HostedEvidenceOperatorError('hosted run manifest path is invalid');
	}
}

/** @param {HostedRunManifest} manifest @param {string} role */
export function registerHostedActorIntent(manifest, role) {
	if (!Object.hasOwn(ACTOR_ENVIRONMENT, role)) {
		throw new HostedEvidenceOperatorError('actor role is outside the approved hosted matrix');
	}
	if (
		manifest.pendingActors.some((actor) => actor.role === role) ||
		manifest.actors.some((actor) => actor.role === role)
	) {
		throw new HostedEvidenceOperatorError('actor is already present in the exact run manifest');
	}
	return cloneManifest(manifest, {
		pendingActors: [
			...manifest.pendingActors,
			Object.freeze({ role, provisioningAttemptId: manifest.provisioningAttemptId })
		]
	});
}

/** @param {HostedOperatorConfig} config @param {unknown} candidate */
function decodeHostedRunManifest(config, candidate) {
	if (!candidate || typeof candidate !== 'object') {
		throw new HostedEvidenceOperatorError('hosted run manifest is invalid');
	}
	const input = /** @type {Record<string, unknown>} */ (candidate);
	if (
		input.targetProjectRef !== config.target.projectRef ||
		input.runId !== config.runId ||
		typeof input.provisioningAttemptId !== 'string' ||
		typeof input.credentialStoreId !== 'string' ||
		!Array.isArray(input.pendingActors) ||
		!Array.isArray(input.actors) ||
		!Array.isArray(input.reports) ||
		!Array.isArray(input.uploads) ||
		!Array.isArray(input.queueRows)
	) {
		throw new HostedEvidenceOperatorError('hosted run manifest target is invalid');
	}
	let manifest = createHostedRunManifest(config, {
		provisioningAttemptId: String(input.provisioningAttemptId),
		credentialStoreId: String(input.credentialStoreId)
	});
	for (const value of input.pendingActors) {
		const pending = /** @type {Record<string, unknown>} */ (value);
		if (String(pending.provisioningAttemptId ?? '') !== manifest.provisioningAttemptId) {
			throw new HostedEvidenceOperatorError('hosted run manifest target is invalid');
		}
		manifest = registerHostedActorIntent(manifest, String(pending.role ?? ''));
	}
	for (const value of input.actors) {
		const actor = /** @type {Record<string, unknown>} */ (value);
		if (String(actor.provisioningAttemptId ?? '') !== manifest.provisioningAttemptId) {
			throw new HostedEvidenceOperatorError('hosted run manifest target is invalid');
		}
		manifest = registerHostedActor(
			manifest,
			String(actor.role ?? ''),
			String(actor.userId ?? ''),
			String(actor.createdAt ?? '')
		);
	}
	for (const value of input.reports) {
		const report = /** @type {Record<string, unknown>} */ (value);
		manifest = registerHostedReport(
			manifest,
			String(report.id ?? ''),
			String(report.actorRole ?? '')
		);
	}
	for (const value of input.uploads) {
		const upload = /** @type {Record<string, unknown>} */ (value);
		manifest = registerHostedUpload(
			manifest,
			String(upload.id ?? ''),
			String(upload.actorRole ?? ''),
			String(upload.objectPath ?? '')
		);
	}
	for (const value of input.queueRows) {
		const queue = /** @type {Record<string, unknown>} */ (value);
		manifest = registerHostedQueueRow(
			manifest,
			Number(queue.id),
			String(queue.uploadId ?? '')
		);
	}
	return manifest;
}

/**
 * Validates an in-memory manifest through the same compatibility-preserving
 * decoder used for persisted hosted manifests.
 *
 * @param {HostedOperatorConfig} config
 * @param {unknown} candidate
 */
export function validateHostedRunManifest(config, candidate) {
	return decodeHostedRunManifest(config, candidate);
}

/** @param {HostedOperatorConfig} config @param {HostedRunManifest} manifest @param {string} filePath */
export async function persistHostedRunManifest(config, manifest, filePath) {
	assertManifestTarget(config, manifest);
	const exactPath = resolveHostedManifestPath(filePath);
	try {
		await atomicPrivateWrite(exactPath, `${JSON.stringify(manifest)}\n`);
	} catch {
		throw new HostedEvidenceOperatorError('hosted run manifest could not be persisted');
	}
}

/** @param {HostedOperatorConfig} config @param {string} filePath */
export async function loadHostedRunManifest(config, filePath) {
	const exactPath = resolveHostedManifestPath(filePath);
	try {
		return decodeHostedRunManifest(config, JSON.parse(await readFile(exactPath, 'utf8')));
	} catch (error) {
		if (error instanceof HostedEvidenceOperatorError) throw error;
		throw new HostedEvidenceOperatorError('hosted run manifest is unavailable');
	}
}

/** @param {HostedOperatorConfig} config @param {HostedRunManifest} manifest */
function assertManifestTarget(config, manifest) {
	if (
		manifest.runId !== config.runId ||
		manifest.targetProjectRef !== config.target.projectRef
	) {
		throw new HostedEvidenceOperatorError('run manifest target does not match approved staging');
	}
}

/** @param {HostedOperatorConfig} config @param {string} email */
export function assertSyntheticAccountAllowed(config, email) {
	const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
	for (const [role, actor] of Object.entries(config.actorRoles)) {
		if (actor.email === normalizedEmail) {
			return role;
		}
	}
	throw new HostedEvidenceOperatorError('account is outside the approved synthetic allow-list');
}

/** @param {string} operation */
export function assertServiceRoleOperation(operation) {
	if (!ALLOWED_SERVICE_ROLE_OPERATIONS.has(operation)) {
		throw new HostedEvidenceOperatorError(
			'service role cannot perform access assertions or actor-scoped reads'
		);
	}
	return operation;
}

/**
 * @param {{
 *   config: HostedOperatorConfig,
 *   adapters: {
 *     provisionActor?: (scope: { role: string }) => Promise<{ role: string, userId: string, createdAt: string }>,
 *     attestActor?: (scope: { manifest: HostedRunManifest, role: string, userId: string }) => Promise<ManifestActor>,
 *     inspectManifest: (scope: { target: typeof HOSTED_STAGING, runId: string, manifest: HostedRunManifest }) => Promise<InventoryCounts>,
 *     backdateExactUpload: (scope: { projectRef: string, runId: string, uploadId: string, uploaderId: string, objectPath: string }) => Promise<void>,
 *     uploadExactObject?: (scope: { manifest: HostedRunManifest, uploadId: string, bytes: Uint8Array }) => Promise<void>,
 *     inspectReport?: (scope: { manifest: HostedRunManifest, reportId: string }) => Promise<Record<string, unknown>>,
 *     inspectUpload?: (scope: { manifest: HostedRunManifest, uploadId: string }) => Promise<Record<string, unknown>>,
 *     inspectObject?: (scope: { manifest: HostedRunManifest, uploadId: string }) => Promise<Record<string, unknown>>,
 *     discoverUploadForReport?: (scope: { manifest: HostedRunManifest, reportId: string }) => Promise<Record<string, unknown>>,
 *     discoverUploadByStatus?: (scope: { manifest: HostedRunManifest, actorRole: string, status: string, createdAfter: string }) => Promise<Record<string, unknown>>,
 *     discoverQueueForUpload?: (scope: { manifest: HostedRunManifest, uploadId: string }) => Promise<Record<string, unknown>>,
 *     inspectAssignmentAudit?: (scope: { manifest: HostedRunManifest, reportId: string, actorId: string }) => Promise<number>,
 *     reconcileExactUploads?: (scope: { manifest: HostedRunManifest, uploadIds: readonly string[], rejectionCode: string }) => Promise<readonly string[]>,
 *     invokeCleanupWorker?: () => Promise<{ status: number, requestId: string }>,
 *     removeManifest: (scope: { target: typeof HOSTED_STAGING, runId: string, manifest: HostedRunManifest }) => Promise<void>
 *   }
 * }} options
 */
export function createHostedEvidenceOperator({ config, adapters }) {
	return Object.freeze({
		/** @param {string} role @param {OperatorEnvironment} environment */
		async provisionFreshActor(role, environment) {
			assertServiceRoleOperation('provision');
			const provisionConfig = validateHostedProvisionEnvironment(environment);
			if (
				provisionConfig.runId !== config.runId ||
				provisionConfig.provisioningNonce !== config.provisioningNonce ||
				!Object.hasOwn(config.actorRoles, role) ||
				!adapters.provisionActor
			) {
				throw new HostedEvidenceOperatorError('A9 account-provisioning target is invalid');
			}
			return adapters.provisionActor({ role });
		},
		/** @param {HostedRunManifest} manifest @param {string} role @param {string} userId */
		async attestFreshActor(manifest, role, userId) {
			assertServiceRoleOperation('inspect');
			exactFreshManifestActor(config, manifest, role, userId);
			if (!Object.hasOwn(config.actorRoles, role) || !adapters.attestActor) {
				throw new HostedEvidenceOperatorError('actor provenance adapter is unavailable');
			}
			return adapters.attestActor({ manifest, role, userId });
		},
		/** @param {HostedRunManifest} manifest */
		async inspect(manifest) {
			assertServiceRoleOperation('inspect');
			assertManifestTarget(config, manifest);
			const counts = sanitizeCounts(
				await adapters.inspectManifest({ target: config.target, runId: config.runId, manifest })
			);
			assertIsolatedScope(counts);
			return counts;
		},
		/** @param {HostedRunManifest} manifest @param {string} uploadId */
		async backdateAbandonedUpload(manifest, uploadId) {
			assertServiceRoleOperation('provision');
			assertManifestTarget(config, manifest);
			const upload = manifest.uploads.find((entry) => entry.id === uploadId);
			if (!upload) {
				throw new HostedEvidenceOperatorError('upload is outside the exact run manifest');
			}
			await adapters.backdateExactUpload({
				projectRef: config.target.projectRef,
				runId: config.runId,
				uploadId: upload.id,
				uploaderId: upload.uploaderId,
				objectPath: upload.objectPath
			});
		},
		/** @param {HostedRunManifest} manifest @param {string} uploadId @param {Uint8Array} bytes */
		async uploadAbandonedObject(manifest, uploadId, bytes) {
			assertServiceRoleOperation('provision');
			assertManifestTarget(config, manifest);
			exactManifestUpload(manifest, uploadId);
			if (!adapters.uploadExactObject) {
				throw new HostedEvidenceOperatorError('exact object provision adapter is unavailable');
			}
			await adapters.uploadExactObject({ manifest, uploadId, bytes });
		},
		/** @param {HostedRunManifest} manifest @param {string} reportId */
		async inspectReport(manifest, reportId) {
			assertServiceRoleOperation('inspect');
			assertManifestTarget(config, manifest);
			if (!manifest.reports.some((report) => report.id === reportId) || !adapters.inspectReport) {
				throw new HostedEvidenceOperatorError('report is outside the exact run manifest');
			}
			return adapters.inspectReport({ manifest, reportId });
		},
		/** @param {HostedRunManifest} manifest @param {string} uploadId */
		async inspectUpload(manifest, uploadId) {
			assertServiceRoleOperation('inspect');
			assertManifestTarget(config, manifest);
			exactManifestUpload(manifest, uploadId);
			if (!adapters.inspectUpload) throw new HostedEvidenceOperatorError('upload inspection adapter is unavailable');
			return adapters.inspectUpload({ manifest, uploadId });
		},
		/** @param {HostedRunManifest} manifest @param {string} uploadId */
		async inspectObject(manifest, uploadId) {
			assertServiceRoleOperation('inspect');
			assertManifestTarget(config, manifest);
			exactManifestUpload(manifest, uploadId);
			if (!adapters.inspectObject) throw new HostedEvidenceOperatorError('object inspection adapter is unavailable');
			return adapters.inspectObject({ manifest, uploadId });
		},
		/** @param {HostedRunManifest} manifest @param {string} reportId */
		async discoverUploadForReport(manifest, reportId) {
			assertServiceRoleOperation('inspect');
			assertManifestTarget(config, manifest);
			if (!manifest.reports.some((report) => report.id === reportId) || !adapters.discoverUploadForReport) {
				throw new HostedEvidenceOperatorError('report is outside the exact run manifest');
			}
			return adapters.discoverUploadForReport({ manifest, reportId });
		},
		/** @param {HostedRunManifest} manifest @param {string} actorRole @param {string} status @param {string} createdAfter */
		async discoverUploadByStatus(manifest, actorRole, status, createdAfter) {
			assertServiceRoleOperation('inspect');
			assertManifestTarget(config, manifest);
			manifestActor(manifest, actorRole);
			if (!adapters.discoverUploadByStatus) throw new HostedEvidenceOperatorError('upload discovery adapter is unavailable');
			return adapters.discoverUploadByStatus({ manifest, actorRole, status, createdAfter });
		},
		/** @param {HostedRunManifest} manifest @param {string} uploadId */
		async discoverQueueForUpload(manifest, uploadId) {
			assertServiceRoleOperation('inspect');
			assertManifestTarget(config, manifest);
			exactManifestUpload(manifest, uploadId);
			if (!adapters.discoverQueueForUpload) throw new HostedEvidenceOperatorError('queue discovery adapter is unavailable');
			return adapters.discoverQueueForUpload({ manifest, uploadId });
		},
		/** @param {HostedRunManifest} manifest @param {string} reportId @param {string} actorId */
		async inspectAssignmentAudit(manifest, reportId, actorId) {
			assertServiceRoleOperation('inspect');
			assertManifestTarget(config, manifest);
			if (!manifest.reports.some((report) => report.id === reportId) || !manifest.actors.some((actor) => actor.userId === actorId) || !adapters.inspectAssignmentAudit) {
				throw new HostedEvidenceOperatorError('audit coordinates are outside the exact run manifest');
			}
			return adapters.inspectAssignmentAudit({ manifest, reportId, actorId });
		},
		/** @param {HostedRunManifest} manifest @param {readonly string[]} uploadIds @param {string} rejectionCode */
		async reconcileExactUploads(manifest, uploadIds, rejectionCode) {
			assertServiceRoleOperation('cleanup');
			assertManifestTarget(config, manifest);
			for (const uploadId of uploadIds) exactManifestUpload(manifest, uploadId);
			if (!adapters.reconcileExactUploads) throw new HostedEvidenceOperatorError('reconciliation adapter is unavailable');
			return adapters.reconcileExactUploads({ manifest, uploadIds, rejectionCode });
		},
		async processCleanupQueue() {
			assertServiceRoleOperation('cleanup');
			if (!adapters.invokeCleanupWorker) throw new HostedEvidenceOperatorError('cleanup worker adapter is unavailable');
			return adapters.invokeCleanupWorker();
		},
		/** @param {HostedRunManifest} manifest */
		async remove(manifest) {
			assertServiceRoleOperation('cleanup');
			assertManifestTarget(config, manifest);
			await adapters.removeManifest({ target: config.target, runId: config.runId, manifest });
		}
	});
}

/** @param {HostedRunManifest} manifest @param {string} uploadId */
function exactManifestUpload(manifest, uploadId) {
	const upload = manifest.uploads.find((entry) => entry.id === uploadId);
	if (!upload) throw new HostedEvidenceOperatorError('upload is outside the exact run manifest');
	return upload;
}

/** @param {{ data: unknown, error: unknown }} result @param {string} message */
function resultData(result, message) {
	if (result.error) throw new HostedEvidenceOperatorError(message);
	return result.data;
}

/** @param {{ data?: { user?: unknown } | null, error?: { status?: number } | null }} result */
function isMissingAuthUser(result) {
	return !result.data?.user && result.error?.status === 404;
}

/**
 * @param {HostedOperatorConfig} config
 * @param {ManifestActor} actor
 * @param {SupabaseUser} user
 */
function actorProvenanceMatches(config, actor, user) {
	const credentials = config.actorRoles[actor.role];
	const metadata =
		user.user_metadata && typeof user.user_metadata === 'object'
			? /** @type {Record<string, unknown>} */ (user.user_metadata)
			: {};
	const createdAt = String(user.created_at ?? '');
	return Boolean(
		credentials &&
			user.id === actor.userId &&
			typeof user.email === 'string' &&
			user.email.toLowerCase() === credentials.email &&
			createdAt === actor.createdAt &&
			Date.parse(createdAt) >= Date.parse(config.provisionedAfter) &&
			metadata.gate3_report_evidence_run_id === config.runId &&
			metadata.gate3_report_evidence_provisioning_nonce === config.provisioningNonce &&
			metadata.gate3_report_evidence_provisioning_attempt_id ===
				(actor.provisioningAttemptId ?? config.provisioningNonce)
	);
}

/**
 * @param {HostedOperatorConfig} config
 * @param {PendingManifestActor} pending
 * @param {SupabaseUser} user
 */
function pendingActorProvenanceMatches(config, pending, user) {
	const credentials = config.actorRoles[pending.role];
	const metadata =
		user.user_metadata && typeof user.user_metadata === 'object'
			? /** @type {Record<string, unknown>} */ (user.user_metadata)
			: {};
	const createdAt = String(user.created_at ?? '');
	return Boolean(
		credentials &&
			typeof user.email === 'string' &&
			user.email.toLowerCase() === credentials.email &&
			Number.isFinite(Date.parse(createdAt)) &&
			Date.parse(createdAt) >= Date.parse(config.provisionedAfter) &&
			metadata.gate3_report_evidence_run_id === config.runId &&
			metadata.gate3_report_evidence_provisioning_nonce === config.provisioningNonce &&
			metadata.gate3_report_evidence_provisioning_attempt_id === pending.provisioningAttemptId
	);
}

/** @param {HostedOperatorConfig} config @param {HostedRunManifest} manifest @param {string} filePath */
export async function reserveHostedRunManifest(config, manifest, filePath) {
	assertManifestTarget(config, manifest);
	if (
		manifest.pendingActors.length !== 0 ||
		manifest.actors.length !== 0 ||
		manifest.reports.length !== 0 ||
		manifest.uploads.length !== 0 ||
		manifest.queueRows.length !== 0
	) {
		throw new HostedEvidenceOperatorError('hosted run manifest reservation is not empty');
	}
	const exactPath = resolveHostedManifestPath(filePath);
	try {
		await reservePrivateFile(exactPath, `${JSON.stringify(manifest)}\n`);
	} catch {
		throw new HostedEvidenceOperatorError('hosted run manifest already exists');
	}
}

/** @param {HostedOperatorConfig} config @param {string} role */
function exactActorCredentials(config, role) {
	if (!Object.hasOwn(ACTOR_ENVIRONMENT, role) || !Object.hasOwn(config.actorRoles, role)) {
		throw new HostedEvidenceOperatorError('actor role is outside the approved hosted matrix');
	}
	return config.actorRoles[role];
}

/**
 * @param {HostedOperatorConfig} config
 * @param {HostedRunManifest} manifest
 * @param {string} role
 * @param {string} userId
 */
function exactFreshManifestActor(config, manifest, role, userId) {
	assertManifestTarget(config, manifest);
	exactActorCredentials(config, role);
	requireUuid(userId, 'actor ID');
	const actor = manifest.actors.find((entry) => entry.role === role && entry.userId === userId);
	if (!actor) throw new HostedEvidenceOperatorError('actor is outside the exact run manifest');
	return actor;
}

/** @param {HostedOperatorConfig} config @param {HostedRunManifest} manifest */
function assertCompleteA9Manifest(config, manifest) {
	assertManifestTarget(config, manifest);
	const expectedRoles = Object.keys(ACTOR_ENVIRONMENT);
	if (
		manifest.actors.length !== expectedRoles.length ||
		new Set(manifest.actors.map((actor) => actor.userId)).size !== expectedRoles.length ||
		expectedRoles.some(
			(role) => manifest.actors.filter((actor) => actor.role === role).length !== 1
		)
	) {
		throw new HostedEvidenceOperatorError('A9 manifest does not contain the exact actor matrix');
	}
	for (const actor of manifest.actors) exactFreshManifestActor(config, manifest, actor.role, actor.userId);
	return manifest.actors;
}

/** @param {SupabaseUser} user */
function authUserIsConfirmed(user) {
	return (
		typeof user.email_confirmed_at === 'string' &&
		Number.isFinite(Date.parse(user.email_confirmed_at))
	);
}

/**
 * A9-only Supabase adapters. Construction is inert: each operation stays scoped
 * to a configured actor and the exact run manifest supplied by its caller.
 *
	 * The credential sink is deliberately write-only from this module's point of
	 * view. Its implementation must authenticate and encrypt persisted seeds outside
	 * the repository, never log them, and delete compensated enrollments.
 *
 * @param {{
 *   config: HostedOperatorConfig,
 *   serviceClient: SupabaseClient,
 *   createActorClient: () => SupabaseClient,
 *   credentialSink: {
 *     storeModeratorTotpSecret: (credential: { role: string, secret: string }) => Promise<void> | void,
 *     deleteModeratorTotpSecret: (credential: { role: string }) => Promise<void> | void
 *   }
 * }} options
 */
export function createSupabaseHostedA9Adapters({
	config,
	serviceClient,
	createActorClient,
	credentialSink
}) {
	const absenceAttestedRoles = new Set();
	let privilegedClientOrigin;
	try {
		const clientMetadata = /** @type {{ supabaseUrl?: string }} */ (
			/** @type {unknown} */ (serviceClient)
		);
		if (typeof clientMetadata.supabaseUrl !== 'string') throw new Error('missing target');
		privilegedClientOrigin = normalizeOrigin(clientMetadata.supabaseUrl);
	} catch {
		throw new HostedEvidenceOperatorError(
			'A9 privileged client does not match the exact staging target'
		);
	}
	if (privilegedClientOrigin !== HOSTED_STAGING.supabaseUrl) {
		throw new HostedEvidenceOperatorError(
			'A9 privileged client does not match the exact staging target'
		);
	}
	if (
		config.target.projectRef !== HOSTED_STAGING.projectRef ||
		typeof createActorClient !== 'function' ||
		typeof credentialSink?.storeModeratorTotpSecret !== 'function' ||
		typeof credentialSink?.deleteModeratorTotpSecret !== 'function'
	) {
		throw new HostedEvidenceOperatorError('A9 adapter configuration is invalid');
	}

	/** @param {string} userId @param {string} failureMessage */
	async function deleteAndConfirmAbsent(userId, failureMessage) {
		const deleted = await serviceClient.auth.admin.deleteUser(userId);
		if (deleted.error) throw new HostedEvidenceOperatorError(failureMessage);
		const absent = await serviceClient.auth.admin.getUserById(userId);
		if (!isMissingAuthUser(absent)) throw new HostedEvidenceOperatorError(failureMessage);
	}

	/** @param {{ manifest: HostedRunManifest, role: string }} scope */
	async function reconcileAmbiguousActorCreation(scope) {
		if (!absenceAttestedRoles.has(scope.role)) {
			throw new HostedEvidenceOperatorError('A9 actor absence was not attested');
		}
		const credentials = exactActorCredentials(config, scope.role);
		assertManifestTarget(config, scope.manifest);
		const matches = [];
		const perPage = 1000;
		for (let page = 1; page <= 100; page += 1) {
			let listed;
			try {
				listed = await serviceClient.auth.admin.listUsers({ page, perPage });
			} catch {
				throw new HostedEvidenceOperatorError('A9 actor creation rollback was not confirmed');
			}
			const users = listed.data?.users;
			if (listed.error || !Array.isArray(users)) {
				throw new HostedEvidenceOperatorError('A9 actor creation rollback was not confirmed');
			}
			for (const user of users) {
				if (
					typeof user?.created_at === 'string' &&
					typeof user?.email === 'string' &&
					user.email.toLowerCase() === credentials.email &&
					pendingActorProvenanceMatches(
						config,
						{
							role: scope.role,
							provisioningAttemptId: scope.manifest.provisioningAttemptId
						},
						user
					)
				) {
					matches.push(user);
				}
			}
			const lastPage = listed.data?.lastPage;
			if (users.length < perPage || (Number.isSafeInteger(lastPage) && page >= lastPage)) break;
			if (page === 100) {
				throw new HostedEvidenceOperatorError('A9 actor creation rollback was not confirmed');
			}
		}
		if (matches.length > 1) {
			throw new HostedEvidenceOperatorError('A9 actor creation rollback was not confirmed');
		}
		if (matches.length === 1) {
			await deleteAndConfirmAbsent(
				matches[0].id,
				'A9 actor creation rollback was not confirmed'
			);
		}
	}

	/** @param {{ manifest: HostedRunManifest, role: string }} scope */
	async function createConfirmedUser(scope) {
		const credentials = exactActorCredentials(config, scope.role);
		assertManifestTarget(config, scope.manifest);
		const pending = scope.manifest.pendingActors.find((actor) => actor.role === scope.role);
		if (!pending || pending.provisioningAttemptId !== scope.manifest.provisioningAttemptId) {
			throw new HostedEvidenceOperatorError('A9 actor intent was not checkpointed');
		}
		if (!absenceAttestedRoles.has(scope.role)) {
			throw new HostedEvidenceOperatorError('A9 actor absence was not attested');
		}
		try {
			let result;
			try {
				result = await serviceClient.auth.admin.createUser({
				email: credentials.email,
				password: credentials.password,
				email_confirm: true,
				user_metadata: {
					username: credentials.username,
					gate3_report_evidence_run_id: config.runId,
					gate3_report_evidence_provisioning_nonce: config.provisioningNonce,
					gate3_report_evidence_provisioning_attempt_id:
						scope.manifest.provisioningAttemptId
				}
				});
			} catch {
				await reconcileAmbiguousActorCreation(scope);
				throw new HostedEvidenceOperatorError('confirmed A9 actor creation failed after reconciliation');
			}
			const user = result.data?.user;
			if (!user || typeof user.created_at !== 'string') {
				await reconcileAmbiguousActorCreation(scope);
				throw new HostedEvidenceOperatorError('confirmed A9 actor creation failed after reconciliation');
			}
			requireUuid(user.id, 'actor ID');
			try {
				requireIsoTimestamp(user.created_at);
			} catch {
				await deleteAndConfirmAbsent(user.id, 'A9 actor creation compensation failed');
				throw new HostedEvidenceOperatorError('confirmed A9 actor creation failed');
			}
			const actor = {
				role: scope.role,
				userId: user.id,
				createdAt: user.created_at,
				provisioningAttemptId: scope.manifest.provisioningAttemptId
			};
			const provenanceMatches = actorProvenanceMatches(config, actor, user);
			if (!provenanceMatches || result.error || !authUserIsConfirmed(user)) {
				if (!result.error || provenanceMatches) {
					await deleteAndConfirmAbsent(user.id, 'A9 actor creation compensation failed');
				}
			}
			if (!provenanceMatches) {
				throw new HostedEvidenceOperatorError('fresh A9 actor provenance is invalid');
			}
			if (result.error || !authUserIsConfirmed(user)) {
				throw new HostedEvidenceOperatorError('confirmed A9 actor creation failed');
			}
			return Object.freeze({
				role: actor.role,
				userId: actor.userId,
				createdAt: actor.createdAt,
				emailConfirmed: true
			});
		} finally {
			absenceAttestedRoles.delete(scope.role);
		}
	}

	/** @param {{ manifest: HostedRunManifest, role: string }} scope */
	async function assertFreshActorAbsent(scope) {
		const credentials = exactActorCredentials(config, scope.role);
		assertManifestTarget(config, scope.manifest);
		if (!scope.manifest.pendingActors.some((actor) => actor.role === scope.role)) {
			throw new HostedEvidenceOperatorError('A9 actor intent was not checkpointed');
		}
		let found = false;
		const perPage = 1000;
		for (let page = 1; page <= 100; page += 1) {
			let listed;
			try {
				listed = await serviceClient.auth.admin.listUsers({ page, perPage });
			} catch {
				throw new HostedEvidenceOperatorError('A9 actor absence inspection failed');
			}
			const users = listed.data?.users;
			if (listed.error || !Array.isArray(users)) {
				throw new HostedEvidenceOperatorError('A9 actor absence inspection failed');
			}
			found ||= users.some(
				(user) =>
					typeof user?.email === 'string' && user.email.toLowerCase() === credentials.email
			);
			const lastPage = listed.data?.lastPage;
			if (users.length < perPage || (Number.isSafeInteger(lastPage) && page >= lastPage)) break;
			if (page === 100) {
				throw new HostedEvidenceOperatorError('A9 actor absence inspection failed');
			}
		}
		if (found) throw new HostedEvidenceOperatorError('A9 configured actor already exists');
		absenceAttestedRoles.add(scope.role);
		return Object.freeze({ role: scope.role, absent: true });
	}

	/** @param {{ role: string, userId: string, createdAt: string, provisioningAttemptId?: string }} scope */
	async function lookupConfirmedUser(scope) {
		exactActorCredentials(config, scope.role);
		requireUuid(scope.userId, 'actor ID');
		requireIsoTimestamp(scope.createdAt);
		const result = await serviceClient.auth.admin.getUserById(scope.userId);
		const user = result.data.user;
		if (
			result.error ||
			!user ||
			typeof user.created_at !== 'string' ||
			!authUserIsConfirmed(user)
		) {
			throw new HostedEvidenceOperatorError('confirmed A9 actor lookup failed');
		}
		const actor = {
			role: scope.role,
			userId: scope.userId,
			createdAt: scope.createdAt,
			provisioningAttemptId: scope.provisioningAttemptId ?? config.provisioningNonce
		};
		if (!actorProvenanceMatches(config, actor, user)) {
			throw new HostedEvidenceOperatorError('fresh A9 actor provenance is invalid');
		}
		return Object.freeze({
			role: actor.role,
			userId: actor.userId,
			createdAt: actor.createdAt,
			emailConfirmed: true
		});
	}

	/** @param {{ manifest: HostedRunManifest, role: string, userId: string }} scope */
	async function deleteFreshUser(scope) {
		const actor = exactFreshManifestActor(config, scope.manifest, scope.role, scope.userId);
		const existing = await serviceClient.auth.admin.getUserById(scope.userId);
		if (isMissingAuthUser(existing)) return;
		const user = existing.data?.user;
		if (
			existing.error ||
			!user ||
			!authUserIsConfirmed(user) ||
			!actorProvenanceMatches(config, actor, user)
		) {
			throw new HostedEvidenceOperatorError('fresh A9 actor rollback scope is invalid');
		}
		await deleteAndConfirmAbsent(scope.userId, 'A9 actor rollback was not confirmed');
	}

	/** @param {{ manifest: HostedRunManifest, role: string, userId: string }} scope */
	async function createActorSession(scope) {
		const credentials = exactActorCredentials(config, scope.role);
		const actor = exactFreshManifestActor(config, scope.manifest, scope.role, scope.userId);
		await lookupConfirmedUser({
			role: scope.role,
			userId: scope.userId,
			createdAt: actor.createdAt,
			provisioningAttemptId: actor.provisioningAttemptId
		});
		const actorClient = createActorClient();
		const signIn = await actorClient.auth.signInWithPassword({
			email: credentials.email,
			password: credentials.password
		});
		if (
			signIn.error ||
			!signIn.data.user ||
			signIn.data.user.id !== scope.userId ||
			typeof signIn.data.user.email !== 'string' ||
			signIn.data.user.email.toLowerCase() !== credentials.email
		) {
			throw new HostedEvidenceOperatorError('A9 actor-owned sign-in failed');
		}

		/** @param {string} functionName @param {Record<string, unknown> | undefined} args */
		async function callActorRpc(functionName, args) {
			const result = args
				? await actorClient.rpc(functionName, args)
				: await actorClient.rpc(functionName);
			if (result.error) throw new HostedEvidenceOperatorError('A9 actor-owned lifecycle call failed');
			return result.data;
		}

		/** @param {string} factorId */
		async function rollbackModeratorFactor(factorId) {
			let rollbackFailed = false;
			try {
				const unenrolled = await actorClient.auth.mfa.unenroll({ factorId });
				const factors = await actorClient.auth.mfa.listFactors();
				rollbackFailed =
					Boolean(unenrolled.error) ||
					Boolean(factors.error) ||
					!Array.isArray(factors.data?.totp) ||
					factors.data.totp.some((factor) => factor.id === factorId);
			} catch {
				rollbackFailed = true;
			}
			try {
				await credentialSink.deleteModeratorTotpSecret({ role: scope.role });
			} catch {
				rollbackFailed = true;
			}
			if (rollbackFailed) {
				throw new HostedEvidenceOperatorError('A9 MFA enrollment compensation failed');
			}
		}

		async function getAuthenticatorAssuranceLevel() {
			const result = await actorClient.auth.mfa.getAuthenticatorAssuranceLevel();
			if (result.error || !result.data) {
				throw new HostedEvidenceOperatorError('A9 actor-owned MFA assurance lookup failed');
			}
			return Object.freeze({
				currentLevel: result.data.currentLevel ?? null,
				nextLevel: result.data.nextLevel ?? null
			});
		}

		async function enrollModeratorFactor() {
			if (!new Set(['assigned-moderator', 'unassigned-moderator']).has(scope.role)) {
				throw new HostedEvidenceOperatorError('A9 MFA enrollment is limited to moderator actors');
			}
			const result = await actorClient.auth.mfa.enroll({
				factorType: 'totp',
				friendlyName: 'Perfume marketplace A9 moderator'
			});
			const factorId = result.data?.id;
			const secret = result.data?.totp?.secret;
			if (
				result.error ||
				typeof factorId !== 'string' ||
				factorId.length === 0 ||
				typeof secret !== 'string'
			) {
				throw new HostedEvidenceOperatorError('A9 actor-owned MFA enrollment failed');
			}
			try {
				decodeBase32Secret(secret);
				await credentialSink.storeModeratorTotpSecret({ role: scope.role, secret });
			} catch {
				await rollbackModeratorFactor(factorId);
				throw new HostedEvidenceOperatorError('ephemeral moderator credential delivery failed');
			}
			return { factorId, secret };
		}

		/** @param {{ factorId: string, code: string }} verification */
		async function challengeAndVerify(verification) {
			if (
				typeof verification.factorId !== 'string' ||
				verification.factorId.length === 0 ||
				!/^\d{6}$/u.test(verification.code)
			) {
				throw new HostedEvidenceOperatorError('A9 MFA verification input is invalid');
			}
			const result = await actorClient.auth.mfa.challengeAndVerify({
				factorId: verification.factorId,
				code: verification.code
			});
			if (result.error) {
				throw new HostedEvidenceOperatorError('A9 actor-owned MFA verification failed');
			}
			return Object.freeze({ verified: true });
		}

		async function listFactors() {
			const result = await actorClient.auth.mfa.listFactors();
			if (result.error || !Array.isArray(result.data?.totp)) {
				throw new HostedEvidenceOperatorError('A9 actor-owned MFA factor lookup failed');
			}
			return Object.freeze(
				result.data.totp.map((factor) =>
					Object.freeze({ id: String(factor.id), status: String(factor.status) })
				)
			);
		}

		const mfa = Object.freeze({
			getAuthenticatorAssuranceLevel,
			async enroll() {
				const { factorId } = await enrollModeratorFactor();
				return Object.freeze({ factorId, factorType: 'totp' });
			},
			challengeAndVerify,
			listFactors,
			/** @param {{ clock?: () => number }} input */
			async enrollAndVerify(input) {
				const clock = input?.clock ?? Date.now;
				if (typeof clock !== 'function') {
					throw new HostedEvidenceOperatorError('A9 moderator MFA clock is invalid');
				}
				const initialAal = await getAuthenticatorAssuranceLevel();
				const initialFactors = await listFactors();
				if (initialAal.currentLevel !== 'aal1' || initialFactors.length !== 0) {
					throw new HostedEvidenceOperatorError('A9 moderator MFA precondition failed');
				}
				const { factorId, secret } = await enrollModeratorFactor();
				try {
					const timestampMs = clock();
					if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
						throw new HostedEvidenceOperatorError('A9 moderator MFA clock is invalid');
					}
					await challengeAndVerify({
						factorId,
						code: generateTotpCode(secret, timestampMs)
					});
					const [factors, finalAal] = await Promise.all([
						listFactors(),
						getAuthenticatorAssuranceLevel()
					]);
					if (
						factors.length !== 1 ||
						factors[0].id !== factorId ||
						factors[0].status !== 'verified' ||
						finalAal.currentLevel !== 'aal2'
					) {
						throw new HostedEvidenceOperatorError('A9 moderator MFA attestation failed');
					}
				} catch {
					await rollbackModeratorFactor(factorId);
					throw new HostedEvidenceOperatorError('A9 moderator MFA verification failed');
				}
				return Object.freeze({
					factorId,
					factorType: 'totp',
					factorStatus: 'verified',
					initialAal: 'aal1',
					finalAal: 'aal2'
				});
			},
			/** @param {{ factorId: string }} input */
			async rollbackEnrollment(input) {
				if (typeof input.factorId !== 'string' || input.factorId.length === 0) {
					throw new HostedEvidenceOperatorError('A9 MFA rollback input is invalid');
				}
				await rollbackModeratorFactor(input.factorId);
			}
		});

		return Object.freeze({
			role: scope.role,
			userId: scope.userId,
			claimOpenRegistration: () => callActorRpc('claim_open_registration', undefined),
			/** @param {{ documentCode: string, documentVersion: string }} input */
			acceptBetaConsent(input) {
				if (!input.documentCode?.trim() || !input.documentVersion?.trim()) {
					throw new HostedEvidenceOperatorError('A9 consent input is invalid');
				}
				return callActorRpc('accept_beta_consent', {
					requested_document_code: input.documentCode,
					requested_document_version: input.documentVersion
				});
			},
			/** @param {{ username: string, city?: string | null }} input */
			completeBetaOnboarding(input) {
				if (!/^[\p{L}\p{N}_.-]{3,40}$/u.test(input.username)) {
					throw new HostedEvidenceOperatorError('A9 onboarding input is invalid');
				}
				return callActorRpc('complete_beta_onboarding', {
					desired_username: input.username,
					home_city: input.city ?? null
				});
			},
			getMyBetaAccess: () => callActorRpc('get_my_beta_access', undefined),
			mfa
		});
	}

	/** @param {{ manifest: HostedRunManifest, role: string, userId: string }} scope */
	async function inspectFreshActor(scope) {
		const actor = exactFreshManifestActor(config, scope.manifest, scope.role, scope.userId);
		await lookupConfirmedUser({
			role: scope.role,
			userId: scope.userId,
			createdAt: actor.createdAt,
			provisioningAttemptId: actor.provisioningAttemptId
		});
		const [profileResult, membershipResult] = await Promise.all([
			serviceClient
				.from('profiles')
				.select('id, role, is_suspended')
				.eq('id', scope.userId)
				.maybeSingle(),
			serviceClient
				.from('beta_memberships')
				.select('profile_id, status, onboarding_completed_at')
				.eq('profile_id', scope.userId)
				.maybeSingle()
		]);
		const profile = profileResult.data;
		const membership = membershipResult.data;
		const expectedProfileRole = new Set(['assigned-moderator', 'unassigned-moderator']).has(
			scope.role
		)
			? 'moderator'
			: 'user';
		if (
			profileResult.error ||
			membershipResult.error ||
			!profile ||
			!membership ||
			profile.id !== scope.userId ||
			membership.profile_id !== scope.userId ||
			profile.role !== expectedProfileRole ||
			profile.is_suspended !== false ||
			membership.status !== 'active' ||
			typeof membership.onboarding_completed_at !== 'string' ||
			!Number.isFinite(Date.parse(membership.onboarding_completed_at))
		) {
			throw new HostedEvidenceOperatorError('exact A9 actor state inspection failed');
		}
		return Object.freeze({
			role: scope.role,
			userId: scope.userId,
			emailConfirmed: true,
			profileRole: String(profile.role),
			isSuspended: Boolean(profile.is_suspended),
			membershipStatus: String(membership.status),
			onboardingComplete: typeof membership.onboarding_completed_at === 'string'
		});
	}

	/** @param {{ effectiveAt: string }} scope */
	async function inspectRequiredAccessDocuments(scope) {
		const effectiveAt = requireIsoTimestamp(scope.effectiveAt);
		const result = await serviceClient
			.from('beta_legal_documents')
			.select('document_code, document_version')
			.eq('required_for_access', true)
			.is('retired_at', null)
			.lte('effective_at', effectiveAt)
			.order('document_code', { ascending: true });
		if (result.error || !Array.isArray(result.data) || result.data.length === 0) {
			throw new HostedEvidenceOperatorError('A9 required-document inspection failed');
		}
		const documents = result.data.map((document) => {
			const documentCode = document?.document_code;
			const documentVersion = document?.document_version;
			if (
				typeof documentCode !== 'string' ||
				!/^[a-z][a-z0-9_]{1,63}$/u.test(documentCode) ||
				typeof documentVersion !== 'string' ||
				documentVersion.trim().length === 0 ||
				documentVersion.length > 80
			) {
				throw new HostedEvidenceOperatorError('A9 required-document inspection failed');
			}
			return Object.freeze({ documentCode, documentVersion });
		});
		if (new Set(documents.map((document) => document.documentCode)).size !== documents.length) {
			throw new HostedEvidenceOperatorError('A9 required-document inspection failed');
		}
		return Object.freeze(documents);
	}

	/** @param {{ data?: unknown, error?: unknown, count?: number | null }} result @param {string} message */
	function exactCount(result, message) {
		const count = result.count;
		if (result.error || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
			throw new HostedEvidenceOperatorError(message);
		}
		return count;
	}

	/** @param {{ manifest: HostedRunManifest }} scope */
	async function inspectZeroA9Artifacts(scope) {
		const actors = assertCompleteA9Manifest(config, scope.manifest);
		const actorIds = actors.map((actor) => actor.userId);
		const [reportsResult, uploadsResult, queueResult] = await Promise.all([
			serviceClient
				.from('reports')
				.select('id', { count: 'exact', head: true })
				.in('reporter_id', actorIds),
			serviceClient
				.from('report_evidence_uploads')
				.select('id', { count: 'exact', head: true })
				.in('uploader_id', actorIds),
			serviceClient
				.from('upload_cleanup_queue')
				.select('id', { count: 'exact', head: true })
				.or(actorIds.map((userId) => `storage_path.like.${userId}/%`).join(','))
		]);
		let objects = 0;
		for (const actor of actors) {
			const listed = await serviceClient.storage
				.from('report-evidence')
				.list(actor.userId, { limit: 100, offset: 0 });
			if (listed.error || !Array.isArray(listed.data)) {
				throw new HostedEvidenceOperatorError('exact A9 object inspection failed');
			}
			objects += listed.data.length;
		}
		return Object.freeze({
			reports: exactCount(reportsResult, 'exact A9 report inspection failed'),
			uploads: exactCount(uploadsResult, 'exact A9 upload inspection failed'),
			objects,
			queueRows: exactCount(queueResult, 'exact A9 cleanup-row inspection failed')
		});
	}

	/**
	 * @param {{ manifest: HostedRunManifest, role: string, userId: string, fromRole: string, toRole: string }} scope
	 */
	async function elevateFreshActorRole(scope) {
		if (
			scope.fromRole !== 'user' ||
			scope.toRole !== 'moderator' ||
			!new Set(['assigned-moderator', 'unassigned-moderator']).has(scope.role)
		) {
			throw new HostedEvidenceOperatorError('only user to moderator elevation is permitted');
		}
		const actor = exactFreshManifestActor(config, scope.manifest, scope.role, scope.userId);
		await lookupConfirmedUser({
			role: scope.role,
			userId: scope.userId,
			createdAt: actor.createdAt,
			provisioningAttemptId: actor.provisioningAttemptId
		});
		const result = await serviceClient
			.from('profiles')
			.update({ role: 'moderator' })
			.eq('id', scope.userId)
			.eq('role', 'user')
			.select('id, role')
			.maybeSingle();
		if (
			result.error ||
			result.data?.id !== scope.userId ||
			result.data?.role !== 'moderator'
		) {
			throw new HostedEvidenceOperatorError('exact A9 moderator elevation failed');
		}
		return Object.freeze({
			role: scope.role,
			userId: scope.userId,
			fromRole: 'user',
			toRole: 'moderator'
		});
	}

	return Object.freeze({
		assertFreshActorAbsent,
		createConfirmedUser,
		lookupConfirmedUser,
		deleteFreshUser,
		createActorSession,
		inspectFreshActor,
		inspectRequiredAccessDocuments,
		inspectZeroA9Artifacts,
		elevateFreshActorRole
	});
}

/** @param {unknown} receipt */
function assertExactA9PrerequisiteReceipt(receipt) {
	const value = /** @type {Record<string, any>} */ (receipt);
	if (
		value?.target?.projectRef !== HOSTED_STAGING.projectRef ||
		value.target.organizationId !== HOSTED_STAGING.organizationId ||
		value.target.region !== HOSTED_STAGING.region ||
		value.target.postgresMajor !== 17 ||
		value.target.status !== 'ACTIVE_HEALTHY' ||
		value.publicSignupEnabled !== true ||
		value.emailAutoconfirmEnabled !== false ||
		value.anonymousUsersEnabled !== false
	) {
		throw new HostedEvidenceOperatorError('A9 hosted prerequisite verification failed');
	}
	return value;
}

/**
 * Re-verifies immutable project identity, privileged-key inventory, and the
 * read-only hosted Auth policy immediately before an A9 transaction.
 *
 * @param {{
 *   environment?: OperatorEnvironment,
 *   dependencies?: {
 *     verifyTarget?: (options: { environment: OperatorEnvironment, requireServiceRole: boolean }) => unknown,
 *     fetchImpl?: typeof fetch
 *   }
 * }} [options]
 */
export async function verifyHostedA9Prerequisites({
	environment = process.env,
	dependencies = {}
} = {}) {
	validateHostedA9Environment(environment);
	const verifyTarget = dependencies.verifyTarget ?? verifyStagingTarget;
	const fetchImpl = dependencies.fetchImpl ?? fetch;
	let target;
	let settings;
	try {
		target = /** @type {Record<string, any>} */ (
			await verifyTarget({ environment, requireServiceRole: true })
		);
		if (
			target?.ref !== HOSTED_STAGING.projectRef ||
			target?.organizationId !== HOSTED_STAGING.organizationId ||
			target?.region !== HOSTED_STAGING.region ||
			target?.postgresMajor !== 17 ||
			target?.status !== 'ACTIVE_HEALTHY' ||
			normalizeOrigin(target?.url) !== HOSTED_STAGING.supabaseUrl
		) {
			throw new Error('target mismatch');
		}
		const response = await fetchImpl(`${HOSTED_STAGING.supabaseUrl}/auth/v1/settings`, {
			method: 'GET',
			headers: {
				apikey: requirePrivateValue(environment, 'PUBLIC_SUPABASE_PUBLISHABLE_KEY')
			},
			cache: 'no-store'
		});
		if (!response.ok || response.status !== 200) throw new Error('settings unavailable');
		settings = await response.json();
	} catch {
		throw new HostedEvidenceOperatorError('A9 hosted prerequisite verification failed');
	}
	const receipt = Object.freeze({
		target: Object.freeze({
			projectRef: HOSTED_STAGING.projectRef,
			organizationId: HOSTED_STAGING.organizationId,
			region: HOSTED_STAGING.region,
			postgresMajor: 17,
			status: 'ACTIVE_HEALTHY'
		}),
		publicSignupEnabled: settings?.disable_signup === false,
		emailAutoconfirmEnabled: settings?.mailer_autoconfirm === true,
		anonymousUsersEnabled: settings?.external?.anonymous_users === true
	});
	assertExactA9PrerequisiteReceipt(receipt);
	return receipt;
}

const A9_ACTOR_ROLES = Object.freeze([
	'reporter',
	'cross-user',
	'assigned-moderator',
	'unassigned-moderator'
]);
const A9_MODERATOR_ROLES = new Set(['assigned-moderator', 'unassigned-moderator']);

/**
 * Executes A9 as one compensating transaction. It intentionally has no A10
 * scenario surface and leaves the successful synthetic actors in place for
 * the separately approved later step.
 *
 * @param {{
 *   environment?: OperatorEnvironment,
 *   adapters: Record<string, Function>,
 *   city?: string | null,
 *   clock?: () => number,
 *   initialManifest?: HostedRunManifest,
 *   verifyPrerequisites?: () => Promise<unknown>,
 *   persistManifest: (manifest: HostedRunManifest) => Promise<void> | void
 * }} options
 */
export async function executeHostedA9Provisioning({
	environment = process.env,
	adapters,
	city = null,
	clock = Date.now,
	initialManifest,
	verifyPrerequisites = () => verifyHostedA9Prerequisites({ environment }),
	persistManifest
}) {
	const config = validateHostedA9Environment(environment);
	const requiredAdapterMethods = [
		'assertFreshActorAbsent',
		'createConfirmedUser',
		'createActorSession',
		'elevateFreshActorRole',
		'inspectFreshActor',
		'inspectRequiredAccessDocuments',
		'inspectZeroA9Artifacts',
		'deleteFreshUser'
	];
	if (
		!adapters ||
		requiredAdapterMethods.some((name) => typeof adapters[name] !== 'function') ||
		typeof verifyPrerequisites !== 'function' ||
		typeof persistManifest !== 'function' ||
		typeof clock !== 'function'
	) {
		throw new HostedEvidenceOperatorError('A9 provisioning configuration is invalid');
	}

	let manifest = initialManifest ?? createHostedRunManifest(config);
	assertManifestTarget(config, manifest);
	if (
		manifest.pendingActors.length !== 0 ||
		manifest.actors.length !== 0 ||
		manifest.reports.length !== 0 ||
		manifest.uploads.length !== 0 ||
		manifest.queueRows.length !== 0
	) {
		throw new HostedEvidenceOperatorError('A9 initial manifest is not empty');
	}
	/** @type {Array<{ role: string, userId: string }>} */
	const createdActors = [];
	/** @type {Array<{ role: string, factorId: string, session: any }>} */
	const enrolledFactors = [];
	try {
		const prerequisites = assertExactA9PrerequisiteReceipt(await verifyPrerequisites());
		const documentInspectionTime = clock();
		if (!Number.isSafeInteger(documentInspectionTime) || documentInspectionTime < 0) {
			throw new HostedEvidenceOperatorError('A9 provisioning clock is invalid');
		}
		const requiredConsents = await adapters.inspectRequiredAccessDocuments({
			effectiveAt: new Date(documentInspectionTime).toISOString()
		});
		if (!Array.isArray(requiredConsents) || requiredConsents.length === 0) {
			throw new HostedEvidenceOperatorError('A9 required-document attestation failed');
		}
		for (const role of A9_ACTOR_ROLES) {
			manifest = registerHostedActorIntent(manifest, role);
			await persistManifest(manifest);
			const absence = await adapters.assertFreshActorAbsent({ manifest, role });
			if (absence?.role !== role || absence?.absent !== true) {
				throw new HostedEvidenceOperatorError('A9 actor absence attestation failed');
			}
			const actor = await adapters.createConfirmedUser({ manifest, role });
			if (actor?.role !== role || actor?.emailConfirmed !== true) {
				throw new HostedEvidenceOperatorError('A9 actor creation attestation failed');
			}
			manifest = registerHostedActor(manifest, role, actor.userId, actor.createdAt);
			createdActors.push({ role, userId: actor.userId });
			await persistManifest(manifest);
		}

		for (const actor of manifest.actors) {
			const session = await adapters.createActorSession({
				manifest,
				role: actor.role,
				userId: actor.userId
			});
			if (
				typeof session?.claimOpenRegistration !== 'function' ||
				typeof session?.acceptBetaConsent !== 'function' ||
				typeof session?.completeBetaOnboarding !== 'function' ||
				typeof session?.getMyBetaAccess !== 'function'
			) {
				throw new HostedEvidenceOperatorError('A9 actor session is invalid');
			}
			await session.claimOpenRegistration();
			for (const consent of requiredConsents) {
				if (!consent?.documentCode?.trim() || !consent?.documentVersion?.trim()) {
					throw new HostedEvidenceOperatorError('A9 required-document attestation failed');
				}
				await session.acceptBetaConsent(consent);
			}
			await session.completeBetaOnboarding({
				username: config.actorRoles[actor.role].username,
				city
			});
			await session.getMyBetaAccess();
			if (A9_MODERATOR_ROLES.has(actor.role)) {
				await adapters.elevateFreshActorRole({
					manifest,
					role: actor.role,
					userId: actor.userId,
					fromRole: 'user',
					toRole: 'moderator'
				});
				if (
					typeof session.mfa?.enrollAndVerify !== 'function' ||
					typeof session.mfa?.rollbackEnrollment !== 'function'
				) {
					throw new HostedEvidenceOperatorError('A9 moderator MFA session is invalid');
				}
				const enrollment = await session.mfa.enrollAndVerify({ clock });
				if (
					typeof enrollment?.factorId !== 'string' ||
					enrollment.factorType !== 'totp' ||
					enrollment.factorStatus !== 'verified' ||
					enrollment.initialAal !== 'aal1' ||
					enrollment.finalAal !== 'aal2'
				) {
					throw new HostedEvidenceOperatorError('A9 moderator MFA attestation failed');
				}
				enrolledFactors.push({
					role: actor.role,
					factorId: enrollment.factorId,
					session
				});
			}
		}

		const actorReceipts = [];
		for (const actor of manifest.actors) {
			const state = await adapters.inspectFreshActor({
				manifest,
				role: actor.role,
				userId: actor.userId
			});
			const expectedRole = A9_MODERATOR_ROLES.has(actor.role) ? 'moderator' : 'user';
			if (
				state?.role !== actor.role ||
				state?.userId !== actor.userId ||
				state?.emailConfirmed !== true ||
				state?.profileRole !== expectedRole ||
				state?.isSuspended !== false ||
				state?.membershipStatus !== 'active' ||
				state?.onboardingComplete !== true
			) {
				throw new HostedEvidenceOperatorError('A9 final actor attestation failed');
			}
			actorReceipts.push(
				Object.freeze({
					role: actor.role,
					userId: actor.userId,
					profileRole: expectedRole,
					membershipStatus: 'active',
					onboardingComplete: true,
					mfaStatus: A9_MODERATOR_ROLES.has(actor.role) ? 'verified' : 'not-required',
					initialAal: A9_MODERATOR_ROLES.has(actor.role) ? 'aal1' : null,
					finalAal: A9_MODERATOR_ROLES.has(actor.role) ? 'aal2' : null
				})
			);
		}
		const artifacts = await adapters.inspectZeroA9Artifacts({ manifest });
		if (
			artifacts?.reports !== 0 ||
			artifacts?.uploads !== 0 ||
			artifacts?.objects !== 0 ||
			artifacts?.queueRows !== 0
		) {
			throw new HostedEvidenceOperatorError('A9 zero-artifact attestation failed');
		}
		return Object.freeze({
			status: 'PASS',
			runId: config.runId,
			target: prerequisites.target,
			actors: Object.freeze(actorReceipts),
			artifacts: Object.freeze({ reports: 0, uploads: 0, objects: 0, queueRows: 0 })
		});
	} catch (error) {
		let rollbackFailed =
			error instanceof HostedEvidenceOperatorError &&
			/(?:rollback was not confirmed|compensation failed)$/u.test(error.message);
		for (const enrollment of [...enrolledFactors].reverse()) {
			try {
				await enrollment.session.mfa.rollbackEnrollment({ factorId: enrollment.factorId });
			} catch {
				rollbackFailed = true;
			}
		}
		for (const actor of [...createdActors].reverse()) {
			try {
				await adapters.deleteFreshUser({ manifest, role: actor.role, userId: actor.userId });
			} catch {
				rollbackFailed = true;
			}
		}
		if (rollbackFailed) {
			throw new HostedEvidenceOperatorError('A9 provisioning rollback was not confirmed');
		}
		throw new HostedEvidenceOperatorError('A9 provisioning failed after verified rollback');
	}
}

const INSPECTOR_ROLES = Object.freeze([
	'reporter',
	'cross-user',
	'assigned-moderator',
	'unassigned-moderator'
]);

/** @param {unknown} value */
function inspectorMetadata(value) {
	return value && typeof value === 'object'
		? /** @type {Record<string, unknown>} */ (value)
		: {};
}

/** @param {unknown} value */
function inspectorTimestamp(value) {
	const text = typeof value === 'string' ? value : '';
	return Number.isFinite(Date.parse(text)) ? text : null;
}

/** @param {unknown} value @param {readonly string[]} expectedKeys */
function exactInspectorDataRecord(value, expectedKeys) {
	if (!value || typeof value !== 'object' || isProxy(value)) return null;
	try {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return null;
		const keys = Reflect.ownKeys(value);
		if (
			keys.some((key) => typeof key !== 'string') ||
			keys.length !== expectedKeys.length ||
			!expectedKeys.every((key) => keys.includes(key))
		) {
			return null;
		}
		const entries = [];
		for (const key of expectedKeys) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
			entries.push([key, descriptor.value]);
		}
		return Object.freeze(Object.fromEntries(entries));
	} catch {
		return null;
	}
}

/** @param {unknown} value */
function exactInspectorStringArray(value) {
	if (isProxy(value) || !Array.isArray(value)) return null;
	try {
		if (Object.getPrototypeOf(value) !== Array.prototype) return null;
		const keys = Reflect.ownKeys(value);
		const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
		if (
			!lengthDescriptor ||
			!('value' in lengthDescriptor) ||
			!Number.isSafeInteger(lengthDescriptor.value) ||
			lengthDescriptor.value < 0
		) {
			return null;
		}
		const expectedKeys = [
			...Array.from({ length: lengthDescriptor.value }, (_, index) => String(index)),
			'length'
		];
		if (
			keys.some((key) => typeof key !== 'string') ||
			keys.length !== expectedKeys.length ||
			!expectedKeys.every((key) => keys.includes(key))
		) {
			return null;
		}
		const values = [];
		for (let index = 0; index < lengthDescriptor.value; index += 1) {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
			if (
				!descriptor ||
				!descriptor.enumerable ||
				!('value' in descriptor) ||
				typeof descriptor.value !== 'string'
			) {
				return null;
			}
			values.push(descriptor.value);
		}
		return Object.freeze(values);
	} catch {
		return null;
	}
}

/**
 * Creates the narrow Supabase read capability used by the universal Gate 3
 * inspector. The returned object deliberately contains no mutation, upload,
 * cleanup, RPC, or secret capability.
 *
 * @param {{
 *   projectRef: string,
 *   serviceClient: SupabaseClient,
 *   sessionCoverageReader?: {
 *     targetProjectRef: string,
 *     readActiveUserIds: (scope: { userIds: string[] }) => Promise<{ activeUserIds: string[] }>
 *   }
 * }} options
 */
export function createSupabaseHostedInspectionAdapter({
	projectRef,
	serviceClient,
	sessionCoverageReader
}) {
	let clientOrigin;
	try {
		clientOrigin = normalizeOrigin(
			/** @type {{ supabaseUrl?: string }} */ (/** @type {unknown} */ (serviceClient)).supabaseUrl ?? ''
		);
	} catch {
		throw new HostedEvidenceOperatorError('hosted_inspection_target_invalid');
	}
	if (projectRef !== HOSTED_STAGING.projectRef || clientOrigin !== HOSTED_STAGING.supabaseUrl) {
		throw new HostedEvidenceOperatorError('hosted_inspection_target_invalid');
	}
	/** @type {{ targetProjectRef: string, readActiveUserIds: (scope: { userIds: string[] }) => unknown } | null} */
	let exactSessionReader = null;
	try {
		const reader = exactInspectorDataRecord(sessionCoverageReader, [
			'targetProjectRef',
			'readActiveUserIds'
		]);
		if (
			reader?.targetProjectRef === projectRef &&
			typeof reader.readActiveUserIds === 'function' &&
			!isProxy(reader.readActiveUserIds)
		) {
			const readActiveUserIds = reader.readActiveUserIds;
			exactSessionReader = Object.freeze({
				targetProjectRef: projectRef,
				readActiveUserIds: (scope) => Reflect.apply(readActiveUserIds, undefined, [scope])
			});
		}
	} catch {
		exactSessionReader = null;
	}
	const postgrestPageSize = 1000;
	const postgrestPageLimit = 100;
	const tableOrderColumns = /** @type {Readonly<Record<string, string>>} */ (Object.freeze({
		profiles: 'id',
		beta_memberships: 'profile_id',
		reports: 'id',
		report_evidence_uploads: 'id',
		upload_cleanup_queue: 'id'
	}));

	/**
	 * @param {string} table
	 * @param {string} selection
	 * @param {(query: any) => any} applyFilter
	 * @param {{ from: (table: string) => any }} [queryClient]
	 */
	async function paginatedRows(table, selection, applyFilter, queryClient = serviceClient) {
		const orderColumn = tableOrderColumns[table];
		if (!orderColumn) throw new Error('provider read failed');
		/** @type {Array<Record<string, unknown>>} */
		const rows = [];
		for (let page = 0; page < postgrestPageLimit; page += 1) {
			const from = page * postgrestPageSize;
			const query = applyFilter(queryClient.from(table).select(selection));
			const result = await query
				.order(orderColumn, { ascending: true })
				.range(from, from + postgrestPageSize - 1);
			if (
				result.error ||
				!Array.isArray(result.data) ||
				result.data.length > postgrestPageSize
			) {
				throw new Error('provider read failed');
			}
			rows.push(
				.../** @type {Array<Record<string, unknown>>} */ (/** @type {unknown} */ (result.data))
			);
			if (result.data.length < postgrestPageSize) return rows;
		}
		throw new Error('provider read failed');
	}

	/** @param {string} table @param {string} selection @param {string} column @param {readonly (string | number)[]} values */
	async function rowsByValues(table, selection, column, values) {
		if (values.length === 0) return [];
		/** @type {Array<Record<string, unknown>>} */
		const rows = [];
		for (let offset = 0; offset < values.length; offset += 100) {
			rows.push(
				...(await paginatedRows(table, selection, (query) =>
					query.in(column, [...values.slice(offset, offset + 100)])
				))
			);
		}
		return rows;
	}

	/** @param {string} table @param {string} selection @param {string} column @param {readonly string[]} prefixes */
	async function rowsByPrefixes(table, selection, column, prefixes) {
		/** @type {Array<Record<string, unknown>>} */
		const rows = [];
		for (const prefix of prefixes) {
			rows.push(
				...(await paginatedRows(table, selection, (query) =>
					query.like(column, `${prefix}/%`)
				))
			);
		}
		return rows;
	}

	/** @param {Array<Record<string, unknown>>} rows */
	function uniqueRows(rows) {
		const seen = new Set();
		return rows.filter((row) => {
			const key = JSON.stringify(row);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	/** @param {Record<string, any>} scope */
	async function inspectRunInternal(scope) {
		if (
			typeof scope?.runId !== 'string' ||
			!/^gate3-\d{8}-[a-f0-9]{8}$/u.test(scope.runId) ||
			!inspectorTimestamp(scope.createdAfter) ||
			!scope.manifest ||
			scope.manifest.targetProjectRef !== HOSTED_STAGING.projectRef ||
			scope.manifest.runId !== scope.runId ||
			!UUID_PATTERN.test(scope.manifest.provisioningAttemptId) ||
			!Array.isArray(scope.manifest.pendingActors) ||
			!Array.isArray(scope.manifest.actors) ||
			!Array.isArray(scope.manifest.reports) ||
			!Array.isArray(scope.manifest.uploads) ||
			!Array.isArray(scope.manifest.queueRows) ||
			!Array.isArray(scope.expectedIdentities) ||
			scope.expectedIdentities.length !== INSPECTOR_ROLES.length
		) {
			throw new HostedEvidenceOperatorError('hosted_inspection_scope_invalid');
		}
		let manifest;
		try {
			manifest = validateHostedRunManifest(
				/** @type {HostedOperatorConfig} */ ({
					target: HOSTED_STAGING,
					runId: scope.runId
				}),
				scope.manifest
			);
		} catch {
			throw new HostedEvidenceOperatorError('hosted_inspection_scope_invalid');
		}
		const identities = /** @type {Array<Record<string, unknown>>} */ (scope.expectedIdentities);
		if (
			INSPECTOR_ROLES.some(
				(role) =>
					identities.filter(
						(identity) =>
							identity.role === role &&
							typeof identity.email === 'string' &&
							typeof identity.username === 'string'
					).length !== 1
			)
		) {
			throw new HostedEvidenceOperatorError('hosted_inspection_scope_invalid');
		}

		/** @type {Array<Record<string, any>>} */
		const users = [];
		const perPage = 1000;
		/** @type {number | null} */
		let expectedTotal = null;
		const seenUserIds = new Set();
		for (let page = 1; page <= 100; page += 1) {
			const listed = await serviceClient.auth.admin.listUsers({ page, perPage });
			if (listed.error || !Array.isArray(listed.data?.users)) throw new Error('provider read failed');
			const pageUsers = listed.data.users;
			if (pageUsers.length > perPage) throw new Error('provider read failed');
			if (Object.prototype.hasOwnProperty.call(listed.data, 'total')) {
				if (!Number.isSafeInteger(listed.data.total) || listed.data.total < 0) {
					throw new Error('provider read failed');
				}
				if (expectedTotal === null) expectedTotal = listed.data.total;
				else if (expectedTotal !== listed.data.total) throw new Error('provider read failed');
			}
			for (const user of pageUsers) {
				const id = typeof user?.id === 'string' ? user.id : '';
				if (!id || seenUserIds.has(id)) throw new Error('provider read failed');
				seenUserIds.add(id);
				users.push(user);
			}
			if (expectedTotal !== null) {
				if (users.length > expectedTotal) throw new Error('provider read failed');
				if (users.length === expectedTotal) break;
				if (pageUsers.length < perPage) throw new Error('provider read failed');
			} else if (pageUsers.length < perPage) {
				break;
			}
			if (page === 100) throw new Error('provider read failed');
		}

		/** @type {Map<string, Array<Record<string, any>>>} */
		const exactByRole = new Map(INSPECTOR_ROLES.map((role) => [role, []]));
		/** @type {Map<string, Array<Record<string, any>>>} */
		const relevantByRole = new Map(
			identities.map((identity) => [String(identity.role), []])
		);
		let metadataMismatches = 0;
		for (const identity of identities) {
			const role = String(identity.role);
			const expectedEmail = String(identity.email).toLowerCase();
			const candidates = users.filter(
				(user) => typeof user.email === 'string' && user.email.toLowerCase() === expectedEmail
			);
			relevantByRole.set(role, candidates);
			const exact = candidates.filter((user) => {
				const metadata = inspectorMetadata(user.user_metadata);
				const createdAt = inspectorTimestamp(user.created_at);
				if (
					!createdAt ||
					Date.parse(createdAt) < Date.parse(scope.createdAfter) ||
					metadata.gate3_report_evidence_run_id !== scope.runId ||
					metadata.gate3_report_evidence_provisioning_attempt_id !==
							manifest.provisioningAttemptId
				) {
					return false;
				}
				return true;
			});
			exactByRole.set(role, exact);
			metadataMismatches += candidates.length - exact.length;
		}

		const exactUsers = [...exactByRole.values()].flat();
		const exactUserIds = new Set(exactUsers.map((user) => String(user.id)));
		let activeSessionUserIds = [];
		let activeSessionsProven = false;
		if (exactUserIds.size > 0 && exactSessionReader) {
			try {
				const ids = [...exactUserIds];
				const pendingCoverage = exactSessionReader.readActiveUserIds({ userIds: ids });
				if (
					isProxy(pendingCoverage) ||
					!isPromise(pendingCoverage) ||
					Object.getPrototypeOf(pendingCoverage) !== Promise.prototype
				) {
					throw new Error('session coverage read failed');
				}
				const coverage = await pendingCoverage;
				const coverageRecord = exactInspectorDataRecord(coverage, ['activeUserIds']);
				const coverageIds = exactInspectorStringArray(coverageRecord?.activeUserIds);
				if (
					!coverageIds ||
					coverageIds.some(
						(userId) => typeof userId !== 'string' || !exactUserIds.has(userId)
					) ||
					new Set(coverageIds).size !== coverageIds.length
				) {
					throw new Error('session coverage read failed');
				}
				activeSessionUserIds = [...coverageIds];
				activeSessionsProven = true;
			} catch {
				activeSessionUserIds = [];
				activeSessionsProven = false;
			}
		}
		const actorsWithActiveSessions = activeSessionUserIds.length;
		const exactOwnerIds = new Set([
			...exactUserIds,
			...manifest.actors.map((actor) => String(actor.userId))
		]);
		const relevantUsers = [...relevantByRole.values()].flat();
		const foreignUsers = users.filter((user) => {
			if (exactUserIds.has(String(user.id))) return false;
			const email = typeof user.email === 'string' ? user.email.toLowerCase() : '';
			return (
				relevantUsers.some((candidate) => candidate === user) ||
				/^gate3-v\d+-[a-z0-9-]+-[a-f0-9]{16}@example\.invalid$/u.test(email)
			);
		});
		const foreignUserIds = new Set(foreignUsers.map((user) => String(user.id)));
		const allOwnerIds = [...new Set([...exactOwnerIds, ...foreignUserIds])];

		const profiles = await rowsByValues(
			'profiles',
			'id, username, role, is_suspended',
			'id',
			allOwnerIds
		);
		const memberships = await rowsByValues(
			'beta_memberships',
			'profile_id, status, onboarding_completed_at',
			'profile_id',
			allOwnerIds
		);
		const reports = uniqueRows([
			...(await rowsByValues(
				'reports',
				'id, reporter_id, target_id, evidence_paths, status, assigned_to',
				'reporter_id',
				allOwnerIds
			)),
			...(await rowsByValues(
				'reports',
				'id, reporter_id, target_id, evidence_paths, status, assigned_to',
				'id',
				manifest.reports.map((report) => String(report.id))
			))
		]);
		const uploads = uniqueRows([
			...(await rowsByValues(
				'report_evidence_uploads',
				'id, uploader_id, storage_path, status, report_id, created_at, finalized_at, attached_at',
				'uploader_id',
				allOwnerIds
			)),
			...(await rowsByValues(
				'report_evidence_uploads',
				'id, uploader_id, storage_path, status, report_id, created_at, finalized_at, attached_at',
				'id',
				manifest.uploads.map((upload) => String(upload.id))
			))
		]);

		/** @type {Array<{ ownerId: string, path: string }>} */
		const objects = [];
		for (const ownerId of allOwnerIds) {
			for (let page = 0; page < 100; page += 1) {
				const listed = await serviceClient.storage
					.from('report-evidence')
					.list(ownerId, { limit: 1000, offset: page * 1000 });
				if (listed.error || !Array.isArray(listed.data)) throw new Error('provider read failed');
				for (const object of listed.data) {
					if (typeof object?.name === 'string') {
						objects.push({ ownerId, path: `${ownerId}/${object.name}` });
					}
				}
				if (listed.data.length < 1000) break;
				if (page === 99) throw new Error('provider read failed');
			}
		}
		const queuePaths = [
			...uploads.map((upload) => String(upload.storage_path ?? '')),
			...manifest.uploads.map((upload) => String(upload.objectPath))
		].filter(Boolean);
		const queueSelection =
			'id, storage_path, report_evidence_upload_id, upload_id, processed_at';
		const manifestUploadIds = manifest.uploads.map((upload) => String(upload.id));
		const queueRows = uniqueRows([
			...(await rowsByValues(
				'upload_cleanup_queue',
				queueSelection,
				'storage_path',
				[...new Set(queuePaths)]
			)),
			...(await rowsByValues(
				'upload_cleanup_queue',
				queueSelection,
				'id',
				manifest.queueRows.map((queue) => Number(queue.id))
			)),
			...(await rowsByValues(
				'upload_cleanup_queue',
				queueSelection,
				'report_evidence_upload_id',
				manifestUploadIds
			)),
			...(await rowsByValues(
				'upload_cleanup_queue',
				queueSelection,
				'upload_id',
				manifestUploadIds
			)),
			...(await rowsByPrefixes(
				'upload_cleanup_queue',
				queueSelection,
				'storage_path',
				allOwnerIds
			))
		]);

		const exactProfiles = profiles.filter((row) => exactOwnerIds.has(String(row.id)));
		const exactReports = reports.filter((row) => exactOwnerIds.has(String(row.reporter_id)));
		const exactUploads = uploads.filter((row) => exactOwnerIds.has(String(row.uploader_id)));
		const exactObjects = objects.filter((object) => exactOwnerIds.has(object.ownerId));
		const exactPaths = new Set([
			...exactUploads.map((upload) => String(upload.storage_path)),
			...manifest.uploads
				.filter((upload) => exactOwnerIds.has(String(upload.uploaderId)))
				.map((upload) => String(upload.objectPath))
		]);
		const manifestQueueIds = new Set(manifest.queueRows.map((queue) => String(queue.id)));
		const exactQueueRows = queueRows.filter((row) => {
			const path = String(row.storage_path);
			return (
				manifestQueueIds.has(String(row.id)) ||
				exactPaths.has(path) ||
				[...exactOwnerIds].some((ownerId) => path.startsWith(`${ownerId}/`)) ||
				manifestUploadIds.includes(String(row.report_evidence_upload_id)) ||
				manifestUploadIds.includes(String(row.upload_id))
			);
		});

		const foreignProfiles = profiles.filter((row) => foreignUserIds.has(String(row.id)));
		const foreignReports = reports.filter((row) => !exactOwnerIds.has(String(row.reporter_id)));
		const foreignUploads = uploads.filter((row) => !exactOwnerIds.has(String(row.uploader_id)));
		const foreignObjects = objects.filter((object) => !exactOwnerIds.has(object.ownerId));
		const foreignQueueRows = queueRows.filter((row) => !exactQueueRows.includes(row));

		for (const report of manifest.reports) {
			const actor = manifest.actors.find((entry) => entry.role === report.actorRole);
			const row = reports.find((entry) => String(entry.id) === String(report.id));
			if (row && actor && String(row.reporter_id) !== String(actor.userId)) metadataMismatches += 1;
		}
		for (const upload of manifest.uploads) {
			const row = uploads.find((entry) => String(entry.id) === String(upload.id));
			if (
				row &&
				(String(row.uploader_id) !== String(upload.uploaderId) ||
					String(row.storage_path) !== String(upload.objectPath))
			) {
				metadataMismatches += 1;
			}
		}
		for (const queue of manifest.queueRows) {
			const upload = manifest.uploads.find((entry) => entry.id === queue.uploadId);
			const row = queueRows.find((entry) => String(entry.id) === String(queue.id));
			if (
				row &&
				upload &&
				(String(row.storage_path) !== String(upload.objectPath) ||
					![row.report_evidence_upload_id, row.upload_id]
						.map(String)
						.includes(String(upload.id)))
			) {
				metadataMismatches += 1;
			}
		}
		let manifestActorsAbsent = 0;
		let actorIdentityConflicts = 0;
		for (const actor of manifest.actors) {
			const roleUsers = exactByRole.get(actor.role) ?? [];
			const matchingUser = roleUsers.find(
				(user) => user.id === actor.userId
			);
			if (!matchingUser) {
				manifestActorsAbsent += 1;
				if (roleUsers.some((user) => user.id !== actor.userId)) actorIdentityConflicts += 1;
			} else if (inspectorTimestamp(matchingUser.created_at) !== actor.createdAt) {
				manifestActorsAbsent += 1;
				metadataMismatches += 1;
			}
		}

		const foreignCoordinates = [
			...foreignUsers.map((user) => `account:${String(user.id)}`),
			...foreignProfiles.map((row) => `profile:${String(row.id)}`),
			...foreignReports.map((row) => `report:${String(row.id)}`),
			...foreignUploads.map((row) => `upload:${String(row.id)}`),
			...foreignObjects.map((object) => `object:${object.path}`),
			...foreignQueueRows.map(
				(row) => `queue:${String(row.id)}:${String(row.storage_path)}`
			)
		].sort();
		const roleCounts = Object.fromEntries(
			INSPECTOR_ROLES.map((role) => [role, exactByRole.get(role)?.length ?? 0])
		);
		const pendingRoles = new Set(manifest.pendingActors.map((actor) => actor.role));
		const actorRoles = new Set(manifest.actors.map((actor) => actor.role));
		const confirmedActors = exactUsers.filter((user) =>
			Boolean(inspectorTimestamp(user.email_confirmed_at))
		).length;
		const completeProfiles = identities.filter((identity) => {
			const exactUser = (exactByRole.get(String(identity.role)) ?? [])[0];
			if (!exactUser) return false;
			const profile = profiles.find((row) => String(row.id) === String(exactUser.id));
			const membership = memberships.find(
				(row) => String(row.profile_id) === String(exactUser.id)
			);
			const expectedRole = String(identity.role).includes('moderator') ? 'moderator' : 'user';
			return (
				profile?.username === identity.username &&
				profile?.role === expectedRole &&
				profile?.is_suspended === false &&
				membership?.status === 'active' &&
				Boolean(inspectorTimestamp(membership?.onboarding_completed_at))
			);
		}).length;
		const verifiedModeratorTotpFactors = identities
			.filter((identity) => String(identity.role).includes('moderator'))
			.reduce((sum, identity) => {
				const user = (exactByRole.get(String(identity.role)) ?? [])[0];
				if (!user || !Array.isArray(user.factors)) return sum;
				return (
					sum +
					user.factors.filter(
						(factor) => factor?.factor_type === 'totp' && factor?.status === 'verified'
					).length
				);
			}, 0);
		const moderatorsWithVerifiedTotp = identities
			.filter((identity) => String(identity.role).includes('moderator'))
			.filter((identity) => {
				const user = (exactByRole.get(String(identity.role)) ?? [])[0];
				return Boolean(
					user &&
					Array.isArray(user.factors) &&
					user.factors.some(
						(factor) => factor?.factor_type === 'totp' && factor?.status === 'verified'
					)
				);
			}).length;
		const scenarioEvidence =
			scope.scenarioEvidence &&
			typeof scope.scenarioEvidence === 'object' &&
			!Array.isArray(scope.scenarioEvidence)
				? scope.scenarioEvidence
				: { phase: { status: 'pending', checkpoint: null }, checkpoints: {} };
		const scenarioCheckpointKey = 'scenario-primary-upload-attached';
		const scenarioCheckpointStep = 'primary-upload-attached';
		/** @param {unknown} checkpoint */
		const checkpointIsExactAndComplete = (checkpoint) => {
			if (!checkpoint || typeof checkpoint !== 'object') return false;
			const value = /** @type {Record<string, unknown>} */ (checkpoint);
			return (
				value.status === 'complete' &&
				value.step === scenarioCheckpointStep &&
				Boolean(inspectorTimestamp(value.observedAt))
			);
		};
		const scenarioPhase =
			scenarioEvidence.phase && typeof scenarioEvidence.phase === 'object'
				? scenarioEvidence.phase
				: { status: 'pending', checkpoint: null };
		const scenarioCheckpoints =
			scenarioEvidence.checkpoints &&
			typeof scenarioEvidence.checkpoints === 'object' &&
			!Array.isArray(scenarioEvidence.checkpoints)
				? /** @type {Record<string, unknown>} */ (scenarioEvidence.checkpoints)
				: {};
		const exactCheckpoint = scenarioCheckpoints[scenarioCheckpointKey];
		const exactCheckpointComplete = checkpointIsExactAndComplete(exactCheckpoint);
		const phaseCheckpointMatches = Boolean(
			checkpointIsExactAndComplete(scenarioPhase.checkpoint) &&
			scenarioPhase.checkpoint.observedAt ===
				/** @type {Record<string, unknown>} */ (exactCheckpoint).observedAt
		);
		const scenarioStarted = Boolean(
			scenarioPhase.status !== 'pending' || Object.keys(scenarioCheckpoints).length > 0
		);
		const reporterId = (exactByRole.get('reporter') ?? [])[0]?.id;
		const crossUserId = (exactByRole.get('cross-user') ?? [])[0]?.id;
		const assignedModeratorId = (exactByRole.get('assigned-moderator') ?? [])[0]?.id;
		const liveScenarioAnchor = manifest.reports
			.filter((report) => report.actorRole === 'reporter')
			.some((manifestReport) => {
				const liveReport = reports.find(
					(row) =>
						String(row.id) === String(manifestReport.id) &&
						String(row.reporter_id) === String(reporterId) &&
						String(row.target_id) === String(crossUserId) &&
						String(row.assigned_to) === String(assignedModeratorId) &&
						row.status === 'investigating'
				);
				if (!liveReport || !Array.isArray(liveReport.evidence_paths)) return false;
				const evidencePaths = liveReport.evidence_paths.map(String);
				return manifest.uploads
					.filter(
						(upload) =>
							upload.actorRole === 'reporter' &&
							String(upload.uploaderId) === String(reporterId)
					)
					.some((manifestUpload) => {
						const liveUpload = uploads.find(
							(upload) =>
								String(upload.id) === String(manifestUpload.id) &&
								String(upload.uploader_id) === String(reporterId) &&
								String(upload.storage_path) === String(manifestUpload.objectPath) &&
								String(upload.report_id) === String(manifestReport.id) &&
								upload.status === 'attached' &&
								Boolean(inspectorTimestamp(upload.attached_at))
						);
						return Boolean(
							liveUpload &&
							evidencePaths.includes(String(manifestUpload.objectPath)) &&
							objects.some(
								(object) =>
									object.ownerId === String(reporterId) &&
									object.path === String(manifestUpload.objectPath)
							)
						);
					});
			});
		const scenarioVerified = Boolean(
			scenarioPhase.status === 'complete' &&
			exactCheckpointComplete &&
			phaseCheckpointMatches &&
			liveScenarioAnchor &&
			metadataMismatches === 0
		);
		const scenarioPartial = !scenarioVerified && scenarioStarted;
		return Object.freeze({
			counts: Object.freeze({
				actors: exactUsers.length,
				sessions: activeSessionUserIds.length,
				mfaFactors: verifiedModeratorTotpFactors,
				profiles: exactProfiles.length,
				reports: exactReports.length,
				uploads: exactUploads.length,
				objects: exactObjects.length,
				queueRows: exactQueueRows.length
			}),
			foreignCounts: Object.freeze({
				syntheticAccounts: foreignUsers.length,
				profiles: foreignProfiles.length,
				reports: foreignReports.length,
				uploads: foreignUploads.length,
				objects: foreignObjects.length,
				queueRows: foreignQueueRows.length
			}),
			roleCounts: Object.freeze(roleCounts),
			duplicateRoles: [...exactByRole.values()].filter((matches) => matches.length > 1).length,
			metadataMismatches,
			manifestActorsAbsent,
			actorIdentityConflicts,
			confirmedActors,
			completeProfiles,
			verifiedModeratorTotpFactors,
			moderatorsWithVerifiedTotp,
			actorsWithActiveSessions,
			activeSessionsProven,
			scenarioVerified,
			scenarioPartial,
			hostedActorsManifestStale: exactUsers.filter((user) => {
				const role = INSPECTOR_ROLES.find((candidate) =>
					(exactByRole.get(candidate) ?? []).includes(user)
				);
				return role !== undefined && !actorRoles.has(role) && !pendingRoles.has(role);
			}).length,
			foreignEvidenceSha256: createHash('sha256')
				.update(foreignCoordinates.join('\n'), 'utf8')
				.digest('hex')
		});
	}

	return Object.freeze({
		/** @param {Record<string, unknown>} scope */
		async inspectRun(scope) {
			try {
				return await inspectRunInternal(/** @type {Record<string, any>} */ (scope));
			} catch (error) {
				if (
					error instanceof HostedEvidenceOperatorError &&
					error.message === 'hosted_inspection_scope_invalid'
				) {
					throw error;
				}
				throw new HostedEvidenceOperatorError('hosted_inspection_failed');
			}
		}
	});
}

/**
 * Exact-scope read helpers shared by the privileged legacy operator. The
 * returned surface contains no hosted mutation capability.
 *
 * @param {{ config: HostedOperatorConfig, serviceClient: SupabaseClient }} options
 */
export function createSupabaseHostedEvidenceReadAdapters({ config, serviceClient }) {
	if (config.target.projectRef !== HOSTED_STAGING.projectRef) {
		throw new HostedEvidenceOperatorError('hosted read adapter configuration is invalid');
	}

	/** @param {HostedRunManifest} manifest @returns {Promise<Array<{ pending: PendingManifestActor, user: SupabaseUser }>>} */
	async function listPendingManifestUsers(manifest) {
		assertManifestTarget(config, manifest);
		if (manifest.pendingActors.length === 0) return [];
		/** @type {Map<string, Array<{ pending: PendingManifestActor, user: SupabaseUser }>>} */
		const matches = new Map(manifest.pendingActors.map((pending) => [pending.role, []]));
		const perPage = 1000;
		for (let page = 1; page <= 100; page += 1) {
			const listed = await serviceClient.auth.admin.listUsers({ page, perPage });
			const users = listed.data?.users;
			if (listed.error || !Array.isArray(users)) {
				throw new HostedEvidenceOperatorError('pending hosted account inspection failed');
			}
			for (const pending of manifest.pendingActors) {
				for (const user of users) {
					if (pendingActorProvenanceMatches(config, pending, user)) {
						matches.get(pending.role)?.push({ pending, user });
					}
				}
			}
			const lastPage = listed.data?.lastPage;
			if (users.length < perPage || (Number.isSafeInteger(lastPage) && page >= lastPage)) break;
			if (page === 100) {
				throw new HostedEvidenceOperatorError('pending hosted account inspection failed');
			}
		}
		if ([...matches.values()].some((values) => values.length > 1)) {
			throw new HostedEvidenceOperatorError('pending hosted account scope is ambiguous');
		}
		return [...matches.values()].flat();
	}

	/** @param {{ manifest: HostedRunManifest }} scope */
	async function inspectManifest({ manifest }) {
		assertManifestTarget(config, manifest);
		const pendingUsers = await listPendingManifestUsers(manifest);
		const actorIds = [
			...manifest.actors.map((actor) => actor.userId),
			...pendingUsers.map(({ user }) => String(user.id))
		];
		const accountResults = await Promise.all(
			actorIds.map((userId) => serviceClient.auth.admin.getUserById(userId))
		);
		if (accountResults.some((result) => result.error && !isMissingAuthUser(result))) {
			throw new HostedEvidenceOperatorError('exact hosted account inspection failed');
		}
		const accounts = accountResults.filter((result) => Boolean(result.data.user)).length;
		const invalidActorProvenance = accountResults
			.slice(0, manifest.actors.length)
			.filter((result, index) => {
				if (!result.data.user) return false;
				return !actorProvenanceMatches(config, manifest.actors[index], result.data.user);
			}).length;

		let reports = [];
		let uploads = [];
		if (actorIds.length > 0) {
			reports = /** @type {any[]} */ (
				resultData(
					await serviceClient.from('reports').select('id, reporter_id').in('reporter_id', actorIds),
					'exact hosted report inspection failed'
				) ?? []
			);
			uploads = /** @type {any[]} */ (
				resultData(
					await serviceClient
						.from('report_evidence_uploads')
						.select('id, uploader_id, storage_path')
						.in('uploader_id', actorIds),
					'exact hosted upload inspection failed'
				) ?? []
			);
		}

		/** @type {string[]} */
		const objectPaths = [];
		for (const actor of manifest.actors) {
			const listed = await serviceClient.storage
				.from('report-evidence')
				.list(actor.userId, { limit: 100, offset: 0 });
			if (listed.error) throw new HostedEvidenceOperatorError('exact hosted object inspection failed');
			for (const object of listed.data ?? []) objectPaths.push(`${actor.userId}/${object.name}`);
		}
		for (const { user } of pendingUsers) {
			const userId = String(user.id);
			const listed = await serviceClient.storage
				.from('report-evidence')
				.list(userId, { limit: 100, offset: 0 });
			if (listed.error) throw new HostedEvidenceOperatorError('exact hosted object inspection failed');
			for (const object of listed.data ?? []) objectPaths.push(`${userId}/${object.name}`);
		}

		let queueRows = [];
		const manifestPaths = manifest.uploads.map((upload) => upload.objectPath);
		if (manifestPaths.length > 0) {
			queueRows = /** @type {any[]} */ (
				resultData(
					await serviceClient
						.from('upload_cleanup_queue')
						.select('id, storage_path, processed_at')
						.in('storage_path', manifestPaths),
					'exact hosted queue inspection failed'
				) ?? []
			);
		}

		const reportIds = new Set(manifest.reports.map((report) => report.id));
		const uploadIds = new Set(manifest.uploads.map((upload) => upload.id));
		const allowedPaths = new Set(manifestPaths);
		const manifestReportMismatches = manifest.reports.filter((report) => {
			const expectedOwner = manifestActor(manifest, report.actorRole).userId;
			return !reports.some(
				(row) => String(row.id) === report.id && String(row.reporter_id) === expectedOwner
			);
		}).length;
		const manifestUploadMismatches = manifest.uploads.filter(
			(upload) =>
				!uploads.some(
					(row) =>
						String(row.id) === upload.id &&
						String(row.uploader_id) === upload.uploaderId &&
						String(row.storage_path) === upload.objectPath
				)
		).length;
		const foreignArtifacts =
			manifestReportMismatches +
			manifestUploadMismatches +
			reports.filter((report) => !reportIds.has(String(report.id))).length +
			uploads.filter(
				(upload) =>
					!uploadIds.has(String(upload.id)) || !allowedPaths.has(String(upload.storage_path))
			).length +
			objectPaths.filter((path) => !allowedPaths.has(path)).length +
			queueRows.filter((queue) => !allowedPaths.has(String(queue.storage_path))).length;

		return {
			accounts,
			reports: reports.length,
			uploads: uploads.length,
			objects: objectPaths.length,
			queueRows: queueRows.length,
			foreignArtifacts,
			preExistingAccounts: invalidActorProvenance
		};
	}

	return Object.freeze({ listPendingManifestUsers, inspectManifest });
}

/**
 * Concrete Frankfurt-only privileged adapters. Creating this object is local and inert;
 * state changes occur only when an explicitly gated operator method is invoked later.
 *
 * @param {{
 *   config: HostedOperatorConfig,
 *   serviceClient: SupabaseClient,
 *   managementAccessToken: string,
 *   cleanupSecret: string,
 *   fetchImpl?: typeof fetch
 * }} options
 */
export function createSupabaseHostedEvidenceAdapters({
	config,
	serviceClient,
	managementAccessToken,
	cleanupSecret,
	fetchImpl = fetch
}) {
	if (
		config.target.projectRef !== HOSTED_STAGING.projectRef ||
		managementAccessToken.trim().length < 1 ||
		new TextEncoder().encode(cleanupSecret).byteLength < 32
	) {
		throw new HostedEvidenceOperatorError('privileged hosted adapter configuration is invalid');
	}
	const { listPendingManifestUsers, inspectManifest } =
		createSupabaseHostedEvidenceReadAdapters({ config, serviceClient });

	/** @param {{ role: string }} scope */
	async function provisionActor(scope) {
		const credentials = config.actorRoles[scope.role];
		if (!credentials) {
			throw new HostedEvidenceOperatorError('actor role is outside the approved hosted matrix');
		}
		const result = await serviceClient.auth.admin.createUser({
			email: credentials.email,
			password: credentials.password,
			email_confirm: true,
			user_metadata: {
				username: credentials.username,
				gate3_report_evidence_run_id: config.runId,
				gate3_report_evidence_provisioning_nonce: config.provisioningNonce,
				gate3_report_evidence_provisioning_attempt_id: config.provisioningNonce
			}
		});
		const user = result.data.user;
		if (result.error || !user || typeof user.created_at !== 'string') {
			throw new HostedEvidenceOperatorError('fresh hosted actor provisioning failed');
		}
		const receipt = Object.freeze({
			role: scope.role,
			userId: user.id,
			createdAt: user.created_at
		});
		if (!actorProvenanceMatches(config, receipt, user)) {
			throw new HostedEvidenceOperatorError('fresh hosted actor provenance is invalid');
		}
		return receipt;
	}

	/** @param {{ manifest: HostedRunManifest, role: string, userId: string }} scope */
	async function attestActor(scope) {
		const actor = exactFreshManifestActor(
			config,
			scope.manifest,
			scope.role,
			scope.userId
		);
		const result = await serviceClient.auth.admin.getUserById(scope.userId);
		const user = result.data.user;
		if (result.error || !user || typeof user.created_at !== 'string') {
			throw new HostedEvidenceOperatorError('fresh hosted actor provenance is unavailable');
		}
		if (!actorProvenanceMatches(config, actor, user)) {
			throw new HostedEvidenceOperatorError('fresh hosted actor provenance is invalid');
		}
		return actor;
	}

	/** @param {{ projectRef: string, uploadId: string, uploaderId: string, objectPath: string }} scope */
	async function backdateExactUpload(scope) {
		if (scope.projectRef !== config.target.projectRef) {
			throw new HostedEvidenceOperatorError('database fixture target does not match approved staging');
		}
		requireUuid(scope.uploadId, 'upload ID');
		requireUuid(scope.uploaderId, 'actor ID');
		if (scope.objectPath !== `${scope.uploaderId}/${scope.uploadId}.webp`) {
			throw new HostedEvidenceOperatorError('database fixture path is outside the exact run manifest');
		}
		const query = `update public.report_evidence_uploads set expires_at = now() - interval '1 minute', updated_at = now() where id = '${scope.uploadId}'::uuid and uploader_id = '${scope.uploaderId}'::uuid and storage_path = '${scope.objectPath}' and status = 'pending' returning id`;
		const response = await fetchImpl(
			`https://api.supabase.com/v1/projects/${config.target.projectRef}/database/query`,
			{
				method: 'POST',
				headers: {
					authorization: `Bearer ${managementAccessToken}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({ query })
			}
		);
		if (!response.ok) throw new HostedEvidenceOperatorError('exact abandoned fixture backdate failed');
		const result = await response.json();
		if (!Array.isArray(result) || result.length !== 1 || result[0]?.id !== scope.uploadId) {
			throw new HostedEvidenceOperatorError('exact abandoned fixture backdate was not attested');
		}
	}

	/** @param {{ manifest: HostedRunManifest, uploadId: string, bytes: Uint8Array }} scope */
	async function uploadExactObject(scope) {
		assertManifestTarget(config, scope.manifest);
		const upload = exactManifestUpload(scope.manifest, scope.uploadId);
		const result = await serviceClient.storage
			.from('report-evidence')
			.upload(upload.objectPath, scope.bytes, { contentType: 'image/webp', upsert: false });
		if (result.error) throw new HostedEvidenceOperatorError('exact abandoned fixture upload failed');
	}

	/** @param {{ manifest: HostedRunManifest, reportId: string }} scope */
	async function inspectReport(scope) {
		assertManifestTarget(config, scope.manifest);
		if (!scope.manifest.reports.some((report) => report.id === scope.reportId)) {
			throw new HostedEvidenceOperatorError('report is outside the exact run manifest');
		}
		const result = await serviceClient
			.from('reports')
			.select('id, reporter_id, target_id, details, evidence_paths, status, assigned_to')
			.eq('id', scope.reportId)
			.maybeSingle();
		if (result.error || !result.data) throw new HostedEvidenceOperatorError('exact report inspection failed');
		return Object.freeze({ ...result.data });
	}

	/** @param {{ manifest: HostedRunManifest, uploadId: string }} scope */
	async function inspectUpload(scope) {
		assertManifestTarget(config, scope.manifest);
		exactManifestUpload(scope.manifest, scope.uploadId);
		const result = await serviceClient
			.from('report_evidence_uploads')
			.select('id, uploader_id, storage_path, status, source_byte_size, actual_content_hash, actual_byte_size, actual_mime_type, width_px, height_px, report_id, created_at, finalized_at, attached_at')
			.eq('id', scope.uploadId)
			.maybeSingle();
		if (result.error || !result.data) throw new HostedEvidenceOperatorError('exact upload inspection failed');
		return Object.freeze({ ...result.data });
	}

	/** @param {{ manifest: HostedRunManifest, uploadId: string }} scope */
	async function inspectObject(scope) {
		assertManifestTarget(config, scope.manifest);
		const upload = exactManifestUpload(scope.manifest, scope.uploadId);
		const result = await serviceClient.storage
			.from('report-evidence')
			.list(upload.uploaderId, { search: `${upload.id}.webp`, limit: 2 });
		if (result.error || result.data.length > 1) {
			throw new HostedEvidenceOperatorError('exact object inspection failed');
		}
		if (result.data.length === 0) return Object.freeze({ exists: false, createdAt: null, updatedAt: null, byteSize: null, mimeType: null });
		if (result.data[0].name !== `${upload.id}.webp`) throw new HostedEvidenceOperatorError('exact object inspection failed');
		const object = result.data[0];
		return Object.freeze({
			exists: true,
			createdAt: object.created_at ?? null,
			updatedAt: object.updated_at ?? null,
			byteSize:
				typeof object.metadata?.size === 'number' && Number.isSafeInteger(object.metadata.size)
					? object.metadata.size
					: null,
			mimeType: typeof object.metadata?.mimetype === 'string' ? object.metadata.mimetype : null
		});
	}

	/** @param {{ manifest: HostedRunManifest, reportId: string }} scope */
	async function discoverUploadForReport(scope) {
		assertManifestTarget(config, scope.manifest);
		if (!scope.manifest.reports.some((report) => report.id === scope.reportId)) {
			throw new HostedEvidenceOperatorError('report is outside the exact run manifest');
		}
		const result = await serviceClient
			.from('report_evidence_uploads')
			.select('id, uploader_id, storage_path')
			.eq('report_id', scope.reportId);
		if (result.error || result.data.length !== 1) {
			throw new HostedEvidenceOperatorError('exact report upload discovery failed');
		}
		return Object.freeze({ ...result.data[0] });
	}

	/** @param {{ manifest: HostedRunManifest, actorRole: string, status: string, createdAfter: string }} scope */
	async function discoverUploadByStatus(scope) {
		assertManifestTarget(config, scope.manifest);
		const actor = manifestActor(scope.manifest, scope.actorRole);
		if (!['rejected', 'expired'].includes(scope.status) || !Number.isFinite(Date.parse(scope.createdAfter))) {
			throw new HostedEvidenceOperatorError('upload discovery scope is invalid');
		}
		const result = await serviceClient
			.from('report_evidence_uploads')
			.select('id, uploader_id, storage_path, status')
			.eq('uploader_id', actor.userId)
			.eq('status', scope.status)
			.gte('created_at', scope.createdAfter);
		if (result.error || result.data.length !== 1) {
			throw new HostedEvidenceOperatorError('exact terminal upload discovery failed');
		}
		return Object.freeze({ ...result.data[0] });
	}

	/** @param {{ manifest: HostedRunManifest, uploadId: string }} scope */
	async function discoverQueueForUpload(scope) {
		assertManifestTarget(config, scope.manifest);
		const upload = exactManifestUpload(scope.manifest, scope.uploadId);
		const result = await serviceClient
			.from('upload_cleanup_queue')
			.select('id, processed_at')
			.eq('storage_path', upload.objectPath)
			.order('id', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (result.error || !result.data) throw new HostedEvidenceOperatorError('exact queue discovery failed');
		return Object.freeze({ id: result.data.id, processedAt: result.data.processed_at ?? null });
	}

	/** @param {{ manifest: HostedRunManifest, reportId: string, actorId: string }} scope */
	async function inspectAssignmentAudit(scope) {
		assertManifestTarget(config, scope.manifest);
		const result = await serviceClient
			.from('moderation_audit')
			.select('id', { count: 'exact', head: true })
			.eq('report_id', scope.reportId)
			.eq('actor_id', scope.actorId)
			.eq('action', 'report_assigned');
		if (result.error) throw new HostedEvidenceOperatorError('exact assignment audit inspection failed');
		return result.count ?? 0;
	}

	async function invokeCleanupWorker() {
		const response = await fetchImpl(`${config.target.supabaseUrl}/functions/v1/upload-cleanup`, {
			method: 'POST',
			headers: { 'x-upload-cleanup-secret': cleanupSecret }
		});
		if (response.status !== 202) {
			throw new HostedEvidenceOperatorError('exact hosted cleanup invocation failed');
		}
		const body = await response.json();
		if (
			!body ||
			typeof body !== 'object' ||
			!UUID_PATTERN.test(String(body.requestId ?? '')) ||
			!Number.isSafeInteger(body.claimed) ||
			!Number.isSafeInteger(body.completed) ||
			!Number.isSafeInteger(body.failed) ||
			body.claimed < 0 ||
			body.completed < 0 ||
			body.failed !== 0 ||
			body.completed !== body.claimed
		) {
			throw new HostedEvidenceOperatorError('exact hosted cleanup receipt is invalid');
		}
		return { status: response.status, requestId: String(body.requestId) };
	}

	/** @param {{ manifest: HostedRunManifest, uploadIds: readonly string[], rejectionCode: string }} scope */
	async function reconcileExactUploads(scope) {
		assertManifestTarget(config, scope.manifest);
		if (
			scope.uploadIds.length < 1 ||
			scope.uploadIds.length > 4 ||
			!scope.uploadIds.every((uploadId) => scope.manifest.uploads.some((upload) => upload.id === uploadId)) ||
			!/^hosted_[a-z0-9_]{2,64}$/u.test(scope.rejectionCode)
		) {
			throw new HostedEvidenceOperatorError('reconciliation scope is outside the exact run manifest');
		}
		const result = await serviceClient.rpc('reject_unattached_report_evidence_uploads', {
			target_upload_ids: [...scope.uploadIds],
			rejection_code: scope.rejectionCode
		});
		if (result.error || !Array.isArray(result.data)) {
			throw new HostedEvidenceOperatorError('exact upload reconciliation failed');
		}
		const returned = result.data.map((row) => String(row.upload_id));
		if (returned.some((uploadId) => !scope.uploadIds.includes(uploadId))) {
			throw new HostedEvidenceOperatorError('reconciliation returned an unregistered upload');
		}
		return Object.freeze(returned);
	}

	/** @param {HostedRunManifest} manifest */
	async function deleteExactQueueRows(manifest) {
		assertManifestTarget(config, manifest);
		const objectPaths = manifest.uploads.map((upload) => upload.objectPath);
		if (objectPaths.length === 0) return;
		const exactPaths = objectPaths.map((path) => `'${path}'`).join(', ');
		const query = `delete from public.upload_cleanup_queue where bucket_id = 'report-evidence' and storage_path in (${exactPaths}) returning id, storage_path`;
		const response = await fetchImpl(
			`https://api.supabase.com/v1/projects/${config.target.projectRef}/database/query`,
			{
				method: 'POST',
				headers: {
					authorization: `Bearer ${managementAccessToken}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({ query })
			}
		);
		if (!response.ok) throw new HostedEvidenceOperatorError('exact cleanup-row removal failed');
		const result = await response.json();
		if (
			!Array.isArray(result) ||
			result.some((row) => !objectPaths.includes(String(row?.storage_path ?? '')))
		) {
			throw new HostedEvidenceOperatorError('exact cleanup-row removal was not attested');
		}
	}

	/** @param {{ manifest: HostedRunManifest }} scope */
	async function removeManifest({ manifest }) {
		assertManifestTarget(config, manifest);
		assertIsolatedScope(sanitizeCounts(await inspectManifest({ manifest })));
		const reportIds = manifest.reports.map((report) => report.id);
		if (reportIds.length > 0) {
			const exactReportFilter = manifest.reports
				.map((report) => {
					const reporterId = manifestActor(manifest, report.actorRole).userId;
					return `and(id.eq.${report.id},reporter_id.eq.${reporterId})`;
				})
				.join(',');
			const result = await serviceClient.from('reports').delete().or(exactReportFilter);
			if (result.error) throw new HostedEvidenceOperatorError('exact report cleanup failed');
		}

		const uploadIds = manifest.uploads.map((upload) => upload.id);
		if (uploadIds.length > 0) {
			const remaining = resultData(
				await serviceClient
					.from('report_evidence_uploads')
					.select('id, status')
					.in('id', uploadIds),
				'exact upload cleanup inspection failed'
			);
			const rejectable = (Array.isArray(remaining) ? remaining : [])
				.filter((row) => ['pending', 'finalized'].includes(String(row.status)))
				.map((row) => String(row.id));
			if (rejectable.length > 0) {
				const rejected = await serviceClient.rpc('reject_unattached_report_evidence_uploads', {
					target_upload_ids: rejectable,
					rejection_code: 'hosted_a11_cleanup'
				});
				if (rejected.error) throw new HostedEvidenceOperatorError('exact upload cleanup failed');
			}
		}

		await invokeCleanupWorker();
		for (const actor of manifest.actors) {
			const existing = await serviceClient.auth.admin.getUserById(actor.userId);
			if (isMissingAuthUser(existing)) continue;
			if (existing.error || !existing.data.user) {
				throw new HostedEvidenceOperatorError('exact hosted account inspection failed');
			}
			if (
				!actorProvenanceMatches(
					config,
					actor,
					existing.data.user
				)
			) {
				throw new HostedEvidenceOperatorError('fresh hosted actor provenance is invalid');
			}
			const deleted = await serviceClient.auth.admin.deleteUser(actor.userId);
			if (deleted.error) throw new HostedEvidenceOperatorError('exact hosted account cleanup failed');
		}
		for (const { user } of await listPendingManifestUsers(manifest)) {
			const deleted = await serviceClient.auth.admin.deleteUser(String(user.id));
			if (deleted.error) {
				throw new HostedEvidenceOperatorError('pending hosted account cleanup failed');
			}
		}
		await invokeCleanupWorker();
		const postWorker = sanitizeCounts(await inspectManifest({ manifest }));
		if (postWorker.objects !== 0) {
			throw new HostedEvidenceOperatorError('exact hosted object cleanup was not confirmed');
		}
		await deleteExactQueueRows(manifest);
	}

	return Object.freeze({
		provisionActor,
		attestActor,
		inspectManifest,
		backdateExactUpload,
		uploadExactObject,
		inspectReport,
		inspectUpload,
		inspectObject,
		discoverUploadForReport,
		discoverUploadByStatus,
		discoverQueueForUpload,
		inspectAssignmentAudit,
		reconcileExactUploads,
		invokeCleanupWorker,
		removeManifest
	});
}

/** @param {Partial<InventoryCounts>} [counts] @returns {InventoryCounts} */
function sanitizeCounts(counts = {}) {
	return /** @type {InventoryCounts} */ (Object.fromEntries(
		INVENTORY_FIELDS.map((field) => {
			const value = counts[field];
			if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
				throw new HostedEvidenceOperatorError('hosted cleanup inventory is invalid');
			}
			return [field, value];
		})
	));
}

/** @param {OperatorRecordInput} input */
export function createSanitizedOperatorRecord(input) {
	if (
		!SAFE_EVENTS.test(input.event) ||
		!/^gate3-[a-z0-9-]{8,64}$/u.test(input.runId) ||
		!SAFE_ACTOR_ROLES.has(input.actorRole) ||
		!new Set(['PASS', 'FAIL', 'BLOCKED']).has(input.status) ||
		!SAFE_BOUNDARIES.has(input.boundary) ||
		!SAFE_RESULTS.has(input.actualResult) ||
		!(input.requestId === 'not-exposed' || UUID_PATTERN.test(input.requestId)) ||
		!SAFE_CLEANUP_STATES.has(input.cleanup)
	) {
		throw new HostedEvidenceOperatorError('operator receipt contains an unsafe field');
	}
	return {
		event: input.event,
		runId: input.runId,
		actorRole: input.actorRole,
		status: input.status,
		boundary: input.boundary,
		actualResult: input.actualResult,
		requestId: input.requestId,
		before: sanitizeCounts(input.before),
		after: sanitizeCounts(input.after),
		cleanup: input.cleanup
	};
}

/** @param {string} body @param {string} expectedMessage @param {readonly string[]} forbiddenValues */
export function assertSanitizedHostedErrorBody(body, expectedMessage, forbiddenValues) {
	if (
		typeof body !== 'string' ||
		new TextEncoder().encode(body).byteLength > 8192 ||
		typeof expectedMessage !== 'string' ||
		expectedMessage.length < 8 ||
		!body.includes(expectedMessage) ||
		body.split(expectedMessage).length !== 2 ||
		!Array.isArray(forbiddenValues) ||
		forbiddenValues.some(
			(value) => typeof value !== 'string' || value.length === 0 || body.includes(value)
		) ||
		PRIVATE_RESPONSE_PATTERN.test(body)
	) {
		throw new HostedEvidenceOperatorError('hosted error response is not sanitized');
	}
	return true;
}

/** @param {InventoryCounts} counts */
function hasMutableArtifacts(counts) {
	return MUTABLE_INVENTORY_FIELDS.some((field) => counts[field] > 0);
}

/** @param {InventoryCounts} counts */
function assertIsolatedScope(counts) {
	if (counts.foreignArtifacts > 0 || counts.preExistingAccounts > 0) {
		throw new HostedEvidenceOperatorError('cleanup scope is not isolated');
	}
}

/**
 * @param {{
 *   config: HostedOperatorConfig,
 *   manifest: HostedRunManifest,
 *   environment: OperatorEnvironment,
 *   inspectScopedArtifacts: (scope: { runId: string, manifest: HostedRunManifest }) => Promise<InventoryCounts>,
 *   removeScopedArtifacts: (scope: { runId: string, manifest: HostedRunManifest }) => Promise<void>,
 *   logger: OperatorLogger
 * }} dependencies
 */
export async function cleanupHostedRun({
	config,
	manifest,
	environment,
	inspectScopedArtifacts,
	removeScopedArtifacts,
	logger
}) {
	const cleanupConfig = validateHostedCleanupEnvironment(environment);
	if (
		cleanupConfig.runId !== config.runId ||
		cleanupConfig.target.projectRef !== config.target.projectRef
	) {
		throw new HostedEvidenceOperatorError('A11 cleanup target does not match the active run');
	}
	assertManifestTarget(config, manifest);
	assertServiceRoleOperation('inspect');
	let before;
	try {
		before = sanitizeCounts(await inspectScopedArtifacts({ runId: config.runId, manifest }));
	} catch (error) {
		if (error instanceof HostedEvidenceOperatorError) throw error;
		throw new HostedEvidenceOperatorError('hosted cleanup inspection failed');
	}
	assertIsolatedScope(before);

	if (!hasMutableArtifacts(before)) {
		logger.info(
			createSanitizedOperatorRecord({
				event: 'cleanup_verified',
				runId: config.runId,
				actorRole: 'operator',
				status: 'PASS',
				boundary: 'operator',
				actualResult: 'zero residual artifacts',
				requestId: 'not-exposed',
				before,
				after: before,
				cleanup: 'verified'
			})
		);
		return { cleaned: false, counts: before };
	}

	assertServiceRoleOperation('cleanup');
	try {
		await removeScopedArtifacts({ runId: config.runId, manifest });
	} catch {
		throw new HostedEvidenceOperatorError('hosted cleanup did not complete');
	}

	let after;
	try {
		after = sanitizeCounts(await inspectScopedArtifacts({ runId: config.runId, manifest }));
	} catch {
		throw new HostedEvidenceOperatorError('hosted cleanup verification failed');
	}
	assertIsolatedScope(after);
	if (hasMutableArtifacts(after)) {
		throw new HostedEvidenceOperatorError('hosted cleanup verification found residual artifacts');
	}

	logger.info(
		createSanitizedOperatorRecord({
			event: 'cleanup_verified',
			runId: config.runId,
			actorRole: 'operator',
			status: 'PASS',
			boundary: 'operator',
			actualResult: 'zero residual artifacts',
			requestId: 'not-exposed',
			before,
			after,
			cleanup: 'verified'
		})
	);
	return { cleaned: true, counts: after };
}

/**
 * A11-only entrypoint for cleaning the exact manifest persisted by the A10 run.
 * @param {{
 *   config: HostedOperatorConfig,
 *   environment: OperatorEnvironment,
 *   manifestPath: string,
 *   operator: { inspect: (manifest: HostedRunManifest) => Promise<InventoryCounts>, remove: (manifest: HostedRunManifest) => Promise<void> },
 *   credentialStore: { credentialStoreId?: string, purgeModeratorTotpSecrets: () => Promise<void> | void, finalizePurgeTombstone?: () => Promise<void> | void },
 *   logger: OperatorLogger
 * }} options
 */
export async function cleanupHostedManifestFile({
	config,
	environment,
	manifestPath,
	operator,
	credentialStore,
	logger
}) {
	if (typeof credentialStore?.purgeModeratorTotpSecrets !== 'function') {
		throw new HostedEvidenceOperatorError('A11 moderator credential store is invalid');
	}
	const exactPath = resolveHostedManifestPath(manifestPath);
	let manifest;
	try {
		manifest = await loadHostedRunManifest(config, exactPath);
	} catch (error) {
		let manifestIsMissing = false;
		try {
			await stat(exactPath);
		} catch (statError) {
			manifestIsMissing =
				typeof statError === 'object' &&
				statError !== null &&
				/** @type {NodeJS.ErrnoException} */ (statError).code === 'ENOENT';
			if (!manifestIsMissing) {
				throw new HostedEvidenceOperatorError('hosted run manifest is unavailable');
			}
		}
		if (!manifestIsMissing) throw error;
		const approvedConfig = validateHostedCleanupEnvironment(environment);
		if (
			approvedConfig.runId !== config.runId ||
			approvedConfig.target.projectRef !== config.target.projectRef
		) {
			throw new HostedEvidenceOperatorError(
				'run manifest target does not match approved staging'
			);
		}
		if (typeof credentialStore.finalizePurgeTombstone !== 'function') {
			throw new HostedEvidenceOperatorError(
				'A11 moderator credential tombstone removal failed'
			);
		}
		try {
			await credentialStore.finalizePurgeTombstone();
		} catch {
			throw new HostedEvidenceOperatorError(
				'A11 moderator credential tombstone removal failed'
			);
		}
		return Object.freeze({
			cleaned: true,
			counts: Object.freeze({
				accounts: 0,
				reports: 0,
				uploads: 0,
				objects: 0,
				queueRows: 0,
				foreignArtifacts: 0,
				preExistingAccounts: 0
			})
		});
	}
	if (
		manifest.credentialStoreId !== '0'.repeat(64) &&
		credentialStore.credentialStoreId !== manifest.credentialStoreId
	) {
		throw new HostedEvidenceOperatorError('A11 moderator credential store binding is invalid');
	}
	const result = await cleanupHostedRun({
		config,
		manifest,
		environment,
		inspectScopedArtifacts: ({ manifest: exactManifest }) => operator.inspect(exactManifest),
		removeScopedArtifacts: ({ manifest: exactManifest }) => operator.remove(exactManifest),
		logger
	});
	try {
		await credentialStore.purgeModeratorTotpSecrets();
	} catch {
		throw new HostedEvidenceOperatorError('A11 moderator credential purge failed');
	}
	try {
		await unlink(exactPath);
	} catch {
		throw new HostedEvidenceOperatorError('hosted run manifest could not be removed');
	}
	if (typeof credentialStore.finalizePurgeTombstone === 'function') {
		try {
			await credentialStore.finalizePurgeTombstone();
		} catch {
			throw new HostedEvidenceOperatorError('A11 moderator credential tombstone removal failed');
		}
	}
	return result;
}
