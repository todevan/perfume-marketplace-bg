import { readFile, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

/** @typedef {Record<string, string | undefined>} OperatorEnvironment */
/** @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient */
/** @typedef {import('@supabase/supabase-js').User} SupabaseUser */
/** @typedef {{ email: string, password: string, username: string, totpSecret?: string }} ActorEnvironmentNames */
/** @typedef {{ email: string, password: string, username: string, totpSecret?: string }} ActorCredentials */
/** @typedef {{ accounts: number, reports: number, uploads: number, objects: number, queueRows: number, foreignArtifacts: number, preExistingAccounts: number }} InventoryCounts */
/** @typedef {{ target: typeof HOSTED_STAGING, runId: string, actorRoles: Readonly<Record<string, Readonly<ActorCredentials>>>, serviceKey: string, provisioningNonce: string, provisionedAfter: string }} HostedOperatorConfig */
/** @typedef {{ role: string, userId: string, createdAt: string }} ManifestActor */
/** @typedef {{ id: string, actorRole: string }} ManifestReport */
/** @typedef {{ id: string, actorRole: string, uploaderId: string, objectPath: string }} ManifestUpload */
/** @typedef {{ id: number, uploadId: string }} ManifestQueueRow */
/** @typedef {{ targetProjectRef: string, runId: string, actors: readonly ManifestActor[], reports: readonly ManifestReport[], uploads: readonly ManifestUpload[], queueRows: readonly ManifestQueueRow[] }} HostedRunManifest */
/** @typedef {{ actors?: readonly ManifestActor[], reports?: readonly ManifestReport[], uploads?: readonly ManifestUpload[], queueRows?: readonly ManifestQueueRow[] }} ManifestChanges */
/** @typedef {{ event: string, runId: string, actorRole: string, status: string, boundary: string, actualResult: string, requestId: string, before: Partial<InventoryCounts>, after: Partial<InventoryCounts>, cleanup: string } & Record<string, unknown>} OperatorRecordInput */
/** @typedef {{ info: (record: ReturnType<typeof createSanitizedOperatorRecord>) => void }} OperatorLogger */

const ALLOWED_SERVICE_ROLE_OPERATIONS = new Set(['provision', 'inspect', 'cleanup']);
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
		username: 'E2E_REAL_ASSIGNED_MODERATOR_USERNAME',
		totpSecret: 'E2E_REAL_ASSIGNED_MODERATOR_TOTP_SECRET'
	}),
	'unassigned-moderator': Object.freeze({
		email: 'E2E_REAL_UNASSIGNED_MODERATOR_EMAIL',
		password: 'E2E_REAL_UNASSIGNED_MODERATOR_PASSWORD',
		username: 'E2E_REAL_UNASSIGNED_MODERATOR_USERNAME',
		totpSecret: 'E2E_REAL_UNASSIGNED_MODERATOR_TOTP_SECRET'
	})
});
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

/** @param {OperatorEnvironment} environment */
function loadActorRoles(environment) {
	/** @type {Record<string, Readonly<ActorCredentials>>} */
	const actors = Object.fromEntries(
		Object.entries(ACTOR_ENVIRONMENT).map(([role, names]) => [
			role,
			Object.freeze({
				email: requirePrivateValue(environment, names.email).toLowerCase(),
				password: requirePrivateValue(environment, names.password),
				username: requirePrivateValue(environment, names.username),
				...(names.totpSecret
					? { totpSecret: requirePrivateValue(environment, names.totpSecret) }
					: {})
			})
		])
	);
	const emails = Object.values(actors).map((actor) => actor.email);
	const usernames = Object.values(actors).map((actor) => actor.username.toLowerCase());
	if (new Set(emails).size !== emails.length || new Set(usernames).size !== usernames.length) {
		throw new HostedEvidenceOperatorError('synthetic hosted actors must be unique');
	}
	return Object.freeze(actors);
}

