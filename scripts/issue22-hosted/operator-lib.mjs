import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const TARGET = Object.freeze({
	projectRef: 'zzrrutwlrkhevellwork',
	forbiddenProjectRef: 'nuhkpqjjyuygiemrxbdp',
	organizationId: 'khazvscqabwvslnphbqp',
	region: 'eu-central-1',
	cloudflareAccountId: '0cb7373563c400a08bd46564320dd747',
	workerName: 'perfume-marketplace-bg-issue22',
	workerHostname: 'perfume-marketplace-bg-issue22.perfume-marketplace-bg.workers.dev'
});

export const CATALOG_BASELINE = Object.freeze({ brands: 196, aliases: 48, memberships: 335 });

export const KNOWN_FAILED_RECOVERY = Object.freeze({
	predecessorSha: 'a9d55c0ef1138dfb33c09328abdfa59bc3981cd0',
	recoverySha256: '65a7312fe5a7829d7cd5850bc71bc3d29e57f40a991ba070c6523044b00518e3',
	generatedConfigSha256: 'afe2b4621b71c8a4a5bef19245084dfc3975ab6b0ee0f0d5af32ddf074e9b21f',
	runId: '55ab019b-6818-42c8-8b0d-bf15864afe67'
});

export const EXPECTED_STORAGE_BUCKETS = Object.freeze([
	Object.freeze({ id: 'listing-image-quarantine', name: 'listing-image-quarantine', public: false, file_size_limit: 10_485_760, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] }),
	Object.freeze({ id: 'listing-images', name: 'listing-images', public: false, file_size_limit: 10_485_760, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] }),
	Object.freeze({ id: 'merchant-documents', name: 'merchant-documents', public: false, file_size_limit: 15_728_640, allowed_mime_types: ['image/jpeg', 'image/png', 'application/pdf'] }),
	Object.freeze({ id: 'report-evidence', name: 'report-evidence', public: false, file_size_limit: 10_485_760, allowed_mime_types: ['image/webp'] })
]);

export const OPERATOR_CAPACITY_BUDGET = Object.freeze({
	browserRequests: 449,
	initialRollbackSmokeRequests: 15,
	candidateSmokeRequests: 78,
	cleanupRollbackSmokeRequests: 45,
	totalRequests: 587,
	// Workers Free enforces 10 ms CPU and 50 subrequests per dynamic invocation.
	maxCpuMsPerInvocation: 10,
	maxSubrequestsPerInvocation: 50,
	freeHardTotalCpuMs: 5_870,
	// Without an explicit limit, Workers Paid defaults to 30 seconds CPU/request.
	standardDefaultCpuMsPerInvocation: 30_000,
	// Protect paid-plan included headroom even though this exact account currently enforces Free limits.
	conservativeTotalCpuMs: 17_610_000,
	totalCpuMs: 17_610_000
});

/** @param {string} workdir */
export function fixedMigrationCommands(workdir) {
	if (typeof workdir !== 'string' || !workdir.includes('issue22')) {
		throw new Error('private scratch workdir is invalid');
	}
	return [
		['exec', 'supabase', 'link', '--project-ref', TARGET.projectRef, '--workdir', workdir, '--yes'],
		['exec', 'supabase', 'db', 'push', '--linked', '--dry-run', '--workdir', workdir, '--yes'],
		['exec', 'supabase', 'db', 'push', '--linked', '--workdir', workdir, '--yes'],
		['exec', 'supabase', 'migration', 'list', '--linked', '--workdir', workdir]
	];
}

/** @param {string} config */
export function fixedWorkerSecretCommands(config) {
	if (typeof config !== 'string' || config.length === 0) throw new Error('Worker config is required');
	return Object.freeze({
		list: ['exec', 'wrangler', 'secret', 'list', '--name', TARGET.workerName, '--config', config, '--format', 'json'],
		/** @param {string} name */
		delete: (name) => ['exec', 'wrangler', 'secret', 'delete', name, '--name', TARGET.workerName, '--config', config]
	});
}

/** @param {Record<string, any>} config @param {{requireProjectBindings?: boolean, requireMaterializedSitekey?: boolean}} options */
export function assertExactWorkerConfig(config, options = {}) {
	if (
		!config ||
		config.name !== TARGET.workerName ||
		config.account_id !== TARGET.cloudflareAccountId
	) throw new Error('Worker config identity mismatch');
	if (options.requireProjectBindings) {
		const vars = config.vars;
		if (
			!vars ||
			vars.EXPECTED_SUPABASE_PROJECT_REF !== TARGET.projectRef ||
			vars.PUBLIC_SUPABASE_URL !== `https://${TARGET.projectRef}.supabase.co` ||
			vars.PUBLIC_APP_URL !== `https://${TARGET.workerHostname}` ||
			vars.TURNSTILE_EXPECTED_HOSTNAME !== TARGET.workerHostname ||
			(options.requireMaterializedSitekey && (
				typeof vars.PUBLIC_TURNSTILE_SITE_KEY !== 'string' ||
				vars.PUBLIC_TURNSTILE_SITE_KEY.length === 0 ||
				vars.PUBLIC_TURNSTILE_SITE_KEY === '__ISSUE22_TURNSTILE_SITE_KEY__'
			))
		) throw new Error('Worker config project identity mismatch');
	}
	return config;
}

/**
 * @param {string[]} args
 * @param {() => void} assertLink
 * @param {(args: string[]) => unknown} execute
 */
export function runLinkedCommand(args, assertLink, execute) {
	assertLink();
	try {
		return execute(args);
	} finally {
		assertLink();
	}
}

/** @param {string} directory */
export function migrationManifestForDirectory(directory) {
	return readdirSync(directory)
		.filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name))
		.sort()
		.map((file) => {
			const bytes = readFileSync(join(directory, file));
			return { file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
		});
}

/** @param {string} path */
export function fileReceipt(path) {
	const bytes = readFileSync(path);
	return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}

/** @param {string} directory @param {unknown} expected */
export function assertManifestMatches(directory, expected) {
	if (JSON.stringify(migrationManifestForDirectory(directory)) !== JSON.stringify(expected)) {
		throw new Error('scratch migration bytes do not match the reviewed manifest');
	}
}

