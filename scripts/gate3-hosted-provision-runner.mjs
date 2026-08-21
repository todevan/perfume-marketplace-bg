import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';
import {
	HOSTED_STAGING,
	loadHostedRunManifest,
	persistHostedRunManifest,
	registerHostedActor
} from './hosted-report-evidence-operator.mjs';
import { inspectGate3HostedRun } from './gate3-hosted-inspector.mjs';
import { selectNextProvisionStep } from './gate3-hosted-lifecycle.mjs';
import {
	acquireRunLock,
	inspectRunLock,
	readStableGate3PreflightSnapshot,
	readRunState,
	releaseRunLock,
	writeNextRunState
} from './gate3-hosted-state.mjs';
import {
	protectRunSecrets,
	recordProviderTotpSecret,
	unprotectRunSecretBytes,
	unprotectRunSecrets
} from './gate3-hosted-secrets.mjs';

const ACTOR_ROLES = Object.freeze([
	'reporter',
	'cross-user',
	'assigned-moderator',
	'unassigned-moderator'
]);
const ACTOR_ROLE_SET = new Set(ACTOR_ROLES);
const MODERATOR_ROLES = new Set(['assigned-moderator', 'unassigned-moderator']);
const ALLOWED_CLASSIFICATIONS = new Set(['PREFLIGHT_READY', 'PROVISION_PARTIAL']);
const BLOCKED_CLASSIFICATIONS = new Set(['RELEASE_CHANGED', 'AMBIGUOUS', 'RECOVERY_REQUIRED']);
const OUTCOMES = new Set(['confirmed', 'confirmed-absent', 'uncertain']);
const CAPABILITY_KEYS = Object.freeze([
	'mutate',
	'readBack',
	'persistCredential',
	'persistManifest',
	'persistState'
]);
const PROVIDER_CAPABILITY_KEYS = Object.freeze(['mutate', 'readBack']);
const COMMAND_CAPABILITY_KEYS = Object.freeze(['inspectProvision', 'mutationFor']);
const CONSENT_STEP_PATTERN = /^consent-([a-z][a-z0-9_]{1,63})-(.{1,80})$/u;
const RUN_ID_PATTERN = /^gate3-\d{8}-[a-f0-9]{8}$/u;

export class Gate3HostedProvisionError extends Error {
	/** @param {string} reasonCode @param {number} exitCode */
	constructor(reasonCode, exitCode) {
		super(reasonCode);
		this.name = 'Gate3HostedProvisionError';
		this.reasonCode = reasonCode;
		this.exitCode = exitCode;
	}
}

/** @param {string} reasonCode @param {number} exitCode @returns {never} */
function fail(reasonCode, exitCode) {
	throw new Gate3HostedProvisionError(reasonCode, exitCode);
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

/**
 * Reads an exact frozen data-only object without invoking accessors.
 * @param {unknown} candidate
 * @param {readonly string[]} expectedKeys
 * @param {string} reasonCode
 */
function exactFrozenRecord(candidate, expectedKeys, reasonCode) {
	if (!isPlainDataObject(candidate) || !Object.isFrozen(candidate)) fail(reasonCode, 10);
	try {
		const keys = Reflect.ownKeys(candidate);
		if (
			keys.some((key) => typeof key !== 'string') ||
			keys.length !== expectedKeys.length ||
			!expectedKeys.every((key) => keys.includes(key))
		) {
			fail(reasonCode, 10);
		}
		const entries = [];
		for (const key of expectedKeys) {
			const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
			if (
				!descriptor ||
				!Object.hasOwn(descriptor, 'value') ||
				descriptor.enumerable !== true ||
				descriptor.writable !== false ||
				descriptor.configurable !== false
			) {
				fail(reasonCode, 10);
			}
			entries.push([key, descriptor.value]);
		}
		return Object.freeze(Object.fromEntries(entries));
	} catch (error) {
		if (error instanceof Gate3HostedProvisionError) throw error;
		return fail(reasonCode, 10);
	}
}

/** @param {string} role @param {string} step */
function stepAllowedForRole(role, step) {
	if (!ACTOR_ROLE_SET.has(role) || typeof step !== 'string') return false;
	if (
		['auth-created', 'registration-claimed', 'onboarding-complete', 'actor-verified'].includes(step) ||
		CONSENT_STEP_PATTERN.test(step)
	) {
		return true;
	}
	return MODERATOR_ROLES.has(role) &&
		['role-elevated', 'mfa-enrolled', 'mfa-unenrolled-recovery', 'mfa-verified'].includes(step);
}

/** @param {unknown} inspection @param {unknown} authorization */
function exactBoundaryAuthorization(inspection, authorization) {
	const observed = exactFrozenRecord(
		inspection,
		['classification', 'revision', 'role', 'step', 'outcome'],
		'provision_authorization_invalid'
	);
	const permitted = exactFrozenRecord(
		authorization,
		['command', 'phase', 'role', 'step', 'operationId', 'revision'],
		'provision_authorization_invalid'
	);
	if (
		!ALLOWED_CLASSIFICATIONS.has(observed.classification) ||
		permitted.command !== 'provision' ||
		permitted.phase !== 'provision' ||
		permitted.role !== observed.role ||
		permitted.step !== observed.step ||
		permitted.operationId !== `${observed.role}.${observed.step}` ||
		permitted.revision !== observed.revision ||
		!Number.isSafeInteger(observed.revision) ||
		observed.revision < 0 ||
		!stepAllowedForRole(observed.role, observed.step) ||
		!OUTCOMES.has(observed.outcome)
	) {
		fail('provision_authorization_invalid', 10);
	}
	return Object.freeze({ inspection: observed, authorization: permitted });
}

/** @param {unknown} capabilities @param {string} step */
function exactBoundaryCapabilities(capabilities, step) {
	const exact = exactFrozenRecord(capabilities, CAPABILITY_KEYS, 'provision_capability_invalid');
	const actorAttestationOnly = step === 'actor-verified';
	if (
		(actorAttestationOnly ? exact.mutate !== null : typeof exact.mutate !== 'function') ||
		typeof exact.readBack !== 'function' ||
		typeof exact.persistState !== 'function' ||
		(step === 'auth-created'
			? typeof exact.persistManifest !== 'function'
			: exact.persistManifest !== null) ||
		(step === 'mfa-enrolled'
			? typeof exact.persistCredential !== 'function'
			: exact.persistCredential !== null)
	) {
		fail('provision_capability_invalid', 10);
	}
	for (const name of ['mutate', 'readBack', 'persistCredential', 'persistManifest', 'persistState']) {
		if (typeof exact[name] === 'function' && isProxy(exact[name])) {
			fail('provision_capability_invalid', 10);
		}
	}
	return exact;
}

/** @param {unknown} value */
function readBackStatus(value) {
	if (!isPlainDataObject(value)) return 'uncertain';
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, 'status');
		return descriptor && Object.hasOwn(descriptor, 'value') && OUTCOMES.has(descriptor.value)
			? descriptor.value
			: 'uncertain';
	} catch {
		return 'uncertain';
	}
}

