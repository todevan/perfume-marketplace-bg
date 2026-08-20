import { createHash, randomBytes, randomUUID as nodeRandomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { types as utilTypes } from 'node:util';
import { reservePrivateFile } from './hosted-private-file.mjs';
import {
	GATE3_PROJECT_REF,
	GATE3_WORKER_ORIGIN,
	createInitialRunState,
	publishActiveRunIfUnlocked,
	readActiveRun,
	readStableGate3PreflightSnapshot,
	reserveGate3RunDirectory,
	reserveRunState,
	rollbackGate3RunDirectory,
	resolveGate3RunPaths,
	writeNextRunState
} from './gate3-hosted-state.mjs';
import {
	createRunSecretPayload,
	protectRunSecrets,
	unprotectRunSecrets
} from './gate3-hosted-secrets.mjs';
import { inspectGate3HostedRun, resolveDeployedRelease } from './gate3-hosted-inspector.mjs';
import { GATE3_EXIT_CODES, classifyGate3Lifecycle } from './gate3-hosted-lifecycle.mjs';
import {
	HOSTED_STAGING,
	createHostedRunManifest,
	validateHostedRunManifest
} from './hosted-report-evidence-operator.mjs';

const RUN_ID_PATTERN = /^gate3-\d{8}-[a-f0-9]{8}$/u;
const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CANONICAL_CHECKPOINTS = new Set(['scenario-primary-upload-attached']);
/** @type {readonly ('reporter' | 'cross-user' | 'assigned-moderator' | 'unassigned-moderator')[]} */
const ACTOR_ROLES = Object.freeze([
	'reporter',
	'cross-user',
	'assigned-moderator',
	'unassigned-moderator'
]);
const PHASE_NAMES = Object.freeze(['preflight', 'provision', 'scenario', 'cleanup', 'recovery']);
const COUNT_NAMES = new Set([
	'actors',
	'sessions',
	'mfaFactors',
	'profiles',
	'reports',
	'uploads',
	'objects',
	'queueRows'
]);
const PHASE_STATUSES = new Set([
	'pending',
	'in-progress',
	'partial',
	'complete',
	'required',
	'verified',
	'failed',
	'uncertain'
]);
const LIFECYCLE_CLASSIFICATIONS = new Set([
	'PREFLIGHT_READY',
	'PROVISION_PARTIAL',
	'PROVISION_VERIFIED',
	'SCENARIO_PARTIAL',
	'SCENARIO_VERIFIED',
	'CLEANUP_REQUIRED',
	'CLEANUP_PARTIAL',
	'CLEANUP_VERIFIED',
	'RECOVERY_REQUIRED',
	'RELEASE_CHANGED',
	'AMBIGUOUS',
	'ARCHIVED'
]);
const COMMAND_FLAGS = Object.freeze({
	preflight: new Set(['--run', '--new', '--release-sha', '--json']),
	inspect: new Set(['--run', '--json']),
	provision: new Set(['--run', '--json']),
	scenario: new Set(['--run', '--json']),
	cleanup: new Set(['--run', '--json']),
	recover: new Set(['--run', '--json'])
});
const SAFE_REASON_CODES = new Set([
	'unsupported_argument',
	'command_unwired',
	'precondition_failed',
	'target_configuration_invalid',
	'active_run_required',
	'active_run_locked',
	'preflight_recovery_required',
	'release_evidence_unavailable',
	'release_evidence_invalid',
	'dpapi_probe_failed',
	'hosted_absence_unavailable',
	'hosted_artifacts_present',
	'preflight_cleanup_failed',
	'preflight_verified',
	'inspection_adapter_not_read_only',
	'preflight_ready',
	'inspection_ambiguous',
	'release_changed',
	'recovery_required',
	'provision_partial',
	'provision_verified',
	'scenario_partial',
	'scenario_verified',
	'cleanup_required',
	'cleanup_partial',
	'cleanup_verified',
	'archived'
]);

class Gate3HostedCliError extends Error {
	/** @param {string} reasonCode */
	constructor(reasonCode) {
		super(reasonCode);
		this.name = 'Gate3HostedCliError';
		this.reasonCode = reasonCode;
	}
}

/** @returns {never} */
function unsupportedArgument() {
	throw new Gate3HostedCliError('unsupported_argument');
}

/**
 * Parses only the fixed Gate 3 command and per-command option allow-list.
 * @param {unknown} argv
 */
export function parseGate3HostedArgs(argv) {
	if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string')) {
		return unsupportedArgument();
	}
	const [command, ...tokens] = argv;
	if (typeof command !== 'string' || !Object.hasOwn(COMMAND_FLAGS, command)) {
		return unsupportedArgument();
	}

	const allowed = COMMAND_FLAGS[/** @type {keyof typeof COMMAND_FLAGS} */ (command)];
	const seen = new Set();
	let runId = null;
	let releaseSha = null;
	let createNew = false;
	let json = false;

	for (let index = 0; index < tokens.length; index += 1) {
		const flag = tokens[index];
		if (!allowed.has(flag) || seen.has(flag)) return unsupportedArgument();
		seen.add(flag);
		if (flag === '--new') {
			createNew = true;
			continue;
		}
		if (flag === '--json') {
			json = true;
			continue;
		}
		const value = tokens[index + 1];
		if (typeof value !== 'string' || value.startsWith('--')) return unsupportedArgument();
		index += 1;
		if (flag === '--run') {
			if (!RUN_ID_PATTERN.test(value)) return unsupportedArgument();
			runId = value;
			continue;
		}
		if (flag === '--release-sha') {
			if (!RELEASE_SHA_PATTERN.test(value)) return unsupportedArgument();
			releaseSha = value;
			continue;
		}
		return unsupportedArgument();
	}

	if (command === 'preflight' && createNew && runId !== null) return unsupportedArgument();
	if (command === 'recover' && runId === null) return unsupportedArgument();
	return Object.freeze({ command, runId, createNew, releaseSha, json });
}