/**
 * @param {Record<string, any>} value
 * @param {string[]} expectedMigrationVersions
 * @param {Record<string, any> | null} expectedMigratedInventory
 */
export function assertSafeInventory(value, expectedMigrationVersions = [], expectedMigratedInventory = null) {
	if (value?.projectRef === TARGET.forbiddenProjectRef) throw new Error('forbidden Supabase target');
	if (value?.projectRef !== TARGET.projectRef) throw new Error('provider target mismatch');
	if (value?.organizationId !== TARGET.organizationId) throw new Error('provider organization mismatch');
	if (value?.region !== TARGET.region || value?.status !== 'ACTIVE_HEALTHY' || value?.organizationPlan !== 'free') {
		throw new Error('provider target/plan mismatch');
	}
	if (!Array.isArray(value.selectedAddons) || value.selectedAddons.length !== 0) throw new Error('provider inventory has paid add-ons');
	if (!Array.isArray(value.hostedMigrations)) throw new Error('provider migration inventory is invalid');
	if (value.authUsers !== 0 || value.objects !== 0) throw new Error('provider run data inventory is not empty');
	for (const field of ['publicRelations', 'publicFunctions', 'publicPolicies', 'unexpectedSchemas', 'userTriggers', 'realtimePublicationTables']) {
		if (!Array.isArray(value[field])) throw new Error('provider inventory shape is invalid');
	}
	if (value.signupDisabled !== true) throw new Error('signup is not quiesced');

	if (value.hostedMigrations.length === 0) {
		const emptyArrays = [value.publicRelations, value.publicFunctions, value.publicPolicies, value.userTriggers, value.realtimePublicationTables];
		if (
			emptyArrays.some((items) => items.length !== 0) ||
			value.unexpectedSchemas.length !== 0 ||
			value.buckets !== 0 ||
			value.privateSchemaExists !== false
		) throw new Error('provider inventory is not empty');
		return { mode: 'pristine' };
	}

	const actualVersions = value.hostedMigrations.map((entry) => String(entry?.version ?? entry));
	if (
		expectedMigrationVersions.length === 0 ||
		JSON.stringify(actualVersions) !== JSON.stringify(expectedMigrationVersions)
	) throw new Error('provider migration chain is not the exact reviewed baseline');
	if (value.privateSchemaExists !== true) throw new Error('migrated private schema is missing');
	const exactInventoryFields = [
		['publicRelations', 'public_relations'],
		['publicFunctions', 'public_functions'],
		['publicPolicies', 'public_policies'],
		['unexpectedSchemas', 'unexpected_schemas'],
		['userTriggers', 'user_triggers'],
		['realtimePublicationTables', 'realtime_publication_tables']
	];
	if (
		!expectedMigratedInventory ||
		expectedMigratedInventory.private_schema_exists !== value.privateSchemaExists ||
		exactInventoryFields.some(([runtimeField, manifestField]) =>
			JSON.stringify(value[runtimeField]) !== JSON.stringify(expectedMigratedInventory[manifestField])
		)
	) throw new Error('migrated provider inventory differs from the exact reviewed baseline');
	const fingerprintFields = ['relationsSha256', 'storageAuthorizationSha256', 'typesSha256', 'functionsSha256', 'policiesSha256', 'triggersSha256', 'catalogSha256'];
	if (
		!value.definitionFingerprints ||
		!expectedMigratedInventory.definition_fingerprints ||
		fingerprintFields.some((field) =>
			!/^[0-9a-f]{64}$/u.test(value.definitionFingerprints[field] ?? '') ||
			value.definitionFingerprints[field] !== expectedMigratedInventory.definition_fingerprints[field]
		)
	) throw new Error('migrated provider definition fingerprint mismatch');
	if (
		!Array.isArray(value.applicationTableCounts) ||
		!Array.isArray(expectedMigratedInventory.application_table_counts) ||
		JSON.stringify(value.applicationTableCounts) !== JSON.stringify(expectedMigratedInventory.application_table_counts) ||
		value.applicationTableCounts.some((entry) => entry?.rows !== 0)
	) throw new Error('migrated application table inventory differs or contains rows');
	assertFinalStorageState(value.bucketDefinitions, value.objects);
	if (value.buckets !== EXPECTED_STORAGE_BUCKETS.length) throw new Error('migrated bucket count mismatch');
	if (
		value.applicationRows?.profiles !== 0 ||
		value.applicationRows?.memberships !== 0 ||
		value.applicationRows?.consents !== 0
	) throw new Error('migrated baseline contains run data');
	assertCatalogCounts(value.catalog);
	return { mode: 'migrated' };
}

/** @param {Record<string, any>} value */
export function assertCatalogCounts(value) {
	if (
		value?.brands !== CATALOG_BASELINE.brands ||
		value?.aliases !== CATALOG_BASELINE.aliases ||
		value?.memberships !== CATALOG_BASELINE.memberships
	) {
		throw new Error('catalog baseline mismatch');
	}
}

/** @param {ReadonlyArray<Record<string, any>>} buckets @param {number} objectCount */
export function assertFinalStorageState(buckets, objectCount) {
	const normalized = Array.isArray(buckets)
		? buckets.map((bucket) => ({
			id: bucket.id,
			name: bucket.name,
			public: bucket.public,
			file_size_limit: Number(bucket.file_size_limit),
			allowed_mime_types: bucket.allowed_mime_types
		})).sort((left, right) => String(left.id).localeCompare(String(right.id)))
		: [];
	if (JSON.stringify(normalized) !== JSON.stringify(EXPECTED_STORAGE_BUCKETS)) {
		throw new Error('final storage bucket definitions mismatch');
	}
	if (objectCount !== 0) throw new Error('final storage object inventory is not empty');
}

