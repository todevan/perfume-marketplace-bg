const COMMANDS_BY_CLASSIFICATION = Object.freeze({
	PREFLIGHT_READY: Object.freeze(['inspect', 'provision']),
	PROVISION_PARTIAL: Object.freeze(['inspect', 'provision', 'cleanup']),
	PROVISION_VERIFIED: Object.freeze(['inspect', 'scenario', 'cleanup']),
	SCENARIO_PARTIAL: Object.freeze(['inspect', 'scenario', 'cleanup']),
	SCENARIO_VERIFIED: Object.freeze(['inspect', 'cleanup']),
	CLEANUP_REQUIRED: Object.freeze(['inspect', 'cleanup']),
	CLEANUP_PARTIAL: Object.freeze(['inspect', 'cleanup']),
	CLEANUP_VERIFIED: Object.freeze(['inspect', 'archive']),
	RECOVERY_REQUIRED: Object.freeze(['inspect', 'recover']),
	RELEASE_CHANGED: Object.freeze(['inspect']),
	AMBIGUOUS: Object.freeze(['inspect']),
	ARCHIVED: Object.freeze(['inspect'])
});

const NEXT_COMMAND_BY_CLASSIFICATION = Object.freeze({
	PREFLIGHT_READY: 'provision',
	PROVISION_PARTIAL: 'provision',
	PROVISION_VERIFIED: 'scenario',
	SCENARIO_PARTIAL: 'scenario',
	SCENARIO_VERIFIED: 'cleanup',
	CLEANUP_REQUIRED: 'cleanup',
	CLEANUP_PARTIAL: 'cleanup',
	CLEANUP_VERIFIED: 'archive',
	RECOVERY_REQUIRED: 'recover',
	RELEASE_CHANGED: 'inspect',
	AMBIGUOUS: 'inspect',
	ARCHIVED: 'inspect'
});

const PHASE_BY_COMMAND = Object.freeze({
	inspect: 'inspect',
	provision: 'provision',
	scenario: 'scenario',
	cleanup: 'cleanup',
	recover: 'recovery',
	archive: 'archive'
});

const REASON_BY_CLASSIFICATION = Object.freeze({
	PREFLIGHT_READY: 'preflight_ready',
	PROVISION_PARTIAL: 'provision_partial',
	PROVISION_VERIFIED: 'provision_verified',
	SCENARIO_PARTIAL: 'scenario_partial',
	SCENARIO_VERIFIED: 'scenario_verified',
	CLEANUP_REQUIRED: 'cleanup_required',
	CLEANUP_PARTIAL: 'cleanup_partial',
	CLEANUP_VERIFIED: 'cleanup_verified',
	RECOVERY_REQUIRED: 'recovery_required',
	RELEASE_CHANGED: 'release_changed',
	AMBIGUOUS: 'inspection_ambiguous',
	ARCHIVED: 'archived'
});

const CLEANUP_TARGET_KINDS = new Set([
	'auth-user',
	'pending-confirmation',
	'report',
	'upload',
	'storage-object',
	'queue-row'
]);
const SCENARIO_AUTHORIZATIONS = new WeakMap();
const SCENARIO_AUTHORIZATIONS_WITH_GRANT = new WeakSet();
const SCENARIO_CAPABILITY_GRANTS = new WeakMap();
const SCENARIO_PROBES = new WeakMap();

export const GATE3_EXIT_CODES = Object.freeze({
	success: 0,
	precondition: 10,
	AMBIGUOUS: 20,
	RELEASE_CHANGED: 21,
	RECOVERY_REQUIRED: 22,
	approvalDeclined: 30,
	confirmedNoMutation: 40,
	uncertainMutation: 41
});

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isExactDataObject(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) return false;
	try {
		const prototype = Object.getPrototypeOf(value);
		return prototype === Object.prototype || prototype === null;
	} catch {
		return false;
	}
}