/** @param {unknown} environment */
function verifiedRoot(environment) {
	if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
		throw new Gate3HostedCliError('target_configuration_invalid');
	}
	const candidate = /** @type {Record<string, unknown>} */ (environment);
	if (
		candidate.GATE3_PROJECT_REF !== GATE3_PROJECT_REF ||
		candidate.GATE3_WORKER_ORIGIN !== GATE3_WORKER_ORIGIN ||
		typeof candidate.GATE3_HOSTED_ROOT !== 'string' ||
		!isAbsolute(candidate.GATE3_HOSTED_ROOT)
	) {
		throw new Gate3HostedCliError('target_configuration_invalid');
	}
	return candidate.GATE3_HOSTED_ROOT;
}

/** @param {Record<string, unknown>} dependencies @param {string} name @param {Function | null} fallback */
function dependency(dependencies, name, fallback) {
	const candidate = dependencies[name] ?? fallback;
	if (typeof candidate !== 'function') throw new Gate3HostedCliError('precondition_failed');
	return candidate;
}

/** @param {unknown} error */
function ownSafeReasonCode(error) {
	try {
		if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
		const descriptor = Object.getOwnPropertyDescriptor(error, 'reasonCode');
		if (
			!descriptor ||
			!Object.hasOwn(descriptor, 'value') ||
			typeof descriptor.value !== 'string' ||
			!SAFE_REASON_CODES.has(descriptor.value)
		) {
			return null;
		}
		return descriptor.value;
	} catch {
		return null;
	}
}

/** @param {unknown} candidate */
function exactInspectionAdapter(candidate) {
	try {
		if (!candidate || typeof candidate !== 'object' || utilTypes.isProxy(candidate)) {
			throw new Error('invalid adapter');
		}
		const keys = Reflect.ownKeys(candidate);
		const descriptor = Object.getOwnPropertyDescriptor(candidate, 'inspectRun');
		if (
			Object.getPrototypeOf(candidate) !== Object.prototype ||
			!Object.isFrozen(candidate) ||
			keys.length !== 1 ||
			keys[0] !== 'inspectRun' ||
			!descriptor ||
			!Object.hasOwn(descriptor, 'value') ||
			typeof descriptor.value !== 'function' ||
			descriptor.enumerable !== true ||
			descriptor.writable !== false ||
			descriptor.configurable !== false
		) {
			throw new Error('invalid adapter');
		}
		return Object.freeze({ inspectRun: descriptor.value });
	} catch {
		throw new Gate3HostedCliError('inspection_adapter_not_read_only');
	}
}