/** @param {OperatorEnvironment} [environment] @returns {Readonly<HostedOperatorConfig>} */
export function validateHostedOperatorEnvironment(environment = process.env) {
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

	for (const name of [
		'E2E_REAL_ADMIN_EMAIL',
		'E2E_REAL_ADMIN_PASSWORD',
		'E2E_REAL_ADMIN_TOTP_SECRET'
	]) {
		if (environment[name]) {
			throw new HostedEvidenceOperatorError('administrator actor is outside the approved hosted scope');
		}
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
		provisionedAfter: requireIsoTimestamp(
			requirePrivateValue(environment, 'E2E_REAL_REPORT_EVIDENCE_PROVISIONED_AFTER')
		)
	});
}

/** @param {OperatorEnvironment} [environment] */
export function validateHostedCleanupEnvironment(environment = process.env) {
	const config = validateHostedOperatorEnvironment(environment);
	if (
		environment.E2E_REAL_REPORT_EVIDENCE_CLEANUP_RUN !== 'true' ||
		environment.E2E_REAL_REPORT_EVIDENCE_CLEANUP_APPROVAL !== 'A11'
	) {
		throw new HostedEvidenceOperatorError('A11 cleanup gate is disabled');
	}
	return config;
}

/** @param {OperatorEnvironment} [environment] */
export function validateHostedProvisionEnvironment(environment = process.env) {
	const config = validateHostedOperatorEnvironment(environment);
	if (
		environment.E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_RUN !== 'true' ||
		environment.E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_APPROVAL !== 'A9'
	) {
		throw new HostedEvidenceOperatorError('A9 account-provisioning gate is disabled');
	}
	return config;
}