const RECOVERY_FIELDS = Object.freeze([
	'recoveryVersion', 'candidateSha', 'projectRef', 'cloudflareAccountId', 'workerName', 'runId',
	'widgetIntent', 'widgetSitekey', 'createdAt', 'updatedAt', 'authQuiescedAt', 'baselineEstablishmentMode',
	'adoptedPredecessorSha', 'adoptedRecoverySha256', 'adoptedGeneratedConfigSha256', 'sealedFinalState',
	'predecessorEvidenceMac', 'cleanupFinalStateProvenAt', 'ledgerSha256', 'generatedConfigSha256',
	'retainedLedger', 'retainedGeneratedConfig', 'retainedLedgerSha256', 'retainedGeneratedConfigSha256'
]);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** @param {Record<string, any>} recovery */
function recoveryCore(recovery) {
	return Object.fromEntries(RECOVERY_FIELDS.map((field) => [field, recovery[field]]));
}

/** @param {string | null | undefined} value */
function validNullableSha(value) {
	return value === null || SHA256.test(value ?? '');
}

/** @param {string | null | undefined} value */
function sha256Text(value) {
	return typeof value === 'string' ? createHash('sha256').update(value).digest('hex') : null;
}

/** @param {Record<string, any>} recovery @param {string} authenticationKey */
export function sealRecoveryState(recovery, authenticationKey) {
	const core = recoveryCore(recovery);
	return sealRecoveryStateWithKey(core, deriveRecoverySealKey(authenticationKey, core.candidateSha));
}

/** @param {string} authenticationKey @param {string} candidateSha */
export function deriveRecoverySealKey(authenticationKey, candidateSha) {
	if (typeof authenticationKey !== 'string' || !/^sbp_/u.test(authenticationKey) || authenticationKey.length < 24 || !/^[0-9a-f]{40}$/u.test(candidateSha ?? '')) {
		throw new Error('recovery authentication key is unavailable');
	}
	return createHmac('sha256', authenticationKey).update(`issue22:recovery-key:v1\0${candidateSha}`).digest('hex');
}

/** @param {Record<string, any>} recovery @param {string} recoveryKey */
export function sealRecoveryStateWithKey(recovery, recoveryKey) {
	if (!SHA256.test(recoveryKey ?? '')) throw new Error('recovery seal key is unavailable');
	const core = recoveryCore(recovery);
	const recoveryMac = createHmac('sha256', recoveryKey).update(`issue22:current-recovery:v2\0${JSON.stringify(core)}`).digest('hex');
	return { ...core, recoveryMac };
}

/** @param {Record<string, any>} core @param {unknown} actual @param {string | undefined} authenticationKey */
function verifyRecoveryMac(core, actual, authenticationKey) {
	if (typeof authenticationKey !== 'string') return false;
	try {
		const recoveryKey = deriveRecoverySealKey(authenticationKey, core.candidateSha);
		const expected = Buffer.from(sealRecoveryStateWithKey(core, recoveryKey).recoveryMac, 'hex');
		const received = Buffer.from(typeof actual === 'string' ? actual : '', 'hex');
		return expected.length === received.length && timingSafeEqual(expected, received);
	} catch {
		return false;
	}
}

/** @param {Record<string, any>} core @param {unknown} actual @param {string | undefined} recoveryKey */
function verifyRecoveryMacWithKey(core, actual, recoveryKey) {
	if (typeof recoveryKey !== 'string' || !SHA256.test(recoveryKey)) return false;
	try {
		const expected = Buffer.from(sealRecoveryStateWithKey(core, recoveryKey).recoveryMac, 'hex');
		const received = Buffer.from(typeof actual === 'string' ? actual : '', 'hex');
		return expected.length === received.length && timingSafeEqual(expected, received);
	} catch {
		return false;
	}
}

/** @param {Record<string, any>} recovery @param {string} candidateSha @param {(core: Record<string, any>, actual: unknown) => boolean} verifyMac */
function assertCurrentRecoveryEnvelope(recovery, candidateSha, verifyMac) {
	const core = recoveryCore(recovery);
	if (
		!recovery || recovery.candidateSha !== candidateSha ||
		JSON.stringify(Object.keys(recovery)) !== JSON.stringify([...RECOVERY_FIELDS, 'recoveryMac']) ||
		recovery.recoveryVersion !== 2 ||
		recovery.projectRef !== TARGET.projectRef ||
		recovery.cloudflareAccountId !== TARGET.cloudflareAccountId ||
		recovery.workerName !== TARGET.workerName ||
		!UUID.test(recovery.runId ?? '') ||
		recovery.widgetIntent?.name !== `aromatika-issue22-${recovery.runId.slice(0, 12)}` ||
		recovery.widgetIntent?.domain !== TARGET.workerHostname ||
		!(recovery.widgetSitekey === null || (typeof recovery.widgetSitekey === 'string' && recovery.widgetSitekey.length > 0)) ||
		!ISO_TIMESTAMP.test(recovery.createdAt ?? '') ||
		!ISO_TIMESTAMP.test(recovery.updatedAt ?? '') ||
		new Date(recovery.updatedAt).getTime() < new Date(recovery.createdAt).getTime() ||
		!(recovery.authQuiescedAt === null || ISO_TIMESTAMP.test(recovery.authQuiescedAt ?? '')) ||
		![null, 'pristine-migration', 'migrated-reuse'].includes(recovery.baselineEstablishmentMode) ||
		typeof recovery.sealedFinalState !== 'boolean' ||
		!(recovery.cleanupFinalStateProvenAt === null || ISO_TIMESTAMP.test(recovery.cleanupFinalStateProvenAt ?? '')) ||
		!validNullableSha(recovery.ledgerSha256) ||
		!validNullableSha(recovery.generatedConfigSha256) ||
		!validNullableSha(recovery.retainedLedgerSha256) ||
		!validNullableSha(recovery.retainedGeneratedConfigSha256) ||
		sha256Text(recovery.retainedLedger) !== recovery.retainedLedgerSha256 ||
		sha256Text(recovery.retainedGeneratedConfig) !== recovery.retainedGeneratedConfigSha256 ||
		!verifyMac(core, recovery.recoveryMac)
	) throw new Error('recovery attribution mismatch');
	return core;
}

/** @param {Record<string, any>} recovery @param {string} candidateSha @param {string | undefined} authenticationKey */
export function assertRecoveryEnvelope(recovery, candidateSha, authenticationKey) {
	if (!recovery || !/^[0-9a-f]{40}$/u.test(candidateSha)) throw new Error('recovery attribution mismatch');
	assertCurrentRecoveryEnvelope(recovery, candidateSha, (core, actual) => verifyRecoveryMac(core, actual, authenticationKey));
}