/** @param {string} runId @param {Record<string, any>} state */
function preflightNoopResult(runId, state) {
	return Object.freeze({
		runId,
		classification: 'PREFLIGHT_READY',
		allowedCommands: Object.freeze(['inspect', 'provision']),
		counts: Object.freeze({ actors: 0 }),
		roleNames: ACTOR_ROLES,
		hashes: Object.freeze({
			manifestSha256: state.manifest.sha256,
			ciphertextSha256: state.secretStore.ciphertextSha256
		}),
		checkpoints: Object.freeze({ preflight: safeCheckpoint(state.phases.preflight.checkpoint) }),
		phases: Object.freeze(
			Object.fromEntries(
				PHASE_NAMES.flatMap((phase) =>
					PHASE_STATUSES.has(state.phases[phase].status)
						? [[phase, state.phases[phase].status]]
						: []
				)
			)
		),
		reasonCode: 'preflight_ready'
	});
}

/**
 * Supplies the manifest module's structural config without a hosted service credential.
 * @param {{ runId: string, provisioningNonce: string, provisionedAfter: string, actorRoles?: Record<string, any> }} options
 */
function localManifestConfig({
	runId,
	provisioningNonce,
	provisionedAfter,
	actorRoles = {}
}) {
	return {
		target: HOSTED_STAGING,
		runId,
		actorRoles,
		serviceKey: '',
		provisioningNonce,
		provisionedAfter
	};
}

/** @param {Record<string, string>} paths @param {unknown} dpapi */
async function assertExistingPreflightIntegrity(paths, dpapi) {
	let first;
	let second;
	let state;
	try {
		first = await readStableGate3PreflightSnapshot(paths);
		state = first.state;
	} catch {
		throw new Gate3HostedCliError('preflight_recovery_required');
	}
	if (
		state.revision < 1 ||
		state.phases?.preflight?.status !== 'complete' ||
		!SHA256_PATTERN.test(state.manifest?.sha256 ?? '') ||
		!SHA256_PATTERN.test(state.secretStore?.ciphertextSha256 ?? '')
	) {
		throw new Gate3HostedCliError('preflight_recovery_required');
	}
	try {
		if (
			createHash('sha256').update(first.manifestBytes).digest('hex') !== state.manifest.sha256 ||
			createHash('sha256').update(first.secretBytes).digest('hex') !==
				state.secretStore.ciphertextSha256
		) {
			throw new Error('hash mismatch');
		}
		const parsedManifest = JSON.parse(first.manifestBytes.toString('utf8'));
		if (typeof parsedManifest?.provisioningAttemptId !== 'string') {
			throw new Error('manifest attempt binding is invalid');
		}
		const manifest = validateHostedRunManifest(
			localManifestConfig({
				runId: state.runId,
				provisioningNonce: parsedManifest.provisioningAttemptId,
				provisionedAfter: state.createdAt
			}),
			parsedManifest
		);
		const emptyManifestFields = /** @type {const} */ ([
			'pendingActors',
			'actors',
			'reports',
			'uploads',
			'queueRows'
		]);
		if (
			!emptyManifestFields.every(
				(field) => Array.isArray(manifest[field]) && manifest[field].length === 0
			)
		) {
			throw new Error('manifest is no longer an empty baseline');
		}
		if (
			!dpapi ||
			typeof dpapi !== 'object' ||
			typeof /** @type {{ unprotect?: unknown }} */ (dpapi).unprotect !== 'function'
		) {
			throw new Error('DPAPI unavailable');
		}
		await unprotectRunSecrets({
			runId: state.runId,
			path: paths.secretPath,
			dpapi: /** @type {{ unprotect: (input: Buffer) => Promise<Uint8Array> }} */ (dpapi)
		});
		second = await readStableGate3PreflightSnapshot(paths);
		if (
			!first.stateBytes.equals(second.stateBytes) ||
			!first.manifestBytes.equals(second.manifestBytes) ||
			!first.secretBytes.equals(second.secretBytes) ||
			first.directoryIdentity.dev !== second.directoryIdentity.dev ||
			first.directoryIdentity.ino !== second.directoryIdentity.ino ||
			first.directoryIdentity.realpath.toLowerCase() !== second.directoryIdentity.realpath.toLowerCase()
		) {
			throw new Error('preflight evidence changed');
		}
	} catch {
		throw new Gate3HostedCliError('preflight_recovery_required');
	}
	return second.state;
}