/** @param {unknown} result @param {string} role */
function exactActorCoordinatesFromResult(result, role) {
	if (!isPlainDataObject(result)) return null;
	let candidate;
	try {
		const actorDescriptor = Object.getOwnPropertyDescriptor(result, 'actor');
		if (!actorDescriptor) return null;
		if (!Object.hasOwn(actorDescriptor, 'value')) fail('provision_evidence_invalid', 20);
		candidate = actorDescriptor.value;
	} catch (error) {
		if (error instanceof Gate3HostedProvisionError) throw error;
		return fail('provision_evidence_invalid', 20);
	}
	const actor = copyExactDataRecord(
		candidate,
		['role', 'userId', 'createdAt'],
		['emailConfirmed']
	);
	const parsedCreatedAt = typeof actor.createdAt === 'string' ? new Date(actor.createdAt) : null;
	if (
		actor.role !== role ||
		typeof actor.userId !== 'string' ||
		!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(actor.userId) ||
		parsedCreatedAt === null ||
		Number.isNaN(parsedCreatedAt.valueOf()) ||
		parsedCreatedAt.toISOString() !== actor.createdAt ||
		(Object.hasOwn(actor, 'emailConfirmed') && actor.emailConfirmed !== true)
	) {
		fail('provision_evidence_invalid', 20);
	}
	return Object.freeze({ role, userId: actor.userId, createdAt: actor.createdAt });
}

/** @param {unknown} mutationResult @param {unknown} readBackResult @param {string} role @param {Record<string, any> | null} fallback */
function selectConfirmedActorCoordinates(mutationResult, readBackResult, role, fallback = null) {
	const mutated = exactActorCoordinatesFromResult(mutationResult, role);
	const observed = exactActorCoordinatesFromResult(readBackResult, role);
	if (
		mutated &&
		observed &&
		(mutated.userId !== observed.userId || mutated.createdAt !== observed.createdAt)
	) {
		fail('provision_evidence_invalid', 20);
	}
	let selected = mutated ?? observed;
	if (
		!selected &&
		fallback &&
		typeof fallback.userId === 'string' &&
		typeof fallback.createdAt === 'string'
	) {
		selected = exactActorCoordinatesFromResult(
			{ actor: { role, userId: fallback.userId, createdAt: fallback.createdAt } },
			role
		);
	}
	if (!selected) fail('provision_evidence_invalid', 20);
	return selected;
}

/** @param {{ role: string, step: string, status: string, classification: string, revision: number, reasonCode: string }} value */
function boundaryResult(value) {
	return Object.freeze({
		role: value.role,
		step: value.step,
		status: value.status,
		classification: value.classification,
		revision: value.revision,
		reasonCode: value.reasonCode
	});
}

/**
 * Executes or reconciles exactly one authorized A9 boundary.
 * Provider errors are deliberately ignored as truth; the targeted read-back decides.
 * @param {{ inspection: unknown, authorization: unknown, capabilities: unknown }} options
 */
export async function runProvisionBoundary({ inspection, authorization, capabilities }) {
	const exact = exactBoundaryAuthorization(inspection, authorization);
	const scope = exact.inspection;
	const caps = exactBoundaryCapabilities(capabilities, scope.step);
	/** @param {string} status @param {string} reasonCode @param {number} [revision] */
	const resultFor = (status, reasonCode, revision = scope.revision) =>
		boundaryResult({
			role: scope.role,
			step: scope.step,
			status,
			classification: scope.classification,
			revision,
			reasonCode
		});

	if (scope.outcome === 'uncertain') return resultFor('uncertain', 'mutation_outcome_uncertain');

	let mutationResult = null;
	let readBackResult = null;
	let credentialMetadata = null;
	let credentialPersistenceFailed = false;
	if (scope.outcome === 'confirmed-absent') {
		if (scope.step !== 'actor-verified') {
			try {
				mutationResult = await caps.mutate();
			} catch (error) {
				if (error instanceof Gate3HostedProvisionError) throw error;
				// A transport failure is not mutation truth. Always perform targeted read-back.
			}
		}
		if (scope.step === 'mfa-enrolled' && mutationResult !== null) {
			try {
				credentialMetadata = await caps.persistCredential(mutationResult);
			} catch (error) {
				if (error instanceof Gate3HostedProvisionError) throw error;
				credentialPersistenceFailed = true;
			}
		}
		try {
			readBackResult = await caps.readBack({ mutationResult });
		} catch (error) {
			if (error instanceof Gate3HostedProvisionError) throw error;
			readBackResult = null;
		}
		const status = readBackStatus(readBackResult);
		if (credentialPersistenceFailed) {
			return resultFor('uncertain', 'credential_persistence_failed');
		}
		if (status === 'confirmed-absent') {
			return resultFor('confirmed-absent', 'provider_failure_confirmed_absent');
		}
		if (status !== 'confirmed') return resultFor('uncertain', 'mutation_outcome_uncertain');
	}

	try {
		if (scope.step === 'auth-created') {
			await caps.persistManifest({ mutationResult, readBackResult });
		}
		await caps.persistState({ mutationResult, readBackResult, credentialMetadata });
	} catch (error) {
		if (error instanceof Gate3HostedProvisionError) throw error;
		fail('provision_persistence_uncertain', 41);
	}
	return resultFor('confirmed', 'provision_boundary_confirmed', scope.revision + 1);
}

/** @param {unknown} candidate */
function exactCommandCapabilities(candidate) {
	const exact = exactFrozenRecord(candidate, COMMAND_CAPABILITY_KEYS, 'provision_capability_invalid');
	if (
		typeof exact.inspectProvision !== 'function' ||
		typeof exact.mutationFor !== 'function' ||
		isProxy(exact.inspectProvision) ||
		isProxy(exact.mutationFor)
	) {
		fail('provision_capability_invalid', 10);
	}
	return exact;
}

/** @param {unknown} value @param {string} reasonCode */
function safeInteger(value, reasonCode) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(reasonCode, 10);
	return value;
}

