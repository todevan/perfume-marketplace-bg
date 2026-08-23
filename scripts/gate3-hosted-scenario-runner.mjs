import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isProxy } from 'node:util/types';
import {
	HOSTED_STAGING,
	bindHostedA10CheckpointCapability,
	createSanitizedOperatorRecord,
	inspectHostedA10CheckpointEvidence,
	persistHostedRunManifest,
	validateHostedRunManifest
} from './hosted-report-evidence-operator.mjs';
import { inspectGate3HostedRun } from './gate3-hosted-inspector.mjs';
import {
	GATE3_EXIT_CODES,
	classifyGate3Lifecycle,
	consumeGate3ScenarioAuthorization,
	mintGate3ScenarioCapabilityGrant,
	selectNextScenarioProbe,
	selectNextScenarioStep
} from './gate3-hosted-lifecycle.mjs';
import {
	acquireRunLock,
	inspectRunLock,
	readStableGate3PreflightSnapshot,
	releaseRunLock,
	writeNextRunState
} from './gate3-hosted-state.mjs';

const definitions = [
	['primary-report-created', 2, 'mutation', 'reporter', 'createPrimaryReport', 'readPrimaryReport', 'registerPrimaryReport'],
	['primary-upload-attached-verified', 3, 'verification', 'reporter', null, 'readPrimaryAttachedUpload', null],
	['cross-user-storage-denied', 1, 'mutation', 'cross-user', 'attemptCrossUserStorageRead', 'readCrossUserStorageDenial', null],
	['duplicate-reuse-denied', 4, 'mutation', 'reporter', 'attemptDuplicateReuse', 'readDuplicateReuseDenial', null],
	['duplicate-upload-created', 4, 'mutation', 'reporter', 'createDuplicateUpload', 'readDuplicateUpload', 'registerDuplicateUpload'],
	['duplicate-upload-reconciled', 4, 'mutation', 'cleanup-operator', 'reconcileDuplicateUpload', 'readDuplicateReconciliation', 'registerDuplicateQueue'],
	['assigned-moderator-aal1-denied', 7, 'mutation', 'assigned-moderator-aal1', 'attemptAssignedModeratorAal1Read', 'readAssignedModeratorAal1Denial', null],
	['assignment-applied', 5, 'mutation', 'assigned-moderator-aal2', 'applyAssignment', 'readAssignment', null],
	['assigned-moderator-read-verified', 5, 'verification', 'assigned-moderator-aal2', null, 'readAssignedModeratorEvidence', null],
	['unassigned-moderator-denied', 6, 'mutation', 'unassigned-moderator-aal2', 'attemptUnassignedModeratorRead', 'readUnassignedModeratorDenial', null],
	['rejected-upload-created', 8, 'mutation', 'reporter', 'createRejectedUpload', 'readRejectedUpload', 'registerRejectedUploadAndQueue'],
	['manual-cleanup-verified', 8, 'mutation', 'cleanup-operator', 'invokeManualCleanup', 'readManualCleanup', null],
	['abandoned-upload-allocated', 8, 'mutation', 'reporter', 'allocateAbandonedUpload', 'readAbandonedUpload', 'registerAbandonedUpload'],
	['abandoned-object-created', 8, 'mutation', 'fixture-operator', 'createAbandonedObject', 'readAbandonedObject', null],
	['abandoned-upload-backdated', 8, 'mutation', 'cleanup-operator', 'backdateAbandonedUpload', 'readScheduledQueueCoordinate', 'registerScheduledQueueCoordinate'],
	['scheduled-cleanup-verified', 8, 'verification', 'cleanup-operator', null, 'readScheduledCleanup', null],
	['malformed-request-rejected', 9, 'mutation', 'reporter', 'attemptMalformedRequest', 'readMalformedRequestRejection', null],
	['invalid-image-rejected', 9, 'mutation', 'reporter', 'attemptInvalidImage', 'readInvalidImageRejection', null],
	['per-file-limit-rejected', 10, 'mutation', 'reporter', 'attemptPerFileLimit', 'readPerFileLimitRejection', null],
	['aggregate-limit-rejected', 10, 'mutation', 'reporter', 'attemptAggregateLimit', 'readAggregateLimitRejection', null],
	['chunked-limit-rejected', 10, 'mutation', 'reporter', 'attemptChunkedLimit', 'readChunkedLimitRejection', null],
	['understated-length-rejected', 10, 'mutation', 'reporter', 'attemptUnderstatedLength', 'readUnderstatedLengthRejection', null]
];

export const A10_STEP_REGISTRY = Object.freeze(
	definitions.map(([id, scenario, kind, roleCapability, mutationMethod, readBackMethod, manifestReducer], index) =>
		Object.freeze({
			id,
			scenario,
			kind,
			prerequisiteIds: Object.freeze(index === 0 ? [] : [definitions[index - 1][0]]),
			roleCapability,
			mutationMethod,
			readBackMethod,
			manifestReducer
		})
	)
);

const BOUNDARY_CAPABILITY_KEYS = Object.freeze([
	'roleCapability',
	'mutation',
	'readBack',
	'reduceManifest',
	'persistManifest',
	'persistState'
]);
const READ_BACK_KEYS = Object.freeze(['outcome', 'manifestEvidence', 'receipt']);
const RUN_ID_PATTERN = /^gate3-\d{8}-[a-f0-9]{8}$/u;