/** @param {unknown} counts */
function assertExactHostedAbsence(counts) {
	if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
		throw new Gate3HostedCliError('hosted_absence_unavailable');
	}
	for (const name of ['accounts', 'profiles', 'reports', 'uploads', 'objects', 'queueRows']) {
		const value = /** @type {Record<string, unknown>} */ (counts)[name];
		if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
			throw new Gate3HostedCliError('hosted_absence_unavailable');
		}
		if (value !== 0) throw new Gate3HostedCliError('hosted_artifacts_present');
	}
}

/** @param {unknown} dpapi */
async function probeDpapi(dpapi) {
	if (
		!dpapi ||
		typeof dpapi !== 'object' ||
		typeof /** @type {{ protect?: unknown }} */ (dpapi).protect !== 'function' ||
		typeof /** @type {{ unprotect?: unknown }} */ (dpapi).unprotect !== 'function'
	) {
		throw new Gate3HostedCliError('dpapi_probe_failed');
	}
	const plaintext = Buffer.from('gate3-dpapi-probe-v1', 'utf8');
	let ciphertext;
	let restored;
	try {
		ciphertext = Buffer.from(await /** @type {any} */ (dpapi).protect(plaintext));
		restored = Buffer.from(await /** @type {any} */ (dpapi).unprotect(ciphertext));
		if (!restored.equals(plaintext)) throw new Error('round-trip mismatch');
	} catch {
		throw new Gate3HostedCliError('dpapi_probe_failed');
	} finally {
		plaintext.fill(0);
		ciphertext?.fill(0);
		restored?.fill(0);
	}
}

/** @param {string} runId @param {() => Uint8Array} [randomBytesImpl] */
function defaultCreateSecretPayload(runId, randomBytesImpl) {
	return createRunSecretPayload({
		runId,
		...(randomBytesImpl ? { randomBytesImpl: () => randomBytesImpl() } : {})
	});
}