/** @param {unknown} inspection */
function safeInspectionRevision(inspection) {
	if (!isPlainDataObject(inspection)) return 0;
	try {
		for (const name of ['revision', 'stateRevision']) {
			const descriptor = Object.getOwnPropertyDescriptor(inspection, name);
			if (descriptor && Object.hasOwn(descriptor, 'value') && Number.isSafeInteger(descriptor.value) && descriptor.value >= 0) {
				return descriptor.value;
			}
		}
	} catch {
		// The safe fallback does not expose or trust hostile inspection material.
	}
	return 0;
}

/** @param {string} classification @param {number} revision */
function blockedResult(classification, revision) {
	const reasonCode = classification === 'RELEASE_CHANGED'
		? 'release_changed'
		: classification === 'RECOVERY_REQUIRED'
			? 'recovery_required'
			: 'inspection_ambiguous';
	return Object.freeze({ status: 'uncertain', classification, revision, reasonCode });
}

/** @param {unknown} value */
function exactClassification(value) {
	if (!isPlainDataObject(value)) return 'AMBIGUOUS';
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, 'classification');
		return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
			? descriptor.value
			: 'AMBIGUOUS';
	} catch {
		return 'AMBIGUOUS';
	}
}

/** @param {unknown} value @param {string} name */
function exactOwnBoolean(value, name) {
	if (!isPlainDataObject(value)) return false;
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, name);
		return Boolean(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value === true);
	} catch {
		return false;
	}
}

/** @param {unknown} value @param {string} name */
function exactOwnString(value, name) {
	if (!isPlainDataObject(value)) return null;
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, name);
		return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
			? descriptor.value
			: null;
	} catch {
		return null;
	}
}

/** @param {unknown} value @param {string} name */
function exactOwnInteger(value, name) {
	if (!isPlainDataObject(value)) return null;
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, name);
		return descriptor &&
			Object.hasOwn(descriptor, 'value') &&
			Number.isSafeInteger(descriptor.value) &&
			descriptor.value >= 0
			? descriptor.value
			: null;
	} catch {
		return null;
	}
}

/** @param {unknown} inspection */
function hasForeignSyntheticActors(inspection) {
	if (!isPlainDataObject(inspection)) return true;
	try {
		const descriptor = Object.getOwnPropertyDescriptor(inspection, 'foreignCounts');
		if (!descriptor) return false;
		if (!Object.hasOwn(descriptor, 'value') || !isPlainDataObject(descriptor.value)) return true;
		const countDescriptor = Object.getOwnPropertyDescriptor(descriptor.value, 'syntheticAccounts');
		return !countDescriptor ||
			!Object.hasOwn(countDescriptor, 'value') ||
			!Number.isSafeInteger(countDescriptor.value) ||
			countDescriptor.value < 0 ||
			countDescriptor.value > 0;
	} catch {
		return true;
	}
}

/**
 * Copies an exact plain record through own data descriptors without invoking
 * accessors. The copy is frozen before any semantic validation reads it.
 * @param {unknown} candidate
 * @param {readonly string[]} requiredKeys
 * @param {readonly string[]} [optionalKeys]
 * @returns {Readonly<Record<string, any>>}
 */
function copyExactDataRecord(candidate, requiredKeys, optionalKeys = []) {
	if (!isPlainDataObject(candidate)) fail('provision_evidence_invalid', 10);
	try {
		const keys = Reflect.ownKeys(candidate);
		const allowed = new Set([...requiredKeys, ...optionalKeys]);
		if (
			keys.some((key) => typeof key !== 'string') ||
			!requiredKeys.every((key) => keys.includes(key)) ||
			keys.some((key) => !allowed.has(/** @type {string} */ (key)))
		) {
			fail('provision_evidence_invalid', 10);
		}
		const copy = {};
		for (const key of keys) {
			const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
			if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
				fail('provision_evidence_invalid', 10);
			}
			Object.defineProperty(copy, key, {
				value: descriptor.value,
				enumerable: true,
				writable: false,
				configurable: false
			});
		}
		return Object.freeze(copy);
	} catch (error) {
		if (error instanceof Gate3HostedProvisionError) throw error;
		return fail('provision_evidence_invalid', 10);
	}
}

/** @param {unknown} candidate @returns {readonly any[]} */
function copyExactDataArray(candidate) {
	if (!Array.isArray(candidate) || isProxy(candidate)) fail('provision_evidence_invalid', 10);
	try {
		const keys = Reflect.ownKeys(candidate);
		if (
			keys.some((key) => typeof key !== 'string') ||
			keys.some((key) => key !== 'length' && !/^(0|[1-9]\d*)$/u.test(/** @type {string} */ (key)))
		) {
			fail('provision_evidence_invalid', 10);
		}
		const lengthDescriptor = Object.getOwnPropertyDescriptor(candidate, 'length');
		if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') || !Number.isSafeInteger(lengthDescriptor.value)) {
			fail('provision_evidence_invalid', 10);
		}
		const copy = [];
		for (let index = 0; index < lengthDescriptor.value; index += 1) {
			const descriptor = Object.getOwnPropertyDescriptor(candidate, `${index}`);
			if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
				fail('provision_evidence_invalid', 10);
			}
			copy.push(descriptor.value);
		}
		return Object.freeze(copy);
	} catch (error) {
		if (error instanceof Gate3HostedProvisionError) throw error;
		return fail('provision_evidence_invalid', 10);
	}
}

/**
 * Repairs only the local ciphertext hash after a proven DPAPI-write/state-write
 * crash. It performs no hosted mutation and requires the captured ciphertext to
 * decrypt as the exact run payload with a stored moderator TOTP credential.
 * @param {{ paths: Record<string, string>, inspection: unknown, dpapi: unknown, dependencies: Record<string, any>, assertLockOwned: () => Promise<void> }} options
 */