/** @param {unknown} value */
function exactCompletedCheckpointIds(value) {
	if (!Array.isArray(value) || isProxy(value)) return null;
	try {
		const descriptors = /** @type {Record<PropertyKey, PropertyDescriptor>} */ (/** @type {unknown} */ (Object.getOwnPropertyDescriptors(value)));
		const keys = Reflect.ownKeys(descriptors);
		if (keys.some((key) => typeof key === 'symbol')) return null;
		const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
		if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) return null;
		const length = lengthDescriptor.value;
		if (keys.length !== length + 1) return null;
		const snapshot = [];
		for (let index = 0; index < length; index += 1) {
			const descriptor = descriptors[String(index)];
			if (
				!descriptor ||
				descriptor.enumerable !== true ||
				!Object.hasOwn(descriptor, 'value') ||
				typeof descriptor.value !== 'string'
			) return null;
			snapshot.push(descriptor.value);
		}
		return Object.freeze(snapshot);
	} catch {
		return null;
	}
}

/** @param {unknown} value */
function exactDenseFrozenArray(value) {
	if (!Array.isArray(value) || isProxy(value) || !Object.isFrozen(value)) return null;
	try {
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const keys = Reflect.ownKeys(descriptors);
		if (keys.some((key) => typeof key === 'symbol')) return null;
		const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
		if (
			!lengthDescriptor ||
			!Object.hasOwn(lengthDescriptor, 'value') ||
			!Number.isSafeInteger(lengthDescriptor.value) ||
			lengthDescriptor.value < 0 ||
			keys.length !== lengthDescriptor.value + 1
		) return null;
		const snapshot = [];
		for (let index = 0; index < lengthDescriptor.value; index += 1) {
			const descriptor = descriptors[String(index)];
			if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return null;
			snapshot.push(descriptor.value);
		}
		return Object.freeze(snapshot);
	} catch {
		return null;
	}
}

/** @param {Record<string, unknown>} value @param {string} key */
function exactOwnValue(value, key) {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true
			? descriptor.value
			: undefined;
	} catch {
		return undefined;
	}
}

/** @param {Record<string, unknown>} value @param {readonly string[]} keys */
function hasExactDataKeys(value, keys) {
	try {
		const ownKeys = Reflect.ownKeys(value);
		return (
			ownKeys.length === keys.length &&
			ownKeys.every((key) => typeof key === 'string' && keys.includes(key)) &&
			keys.every((key) => exactOwnValue(value, key) !== undefined)
		);
	} catch {
		return false;
	}
}

/**
 * Rebuilds untrusted scenario inspection data without evaluating any caller
 * code. Specialized scenario authorization never classifies the original
 * object because legacy classification intentionally uses direct properties.
 * @param {unknown} value
 */
function exactScenarioInspectionSnapshot(value) {
	if (!isExactDataObject(value)) return null;
	try {
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const keys = Reflect.ownKeys(descriptors);
		if (keys.some((key) => typeof key !== 'string')) return null;
		const snapshot = Object.create(null);
		for (const key of /** @type {string[]} */ (keys)) {
			const descriptor = descriptors[key];
			if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
			Object.defineProperty(snapshot, key, {
				value: descriptor.value,
				enumerable: true,
				writable: false,
				configurable: false
			});
		}
		return Object.freeze(snapshot);
	} catch {
		return null;
	}
}

/** @param {Record<string, unknown>} inspection */
function hasUnexplainedAmbiguity(inspection) {
	return (
		inspection.ambiguous === true ||
		inspection.stateCorrupt === true ||
		inspection.corruptState === true ||
		inspection.stateValid === false ||
		inspection.manifestMatches !== true ||
		inspection.manifestMismatch === true ||
		inspection.ownershipConflict !== false ||
		inspection.conflictingOwnership === true ||
		inspection.deletionScopeTrusted !== true ||
		inspection.untrustedDeletionScope === true ||
		inspection.authoritativeReleaseAvailable !== true ||
		inspection.authoritativeReleaseUnavailable === true ||
		inspection.credentialsLost === true && inspection.exactRecoveryProvenance !== true
	);
}

/** @param {Record<string, unknown>} inspection */
function hasProvenReleaseChange(inspection) {
	return inspection.releaseMismatch === true || inspection.releaseChanged === true;
}