/** @param {Record<string, any>} parsed @param {unknown} environment @param {Record<string, unknown>} dependencies */
async function executePreflight(parsed, environment, dependencies) {
	const root = verifiedRoot(environment);
	const readActive = dependency(dependencies, 'readActiveRun', readActiveRun);
	const activeRunId = await readActive(root);
	let selectedRunId;
	if (parsed.runId !== null) {
		selectedRunId = parsed.runId;
	} else if (parsed.createNew) {
		selectedRunId = dependency(dependencies, 'createRunId', createGate3RunId)();
		if (typeof selectedRunId !== 'string' || !RUN_ID_PATTERN.test(selectedRunId)) {
			throw new Gate3HostedCliError('precondition_failed');
		}
	} else {
		if (activeRunId === null) throw new Gate3HostedCliError('active_run_required');
		selectedRunId = activeRunId;
	}
	const paths = dependency(dependencies, 'resolveGate3RunPaths', resolveGate3RunPaths)({
		root,
		runId: selectedRunId
	});

	let selectedExists = false;
	try {
		const entry = await lstat(paths.runDirectory);
		selectedExists = entry.isDirectory() && !entry.isSymbolicLink();
		if (!selectedExists) throw new Gate3HostedCliError('preflight_recovery_required');
	} catch (error) {
		if (error instanceof Gate3HostedCliError) throw error;
		if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
			throw new Gate3HostedCliError('preflight_recovery_required');
		}
	}
	if (selectedExists) {
		const state = await assertExistingPreflightIntegrity(paths, dependencies.dpapi);
		return preflightNoopResult(selectedRunId, state);
	}

	// Fixed target/config verification intentionally precedes any provider or filesystem side effect.
	verifiedRoot(environment);
	const releaseResolver = dependency(dependencies, 'resolveDeployedRelease', resolveDeployedRelease);
	let releaseCommitSha;
	try {
		releaseCommitSha = await releaseResolver({ workerOrigin: GATE3_WORKER_ORIGIN });
	} catch (error) {
		const reasonCode = ownSafeReasonCode(error);
		if (reasonCode === 'release_evidence_unavailable') {
			if (parsed.releaseSha === null) throw new Gate3HostedCliError(reasonCode);
			releaseCommitSha = parsed.releaseSha;
		} else if (reasonCode === 'release_evidence_invalid') {
			throw new Gate3HostedCliError(reasonCode);
		} else {
			throw new Gate3HostedCliError('precondition_failed');
		}
	}
	if (typeof releaseCommitSha !== 'string' || !RELEASE_SHA_PATTERN.test(releaseCommitSha)) {
		throw new Gate3HostedCliError('release_evidence_invalid');
	}

	await probeDpapi(dependencies.dpapi);
	const createdAt = dependency(dependencies, 'now', () => new Date().toISOString())();
	if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
		throw new Gate3HostedCliError('precondition_failed');
	}
	const payload = defaultCreateSecretPayload(
		selectedRunId,
		typeof dependencies.randomBytes === 'function'
			? () => /** @type {Function} */ (dependencies.randomBytes)(32)
			: undefined
	);
	const expectedIdentities = ACTOR_ROLES.map((role) => {
		const actor = payload.actors[role];
		return Object.freeze({ role: actor.role, email: actor.email, username: actor.username });
	});
	let absence;
	try {
		absence = await dependency(dependencies, 'inspectHostedAbsence', null)({
			runId: selectedRunId,
			createdAfter: createdAt,
			expectedIdentities
		});
	} catch (error) {
		if (error instanceof Gate3HostedCliError) throw error;
		if (ownSafeReasonCode(error) === 'hosted_artifacts_present') {
			throw new Gate3HostedCliError('hosted_artifacts_present');
		}
		throw new Gate3HostedCliError('hosted_absence_unavailable');
	}
	assertExactHostedAbsence(absence?.counts);

	let reservation = null;
	let published = false;
	try {
		reservation = await dependency(dependencies, 'reserveGate3RunDirectory', reserveGate3RunDirectory)(paths);
		const secretMetadata = await dependency(
			dependencies,
			'protectRunSecrets',
			protectRunSecrets
		)({ payload, path: paths.secretPath, dpapi: dependencies.dpapi });
		if (
			!secretMetadata ||
			typeof secretMetadata !== 'object' ||
			!SHA256_PATTERN.test(secretMetadata.ciphertextSha256 ?? '')
		) {
			throw new Gate3HostedCliError('precondition_failed');
		}
		const randomUUID = dependency(dependencies, 'randomUUID', nodeRandomUUID);
		const provisioningAttemptId = randomUUID();
		const manifest = createHostedRunManifest(
			localManifestConfig({
				runId: selectedRunId,
				actorRoles: payload.actors,
				provisioningNonce: provisioningAttemptId,
				provisionedAfter: createdAt
			}),
			{
				provisioningAttemptId,
				credentialStoreId: secretMetadata.ciphertextSha256
			}
		);
		const manifestBytes = `${JSON.stringify(manifest)}\n`;
		await dependency(dependencies, 'reserveManifest', reservePrivateFile)(
			paths.manifestPath,
			manifestBytes
		);
		const initialState = createInitialRunState({
			runId: selectedRunId,
			createdAt,
			releaseCommitSha,
			manifestPath: paths.manifestPath,
			secretPath: paths.secretPath
		});
		await dependency(dependencies, 'reserveRunState', reserveRunState)(paths, initialState);
		const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
		const verifiedState = {
			...initialState,
			revision: 1,
			manifest: { ...initialState.manifest, sha256: manifestSha256 },
			secretStore: {
				...initialState.secretStore,
				status: secretMetadata.status,
				ciphertextSha256: secretMetadata.ciphertextSha256
			},
			phases: {
				...initialState.phases,
				preflight: {
					status: 'complete',
					checkpoint: {
						observedAt: createdAt,
						reasonCode: 'preflight_verified',
						revision: 1
					}
				}
			}
		};
		await dependency(dependencies, 'writeNextRunState', writeNextRunState)(
			paths,
			initialState,
			verifiedState
		);
		await dependency(
			dependencies,
			'publishActiveRunIfUnlocked',
			publishActiveRunIfUnlocked
		)({
			root,
			runId: selectedRunId,
			expectedCurrentRunId: activeRunId
		});
		published = true;
		return preflightNoopResult(selectedRunId, verifiedState);
	} catch (error) {
		if (reservation !== null && !published) {
			try {
				await rollbackGate3RunDirectory({ paths, reservation });
			} catch {
				let activeAfterFailure = null;
				try {
					activeAfterFailure = await readActiveRun(root);
				} catch {}
				if (activeAfterFailure !== selectedRunId) {
					throw new Gate3HostedCliError('preflight_cleanup_failed');
				}
			}
		}
		throw error;
	}
}