class Gate3HostedScenarioError extends Error {
	/** @param {string} reasonCode @param {number} exitCode */
	constructor(reasonCode, exitCode) {
		super(reasonCode);
		this.name = 'Gate3HostedScenarioError';
		this.reasonCode = reasonCode;
		this.exitCode = exitCode;
		this.replayed = false;
		this.requiresFreshInspection = exitCode !== 0;
	}
}

const RUNNER_ERRORS = new WeakSet();

/** @param {string} reasonCode @param {number} exitCode @returns {never} */
function fail(reasonCode, exitCode) {
	const error = new Gate3HostedScenarioError(reasonCode, exitCode);
	RUNNER_ERRORS.add(error);
	throw error;
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainDataObject(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) return false;
	try {
		const prototype = Object.getPrototypeOf(value);
		return prototype === Object.prototype || prototype === null;
	} catch {
		return false;
	}
}

/** @param {Record<string, any>} value @param {readonly string[]} keys */
function hasExactOwnDataKeys(value, keys) {
	try {
		if (Reflect.ownKeys(value).some((key) => typeof key !== 'string')) return false;
		const ownKeys = Object.keys(value);
		if (ownKeys.length !== keys.length || ownKeys.some((key) => !keys.includes(key))) return false;
		return keys.every((key) => {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			return Boolean(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true);
		});
	} catch {
		return false;
	}
}

/** @param {unknown} value */
function exactInspectionSnapshot(value) {
	if (!isPlainDataObject(value)) return null;
	try {
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const keys = Reflect.ownKeys(descriptors);
		if (keys.some((key) => typeof key !== 'string')) return null;
		const snapshot = Object.create(null);
		for (const key of /** @type {string[]} */ (keys)) {
			const descriptor = descriptors[key];
			if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
			Object.defineProperty(snapshot, key, { value: descriptor.value, enumerable: true, writable: false, configurable: false });
		}
		return Object.freeze(snapshot);
	} catch {
		return null;
	}
}

/** @param {unknown} adapter */
function canonicalScenarioInspectionAdapter(adapter) {
	if (!isPlainDataObject(adapter) || !hasExactOwnDataKeys(adapter, ['inspectRun'])) return adapter;
	const inspect = ownValue(adapter, 'inspectRun');
	if (typeof inspect !== 'function') return adapter;
	return Object.freeze({
		inspectRun: async (/** @type {Record<string, any>} */ scope) => {
			const result = exactInspectionSnapshot(await inspect.call(adapter, Object.freeze({ ...scope, scenarioRegistry: A10_STEP_REGISTRY })));
			if (!result) fail('scenario_inspection_invalid', 20);
			const checkpoints = scope?.scenarioEvidence?.checkpoints;
			if (!isPlainDataObject(checkpoints)) return result;
			const keys = Object.keys(checkpoints);
			let prefixLength = 0;
			while (
				prefixLength < A10_STEP_REGISTRY.length &&
				keys[prefixLength] === `scenario-${A10_STEP_REGISTRY[prefixLength].id}`
				) prefixLength += 1;
				if (prefixLength !== keys.length) {
					return Object.freeze({ ...result, scenarioVerified: false, scenarioPartial: true });
				}
				const localComplete = prefixLength === A10_STEP_REGISTRY.length;
				const hostedVerified = ownValue(result, 'scenarioVerified') === true;
				return Object.freeze({
					...result,
					scenarioVerified: hostedVerified && localComplete,
					scenarioPartial: !(hostedVerified && localComplete) &&
						(ownValue(result, 'scenarioPartial') === true || prefixLength > 0)
				});
		}
	});
}