/** @param {Record<string, unknown>} inspection */
function hasProvenRecoveryRequirement(inspection) {
	return inspection.credentialsLost === true && inspection.exactRecoveryProvenance === true;
}

/** @param {Record<string, unknown>} inspection */
function hasConflictingNormalEvidence(inspection) {
	const provisionVerified = inspection.provisionVerified === true && inspection.actors === 4;
	return (
		((inspection.scenarioPartial === true || inspection.scenarioVerified === true) && !provisionVerified) ||
		(inspection.scenarioPartial === true && inspection.scenarioVerified === true) ||
		(inspection.cleanupPartial === true && inspection.cleanupVerified === true) ||
		(inspection.cleanupRequired === true && inspection.cleanupVerified === true) ||
		(inspection.provisionVerified === true && inspection.actors !== 4)
	);
}

/** @param {Record<string, unknown>} inspection */
function normalClassification(inspection) {
	const actors = inspection.actors;
	if (hasConflictingNormalEvidence(inspection)) return 'AMBIGUOUS';
	if (inspection.cleanupVerified === true) return 'CLEANUP_VERIFIED';
	if (inspection.cleanupPartial === true) return 'CLEANUP_PARTIAL';
	if (inspection.cleanupRequired === true) return 'CLEANUP_REQUIRED';
	if (inspection.scenarioVerified === true) return 'SCENARIO_VERIFIED';
	if (inspection.scenarioPartial === true) return 'SCENARIO_PARTIAL';
	if (inspection.provisionVerified === true && actors === 4) return 'PROVISION_VERIFIED';
	if (typeof actors === 'number' && Number.isSafeInteger(actors) && actors >= 1 && actors <= 4) {
		return 'PROVISION_PARTIAL';
	}
	if (actors === 0) return 'PREFLIGHT_READY';
	return 'AMBIGUOUS';
}

/** @param {Record<string, unknown>} inspection */
function exactCleanupTarget(inspection) {
	if (!Array.isArray(inspection.residualArtifacts) || inspection.residualArtifacts.length !== 1) return null;
	const [target] = inspection.residualArtifacts;
	if (
		!isPlainObject(target) ||
		typeof target.kind !== 'string' ||
		!CLEANUP_TARGET_KINDS.has(target.kind) ||
		typeof target.id !== 'string' ||
		target.id.length === 0 ||
		target.id.includes('*')
	) {
		return null;
	}
	return Object.freeze({ kind: target.kind, id: target.id });
}

/** @param {keyof typeof PHASE_BY_COMMAND} command @param {{ kind: string, id: string } | null} [target] */
function boundary(command, target = null) {
	if (target === null) return Object.freeze({ command, phase: PHASE_BY_COMMAND[command] });
	return Object.freeze({ command, phase: PHASE_BY_COMMAND[command], target });
}

/** @param {keyof typeof COMMANDS_BY_CLASSIFICATION} classification @param {Record<string, unknown>} inspection */
function lifecycleResult(classification, inspection) {
	const nextCommand = NEXT_COMMAND_BY_CLASSIFICATION[classification];
	const target = nextCommand === 'cleanup' ? exactCleanupTarget(inspection) : null;
	const result = Object.freeze({
		classification,
		allowedCommands: COMMANDS_BY_CLASSIFICATION[classification],
		nextBoundary: nextCommand === 'cleanup' && target === null ? null : boundary(nextCommand, target),
		reasonCode: REASON_BY_CLASSIFICATION[classification],
		exitCodeKey: Object.hasOwn(GATE3_EXIT_CODES, classification) ? classification : 'success'
	});
	return result;
}

/**
 * Classifies an already-serialized Gate 3 inspection without performing any I/O or mutation.
 * @param {unknown} candidate
 */
export function classifyGate3Lifecycle(candidate) {
	if (!isPlainObject(candidate)) return lifecycleResult('AMBIGUOUS', {});
	if (candidate.archived === true) return lifecycleResult('ARCHIVED', candidate);
	if (hasUnexplainedAmbiguity(candidate)) return lifecycleResult('AMBIGUOUS', candidate);
	if (hasProvenReleaseChange(candidate)) return lifecycleResult('RELEASE_CHANGED', candidate);
	if (hasProvenRecoveryRequirement(candidate)) return lifecycleResult('RECOVERY_REQUIRED', candidate);
	return lifecycleResult(normalClassification(candidate), candidate);
}