/** @param {Record<string, any>} recovery @param {string} candidateSha @param {string | undefined} recoveryKey */
export function assertRecoveryEnvelopeWithKey(recovery, candidateSha, recoveryKey) {
	if (!recovery || !/^[0-9a-f]{40}$/u.test(candidateSha)) throw new Error('recovery attribution mismatch');
	assertCurrentRecoveryEnvelope(recovery, candidateSha, (core, actual) => verifyRecoveryMacWithKey(core, actual, recoveryKey));
}

/** @param {Record<string, any>} recovery @param {{ledgerContent?: string, generatedConfigContent?: string, updatedAt: string}} transition */
function transitionRecoveryArtifacts(recovery, transition) {
	const ledgerContent = Object.hasOwn(transition, 'ledgerContent') ? transition.ledgerContent : recovery.retainedLedger;
	const generatedConfigContent = Object.hasOwn(transition, 'generatedConfigContent') ? transition.generatedConfigContent : recovery.retainedGeneratedConfig;
	return {
		...recovery,
		updatedAt: transition.updatedAt,
		ledgerSha256: sha256Text(ledgerContent),
		generatedConfigSha256: sha256Text(generatedConfigContent),
		retainedLedger: ledgerContent,
		retainedGeneratedConfig: generatedConfigContent,
		retainedLedgerSha256: sha256Text(ledgerContent),
		retainedGeneratedConfigSha256: sha256Text(generatedConfigContent)
	};
}

/** @param {Record<string, any>} recovery @param {string} candidateSha @param {{ledgerContent?: string, generatedConfigContent?: string, updatedAt: string}} transition @param {string} authenticationKey */
export function sealRecoveryArtifactTransition(recovery, candidateSha, transition, authenticationKey) {
	assertRecoveryEnvelope(recovery, candidateSha, authenticationKey);
	return sealRecoveryState(transitionRecoveryArtifacts(recovery, transition), authenticationKey);
}

/** @param {Record<string, any>} recovery @param {string} candidateSha @param {{ledgerContent?: string, generatedConfigContent?: string, updatedAt: string}} transition @param {string} recoveryKey */
export function sealRecoveryArtifactTransitionWithKey(recovery, candidateSha, transition, recoveryKey) {
	assertRecoveryEnvelopeWithKey(recovery, candidateSha, recoveryKey);
	return sealRecoveryStateWithKey(transitionRecoveryArtifacts(recovery, transition), recoveryKey);
}

/** @param {Record<string, any>} recovery @param {{ledgerContent: string | null, generatedConfigContent: string | null}} observed */
export function reconcileAuthenticatedRecoveryArtifacts(recovery, observed) {
	/** @param {string | null} expectedSha @param {string | null} retained @param {string | null} observedContent @param {string} label */
	const resolve = (expectedSha, retained, observedContent, label) => {
		if (sha256Text(observedContent) === expectedSha) return { content: observedContent, restore: false };
		if (typeof retained === 'string' && sha256Text(retained) === expectedSha) return { content: retained, restore: true };
		throw new Error(`authenticated ${label} artifact is unavailable`);
	};
	const ledger = resolve(recovery.ledgerSha256, recovery.retainedLedger, observed.ledgerContent, 'ledger');
	const config = resolve(recovery.generatedConfigSha256, recovery.retainedGeneratedConfig, observed.generatedConfigContent, 'generated config');
	return {
		ledgerContent: ledger.content,
		generatedConfigContent: config.content,
		restoreLedger: ledger.restore,
		restoreGeneratedConfig: config.restore
	};
}

/** @param {Record<string, string | undefined>} source @param {Record<string, string>} extra */
export function buildIssue22ChildEnv(source, extra = {}) {
	const keys = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME', 'COMSPEC'];
	/** @type {Record<string, string>} */
	const environment = { NO_COLOR: '1' };
	for (const key of keys) if (source[key]) environment[key] = source[key];
	return { ...environment, ...extra };
}

/**
 * @param {{execute: (markCleanupRequired: () => void) => Promise<void>, cleanup: () => Promise<void>, emitSuccess: () => unknown}} steps
 */
export async function runHostedExecutionWithRequiredCleanup(steps) {
	let cleanupRequired = false;
	const markCleanupRequired = () => { cleanupRequired = true; };
	try {
		await steps.execute(markCleanupRequired);
	} finally {
		if (cleanupRequired) await steps.cleanup();
	}
	return steps.emitSuccess();
}

/**
 * @param {Record<string, any> | null} recovery
 * @param {string} candidateSha
 * @param {{recoverySha256?: string, ledgerSha256?: string | null, generatedConfigSha256?: string | null, authenticationKey?: string}} artifacts
 */