/** @param {Record<string, any>} input @param {string} key */
function ownValue(input, key) {
	const descriptor = Object.getOwnPropertyDescriptor(input, key);
	return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

/** @param {unknown} capabilities @returns {Record<string, any>} */
function exactBoundaryCapabilities(capabilities) {
	if (!isPlainDataObject(capabilities) || !hasExactOwnDataKeys(capabilities, BOUNDARY_CAPABILITY_KEYS)) {
		fail('scenario_capability_invalid', 10);
	}
	return capabilities;
}

/** @param {unknown} readBack */
function exactReadBack(readBack) {
	if (!isPlainDataObject(readBack) || !hasExactOwnDataKeys(readBack, READ_BACK_KEYS)) return null;
	const outcome = ownValue(readBack, 'outcome');
	if (!['confirmed', 'confirmed-absent', 'uncertain'].includes(outcome)) return null;
	return readBack;
}

/** @param {unknown} authorization @param {unknown} inspection */
function exactCanonicalCheckpoint(authorization, inspection) {
	if (!isPlainDataObject(authorization) || !exactInspectionSnapshot(inspection) || !consumeGate3ScenarioAuthorization(authorization, A10_STEP_REGISTRY, inspection)) {
		fail('scenario_authorization_invalid', 10);
	}
	const checkpoint = ownValue(authorization, 'checkpoint');
	const index = A10_STEP_REGISTRY.indexOf(checkpoint);
	if (
		index < 0 ||
		ownValue(authorization, 'command') !== 'scenario' ||
		ownValue(authorization, 'phase') !== 'scenario' ||
		!['mutate', 'reconcile'].includes(ownValue(authorization, 'mode')) ||
		!Number.isSafeInteger(ownValue(authorization, 'revision')) ||
		!['exact', 'ahead'].includes(ownValue(authorization, 'manifestState')) ||
		!isPlainDataObject(ownValue(authorization, 'coordinates'))
	) {
		fail('scenario_authorization_invalid', 10);
	}
	return checkpoint;
}

/** @param {string} status @param {number} exitCode @param {string} checkpointId */
function outcomeResult(status, exitCode, checkpointId) {
	return Object.freeze({
		status,
		exitCode,
		checkpointId,
		replayed: false,
		requiresFreshInspection: exitCode !== 0
	});
}

/**
 * Executes one and only one lifecycle-selected A10 checkpoint.
 * @param {{ inspection: unknown, authorization: unknown, capabilities: unknown }} options
 */
export async function runScenarioBoundary({ inspection, authorization, capabilities }) {
	const checkpoint = exactCanonicalCheckpoint(authorization, inspection);
	const exactAuthorization = /** @type {Record<string, any>} */ (authorization);
	const caps = exactBoundaryCapabilities(capabilities);
	const roleCapability = ownValue(caps, 'roleCapability');
	const mutation = ownValue(caps, 'mutation');
	const readBack = ownValue(caps, 'readBack');
	const reduceManifest = ownValue(caps, 'reduceManifest');
	const persistManifest = ownValue(caps, 'persistManifest');
	const persistState = ownValue(caps, 'persistState');
	const mode = ownValue(exactAuthorization, 'mode');
	const manifestState = ownValue(exactAuthorization, 'manifestState');
	if (
		roleCapability !== checkpoint.roleCapability ||
		typeof readBack !== 'function' ||
		typeof persistState !== 'function' ||
		(checkpoint.kind === 'verification' && mutation !== null) ||
		(checkpoint.kind === 'mutation' && mode === 'mutate' && typeof mutation !== 'function') ||
		(checkpoint.kind === 'mutation' && mode === 'reconcile' && mutation !== null) ||
		(checkpoint.manifestReducer === null ? reduceManifest !== null : typeof reduceManifest !== 'function') ||
		(checkpoint.kind === 'mutation' && manifestState === 'exact' ? typeof persistManifest !== 'function' : persistManifest !== null)
	) {
		fail('scenario_capability_invalid', 10);
	}

	let mutationFailed = false;
	if (checkpoint.kind === 'mutation' && mode === 'mutate') {
		try {
			await mutation();
		} catch (error) {
			if (error && typeof error === 'object' && RUNNER_ERRORS.has(error)) throw error;
			mutationFailed = true;
		}
	}
	let readBackResult;
	try {
		readBackResult = exactReadBack(
			await readBack(Object.freeze({
				checkpointId: checkpoint.id,
				mutationAttempted: checkpoint.kind === 'mutation' && mode === 'mutate',
				mutationFailed
			}))
		);
	} catch {
		return outcomeResult('uncertain', 41, checkpoint.id);
	}
	if (readBackResult === null) return outcomeResult('uncertain', 41, checkpoint.id);
	if (readBackResult.outcome === 'confirmed-absent') {
		return outcomeResult('confirmed-absent', 40, checkpoint.id);
	}
	if (readBackResult.outcome === 'uncertain') return outcomeResult('uncertain', 41, checkpoint.id);

	let nextManifest = null;
	try {
			const coordinates = ownValue(exactAuthorization, 'coordinates');
			const safeReceipt = createSanitizedOperatorRecord(readBackResult.receipt, {
				checkpointId: checkpoint.id,
				runId: coordinates.runId,
				scenario: checkpoint.scenario,
				actorRole: checkpoint.roleCapability
			});
			if (checkpoint.manifestReducer !== null) {
				nextManifest = await reduceManifest(readBackResult.manifestEvidence);
				if (!isPlainDataObject(nextManifest)) fail('scenario_manifest_evidence_invalid', 41);
			}
			if (checkpoint.kind === 'mutation' && manifestState === 'exact') await persistManifest(nextManifest);
		await persistState(Object.freeze({ checkpointId: checkpoint.id, receipt: safeReceipt }));
		return Object.freeze({
			status: 'confirmed',
			exitCode: 0,
			checkpointId: checkpoint.id,
			replayed: false,
			requiresFreshInspection: false,
			receipt: safeReceipt
		});
	} catch (error) {
		if (error && typeof error === 'object' && RUNNER_ERRORS.has(error)) throw error;
		fail('scenario_persistence_uncertain', 41);
	}
}

/** @param {Record<string, any>} dependencies @param {string} name @param {Function} fallback */
function dependency(dependencies, name, fallback) {
	const candidate = dependencies[name];
	return typeof candidate === 'function' ? candidate : fallback;
}

/** @param {unknown} bytes */
function bytesHash(bytes) {
	return createHash('sha256').update(Buffer.from(/** @type {any} */ (bytes))).digest('hex');
}

/** @param {unknown} value */
function serializedManifestHash(value) {
	return createHash('sha256').update(`${JSON.stringify(value)}\n`).digest('hex');
}

/** @param {Record<string, any>} state @param {any} checkpoint @param {readonly string[]} completedIds @param {string} manifestSha256 @param {string} observedAt */
function nextScenarioState(state, checkpoint, completedIds, manifestSha256, observedAt) {
	const checkpointKeys = Object.keys(state.scenarioCheckpoints ?? {});
	const expectedKeys = completedIds.map((id) => `scenario-${id}`);
	if (
		checkpointKeys.length !== expectedKeys.length ||
		checkpointKeys.some((key) => !expectedKeys.includes(key)) ||
		completedIds.at(-1) === checkpoint.id
	) {
		fail('scenario_state_evidence_invalid', 20);
	}
	const record = Object.freeze({
		observedAt,
		status: 'complete',
		phase: 'scenario',
		step: checkpoint.id,
		reasonCode: 'scenario_checkpoint_verified',
		revision: state.revision + 1,
		scenarioId: String(checkpoint.scenario),
		operationId: checkpoint.id
	});
	return {
		...state,
		revision: state.revision + 1,
		manifest: { path: state.manifest.path, sha256: manifestSha256 },
		phases: {
			...state.phases,
			scenario: {
				status: checkpoint === A10_STEP_REGISTRY[A10_STEP_REGISTRY.length - 1] ? 'complete' : 'partial',
				checkpoint: record
			}
		},
		scenarioCheckpoints: {
			...state.scenarioCheckpoints,
			[`scenario-${checkpoint.id}`]: record
		}
	};
}

/** @param {Record<string, any>} state */
function scenarioCheckpointLowerBound(state) {
	const completed = A10_STEP_REGISTRY
		.map((entry) => state.scenarioCheckpoints?.[`scenario-${entry.id}`])
		.filter((entry) => entry !== undefined);
	const candidate = completed.at(-1)?.observedAt ?? state.createdAt;
	if (typeof candidate !== 'string' || Number.isNaN(Date.parse(candidate))) fail('scenario_state_evidence_invalid', 20);
	return candidate;
}

/** @param {string} classification @param {number | null} revision */
function blockedResult(classification, revision) {
	const exitCode = classification === 'RELEASE_CHANGED'
		? GATE3_EXIT_CODES.RELEASE_CHANGED
		: classification === 'RECOVERY_REQUIRED'
			? GATE3_EXIT_CODES.RECOVERY_REQUIRED
			: GATE3_EXIT_CODES.AMBIGUOUS;
	return Object.freeze({
		status: 'blocked',
		exitCode,
		classification,
		revision
	});
}

/** @param {unknown} inspection */
function exactClassification(inspection) {
	if (!isPlainDataObject(inspection)) return 'AMBIGUOUS';
	const recomputed = classifyGate3Lifecycle(inspection).classification;
	const reported = ownValue(inspection, 'classification');
	return reported === undefined || reported === recomputed ? recomputed : 'AMBIGUOUS';
}

/** @param {Record<string, any>} inspection */
function isExactManifestAheadInspection(inspection) {
	return (
		exactClassification(inspection) === 'AMBIGUOUS' &&
		ownValue(inspection, 'manifestBindingStatus') === 'manifest-ahead-state' &&
		ownValue(inspection, 'manifestAheadState') === true &&
		ownValue(inspection, 'manifestExactMatch') === false &&
		ownValue(inspection, 'manifestMatches') === false &&
		ownValue(inspection, 'manifestMismatch') === false &&
		ownValue(inspection, 'stateValid') === true &&
		ownValue(inspection, 'stateCorrupt') === false &&
		ownValue(inspection, 'corruptState') === false &&
		ownValue(inspection, 'manifestValid') === true &&
		ownValue(inspection, 'authoritativeReleaseAvailable') === true &&
		ownValue(inspection, 'authoritativeReleaseUnavailable') === false &&
		ownValue(inspection, 'releaseMismatch') === false &&
		ownValue(inspection, 'releaseChanged') === false &&
		ownValue(inspection, 'hostedEvidenceAvailable') === true &&
		ownValue(inspection, 'ownershipConflict') === false &&
		ownValue(inspection, 'deletionScopeTrusted') === false &&
		ownValue(inspection, 'cleanupCompleteContradiction') === false &&
		ownValue(inspection, 'credentialsLost') === false &&
		ownValue(inspection, 'exactRecoveryProvenance') === false &&
		ownValue(inspection, 'duplicateRoles') === 0 &&
		ownValue(inspection, 'metadataMismatches') === 0 &&
		ownValue(inspection, 'actorIdentityConflicts') === 0 &&
		ownValue(inspection, 'manifestActorsAbsent') === 0 &&
		ownValue(inspection, 'hostedActorsManifestStale') === 0 &&
		ownValue(inspection, 'actors') === 4 &&
		ownValue(inspection, 'provisionVerified') === true &&
		ownValue(inspection, 'scenarioVerified') === false &&
		ownValue(inspection, 'cleanupRequired') === false &&
		ownValue(inspection, 'cleanupPartial') === false &&
		ownValue(inspection, 'cleanupVerified') === false &&
		ownValue(inspection, 'archived') === false &&
		ownValue(inspection, 'ambiguous') === true
	);
}

/** @param {Record<string, any>} manifest @param {any} checkpoint @param {string} expectedSha */
function hasCanonicalScenarioPredecessor(manifest, checkpoint, expectedSha) {
	/** @type {Record<string, any>[]} */
	const candidates = [];
	const removeLast = (/** @type {string} */ field) => ({ ...manifest, [field]: manifest[field].slice(0, -1) });
	if (checkpoint.manifestReducer === 'registerPrimaryReport' && manifest.reports.length && manifest.uploads.length) {
		candidates.push({ ...manifest, reports: manifest.reports.slice(0, -1), uploads: manifest.uploads.slice(0, -1) });
	} else if (['registerDuplicateUpload', 'registerAbandonedUpload'].includes(checkpoint.manifestReducer) && manifest.uploads.length) {
		candidates.push(removeLast('uploads'));
	} else if (['registerDuplicateQueue', 'registerScheduledQueueCoordinate'].includes(checkpoint.manifestReducer) && manifest.queueRows.length) {
		candidates.push(removeLast('queueRows'));
	} else if (checkpoint.manifestReducer === 'registerRejectedUploadAndQueue' && manifest.uploads.length && manifest.queueRows.length) {
		candidates.push({ ...manifest, uploads: manifest.uploads.slice(0, -1), queueRows: manifest.queueRows.slice(0, -1) });
	}
	return candidates.filter((candidate) => serializedManifestHash(candidate) === expectedSha).length === 1;
}

/** @param {Record<string, any>} manifest @param {string} expectedSha */
function exactA10AtomicManifestDelta(manifest, expectedSha) {
	const matches = [];
	if (manifest.reports.length > 0 && manifest.uploads.length > 0) {
		const report = manifest.reports.at(-1);
		const upload = manifest.uploads.at(-1);
		const candidate = { ...manifest, reports: manifest.reports.slice(0, -1), uploads: manifest.uploads.slice(0, -1) };
		if (
			report?.actorRole === 'reporter' && upload?.actorRole === 'reporter' &&
			typeof upload?.objectPath === 'string' && upload.objectPath.endsWith(`/${upload.id}.webp`) &&
			serializedManifestHash(candidate) === expectedSha
		) matches.push('report-upload');
	}
	if (manifest.uploads.length > 0 && manifest.queueRows.length > 0) {
		const upload = manifest.uploads.at(-1);
		const queue = manifest.queueRows.at(-1);
		const candidate = { ...manifest, uploads: manifest.uploads.slice(0, -1), queueRows: manifest.queueRows.slice(0, -1) };
		if (
			upload?.actorRole === 'reporter' && queue?.uploadId === upload.id &&
			typeof upload?.objectPath === 'string' && upload.objectPath.endsWith(`/${upload.id}.webp`) &&
			serializedManifestHash(candidate) === expectedSha
		) matches.push('upload-queue');
	}
	return matches.length === 1 ? matches[0] : null;
}

/** @param {Record<string, any>} inspection */
function isPotentialA10AtomicManifestAhead(inspection) {
	const hostedTrust = (
		ownValue(inspection, 'hostedEvidenceAvailable') === true &&
		ownValue(inspection, 'ownershipConflict') === false &&
		ownValue(inspection, 'actors') === 4 &&
		ownValue(inspection, 'provisionVerified') === true
	) || (
		ownValue(inspection, 'hostedEvidenceAvailable') === false &&
		ownValue(inspection, 'ownershipConflict') === true &&
		ownValue(inspection, 'actors') === 0 &&
		ownValue(inspection, 'provisionVerified') === false
	);
	return (
		exactClassification(inspection) === 'AMBIGUOUS' &&
		ownValue(inspection, 'manifestBindingStatus') === 'unexplained-mismatch' &&
		ownValue(inspection, 'manifestAheadState') === false &&
		ownValue(inspection, 'manifestExactMatch') === false &&
		ownValue(inspection, 'manifestMatches') === false &&
		ownValue(inspection, 'manifestMismatch') === true &&
		ownValue(inspection, 'stateValid') === true &&
		ownValue(inspection, 'manifestValid') === true &&
		ownValue(inspection, 'authoritativeReleaseAvailable') === true &&
		ownValue(inspection, 'releaseMismatch') === false &&
		hostedTrust &&
		ownValue(inspection, 'credentialsLost') === false &&
		ownValue(inspection, 'duplicateRoles') === 0 &&
		ownValue(inspection, 'metadataMismatches') === 0 &&
		ownValue(inspection, 'actorIdentityConflicts') === 0 &&
		ownValue(inspection, 'scenarioVerified') === false &&
		ownValue(inspection, 'cleanupRequired') === false &&
		ownValue(inspection, 'cleanupPartial') === false &&
		ownValue(inspection, 'cleanupVerified') === false &&
		ownValue(inspection, 'archived') === false &&
		ownValue(inspection, 'ambiguous') === true
	);
}

/** @param {Record<string, any>} state @param {Buffer} stateBytes @param {Buffer} manifestBytes @param {Record<string, any>} inspection @param {Record<string, string>} paths */
function validateStableScenarioSnapshot(state, stateBytes, manifestBytes, inspection, paths) {
	const stateSha256 = bytesHash(stateBytes);
	const manifestSha256 = bytesHash(manifestBytes);
	const boundRelease = ownValue(inspection, 'boundReleaseCommitSha');
	const currentRelease = ownValue(inspection, 'currentReleaseCommitSha');
	if (
		state.runId !== paths.runId ||
		state.revision !== ownValue(inspection, 'stateRevision') ||
		stateSha256 !== ownValue(inspection, 'stateSha256') ||
		manifestSha256 !== ownValue(inspection, 'manifestSha256') ||
		state.target?.projectRef !== HOSTED_STAGING.projectRef ||
		state.target?.projectRef !== ownValue(inspection, 'projectRef') ||
		state.target?.workerOrigin !== HOSTED_STAGING.workerOrigin ||
		state.target?.workerOrigin !== ownValue(inspection, 'workerOrigin') ||
		typeof boundRelease !== 'string' ||
		state.target?.releaseCommitSha !== boundRelease ||
		currentRelease !== boundRelease ||
		state.manifest?.path !== paths.manifestPath
	) return null;
	return { stateSha256, manifestSha256, boundRelease };
}

/**
 * Exact owner for lock -> fresh inspect -> lifecycle authorization -> one boundary -> return.
 * @param {{ paths: Record<string, string>, inspectionAdapter: unknown, executionContext: unknown, dependencies?: Record<string, any> }} options
 */
export async function runScenarioCommand({
	paths,
	inspectionAdapter,
	executionContext,
	dependencies = {}
}) {
	if (!isPlainDataObject(paths) || typeof paths.runId !== 'string' || !RUN_ID_PATTERN.test(paths.runId)) {
		fail('scenario_precondition_failed', 10);
	}
	if (!isPlainDataObject(dependencies) || (process.env.NODE_ENV !== 'test' && Reflect.ownKeys(dependencies).length > 0)) {
		fail('scenario_precondition_failed', 10);
	}
	const acquire = dependency(dependencies, 'acquireRunLock', acquireRunLock);
	const release = dependency(dependencies, 'releaseRunLock', releaseRunLock);
	let acquiredLock;
	try {
		acquiredLock = await acquire({ paths, command: 'scenario' });
	} catch {
		fail('active_run_locked', 10);
	}
	let primaryError = null;
	let commandResult = null;
	const assertLockOwned = async () => {
		try {
			const inspectLock = dependency(dependencies, 'inspectRunLock', inspectRunLock);
			const held = await inspectLock({ paths });
			if (
				!isPlainDataObject(held) ||
				ownValue(held, 'status') !== 'held' ||
				ownValue(held, 'acquiredBytes') !== acquiredLock.acquiredBytes
			) {
				fail('run_lock_lost', 41);
			}
		} catch (error) {
			if (error && typeof error === 'object' && RUNNER_ERRORS.has(error)) throw error;
			fail('run_lock_lost', 41);
		}
	};
	try {
		await assertLockOwned();
		const inspect = dependency(dependencies, 'inspectRun', inspectGate3HostedRun);
		let inspection;
		try {
			inspection = await inspect({ paths, inspectionAdapter: canonicalScenarioInspectionAdapter(inspectionAdapter) });
		} catch {
				commandResult = blockedResult('AMBIGUOUS', null);
				return commandResult;
			}
			inspection = exactInspectionSnapshot(inspection);
			if (!inspection) {
				commandResult = blockedResult('AMBIGUOUS', null);
				return commandResult;
			}
			const classification = exactClassification(inspection);
			const revision = Number.isSafeInteger(ownValue(inspection, 'stateRevision')) ? ownValue(inspection, 'stateRevision') : null;
			let manifestAhead = isExactManifestAheadInspection(inspection);
			const potentialAtomicManifestAhead = isPotentialA10AtomicManifestAhead(inspection);
			if (['RELEASE_CHANGED', 'RECOVERY_REQUIRED'].includes(classification)) {
				commandResult = blockedResult(classification, revision);
				return commandResult;
			}
			if (classification === 'AMBIGUOUS' && !manifestAhead && !potentialAtomicManifestAhead) {
				commandResult = blockedResult('AMBIGUOUS', revision);
				return commandResult;
			}
			if (!['PROVISION_VERIFIED', 'SCENARIO_PARTIAL', 'SCENARIO_VERIFIED', 'AMBIGUOUS'].includes(classification)) {
				commandResult = blockedResult('AMBIGUOUS', revision);
				return commandResult;
			}
			await assertLockOwned();
			const capture = dependency(dependencies, 'readStableSnapshot', readStableGate3PreflightSnapshot);
			const captured = await capture(paths);
			const stateBytes = Buffer.from(captured.stateBytes);
			const manifestBytes = Buffer.from(captured.manifestBytes);
			if (Buffer.isBuffer(captured.secretBytes)) captured.secretBytes.fill(0);
			const state = JSON.parse(stateBytes.toString('utf8'));
			if (!isPlainDataObject(state) || JSON.stringify(state) !== JSON.stringify(captured.state)) {
				commandResult = blockedResult('AMBIGUOUS', revision);
				return commandResult;
			}
			const stable = validateStableScenarioSnapshot(state, stateBytes, manifestBytes, inspection, paths);
			if (
				!stable ||
				(!manifestAhead && !potentialAtomicManifestAhead && state.manifest?.sha256 !== stable.manifestSha256) ||
				((manifestAhead || potentialAtomicManifestAhead) && state.manifest?.sha256 === stable.manifestSha256)
			) {
				commandResult = blockedResult('AMBIGUOUS', revision);
				return commandResult;
			}
			let manifest;
			try {
				const parsed = JSON.parse(manifestBytes.toString('utf8'));
				manifest = validateHostedRunManifest(/** @type {any} */ (Object.freeze({ target: HOSTED_STAGING, runId: paths.runId })), parsed);
			} catch {
				commandResult = blockedResult('AMBIGUOUS', revision);
				return commandResult;
			}
			const atomicManifestDelta = potentialAtomicManifestAhead
				? exactA10AtomicManifestDelta(manifest, state.manifest.sha256)
				: null;
			if (potentialAtomicManifestAhead && atomicManifestDelta === null) {
				commandResult = blockedResult('AMBIGUOUS', revision);
				return commandResult;
			}
			if (atomicManifestDelta !== null) manifestAhead = true;
			if (classification === 'SCENARIO_VERIFIED') {
				commandResult = Object.freeze({ status: 'verified-noop', exitCode: 0, classification: 'SCENARIO_VERIFIED', revision });
				return commandResult;
			}
			const readCurrentManifest = dependency(dependencies, 'readManifestBytes', readFile);
			const beforeInspectionBytes = Buffer.from(await readCurrentManifest(paths.manifestPath));
			if (!beforeInspectionBytes.equals(manifestBytes)) {
				commandResult = blockedResult('AMBIGUOUS', revision);
				return commandResult;
			}
			const inspectionNonce = createHash('sha256').update(`${stable.stateSha256}:${stable.manifestSha256}:${paths.runId}:${revision}`).digest('hex');
			const checkpointObservedAfter = scenarioCheckpointLowerBound(state);
			let boundInspection = Object.freeze({
				...inspection,
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				manifestPath: paths.manifestPath,
				inspectionNonce,
				checkpointObservedAfter,
				...(atomicManifestDelta === null ? {} : {
					recognizedA10AtomicManifestAhead: true,
					a10AtomicManifestDelta: atomicManifestDelta
				})
			});
			const artifactCoordinates = Object.freeze({
				runId: paths.runId,
				projectRef: HOSTED_STAGING.projectRef,
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				workerOrigin: HOSTED_STAGING.workerOrigin,
				releaseCommitSha: stable.boundRelease,
				stateRevision: state.revision,
				stateSha256: stable.stateSha256,
				manifestPath: paths.manifestPath,
				manifestSha256: stable.manifestSha256,
				inspectionNonce,
				checkpointObservedAfter
			});
			let rawEvidence = ownValue(inspection, 'scenarioEvidence');
			let usedOperatorInspection = false;
			let trustedContextProbe = false;
			let checkpointProof = null;
			if (rawEvidence === undefined) {
				const deterministicInspect = ownValue(dependencies, 'inspectScenarioEvidence');
				if (typeof deterministicInspect === 'function') {
					try {
						rawEvidence = await deterministicInspect(Object.freeze({ state, manifest, coordinates: artifactCoordinates }));
						usedOperatorInspection = true;
					} catch {
						commandResult = blockedResult('AMBIGUOUS', revision);
						return commandResult;
					}
				} else {
					const completedCheckpointIds = Object.keys(state.scenarioCheckpoints ?? {}).map((key) => key.startsWith('scenario-') ? key.slice('scenario-'.length) : '');
					const probeEvidence = Object.freeze({
						completedCheckpointIds,
						hostedCheckpointId: null,
						manifestCheckpointId: null,
						...artifactCoordinates
					});
					const probe = selectNextScenarioProbe(boundInspection, A10_STEP_REGISTRY, probeEvidence);
					if (!probe) {
						commandResult = blockedResult('AMBIGUOUS', revision);
						return commandResult;
					}
					let observed;
					try {
						observed = await inspectHostedA10CheckpointEvidence(executionContext, Object.freeze({
							probe,
							manifestBytes
						}));
						trustedContextProbe = true;
					} catch {
						commandResult = blockedResult('AMBIGUOUS', revision);
						return commandResult;
					}
					const probeOutcome = isPlainDataObject(observed) ? ownValue(observed, 'outcome') : null;
					if (!['confirmed', 'confirmed-absent'].includes(probeOutcome)) {
						commandResult = outcomeResult('uncertain', 41, probe.checkpoint.id);
						return commandResult;
					}
					checkpointProof = ownValue(observed, 'checkpointProof') ?? null;
					rawEvidence = Object.freeze({
						completedCheckpointIds,
						hostedCheckpointId: probeOutcome === 'confirmed' ? probe.checkpoint.id : null,
						manifestCheckpointId: atomicManifestDelta !== null
							? null
							: manifestAhead ? probe.checkpoint.id : null
					});
					usedOperatorInspection = true;
				}
			}
			if (atomicManifestDelta !== null && trustedContextProbe) {
				boundInspection = Object.freeze({
					...boundInspection,
					hostedEvidenceAvailable: true,
					ownershipConflict: false,
					actors: 4,
					provisionVerified: true
				});
			}
			if (!isPlainDataObject(rawEvidence) || !hasExactOwnDataKeys(rawEvidence, ['completedCheckpointIds', 'hostedCheckpointId', 'manifestCheckpointId'])) {
				commandResult = blockedResult('AMBIGUOUS', revision);
				return commandResult;
			}
			const evidence = Object.freeze({
				completedCheckpointIds: ownValue(rawEvidence, 'completedCheckpointIds'),
				hostedCheckpointId: ownValue(rawEvidence, 'hostedCheckpointId'),
				manifestCheckpointId: ownValue(rawEvidence, 'manifestCheckpointId'),
				runId: paths.runId,
				projectRef: HOSTED_STAGING.projectRef,
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				workerOrigin: HOSTED_STAGING.workerOrigin,
				releaseCommitSha: stable.boundRelease,
				stateRevision: state.revision,
				stateSha256: stable.stateSha256,
				manifestPath: paths.manifestPath,
				manifestSha256: stable.manifestSha256,
				inspectionNonce,
				checkpointObservedAfter
			});
			const selected = selectNextScenarioStep(boundInspection, A10_STEP_REGISTRY, evidence);
			if (selected === null) {
				commandResult = blockedResult('AMBIGUOUS', revision);
				return commandResult;
			}
			if (manifestAhead && !hasCanonicalScenarioPredecessor(manifest, selected.checkpoint, state.manifest.sha256)) {
				commandResult = blockedResult('AMBIGUOUS', revision);
				return commandResult;
			}
			if (selected.checkpoint.id === 'abandoned-upload-backdated' && selected.mode === 'mutate' && checkpointProof === null && typeof ownValue(dependencies, 'bindCheckpointCapability') !== 'function') {
				const proofProbe = selectNextScenarioProbe(boundInspection, A10_STEP_REGISTRY, evidence);
				if (!proofProbe) {
					commandResult = outcomeResult('uncertain', 41, selected.checkpoint.id);
					return commandResult;
				}
				let proofObservation;
				try {
					proofObservation = await inspectHostedA10CheckpointEvidence(executionContext, Object.freeze({ probe: proofProbe, manifestBytes }));
				} catch {
					commandResult = outcomeResult('uncertain', 41, selected.checkpoint.id);
					return commandResult;
				}
				if (!isPlainDataObject(proofObservation) || ownValue(proofObservation, 'outcome') !== 'confirmed-absent') {
					commandResult = outcomeResult('uncertain', 41, selected.checkpoint.id);
					return commandResult;
				}
				checkpointProof = ownValue(proofObservation, 'checkpointProof') ?? null;
				if (checkpointProof === null) {
					commandResult = outcomeResult('uncertain', 41, selected.checkpoint.id);
					return commandResult;
				}
			}
			const beforeCapabilityBytes = usedOperatorInspection
				? Buffer.from(await readCurrentManifest(paths.manifestPath))
				: beforeInspectionBytes;
			if (!beforeCapabilityBytes.equals(manifestBytes)) {
				commandResult = blockedResult('AMBIGUOUS', revision);
				return commandResult;
			}
			let provider;
			try {
				const deterministicBind = ownValue(dependencies, 'bindCheckpointCapability');
				if (typeof deterministicBind === 'function') {
					provider = await deterministicBind(Object.freeze({ selected, manifest, manifestBytes }));
				} else {
					const grant = mintGate3ScenarioCapabilityGrant(selected, A10_STEP_REGISTRY, boundInspection, checkpointProof);
					if (!grant) fail('scenario_authorization_invalid', 10);
					provider = bindHostedA10CheckpointCapability(executionContext, Object.freeze({ grant, manifestBytes }));
				}
			} catch {
				fail('scenario_capability_invalid', 10);
			}
			/** @type {any} */
			let persistedManifest = manifest;
			let persistedManifestSha = stable.manifestSha256;
			const persistManifest = dependency(dependencies, 'persistManifest', persistHostedRunManifest);
			const writeState = dependency(dependencies, 'writeNextRunState', writeNextRunState);
			const now = dependency(dependencies, 'now', () => new Date().toISOString());
			const crashAt = ownValue(dependencies, 'crashAt');
			if (crashAt !== undefined && !['before-mutation', 'after-mutation-before-verification', 'after-verification-before-manifest', 'after-manifest-before-state'].includes(crashAt)) {
				fail('scenario_precondition_failed', 10);
			}
			const interruptAt = (/** @type {string} */ point) => {
				if (crashAt === point) fail('injected_scenario_crash', 41);
			};
			const providerMutation = provider.mutation;
			const composed = {
				roleCapability: provider.roleCapability,
				mutation:
					typeof providerMutation === 'function'
						? async () => {
							await assertLockOwned();
							interruptAt('before-mutation');
							const result = await providerMutation();
							interruptAt('after-mutation-before-verification');
							return result;
						}
						: null,
				readBack: async (/** @type {unknown} */ request) => {
					await assertLockOwned();
					const providerReadBack = provider.readBack;
					if (typeof providerReadBack !== 'function') fail('scenario_capability_invalid', 10);
					const result = await providerReadBack(/** @type {any} */ (request));
					interruptAt('after-verification-before-manifest');
					return result;
				},
				reduceManifest:
					typeof provider.reduceManifest === 'function'
						? (/** @type {unknown} */ manifestEvidence) => {
							const reduced = provider.reduceManifest(manifestEvidence);
							if (!isPlainDataObject(reduced)) fail('scenario_manifest_evidence_invalid', 41);
							if (selected.manifestState === 'ahead' && serializedManifestHash(reduced) !== stable.manifestSha256) {
								fail('scenario_manifest_evidence_invalid', 41);
							}
							return reduced;
						}
						: null,
				persistManifest:
					selected.checkpoint.kind === 'mutation' && selected.manifestState === 'exact'
						? async (/** @type {unknown} */ nextManifest) => {
							await assertLockOwned();
							persistedManifest = selected.checkpoint.manifestReducer === null ? manifest : nextManifest;
							if (!isPlainDataObject(persistedManifest)) fail('scenario_manifest_evidence_invalid', 41);
							persistedManifest = validateHostedRunManifest(/** @type {any} */ (Object.freeze({ target: HOSTED_STAGING, runId: paths.runId })), persistedManifest);
							await persistManifest(
								Object.freeze({ target: HOSTED_STAGING, runId: paths.runId }),
								persistedManifest,
								state.manifest.path
							);
							persistedManifestSha = serializedManifestHash(persistedManifest);
							interruptAt('after-manifest-before-state');
						}
						: null,
				persistState: async () => {
					await assertLockOwned();
					const observedAt = now();
					if (typeof observedAt !== 'string' || Number.isNaN(Date.parse(observedAt))) {
						fail('scenario_persistence_uncertain', 41);
					}
					await writeState(
						paths,
						state,
						nextScenarioState(state, selected.checkpoint, evidence.completedCheckpointIds, persistedManifestSha, observedAt)
					);
				}
			};
			commandResult = await runScenarioBoundary({ inspection: boundInspection, authorization: selected, capabilities: composed });
			return commandResult;
		} catch (error) {
			primaryError = error;
			if (error && typeof error === 'object' && RUNNER_ERRORS.has(error)) throw error;
			fail('scenario_precondition_failed', 10);
		} finally {
			let releaseFailed = false;
			try {
				const released = await release({ paths, acquiredLock });
				releaseFailed = released !== true;
			} catch {
				releaseFailed = true;
			}
			if (releaseFailed && primaryError === null && commandResult?.exitCode !== 41) {
				fail('run_lock_release_failed', 10);
			}
		}
}