/**
 * Recomputes one allow-listed boundary from inspection facts, or returns null when denied.
 * @param {unknown} inspection
 * @param {unknown} requestedCommand
 */
export function selectGate3NextBoundary(inspection, requestedCommand) {
	const lifecycle = classifyGate3Lifecycle(inspection);
	if (
		typeof requestedCommand !== 'string' ||
		!Object.hasOwn(PHASE_BY_COMMAND, requestedCommand)
	) {
		return null;
	}
	const classification = /** @type {keyof typeof COMMANDS_BY_CLASSIFICATION} */ (lifecycle.classification);
	const command = /** @type {keyof typeof PHASE_BY_COMMAND} */ (requestedCommand);
	const allowedCommands = COMMANDS_BY_CLASSIFICATION[classification];
	if (
		!Array.isArray(lifecycle.allowedCommands) ||
		lifecycle.allowedCommands.length !== allowedCommands.length ||
		lifecycle.allowedCommands.some((command, index) => command !== allowedCommands[index]) ||
		!allowedCommands.includes(command)
	) {
		return null;
	}
	if (command === 'cleanup') {
		const target = exactCleanupTarget(/** @type {Record<string, unknown>} */ (inspection));
		return target === null ? null : boundary('cleanup', target);
	}
	if (command !== 'inspect' && (!isPlainObject(lifecycle.nextBoundary) || lifecycle.nextBoundary.command !== command)) return null;
	return boundary(command);
}

/** @param {unknown} inspection */
export function selectNextProvisionStep(inspection) {
	return selectGate3NextBoundary(inspection, 'provision');
}

/** @param {Record<string, unknown>} exactInspection */
function isExactScenarioManifestAhead(exactInspection) {
	return Boolean(
		classifyGate3Lifecycle(exactInspection).classification === 'AMBIGUOUS' &&
		exactOwnValue(exactInspection, 'manifestBindingStatus') === 'manifest-ahead-state' &&
		exactOwnValue(exactInspection, 'manifestAheadState') === true &&
		exactOwnValue(exactInspection, 'manifestExactMatch') === false &&
		exactOwnValue(exactInspection, 'manifestMatches') === false &&
		exactOwnValue(exactInspection, 'manifestMismatch') === false &&
		exactOwnValue(exactInspection, 'stateValid') === true &&
		exactOwnValue(exactInspection, 'stateCorrupt') === false &&
		exactOwnValue(exactInspection, 'corruptState') === false &&
		exactOwnValue(exactInspection, 'manifestValid') === true &&
		exactOwnValue(exactInspection, 'authoritativeReleaseAvailable') === true &&
		exactOwnValue(exactInspection, 'authoritativeReleaseUnavailable') === false &&
		exactOwnValue(exactInspection, 'releaseMismatch') === false &&
		exactOwnValue(exactInspection, 'releaseChanged') === false &&
		exactOwnValue(exactInspection, 'hostedEvidenceAvailable') === true &&
		exactOwnValue(exactInspection, 'ownershipConflict') === false &&
		exactOwnValue(exactInspection, 'deletionScopeTrusted') === false &&
		exactOwnValue(exactInspection, 'cleanupCompleteContradiction') === false &&
		exactOwnValue(exactInspection, 'credentialsLost') === false &&
		exactOwnValue(exactInspection, 'exactRecoveryProvenance') === false &&
		exactOwnValue(exactInspection, 'duplicateRoles') === 0 &&
		exactOwnValue(exactInspection, 'metadataMismatches') === 0 &&
		exactOwnValue(exactInspection, 'actorIdentityConflicts') === 0 &&
		exactOwnValue(exactInspection, 'manifestActorsAbsent') === 0 &&
		exactOwnValue(exactInspection, 'hostedActorsManifestStale') === 0 &&
		exactOwnValue(exactInspection, 'actors') === 4 &&
		exactOwnValue(exactInspection, 'provisionVerified') === true &&
		exactOwnValue(exactInspection, 'scenarioVerified') === false &&
		exactOwnValue(exactInspection, 'cleanupRequired') === false &&
		exactOwnValue(exactInspection, 'cleanupPartial') === false &&
		exactOwnValue(exactInspection, 'cleanupVerified') === false &&
		exactOwnValue(exactInspection, 'archived') === false &&
		exactOwnValue(exactInspection, 'ambiguous') === true
	);
}