export function assertRecoveryAttribution(recovery, candidateSha, artifacts = {}) {
	if (!recovery || !/^[0-9a-f]{40}$/u.test(candidateSha)) throw new Error('recovery attribution mismatch');
	if (recovery.candidateSha !== candidateSha) {
		if (
			recovery.candidateSha !== KNOWN_FAILED_RECOVERY.predecessorSha ||
			recovery.runId !== KNOWN_FAILED_RECOVERY.runId ||
			artifacts.recoverySha256 !== KNOWN_FAILED_RECOVERY.recoverySha256 ||
			artifacts.generatedConfigSha256 !== KNOWN_FAILED_RECOVERY.generatedConfigSha256
		) throw new Error('recovery attribution mismatch');
		return {
			adopted: true,
			predecessorSha: KNOWN_FAILED_RECOVERY.predecessorSha,
			recoverySha256: KNOWN_FAILED_RECOVERY.recoverySha256,
			generatedConfigSha256: KNOWN_FAILED_RECOVERY.generatedConfigSha256
		};
	}

	assertRecoveryEnvelope(recovery, candidateSha, artifacts.authenticationKey);
	if (
		recovery.ledgerSha256 !== (artifacts.ledgerSha256 ?? null) ||
		recovery.generatedConfigSha256 !== (artifacts.generatedConfigSha256 ?? null)
	) throw new Error('recovery attribution mismatch');

	const hasAdoption = [recovery.adoptedPredecessorSha, recovery.adoptedRecoverySha256, recovery.adoptedGeneratedConfigSha256].some((value) => value !== null);
	if (hasAdoption) {
		if (
			recovery.runId !== KNOWN_FAILED_RECOVERY.runId ||
			recovery.adoptedPredecessorSha !== KNOWN_FAILED_RECOVERY.predecessorSha ||
			recovery.adoptedRecoverySha256 !== KNOWN_FAILED_RECOVERY.recoverySha256 ||
			recovery.adoptedGeneratedConfigSha256 !== KNOWN_FAILED_RECOVERY.generatedConfigSha256 ||
			recovery.sealedFinalState !== true ||
			!verifyMac('issue22:recovery-adoption:v1', predecessorEvidence(), recovery.predecessorEvidenceMac, artifacts.authenticationKey) ||
			!ISO_TIMESTAMP.test(recovery.cleanupFinalStateProvenAt ?? '') ||
			recovery.retainedLedger !== null ||
			recovery.generatedConfigSha256 !== KNOWN_FAILED_RECOVERY.generatedConfigSha256
		) throw new Error('recovery attribution mismatch');
		return {
			adopted: true,
			predecessorSha: KNOWN_FAILED_RECOVERY.predecessorSha,
			recoverySha256: KNOWN_FAILED_RECOVERY.recoverySha256,
			generatedConfigSha256: KNOWN_FAILED_RECOVERY.generatedConfigSha256
		};
	}
	if (
		recovery.adoptedPredecessorSha !== null ||
		recovery.adoptedRecoverySha256 !== null ||
		recovery.adoptedGeneratedConfigSha256 !== null ||
		recovery.predecessorEvidenceMac !== null
	) throw new Error('recovery attribution mismatch');
	return { adopted: false, predecessorSha: null };
}

function predecessorEvidence() {
	return {
		predecessorSha: KNOWN_FAILED_RECOVERY.predecessorSha,
		recoverySha256: KNOWN_FAILED_RECOVERY.recoverySha256,
		generatedConfigSha256: KNOWN_FAILED_RECOVERY.generatedConfigSha256,
		runId: KNOWN_FAILED_RECOVERY.runId,
		ledgerSha256: null
	};
}

/** @param {string} domain @param {unknown} payload @param {string | undefined} authenticationKey */
function computeMac(domain, payload, authenticationKey) {
	if (typeof authenticationKey !== 'string' || !/^sbp_/u.test(authenticationKey) || authenticationKey.length < 24) {
		throw new Error('receipt authentication key is unavailable');
	}
	return createHmac('sha256', authenticationKey).update(`${domain}\0${JSON.stringify(payload)}`).digest('hex');
}

/** @param {string} domain @param {unknown} payload @param {unknown} actual @param {string | undefined} authenticationKey */
function verifyMac(domain, payload, actual, authenticationKey) {
	try {
		const expected = Buffer.from(computeMac(domain, payload, authenticationKey), 'hex');
		const received = Buffer.from(typeof actual === 'string' ? actual : '', 'hex');
		return expected.length === received.length && timingSafeEqual(expected, received);
	} catch {
		return false;
	}
}

const FINGERPRINT_FIELDS = Object.freeze(['relationsSha256', 'storageAuthorizationSha256', 'typesSha256', 'functionsSha256', 'policiesSha256', 'triggersSha256', 'catalogSha256']);
const OBSERVED_STATE_FIELDS = Object.freeze(['baselineMode', 'migrationCount', 'storageBuckets', 'storageObjects', 'catalog', 'authUsers', 'applicationRows', 'workerSecrets', 'widgetAbsent', 'authDisabled', 'definitionFingerprints']);

/** @param {Record<string, any>} value */
function assertObservedFinalState(value) {
	if (
		!value ||
		JSON.stringify(Object.keys(value)) !== JSON.stringify(OBSERVED_STATE_FIELDS) ||
		!['pristine', 'migrated'].includes(value.baselineMode) ||
		value.storageObjects !== 0 || value.authUsers !== 0 || value.applicationRows !== 0 || value.workerSecrets !== 0 ||
		value.widgetAbsent !== true || value.authDisabled !== true
	) throw new Error('observed final state mismatch');
	if (value.baselineMode === 'pristine') {
		if (
			value.migrationCount !== 0 || value.storageBuckets !== 0 ||
			JSON.stringify(value.catalog) !== JSON.stringify({ brands: 0, aliases: 0, memberships: 0 }) ||
			value.definitionFingerprints !== null
		) throw new Error('observed final state mismatch');
	} else if (
		value.migrationCount !== 18 || value.storageBuckets !== EXPECTED_STORAGE_BUCKETS.length ||
		JSON.stringify(value.catalog) !== JSON.stringify(CATALOG_BASELINE) ||
		!value.definitionFingerprints ||
		FINGERPRINT_FIELDS.some((field) => !SHA256.test(value.definitionFingerprints[field] ?? '')) ||
		JSON.stringify(Object.keys(value.definitionFingerprints)) !== JSON.stringify(FINGERPRINT_FIELDS)
	) throw new Error('observed final state mismatch');
	return value;
}