/** @param {HostedOperatorConfig} config @returns {Readonly<HostedRunManifest>} */
export function createHostedRunManifest(config) {
	return Object.freeze({
		targetProjectRef: config.target.projectRef,
		runId: config.runId,
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
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
		throw new HostedEvidenceOperatorError('actor provisioning timestamp is invalid');
	}
	return value;
}

/** @param {HostedRunManifest} manifest @param {ManifestChanges} [changes] */
function cloneManifest(manifest, changes = {}) {
	return Object.freeze({
		targetProjectRef: manifest.targetProjectRef,
		runId: manifest.runId,
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
		actors: [
			...manifest.actors,
			Object.freeze({ role, userId, createdAt })
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
function exactManifestFile(filePath) {
	if (typeof filePath !== 'string' || !isAbsolute(filePath)) {
		throw new HostedEvidenceOperatorError('hosted run manifest path is invalid');
	}
	const absolutePath = resolve(filePath);
	const workspaceRelative = relative(process.cwd(), absolutePath);
	if (
		workspaceRelative === '' ||
		(!workspaceRelative.startsWith('..') && !isAbsolute(workspaceRelative))
	) {
		throw new HostedEvidenceOperatorError('hosted run manifest must remain outside the repository');
	}
	return absolutePath;
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
		!Array.isArray(input.actors) ||
		!Array.isArray(input.reports) ||
		!Array.isArray(input.uploads) ||
		!Array.isArray(input.queueRows)
	) {
		throw new HostedEvidenceOperatorError('hosted run manifest target is invalid');
	}
	let manifest = createHostedRunManifest(config);
	for (const value of input.actors) {
		const actor = /** @type {Record<string, unknown>} */ (value);
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

/** @param {HostedOperatorConfig} config @param {HostedRunManifest} manifest @param {string} filePath */
export async function persistHostedRunManifest(config, manifest, filePath) {
	assertManifestTarget(config, manifest);
	const exactPath = exactManifestFile(filePath);
	try {
		await writeFile(exactPath, `${JSON.stringify(manifest)}\n`, {
			encoding: 'utf8',
			mode: 0o600
		});
	} catch {
		throw new HostedEvidenceOperatorError('hosted run manifest could not be persisted');
	}
}

/** @param {HostedOperatorConfig} config @param {string} filePath */
export async function loadHostedRunManifest(config, filePath) {
	const exactPath = exactManifestFile(filePath);
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
 *     attestActor?: (scope: { role: string, userId: string }) => Promise<{ role: string, userId: string, createdAt: string }>,
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
		/** @param {string} role @param {string} userId */
		async attestFreshActor(role, userId) {
			assertServiceRoleOperation('inspect');
			requireUuid(userId, 'actor ID');
			if (!Object.hasOwn(config.actorRoles, role) || !adapters.attestActor) {
				throw new HostedEvidenceOperatorError('actor provenance adapter is unavailable');
			}
			return adapters.attestActor({ role, userId });
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
			metadata.gate3_report_evidence_provisioning_nonce === config.provisioningNonce
	);
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
				gate3_report_evidence_provisioning_nonce: config.provisioningNonce
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

	/** @param {{ role: string, userId: string }} scope */
	async function attestActor(scope) {
		const result = await serviceClient.auth.admin.getUserById(scope.userId);
		const user = result.data.user;
		if (result.error || !user || typeof user.created_at !== 'string') {
			throw new HostedEvidenceOperatorError('fresh hosted actor provenance is unavailable');
		}
		const receipt = Object.freeze({
			role: scope.role,
			userId: scope.userId,
			createdAt: user.created_at
		});
		if (!actorProvenanceMatches(config, receipt, user)) {
			throw new HostedEvidenceOperatorError('fresh hosted actor provenance is invalid');
		}
		return receipt;
	}

	/** @param {{ manifest: HostedRunManifest }} scope */
	async function inspectManifest({ manifest }) {
		assertManifestTarget(config, manifest);
		const actorIds = manifest.actors.map((actor) => actor.userId);
		const accountResults = await Promise.all(
			actorIds.map((userId) => serviceClient.auth.admin.getUserById(userId))
		);
		if (accountResults.some((result) => result.error && !isMissingAuthUser(result))) {
			throw new HostedEvidenceOperatorError('exact hosted account inspection failed');
		}
		const accounts = accountResults.filter((result) => Boolean(result.data.user)).length;
		const invalidActorProvenance = accountResults.filter((result, index) => {
			if (!result.data.user) return false;
			return !actorProvenanceMatches(
				config,
				manifest.actors[index],
				result.data.user
			);
		}).length;

		let reports = [];
		let uploads = [];
		if (actorIds.length > 0) {
			reports = /** @type {any[]} */ (
				resultData(
					await serviceClient
						.from('reports')
						.select('id, reporter_id')
						.in('reporter_id', actorIds),
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
			if (listed.error) {
				throw new HostedEvidenceOperatorError('exact hosted object inspection failed');
			}
			for (const object of listed.data ?? []) objectPaths.push(`${actor.userId}/${object.name}`);
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
		const manifestUploadMismatches = manifest.uploads.filter((upload) =>
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
		if (!body || typeof body !== 'object' || !UUID_PATTERN.test(String(body.requestId ?? ''))) {
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
		await invokeCleanupWorker();
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
 *   logger: OperatorLogger
 * }} options
 */
export async function cleanupHostedManifestFile({
	config,
	environment,
	manifestPath,
	operator,
	logger
}) {
	const exactPath = exactManifestFile(manifestPath);
	const manifest = await loadHostedRunManifest(config, exactPath);
	const result = await cleanupHostedRun({
		config,
		manifest,
		environment,
		inspectScopedArtifacts: ({ manifest: exactManifest }) => operator.inspect(exactManifest),
		removeScopedArtifacts: ({ manifest: exactManifest }) => operator.remove(exactManifest),
		logger
	});
	try {
		await unlink(exactPath);
	} catch {
		throw new HostedEvidenceOperatorError('hosted run manifest could not be removed');
	}
	return result;
}
