import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
	GATE3_PROJECT_REF,
	GATE3_WORKER_ORIGIN,
	readArchivedRunState,
	readRunState
} from './gate3-hosted-state.mjs';
import { deriveSyntheticIdentity } from './gate3-hosted-secrets.mjs';
import { classifyGate3Lifecycle } from './gate3-hosted-lifecycle.mjs';
import {
	loadHostedRunManifest,
	validateHostedRunManifest
} from './hosted-report-evidence-operator.mjs';

const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ACTOR_ROLES = Object.freeze([
	'reporter',
	'cross-user',
	'assigned-moderator',
	'unassigned-moderator'
]);
const COUNT_FIELDS = Object.freeze([
	'actors',
	'sessions',
	'mfaFactors',
	'profiles',
	'reports',
	'uploads',
	'objects',
	'queueRows'
]);
const FOREIGN_COUNT_FIELDS = Object.freeze([
	'syntheticAccounts',
	'profiles',
	'reports',
	'uploads',
	'objects',
	'queueRows'
]);

export class Gate3HostedInspectorError extends Error {
	/** @param {string} reasonCode */
	constructor(reasonCode) {
		super(reasonCode);
		this.name = 'Gate3HostedInspectorError';
		this.reasonCode = reasonCode;
	}
}

/**
 * Resolves the deployed release exclusively from the fixed staging Worker
 * response header. Response bodies and redirects are never trusted as release
 * evidence.
 *
 * @param {{ workerOrigin: string, fetchImpl?: typeof fetch }} options
 */
export async function resolveDeployedRelease({ workerOrigin, fetchImpl = fetch }) {
	if (workerOrigin !== GATE3_WORKER_ORIGIN) {
		throw new Gate3HostedInspectorError('worker_origin_invalid');
	}

	let response;
	try {
		response = await fetchImpl(workerOrigin, {
			method: 'GET',
			redirect: 'error',
			headers: { accept: 'text/html' }
		});
	} catch {
		throw new Gate3HostedInspectorError('release_evidence_unavailable');
	}
	if (!response.ok) throw new Gate3HostedInspectorError('release_evidence_unavailable');

	const releaseCommitSha = response.headers.get('x-deployed-git-sha') ?? '';
	if (!RELEASE_SHA_PATTERN.test(releaseCommitSha)) {
		throw new Gate3HostedInspectorError('release_evidence_invalid');
	}
	return releaseCommitSha;
}

/** @param {unknown} value */
function safeCount(value) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new Gate3HostedInspectorError('hosted_evidence_invalid');
	}
	return value;
}

/** @param {unknown} value */
function sanitizeHostedFacts(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Gate3HostedInspectorError('hosted_evidence_invalid');
	}
	const candidate = /** @type {Record<string, any>} */ (value);
	const counts = Object.fromEntries(
		COUNT_FIELDS.map((field) => [field, safeCount(candidate.counts?.[field])])
	);
	const foreignCounts = Object.fromEntries(
		FOREIGN_COUNT_FIELDS.map((field) => [field, safeCount(candidate.foreignCounts?.[field])])
	);
	const roleCounts = Object.fromEntries(
		ACTOR_ROLES.map((role) => [role, safeCount(candidate.roleCounts?.[role])])
	);
	const foreignEvidenceSha256 = candidate.foreignEvidenceSha256;
	if (typeof foreignEvidenceSha256 !== 'string' || !SHA256_PATTERN.test(foreignEvidenceSha256)) {
		throw new Gate3HostedInspectorError('hosted_evidence_invalid');
	}
	return Object.freeze({
		counts: Object.freeze(counts),
		foreignCounts: Object.freeze(foreignCounts),
		roleCounts: Object.freeze(roleCounts),
		duplicateRoles: safeCount(candidate.duplicateRoles),
		metadataMismatches: safeCount(candidate.metadataMismatches),
		manifestActorsAbsent: safeCount(candidate.manifestActorsAbsent),
		actorIdentityConflicts: safeCount(candidate.actorIdentityConflicts),
		hostedActorsManifestStale: safeCount(candidate.hostedActorsManifestStale),
		confirmedActors: safeCount(candidate.confirmedActors),
		completeProfiles: safeCount(candidate.completeProfiles),
		verifiedModeratorTotpFactors: safeCount(candidate.verifiedModeratorTotpFactors),
		moderatorsWithVerifiedTotp: safeCount(candidate.moderatorsWithVerifiedTotp),
		actorsWithActiveSessions: safeCount(candidate.actorsWithActiveSessions),
		activeSessionsProven: candidate.activeSessionsProven === true,
		scenarioVerified: candidate.scenarioVerified === true,
		scenarioPartial: candidate.scenarioPartial === true,
		foreignEvidenceSha256
	});
}