/** @param {Record<string, any> | null} receipt @param {string} candidateSha @param {string} authenticationKey */
export function assertCleanupReceiptForMigratedBaseline(receipt, candidateSha, authenticationKey) {
	if (!receipt || !ISO_TIMESTAMP.test(receipt.at ?? '')) {
		throw new Error('migrated baseline cleanup receipt mismatch');
	}
	const core = {
		receiptVersion: 3,
		receiptKind: 'baseline-establishment',
		establishmentMode: receipt.establishmentMode,
		at: receipt.at,
		candidateSha,
		projectRef: TARGET.projectRef,
		cloudflareAccountId: TARGET.cloudflareAccountId,
		worker: TARGET.workerName,
		originRunId: receipt.originRunId,
		originLedgerSha256: receipt.originLedgerSha256,
		adoptedEvidence: receipt.adoptedEvidence,
		etherealCredentialPersisted: false,
		maxSyntheticWorkerRequests: OPERATOR_CAPACITY_BUDGET.totalRequests,
		maxSyntheticWorkerCpuMs: OPERATOR_CAPACITY_BUDGET.totalCpuMs,
		observedFinalState: receipt.observedFinalState
	};
	try { assertObservedFinalState(core.observedFinalState); } catch { throw new Error('migrated baseline cleanup receipt mismatch'); }
	if (
		core.observedFinalState.baselineMode !== 'migrated' ||
		!UUID.test(core.originRunId ?? '') ||
		!validNullableSha(core.originLedgerSha256) ||
		!['legacy-adoption', 'pristine-migration'].includes(core.establishmentMode)
	) throw new Error('migrated baseline cleanup receipt mismatch');
	if (core.establishmentMode === 'legacy-adoption') {
		if (
			core.originRunId !== KNOWN_FAILED_RECOVERY.runId || core.originLedgerSha256 !== null ||
			core.adoptedEvidence?.predecessorSha !== KNOWN_FAILED_RECOVERY.predecessorSha ||
			core.adoptedEvidence?.recoverySha256 !== KNOWN_FAILED_RECOVERY.recoverySha256 ||
			core.adoptedEvidence?.generatedConfigSha256 !== KNOWN_FAILED_RECOVERY.generatedConfigSha256 ||
			!verifyMac('issue22:recovery-adoption:v1', predecessorEvidence(), core.adoptedEvidence?.predecessorEvidenceMac, authenticationKey)
		) throw new Error('migrated baseline cleanup receipt mismatch');
	} else if (core.adoptedEvidence !== null) throw new Error('migrated baseline cleanup receipt mismatch');
	if (
		JSON.stringify(Object.keys(receipt)) !== JSON.stringify([...Object.keys(core), 'payloadMac']) ||
		JSON.stringify(Object.fromEntries(Object.keys(core).map((key) => [key, receipt[key]]))) !== JSON.stringify(core) ||
		!verifyMac('issue22:baseline-establishment:v1', core, receipt.payloadMac, authenticationKey)
	) throw new Error('migrated baseline cleanup receipt mismatch');
}

/** @param {Record<string, any> | null} receipt @param {string} candidateSha @param {string} runId @param {string} authenticationKey @param {Record<string, any>} expectedObservedState */
export function assertCurrentCleanupReceipt(receipt, candidateSha, runId, authenticationKey, expectedObservedState) {
	if (
		!receipt ||
		!ISO_TIMESTAMP.test(receipt.at ?? '') ||
		receipt.runId !== runId ||
		!validNullableSha(receipt.ledgerSha256)
	) throw new Error('current cleanup receipt mismatch');
	const core = {
		receiptVersion: 3,
		receiptKind: 'current-run-cleanup',
		at: receipt.at,
		candidateSha,
		projectRef: TARGET.projectRef,
		cloudflareAccountId: TARGET.cloudflareAccountId,
		worker: TARGET.workerName,
		runId,
		ledgerSha256: receipt.ledgerSha256,
		etherealCredentialPersisted: false,
		maxSyntheticWorkerRequests: OPERATOR_CAPACITY_BUDGET.totalRequests,
		maxSyntheticWorkerCpuMs: OPERATOR_CAPACITY_BUDGET.totalCpuMs,
		observedFinalState: receipt.observedFinalState
	};
	try {
		assertObservedFinalState(core.observedFinalState);
		assertObservedFinalState(expectedObservedState);
	} catch { throw new Error('current cleanup receipt mismatch'); }
	if (
		JSON.stringify(Object.keys(receipt)) !== JSON.stringify([...Object.keys(core), 'payloadMac']) ||
		JSON.stringify(Object.fromEntries(Object.keys(core).map((key) => [key, receipt[key]]))) !== JSON.stringify(core) ||
		JSON.stringify(core.observedFinalState) !== JSON.stringify(expectedObservedState) ||
		!verifyMac('issue22:current-run-cleanup:v1', core, receipt.payloadMac, authenticationKey)
	) throw new Error('current cleanup receipt mismatch');
}

/**
 * Preserve the one immutable receipt that proves the adopted predecessor was fully cleaned.
 * @param {{existing: Record<string, any> | null, authenticatedEstablishment: Record<string, any> | null, candidateSha: string, authenticationKey: string}} options
 */
export function selectBaselineCleanupReceipt(options) {
	if (options.existing) {
		assertCleanupReceiptForMigratedBaseline(options.existing, options.candidateSha, options.authenticationKey);
		return options.existing;
	}
	if (options.authenticatedEstablishment) {
		assertCleanupReceiptForMigratedBaseline(options.authenticatedEstablishment, options.candidateSha, options.authenticationKey);
		return options.authenticatedEstablishment;
	}
	return null;
}

/** @param {{mode?: string}} baseline @param {Record<string, any> | null} cleanupReceipt @param {string} candidateSha @param {string} authenticationKey */
export function decideMigrationExecution(baseline, cleanupReceipt, candidateSha, authenticationKey) {
	if (baseline?.mode === 'pristine') return 'migrate';
	if (baseline?.mode === 'migrated') {
		assertCleanupReceiptForMigratedBaseline(cleanupReceipt, candidateSha, authenticationKey);
		return 'reuse';
	}
	throw new Error('migration baseline mode is invalid');
}

/**
 * @param {{actualVersions: string[], expectedVersions: string[], currentCounts: Record<string, any>, seed: () => Promise<Record<string, any>>, attest: () => Promise<Record<string, any>>}} options
 */
export async function recoverCatalogForCleanup(options) {
	if (options.actualVersions.length === 0) return { recovered: false };
	if (JSON.stringify(options.actualVersions) !== JSON.stringify(options.expectedVersions)) {
		throw new Error('cleanup migration chain does not match the exact candidate');
	}
	try {
		assertCatalogCounts(options.currentCounts);
		return { recovered: false };
	} catch {
		const seeded = await options.seed();
		assertCatalogCounts(seeded);
		assertCatalogCounts(await options.attest());
		return { recovered: true };
	}
}