/** @param {unknown} inspection @param {unknown} [registry] @param {unknown} [suppliedEvidence] */
export function selectNextScenarioStep(inspection, registry, suppliedEvidence) {
	const exactInspection = exactScenarioInspectionSnapshot(inspection);
	if (!exactInspection) return null;
	const normalScenarioBoundary = selectGate3NextBoundary(exactInspection, 'scenario') !== null;
	const manifestAheadScenarioBoundary = Boolean(exactInspection && isExactScenarioManifestAhead(exactInspection));
	const atomicManifestAheadScenarioBoundary = Boolean(
		exactInspection &&
		classifyGate3Lifecycle(exactInspection).classification === 'AMBIGUOUS' &&
		exactOwnValue(exactInspection, 'manifestBindingStatus') === 'unexplained-mismatch' &&
		exactOwnValue(exactInspection, 'manifestAheadState') === false &&
		exactOwnValue(exactInspection, 'manifestExactMatch') === false &&
		exactOwnValue(exactInspection, 'manifestMatches') === false &&
		exactOwnValue(exactInspection, 'manifestMismatch') === true &&
		exactOwnValue(exactInspection, 'recognizedA10AtomicManifestAhead') === true &&
		['report-upload', 'upload-queue'].includes(String(exactOwnValue(exactInspection, 'a10AtomicManifestDelta'))) &&
		exactOwnValue(exactInspection, 'stateValid') === true &&
		exactOwnValue(exactInspection, 'stateCorrupt') === false &&
		exactOwnValue(exactInspection, 'corruptState') === false &&
		exactOwnValue(exactInspection, 'manifestValid') === true &&
		exactOwnValue(exactInspection, 'authoritativeReleaseAvailable') === true &&
		exactOwnValue(exactInspection, 'authoritativeReleaseUnavailable') === false &&
		exactOwnValue(exactInspection, 'releaseMismatch') === false &&
		exactOwnValue(exactInspection, 'releaseChanged') === false &&
		exactOwnValue(exactInspection, 'hostedEvidenceAvailable') === true &&
		exactOwnValue(exactInspection, 'ownershipConflict') === false &&
		exactOwnValue(exactInspection, 'deletionScopeTrusted') === false &&
		exactOwnValue(exactInspection, 'cleanupCompleteContradiction') === false &&
		exactOwnValue(exactInspection, 'credentialsLost') === false &&
		exactOwnValue(exactInspection, 'duplicateRoles') === 0 &&
		exactOwnValue(exactInspection, 'metadataMismatches') === 0 &&
		exactOwnValue(exactInspection, 'actorIdentityConflicts') === 0 &&
		exactOwnValue(exactInspection, 'manifestActorsAbsent') === 0 &&
		exactOwnValue(exactInspection, 'hostedActorsManifestStale') === 0 &&
		exactOwnValue(exactInspection, 'actors') === 4 &&
		exactOwnValue(exactInspection, 'provisionVerified') === true &&
		exactOwnValue(exactInspection, 'scenarioVerified') === false &&
		exactOwnValue(exactInspection, 'cleanupRequired') === false &&
		exactOwnValue(exactInspection, 'cleanupPartial') === false &&
		exactOwnValue(exactInspection, 'cleanupVerified') === false &&
		exactOwnValue(exactInspection, 'archived') === false &&
		exactOwnValue(exactInspection, 'ambiguous') === true
	);
	if (!normalScenarioBoundary && !manifestAheadScenarioBoundary && !atomicManifestAheadScenarioBoundary) return null;
	const registryEntries = exactDenseFrozenArray(registry);
	if (!registryEntries || registryEntries.length === 0) return null;
	/** @type {string[]} */
	const ids = [];
	for (let index = 0; index < registryEntries.length; index += 1) {
		const entry = registryEntries[index];
		if (!isExactDataObject(entry) || !Object.isFrozen(entry)) return null;
		const keys = Reflect.ownKeys(entry);
		const expectedKeys = [
			'id',
			'scenario',
			'kind',
			'prerequisiteIds',
			'roleCapability',
			'mutationMethod',
			'readBackMethod',
			'manifestReducer'
		];
		if (
			keys.length !== expectedKeys.length ||
			keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key)) ||
			expectedKeys.some((key) => exactOwnValue(entry, key) === undefined)
		) return null;
		const scenario = exactOwnValue(entry, 'scenario');
		const id = exactOwnValue(entry, 'id');
		const kind = exactOwnValue(entry, 'kind');
		const prerequisiteIds = exactDenseFrozenArray(exactOwnValue(entry, 'prerequisiteIds'));
		const roleCapability = exactOwnValue(entry, 'roleCapability');
		const mutationMethod = exactOwnValue(entry, 'mutationMethod');
		const readBackMethod = exactOwnValue(entry, 'readBackMethod');
		const manifestReducer = exactOwnValue(entry, 'manifestReducer');
		if (
			typeof id !== 'string' ||
			!/^[a-z][a-z0-9-]{2,79}$/u.test(id) ||
			ids.includes(id) ||
			typeof scenario !== 'number' ||
			!Number.isSafeInteger(scenario) ||
			scenario < 1 ||
			scenario > 10 ||
			!['mutation', 'verification'].includes(String(kind)) ||
			prerequisiteIds === null ||
			prerequisiteIds.length !== (index === 0 ? 0 : 1) ||
			(index > 0 && prerequisiteIds[0] !== ids[index - 1]) ||
			typeof roleCapability !== 'string' ||
			!/^[a-z][a-z0-9-]{2,79}$/u.test(roleCapability) ||
			(kind === 'mutation') !== (typeof mutationMethod === 'string') ||
			(kind === 'verification' && mutationMethod !== null) ||
			typeof readBackMethod !== 'string' ||
			!/^[_a-zA-Z][_a-zA-Z0-9]{2,79}$/u.test(readBackMethod) ||
			!(manifestReducer === null || typeof manifestReducer === 'string')
		) {
			return null;
		}
		ids.push(id);
	}
	if (!exactInspection) return null;
	const evidenceDescriptor = Object.getOwnPropertyDescriptor(inspection, 'scenarioEvidence');
	const evidence = suppliedEvidence === undefined
		? evidenceDescriptor && Object.hasOwn(evidenceDescriptor, 'value')
			? evidenceDescriptor.value
			: null
		: suppliedEvidence;
	if (!isExactDataObject(evidence)) return null;
	const evidenceKeys = Reflect.ownKeys(evidence);
	const expectedEvidenceKeys = [
		'completedCheckpointIds',
		'hostedCheckpointId',
		'manifestCheckpointId',
		'runId',
		'projectRef',
		'supabaseUrl',
		'workerOrigin',
		'releaseCommitSha',
		'stateRevision',
		'stateSha256',
		'manifestPath',
		'manifestSha256',
		'inspectionNonce',
		'checkpointObservedAfter'
	];
	const evidenceRecord = /** @type {Record<string, unknown>} */ (evidence);
	const evidenceRevision = exactOwnValue(evidenceRecord, 'stateRevision');
	const completed = exactCompletedCheckpointIds(exactOwnValue(evidenceRecord, 'completedCheckpointIds'));
	if (
		evidenceKeys.length !== expectedEvidenceKeys.length ||
		evidenceKeys.some((key) => typeof key !== 'string' || !expectedEvidenceKeys.includes(key)) ||
		completed === null ||
		typeof evidenceRevision !== 'number' ||
		!Number.isSafeInteger(evidenceRevision) ||
		evidenceRevision < 0
	) {
		return null;
	}
	const coordinatePairs = [
		['runId', 'runId'],
		['projectRef', 'projectRef'],
		['supabaseUrl', 'supabaseUrl'],
		['workerOrigin', 'workerOrigin'],
		['releaseCommitSha', 'boundReleaseCommitSha'],
		['releaseCommitSha', 'currentReleaseCommitSha'],
		['stateRevision', 'stateRevision'],
		['stateSha256', 'stateSha256'],
		['manifestPath', 'manifestPath'],
		['manifestSha256', 'manifestSha256'],
		['inspectionNonce', 'inspectionNonce'],
		['checkpointObservedAfter', 'checkpointObservedAfter']
	];
	if (coordinatePairs.some(([evidenceKey, inspectionKey]) =>
		exactOwnValue(evidenceRecord, evidenceKey) !== exactOwnValue(exactInspection, inspectionKey))) return null;
	if (
		completed.length >= registryEntries.length ||
		completed.some((id, index) => id !== ids[index])
	) {
		return null;
	}
	const checkpoint = registryEntries[completed.length];
	if (atomicManifestAheadScenarioBoundary) {
		const delta = exactOwnValue(exactInspection, 'a10AtomicManifestDelta');
		if (
			(delta === 'report-upload' && checkpoint.manifestReducer !== 'registerPrimaryReport') ||
			(delta === 'upload-queue' && checkpoint.manifestReducer !== 'registerRejectedUploadAndQueue')
		) return null;
	}
	const hosted = exactOwnValue(evidenceRecord, 'hostedCheckpointId');
	const manifested = exactOwnValue(evidenceRecord, 'manifestCheckpointId');
	if (
		!(hosted === null || hosted === checkpoint.id) ||
		!(manifested === null || manifested === checkpoint.id) ||
		(manifested !== null && hosted !== manifested)
	) {
		return null;
	}
	if (manifestAheadScenarioBoundary && (hosted !== checkpoint.id || manifested !== checkpoint.id)) return null;
	if (atomicManifestAheadScenarioBoundary && (hosted !== checkpoint.id || manifested !== null)) return null;
	const coordinates = Object.freeze(Object.fromEntries(
		['runId', 'projectRef', 'supabaseUrl', 'workerOrigin', 'releaseCommitSha', 'stateRevision', 'stateSha256', 'manifestPath', 'manifestSha256', 'inspectionNonce', 'checkpointObservedAfter']
			.map((key) => [key, exactOwnValue(evidenceRecord, key)])
	));
	const authorization = Object.freeze({
		command: 'scenario',
		phase: 'scenario',
		checkpoint,
		mode: hosted === checkpoint.id ? 'reconcile' : 'mutate',
		revision: evidenceRevision,
		manifestState: manifested === checkpoint.id || atomicManifestAheadScenarioBoundary ? 'ahead' : 'exact',
		coordinates
	});
	SCENARIO_AUTHORIZATIONS.set(authorization, Object.freeze({ registry, inspection }));
	return authorization;
}