async function reconcileCredentialStateIfSafe({ paths, inspection, dpapi, dependencies, assertLockOwned }) {
	if (
		exactClassification(inspection) !== 'RECOVERY_REQUIRED' ||
		!exactOwnBoolean(inspection, 'credentialsLost') ||
		!exactOwnBoolean(inspection, 'exactRecoveryProvenance') ||
		exactOwnString(inspection, 'secretStoreStatus') !== 'corrupt' ||
		exactOwnString(inspection, 'manifestBindingStatus') !== 'exact' ||
		exactOwnBoolean(inspection, 'releaseChanged')
	) {
		return false;
	}
	let captured;
	try {
		const readStableSnapshot = dependency(
			dependencies,
			'readStableSnapshot',
			readStableGate3PreflightSnapshot
		);
		captured = await readStableSnapshot(paths);
		const state = captured?.state;
		const secretBytes = captured?.secretBytes;
		const checkpoint = state?.phases?.provision?.checkpoint;
		const checkpointMatch = typeof checkpoint?.step === 'string'
			? /^(assigned-moderator|unassigned-moderator)\.(role-elevated|mfa-unenrolled-recovery)$/u.exec(checkpoint.step)
			: null;
		if (
			!state ||
			state.revision !== safeInspectionRevision(inspection) ||
			state.phases?.provision?.status !== 'in-progress' ||
			!checkpointMatch ||
			checkpoint?.status !== 'confirmed' ||
			checkpoint?.revision !== state.revision ||
			checkpoint?.operationId !== checkpoint.step ||
			!['available', 'persisted'].includes(state.secretStore?.status) ||
			!(secretBytes instanceof Uint8Array) ||
			secretBytes.byteLength === 0
		) {
			return false;
		}
		const ciphertextSha256 = createHash('sha256').update(secretBytes).digest('hex');
		if (ciphertextSha256 === state.secretStore.ciphertextSha256) return false;
		const unprotectBytes = dependency(
			dependencies,
			'unprotectRunSecretBytes',
			unprotectRunSecretBytes
		);
		const payload = await unprotectBytes({ runId: paths.runId, ciphertext: secretBytes, dpapi });
		const pendingRole = checkpointMatch[1];
		const expectedVerifiedFactors = pendingRole === 'assigned-moderator' ? 0 : 1;
		const expectedSecretPattern = pendingRole === 'assigned-moderator'
			? typeof payload.actors?.['assigned-moderator']?.totpSecret === 'string' &&
				payload.actors?.['unassigned-moderator']?.totpSecret === null
			: typeof payload.actors?.['assigned-moderator']?.totpSecret === 'string' &&
				typeof payload.actors?.['unassigned-moderator']?.totpSecret === 'string';
		if (
			payload?.runId !== paths.runId ||
			!expectedSecretPattern ||
			exactOwnInteger(inspection, 'verifiedModeratorTotpFactors') !== expectedVerifiedFactors ||
			exactOwnInteger(inspection, 'moderatorsWithVerifiedTotp') !== expectedVerifiedFactors
		) {
			return false;
		}
		const nextState = {
			...state,
			revision: state.revision + 1,
			secretStore: {
				...state.secretStore,
				status: 'available',
				ciphertextSha256
			}
		};
		await assertLockOwned();
		const writeState = dependency(dependencies, 'writeNextRunState', writeNextRunState);
		await writeState(paths, state, nextState);
		return true;
	} catch (error) {
		if (error instanceof Gate3HostedProvisionError) throw error;
		return false;
	} finally {
		captured?.secretBytes?.fill?.(0);
	}
}

/** @param {unknown} value */
function exactRequiredConsents(value) {
	const input = copyExactDataArray(value);
	if (input.length === 0 || input.length > 32) {
		fail('provision_evidence_invalid', 10);
	}
	const documents = input.map((document) => {
		const exact = copyExactDataRecord(document, ['documentCode', 'documentVersion']);
		const code = exact.documentCode;
		const version = exact.documentVersion;
		if (
			typeof code !== 'string' ||
			!/^[a-z][a-z0-9_]{1,63}$/u.test(code) ||
			typeof version !== 'string' ||
			version.length === 0 ||
			version.length > 80 ||
			version.trim() !== version
		) {
			fail('provision_evidence_invalid', 10);
		}
		return Object.freeze({ documentCode: code, documentVersion: version });
	});
	const tokens = documents.map((entry) => `${entry.documentCode}-${entry.documentVersion}`);
	if (new Set(tokens).size !== tokens.length) fail('provision_evidence_invalid', 10);
	return Object.freeze(
		[...documents].sort((left, right) =>
			`${left.documentCode}\0${left.documentVersion}`.localeCompare(`${right.documentCode}\0${right.documentVersion}`, 'en')
		)
	);
}

/** @param {unknown} value */
function exactProvisionSnapshot(value) {
	const exact = copyExactDataRecord(value, ['requiredConsents', 'exactRecoveryProvenance', 'actors']);
	const requiredConsents = exactRequiredConsents(exact.requiredConsents);
	const consentTokens = new Set(
		requiredConsents.map(({ documentCode, documentVersion }) => `${documentCode}-${documentVersion}`)
	);
	if (typeof exact.exactRecoveryProvenance !== 'boolean') {
		fail('provision_evidence_invalid', 10);
	}
	const actorMap = copyExactDataRecord(exact.actors, ACTOR_ROLES);
	/** @type {Record<string, any>} */
	const actors = {};
	for (const role of ACTOR_ROLES) {
		const actor = copyExactDataRecord(
			actorMap[role],
			[
				'auth',
				'manifest',
				'registrationClaimed',
				'acceptedConsents',
				'onboardingComplete',
				'profileRole',
				'mfa',
				'actorVerified'
			],
			['userId', 'createdAt']
		);
		const mfa = copyExactDataRecord(actor.mfa, ['status', 'secretStatus']);
		const acceptedConsents = copyExactDataArray(actor.acceptedConsents);
		if ((Object.hasOwn(actor, 'userId') !== Object.hasOwn(actor, 'createdAt'))) {
			fail('provision_evidence_invalid', 10);
		}
		if (
			!['absent', 'confirmed', 'uncertain', 'conflict'].includes(actor.auth) ||
			!['absent', 'pending', 'confirmed', 'conflict'].includes(actor.manifest) ||
			![true, false, 'uncertain'].includes(actor.registrationClaimed) ||
			acceptedConsents.some((entry) => typeof entry !== 'string') ||
			![true, false, 'uncertain'].includes(actor.onboardingComplete) ||
			!['absent', 'user', 'moderator', 'uncertain'].includes(actor.profileRole) ||
			!['not-required', 'absent', 'unverified', 'verified', 'uncertain', 'duplicate'].includes(mfa.status) ||
			!['not-required', 'available', 'missing', 'corrupt'].includes(mfa.secretStatus) ||
			![true, false, 'uncertain'].includes(actor.actorVerified)
		) {
			fail('provision_evidence_invalid', 10);
		}
		if (
			new Set(acceptedConsents).size !== acceptedConsents.length ||
			acceptedConsents.some((entry) => !consentTokens.has(entry)) ||
			(MODERATOR_ROLES.has(role)
				? mfa.status === 'not-required' || mfa.secretStatus === 'not-required'
				: mfa.status !== 'not-required' || mfa.secretStatus !== 'not-required')
		) {
			fail('provision_evidence_invalid', 10);
		}
		if (
			(actor.auth === 'confirmed' &&
				(typeof actor.userId !== 'string' || typeof actor.createdAt !== 'string')) &&
			actor.manifest !== 'confirmed'
		) {
			// A hosted-only actor after a crash must still provide exact coordinates for manifest repair.
			fail('provision_evidence_invalid', 10);
		}
		actors[role] = Object.freeze({
			...actor,
			acceptedConsents,
			mfa
		});
	}
	return Object.freeze({
		requiredConsents,
		exactRecoveryProvenance: exact.exactRecoveryProvenance,
		actors: Object.freeze(actors)
	});
}