function emptyHostedFacts() {
	return sanitizeHostedFacts({
		counts: Object.fromEntries(COUNT_FIELDS.map((field) => [field, 0])),
		foreignCounts: Object.fromEntries(FOREIGN_COUNT_FIELDS.map((field) => [field, 0])),
		roleCounts: Object.fromEntries(ACTOR_ROLES.map((role) => [role, 0])),
		duplicateRoles: 0,
		metadataMismatches: 0,
		manifestActorsAbsent: 0,
		actorIdentityConflicts: 0,
		hostedActorsManifestStale: 0,
		confirmedActors: 0,
		completeProfiles: 0,
		verifiedModeratorTotpFactors: 0,
		moderatorsWithVerifiedTotp: 0,
		actorsWithActiveSessions: 0,
		activeSessionsProven: false,
		scenarioVerified: false,
		scenarioPartial: false,
		foreignEvidenceSha256: createHash('sha256').update('').digest('hex')
	});
}

/** @param {unknown} value @param {string} runId */
function isExactIdentitySet(value, runId) {
	if (!Array.isArray(value) || value.length !== ACTOR_ROLES.length) return false;
	return ACTOR_ROLES.every((role) => {
		const expected = deriveSyntheticIdentity({ runId, role, identitySchemeVersion: 1 });
		return value.filter(
			(candidate) =>
				candidate &&
				typeof candidate === 'object' &&
				!Array.isArray(candidate) &&
				Object.keys(candidate).length === 3 &&
				Object.hasOwn(candidate, 'role') &&
				Object.hasOwn(candidate, 'email') &&
				Object.hasOwn(candidate, 'username') &&
				candidate.role === expected.role &&
				candidate.email === expected.email &&
				candidate.username === expected.username
		).length === 1;
	});
}

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

/** @param {unknown} adapter */
function assertReadOnlyInspectionAdapter(adapter) {
	if (
		!adapter ||
		typeof adapter !== 'object' ||
		Object.getPrototypeOf(adapter) !== Object.prototype ||
		Reflect.ownKeys(adapter).length !== 1 ||
		Reflect.ownKeys(adapter)[0] !== 'inspectRun' ||
		typeof /** @type {{ inspectRun?: unknown }} */ (adapter).inspectRun !== 'function'
	) {
		throw new Gate3HostedInspectorError('inspection_adapter_not_read_only');
	}
}