/**
 * Selects the same canonical entry as final authorization but immediately
 * consumes the mutation authorization and returns only inert read-probe data.
 * The caller cannot mutate with this value.
 * @param {unknown} inspection @param {unknown} registry @param {unknown} suppliedEvidence
 */
export function selectNextScenarioProbe(inspection, registry, suppliedEvidence) {
	const originalInspection = isExactDataObject(inspection) ? /** @type {Record<string, unknown>} */ (inspection) : null;
	const originalManifestAhead = inspection && typeof inspection === 'object' && (
		exactOwnValue(/** @type {Record<string, unknown>} */ (inspection), 'manifestAheadState') === true ||
		exactOwnValue(/** @type {Record<string, unknown>} */ (inspection), 'recognizedA10AtomicManifestAhead') === true
	);
	let authorizationInspection = inspection;
	let authorization = selectNextScenarioStep(inspection, registry, suppliedEvidence);
	if (!authorization) {
		const exact = exactScenarioInspectionSnapshot(inspection);
		if (exact && (exactOwnValue(exact, 'recognizedA10AtomicManifestAhead') === true || isExactScenarioManifestAhead(exact))) {
			const probeInspection = Object.freeze({
				...exact,
				manifestBindingStatus: 'exact',
				manifestExactMatch: true,
				manifestAheadState: false,
				manifestMatches: true,
				manifestMismatch: false,
				deletionScopeTrusted: true,
				ambiguous: false,
				hostedEvidenceAvailable: true,
				ownershipConflict: false,
				actors: 4,
				provisionVerified: true
			});
			authorization = selectNextScenarioStep(probeInspection, registry, suppliedEvidence);
			authorizationInspection = probeInspection;
		}
	}
	if (!authorization || !consumeGate3ScenarioAuthorization(authorization, registry, authorizationInspection)) return null;
	const probe = Object.freeze({
		checkpoint: authorization.checkpoint,
		revision: authorization.revision,
		coordinates: authorization.coordinates
	});
	SCENARIO_PROBES.set(probe, Object.freeze({
		checkpoint: authorization.checkpoint,
		coordinates: authorization.coordinates,
		manifestState: originalManifestAhead || originalInspection && (
			exactOwnValue(originalInspection, 'recognizedA10AtomicManifestAhead') === true ||
			exactOwnValue(originalInspection, 'manifestBindingStatus') === 'manifest-ahead-state' ||
			isExactScenarioManifestAhead(originalInspection)
		)
			? 'ahead'
			: authorization.manifestState
	}));
	return probe;
}