/** @param {Record<string, any>} manifest @param {ReturnType<typeof exactProvisionSnapshot>} snapshot */
function assertSnapshotMatchesManifest(manifest, snapshot) {
	if (!isPlainDataObject(manifest) || !Array.isArray(manifest.actors) || !Array.isArray(manifest.pendingActors)) {
		fail('provision_evidence_invalid', 10);
	}
	for (const role of ACTOR_ROLES) {
		const actorEntries = manifest.actors.filter((/** @type {any} */ entry) => entry?.role === role);
		const pendingEntries = manifest.pendingActors.filter((/** @type {any} */ entry) => entry?.role === role);
		if (actorEntries.length > 1 || pendingEntries.length > 1 || (actorEntries.length > 0 && pendingEntries.length > 0)) {
			fail('provision_evidence_invalid', 20);
		}
		const evidence = snapshot.actors[role];
		if (evidence.manifest === 'confirmed') {
			if (
				actorEntries.length !== 1 ||
				evidence.auth !== 'confirmed' ||
				(typeof evidence.userId === 'string' && actorEntries[0].userId !== evidence.userId) ||
				(typeof evidence.createdAt === 'string' && actorEntries[0].createdAt !== evidence.createdAt)
			) {
				fail('provision_evidence_invalid', 20);
			}
		} else if (evidence.manifest === 'pending') {
			if (pendingEntries.length !== 1 || actorEntries.length !== 0) fail('provision_evidence_invalid', 20);
		} else if (evidence.manifest === 'absent' && (actorEntries.length !== 0 || pendingEntries.length !== 0)) {
			fail('provision_evidence_invalid', 20);
		}
	}
}

/** @param {string} role @param {ReturnType<typeof exactProvisionSnapshot>} snapshot @param {string | null} checkpointStep */
function actorSteps(role, snapshot, checkpointStep) {
	const actor = snapshot.actors[role];
	const steps = [
		'auth-created',
		'registration-claimed',
		...snapshot.requiredConsents.map(({ documentCode, documentVersion }) =>
			`consent-${documentCode}-${documentVersion}`
		),
		'onboarding-complete'
	];
	if (MODERATOR_ROLES.has(role)) {
		steps.push('role-elevated');
		if (
			(actor.mfa.status === 'unverified' && ['missing', 'corrupt'].includes(actor.mfa.secretStatus)) ||
			checkpointStep === `${role}.mfa-unenrolled-recovery`
		) {
			steps.push('mfa-unenrolled-recovery');
		}
		steps.push('mfa-enrolled', 'mfa-verified');
	}
	steps.push('actor-verified');
	return steps;
}

/** @param {string} role @param {string} step @param {ReturnType<typeof exactProvisionSnapshot>} snapshot */
function evidenceOutcome(role, step, snapshot) {
	const actor = snapshot.actors[role];
	if (actor.auth === 'conflict' || actor.manifest === 'conflict') return 'uncertain';
	if (step === 'auth-created') {
		if (actor.auth === 'confirmed') return 'confirmed';
		return actor.auth === 'absent' && ['absent', 'pending'].includes(actor.manifest)
			? 'confirmed-absent'
			: 'uncertain';
	}
	if (actor.auth !== 'confirmed' || actor.manifest !== 'confirmed') return 'uncertain';
	if (step === 'registration-claimed') return actor.registrationClaimed === true ? 'confirmed' : actor.registrationClaimed === false ? 'confirmed-absent' : 'uncertain';
	if (step.startsWith('consent-')) {
		const token = step.slice('consent-'.length);
		return actor.acceptedConsents.includes(token) ? 'confirmed' : 'confirmed-absent';
	}
	if (step === 'onboarding-complete') return actor.onboardingComplete === true ? 'confirmed' : actor.onboardingComplete === false ? 'confirmed-absent' : 'uncertain';
	if (step === 'role-elevated') return actor.profileRole === 'moderator' ? 'confirmed' : actor.profileRole === 'user' ? 'confirmed-absent' : 'uncertain';
	if (step === 'mfa-unenrolled-recovery') return actor.mfa.status === 'absent' ? 'confirmed' : actor.mfa.status === 'unverified' && ['missing', 'corrupt'].includes(actor.mfa.secretStatus) ? 'confirmed-absent' : 'uncertain';
	if (step === 'mfa-enrolled') return ['unverified', 'verified'].includes(actor.mfa.status) && actor.mfa.secretStatus === 'available' ? 'confirmed' : actor.mfa.status === 'absent' ? 'confirmed-absent' : 'uncertain';
	if (step === 'mfa-verified') return actor.mfa.status === 'verified' ? 'confirmed' : actor.mfa.status === 'unverified' && actor.mfa.secretStatus === 'available' ? 'confirmed-absent' : 'uncertain';
	if (step === 'actor-verified') return actor.actorVerified === true ? 'confirmed' : actor.actorVerified === false ? 'confirmed-absent' : 'uncertain';
	return 'uncertain';
}

/** @param {Record<string, any>} state @param {ReturnType<typeof exactProvisionSnapshot>} snapshot */
function deriveNextBoundary(state, snapshot) {
	const checkpointStep = typeof state?.phases?.provision?.checkpoint?.step === 'string'
		? state.phases.provision.checkpoint.step
		: null;
	const sequence = ACTOR_ROLES.flatMap((role) =>
		actorSteps(role, snapshot, checkpointStep).map((step) => Object.freeze({ role, step }))
	);
	let nextIndex = 0;
	if (checkpointStep !== null) {
		const checkpointIndex = sequence.findIndex(({ role, step }) => `${role}.${step}` === checkpointStep);
		if (checkpointIndex < 0) fail('provision_checkpoint_ambiguous', 20);
		nextIndex = checkpointIndex + 1;
	}
	for (let index = 0; index < nextIndex; index += 1) {
		const prior = sequence[index];
		if (evidenceOutcome(prior.role, prior.step, snapshot) !== 'confirmed') {
			fail('provision_checkpoint_ambiguous', 20);
		}
	}
	if (nextIndex >= sequence.length) return null;
	const next = sequence[nextIndex];
	return Object.freeze({ ...next, outcome: evidenceOutcome(next.role, next.step, snapshot), final: nextIndex === sequence.length - 1 });
}