/** @param {Buffer | Uint8Array} bytes */
function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/** @param {Record<string, any>} manifest */
function serializedManifestSha256(manifest) {
	return sha256(Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8'));
}

/** @param {Record<string, any>} manifest */
function emptyManifest(manifest) {
	return ['pendingActors', 'actors', 'reports', 'uploads', 'queueRows'].every(
		(field) => Array.isArray(manifest[field]) && manifest[field].length === 0
	);
}

/** @param {Record<string, any>} manifest @param {string} expectedSha256 */
function isOneStepManifestAhead(manifest, expectedSha256) {
	/** @type {Array<Record<string, any>>} */
	const predecessors = [];
	for (const field of ['pendingActors', 'reports', 'uploads', 'queueRows']) {
		if (manifest[field].length > 0) {
			predecessors.push({ ...manifest, [field]: manifest[field].slice(0, -1) });
		}
	}
	if (manifest.actors.length > 0) {
		const actor = manifest.actors.at(-1);
		predecessors.push({ ...manifest, actors: manifest.actors.slice(0, -1) });
		predecessors.push({
			...manifest,
			pendingActors: [
				...manifest.pendingActors,
				{ role: actor.role, provisioningAttemptId: manifest.provisioningAttemptId }
			],
			actors: manifest.actors.slice(0, -1)
		});
	}
	return predecessors.some((candidate) => serializedManifestSha256(candidate) === expectedSha256);
}

/** @param {Record<string, string>} paths @param {Record<string, any>} dependencies */
async function readSelectedState(paths, dependencies) {
	const readActive = dependencies.readRunState ?? readRunState;
	const readArchived = dependencies.readArchivedRunState ?? readArchivedRunState;
	try {
		return { state: await readActive(paths), archivedSource: false };
	} catch (activeError) {
		try {
			await (dependencies.lstat ?? lstat)(paths.runDirectory);
			throw activeError;
		} catch (pathError) {
			const pathErrorCode =
				pathError && typeof pathError === 'object' && 'code' in pathError
					? pathError.code
					: null;
			if (pathError === activeError || pathErrorCode !== 'ENOENT') throw activeError;
		}
		return { state: await readArchived(paths), archivedSource: true };
	}
}

/**
 * Reads the exact persisted Gate 3 run and correlated hosted evidence without
 * mutating either side. Unknown adapter fields are discarded by an allow-list
 * before the result can be logged or serialized.
 *
 * @param {{
 *   paths: Record<string, string>,
 *   inspectionAdapter: { inspectRun: (scope: Record<string, unknown>) => Promise<unknown> },
 *   fetchImpl?: typeof fetch,
 *   dependencies?: Record<string, any>
 * }} options
 * @returns {Promise<Record<string, any>>}
 */
export async function inspectGate3HostedRun({
	paths,
	inspectionAdapter,
	fetchImpl = fetch,
	dependencies = {}
}) {
	assertReadOnlyInspectionAdapter(inspectionAdapter);
	let selected;
	try {
		selected = await readSelectedState(paths, dependencies);
	} catch {
		return deepFreeze({
			runId:
				typeof paths?.runId === 'string' && /^gate3-\d{8}-[a-f0-9]{8}$/u.test(paths.runId)
					? paths.runId
					: 'unavailable',
			projectRef: GATE3_PROJECT_REF,
			workerOrigin: GATE3_WORKER_ORIGIN,
			stateValid: false,
			stateCorrupt: true,
			corruptState: true,
			manifestValid: false,
			manifestMatches: false,
			manifestMismatch: false,
			authoritativeReleaseAvailable: false,
			authoritativeReleaseUnavailable: true,
			ownershipConflict: true,
			deletionScopeTrusted: false,
			ambiguous: true,
			classification: 'AMBIGUOUS',
			archived: false,
			counts: emptyHostedFacts().counts,
			foreignCounts: emptyHostedFacts().foreignCounts,
			reasonCode: 'state_invalid'
		});
	}

	const state = selected.state;
	const archived = selected.archivedSource || state.archive?.status === 'complete';
	const statePath = selected.archivedSource
		? join(paths.archiveDirectory, basename(paths.statePath))
		: paths.statePath;
	let stateSha256;
	try {
		const stateBytes = await (dependencies.readFile ?? readFile)(statePath);
		stateSha256 = sha256(stateBytes);
		if (JSON.stringify(JSON.parse(stateBytes.toString('utf8'))) !== JSON.stringify(state)) {
			throw new Error('state changed');
		}
	} catch {
		return deepFreeze({
			runId: state.runId,
			projectRef: GATE3_PROJECT_REF,
			workerOrigin: GATE3_WORKER_ORIGIN,
			stateValid: false,
			stateCorrupt: true,
			corruptState: true,
			manifestValid: false,
			manifestMatches: false,
			manifestMismatch: false,
			authoritativeReleaseAvailable: false,
			authoritativeReleaseUnavailable: true,
			ownershipConflict: true,
			deletionScopeTrusted: false,
			ambiguous: true,
			classification: 'AMBIGUOUS',
			archived,
			counts: emptyHostedFacts().counts,
			foreignCounts: emptyHostedFacts().foreignCounts,
			reasonCode: 'state_changed'
		});
	}

	const manifestPath = selected.archivedSource
		? join(paths.archiveDirectory, basename(paths.manifestPath))
		: paths.manifestPath;
	let manifest = null;
	let manifestSha256 = null;
	let manifestValid = false;
	try {
		const manifestBytes = await (dependencies.readFile ?? readFile)(manifestPath);
		manifestSha256 = sha256(manifestBytes);
		const loadManifest = dependencies.loadHostedRunManifest ?? loadHostedRunManifest;
		manifest = await loadManifest(
			{ target: { projectRef: GATE3_PROJECT_REF }, runId: state.runId },
			manifestPath
		);
		const after = await (dependencies.readFile ?? readFile)(manifestPath);
		if (!Buffer.from(manifestBytes).equals(Buffer.from(after))) throw new Error('manifest changed');
		manifestValid = true;
	} catch {
		manifest = null;
	}
	const manifestExactMatch = Boolean(
		manifestValid &&
		state.manifest.sha256 !== null &&
		state.manifest.sha256 === manifestSha256
	);
	const unboundEmptyBaseline = Boolean(
		manifestValid &&
		state.revision === 0 &&
		state.manifest.sha256 === null &&
		emptyManifest(manifest)
	);
	const manifestAheadState = Boolean(
		manifestValid &&
		state.manifest.sha256 !== null &&
		state.manifest.sha256 !== manifestSha256 &&
		isOneStepManifestAhead(manifest, state.manifest.sha256)
	);
	const manifestMismatch = Boolean(
		manifestValid && !manifestExactMatch && !unboundEmptyBaseline && !manifestAheadState
	);
	const manifestMatches = manifestExactMatch;
	const manifestInspectable = manifestExactMatch || unboundEmptyBaseline || manifestAheadState;
	const manifestBindingStatus = manifestExactMatch
		? 'exact'
		: unboundEmptyBaseline
			? 'unbound-empty-baseline'
			: manifestAheadState
				? 'manifest-ahead-state'
				: 'unexplained-mismatch';

	let currentReleaseCommitSha = null;
	let authoritativeReleaseAvailable = false;
	try {
		currentReleaseCommitSha = await resolveDeployedRelease({
			workerOrigin: state.target.workerOrigin,
			fetchImpl
		});
		authoritativeReleaseAvailable = true;
	} catch {
		// A diagnostic result records only the sanitized availability fact.
	}
	const releaseMismatch = Boolean(
		authoritativeReleaseAvailable && currentReleaseCommitSha !== state.target.releaseCommitSha
	);

	let secretStoreStatus = state.secretStore.status;
	let secretStoreCiphertextSha256 = null;
	let credentialsLost = false;
	try {
		const secretPath = selected.archivedSource
			? join(paths.archiveDirectory, basename(paths.secretPath))
			: paths.secretPath;
		const ciphertext = await (dependencies.readFile ?? readFile)(secretPath);
		secretStoreCiphertextSha256 = sha256(ciphertext);
		if (
			!['available', 'persisted'].includes(state.secretStore.status) ||
			state.secretStore.ciphertextSha256 === null ||
			state.secretStore.ciphertextSha256 !== secretStoreCiphertextSha256
		) {
			secretStoreStatus = 'corrupt';
			credentialsLost = true;
		} else {
			secretStoreStatus = state.secretStore.status;
		}
	} catch {
		if (['available', 'persisted'].includes(state.secretStore.status)) {
			secretStoreStatus = 'missing';
			credentialsLost = true;
		} else if (state.secretStore.status === 'destroyed-after-cleanup') {
			secretStoreStatus = 'destroyed-after-cleanup';
		} else {
			secretStoreStatus = 'missing';
		}
	}

	let hosted = emptyHostedFacts();
	let hostedEvidenceAvailable = false;
	if (manifestInspectable && typeof inspectionAdapter?.inspectRun === 'function') {
		try {
			const expectedIdentities = ACTOR_ROLES.map((role) =>
				deriveSyntheticIdentity({
					runId: state.runId,
					role,
					identitySchemeVersion: state.identitySchemeVersion
				})
			);
			hosted = sanitizeHostedFacts(
				await inspectionAdapter.inspectRun({
					runId: state.runId,
					createdAfter: state.createdAt,
					manifest,
					expectedIdentities,
					scenarioEvidence: {
						phase: state.phases.scenario,
						checkpoints: state.scenarioCheckpoints
					}
				})
			);
			hostedEvidenceAvailable = true;
		} catch {
			// Provider failures are deliberately collapsed to a safe availability fact.
		}
	}

	const ownershipConflict =
		!hostedEvidenceAvailable ||
		hosted.duplicateRoles > 0 ||
		hosted.metadataMismatches > 0 ||
		hosted.actorIdentityConflicts > 0;
	const deletionScopeTrusted = manifestExactMatch && !ownershipConflict;
	const authoritativeReleaseUnavailable = !authoritativeReleaseAvailable;
	const zeroExactHosted = Object.values(hosted.counts).every((count) => count === 0);
	const cleanupPhase = state.phases.cleanup;
	const cleanupCompleteContradiction = Boolean(
		cleanupPhase.status === 'complete' && hostedEvidenceAvailable && !zeroExactHosted
	);
	const archivedClassificationAllowed = Boolean(
		archived &&
		!(cleanupPhase.status === 'complete' && (cleanupCompleteContradiction || ownershipConflict))
	);
	const ambiguous =
		!manifestMatches ||
		authoritativeReleaseUnavailable ||
		ownershipConflict ||
		cleanupCompleteContradiction ||
		(credentialsLost && hosted.counts.actors === 0);
	const cleanupStarted =
		cleanupPhase.status !== 'pending' || cleanupPhase.checkpoint !== null;
	const cleanupExplicitlyRequired =
		cleanupPhase.status === 'required' ||
		cleanupPhase.checkpoint?.status === 'required' ||
		cleanupPhase.checkpoint?.reasonCode === 'cleanup_required';
	const facts = {
		runId: state.runId,
		projectRef: state.target.projectRef,
		workerOrigin: state.target.workerOrigin,
		stateSchemaVersion: state.schemaVersion,
		stateRevision: state.revision,
		stateSha256,
		stateValid: true,
		stateCorrupt: false,
		corruptState: false,
		manifestValid,
		manifestSha256,
		manifestBindingStatus,
		manifestExactMatch,
		manifestAheadState,
		manifestMatches,
		manifestMismatch,
		boundReleaseCommitSha: state.target.releaseCommitSha,
		currentReleaseCommitSha,
		authoritativeReleaseAvailable,
		authoritativeReleaseUnavailable,
		releaseMismatch,
		releaseChanged: releaseMismatch,
		hostedEvidenceAvailable,
		ownershipConflict,
		deletionScopeTrusted,
		ambiguous,
		cleanupCompleteContradiction,
		archived: archivedClassificationAllowed,
		secretStoreStatus,
		secretStoreCiphertextSha256,
		credentialsLost,
		exactRecoveryProvenance:
			credentialsLost && hostedEvidenceAvailable && !ownershipConflict && hosted.counts.actors > 0,
		counts: hosted.counts,
		foreignCounts: hosted.foreignCounts,
		roleCounts: hosted.roleCounts,
		duplicateRoles: hosted.duplicateRoles,
		metadataMismatches: hosted.metadataMismatches,
		manifestActorsAbsent: hosted.manifestActorsAbsent,
		actorIdentityConflicts: hosted.actorIdentityConflicts,
		hostedActorsManifestStale: hosted.hostedActorsManifestStale,
		confirmedActors: hosted.confirmedActors,
		completeProfiles: hosted.completeProfiles,
		verifiedModeratorTotpFactors: hosted.verifiedModeratorTotpFactors,
		moderatorsWithVerifiedTotp: hosted.moderatorsWithVerifiedTotp,
		actorsWithActiveSessions: hosted.actorsWithActiveSessions,
		activeSessionsProven: hosted.activeSessionsProven,
		foreignEvidenceSha256: hosted.foreignEvidenceSha256,
		actors: hosted.counts.actors,
		provisionVerified:
			hosted.counts.actors === ACTOR_ROLES.length &&
			Object.values(hosted.roleCounts).every((count) => count === 1) &&
			hosted.confirmedActors === ACTOR_ROLES.length &&
			hosted.completeProfiles === ACTOR_ROLES.length &&
			hosted.verifiedModeratorTotpFactors === 2 &&
			hosted.moderatorsWithVerifiedTotp === 2 &&
			hosted.activeSessionsProven &&
			hosted.actorsWithActiveSessions === ACTOR_ROLES.length &&
			!ownershipConflict,
		scenarioVerified: hosted.scenarioVerified,
		scenarioPartial: hosted.scenarioPartial,
		cleanupVerified:
			cleanupPhase.status === 'complete' &&
			hostedEvidenceAvailable &&
			deletionScopeTrusted &&
			zeroExactHosted,
		cleanupPartial:
			hostedEvidenceAvailable &&
			cleanupStarted &&
			cleanupPhase.status !== 'complete' &&
			!cleanupExplicitlyRequired,
		cleanupRequired:
			hostedEvidenceAvailable && cleanupExplicitlyRequired && !zeroExactHosted
	};
	const classification = classifyGate3Lifecycle(facts).classification;
	return deepFreeze({ ...facts, classification });
}

/**
 * Performs the post-cleanup zero check through a newly created read adapter.
 * The API intentionally accepts no canonical inspection result or cached state.
 *
 * @param {{
 *   adapterFactory: () => { inspectRun: (scope: Record<string, unknown>) => Promise<unknown> } | Promise<{ inspectRun: (scope: Record<string, unknown>) => Promise<unknown> }>,
 *   scope: Record<string, unknown>,
 *   expectedForeignEvidenceSha256: string
 * }} options
 * @returns {Promise<Record<string, any>>}
 */
export async function verifyIndependentHostedZero({
	adapterFactory,
	scope,
	expectedForeignEvidenceSha256
}) {
	const scopeKeys =
		scope && typeof scope === 'object' && !Array.isArray(scope)
			? Object.keys(scope).sort()
			: [];
	const manifest =
		scope?.manifest && typeof scope.manifest === 'object'
			? /** @type {Record<string, any>} */ (scope.manifest)
			: null;
	if (
		typeof adapterFactory !== 'function' ||
		typeof expectedForeignEvidenceSha256 !== 'string' ||
		!SHA256_PATTERN.test(expectedForeignEvidenceSha256) ||
		JSON.stringify(scopeKeys) !==
			JSON.stringify(['createdAfter', 'expectedIdentities', 'manifest', 'runId']) ||
		typeof scope.runId !== 'string' ||
		!/^gate3-\d{8}-[a-f0-9]{8}$/u.test(scope.runId) ||
		typeof scope.createdAfter !== 'string' ||
		!Number.isFinite(Date.parse(scope.createdAfter)) ||
		!isExactIdentitySet(scope.expectedIdentities, scope.runId) ||
		!manifest ||
		manifest.targetProjectRef !== GATE3_PROJECT_REF ||
		manifest.runId !== scope.runId ||
		!Array.isArray(manifest.actors) ||
		!Array.isArray(manifest.pendingActors) ||
		!Array.isArray(manifest.reports) ||
		!Array.isArray(manifest.uploads) ||
		!Array.isArray(manifest.queueRows)
	) {
		throw new Gate3HostedInspectorError('independent_zero_scope_invalid');
	}
	let validatedManifest;
	try {
		validatedManifest = validateHostedRunManifest(
			/** @type {any} */ ({
				target: { projectRef: GATE3_PROJECT_REF },
				runId: scope.runId
			}),
			scope.manifest
		);
	} catch {
		throw new Gate3HostedInspectorError('independent_zero_scope_invalid');
	}
	const exactIdentities = /** @type {Array<Record<string, string>>} */ (
		scope.expectedIdentities
	);
	const freshScope = Object.freeze({
		runId: scope.runId,
		createdAfter: scope.createdAfter,
		manifest: validatedManifest,
		expectedIdentities: Object.freeze(
			exactIdentities.map((identity) => Object.freeze({ ...identity }))
		)
	});
	let adapter;
	try {
		adapter = await adapterFactory();
	} catch {
		throw new Gate3HostedInspectorError('independent_zero_unavailable');
	}
	assertReadOnlyInspectionAdapter(adapter);
	let providerFacts;
	try {
		providerFacts = await adapter.inspectRun(freshScope);
	} catch {
		throw new Gate3HostedInspectorError('independent_zero_unavailable');
	}
	const fresh = sanitizeHostedFacts(providerFacts);
	const independentZeroVerified =
		Object.values(fresh.counts).every((count) => count === 0) &&
		fresh.foreignEvidenceSha256 === expectedForeignEvidenceSha256;
	return deepFreeze({
		independentZeroVerified,
		counts: fresh.counts,
		foreignCounts: fresh.foreignCounts,
		foreignEvidenceSha256: fresh.foreignEvidenceSha256
	});
}