function createGate3RunId() {
	const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
	return `gate3-${date}-${randomBytes(4).toString('hex')}`;
}

/** @param {unknown} value */
function safeCounts(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({});
	return Object.freeze(
		Object.fromEntries(
			Object.entries(value).filter(
				([key, count]) =>
					COUNT_NAMES.has(key) &&
					typeof count === 'number' &&
					Number.isSafeInteger(count) &&
					count >= 0
			)
		)
	);
}

/** @param {unknown} value */
function safeCheckpoint(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const candidate = /** @type {Record<string, unknown>} */ (value);
	/** @type {Record<string, string | number>} */
	const safe = {};
	if (
		typeof candidate.observedAt === 'string' &&
		!Number.isNaN(Date.parse(candidate.observedAt))
	) {
		safe.observedAt = candidate.observedAt;
	}
	if (typeof candidate.status === 'string' && PHASE_STATUSES.has(candidate.status)) {
		safe.status = candidate.status;
	}
	if (typeof candidate.phase === 'string' && PHASE_NAMES.includes(candidate.phase)) {
		safe.phase = candidate.phase;
	}
	if (typeof candidate.reasonCode === 'string' && SAFE_REASON_CODES.has(candidate.reasonCode)) {
		safe.reasonCode = candidate.reasonCode;
	}
	if (
		typeof candidate.revision === 'number' &&
		Number.isSafeInteger(candidate.revision) &&
		candidate.revision >= 0
	) {
		safe.revision = candidate.revision;
	}
	return Object.freeze(safe);
}

/** @param {Record<string, any>} inspection @param {Record<string, any>} lifecycle */
function safeInspectionResult(inspection, lifecycle) {
	/** @type {Record<string, string>} */
	const hashes = {};
	for (const [key, value, pattern] of [
		['stateSha256', inspection.stateSha256, SHA256_PATTERN],
		['manifestSha256', inspection.manifestSha256, SHA256_PATTERN],
		['ciphertextSha256', inspection.secretStoreCiphertextSha256, SHA256_PATTERN],
		['boundReleaseCommitSha', inspection.boundReleaseCommitSha, RELEASE_SHA_PATTERN],
		['currentReleaseCommitSha', inspection.currentReleaseCommitSha, RELEASE_SHA_PATTERN],
		['foreignEvidenceSha256', inspection.foreignEvidenceSha256, SHA256_PATTERN]
	]) {
		if (typeof value === 'string' && pattern.test(value)) {
			hashes[key] = value;
		}
	}
	/** @type {Record<string, Record<string, string | number> | null>} */
	const checkpoints = {};
	if (inspection.scenarioCheckpoints && typeof inspection.scenarioCheckpoints === 'object') {
		for (const [key, value] of Object.entries(inspection.scenarioCheckpoints)) {
			if (CANONICAL_CHECKPOINTS.has(key)) checkpoints[key] = safeCheckpoint(value);
		}
	}
	/** @type {Record<string, Record<string, unknown>>} */
	const phases = {};
	if (inspection.phases && typeof inspection.phases === 'object') {
		for (const phase of PHASE_NAMES) {
			const candidate = inspection.phases[phase];
			if (
				candidate &&
				typeof candidate === 'object' &&
				typeof candidate.status === 'string' &&
				PHASE_STATUSES.has(candidate.status)
			) {
				phases[phase] = Object.freeze({
					status: candidate.status,
					checkpoint: safeCheckpoint(candidate.checkpoint)
				});
			}
		}
	}
	return Object.freeze({
		runId: RUN_ID_PATTERN.test(inspection.runId ?? '') ? inspection.runId : 'unavailable',
		classification: LIFECYCLE_CLASSIFICATIONS.has(lifecycle.classification)
			? lifecycle.classification
			: 'AMBIGUOUS',
		allowedCommands: Object.freeze(
			Array.isArray(lifecycle.allowedCommands)
				? lifecycle.allowedCommands.filter(
						(command) =>
							typeof command === 'string' &&
							['inspect', 'provision', 'scenario', 'cleanup', 'recover', 'archive'].includes(command)
					)
				: []
		),
		counts: safeCounts(inspection.counts),
		roleNames: Object.freeze(
			ACTOR_ROLES.filter((role) => Object.hasOwn(inspection.roleCounts ?? {}, role))
		),
		hashes: Object.freeze(hashes),
		checkpoints: Object.freeze(checkpoints),
		phases: Object.freeze(phases),
		reasonCode:
			typeof lifecycle.reasonCode === 'string' && SAFE_REASON_CODES.has(lifecycle.reasonCode)
				? lifecycle.reasonCode
				: 'precondition_failed'
	});
}