/** @param {unknown} candidate */
function exactProviderCapabilities(candidate) {
	const exact = exactFrozenRecord(candidate, PROVIDER_CAPABILITY_KEYS, 'provision_capability_invalid');
	if ((exact.mutate !== null && (typeof exact.mutate !== 'function' || isProxy(exact.mutate))) || typeof exact.readBack !== 'function' || isProxy(exact.readBack)) {
		fail('provision_capability_invalid', 10);
	}
	return exact;
}

/** @param {Record<string, any>} state @param {Record<string, any>} patch */
function nextProvisionState(state, patch) {
	const revision = state.revision + 1;
	return {
		...state,
		revision,
		manifest: patch.manifest ?? state.manifest,
		secretStore: patch.secretStore ?? state.secretStore,
		phases: {
			...state.phases,
			provision: {
				status: patch.complete ? 'complete' : 'in-progress',
				checkpoint: {
					observedAt: patch.observedAt,
					status: 'confirmed',
					phase: 'provision',
					step: `${patch.role}.${patch.step}`,
					reasonCode: 'provision_boundary_confirmed',
					revision,
					operationId: `${patch.role}.${patch.step}`
				}
			}
		}
	};
}

/** @param {Record<string, any>} dependencies @param {string} name @param {Function} fallback */
function dependency(dependencies, name, fallback) {
	const value = dependencies[name] ?? fallback;
	if (typeof value !== 'function') fail('provision_precondition_failed', 10);
	return value;
}

/** @param {unknown} value */
function defaultManifestHash(value) {
	return createHash('sha256').update(`${JSON.stringify(value)}\n`).digest('hex');
}

/** @param {Record<string, any>} manifest @param {string} expectedSha256 */
function exactActorManifestPredecessor(manifest, expectedSha256) {
	if (!Array.isArray(manifest.actors) || manifest.actors.length === 0) return null;
	const actor = manifest.actors.at(-1);
	if (!actor || !ACTOR_ROLE_SET.has(actor.role)) return null;
	const candidates = [
		{ ...manifest, actors: manifest.actors.slice(0, -1) },
		{
			...manifest,
			pendingActors: [
				...manifest.pendingActors,
				{ role: actor.role, provisioningAttemptId: manifest.provisioningAttemptId }
			],
			actors: manifest.actors.slice(0, -1)
		}
	];
	return candidates.some((candidate) => defaultManifestHash(candidate) === expectedSha256)
		? Object.freeze({ role: actor.role, userId: actor.userId, createdAt: actor.createdAt })
		: null;
}

/**
 * Repairs only the exact actor-manifest write that is one durable step ahead of
 * state. Hosted evidence must confirm that same actor and next checkpoint.
 * @param {{ paths: Record<string, string>, inspection: unknown, commandCaps: Record<string, Function>, dependencies: Record<string, any>, assertLockOwned: () => Promise<void> }} options
 */
async function reconcileManifestAheadIfSafe({
	paths,
	inspection,
	commandCaps,
	dependencies,
	assertLockOwned
}) {
	if (
		exactClassification(inspection) !== 'AMBIGUOUS' ||
		exactOwnString(inspection, 'manifestBindingStatus') !== 'manifest-ahead-state' ||
		!exactOwnBoolean(inspection, 'manifestAheadState') ||
		exactOwnBoolean(inspection, 'releaseChanged')
	) {
		return false;
	}
	try {
		await assertLockOwned();
		const readState = dependency(dependencies, 'readRunState', readRunState);
		const state = await readState(paths);
		if (state.revision !== safeInspectionRevision(inspection) || typeof state.manifest?.sha256 !== 'string') {
			return false;
		}
		const loadManifest = dependency(dependencies, 'loadManifest', loadHostedRunManifest);
		const manifest = await loadManifest(
			Object.freeze({ target: HOSTED_STAGING, runId: paths.runId }),
			paths.manifestPath
		);
		const hashManifest = dependency(dependencies, 'hashManifest', defaultManifestHash);
		const currentSha256 = hashManifest(manifest);
		if (
			typeof currentSha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(currentSha256) ||
			currentSha256 !== exactOwnString(inspection, 'manifestSha256')
		) {
			return false;
		}
		const actor = exactActorManifestPredecessor(manifest, state.manifest.sha256);
		if (!actor) return false;
		const snapshot = exactProvisionSnapshot(
			await commandCaps.inspectProvision({ inspection, state, manifest })
		);
		assertSnapshotMatchesManifest(manifest, snapshot);
		const next = deriveNextBoundary(state, snapshot);
		if (
			!next ||
			next.step !== 'auth-created' ||
			next.role !== actor.role ||
			next.outcome !== 'confirmed' ||
			snapshot.actors[next.role].userId !== actor.userId ||
			snapshot.actors[next.role].createdAt !== actor.createdAt
		) {
			return false;
		}
		const observedAt = dependency(dependencies, 'now', () => new Date().toISOString())();
		if (typeof observedAt !== 'string' || Number.isNaN(Date.parse(observedAt))) return false;
		const nextState = nextProvisionState(state, {
			role: next.role,
			step: next.step,
			complete: false,
			observedAt,
			manifest: { ...state.manifest, sha256: currentSha256 }
		});
		await assertLockOwned();
		const writeState = dependency(dependencies, 'writeNextRunState', writeNextRunState);
		await writeState(paths, state, nextState);
		return true;
	} catch (error) {
		if (error instanceof Gate3HostedProvisionError) throw error;
		return false;
	}
}

/**
 * Advances one already-confirmed durable checkpoint without exposing a hosted
 * mutation capability. Returns true when state advanced.
 * @param {{ paths: Record<string, string>, inspection: unknown, commandCaps: Record<string, Function>, dependencies: Record<string, any>, assertLockOwned: () => Promise<void> }} options
 */