/** @param {unknown} probe */
export function consumeGate3ScenarioProbe(probe) {
	if (!isExactDataObject(probe)) return null;
	const trusted = SCENARIO_PROBES.get(probe);
	if (!trusted) return null;
	SCENARIO_PROBES.delete(probe);
	return trusted;
}

/**
 * Mints one opaque, one-shot grant for the exact lifecycle authorization. The
 * grant exposes no checkpoint choice or mutation method to its caller.
 * @param {unknown} authorization @param {unknown} registry @param {unknown} inspection @param {unknown} [checkpointProof]
 */
export function mintGate3ScenarioCapabilityGrant(authorization, registry, inspection, checkpointProof = null) {
	if (!isExactDataObject(authorization)) return null;
	const trusted = SCENARIO_AUTHORIZATIONS.get(authorization);
	if (
		!trusted ||
		trusted.registry !== registry ||
		trusted.inspection !== inspection ||
		SCENARIO_AUTHORIZATIONS_WITH_GRANT.has(authorization)
	) return null;
	SCENARIO_AUTHORIZATIONS_WITH_GRANT.add(authorization);
	const grant = Object.freeze(Object.create(null));
	SCENARIO_CAPABILITY_GRANTS.set(grant, Object.freeze({
		checkpoint: exactOwnValue(authorization, 'checkpoint'),
		mode: exactOwnValue(authorization, 'mode'),
		manifestState: exactOwnValue(authorization, 'manifestState'),
		coordinates: exactOwnValue(authorization, 'coordinates'),
		checkpointProof
	}));
	return grant;
}

/** @param {unknown} grant */
export function consumeGate3ScenarioCapabilityGrant(grant) {
	if (!isExactDataObject(grant)) return null;
	const trusted = SCENARIO_CAPABILITY_GRANTS.get(grant);
	if (!trusted) return null;
	SCENARIO_CAPABILITY_GRANTS.delete(grant);
	return trusted;
}

/**
 * One-shot proof that an opaque authorization was created by this lifecycle
 * module for the exact registry identity supplied by the runner.
 * @param {unknown} authorization
 * @param {unknown} registry
 * @param {unknown} inspection
 */
export function consumeGate3ScenarioAuthorization(authorization, registry, inspection) {
	const trusted = isExactDataObject(authorization) ? SCENARIO_AUTHORIZATIONS.get(authorization) : null;
	if (!trusted || trusted.registry !== registry || trusted.inspection !== inspection) return false;
	SCENARIO_AUTHORIZATIONS.delete(/** @type {object} */ (authorization));
	return true;
}

/** @param {unknown} inspection */
export function selectNextCleanupStep(inspection) {
	return selectGate3NextBoundary(inspection, 'cleanup');
}
import { isProxy } from 'node:util/types';