/** @param {Record<string, any>} value */
export function assertLiveCloudflareCapacity(value) {
	if (
		value?.accountId !== TARGET.cloudflareAccountId ||
		!['standard', 'bundled'].includes(value?.usageModel) ||
		![
			value.daily?.currentRequests,
			value.monthly?.currentRequests,
			value.monthly?.currentCpuMs,
			value.freeDailyRequestLimit,
			value.standardMonthlyRequestLimit,
			value.standardMonthlyCpuMsLimit,
			value.freeCpuMsPerInvocation,
			value.freeSubrequestsPerInvocation
		].every(Number.isFinite) ||
		value.freeDailyRequestLimit !== 100_000 ||
		value.standardMonthlyRequestLimit !== 10_000_000 ||
		value.standardMonthlyCpuMsLimit !== 30_000_000 ||
		value.freeCpuMsPerInvocation !== OPERATOR_CAPACITY_BUDGET.maxCpuMsPerInvocation ||
		value.freeSubrequestsPerInvocation !== OPERATOR_CAPACITY_BUDGET.maxSubrequestsPerInvocation
	) {
		throw new Error('Cloudflare capacity receipt identity/limits are invalid');
	}
	const remainingDailyRequests = value.freeDailyRequestLimit - value.daily.currentRequests;
	const remainingMonthlyRequests = value.standardMonthlyRequestLimit - value.monthly.currentRequests;
	const remainingMonthlyCpuMs = value.standardMonthlyCpuMsLimit - value.monthly.currentCpuMs;
	if (remainingDailyRequests < OPERATOR_CAPACITY_BUDGET.totalRequests) throw new Error('Cloudflare Free daily request headroom is insufficient');
	if (remainingMonthlyRequests < OPERATOR_CAPACITY_BUDGET.totalRequests) throw new Error('Cloudflare Standard monthly request headroom is insufficient');
	if (remainingMonthlyCpuMs < OPERATOR_CAPACITY_BUDGET.conservativeTotalCpuMs) throw new Error('Cloudflare Standard monthly CPU headroom is insufficient');
	return {
		...value,
		executionPlan: 'workers_free',
		remainingDailyRequests,
		remainingMonthlyRequests,
		remainingMonthlyCpuMs,
		operatorBudget: OPERATOR_CAPACITY_BUDGET
	};
}

/** @param {{accountId: string, workerName: string, status: number}} value */
export function classifyExactWorkerProbe(value) {
	if (value?.accountId !== TARGET.cloudflareAccountId || value?.workerName !== TARGET.workerName) {
		throw new Error('Worker probe identity mismatch');
	}
	if (value.status === 404) return 'absent';
	if (value.status === 200) return 'present';
	throw new Error('Worker probe returned an untrusted status');
}

/**
 * @param {{probe: () => Promise<'absent'|'present'>, list: () => Promise<Array<{name: string}>>, remove: (name: string) => Promise<unknown>}} operations
 */
export async function cleanupExactWorkerSecrets(operations) {
	const state = await operations.probe();
	if (state === 'absent') return { worker: 'absent' };
	if (state !== 'present') throw new Error('Worker secret cleanup probe is invalid');
	const reviewed = ['SUPABASE_SECRET_KEY', 'TURNSTILE_SECRET_KEY'];
	const live = await operations.list();
	for (const name of reviewed) {
		if (live.some((item) => item.name === name)) await operations.remove(name);
	}
	if ((await operations.list()).length !== 0) throw new Error('Worker secret inventory is not empty');
	return { worker: 'present' };
}

/** @param {Record<string, any>} ledger @param {Record<string, any>} providerUser */
export function assertRunOwnedActor(ledger, providerUser) {
	const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
	if (
		!uuid.test(ledger?.userId ?? '') ||
		providerUser?.id !== ledger.userId ||
		providerUser?.email !== ledger.email ||
		providerUser?.user_metadata?.username !== ledger.username ||
		!/^issue22-[a-z_]+-[a-z0-9]+@example\.invalid$/u.test(ledger.email) ||
		!/^issue22_[a-z_]+_[a-z0-9]+$/u.test(ledger.username)
	) {
		throw new Error('cleanup guard rejected a non-run-owned actor');
	}
}

/** @param {{name: string, domain: string}} intent @param {Array<Record<string, any>>} widgets */
export function resolveWidgetForCleanup(intent, widgets) {
	if (!intent?.name || !intent?.domain || !Array.isArray(widgets)) throw new Error('widget recovery intent is invalid');
	const matches = widgets.filter((item) => item?.name === intent.name && item?.domains?.includes(intent.domain));
	if (matches.length > 1) throw new Error('ambiguous widget recovery state');
	return matches[0] ?? null;
}

/** @param {{name: string, domain: string}} intent @param {string | null | undefined} savedSitekey @param {Array<Record<string, any>>} widgets */
export function resolveSavedWidgetForCleanup(intent, savedSitekey, widgets) {
	if (savedSitekey) {
		const matches = widgets.filter((item) => item?.sitekey === savedSitekey);
		if (matches.length !== 1) throw new Error('saved widget sitekey recovery state is ambiguous');
		const [widget] = matches;
		if (widget.name !== intent?.name || !widget.domains?.includes(intent?.domain)) {
			throw new Error('saved widget sitekey does not match recovery intent');
		}
		return widget;
	}
	return resolveWidgetForCleanup(intent, widgets);
}

/** @param {() => Promise<unknown>} operation @param {number} attempts */
async function retry(operation, attempts) {
	let cause;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			cause = error;
		}
	}
	throw cause;
}

/**
 * @param {{disable: () => Promise<unknown>, rollbackDeploy: () => Promise<unknown>, capacity: () => Promise<unknown>, rollbackSmoke: () => Promise<unknown>, recoverCatalog?: () => Promise<unknown>, cleanupData: () => Promise<unknown>, cleanupSecrets: () => Promise<unknown>, cleanupWidget: () => Promise<unknown>, attestFinal: () => Promise<unknown>, deleteRecovery: () => Promise<unknown>}} steps
 * @param {number} attempts
 */