async function catchUpVerifiedState({ paths, inspection, commandCaps, dependencies, assertLockOwned }) {
	await assertLockOwned();
	const readState = dependency(dependencies, 'readRunState', readRunState);
	const state = await readState(paths);
	if (state.revision !== safeInspectionRevision(inspection)) fail('provision_checkpoint_ambiguous', 20);
	const loadManifest = dependency(dependencies, 'loadManifest', loadHostedRunManifest);
	const manifest = await loadManifest(
		Object.freeze({ target: HOSTED_STAGING, runId: paths.runId }),
		paths.manifestPath
	);
	const snapshot = exactProvisionSnapshot(
		await commandCaps.inspectProvision({ inspection, state, manifest })
	);
	assertSnapshotMatchesManifest(manifest, snapshot);
	const next = deriveNextBoundary(state, snapshot);
	if (next === null) {
		if (
			state.phases?.provision?.status !== 'complete' ||
			state.phases?.provision?.checkpoint?.step !== 'unassigned-moderator.actor-verified'
		) {
			fail('provision_checkpoint_ambiguous', 20);
		}
		return false;
	}
	if (next.outcome !== 'confirmed') fail('provision_checkpoint_ambiguous', 20);
	const observedAt = dependency(dependencies, 'now', () => new Date().toISOString())();
	if (typeof observedAt !== 'string' || Number.isNaN(Date.parse(observedAt))) {
		fail('provision_persistence_uncertain', 41);
	}
	const nextState = nextProvisionState(state, {
		role: next.role,
		step: next.step,
		complete: next.final,
		observedAt
	});
	await assertLockOwned();
	const writeState = dependency(dependencies, 'writeNextRunState', writeNextRunState);
	await writeState(paths, state, nextState);
	return true;
}

/**
 * Holds the per-run lock while repeatedly returning through fresh inspection and
 * command-level lifecycle authorization between single A9 boundaries.
 * @param {{ paths: Record<string, string>, inspectionAdapter: unknown, provisionCapabilities: unknown, dpapi: unknown, dependencies?: Record<string, any> }} options
 */