/** @param {unknown} classification */
function inspectionExitCode(classification) {
	if (classification === 'AMBIGUOUS') return GATE3_EXIT_CODES.AMBIGUOUS;
	if (classification === 'RELEASE_CHANGED') return GATE3_EXIT_CODES.RELEASE_CHANGED;
	if (classification === 'RECOVERY_REQUIRED') return GATE3_EXIT_CODES.RECOVERY_REQUIRED;
	return typeof classification === 'string' && LIFECYCLE_CLASSIFICATIONS.has(classification)
		? GATE3_EXIT_CODES.success
		: GATE3_EXIT_CODES.precondition;
}

/** @param {Record<string, any>} parsed @param {unknown} environment @param {Record<string, unknown>} dependencies */
async function executeInspect(parsed, environment, dependencies) {
	const root = verifiedRoot(environment);
	const readActive = dependency(dependencies, 'readActiveRun', readActiveRun);
	const runId = parsed.runId ?? (await readActive(root));
	if (runId === null) throw new Gate3HostedCliError('active_run_required');
	const paths = dependency(dependencies, 'resolveGate3RunPaths', resolveGate3RunPaths)({ root, runId });
	const adapter = exactInspectionAdapter(dependencies.inspectionAdapter);
	const inspection = await dependency(
		dependencies,
		'inspectGate3HostedRun',
		inspectGate3HostedRun
	)({ paths, inspectionAdapter: adapter });
	const lifecycle = classifyGate3Lifecycle(inspection);
	return { result: safeInspectionResult(inspection, lifecycle), lifecycle };
}

/** @param {unknown} error */
function safeReasonCode(error) {
	return ownSafeReasonCode(error) ?? 'precondition_failed';
}

/** @param {unknown} writer @param {Record<string, unknown>} value */
function writeSafe(writer, value) {
	try {
		if (typeof writer !== 'function') return true;
		writer(`${JSON.stringify(value)}\n`);
		return true;
	} catch {
		return false;
	}
}

/**
 * Executes only local preflight or read-only inspection. Mutation commands remain unwired.
 * @param {{ argv: unknown, environment: unknown, dependencies?: Record<string, unknown>, input?: unknown, output?: unknown, errorOutput?: unknown }} options
 */
export async function runGate3HostedCli({
	argv,
	environment,
	dependencies = {},
	input: _input,
	output,
	errorOutput
}) {
	try {
		const parsed = parseGate3HostedArgs(argv);
		if (!['preflight', 'inspect'].includes(parsed.command)) {
			throw new Gate3HostedCliError('command_unwired');
		}
		if (parsed.command === 'preflight') {
			const result = await executePreflight(parsed, environment, dependencies);
			if (!writeSafe(output, result)) throw new Gate3HostedCliError('precondition_failed');
			return GATE3_EXIT_CODES.success;
		}
		const { result, lifecycle } = await executeInspect(parsed, environment, dependencies);
		if (!writeSafe(output, result)) throw new Gate3HostedCliError('precondition_failed');
		return inspectionExitCode(lifecycle.classification);
	} catch (error) {
		writeSafe(errorOutput, { reasonCode: safeReasonCode(error) });
		return GATE3_EXIT_CODES.precondition;
	}
}