export async function runPriorityCleanup(steps, attempts = 3) {
	if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) throw new Error('cleanup retry bound is invalid');
	/** @type {string[]} */
	const failures = [];
	/** @param {string} label @param {() => Promise<unknown>} operation */
	const run = async (label, operation) => {
		try {
			await retry(operation, attempts);
			return true;
		} catch {
			failures.push(label);
			return false;
		}
	};

	// Availability/safety restoration is deliberately first and independent.
	await run('disable-auth', steps.disable);
	await run('rollback-deploy', steps.rollbackDeploy);
	const capacityAvailable = await run('live-capacity', steps.capacity);
	if (capacityAvailable) await run('rollback-smoke', steps.rollbackSmoke);
	else failures.push('rollback-smoke-unproven');
	if (steps.recoverCatalog) await run('recover-catalog', steps.recoverCatalog);
	await run('cleanup-data', steps.cleanupData);
	await run('cleanup-secrets', steps.cleanupSecrets);
	await run('cleanup-widget', steps.cleanupWidget);
	await run('final-attestation', steps.attestFinal);
	if (failures.length === 0) await run('delete-recovery', steps.deleteRecovery);
	return { failures };
}

/**
 * Keep the sealed recovery record until every other local artifact operation succeeds.
 * @param {{sealRecovery: () => Promise<unknown>, writeReceipt: () => Promise<unknown>, deleteArtifacts: () => Promise<unknown>, deleteRecovery: () => Promise<unknown>}} steps
 */
export async function finalizeRecoveryArtifacts(steps) {
	await steps.sealRecovery();
	await steps.writeReceipt();
	await steps.deleteArtifacts();
	await steps.deleteRecovery();
}

/** @param {Record<string, any>} auth @param {Record<string, any>} publicSettings @param {{open: boolean, captcha: boolean}} expected */
export function assertAuthState(auth, publicSettings, expected) {
	const origin = `https://${TARGET.workerHostname}`;
	if (
		auth?.disable_signup !== !expected.open ||
		auth?.external_email_enabled !== true ||
		auth?.external_phone_enabled !== false ||
		auth?.external_anonymous_users_enabled !== false ||
		auth?.mailer_autoconfirm !== false ||
		auth?.security_captcha_enabled !== expected.captcha ||
		(expected.captcha && auth?.security_captcha_provider !== 'turnstile') ||
		auth?.site_url !== origin ||
		publicSettings?.disable_signup !== !expected.open ||
		publicSettings?.mailer_autoconfirm !== false ||
		publicSettings?.external?.email !== true ||
		publicSettings?.external?.phone !== false ||
		publicSettings?.external?.anonymous_users !== false
	) {
		throw new Error('Auth/public settings attestation mismatch');
	}
}

/** @param {Record<string, any>} auth @param {Record<string, any>} expected */
export function assertAuthConfiguration(auth, expected) {
	/** @param {unknown} value */
	const normalizeRedirects = (value) => (Array.isArray(value) ? value : String(value ?? '').split(','))
		.map((item) => item.trim())
		.filter(Boolean)
		.sort();
	const exactKeys = [
		'site_url',
		'smtp_admin_email',
		'smtp_host',
		'smtp_user',
		'smtp_sender_name',
		'mailer_subjects_confirmation',
		'mailer_templates_confirmation_content'
	];
	if (
		exactKeys.some((key) => auth?.[key] !== expected?.[key]) ||
		String(auth?.smtp_port ?? '') !== String(expected?.smtp_port ?? '') ||
		JSON.stringify(normalizeRedirects(auth?.uri_allow_list)) !== JSON.stringify(normalizeRedirects(expected?.uri_allow_list)) ||
		!String(auth?.mailer_templates_confirmation_content ?? '').includes('{{ .TokenHash }}') ||
		!String(auth?.mailer_templates_confirmation_content ?? '').includes('type=email')
	) {
		throw new Error('Auth configuration attestation mismatch');
	}
}

/** @param {Record<string, any>} auth @param {Record<string, any>} publicSettings */
export function assertSafeDisabledAuth(auth, publicSettings) {
	assertAuthState(auth, publicSettings, { open: false, captcha: false });
	/** @param {string} key */
	const cleared = (key) => !Object.hasOwn(auth ?? {}, key) || auth[key] === null;
	if (
		!cleared('security_captcha_secret') ||
		['smtp_admin_email', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_sender_name']
			.some((key) => !cleared(key))
	) {
		throw new Error('safe disabled Auth baseline mismatch');
	}
}

export function buildAuthCredentialClearPatch() {
	return {
		security_captcha_enabled: false,
		security_captcha_provider: null,
		security_captcha_secret: null,
		smtp_admin_email: null,
		smtp_host: null,
		smtp_port: null,
		smtp_user: null,
		smtp_pass: null,
		smtp_sender_name: null
	};
}

/** @param {Record<string, any>} schema */
export function assertNullableAuthUpdateSchema(schema) {
	const properties = schema?.components?.schemas?.UpdateAuthConfigBody?.properties;
	if (!properties) throw new Error('UpdateAuthConfigBody nullable schema is unavailable');
	for (const key of Object.keys(buildAuthCredentialClearPatch())) {
		if (properties[key]?.nullable !== true) throw new Error(`UpdateAuthConfigBody ${key} is not nullable`);
	}
	if (properties.smtp_admin_email?.format !== 'email') throw new Error('UpdateAuthConfigBody SMTP email shape changed');
}

/**
 * @param {{
 * patch: (body: Record<string, any>) => Promise<Record<string, any>>,
 * publicSettings: () => Promise<Record<string, any>>,
 * getSchema: () => Promise<Record<string, any>>,
 * getAuth: () => Promise<Record<string, any>>
 * }} operations
 */
export async function clearAuthSafely(operations) {
	const disabled = await operations.patch({ disable_signup: true });
	const disabledPublic = await operations.publicSettings();
	if (disabled?.disable_signup !== true || disabledPublic?.disable_signup !== true) {
		throw new Error('Auth signup disable did not independently attest');
	}
	assertNullableAuthUpdateSchema(await operations.getSchema());
	await operations.patch(buildAuthCredentialClearPatch());
	const fresh = await operations.getAuth();
	const settings = await operations.publicSettings();
	assertSafeDisabledAuth(fresh, settings);
}