export async function runProvisionCommand({
	paths,
	inspectionAdapter,
	provisionCapabilities,
	dpapi,
	dependencies = {}
}) {
	if (!isPlainDataObject(paths) || typeof paths.runId !== 'string' || !RUN_ID_PATTERN.test(paths.runId)) {
		fail('provision_precondition_failed', 10);
	}
	const commandCaps = exactCommandCapabilities(provisionCapabilities);
	const acquire = dependency(dependencies, 'acquireRunLock', acquireRunLock);
	const release = dependency(dependencies, 'releaseRunLock', releaseRunLock);
	let acquiredLock;
	try {
		acquiredLock = await acquire({ paths, command: 'provision' });
	} catch {
		fail('active_run_locked', 10);
	}
	let primaryError = null;
	const assertLockOwned = async () => {
		try {
			const inspectLock = dependency(dependencies, 'inspectRunLock', inspectRunLock);
			const current = await inspectLock({ paths });
			if (
				!isPlainDataObject(current) ||
				current.status !== 'held' ||
				typeof current.acquiredBytes !== 'string' ||
				current.acquiredBytes !== acquiredLock?.acquiredBytes
			) {
				fail('run_lock_lost', 41);
			}
		} catch (error) {
			if (error instanceof Gate3HostedProvisionError) throw error;
			fail('run_lock_lost', 41);
		}
	};
	try {
		for (let boundaryCount = 0; boundaryCount < 256; boundaryCount += 1) {
			await assertLockOwned();
			const inspect = dependency(
				dependencies,
				'inspectRun',
				(/** @type {any} */ scope) => inspectGate3HostedRun(scope)
			);
			let inspection;
			try {
				inspection = await inspect({ paths, inspectionAdapter });
			} catch {
				return blockedResult('AMBIGUOUS', 0);
			}
			const classification = exactClassification(inspection);
			const inspectionRevision = safeInspectionRevision(inspection);
			if (hasForeignSyntheticActors(inspection)) {
				return blockedResult('AMBIGUOUS', inspectionRevision);
			}
			if (
				await reconcileManifestAheadIfSafe({
					paths,
					inspection,
					commandCaps,
					dependencies,
					assertLockOwned
				})
			) {
				continue;
			}
			if (
				classification === 'RECOVERY_REQUIRED' &&
				(await reconcileCredentialStateIfSafe({
					paths,
					inspection,
					dpapi,
					dependencies,
					assertLockOwned
				}))
			) {
				continue;
			}
			if (classification === 'PROVISION_VERIFIED') {
				if (
					await catchUpVerifiedState({
						paths,
						inspection,
						commandCaps,
						dependencies,
						assertLockOwned
					})
				) {
					continue;
				}
				return Object.freeze({
					status: 'confirmed',
					classification,
					revision: inspectionRevision,
					reasonCode: 'provision_verified'
				});
			}
			if (BLOCKED_CLASSIFICATIONS.has(classification) || !ALLOWED_CLASSIFICATIONS.has(classification)) {
				return blockedResult(
					BLOCKED_CLASSIFICATIONS.has(classification) ? classification : 'AMBIGUOUS',
					inspectionRevision
				);
			}
			const select = dependency(dependencies, 'selectNextProvisionStep', selectNextProvisionStep);
			let commandAuthorization;
			try {
				commandAuthorization = select(inspection);
			} catch {
				return blockedResult('AMBIGUOUS', inspectionRevision);
			}
			if (
				!isPlainDataObject(commandAuthorization) ||
				commandAuthorization.command !== 'provision' ||
				commandAuthorization.phase !== 'provision'
			) {
				return blockedResult('AMBIGUOUS', inspectionRevision);
			}

			const readState = dependency(dependencies, 'readRunState', readRunState);
			let state;
			try {
				state = await readState(paths);
				safeInteger(state.revision, 'provision_precondition_failed');
				if (state.revision !== inspectionRevision) return blockedResult('AMBIGUOUS', inspectionRevision);
			} catch (error) {
				if (error instanceof Gate3HostedProvisionError) throw error;
				return blockedResult('AMBIGUOUS', inspectionRevision);
			}
			let manifest;
			try {
				const manifestConfig = Object.freeze({ target: HOSTED_STAGING, runId: paths.runId });
				const loadManifest = dependency(dependencies, 'loadManifest', loadHostedRunManifest);
				manifest = await loadManifest(manifestConfig, paths.manifestPath);
			} catch (error) {
				if (error instanceof Gate3HostedProvisionError) throw error;
				return blockedResult('AMBIGUOUS', inspectionRevision);
			}
			let payload;
			try {
				const unprotect = dependency(dependencies, 'unprotectRunSecrets', unprotectRunSecrets);
				payload = await unprotect({ runId: paths.runId, path: paths.secretPath, dpapi });
			} catch (error) {
				if (error instanceof Gate3HostedProvisionError) throw error;
				return blockedResult(
					exactOwnBoolean(inspection, 'exactRecoveryProvenance')
						? 'RECOVERY_REQUIRED'
						: 'AMBIGUOUS',
					inspectionRevision
				);
			}

			/** @type {ReturnType<typeof exactProvisionSnapshot>} */
			let snapshot;
			try {
				snapshot = exactProvisionSnapshot(
					await commandCaps.inspectProvision({ inspection, state, manifest })
				);
				assertSnapshotMatchesManifest(manifest, snapshot);
			} catch (error) {
				if (error instanceof Gate3HostedProvisionError) throw error;
				fail('provision_evidence_invalid', 10);
			}
			const next = deriveNextBoundary(state, snapshot);
			if (next === null) return blockedResult('AMBIGUOUS', state.revision);
			if (next.outcome === 'uncertain') return blockedResult('AMBIGUOUS', state.revision);
			const authorization = Object.freeze({
				command: 'provision',
				phase: 'provision',
				role: next.role,
				step: next.step,
				operationId: `${next.role}.${next.step}`,
				revision: state.revision
			});
			await assertLockOwned();
			let providerCaps;
			try {
				providerCaps = exactProviderCapabilities(
					commandCaps.mutationFor({
						authorization,
						inspection,
						manifest,
						credential: payload.actors?.[next.role],
						consent: next.step.startsWith('consent-')
							? snapshot.requiredConsents.find(
								({ documentCode, documentVersion }) =>
									next.step === `consent-${documentCode}-${documentVersion}`
							)
							: null
					})
				);
			} catch (error) {
				if (error instanceof Gate3HostedProvisionError) throw error;
				fail('provision_capability_invalid', 10);
			}
			if ((next.step === 'actor-verified') !== (providerCaps.mutate === null)) {
				fail('provision_capability_invalid', 10);
			}

			let nextManifest = manifest;
			let manifestSha256 = state.manifest.sha256;
			let nextPayload = payload;
			/** @type {{ status: string, ciphertextSha256: string } | null} */
			let secretMetadata = null;
			const composed = Object.freeze({
				mutate:
					providerCaps.mutate === null
						? null
						: async () => {
							await assertLockOwned();
							return providerCaps.mutate();
						},
				readBack: async (/** @type {any} */ input) => {
					await assertLockOwned();
					return providerCaps.readBack(input);
				},
				persistCredential:
					next.step === 'mfa-enrolled'
						? async (/** @type {any} */ mutationResult) => {
							try {
								await assertLockOwned();
								const recordSecret = dependency(
									dependencies,
									'recordProviderTotpSecret',
									recordProviderTotpSecret
								);
								nextPayload = recordSecret({
									payload,
									role: next.role,
									secret: mutationResult?.secret
								});
								const protect = dependency(dependencies, 'protectRunSecrets', protectRunSecrets);
								secretMetadata = await protect({
									payload: nextPayload,
									path: state.secretStore.path,
									dpapi
								});
								return secretMetadata;
							} catch {
								fail('credential_persistence_failed', 41);
							}
						}
						: null,
				persistManifest:
					next.step === 'auth-created'
						? async (/** @type {{ mutationResult: any, readBackResult: any }} */ { mutationResult, readBackResult }) => {
							await assertLockOwned();
							const evidenceActor = selectConfirmedActorCoordinates(
								mutationResult,
								readBackResult,
								next.role,
								snapshot.actors[next.role]
							);
							const existing = manifest.actors?.find((/** @type {any} */ actor) => actor.role === next.role);
							if (existing) {
								if (
									existing.userId !== evidenceActor?.userId ||
									existing.createdAt !== evidenceActor?.createdAt
								) {
									fail('provision_evidence_invalid', 20);
								}
								nextManifest = manifest;
							} else {
								nextManifest = registerHostedActor(
									manifest,
									next.role,
									evidenceActor?.userId,
									evidenceActor?.createdAt
								);
							}
							const persistManifest = dependency(
								dependencies,
								'persistManifest',
								persistHostedRunManifest
							);
							await persistManifest(
								Object.freeze({ target: HOSTED_STAGING, runId: paths.runId }),
								nextManifest,
								paths.manifestPath
							);
							const hashManifest = dependency(
								dependencies,
								'hashManifest',
								(/** @type {unknown} */ value) => createHash('sha256').update(`${JSON.stringify(value)}\n`).digest('hex')
							);
							manifestSha256 = hashManifest(nextManifest);
							if (typeof manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(manifestSha256)) {
								fail('provision_persistence_uncertain', 41);
							}
						}
						: null,
				persistState: async () => {
					await assertLockOwned();
					const observedAt = dependency(dependencies, 'now', () => new Date().toISOString())();
					if (typeof observedAt !== 'string' || Number.isNaN(Date.parse(observedAt))) {
						fail('provision_persistence_uncertain', 41);
					}
					const nextState = nextProvisionState(state, {
						role: next.role,
						step: next.step,
						complete: next.final,
						observedAt,
						manifest:
							next.step === 'auth-created'
								? { ...state.manifest, sha256: manifestSha256 }
								: state.manifest,
						secretStore:
							secretMetadata === null
								? state.secretStore
								: {
									...state.secretStore,
									status: secretMetadata.status,
									ciphertextSha256: secretMetadata.ciphertextSha256
								}
					});
					const writeState = dependency(dependencies, 'writeNextRunState', writeNextRunState);
					await writeState(paths, state, nextState);
				}
			});
			const result = await runProvisionBoundary({
				inspection: Object.freeze({
					classification,
					revision: state.revision,
					role: next.role,
					step: next.step,
					outcome: next.outcome
				}),
				authorization,
				capabilities: composed
			});
			if (result.status === 'confirmed-absent') fail(result.reasonCode, 40);
			if (result.status === 'uncertain') fail(result.reasonCode, 41);
		}
		fail('provision_boundary_limit_exceeded', 41);
	} catch (error) {
		primaryError = error;
		if (error instanceof Gate3HostedProvisionError) throw error;
		fail('provision_precondition_failed', 10);
	} finally {
		try {
			const released = await release({ paths, acquiredLock });
			if (released !== true && primaryError === null) fail('run_lock_release_failed', 10);
		} catch {
			if (primaryError === null) fail('run_lock_release_failed', 10);
		}
	}
}
