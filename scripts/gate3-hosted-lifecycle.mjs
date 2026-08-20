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

const CLASSIFICATIONS = new Set(Object.keys(COMMANDS_BY_CLASSIFICATION));
const CANONICAL_LIFECYCLES = new WeakSet();
const CLEANUP_TARGET_KINDS = new Set([
	'auth-user',
	'pending-confirmation',
	'report',
	'upload',
	'storage-object',
	'queue-row'
]);

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
	CANONICAL_LIFECYCLES.add(result);
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
 * Returns one allow-listed boundary for an approved lifecycle command, or null when denied.
 * @param {unknown} lifecycle
 * @param {unknown} requestedCommand
 */
export function selectGate3NextBoundary(lifecycle, requestedCommand) {
	if (
		!isPlainObject(lifecycle) ||
		!CANONICAL_LIFECYCLES.has(lifecycle) ||
		typeof lifecycle.classification !== 'string' ||
		!CLASSIFICATIONS.has(lifecycle.classification) ||
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
	if (
		command === 'cleanup' &&
		isPlainObject(lifecycle.nextBoundary) &&
		lifecycle.nextBoundary.command === 'cleanup'
	) {
		const target = isPlainObject(lifecycle.nextBoundary.target) ? lifecycle.nextBoundary.target : null;
		if (
			target !== null &&
			typeof target.kind === 'string' &&
			CLEANUP_TARGET_KINDS.has(target.kind) &&
			typeof target.id === 'string' &&
			!target.id.includes('*')
		) {
			return boundary('cleanup', Object.freeze({ kind: target.kind, id: target.id }));
		}
		return null;
	}
	if (command !== 'inspect' && (!isPlainObject(lifecycle.nextBoundary) || lifecycle.nextBoundary.command !== command)) return null;
	return boundary(command);
}
