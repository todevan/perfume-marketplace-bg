import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
	A10_STEP_REGISTRY,
	runScenarioBoundary,
	runScenarioCommand
} from '../../scripts/gate3-hosted-scenario-runner.mjs';
import { selectNextScenarioStep } from '../../scripts/gate3-hosted-lifecycle.mjs';
import { inspectGate3HostedRun } from '../../scripts/gate3-hosted-inspector.mjs';
import { readRunState, reserveRunState, resolveGate3RunPaths, writeNextRunState } from '../../scripts/gate3-hosted-state.mjs';
import {
	HOSTED_STAGING,
	createHostedA10ExecutionContext,
	createHostedRunManifest,
	createSupabaseHostedEvidenceAdapters,
	persistHostedRunManifest,
	registerHostedActor,
	registerHostedQueueRow,
	registerHostedReport,
	registerHostedUpload
} from '../../scripts/hosted-report-evidence-operator.mjs';

const EXPECTED_IDS = [
	'primary-report-created',
	'primary-upload-attached-verified',
	'cross-user-storage-denied',
	'duplicate-reuse-denied',
	'duplicate-upload-created',
	'duplicate-upload-reconciled',
	'assigned-moderator-aal1-denied',
	'assignment-applied',
	'assigned-moderator-read-verified',
	'unassigned-moderator-denied',
	'rejected-upload-created',
	'manual-cleanup-verified',
	'abandoned-upload-allocated',
	'abandoned-object-created',
	'abandoned-upload-backdated',
	'scheduled-cleanup-verified',
	'malformed-request-rejected',
	'invalid-image-rejected',
	'per-file-limit-rejected',
	'aggregate-limit-rejected',
	'chunked-limit-rejected',
	'understated-length-rejected'
] as const;

let reportTokenSequence = 0;
function freshReportTokenProvider() {
	return Object.freeze({ freshReportToken: vi.fn(async () => `turnstile-token-${++reportTokenSequence}-${'x'.repeat(24)}`) });
}

describe('Gate 3 hosted A10 scenario registry', () => {
	it('defines the complete stable checkpoint order as inert deeply frozen data', () => {
		expect(A10_STEP_REGISTRY.map((step) => step.id)).toEqual(EXPECTED_IDS);
		expect(Object.isFrozen(A10_STEP_REGISTRY)).toBe(true);
		for (const [index, step] of A10_STEP_REGISTRY.entries()) {
			expect(Object.keys(step)).toEqual([
				'id',
				'scenario',
				'kind',
				'prerequisiteIds',
				'roleCapability',
				'mutationMethod',
				'readBackMethod',
				'manifestReducer'
			]);
			expect(Object.isFrozen(step)).toBe(true);
			expect(Object.isFrozen(step.prerequisiteIds)).toBe(true);
			expect(step.prerequisiteIds).toEqual(index === 0 ? [] : [EXPECTED_IDS[index - 1]]);
			expect(typeof step.readBackMethod).toBe('string');
			expect(typeof step.roleCapability).toBe('string');
			expect(step.kind === 'mutation' ? typeof step.mutationMethod : step.mutationMethod).toBe(
				step.kind === 'mutation' ? 'string' : null
			);
			expect(Object.values(step).every((value) => typeof value !== 'function')).toBe(true);
		}
	});

	it('matches every literal A10 checkpoint field mechanically', () => {
		const expected = [
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
		] as const;
		expect(A10_STEP_REGISTRY).toEqual(expected.map(([id, scenario, kind, roleCapability, mutationMethod, readBackMethod, manifestReducer], index) => ({
			id,
			scenario,
			kind,
			prerequisiteIds: index === 0 ? [] : [expected[index - 1][0]],
			roleCapability,
			mutationMethod,
			readBackMethod,
			manifestReducer
		})));
	});
});

const emptyCounts = Object.freeze({
	accounts: 0,
	reports: 0,
	uploads: 0,
	objects: 0,
	queueRows: 0,
	foreignArtifacts: 0,
	preExistingAccounts: 0
});

const exactCoordinates = Object.freeze({
	runId: 'gate3-20260822-abcdef12',
	projectRef: 'nuhkpqjjyuygiemrxbdp',
	supabaseUrl: 'https://nuhkpqjjyuygiemrxbdp.supabase.co',
	workerOrigin: 'https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev',
	releaseCommitSha: 'b'.repeat(40),
	stateRevision: 7,
	stateSha256: 'c'.repeat(64),
	manifestPath: 'C:/private/manifest.json',
	manifestSha256: 'd'.repeat(64),
	inspectionNonce: 'e'.repeat(64),
	checkpointObservedAfter: '2026-08-22T19:00:00.000Z'
});

function receipt(checkpointId = A10_STEP_REGISTRY[0].id) {
	const step = A10_STEP_REGISTRY.find((entry) => entry.id === checkpointId) ?? A10_STEP_REGISTRY[0];
	return {
		event: `hosted_scenario_${step.scenario}`,
		runId: 'gate3-20260822-abcdef12',
		actorRole: step.roleCapability,
		status: 'PASS',
		boundary: 'HTTP',
		actualResult: 'HTTP 200',
		requestId: 'not-exposed',
		before: emptyCounts,
		after: emptyCounts,
		cleanup: 'pending-A11',
		checkpointId
	};
}

const authorizationInspections = new WeakMap<object, object>();

function authorization(index = 0, mode: 'mutate' | 'reconcile' = 'mutate') {
	const inspected = {
			actors: 4,
			provisionVerified: true,
			scenarioPartial: index > 0,
			scenarioVerified: false,
			cleanupRequired: false,
			cleanupPartial: false,
			cleanupVerified: false,
			archived: false,
			ambiguous: false,
			releaseMismatch: false,
			credentialsLost: false,
			exactRecoveryProvenance: false,
			manifestMatches: true,
			ownershipConflict: false,
			deletionScopeTrusted: true,
			authoritativeReleaseAvailable: true,
			...exactCoordinates,
			boundReleaseCommitSha: exactCoordinates.releaseCommitSha,
			currentReleaseCommitSha: exactCoordinates.releaseCommitSha,
			stateValid: true,
			stateCorrupt: false,
			corruptState: false,
			manifestValid: true,
			manifestBindingStatus: 'exact',
			manifestExactMatch: true,
			manifestAheadState: false,
			manifestMismatch: false,
			authoritativeReleaseUnavailable: false,
			releaseChanged: false,
			hostedEvidenceAvailable: true,
			cleanupCompleteContradiction: false,
			duplicateRoles: 0,
			metadataMismatches: 0,
			actorIdentityConflicts: 0,
			manifestActorsAbsent: 0,
			hostedActorsManifestStale: 0
		};
	const selected = selectNextScenarioStep(
		inspected,
		A10_STEP_REGISTRY,
		{
			completedCheckpointIds: A10_STEP_REGISTRY.slice(0, index).map((entry) => entry.id),
			hostedCheckpointId: mode === 'reconcile' ? A10_STEP_REGISTRY[index].id : null,
			manifestCheckpointId: null,
			...exactCoordinates
		}
	);
	if (!selected) throw new Error('test authorization unavailable');
	authorizationInspections.set(selected, inspected);
	return selected;
}

function boundaryRequest(selected: object, capabilities: object) {
	return { inspection: authorizationInspections.get(selected), authorization: selected, capabilities };
}

function boundaryCapabilities(overrides: Record<string, unknown> = {}) {
	const events: string[] = [];
	return {
		events,
		capabilities: {
			roleCapability: 'reporter',
			mutation: vi.fn(async () => {
				events.push('mutation');
			}),
			readBack: vi.fn(async () => {
				events.push('readback');
				return { outcome: 'confirmed', manifestEvidence: null, receipt: receipt() };
			}),
			reduceManifest: vi.fn(() => {
				events.push('reducer');
				return { exact: 'manifest' };
			}),
			persistManifest: vi.fn(async () => {
				events.push('manifest');
			}),
			persistState: vi.fn(async () => {
				events.push('state');
			}),
			...overrides
		}
	};
}

	describe('one-boundary A10 authority and outcomes', () => {
	it('rejects a boundary call that omits the exact inspection used for lifecycle selection', async () => {
		const denied = boundaryCapabilities();
		await expect(runScenarioBoundary({ authorization: authorization(), capabilities: denied.capabilities } as never))
			.rejects.toMatchObject({ reasonCode: 'scenario_authorization_invalid', exitCode: 10 });
		expect(denied.events).toEqual([]);
	});

	it('consumes only the exact lifecycle-selected canonical registry entry', async () => {
		const exact = boundaryCapabilities();
		const selected = authorization();
		await expect(
			runScenarioBoundary(boundaryRequest(selected, exact.capabilities))
		).resolves.toMatchObject({ status: 'confirmed', exitCode: 0, checkpointId: 'primary-report-created' });

		for (const [original, forged] of [
			((value) => [value, { ...value, checkpoint: { ...A10_STEP_REGISTRY[0] } }])(authorization()),
			((value) => [value, { ...value, checkpoint: A10_STEP_REGISTRY[1] }])(authorization()),
			((value) => [value, { ...value, checkpoint: A10_STEP_REGISTRY[0], revision: 8 }])(authorization()),
			((value) => [value, { ...value, checkpoint: A10_STEP_REGISTRY[0], mode: 'skip' }])(authorization())
		]) {
			const denied = boundaryCapabilities();
			await expect(
				runScenarioBoundary({ inspection: authorizationInspections.get(original), authorization: forged, capabilities: denied.capabilities })
			).rejects.toMatchObject({ reasonCode: 'scenario_authorization_invalid', exitCode: 10 });
			expect(denied.events).toEqual([]);
		}
	});

	it('rejects lifecycle tokens selected from cloned, substituted, or reordered registries', async () => {
		const clonedEntries = A10_STEP_REGISTRY.map((entry) =>
			Object.freeze({
				id: entry.id,
				scenario: entry.scenario,
				kind: entry.kind,
				prerequisiteIds: Object.freeze([...entry.prerequisiteIds]),
				roleCapability: entry.roleCapability,
				mutationMethod: entry.mutationMethod,
				readBackMethod: entry.readBackMethod,
				manifestReducer: entry.manifestReducer
			})
		);
		const clonedRegistry = Object.freeze(clonedEntries);
		const facts = {
			actors: 4,
			provisionVerified: true,
			scenarioPartial: false,
			scenarioVerified: false,
			cleanupRequired: false,
			cleanupPartial: false,
			cleanupVerified: false,
			archived: false,
			ambiguous: false,
			releaseMismatch: false,
			credentialsLost: false,
			exactRecoveryProvenance: false,
			manifestMatches: true,
			ownershipConflict: false,
			deletionScopeTrusted: true,
			authoritativeReleaseAvailable: true,
			...exactCoordinates,
			boundReleaseCommitSha: exactCoordinates.releaseCommitSha,
			currentReleaseCommitSha: exactCoordinates.releaseCommitSha,
			stateValid: true,
			stateCorrupt: false,
			corruptState: false,
			manifestValid: true,
			manifestBindingStatus: 'exact',
			manifestExactMatch: true,
			manifestAheadState: false,
			manifestMismatch: false,
			authoritativeReleaseUnavailable: false,
			releaseChanged: false,
			hostedEvidenceAvailable: true,
			cleanupCompleteContradiction: false,
			duplicateRoles: 0,
			metadataMismatches: 0,
			actorIdentityConflicts: 0,
			manifestActorsAbsent: 0,
			hostedActorsManifestStale: 0
		};
		const evidence = {
			completedCheckpointIds: [],
			hostedCheckpointId: null,
			manifestCheckpointId: null,
			...exactCoordinates
		};
		const clonedAuthorization = selectNextScenarioStep(facts, clonedRegistry, evidence);
		expect(clonedAuthorization?.checkpoint).toBe(clonedRegistry[0]);
		const denied = boundaryCapabilities();
		await expect(
			runScenarioBoundary({ inspection: facts, authorization: clonedAuthorization, capabilities: denied.capabilities })
		).rejects.toMatchObject({ reasonCode: 'scenario_authorization_invalid', exitCode: 10 });
		expect(denied.events).toEqual([]);

		const reordered = Object.freeze([...A10_STEP_REGISTRY].reverse());
		expect(selectNextScenarioStep(facts, reordered, evidence)).toBeNull();
	});

	it('performs at most one attempt and persists mutation, readback, manifest, then state', async () => {
		const { capabilities, events } = boundaryCapabilities();
		const result = await runScenarioBoundary(boundaryRequest(authorization(), capabilities));

		expect(events).toEqual(['mutation', 'readback', 'reducer', 'manifest', 'state']);
		expect(capabilities.mutation).toHaveBeenCalledOnce();
		expect(result).toEqual({
			status: 'confirmed',
			exitCode: 0,
			checkpointId: 'primary-report-created',
			replayed: false,
			requiresFreshInspection: false,
			receipt: receipt()
		});
	});

	it('reconciles without replay and verification entries receive no mutation capability', async () => {
		const reconcile = boundaryCapabilities({ mutation: null });
		await runScenarioBoundary(boundaryRequest(authorization(0, 'reconcile'), reconcile.capabilities));
		expect(reconcile.events).toEqual(['readback', 'reducer', 'manifest', 'state']);

		const verificationEvents: string[] = [];
		const verification = {
			roleCapability: 'reporter',
			mutation: null,
			readBack: vi.fn(async () => {
				verificationEvents.push('readback');
				return {
					outcome: 'confirmed',
					manifestEvidence: null,
					receipt: receipt('primary-upload-attached-verified')
				};
			}),
			reduceManifest: null,
			persistManifest: null,
			persistState: vi.fn(async () => {
				verificationEvents.push('state');
			})
		};
		await runScenarioBoundary(boundaryRequest(authorization(1), verification));
		expect(verificationEvents).toEqual(['readback', 'state']);
	});

	it.each([
		['confirmed-absent', 40],
		['uncertain', 41]
	] as const)('maps %s readback without persistence', async (outcome, exitCode) => {
		const events: string[] = [];
		const { capabilities } = boundaryCapabilities({
			readBack: vi.fn(async () => {
				events.push('readback');
				return { outcome, manifestEvidence: null, receipt: receipt() };
			}),
			persistManifest: vi.fn(async () => events.push('manifest')),
			persistState: vi.fn(async () => events.push('state'))
		});
		const result = await runScenarioBoundary(boundaryRequest(authorization(), capabilities));
		expect(result).toEqual({
			status: outcome,
			exitCode,
			checkpointId: 'primary-report-created',
			replayed: false,
			requiresFreshInspection: true
		});
		expect(events).toEqual(['readback']);
	});

	it('sanitizes mutation and readback failures and never returns provider details', async () => {
		const sensitiveSentinel = ['provider', 'secret', 'reporter@example.invalid'].join('-');
		const output = vi.spyOn(process.stdout, 'write');
		const error = vi.spyOn(process.stderr, 'write');
		const { capabilities } = boundaryCapabilities({
			mutation: vi.fn(async () => {
				throw new Error(sensitiveSentinel);
			}),
			readBack: vi.fn(async () => {
				throw new Error(sensitiveSentinel);
			})
		});
		const result = await runScenarioBoundary(boundaryRequest(authorization(), capabilities));
		expect(result).toEqual({
			status: 'uncertain',
			exitCode: 41,
			checkpointId: 'primary-report-created',
			replayed: false,
			requiresFreshInspection: true
		});
		expect(JSON.stringify(result)).not.toContain(sensitiveSentinel);
		expect(output).not.toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
		output.mockRestore();
		error.mockRestore();
	});

	it('rejects hostile receipt graphs before any persistence without leaking through any channel', async () => {
		const sensitiveSentinel = ['nested', 'provider', 'secret', 'reporter@example.invalid'].join('-');
		let accessorCalls = 0;
		const hostileBefore: Record<string, unknown> = {};
		Object.defineProperty(hostileBefore, 'accounts', {
			enumerable: true,
			get() {
				accessorCalls += 1;
				throw new Error(sensitiveSentinel);
			}
		});
		const inheritedReceipt = Object.assign(Object.create({ password: sensitiveSentinel }), receipt());
		const accessorReceipt = { ...receipt() } as Record<string, unknown>;
		Object.defineProperty(accessorReceipt, 'event', {
			enumerable: true,
			get() {
				accessorCalls += 1;
				throw new Error(sensitiveSentinel);
			}
		});
		const symbolReceipt = { ...receipt(), [Symbol(sensitiveSentinel)]: sensitiveSentinel };
		const proxyReceipt = new Proxy(receipt(), {
			get() {
				accessorCalls += 1;
				throw new Error(sensitiveSentinel);
			}
		});
		const nestedReceipt = { ...receipt(), before: hostileBefore };
		const stdout = vi.spyOn(process.stdout, 'write');
		const stderr = vi.spyOn(process.stderr, 'write');

		for (const hostile of [inheritedReceipt, accessorReceipt, symbolReceipt, proxyReceipt, nestedReceipt]) {
			const persistManifest = vi.fn();
			const persistState = vi.fn();
			const { capabilities } = boundaryCapabilities({
				readBack: vi.fn(async () => ({
					outcome: 'confirmed',
					manifestEvidence: null,
					receipt: hostile
				})),
				persistManifest,
				persistState
			});
			let caught: unknown;
			try {
				await runScenarioBoundary(boundaryRequest(authorization(), capabilities));
			} catch (error) {
				caught = error;
			}
			expect(String(caught)).not.toContain(sensitiveSentinel);
			expect(persistManifest).not.toHaveBeenCalled();
			expect(persistState).not.toHaveBeenCalled();
		}
		expect(accessorCalls).toBe(0);
		expect(stdout).not.toHaveBeenCalled();
		expect(stderr).not.toHaveBeenCalled();
		stdout.mockRestore();
		stderr.mockRestore();
	});

	it('never leaks credentials, email, TOTP, session, provider, or key material through results, persistence, logs, or thrown text', async () => {
		const secrets = [
			'private-password-value',
			'reporter@example.invalid',
			'JBSWY3DPEHPK3PXP',
			'private-session-token',
			'private-provider-payload',
			'sb_secret_private_key_material'
		];
		const stdout = vi.spyOn(process.stdout, 'write');
		const stderr = vi.spyOn(process.stderr, 'write');
		const log = vi.spyOn(console, 'log');
		const warn = vi.spyOn(console, 'warn');
		const consoleError = vi.spyOn(console, 'error');
		for (const secret of secrets) {
			const persistManifest = vi.fn();
			const persistState = vi.fn();
			const safe = { ...receipt(), providerObject: { secret } };
			const selected = authorization();
			const result = await runScenarioBoundary({
				inspection: authorizationInspections.get(selected),
				authorization: selected,
				capabilities: {
					roleCapability: 'reporter',
					mutation: vi.fn(async () => { throw new Error(secret); }),
					readBack: vi.fn(async () => ({ outcome: 'confirmed', manifestEvidence: {}, receipt: safe })),
					reduceManifest: vi.fn(() => ({ exact: 'manifest' })),
					persistManifest,
					persistState
				}
			});
			for (const value of [result, persistManifest.mock.calls, persistState.mock.calls]) {
				expect(JSON.stringify(value)).not.toContain(secret);
			}
			let caught: unknown;
			try {
				const selectedFailure = authorization();
				await runScenarioBoundary({
					inspection: authorizationInspections.get(selectedFailure),
					authorization: selectedFailure,
					capabilities: {
						roleCapability: 'reporter',
						mutation: vi.fn(),
						readBack: vi.fn(async () => ({ outcome: 'confirmed', manifestEvidence: {}, receipt: receipt() })),
						reduceManifest: vi.fn(() => { throw new Error(secret); }),
						persistManifest: vi.fn(),
						persistState: vi.fn()
					}
				});
			} catch (error) {
				caught = error;
			}
			expect(String(caught)).not.toContain(secret);
		}
		for (const spy of [stdout, stderr, log, warn, consoleError]) expect(spy).not.toHaveBeenCalled();
		stdout.mockRestore();
		stderr.mockRestore();
		log.mockRestore();
		warn.mockRestore();
		consoleError.mockRestore();
	});
});

type CrashWindow = 'before-mutation' | 'after-mutation-before-verification' | 'after-verification-before-manifest' | 'after-manifest-before-state';

const commandRunId = 'gate3-20260822-abcdef12';
const manifestPath = 'C:/private/manifest.json';
const releaseSha = 'a'.repeat(40);
const actorIds = {
	reporter: '11111111-1111-4111-8111-111111111111',
	'cross-user': '22222222-2222-4222-8222-222222222222',
	'assigned-moderator': '33333333-3333-4333-8333-333333333333',
	'unassigned-moderator': '44444444-4444-4444-8444-444444444444'
} as const;
const actorEmails = {
	reporter: 'reporter@example.invalid',
	'cross-user': 'cross-user@example.invalid',
	'assigned-moderator': 'assigned@example.invalid',
	'unassigned-moderator': 'unassigned@example.invalid'
} as const;
const syntheticActorPassword = ['private', 'password'].join('-');
const syntheticServiceKey = ['private', 'service', 'key'].join('-');
const commandConfig = {
	target: HOSTED_STAGING,
	runId: commandRunId,
	actorRoles: Object.fromEntries(Object.entries(actorEmails).map(([role, email]) => [role, { email, password: syntheticActorPassword, username: `gate3-${role}` }])),
	serviceKey: syntheticServiceKey,
	provisioningNonce: '55555555-5555-4555-8555-555555555555',
	provisionedAfter: '2026-08-22T19:00:00.000Z'
};

function hashBytes(bytes: Buffer) {
	return createHash('sha256').update(bytes).digest('hex');
}

function manifestBytes(manifest: unknown) {
	return Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8');
}

function actorBaseRole(roleCapability: string) {
	if (roleCapability === 'assigned-moderator-aal1' || roleCapability === 'assigned-moderator-aal2') return 'assigned-moderator';
	if (roleCapability === 'unassigned-moderator-aal2') return 'unassigned-moderator';
	return roleCapability;
}

function actorClient(roleCapability: string) {
	const role = actorBaseRole(roleCapability) as keyof typeof actorIds;
	const aal = roleCapability.endsWith('aal2') ? 'aal2' : 'aal1';
	return Object.freeze({
		auth: Object.freeze({
			getUser: vi.fn(async () => ({ data: { user: { id: actorIds[role], email: actorEmails[role] } }, error: null })),
			getSession: vi.fn(async () => ({ data: { session: { user: { id: actorIds[role] }, access_token: 'private-session-token' } }, error: null })),
			mfa: Object.freeze({ getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: aal }, error: null })) })
		})
	});
}

function baseManifest() {
	let manifest = createHostedRunManifest(commandConfig as never);
	for (const [role, userId] of Object.entries(actorIds)) {
		manifest = registerHostedActor(manifest, role, userId, '2026-08-22T19:30:00.000Z');
	}
	return manifest;
}

function seedManifestFor(step: (typeof A10_STEP_REGISTRY)[number]) {
	let manifest = baseManifest();
	const fixtureUploadId = '77777777-7777-4777-8777-777777777777';
	if (step.manifestReducer === 'registerDuplicateUpload') {
		const primaryUploadId = '99999999-9999-4999-8999-999999999999';
		manifest = registerHostedUpload(
			registerHostedReport(manifest, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'reporter'),
			primaryUploadId,
			'reporter',
			`${actorIds.reporter}/${primaryUploadId}.webp`
		);
	} else if (step.manifestReducer === 'registerDuplicateQueue') {
		const primaryUploadId = '66666666-6666-4666-8666-666666666666';
		manifest = {
			...manifest,
			uploads: [
				{ id: primaryUploadId, actorRole: 'reporter', uploaderId: actorIds.reporter, objectPath: `${actorIds.reporter}/${primaryUploadId}.webp` },
				{ id: fixtureUploadId, actorRole: 'reporter', uploaderId: actorIds.reporter, objectPath: `${actorIds.reporter}/${fixtureUploadId}.webp` }
			]
		};
	} else if (step.manifestReducer === 'registerScheduledQueueCoordinate') {
		manifest = { ...manifest, uploads: [{ id: fixtureUploadId, actorRole: 'reporter', uploaderId: actorIds.reporter, objectPath: `${actorIds.reporter}/${fixtureUploadId}.webp` }] };
	}
	return manifest;
}

function productionProbeContextFor(step: (typeof A10_STEP_REGISTRY)[number], manifest: ReturnType<typeof baseManifest>, onReadBack: () => void) {
	const observedAt = '2026-08-22T19:10:00.000Z';
	const reports = manifest.reports.map((report) => ({
		id: report.id,
		reporter_id: actorIds.reporter,
		target_id: actorIds['cross-user'],
		details: `Synthetic Gate 3 evidence ${commandRunId}`,
		evidence_paths: manifest.uploads[0] ? [manifest.uploads[0].objectPath] : [],
		status: 'open',
		assigned_to: null,
		created_at: observedAt
	}));
	const uploads = manifest.uploads.map((upload, index) => ({
		id: upload.id,
		uploader_id: upload.uploaderId,
		storage_path: upload.objectPath,
		status: step.id === 'abandoned-upload-backdated'
			? 'expired'
			: step.id === 'duplicate-upload-reconciled' && index === 1
			? 'rejected'
			: step.id === 'rejected-upload-created' && index === manifest.uploads.length - 1
				? 'rejected'
				: index === 0 && ['primary-report-created', 'duplicate-upload-reconciled'].includes(String(step.id))
					? 'attached'
					: 'pending',
		source_byte_size: step.id === 'abandoned-upload-allocated' ? 51 : 68,
		actual_content_hash: 'a'.repeat(64),
		actual_byte_size: 68,
		actual_mime_type: 'image/webp',
		width_px: 1,
		height_px: 1,
		report_id: index === 0 ? reports[0]?.id ?? null : null,
		created_at: observedAt,
		expires_at: step.id === 'abandoned-upload-backdated' ? '2026-08-22T18:59:00.000Z' : '2026-08-22T21:00:00.000Z',
		finalized_at: observedAt,
		attached_at: observedAt
	}));
	const queues = manifest.queueRows.map((queue) => {
		const upload = manifest.uploads.find((entry) => entry.id === queue.uploadId);
		return { id: queue.id, processed_at: null, report_evidence_upload_id: queue.uploadId, bucket_id: 'report-evidence', storage_path: upload?.objectPath };
	});
	const rows: Record<string, Array<Record<string, any>>> = { reports, report_evidence_uploads: uploads, upload_cleanup_queue: queues, moderation_audit: [] };
	const readBackStartTable = step.id === 'primary-report-created'
		? 'reports'
		: ['duplicate-upload-created', 'abandoned-upload-allocated', 'rejected-upload-created'].includes(String(step.id))
			? 'report_evidence_uploads'
			: 'upload_cleanup_queue';
	const serviceClient = {
		supabaseUrl: HOSTED_STAGING.supabaseUrl,
		from(table: string) {
			if (table === readBackStartTable) onReadBack();
			const filters: Array<(row: Record<string, any>) => boolean> = [];
			let containsFilter: [string, unknown[]] | null = null;
			const selected = () => (rows[table] ?? []).filter((row) =>
				filters.every((filter) => filter(row)) &&
				(containsFilter === null || containsFilter[1].every((value) => Array.isArray(row[containsFilter![0]]) && row[containsFilter![0]].includes(value)))
			);
			const query: Record<string, any> = {
				select: () => query,
				eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
				in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
				like: (key: string, pattern: string) => { const prefix = pattern.replace(/%$/u, ''); filters.push((row) => String(row[key] ?? '').startsWith(prefix)); return query; },
				gte: () => query,
				contains: (key: string, value: unknown[]) => { containsFilter = [key, value]; return query; },
				order: () => query,
				limit: () => query,
				maybeSingle: async () => ({ data: selected().length === 1 ? selected()[0] : null, error: selected().length <= 1 ? null : { code: 'ambiguous' } }),
				then: (resolve: (value: unknown) => unknown) => resolve({ data: selected(), error: null, count: selected().length })
			};
			return query;
		},
		storage: {
			from: () => ({
				list: vi.fn(async (prefix: string, options: { search?: string }) => {
					const matching = manifest.uploads.filter((entry) => entry.uploaderId === prefix && (!options.search || `${entry.id}.webp` === options.search));
					return { data: matching.map((upload) => ({ name: `${upload.id}.webp`, created_at: observedAt, updated_at: observedAt, metadata: { size: 68, mimetype: 'image/webp' } })), error: null };
				}),
				upload: vi.fn(async () => ({ data: {}, error: null }))
			})
		},
		auth: {
			admin: {
				getUserById: vi.fn(async (id: string) => {
					const actor = manifest.actors.find((entry) => entry.userId === id);
					const email = actor ? actorEmails[actor.role as keyof typeof actorEmails] : null;
					return {
						data: { user: actor && email ? { id, email, created_at: actor.createdAt, user_metadata: { gate3_report_evidence_run_id: commandRunId, gate3_report_evidence_provisioning_nonce: commandConfig.provisioningNonce, gate3_report_evidence_provisioning_attempt_id: commandConfig.provisioningNonce } } : null },
						error: actor && email ? null : { code: 'not-found' }
					};
				})
			}
		}
	};
	const privilegedAdapters = createSupabaseHostedEvidenceAdapters({
		config: commandConfig as never,
		serviceClient: serviceClient as never,
		managementAccessToken: 'management-token',
		cleanupSecret: 'x'.repeat(32),
		fetchImpl: vi.fn(async () => new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } })) as never
	});
	return createHostedA10ExecutionContext({
		config: commandConfig as never,
		publishableKey: 'sb_publishable_test-key',
		privilegedAdapters,
		reportTokenProvider: freshReportTokenProvider(),
		fetchImpl: vi.fn(async () => { throw new Error('mutation transport is forbidden during reconciliation'); }) as never
	});
}

function reducerEvidence(step: (typeof A10_STEP_REGISTRY)[number]) {
	const uploadId = step.manifestReducer === 'registerRejectedUploadAndQueue'
		? '88888888-8888-4888-8888-888888888888'
		: step.manifestReducer === 'registerPrimaryReport'
			? '99999999-9999-4999-8999-999999999999'
			: step.manifestReducer === 'registerDuplicateUpload'
				? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
				: step.manifestReducer === 'registerAbandonedUpload'
					? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
					: '77777777-7777-4777-8777-777777777777';
	if (step.manifestReducer === 'registerPrimaryReport') return { reportId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', uploadId, objectPath: `${actorIds.reporter}/${uploadId}.webp` };
	if (['registerDuplicateUpload', 'registerAbandonedUpload'].includes(String(step.manifestReducer))) return { uploadId, objectPath: `${actorIds.reporter}/${uploadId}.webp` };
	if (step.manifestReducer === 'registerRejectedUploadAndQueue') return { uploadId, objectPath: `${actorIds.reporter}/${uploadId}.webp`, queueId: 18 };
	if (step.manifestReducer === 'registerDuplicateQueue') return { queueId: 17, uploadId };
	if (step.manifestReducer === 'registerScheduledQueueCoordinate') return { queueId: 19, uploadId };
	return null;
}

function initialState(index: number, manifest: unknown, revision = 10) {
	const completed = A10_STEP_REGISTRY.slice(0, index).map((step) => step.id);
	return {
		schemaVersion: 1,
		revision,
		runId: commandRunId,
		createdAt: '2026-08-22T19:00:00.000Z',
		target: { projectRef: HOSTED_STAGING.projectRef, workerOrigin: HOSTED_STAGING.workerOrigin, releaseCommitSha: releaseSha },
		identitySchemeVersion: 1,
		manifest: { path: manifestPath, sha256: hashBytes(manifestBytes(manifest)) },
		secretStore: { path: 'C:/private/secret.bin', status: 'persisted', ciphertextSha256: 'f'.repeat(64) },
		phases: {
			preflight: { status: 'complete', checkpoint: null },
			provision: { status: 'complete', checkpoint: null },
			scenario: { status: index === 0 ? 'pending' : 'partial', checkpoint: null },
			cleanup: { status: 'pending', checkpoint: null },
			recovery: { status: 'pending', checkpoint: null }
		},
		scenarioCheckpoints: Object.fromEntries(completed.map((id) => [`scenario-${id}`, { operationId: id }])),
		lastInspection: null,
		archive: null
	};
}

function createSequentialA10ProductionHarness(
	moderatorBytes: Buffer | null = null,
	actorAttack: { checkpointId: string; kind: 'demoted' | 'suspended' } | null = null,
	backdateFailsBeforeApplyOnce = false,
	backdateChangeBeforeRetry: 'future' | 'past' | null = null,
	backdateConcurrentChange = false,
	startCheckpointId: string | null = null
) {
	const ids = { report: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', primary: '99999999-9999-4999-8999-999999999999', duplicate: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rejected: '88888888-8888-4888-8888-888888888888', abandoned: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
	const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
	const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA', 'base64');
	const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
	const rows: Record<string, Array<Record<string, any>>> = { reports: [], report_evidence_uploads: [], upload_cleanup_queue: [], moderation_audit: [] };
	const objects = new Map<string, { bytes: Buffer; created_at: string; metadata: { size: number; mimetype: string } }>();
	const attempts = new Map<string, number>();
	const issuedReportTokens: string[] = [];
	const consumedReportTokens = new Set<string>();
	let activeCheckpointId: string | null = null;
	const reportTokenProvider = Object.freeze({ freshReportToken: vi.fn(async () => {
		const token = `turnstile-sequential-${issuedReportTokens.length + 1}-${'x'.repeat(24)}`;
		issuedReportTokens.push(token);
		return token;
	}) });
	const consumeReportToken = (token: string) => {
		if (!issuedReportTokens.includes(token) || consumedReportTokens.has(token)) throw new Error('reused or unknown Turnstile token');
		consumedReportTokens.add(token);
	};
	let epoch = Date.parse('2026-08-22T20:00:00.000Z');
	const tick = () => new Date((epoch += 1_000)).toISOString();
	const attempted = (id: string) => attempts.set(id, (attempts.get(id) ?? 0) + 1);
	const pathFor = (id: string) => `${actorIds.reporter}/${id}.webp`;
	const jwt = (id: string, aal: 'aal1' | 'aal2') => `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, aal, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.${Buffer.from('signature').toString('base64url')}`;
	const bearer = (headers: Headers) => {
		try {
			return JSON.parse(Buffer.from((headers.get('authorization') ?? '').replace(/^Bearer /u, '').split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: string; aal?: string };
		} catch { return {}; }
	};
	const roleForId = (id: string) => Object.entries(actorIds).find(([, value]) => value === id)?.[0] as keyof typeof actorIds | undefined;
	const roleForEmail = (email: string) => Object.entries(actorEmails).find(([, value]) => value === email)?.[0] as keyof typeof actorIds | undefined;
	const user = (role: keyof typeof actorIds) => ({ id: actorIds[role], email: actorEmails[role], factors: role.includes('moderator') ? [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }] : [] });
	const session = (role: keyof typeof actorIds, aal: 'aal1' | 'aal2') => ({ access_token: jwt(actorIds[role], aal), refresh_token: 'opaque-refresh-token', expires_in: 3600, token_type: 'bearer', user: user(role) });
	const addUpload = (id: string, status: string, size: number, reportId: string | null = null) => {
		const observedAt = tick();
		rows.report_evidence_uploads.push({ id, uploader_id: actorIds.reporter, storage_path: pathFor(id), status, source_byte_size: size, actual_content_hash: reportId ? hashBytes(png) : null, actual_byte_size: reportId ? png.length : null, actual_mime_type: reportId ? 'image/webp' : null, width_px: reportId ? 1 : null, height_px: reportId ? 1 : null, report_id: reportId, created_at: observedAt, updated_at: observedAt, expires_at: new Date(Date.parse(observedAt) + 60 * 60_000).toISOString(), finalized_at: reportId ? observedAt : null, attached_at: reportId ? observedAt : null });
	};
	const addQueue = (id: number, uploadId: string, processed = false) => rows.upload_cleanup_queue.push({ id, report_evidence_upload_id: uploadId, bucket_id: 'report-evidence', storage_path: pathFor(uploadId), processed_at: processed ? tick() : null });
	const queryRows = (table: string, filters: Array<(row: Record<string, any>) => boolean>) => (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row)));

	const serviceClient = {
		supabaseUrl: HOSTED_STAGING.supabaseUrl,
		auth: { admin: {
			getUserById: vi.fn(async (id: string) => {
				const role = roleForId(id);
				return role ? { data: { user: { ...user(role), created_at: '2026-08-22T19:30:00.000Z', user_metadata: { gate3_report_evidence_run_id: commandRunId, gate3_report_evidence_provisioning_nonce: commandConfig.provisioningNonce, gate3_report_evidence_provisioning_attempt_id: commandConfig.provisioningNonce } } }, error: null } : { data: { user: null }, error: { code: 'user_not_found' } };
			}),
			listUsers: vi.fn(async () => ({ data: { users: [], lastPage: 1 }, error: null }))
		} },
		from(table: string) {
			const filters: Array<(row: Record<string, any>) => boolean> = [];
			let head = false;
			let selectedColumns: string[] | null = null;
			const projected = () => queryRows(table, filters).map((row) => selectedColumns === null
				? row
				: Object.fromEntries(selectedColumns.filter((column) => Object.prototype.hasOwnProperty.call(row, column)).map((column) => [column, row[column]])));
			const query: Record<string, any> = {
				select: (columns?: string, options?: { head?: boolean }) => { head = options?.head === true; selectedColumns = typeof columns === 'string' ? columns.split(',').map((column) => column.trim()) : null; return query; },
				eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
				gte: (key: string, value: string) => { filters.push((row) => Date.parse(String(row[key])) >= Date.parse(value)); return query; },
				in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
				like: (key: string, pattern: string) => { const prefix = pattern.replace(/%$/u, ''); filters.push((row) => String(row[key] ?? '').startsWith(prefix)); return query; },
				contains: (key: string, values: unknown[]) => { filters.push((row) => Array.isArray(row[key]) && values.every((value) => row[key].includes(value))); return query; },
				order: () => query,
				limit: () => query,
				maybeSingle: async () => { const data = projected(); return { data: data.length === 1 ? data[0] : null, error: data.length > 1 ? { code: 'ambiguous' } : null }; },
				then: (resolve: (value: unknown) => unknown) => { const data = projected(); return Promise.resolve(resolve({ data: head ? null : data, error: null, count: data.length })); }
			};
			return query;
		},
		storage: { from: () => ({
			list: vi.fn(async (prefix: string, options: { search?: string } = {}) => ({ data: [...objects.entries()].filter(([path]) => path.startsWith(`${prefix}/`) && (!options.search || path === `${prefix}/${options.search}`)).map(([path, object]) => ({ name: path.slice(prefix.length + 1), ...object })), error: null })),
			upload: vi.fn(async (path: string, bytes: Uint8Array) => { attempted('abandoned-object-created'); objects.set(path, { bytes: Buffer.from(bytes), created_at: tick(), metadata: { size: bytes.byteLength, mimetype: 'image/webp' } }); return { data: { path }, error: null }; })
		}) },
		rpc: vi.fn(async (name: string, body: Record<string, unknown>) => {
			if (name !== 'reject_unattached_report_evidence_uploads') return { data: null, error: { code: 'unknown_rpc' } };
			attempted('duplicate-upload-reconciled');
			const requested = body.target_upload_ids as string[];
			const duplicate = rows.report_evidence_uploads.find((entry) => entry.id === ids.duplicate && requested.includes(entry.id));
			if (!duplicate) return { data: [], error: null };
			duplicate.status = 'rejected';
			addQueue(17, ids.duplicate, true);
			return { data: [{ upload_id: ids.duplicate }], error: null };
		})
	};

	const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(input, init);
		const url = new URL(request.url);
		if (url.pathname === '/auth/v1/token') {
			const role = roleForEmail(String((await request.clone().json() as { email?: string }).email ?? ''));
			return new Response(JSON.stringify(role ? session(role, 'aal1') : { error: 'invalid_grant' }), { status: role ? 200 : 400, headers: { 'content-type': 'application/json' } });
		}
		if (url.pathname === '/auth/v1/factors') return new Response(JSON.stringify({ all: [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }], totp: [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }], phone: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
		if (/\/auth\/v1\/factors\/factor-1\/challenge$/u.test(url.pathname)) return new Response(JSON.stringify({ id: 'challenge-1', expires_at: Math.floor(Date.now() / 1000) + 60 }), { status: 200, headers: { 'content-type': 'application/json' } });
		if (/\/auth\/v1\/factors\/factor-1\/verify$/u.test(url.pathname)) { const role = roleForId(String(bearer(request.headers).sub ?? '')); return new Response(JSON.stringify(session(role!, 'aal2')), { status: 200, headers: { 'content-type': 'application/json' } }); }
		if (url.pathname === '/auth/v1/user') { const role = roleForId(String(bearer(request.headers).sub ?? '')); return new Response(JSON.stringify(role ? user(role) : null), { status: role ? 200 : 401, headers: { 'content-type': 'application/json' } }); }
		if (url.pathname === '/rest/v1/profiles') {
			const role = roleForId(String(bearer(request.headers).sub ?? ''));
			const attacked = actorAttack?.checkpointId === activeCheckpointId;
			return new Response(JSON.stringify(role ? [{
				id: actorIds[role],
				role: attacked && actorAttack?.kind === 'demoted' ? (role.includes('moderator') ? 'user' : 'moderator') : role.includes('moderator') ? 'moderator' : 'user',
				is_suspended: attacked && actorAttack?.kind === 'suspended'
			}] : []), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		if (url.pathname === '/rest/v1/beta_memberships') { const role = roleForId(String(bearer(request.headers).sub ?? '')); return new Response(JSON.stringify(role ? [{ profile_id: actorIds[role], status: 'active', onboarding_completed_at: '2026-08-22T19:35:00.000Z' }] : []), { status: 200, headers: { 'content-type': 'application/json' } }); }
		if (url.pathname.startsWith('/storage/v1/object/')) {
			const facts = bearer(request.headers);
			const allowed = facts.sub === actorIds.reporter || (facts.sub === actorIds['assigned-moderator'] && facts.aal === 'aal2');
			if (!allowed) attempted(facts.sub === actorIds['cross-user'] ? 'cross-user-storage-denied' : facts.sub === actorIds['assigned-moderator'] ? 'assigned-moderator-aal1-denied' : 'unassigned-moderator-denied');
			const responseBytes = facts.sub === actorIds['assigned-moderator'] && facts.aal === 'aal2' && moderatorBytes !== null ? moderatorBytes : png;
			return allowed ? new Response(new Uint8Array(responseBytes), { status: 200, headers: { 'content-type': 'image/webp', 'sb-request-id': requestId } }) : new Response(JSON.stringify({ statusCode: '403', error: 'Unauthorized' }), { status: 403, headers: { 'content-type': 'application/json', 'sb-request-id': requestId } });
		}
		if (url.pathname === '/rest/v1/reports' && request.method === 'POST') { attempted('duplicate-reuse-denied'); return new Response(JSON.stringify({ code: '42501', message: 'report evidence is not a finalized owned object', details: null, hint: null }), { status: 403, headers: { 'content-type': 'application/json' } }); }
		if (url.pathname === '/rest/v1/reports' && request.method === 'PATCH') {
			attempted('assignment-applied');
			const report = rows.reports[0]; report.assigned_to = actorIds['assigned-moderator']; report.status = 'investigating';
			rows.moderation_audit.push({ id: 1, report_id: report.id, actor_id: actorIds['assigned-moderator'], action: 'report_assigned' });
			return new Response(JSON.stringify([report]), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		if (url.pathname === '/rest/v1/rpc/create_report_evidence_upload') {
			const size = Number((await request.clone().json() as { source_byte_size?: number }).source_byte_size);
			const duplicate = size === png.length;
			const id = duplicate ? ids.duplicate : ids.abandoned;
			attempted(duplicate ? 'duplicate-upload-created' : 'abandoned-upload-allocated'); addUpload(id, 'pending', size);
			return new Response(JSON.stringify({ id, storage_path: pathFor(id) }), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		if (url.pathname === '/report') {
			const body = init?.body;
			if (body instanceof FormData) {
				consumeReportToken(String(body.get('cf-turnstile-response') ?? ''));
				const details = String(body.get('details') ?? ''); const targetId = String(body.get('targetId') ?? ''); const files = body.getAll('evidence') as Blob[];
				if (details === `Synthetic Gate 3 evidence ${commandRunId}`) {
					attempted('primary-report-created'); addUpload(ids.primary, 'attached', png.length, ids.report); const primaryUpload = rows.report_evidence_uploads.find((entry) => entry.id === ids.primary)!; objects.set(pathFor(ids.primary), { bytes: png, created_at: primaryUpload.created_at, metadata: { size: png.length, mimetype: 'image/webp' } }); rows.reports.push({ id: ids.report, reporter_id: actorIds.reporter, target_id: actorIds['cross-user'], details, evidence_paths: [pathFor(ids.primary)], status: 'open', assigned_to: null, created_at: tick() });
					return new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-deployed-git-sha': releaseSha } });
				}
				if (targetId === '00000000-0000-4000-8000-000000000001') { attempted('rejected-upload-created'); addUpload(ids.rejected, 'rejected', png.length); addQueue(18, ids.rejected); return new Response(JSON.stringify({ type: 'failure', status: 403, data: { error: { code: 'FORBIDDEN', message: 'You are not allowed to perform this action.' } } }), { status: 403, headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-deployed-git-sha': releaseSha } }); }
				const hostileId = files.some((file) => file.size > 10 * 1024 * 1024) ? 'per-file-limit-rejected' : files.length === 4 ? 'aggregate-limit-rejected' : 'invalid-image-rejected';
				const reason = hostileId === 'invalid-image-rejected' ? 'Изображението не можа да бъде проверено и безопасно обработено.' : 'Общият размер на заявката е твърде голям.';
				attempted(hostileId); return new Response(reason, { status: hostileId === 'invalid-image-rejected' ? 400 : 413, headers: { 'x-request-id': requestId, 'x-deployed-git-sha': releaseSha } });
			}
			const rawBody = Buffer.from(body as Uint8Array).toString('utf8');
			consumeReportToken(issuedReportTokens.find((candidate) => rawBody.includes(candidate)) ?? '');
			attempted('malformed-request-rejected'); return new Response('Заявката за сигнал е невалидна.', { status: 400, headers: { 'x-request-id': requestId, 'x-deployed-git-sha': releaseSha } });
		}
		throw new Error(`unexpected sequential request ${request.method} ${url.pathname}`);
	};
	const httpsRequestImpl = (_url: URL, options: Record<string, any>, onResponse: (response: any) => void) => {
		attempted(new Headers(options.headers).get('transfer-encoding') === 'chunked' ? 'chunked-limit-rejected' : 'understated-length-rejected');
		const response: Record<string, any> = { statusCode: 413, headers: { 'x-request-id': requestId, 'x-deployed-git-sha': releaseSha } };
		response.on = (event: string, listener: (chunk: Buffer) => void) => { if (event === 'data') queueMicrotask(() => listener(Buffer.from('Общият размер на заявката е твърде голям.'))); return response; };
		response.once = (event: string, listener: () => void) => { if (event === 'end') queueMicrotask(listener); return response; }; onResponse(response);
		const requestChunks: Buffer[] = [];
		const request: Record<string, any> = { once: vi.fn(() => request), write: vi.fn((chunk: Buffer) => { requestChunks.push(Buffer.from(chunk)); return true; }), end: vi.fn(() => {
			const body = Buffer.concat(requestChunks).toString('utf8');
			const token = issuedReportTokens.find((candidate) => body.includes(candidate));
			consumeReportToken(token ?? '');
		}) }; return request;
	};
	const privilegedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.includes('/database/query')) {
			attempted('abandoned-upload-backdated');
			const upload = rows.report_evidence_uploads.find((entry) => entry.id === ids.abandoned);
			const query = (JSON.parse(String(init?.body ?? '{}')) as { query?: string }).query ?? '';
			const expectedExpiry = query.match(/and expires_at = '([^']+)'::timestamptz returning id$/u)?.[1] ?? null;
			if (backdateConcurrentChange && attempts.get('abandoned-upload-backdated') === 1 && upload) upload.expires_at = '2026-08-22T22:00:00.000Z';
			if (!upload || expectedExpiry !== upload.expires_at) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
			if (backdateFailsBeforeApplyOnce && attempts.get('abandoned-upload-backdated') === 1) throw new Error('injected pre-apply failure');
			if (upload) { upload.expires_at = '2026-08-22T18:59:00.000Z'; upload.updated_at = tick(); }
			return new Response(JSON.stringify([{ id: ids.abandoned }]), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		if (url.endsWith('/functions/v1/upload-cleanup')) { attempted('manual-cleanup-verified'); const queueId = Number((JSON.parse(String(init?.body ?? '{}')) as { queueId?: number }).queueId); const queue = rows.upload_cleanup_queue.find((entry) => entry.id === queueId); if (queue) queue.processed_at = tick(); return new Response(JSON.stringify({ scope: 'exact', requestId, claimed: 1, completed: 1, failed: 0 }), { status: 202, headers: { 'content-type': 'application/json' } }); }
		throw new Error('unexpected privileged request');
	};
	const runScheduledCleanup = vi.fn(() => {
		const upload = rows.report_evidence_uploads.find((entry) => entry.id === ids.abandoned);
		if (!upload || Date.parse(String(upload.expires_at)) >= Date.parse('2026-08-22T19:00:00.000Z')) throw new Error('fixture was not backdated');
		upload.status = 'expired';
		objects.delete(pathFor(ids.abandoned));
		if (!rows.upload_cleanup_queue.some((entry) => entry.report_evidence_upload_id === ids.abandoned)) addQueue(19, ids.abandoned, true);
	});

	return Object.freeze({ async run() {
		const root = await mkdtemp(join(tmpdir(), 'gate3-a10-sequential-'));
		try {
			const startIndex = startCheckpointId === null ? 0 : A10_STEP_REGISTRY.findIndex((step) => step.id === startCheckpointId);
			if (startIndex < 0) throw new Error('unknown sequential harness start checkpoint');
			let manifest = baseManifest();
			if (startIndex > 0) {
				manifest = registerHostedUpload(registerHostedReport(manifest, ids.report, 'reporter'), ids.primary, 'reporter', pathFor(ids.primary));
				addUpload(ids.primary, 'attached', png.length, ids.report);
				rows.reports.push({ id: ids.report, reporter_id: actorIds.reporter, target_id: actorIds['cross-user'], details: `Synthetic Gate 3 evidence ${commandRunId}`, evidence_paths: [pathFor(ids.primary)], status: startIndex > 7 ? 'investigating' : 'open', assigned_to: startIndex > 7 ? actorIds['assigned-moderator'] : null, created_at: tick() });
				const primary = rows.report_evidence_uploads[0];
				objects.set(pathFor(ids.primary), { bytes: png, created_at: primary.created_at, metadata: { size: png.length, mimetype: 'image/webp' } });
			}
			if (startIndex > 4) {
				manifest = registerHostedUpload(manifest, ids.duplicate, 'reporter', pathFor(ids.duplicate));
				addUpload(ids.duplicate, startIndex > 5 ? 'rejected' : 'pending', png.length);
			}
			if (startIndex > 5) {
				manifest = registerHostedQueueRow(manifest, 17, ids.duplicate);
				addQueue(17, ids.duplicate, true);
			}
			if (startIndex > 10) {
				manifest = registerHostedQueueRow(registerHostedUpload(manifest, ids.rejected, 'reporter', pathFor(ids.rejected)), 18, ids.rejected);
				addUpload(ids.rejected, 'rejected', png.length);
				addQueue(18, ids.rejected, startIndex > 11);
			}
			if (startIndex > 12) {
				manifest = registerHostedUpload(manifest, ids.abandoned, 'reporter', pathFor(ids.abandoned));
				addUpload(ids.abandoned, 'pending', webp.length);
			}
			if (startIndex > 13) {
				const abandoned = rows.report_evidence_uploads.find((entry) => entry.id === ids.abandoned)!;
				objects.set(pathFor(ids.abandoned), { bytes: webp, created_at: abandoned.created_at, metadata: { size: webp.length, mimetype: 'image/webp' } });
			}
			if (startIndex > 14) {
				manifest = registerHostedQueueRow(manifest, 19, ids.abandoned);
				const abandoned = rows.report_evidence_uploads.find((entry) => entry.id === ids.abandoned)!;
				abandoned.expires_at = '2026-08-22T18:59:00.000Z';
				addQueue(19, ids.abandoned, true);
			}
			const reportPostIds = new Set(['primary-report-created', 'rejected-upload-created', 'malformed-request-rejected', 'invalid-image-rejected', 'per-file-limit-rejected', 'aggregate-limit-rejected', 'chunked-limit-rejected', 'understated-length-rejected']);
			for (const step of A10_STEP_REGISTRY.slice(0, startIndex)) {
				if (step.kind === 'mutation') attempts.set(String(step.id), 1);
				if (reportPostIds.has(String(step.id))) {
					const token = `turnstile-sequential-seeded-${issuedReportTokens.length + 1}-${'x'.repeat(24)}`;
					issuedReportTokens.push(token);
					consumedReportTokens.add(token);
				}
			}
			const paths = resolveGate3RunPaths({ root, runId: commandRunId }); const secretBytes = Buffer.from('opaque-encrypted-secret');
			const state = { ...initialState(startIndex, manifest, 10 + startIndex), manifest: { path: paths.manifestPath, sha256: hashBytes(manifestBytes(manifest)) }, secretStore: { path: paths.secretPath, status: 'persisted', ciphertextSha256: hashBytes(secretBytes) } };
			await reserveRunState(paths, state); await writeFile(paths.manifestPath, manifestBytes(manifest)); await writeFile(paths.secretPath, secretBytes);
			const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config: commandConfig as never, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: privilegedFetch as never });
			const executionContext = createHostedA10ExecutionContext({ config: commandConfig as never, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider, fetchImpl: fetchImpl as never, httpsRequestImpl: httpsRequestImpl as never, credentialStore: Object.freeze({ getModeratorTotpSecret: async () => 'JBSWY3DPEHPK3PXP' }) });
			const mutationIds = A10_STEP_REGISTRY.filter((step) => step.kind === 'mutation').map((step) => String(step.id));
			const inspectionAdapter = Object.freeze({ inspectRun: vi.fn(async () => ({ counts: { actors: 4, sessions: 4, mfaFactors: 2, profiles: 4, reports: rows.reports.length, uploads: rows.report_evidence_uploads.length, objects: objects.size, queueRows: rows.upload_cleanup_queue.length }, foreignCounts: { syntheticAccounts: 0, profiles: 0, reports: 0, uploads: 0, objects: 0, queueRows: 0 }, roleCounts: { reporter: 1, 'cross-user': 1, 'assigned-moderator': 1, 'unassigned-moderator': 1 }, duplicateRoles: 0, metadataMismatches: 0, manifestActorsAbsent: 0, actorIdentityConflicts: 0, hostedActorsManifestStale: 0, confirmedActors: 4, completeProfiles: 4, verifiedModeratorTotpFactors: 2, moderatorsWithVerifiedTotp: 2, actorsWithActiveSessions: 4, activeSessionsProven: true, scenarioVerified: mutationIds.every((id) => attempts.get(id) === (backdateFailsBeforeApplyOnce && id === 'abandoned-upload-backdated' ? 2 : 1)), scenarioPartial: attempts.size > 0, foreignEvidenceSha256: '0'.repeat(64) })) });
			const completed = A10_STEP_REGISTRY.slice(0, startIndex).map((step) => String(step.id));
			for (const expected of A10_STEP_REGISTRY.slice(startIndex)) {
				activeCheckpointId = String(expected.id);
				let result: Record<string, unknown>;
				try {
					result = await runScenarioCommand({ paths, inspectionAdapter, executionContext, dependencies: { inspectRun: (options: Record<string, unknown>) => inspectGate3HostedRun({ ...(options as Record<string, any>), fetchImpl: vi.fn(async () => new Response('', { status: 200, headers: { 'x-deployed-git-sha': releaseSha } })) } as never), now: tick } });
				} catch (error) {
					if (actorAttack?.checkpointId === expected.id) {
						const stopped = await readRunState(paths);
						expect(stopped.scenarioCheckpoints).not.toHaveProperty(`scenario-${expected.id}`);
						expect(stopped.revision).toBe(10 + A10_STEP_REGISTRY.indexOf(expected));
						expect(attempts.get(String(expected.id)) ?? 0).toBe(0);
						return 'actor-attack-rejected';
					}
					if (expected.id !== 'abandoned-upload-backdated') throw new Error(`unexpected ${expected.id} failure`, { cause: error });
					result = { status: (error as any).reasonCode === 'scenario_persistence_uncertain' ? 'uncertain' : (error as any).reasonCode, exitCode: (error as any).exitCode, replayed: (error as any).replayed, requiresFreshInspection: (error as any).requiresFreshInspection };
				}
				if (actorAttack?.checkpointId === expected.id) {
					expect(result).toMatchObject({
						status: expected.id === 'assignment-applied' ? 'confirmed-absent' : 'uncertain',
						exitCode: expected.id === 'assignment-applied' ? 40 : 41,
						checkpointId: expected.id
					});
					const stopped = await readRunState(paths);
					expect(stopped.scenarioCheckpoints).not.toHaveProperty(`scenario-${expected.id}`);
					expect(stopped.revision).toBe(10 + A10_STEP_REGISTRY.indexOf(expected));
					expect(attempts.get(String(expected.id)) ?? 0).toBe(0);
					return 'actor-attack-rejected';
				}
				if (expected.id === 'abandoned-upload-backdated') {
					expect(result).toMatchObject({ status: 'uncertain', exitCode: 41, replayed: false, requiresFreshInspection: true });
					expect(attempts.get('abandoned-upload-backdated')).toBe(1);
					expect(runScheduledCleanup).not.toHaveBeenCalled();
					if (backdateConcurrentChange) {
						const retryResult = await runScenarioCommand({ paths, inspectionAdapter, executionContext, dependencies: { inspectRun: (options: Record<string, unknown>) => inspectGate3HostedRun({ ...(options as Record<string, any>), fetchImpl: vi.fn(async () => new Response('', { status: 200, headers: { 'x-deployed-git-sha': releaseSha } })) } as never), now: tick } });
						expect(retryResult).toMatchObject({ status: 'uncertain', exitCode: 41, checkpointId: expected.id });
						expect(attempts.get('abandoned-upload-backdated')).toBe(1);
						const stopped = await readRunState(paths);
						expect(stopped.scenarioCheckpoints).not.toHaveProperty('scenario-abandoned-upload-backdated');
						return 'concurrent-cas-blocked';
					}
					if (backdateFailsBeforeApplyOnce) {
						const upload = rows.report_evidence_uploads.find((entry) => entry.id === ids.abandoned)!;
						if (backdateChangeBeforeRetry === 'future') upload.expires_at = '2026-08-22T22:00:00.000Z';
						if (backdateChangeBeforeRetry === 'past') upload.expires_at = '2026-08-22T18:58:00.000Z';
						const inspectionsBeforeRetry = inspectionAdapter.inspectRun.mock.calls.length;
						const retryResult = await runScenarioCommand({ paths, inspectionAdapter, executionContext, dependencies: { inspectRun: (options: Record<string, unknown>) => inspectGate3HostedRun({ ...(options as Record<string, any>), fetchImpl: vi.fn(async () => new Response('', { status: 200, headers: { 'x-deployed-git-sha': releaseSha } })) } as never), now: tick } });
						expect(retryResult).toMatchObject({ status: 'uncertain', exitCode: 41, replayed: false, requiresFreshInspection: true, checkpointId: expected.id });
						expect(inspectionAdapter.inspectRun.mock.calls.length).toBeGreaterThan(inspectionsBeforeRetry);
						if (backdateChangeBeforeRetry !== null) {
							expect(attempts.get('abandoned-upload-backdated')).toBe(1);
							const stopped = await readRunState(paths);
							expect(stopped.scenarioCheckpoints).not.toHaveProperty('scenario-abandoned-upload-backdated');
							return `changed-${backdateChangeBeforeRetry}-blocked`;
						}
						expect(attempts.get('abandoned-upload-backdated')).toBe(2);
					}
					runScheduledCleanup();
					result = await runScenarioCommand({ paths, inspectionAdapter, executionContext, dependencies: { inspectRun: (options: Record<string, unknown>) => inspectGate3HostedRun({ ...(options as Record<string, any>), fetchImpl: vi.fn(async () => new Response('', { status: 200, headers: { 'x-deployed-git-sha': releaseSha } })) } as never), now: tick } });
				}
				if (expected.id === 'assigned-moderator-read-verified' && moderatorBytes !== null) {
					expect(result).toMatchObject({ status: 'confirmed-absent', exitCode: 40, checkpointId: expected.id });
					const stopped = await readRunState(paths);
					expect(stopped.scenarioCheckpoints).not.toHaveProperty('scenario-assigned-moderator-read-verified');
					expect(stopped.revision).toBe(10 + A10_STEP_REGISTRY.indexOf(expected));
					return 'moderator-bytes-rejected';
				}
				expect(result).toMatchObject({ status: 'confirmed', exitCode: 0, checkpointId: expected.id }); completed.push(String(expected.id));
			}
			expect(runScheduledCleanup).toHaveBeenCalledOnce();
			for (const id of mutationIds) expect(attempts.get(id), id).toBe(backdateFailsBeforeApplyOnce && id === 'abandoned-upload-backdated' ? 2 : 1);
			expect(issuedReportTokens).toHaveLength(8);
			expect(new Set(issuedReportTokens).size).toBe(8);
			expect(consumedReportTokens.size).toBe(8);
			const persisted = await readRunState(paths); expect(persisted.revision).toBe(10 + A10_STEP_REGISTRY.length); expect(Object.keys(persisted.scenarioCheckpoints)).toEqual(A10_STEP_REGISTRY.map((step) => `scenario-${step.id}`));
			const noOp = await runScenarioCommand({ paths, inspectionAdapter, executionContext, dependencies: { inspectRun: (options: Record<string, unknown>) => inspectGate3HostedRun({ ...(options as Record<string, any>), fetchImpl: vi.fn(async () => new Response('', { status: 200, headers: { 'x-deployed-git-sha': releaseSha } })) } as never) } });
			expect(noOp).toMatchObject({ status: 'verified-noop', exitCode: 0, classification: 'SCENARIO_VERIFIED' }); for (const id of mutationIds) expect(attempts.get(id), id).toBe(backdateFailsBeforeApplyOnce && id === 'abandoned-upload-backdated' ? 2 : 1); return completed;
		} finally { await rm(root, { recursive: true, force: true }); }
	} });
}

function inspectionFor(state: ReturnType<typeof initialState>, bytes: Buffer, stepIndex: number, hostedCheckpointId: string | null, manifestCheckpointId: string | null, manifestAhead = false, overrides: Record<string, unknown> = {}) {
	return {
		runId: commandRunId,
		projectRef: HOSTED_STAGING.projectRef,
		workerOrigin: HOSTED_STAGING.workerOrigin,
		stateRevision: state.revision,
		stateSha256: hashBytes(Buffer.from(`${JSON.stringify(state)}\n`)),
		manifestSha256: hashBytes(bytes),
		boundReleaseCommitSha: releaseSha,
		currentReleaseCommitSha: releaseSha,
		stateValid: true,
		stateCorrupt: false,
		corruptState: false,
		manifestValid: true,
		manifestBindingStatus: manifestAhead ? 'manifest-ahead-state' : 'exact',
		manifestExactMatch: !manifestAhead,
		manifestAheadState: manifestAhead,
		manifestMatches: !manifestAhead,
		manifestMismatch: false,
		authoritativeReleaseAvailable: true,
		authoritativeReleaseUnavailable: false,
		releaseMismatch: false,
		releaseChanged: false,
		hostedEvidenceAvailable: true,
		ownershipConflict: false,
		deletionScopeTrusted: !manifestAhead,
		cleanupCompleteContradiction: false,
		credentialsLost: false,
		exactRecoveryProvenance: false,
		duplicateRoles: 0,
		metadataMismatches: 0,
		actorIdentityConflicts: 0,
		manifestActorsAbsent: 0,
		hostedActorsManifestStale: 0,
		actors: 4,
		provisionVerified: true,
		scenarioPartial: stepIndex > 0,
		scenarioVerified: false,
		cleanupRequired: false,
		cleanupPartial: false,
		cleanupVerified: false,
		archived: false,
		ambiguous: manifestAhead,
		scenarioEvidence: {
			completedCheckpointIds: A10_STEP_REGISTRY.slice(0, stepIndex).map((entry) => entry.id),
			hostedCheckpointId,
			manifestCheckpointId
		},
		...overrides
	};
}

async function operatorFor(step: (typeof A10_STEP_REGISTRY)[number], state: Record<string, any>, manifest: unknown, events: string[], mutation: () => Promise<void>, readBack: () => Promise<unknown>, boundManifestPath = manifestPath, evidenceSource: (() => { hostedCheckpointId: string | null; manifestCheckpointId: string | null }) | null = null) {
	void boundManifestPath;
	const exactManifest = manifest as ReturnType<typeof baseManifest>;
	const reduceManifest = step.manifestReducer === null
		? null
		: (evidence: Record<string, any>) => {
			if (step.manifestReducer === 'registerPrimaryReport') {
				return registerHostedUpload(registerHostedReport(exactManifest, evidence.reportId, 'reporter'), evidence.uploadId, 'reporter', evidence.objectPath);
			}
			if (['registerDuplicateUpload', 'registerAbandonedUpload'].includes(String(step.manifestReducer))) {
				return registerHostedUpload(exactManifest, evidence.uploadId, 'reporter', evidence.objectPath);
			}
			if (step.manifestReducer === 'registerRejectedUploadAndQueue') {
				return registerHostedQueueRow(registerHostedUpload(exactManifest, evidence.uploadId, 'reporter', evidence.objectPath), evidence.queueId, evidence.uploadId);
			}
			if (['registerDuplicateQueue', 'registerScheduledQueueCoordinate'].includes(String(step.manifestReducer))) {
				return registerHostedQueueRow(exactManifest, evidence.queueId, evidence.uploadId);
			}
			throw new Error('unsupported deterministic reducer');
		};
	return Object.freeze({
		executionContext: Object.freeze({}),
		dependencies: Object.freeze({
			inspectScenarioEvidence: async () => {
			events.push('scenario-inspect');
			const backendEvidence = evidenceSource?.() ?? { hostedCheckpointId: null, manifestCheckpointId: null };
			return {
				completedCheckpointIds: Object.keys(state.scenarioCheckpoints).map((key) => key.slice('scenario-'.length)),
				hostedCheckpointId: backendEvidence.hostedCheckpointId,
				manifestCheckpointId: backendEvidence.manifestCheckpointId
			};
		},
			bindCheckpointCapability: async ({ selected }: Record<string, any>) => {
				if (selected.checkpoint !== step) throw new Error('wrong deterministic checkpoint');
				return Object.freeze({
					roleCapability: step.roleCapability,
					mutation: step.kind === 'mutation' && selected.mode === 'mutate' ? mutation : null,
					readBack,
					reduceManifest
				});
			}
		})
	});
}

describe('runScenarioCommand exact owner flow', () => {
	it('rejects executable dependency overrides outside the deterministic test environment', async () => {
		const previous = process.env.NODE_ENV;
		const acquireRunLock = vi.fn();
		process.env.NODE_ENV = 'production';
		try {
			await expect(runScenarioCommand({
				paths: { runId: commandRunId, manifestPath },
				inspectionAdapter: Object.freeze({ inspectRun: vi.fn() }),
				executionContext: Object.freeze({}),
				dependencies: { acquireRunLock }
			})).rejects.toMatchObject({ reasonCode: 'scenario_precondition_failed', exitCode: 10 });
			expect(acquireRunLock).not.toHaveBeenCalled();
		} finally {
			process.env.NODE_ENV = previous;
		}
	});

	it('supports an explicit crash hook before mutation with zero operation calls', async () => {
		const step = A10_STEP_REGISTRY[0];
		const manifest = seedManifestFor(step);
		const state = initialState(0, manifest);
		const bytes = manifestBytes(manifest);
		const mutation = vi.fn();
		const operator = await operatorFor(step, state, manifest, [], mutation, async () => ({ outcome: 'confirmed', manifestEvidence: reducerEvidence(step), receipt: receipt(step.id) }));
		await expect(runScenarioCommand({
			paths: { runId: commandRunId, manifestPath },
			inspectionAdapter: Object.freeze({ inspectRun: vi.fn() }),
			executionContext: operator.executionContext,
			dependencies: {
				...operator.dependencies,
				crashAt: 'before-mutation',
				acquireRunLock: vi.fn(async () => ({ acquiredBytes: 'owned' })),
				inspectRunLock: vi.fn(async () => ({ status: 'held', acquiredBytes: 'owned' })),
				inspectRun: vi.fn(async () => inspectionFor(state, bytes, 0, null, null)),
				readStableSnapshot: vi.fn(async () => ({ state, stateBytes: Buffer.from(`${JSON.stringify(state)}\n`), manifestBytes: bytes })),
				readManifestBytes: vi.fn(async () => bytes),
				releaseRunLock: vi.fn(async () => true)
			}
		})).rejects.toMatchObject({ reasonCode: 'injected_scenario_crash', exitCode: 41 });
		expect(mutation).not.toHaveBeenCalled();
	});

	it('rejects a hostile fresh inspection without invoking accessors or proxy traps', async () => {
		const getter = vi.fn(() => false);
		const state = initialState(0, seedManifestFor(A10_STEP_REGISTRY[0]));
		const bytes = manifestBytes(seedManifestFor(A10_STEP_REGISTRY[0]));
		const hostile = inspectionFor(state, bytes, 0, null, null);
		Object.defineProperty(hostile, 'ambiguous', { enumerable: true, get: getter });
		const result = await runScenarioCommand({
			paths: { runId: commandRunId, manifestPath },
			inspectionAdapter: Object.freeze({ inspectRun: vi.fn() }),
			executionContext: Object.freeze({}),
			dependencies: {
				acquireRunLock: vi.fn(async () => ({ acquiredBytes: 'owned' })),
				inspectRunLock: vi.fn(async () => ({ status: 'held', acquiredBytes: 'owned' })),
				inspectRun: vi.fn(async () => hostile),
				releaseRunLock: vi.fn(async () => true)
			}
		});
		expect(result).toMatchObject({ status: 'blocked', classification: 'AMBIGUOUS', exitCode: 20 });
		expect(getter).not.toHaveBeenCalled();
	});

	it('preserves canonical blockers and never lets a contradictory scenarioVerified fact override them', async () => {
		const step = A10_STEP_REGISTRY[0];
		const manifest = seedManifestFor(step);
		const state = initialState(0, manifest);
		const bytes = manifestBytes(manifest);
		const cases = [
			['AMBIGUOUS', 20, { ambiguous: true, scenarioVerified: true }],
			['RELEASE_CHANGED', 21, { releaseMismatch: true, releaseChanged: true, scenarioVerified: true }],
			['RECOVERY_REQUIRED', 22, { credentialsLost: true, exactRecoveryProvenance: true, scenarioVerified: true }]
		] as const;
		for (const [classification, exitCode, facts] of cases) {
			const operation = vi.fn();
			const result = await runScenarioCommand({
				paths: { runId: commandRunId, manifestPath },
				inspectionAdapter: Object.freeze({ inspectRun: vi.fn() }),
				executionContext: Object.freeze({}),
				dependencies: {
					acquireRunLock: vi.fn(async () => ({ acquiredBytes: 'owned' })),
					inspectRunLock: vi.fn(async () => ({ status: 'held', acquiredBytes: 'owned' })),
					inspectRun: vi.fn(async () => inspectionFor(state, bytes, 0, null, null, false, facts)),
					releaseRunLock: vi.fn(async () => true),
					operation
				}
			});
			expect(result).toMatchObject({ status: 'blocked', classification, exitCode });
			expect(operation).not.toHaveBeenCalled();
		}
	});

	it('binds stable manifest bytes and blocks a swap race before capability use or mutation', async () => {
		const step = A10_STEP_REGISTRY[0];
		const manifest = seedManifestFor(step);
		const state = initialState(0, manifest);
		const bytes = manifestBytes(manifest);
		const operation = vi.fn();
		const result = await runScenarioCommand({
			paths: { runId: commandRunId, manifestPath },
			inspectionAdapter: Object.freeze({ inspectRun: vi.fn() }),
			executionContext: Object.freeze(new Proxy({}, { get: operation })),
			dependencies: {
				acquireRunLock: vi.fn(async () => ({ acquiredBytes: 'owned' })),
				inspectRunLock: vi.fn(async () => ({ status: 'held', acquiredBytes: 'owned' })),
				inspectRun: vi.fn(async () => inspectionFor(state, bytes, 0, null, null)),
				readStableSnapshot: vi.fn(async () => ({ state, stateBytes: Buffer.from(`${JSON.stringify(state)}\n`), manifestBytes: bytes })),
				readManifestBytes: vi.fn(async () => Buffer.from('swapped-manifest')),
				releaseRunLock: vi.fn(async () => true)
			}
		});
		expect(result).toMatchObject({ status: 'blocked', classification: 'AMBIGUOUS', exitCode: 20 });
		expect(operation).not.toHaveBeenCalled();
	});

	it('rejects a state/inspection manifest binding contradiction before capability use', async () => {
		const step = A10_STEP_REGISTRY[0];
		const manifest = seedManifestFor(step);
		const state = initialState(0, manifest);
		state.manifest.sha256 = 'e'.repeat(64);
		const bytes = manifestBytes(manifest);
		const capabilityUse = vi.fn();
		const result = await runScenarioCommand({
			paths: { runId: commandRunId, manifestPath },
			inspectionAdapter: Object.freeze({ inspectRun: vi.fn() }),
			executionContext: new Proxy({}, { get: capabilityUse }),
			dependencies: {
				acquireRunLock: vi.fn(async () => ({ acquiredBytes: 'owned' })),
				inspectRunLock: vi.fn(async () => ({ status: 'held', acquiredBytes: 'owned' })),
				inspectRun: vi.fn(async () => inspectionFor(state, bytes, 0, null, null)),
				readStableSnapshot: vi.fn(async () => ({ state, stateBytes: Buffer.from(`${JSON.stringify(state)}\n`), manifestBytes: bytes })),
				readManifestBytes: vi.fn(async () => bytes),
				releaseRunLock: vi.fn(async () => true)
			}
		});
		expect(result).toMatchObject({ status: 'blocked', classification: 'AMBIGUOUS', exitCode: 20 });
		expect(capabilityUse).not.toHaveBeenCalled();
	});

	it('rejects legacy executable inspection/provider callbacks and verification mutation smuggling', async () => {
		const step = A10_STEP_REGISTRY[0];
		const manifest = seedManifestFor(step);
		const state = initialState(0, manifest);
		const bytes = manifestBytes(manifest);
		const inspectScenario = vi.fn();
		const capabilityFor = vi.fn();
		await expect(runScenarioCommand({
			paths: { runId: commandRunId, manifestPath },
			inspectionAdapter: Object.freeze({ inspectRun: vi.fn() }),
			executionContext: { inspectScenario, capabilityFor },
			dependencies: {
				acquireRunLock: vi.fn(async () => ({ acquiredBytes: 'owned' })),
				inspectRunLock: vi.fn(async () => ({ status: 'held', acquiredBytes: 'owned' })),
				inspectRun: vi.fn(async () => inspectionFor(state, bytes, 0, null, null)),
				readStableSnapshot: vi.fn(async () => ({ state, stateBytes: Buffer.from(`${JSON.stringify(state)}\n`), manifestBytes: bytes })),
				readManifestBytes: vi.fn(async () => bytes),
				releaseRunLock: vi.fn(async () => true)
			}
		})).rejects.toMatchObject({ reasonCode: 'scenario_capability_invalid', exitCode: 10 });
		expect(inspectScenario).not.toHaveBeenCalled();
		expect(capabilityFor).not.toHaveBeenCalled();

		const verification = A10_STEP_REGISTRY[1];
		const verificationState = initialState(1, manifest);
		const smuggled = vi.fn();
		const verificationOperator = await operatorFor(verification, verificationState, manifest, [], smuggled, async () => ({ outcome: 'confirmed-absent', manifestEvidence: null, receipt: receipt(verification.id) }));
		const verificationBytes = manifestBytes(manifest);
		const result = await runScenarioCommand({
			paths: { runId: commandRunId, manifestPath },
			inspectionAdapter: Object.freeze({ inspectRun: vi.fn() }),
			executionContext: verificationOperator.executionContext,
			dependencies: {
				...verificationOperator.dependencies,
				acquireRunLock: vi.fn(async () => ({ acquiredBytes: 'owned' })),
				inspectRunLock: vi.fn(async () => ({ status: 'held', acquiredBytes: 'owned' })),
				inspectRun: vi.fn(async () => inspectionFor(verificationState, verificationBytes, 1, null, null)),
				readStableSnapshot: vi.fn(async () => ({ state: verificationState, stateBytes: Buffer.from(`${JSON.stringify(verificationState)}\n`), manifestBytes: verificationBytes })),
				readManifestBytes: vi.fn(async () => verificationBytes),
				releaseRunLock: vi.fn(async () => true)
			}
		});
		expect(result).toMatchObject({ checkpointId: verification.id, status: 'confirmed-absent', exitCode: 40 });
		expect(smuggled).not.toHaveBeenCalled();
	});

	it('uses the opaque target-bound operator for fresh read-only scenario evidence when the base inspector has no checkpoint detail', async () => {
		const step = A10_STEP_REGISTRY[0];
		const manifest = seedManifestFor(step);
		const state = initialState(0, manifest);
		const bytes = manifestBytes(manifest);
		const events: string[] = [];
		const operator = await operatorFor(step, state, manifest, events, async () => { events.push('mutation'); }, async () => ({ outcome: 'confirmed-absent', manifestEvidence: null, receipt: receipt(step.id) }));
		const inspection = inspectionFor(state, bytes, 0, null, null);
		delete (inspection as { scenarioEvidence?: unknown }).scenarioEvidence;
		const result = await runScenarioCommand({
			paths: { runId: commandRunId, manifestPath },
			inspectionAdapter: Object.freeze({ inspectRun: vi.fn() }),
			executionContext: operator.executionContext,
			dependencies: {
				...operator.dependencies,
				acquireRunLock: vi.fn(async () => ({ acquiredBytes: 'owned' })),
				inspectRunLock: vi.fn(async () => ({ status: 'held', acquiredBytes: 'owned' })),
				inspectRun: vi.fn(async () => inspection),
				readStableSnapshot: vi.fn(async () => ({ state, stateBytes: Buffer.from(`${JSON.stringify(state)}\n`), manifestBytes: bytes })),
				readManifestBytes: vi.fn(async () => bytes),
				releaseRunLock: vi.fn(async () => true)
			}
		});
		expect(result).toMatchObject({ checkpointId: step.id, status: 'confirmed-absent', exitCode: 40 });
		expect(events).toEqual(['scenario-inspect', 'mutation']);
	});

	it.each([
		['confirmed absence', 'confirmed-absent', 40, false],
		['uncertainty', 'uncertain', 41, true]
	] as const)('handles lock-release failure after %s without downgrading uncertainty', async (_name, outcome, exitCode, preserved) => {
		const step = A10_STEP_REGISTRY[0];
		const manifest = seedManifestFor(step);
		const state = initialState(0, manifest);
		const bytes = manifestBytes(manifest);
		const operator = await operatorFor(step, state, manifest, [], async () => undefined, async () => ({ outcome, manifestEvidence: null, receipt: receipt(step.id) }));
		const invocation = runScenarioCommand({
			paths: { runId: commandRunId, manifestPath },
			inspectionAdapter: Object.freeze({ inspectRun: vi.fn() }),
			executionContext: operator.executionContext,
			dependencies: {
				...operator.dependencies,
				acquireRunLock: vi.fn(async () => ({ acquiredBytes: 'owned' })),
				inspectRunLock: vi.fn(async () => ({ status: 'held', acquiredBytes: 'owned' })),
				inspectRun: vi.fn(async () => inspectionFor(state, bytes, 0, null, null)),
				readStableSnapshot: vi.fn(async () => ({ state, stateBytes: Buffer.from(`${JSON.stringify(state)}\n`), manifestBytes: bytes })),
				readManifestBytes: vi.fn(async () => bytes),
				releaseRunLock: vi.fn(async () => false)
			}
		});
		if (preserved) await expect(invocation).resolves.toMatchObject({ exitCode, status: outcome });
		else await expect(invocation).rejects.toMatchObject({ reasonCode: 'run_lock_release_failed', exitCode: 10 });
	});

	it.each([null, undefined, [], 'invalid'])('rejects reducer-backed invalid manifest output %j before manifest/state persistence', async (invalid) => {
		const selected = authorization(0);
		const persistManifest = vi.fn();
		const persistState = vi.fn();
		await expect(runScenarioBoundary({ inspection: authorizationInspections.get(selected), authorization: selected, capabilities: {
			roleCapability: 'reporter',
			mutation: vi.fn(),
			readBack: vi.fn(async () => ({ outcome: 'confirmed', manifestEvidence: {}, receipt: receipt() })),
			reduceManifest: vi.fn(() => invalid),
			persistManifest,
			persistState
		} })).rejects.toMatchObject({ reasonCode: 'scenario_manifest_evidence_invalid', exitCode: 41 });
		expect(persistManifest).not.toHaveBeenCalled();
		expect(persistState).not.toHaveBeenCalled();
	});
});

describe('A10 mutation crash and restart matrix through runScenarioCommand', () => {
	it.each([Buffer.alloc(0), Buffer.from('wrong-moderator-bytes')])('rejects empty or wrong moderator evidence bytes without checkpoint persistence', async (bytes) => {
		await expect(createSequentialA10ProductionHarness(bytes, null, false, null, false, 'assigned-moderator-read-verified').run()).resolves.toBe('moderator-bytes-rejected');
	}, 30_000);

	it.each([
		['cross-user-storage-denied', 'suspended'],
		['assigned-moderator-aal1-denied', 'demoted'],
		['assignment-applied', 'demoted'],
		['assigned-moderator-read-verified', 'suspended'],
		['unassigned-moderator-denied', 'suspended']
	] as const)('rejects a fresh %s actor %s race before the exact denial/read/assignment operation', async (checkpointId, kind) => {
		await expect(createSequentialA10ProductionHarness(null, { checkpointId, kind }, false, null, false, checkpointId).run()).resolves.toBe('actor-attack-rejected');
	}, 30_000);

	it.each(['future', 'past'] as const)('blocks backdate retry when the exact observed expiry changes to %s', async (change) => {
		await expect(createSequentialA10ProductionHarness(null, null, true, change, false, 'abandoned-upload-backdated').run()).resolves.toBe(`changed-${change}-blocked`);
	}, 30_000);

	it('keeps a concurrent expiry change that loses the backdate CAS uncertain without retry or persistence', async () => {
		await expect(createSequentialA10ProductionHarness(null, null, false, null, true, 'abandoned-upload-backdated').run()).resolves.toBe('concurrent-cas-blocked');
	}, 30_000);

	it.each([
		['clean', null],
		['extra-report', 'report'],
		['extra-upload-pending', 'upload-pending'],
		['extra-upload-finalized', 'upload-finalized'],
		['extra-upload-attached', 'upload-attached'],
		['extra-upload-rejected', 'upload-rejected'],
		['extra-upload-expired', 'upload-expired'],
		['extra-object', 'object'],
		['extra-queue', 'queue'],
		['foreign-actor-provenance', 'actor-provenance']
	] as const)('requires the valid primary compound to be the only exact post-request inventory: %s', async (_label, extraSurface) => {
		const root = await mkdtemp(join(tmpdir(), 'gate3-a10-clean-start-'));
		try {
			const paths = resolveGate3RunPaths({ root, runId: commandRunId });
			const manifest = baseManifest();
			const secretBytes = Buffer.from('opaque-encrypted-secret');
			const state = {
				...initialState(0, manifest),
				manifest: { path: paths.manifestPath, sha256: hashBytes(manifestBytes(manifest)) },
				secretStore: { path: paths.secretPath, status: 'persisted', ciphertextSha256: hashBytes(secretBytes) }
			};
			await reserveRunState(paths, state);
			await writeFile(paths.manifestPath, manifestBytes(manifest));
			await writeFile(paths.secretPath, secretBytes);
			const stateBefore = await readFile(paths.statePath);
			const manifestBefore = await readFile(paths.manifestPath);
			const reportId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
			const uploadId = '99999999-9999-4999-8999-999999999999';
			const extraId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
			const objectPath = `${actorIds.reporter}/${uploadId}.webp`;
			const extraObjectPath = `${actorIds.reporter}/${extraId}.webp`;
			const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
			const observedAt = manifest.actors[0].createdAt;
			const rows: Record<string, Array<Record<string, unknown>>> = { reports: [], report_evidence_uploads: [], upload_cleanup_queue: [] };
			let primaryObjectPresent = false;
			const users = Object.fromEntries(manifest.actors.map((actor) => [actor.userId, { id: actor.userId, email: actorEmails[actor.role as keyof typeof actorEmails], created_at: actor.createdAt, user_metadata: { gate3_report_evidence_run_id: commandRunId, gate3_report_evidence_provisioning_nonce: commandConfig.provisioningNonce, gate3_report_evidence_provisioning_attempt_id: commandConfig.provisioningNonce } }]));
			const serviceClient = {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: { admin: { getUserById: vi.fn(async (id: string) => ({ data: { user: users[id] }, error: null })) } },
				from(table: string) {
					const filters: Array<[string, unknown]> = [];
					const query: Record<string, any> = {
						select: () => query,
						eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
						in: (key: string, values: unknown[]) => { filters.push([key, values[0]]); return query; },
						like: (key: string, pattern: string) => { filters.push([key, pattern.replace(/%$/u, '')]); return query; },
						gte: () => query,
						contains: () => query,
						order: () => query,
						limit: () => query,
						maybeSingle: async () => {
							const data = (rows[table] ?? []).filter((row) => filters.every(([key, value]) => String(row[key] ?? '').startsWith(String(value))));
							return { data: data.length === 1 ? data[0] : null, error: data.length > 1 ? { code: 'ambiguous' } : null };
						},
						then: (resolve: (value: unknown) => unknown) => resolve({ data: (rows[table] ?? []).filter((row) => filters.every(([key, value]) => String(row[key] ?? '').startsWith(String(value)))), error: null })
					};
					return query;
				},
				storage: { from: () => ({ list: vi.fn(async (prefix: string) => ({ data: primaryObjectPresent && prefix === actorIds.reporter ? [
					{ name: `${uploadId}.webp`, created_at: observedAt, metadata: { size: 68, mimetype: 'image/webp' } },
					...(extraSurface === 'object' ? [{ name: `${extraId}.webp`, created_at: observedAt, metadata: { size: 68, mimetype: 'image/webp' } }] : [])
				] : [], error: null })) }) }
			};
			const jwt = (id: string) => `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.${Buffer.from('signature').toString('base64url')}`;
			let primaryMutations = 0;
			const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = input instanceof Request ? input.url : String(input);
				if (url.includes('/auth/v1/token')) return new Response(JSON.stringify({ access_token: jwt(actorIds.reporter), refresh_token: 'refresh-token-value', expires_in: 3600, token_type: 'bearer', user: { id: actorIds.reporter, email: actorEmails.reporter } }), { status: 200, headers: { 'content-type': 'application/json' } });
				if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: actorIds.reporter, email: actorEmails.reporter }), { status: 200, headers: { 'content-type': 'application/json' } });
				if (new URL(url).pathname === '/rest/v1/profiles') return new Response(JSON.stringify([{ id: actorIds.reporter, role: 'user', is_suspended: false }]), { status: 200, headers: { 'content-type': 'application/json' } });
				if (new URL(url).pathname === '/rest/v1/beta_memberships') return new Response(JSON.stringify([{ profile_id: actorIds.reporter, status: 'active', onboarding_completed_at: observedAt }]), { status: 200, headers: { 'content-type': 'application/json' } });
				if (url.endsWith('/report')) {
					primaryMutations += 1;
					expect(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('origin')).toBe(HOSTED_STAGING.workerOrigin);
					rows.reports.push({ id: reportId, reporter_id: actorIds.reporter, target_id: actorIds['cross-user'], details: `Synthetic Gate 3 evidence ${commandRunId}`, evidence_paths: [objectPath], status: 'open', assigned_to: null, created_at: observedAt });
					rows.report_evidence_uploads.push({ id: uploadId, uploader_id: actorIds.reporter, storage_path: objectPath, status: 'attached', source_byte_size: 68, actual_content_hash: 'a'.repeat(64), actual_byte_size: 68, actual_mime_type: 'image/webp', width_px: 1, height_px: 1, report_id: reportId, created_at: observedAt, updated_at: observedAt, expires_at: '2026-08-22T21:00:00.000Z', finalized_at: observedAt, attached_at: observedAt });
					if (extraSurface === 'report') rows.reports.push({ id: extraId, reporter_id: actorIds.reporter, target_id: actorIds['cross-user'], details: `Synthetic Gate 3 evidence ${commandRunId} extra`, evidence_paths: [], status: 'open', assigned_to: null, created_at: observedAt });
					if (extraSurface?.startsWith('upload-')) {
						const status = extraSurface.slice('upload-'.length);
						rows.report_evidence_uploads.push({ id: extraId, uploader_id: actorIds.reporter, storage_path: extraObjectPath, status, source_byte_size: 68, actual_content_hash: 'b'.repeat(64), actual_byte_size: 68, actual_mime_type: 'image/webp', width_px: 1, height_px: 1, report_id: status === 'attached' ? reportId : null, created_at: observedAt, updated_at: observedAt, expires_at: '2026-08-22T21:00:00.000Z', finalized_at: status === 'finalized' || status === 'attached' ? observedAt : null, attached_at: status === 'attached' ? observedAt : null });
					}
					if (extraSurface === 'queue') rows.upload_cleanup_queue.push({ id: 17, bucket_id: 'report-evidence', storage_path: extraObjectPath, report_evidence_upload_id: extraId, processed_at: null });
					if (extraSurface === 'actor-provenance') users[actorIds.reporter].user_metadata.gate3_report_evidence_run_id = 'foreign-run';
					primaryObjectPresent = true;
					return new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-deployed-git-sha': releaseSha } });
				}
				throw new Error('unexpected request');
			});
			const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config: commandConfig as never, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
			const executionContext = createHostedA10ExecutionContext({ config: commandConfig as never, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: fetchImpl as never });
			const inspectionAdapter = Object.freeze({ inspectRun: vi.fn(async () => ({
				counts: { actors: 4, sessions: 4, mfaFactors: 2, profiles: 4, reports: 0, uploads: 0, objects: 0, queueRows: 0 },
				foreignCounts: { syntheticAccounts: 0, profiles: 0, reports: 0, uploads: 0, objects: 0, queueRows: 0 },
				roleCounts: { reporter: 1, 'cross-user': 1, 'assigned-moderator': 1, 'unassigned-moderator': 1 },
				duplicateRoles: 0, metadataMismatches: 0, manifestActorsAbsent: 0, actorIdentityConflicts: 0, hostedActorsManifestStale: 0,
				confirmedActors: 4, completeProfiles: 4, verifiedModeratorTotpFactors: 2, moderatorsWithVerifiedTotp: 2, actorsWithActiveSessions: 4, activeSessionsProven: true,
				scenarioVerified: false, scenarioPartial: false, foreignEvidenceSha256: '0'.repeat(64)
			})) });
			const result = await runScenarioCommand({ paths, inspectionAdapter, executionContext, dependencies: { inspectRun: (options: Record<string, unknown>) => inspectGate3HostedRun({ ...(options as Record<string, any>), fetchImpl: vi.fn(async () => new Response('', { status: 200, headers: { 'x-deployed-git-sha': releaseSha } })) } as never) } });
			expect(primaryMutations).toBe(1);
			if (extraSurface === null) {
				expect(result).toMatchObject({ status: 'confirmed', exitCode: 0, checkpointId: 'primary-report-created', receipt: { actualResult: 'HTTP 200', requestId } });
				const persisted = await readRunState(paths);
				expect(persisted.revision).toBe(11);
				expect(persisted.scenarioCheckpoints).toHaveProperty('scenario-primary-report-created');
				expect(persisted.manifest.sha256).toBe(hashBytes(await readFile(paths.manifestPath)));
			} else {
				expect(result).toMatchObject({ status: 'uncertain', exitCode: 41, checkpointId: 'primary-report-created' });
				expect(await readFile(paths.statePath)).toEqual(stateBefore);
				expect(await readFile(paths.manifestPath)).toEqual(manifestBefore);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it.each([
		['report-upload-no-object', 'attached', 'exact', false, false, false],
		['wrong-object', 'attached', 'exact', true, false, true],
		['wrong-status', 'pending', 'exact', true, false, false],
		['wrong-link', 'attached', 'wrong', true, false, false],
		['wrong-metadata', 'attached', 'exact', true, true, false]
	] as const)('keeps file-backed primary partial case %s uncertain with zero POST and persistence', async (_label, uploadStatus, linkage, objectPresent, wrongMetadata, wrongObject) => {
		const root = await mkdtemp(join(tmpdir(), 'gate3-a10-primary-partial-'));
		try {
			const paths = resolveGate3RunPaths({ root, runId: commandRunId });
			const manifest = baseManifest();
			const secretBytes = Buffer.from('opaque-encrypted-secret');
			const state = { ...initialState(0, manifest), manifest: { path: paths.manifestPath, sha256: hashBytes(manifestBytes(manifest)) }, secretStore: { path: paths.secretPath, status: 'persisted', ciphertextSha256: hashBytes(secretBytes) } };
			await reserveRunState(paths, state); await writeFile(paths.manifestPath, manifestBytes(manifest)); await writeFile(paths.secretPath, secretBytes);
			const stateBefore = await readFile(paths.statePath); const manifestBefore = await readFile(paths.manifestPath);
			const reportId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; const uploadId = '99999999-9999-4999-8999-999999999999'; const objectPath = `${actorIds.reporter}/${uploadId}.webp`; const observedAt = manifest.actors[0].createdAt;
			const rows: Record<string, Array<Record<string, unknown>>> = {
				reports: [{ id: reportId, reporter_id: actorIds.reporter, target_id: actorIds['cross-user'], details: `Synthetic Gate 3 evidence ${commandRunId}`, evidence_paths: [objectPath], status: 'open', assigned_to: null, created_at: observedAt }],
				report_evidence_uploads: [{ id: uploadId, uploader_id: actorIds.reporter, storage_path: objectPath, status: uploadStatus, source_byte_size: 68, actual_content_hash: wrongMetadata ? 'invalid' : 'a'.repeat(64), actual_byte_size: wrongMetadata ? null : 68, actual_mime_type: 'image/webp', width_px: 1, height_px: 1, report_id: linkage === 'exact' ? reportId : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', created_at: observedAt, updated_at: observedAt, expires_at: '2026-08-22T21:00:00.000Z', finalized_at: observedAt, attached_at: observedAt }],
				upload_cleanup_queue: []
			};
			const users = Object.fromEntries(manifest.actors.map((actor) => [actor.userId, { id: actor.userId, email: actorEmails[actor.role as keyof typeof actorEmails], created_at: actor.createdAt, user_metadata: { gate3_report_evidence_run_id: commandRunId, gate3_report_evidence_provisioning_nonce: commandConfig.provisioningNonce, gate3_report_evidence_provisioning_attempt_id: commandConfig.provisioningNonce } }]));
			const serviceClient = {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: { admin: { getUserById: vi.fn(async (id: string) => ({ data: { user: users[id] }, error: null })), listUsers: vi.fn(async () => ({ data: { users: [], lastPage: 1 }, error: null })) } },
				from(table: string) {
					const filters: Array<(row: Record<string, unknown>) => boolean> = [];
					const query: Record<string, any> = { select: () => query, eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; }, gte: () => query, in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; }, like: (key: string, pattern: string) => { const prefix = pattern.replace(/%$/u, ''); filters.push((row) => String(row[key] ?? '').startsWith(prefix)); return query; }, contains: (key: string, values: unknown[]) => { filters.push((row) => Array.isArray(row[key]) && values.every((value) => (row[key] as unknown[]).includes(value))); return query; }, order: () => query, limit: () => query, maybeSingle: async () => { const data = (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))); return { data: data.length === 1 ? data[0] : null, error: data.length > 1 ? { code: 'ambiguous' } : null }; }, then: (resolve: (value: unknown) => unknown) => resolve({ data: (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))), error: null }) };
					return query;
				},
				storage: { from: () => ({ list: vi.fn(async (prefix: string) => ({ data: objectPresent && prefix === actorIds.reporter ? [{ name: `${uploadId}.webp`, created_at: observedAt, updated_at: observedAt, metadata: { size: wrongObject ? 69 : 68, mimetype: 'image/webp' } }] : [], error: null })) }) }
			};
			let posts = 0;
			const executionContext = createHostedA10ExecutionContext({ config: commandConfig as never, publishableKey: 'sb_publishable_test-key', privilegedAdapters: createSupabaseHostedEvidenceAdapters({ config: commandConfig as never, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never }), reportTokenProvider: freshReportTokenProvider(), fetchImpl: vi.fn(async () => { posts += 1; throw new Error('POST must not run'); }) as never });
			const inspectionAdapter = Object.freeze({ inspectRun: vi.fn(async () => ({ counts: { actors: 4, sessions: 4, mfaFactors: 2, profiles: 4, reports: 1, uploads: 1, objects: objectPresent ? 1 : 0, queueRows: 0 }, foreignCounts: { syntheticAccounts: 0, profiles: 0, reports: 0, uploads: 0, objects: 0, queueRows: 0 }, roleCounts: { reporter: 1, 'cross-user': 1, 'assigned-moderator': 1, 'unassigned-moderator': 1 }, duplicateRoles: 0, metadataMismatches: 0, manifestActorsAbsent: 0, actorIdentityConflicts: 0, hostedActorsManifestStale: 0, confirmedActors: 4, completeProfiles: 4, verifiedModeratorTotpFactors: 2, moderatorsWithVerifiedTotp: 2, actorsWithActiveSessions: 4, activeSessionsProven: true, scenarioVerified: false, scenarioPartial: true, foreignEvidenceSha256: '0'.repeat(64) })) });
			const result = await runScenarioCommand({ paths, inspectionAdapter, executionContext, dependencies: { inspectRun: (options: Record<string, unknown>) => inspectGate3HostedRun({ ...(options as Record<string, any>), fetchImpl: vi.fn(async () => new Response('', { status: 200, headers: { 'x-deployed-git-sha': releaseSha } })) } as never) } });
			expect(result).toMatchObject({ status: 'uncertain', exitCode: 41, checkpointId: 'primary-report-created' });
			expect(posts).toBe(0); expect(await readFile(paths.statePath)).toEqual(stateBefore); expect(await readFile(paths.manifestPath)).toEqual(manifestBefore);
		} finally { await rm(root, { recursive: true, force: true }); }
	}, 30_000);

	it('never promotes a contradictory hosted zero-artifact result to full completion from 22 local keys', async () => {
		const root = await mkdtemp(join(tmpdir(), 'gate3-a10-complete-'));
		try {
			const paths = resolveGate3RunPaths({ root, runId: commandRunId });
			const manifest = baseManifest();
			const secretBytes = Buffer.from('opaque-encrypted-secret');
			const state = {
				...initialState(A10_STEP_REGISTRY.length, manifest),
				manifest: { path: paths.manifestPath, sha256: hashBytes(manifestBytes(manifest)) },
				secretStore: { path: paths.secretPath, status: 'persisted', ciphertextSha256: hashBytes(secretBytes) },
				phases: { ...initialState(A10_STEP_REGISTRY.length, manifest).phases, scenario: { status: 'complete', checkpoint: null } }
			};
			await reserveRunState(paths, state);
			await writeFile(paths.manifestPath, manifestBytes(manifest));
			await writeFile(paths.secretPath, secretBytes);
			const inspectRun = vi.fn(async () => ({
				counts: { actors: 4, sessions: 4, mfaFactors: 2, profiles: 4, reports: 0, uploads: 0, objects: 0, queueRows: 0 },
				foreignCounts: { syntheticAccounts: 0, profiles: 0, reports: 0, uploads: 0, objects: 0, queueRows: 0 },
				roleCounts: { reporter: 1, 'cross-user': 1, 'assigned-moderator': 1, 'unassigned-moderator': 1 },
				duplicateRoles: 0, metadataMismatches: 0, manifestActorsAbsent: 0, actorIdentityConflicts: 0, hostedActorsManifestStale: 0,
				confirmedActors: 4, completeProfiles: 4, verifiedModeratorTotpFactors: 2, moderatorsWithVerifiedTotp: 2, actorsWithActiveSessions: 4, activeSessionsProven: true,
				scenarioVerified: false, scenarioPartial: false, foreignEvidenceSha256: '0'.repeat(64)
			}));
			const capabilityTrap = vi.fn();
			const result = await runScenarioCommand({
				paths,
				inspectionAdapter: Object.freeze({ inspectRun }),
				executionContext: new Proxy({}, { get: capabilityTrap, getOwnPropertyDescriptor: capabilityTrap, ownKeys: capabilityTrap }),
				dependencies: { inspectRun: (options: Record<string, unknown>) => inspectGate3HostedRun({ ...(options as Record<string, any>), fetchImpl: vi.fn(async () => new Response('', { status: 200, headers: { 'x-deployed-git-sha': releaseSha } })) } as never) }
			});
			expect(result).toMatchObject({ status: 'blocked', classification: 'AMBIGUOUS', exitCode: 20, revision: 10 });
			expect(inspectRun).toHaveBeenCalledOnce();
			expect(capabilityTrap).not.toHaveBeenCalled();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('returns a read-only no-op only when the real inspector has fresh live anchors plus the exact 22-prefix', async () => {
		const root = await mkdtemp(join(tmpdir(), 'gate3-a10-live-complete-'));
		try {
			const paths = resolveGate3RunPaths({ root, runId: commandRunId });
			const reportId = '55555555-5555-4555-8555-555555555555';
			const uploadId = '66666666-6666-4666-8666-666666666666';
			let manifest = baseManifest();
			manifest = registerHostedReport(manifest, reportId, 'reporter');
			manifest = registerHostedUpload(manifest, uploadId, 'reporter', `${actorIds.reporter}/${uploadId}.webp`);
			manifest = registerHostedQueueRow(manifest, 17, uploadId);
			const secretBytes = Buffer.from('opaque-encrypted-secret');
			const state = {
				...initialState(A10_STEP_REGISTRY.length, manifest),
				manifest: { path: paths.manifestPath, sha256: hashBytes(manifestBytes(manifest)) },
				secretStore: { path: paths.secretPath, status: 'persisted', ciphertextSha256: hashBytes(secretBytes) },
				phases: { ...initialState(A10_STEP_REGISTRY.length, manifest).phases, scenario: { status: 'complete', checkpoint: null } }
			};
			await reserveRunState(paths, state);
			await writeFile(paths.manifestPath, manifestBytes(manifest));
			await writeFile(paths.secretPath, secretBytes);
			const inspectRun = vi.fn(async () => ({
				counts: { actors: 4, sessions: 4, mfaFactors: 2, profiles: 4, reports: 1, uploads: 1, objects: 1, queueRows: 1 },
				foreignCounts: { syntheticAccounts: 0, profiles: 0, reports: 0, uploads: 0, objects: 0, queueRows: 0 },
				roleCounts: { reporter: 1, 'cross-user': 1, 'assigned-moderator': 1, 'unassigned-moderator': 1 },
				duplicateRoles: 0, metadataMismatches: 0, manifestActorsAbsent: 0, actorIdentityConflicts: 0, hostedActorsManifestStale: 0,
				confirmedActors: 4, completeProfiles: 4, verifiedModeratorTotpFactors: 2, moderatorsWithVerifiedTotp: 2, actorsWithActiveSessions: 4, activeSessionsProven: true,
				scenarioVerified: true, scenarioPartial: false, foreignEvidenceSha256: '0'.repeat(64)
			}));
			const result = await runScenarioCommand({
				paths,
				inspectionAdapter: Object.freeze({ inspectRun }),
				executionContext: productionProbeContextFor(A10_STEP_REGISTRY[A10_STEP_REGISTRY.length - 1], manifest, vi.fn()),
				dependencies: { inspectRun: (options: Record<string, unknown>) => inspectGate3HostedRun({ ...(options as Record<string, any>), fetchImpl: vi.fn(async () => new Response('', { status: 200, headers: { 'x-deployed-git-sha': releaseSha } })) } as never) }
			});
			expect(result).toEqual({ status: 'verified-noop', exitCode: 0, classification: 'SCENARIO_VERIFIED', revision: 10 });
			expect(inspectRun).toHaveBeenCalledOnce();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it.each(['extra', 'reordered'] as const)('lowers hosted completion to AMBIGUOUS for an %s checkpoint key sequence', async (attack) => {
		const root = await mkdtemp(join(tmpdir(), `gate3-a10-prefix-${attack}-`));
		try {
			const paths = resolveGate3RunPaths({ root, runId: commandRunId });
			const manifest = baseManifest();
			const secretBytes = Buffer.from('opaque-encrypted-secret');
			const baseline = initialState(A10_STEP_REGISTRY.length, manifest);
			const entries = Object.entries(baseline.scenarioCheckpoints);
			const attackedCheckpoints = attack === 'extra'
				? { ...baseline.scenarioCheckpoints, 'scenario-noncanonical-suffix': { operationId: 'noncanonical-suffix' } }
				: Object.fromEntries([...entries].reverse());
			const state = {
				...baseline,
				manifest: { path: paths.manifestPath, sha256: hashBytes(manifestBytes(manifest)) },
				secretStore: { path: paths.secretPath, status: 'persisted', ciphertextSha256: hashBytes(secretBytes) },
				phases: { ...baseline.phases, scenario: { status: 'complete', checkpoint: null } },
				scenarioCheckpoints: attackedCheckpoints
			};
			await reserveRunState(paths, state);
			await writeFile(paths.manifestPath, manifestBytes(manifest));
			await writeFile(paths.secretPath, secretBytes);
			const inspectRun = vi.fn(async () => ({
				counts: { actors: 4, sessions: 4, mfaFactors: 2, profiles: 4, reports: 1, uploads: 4, objects: 1, queueRows: 3 },
				foreignCounts: { syntheticAccounts: 0, profiles: 0, reports: 0, uploads: 0, objects: 0, queueRows: 0 },
				roleCounts: { reporter: 1, 'cross-user': 1, 'assigned-moderator': 1, 'unassigned-moderator': 1 },
				duplicateRoles: 0, metadataMismatches: 0, manifestActorsAbsent: 0, actorIdentityConflicts: 0, hostedActorsManifestStale: 0,
				confirmedActors: 4, completeProfiles: 4, verifiedModeratorTotpFactors: 2, moderatorsWithVerifiedTotp: 2, actorsWithActiveSessions: 4, activeSessionsProven: true,
				scenarioVerified: true, scenarioPartial: false, foreignEvidenceSha256: '0'.repeat(64)
			}));
			const result = await runScenarioCommand({
				paths,
				inspectionAdapter: Object.freeze({ inspectRun }),
				executionContext: productionProbeContextFor(A10_STEP_REGISTRY.at(-1)!, manifest, vi.fn()),
				dependencies: { inspectRun: (options: Record<string, unknown>) => inspectGate3HostedRun({ ...(options as Record<string, any>), fetchImpl: vi.fn(async () => new Response('', { status: 200, headers: { 'x-deployed-git-sha': releaseSha } })) } as never) }
			});
			expect(result).toMatchObject({ status: 'blocked', classification: 'AMBIGUOUS', exitCode: 20 });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('reconciles the real inspector unexplained report+upload manifest delta without replay', async () => {
		const root = await mkdtemp(join(tmpdir(), 'gate3-a10-atomic-'));
		try {
			const paths = resolveGate3RunPaths({ root, runId: commandRunId });
			const predecessor = baseManifest();
			const reportId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
			const uploadId = '99999999-9999-4999-8999-999999999999';
			const objectPath = `${actorIds.reporter}/${uploadId}.webp`;
			const fullManifest = registerHostedUpload(registerHostedReport(predecessor, reportId, 'reporter'), uploadId, 'reporter', objectPath);
			const secretBytes = Buffer.from('opaque-encrypted-secret');
			const state = {
				...initialState(0, predecessor),
				manifest: { path: paths.manifestPath, sha256: hashBytes(manifestBytes(predecessor)) },
				secretStore: { path: paths.secretPath, status: 'persisted', ciphertextSha256: hashBytes(secretBytes) }
			};
			await reserveRunState(paths, state);
			await writeFile(paths.manifestPath, manifestBytes(fullManifest));
			await writeFile(paths.secretPath, secretBytes);

			const users = Object.fromEntries(fullManifest.actors.map((actor) => [actor.userId, {
				id: actor.userId,
				email: actorEmails[actor.role as keyof typeof actorEmails],
				created_at: actor.createdAt,
				user_metadata: {
					gate3_report_evidence_run_id: commandRunId,
					gate3_report_evidence_provisioning_nonce: commandConfig.provisioningNonce,
					gate3_report_evidence_provisioning_attempt_id: commandConfig.provisioningNonce
				}
			}]));
			const rows: Record<string, Array<Record<string, unknown>>> = {
				reports: [{ id: reportId, reporter_id: actorIds.reporter, target_id: actorIds['cross-user'], details: `Synthetic Gate 3 evidence ${commandRunId}`, evidence_paths: [objectPath], status: 'open', assigned_to: null, created_at: '2026-08-22T20:00:00.000Z' }],
				report_evidence_uploads: [{ id: uploadId, uploader_id: actorIds.reporter, storage_path: objectPath, status: 'attached', source_byte_size: 68, actual_content_hash: 'd'.repeat(64), actual_byte_size: 68, actual_mime_type: 'image/webp', width_px: 1, height_px: 1, report_id: reportId, created_at: '2026-08-22T20:00:00.000Z', finalized_at: '2026-08-22T20:00:01.000Z', attached_at: '2026-08-22T20:00:02.000Z' }]
			};
			const serviceClient = {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: { admin: { getUserById: vi.fn(async (id: string) => ({ data: { user: users[id] }, error: null })) } },
				from(table: string) {
					const filters: Array<(row: Record<string, unknown>) => boolean> = [];
					const query: Record<string, any> = {
						select: () => query,
						eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
						in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
						like: (key: string, pattern: string) => { const prefix = pattern.replace(/%$/u, ''); filters.push((row) => String(row[key] ?? '').startsWith(prefix)); return query; },
						gte: () => query,
						maybeSingle: async () => {
							const matches = (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
							return { data: matches.length === 1 ? matches[0] : null, error: matches.length <= 1 ? null : { code: 'ambiguous' } };
						},
						then: (resolve: (value: unknown) => unknown) => resolve({ data: (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))), error: null })
					};
					return query;
				},
				storage: { from: () => ({ list: vi.fn(async (prefix: string) => ({ data: prefix === actorIds.reporter ? [{ name: `${uploadId}.webp`, created_at: '2026-08-22T20:00:00.500Z', updated_at: null, metadata: { size: 68, mimetype: 'image/webp' } }] : [], error: null })) }) }
			};
			const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config: commandConfig as never, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
			const executionContext = createHostedA10ExecutionContext({ config: commandConfig as never, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: vi.fn() as never });
			let readBackCalls = 0;
			const originalInspect = serviceClient.from.bind(serviceClient);
			serviceClient.from = ((table: string) => { readBackCalls += table === 'reports' ? 1 : 0; return originalInspect(table); }) as never;
			const inspectionAdapter = Object.freeze({ inspectRun: vi.fn(async () => { throw new Error('real inspector must not inspect an unbound manifest'); }) });
			let capturedInspection: Record<string, unknown> | null = null;
			const result = await runScenarioCommand({
				paths,
				inspectionAdapter,
				executionContext,
				dependencies: {
					inspectRun: async (options: Record<string, unknown>) => {
						capturedInspection = await inspectGate3HostedRun({ ...(options as Record<string, any>), fetchImpl: vi.fn(async () => new Response('', { status: 200, headers: { 'x-deployed-git-sha': releaseSha } })) } as never);
						return capturedInspection;
					}
				}
			});
			expect(capturedInspection).toMatchObject({ manifestBindingStatus: 'unexplained-mismatch', manifestMismatch: true, hostedEvidenceAvailable: false, stateValid: true, manifestValid: true });
			expect(readBackCalls).toBe(4);
			expect(result).toMatchObject({ status: 'confirmed', exitCode: 0, checkpointId: 'primary-report-created', replayed: false, receipt: { boundary: 'HTTP', actualResult: 'targeted readback verified', requestId: 'not-exposed' } });
			const persisted = await readRunState(paths);
			expect(persisted.revision).toBe(11);
			expect(persisted.manifest.sha256).toBe(hashBytes(await readFile(paths.manifestPath)));
			expect(persisted.scenarioCheckpoints).toHaveProperty('scenario-primary-report-created');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('reconciles the real scenario-8 rejected upload+queue atomic delta without mutation replay', async () => {
		const root = await mkdtemp(join(tmpdir(), 'gate3-a10-rejected-'));
		try {
			const paths = resolveGate3RunPaths({ root, runId: commandRunId });
			const primaryReportId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
			const primaryUploadId = '99999999-9999-4999-8999-999999999999';
			const duplicateUploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
			const rejectedUploadId = '88888888-8888-4888-8888-888888888888';
			let predecessor = registerHostedUpload(registerHostedReport(baseManifest(), primaryReportId, 'reporter'), primaryUploadId, 'reporter', `${actorIds.reporter}/${primaryUploadId}.webp`);
			predecessor = registerHostedUpload(predecessor, duplicateUploadId, 'reporter', `${actorIds.reporter}/${duplicateUploadId}.webp`);
			predecessor = { ...predecessor, queueRows: [{ id: 17, uploadId: duplicateUploadId }] };
			const rejectedPath = `${actorIds.reporter}/${rejectedUploadId}.webp`;
			const withRejected = registerHostedUpload(predecessor as never, rejectedUploadId, 'reporter', rejectedPath);
			const fullManifest = { ...withRejected, queueRows: [...withRejected.queueRows, { id: 18, uploadId: rejectedUploadId }] };
			const secretBytes = Buffer.from('opaque-encrypted-secret');
			const state = {
				...initialState(10, predecessor),
				manifest: { path: paths.manifestPath, sha256: hashBytes(manifestBytes(predecessor)) },
				secretStore: { path: paths.secretPath, status: 'persisted', ciphertextSha256: hashBytes(secretBytes) }
			};
			await reserveRunState(paths, state);
			await writeFile(paths.manifestPath, manifestBytes(fullManifest));
			await writeFile(paths.secretPath, secretBytes);
			const users = Object.fromEntries(fullManifest.actors.map((actor) => [actor.userId, { id: actor.userId, email: actorEmails[actor.role as keyof typeof actorEmails], created_at: actor.createdAt, user_metadata: { gate3_report_evidence_run_id: commandRunId, gate3_report_evidence_provisioning_nonce: commandConfig.provisioningNonce, gate3_report_evidence_provisioning_attempt_id: commandConfig.provisioningNonce } }]));
			const rows: Record<string, Array<Record<string, unknown>>> = {
				report_evidence_uploads: [{ id: rejectedUploadId, uploader_id: actorIds.reporter, storage_path: rejectedPath, status: 'rejected', source_byte_size: 68, report_id: null, created_at: '2026-08-22T20:00:00.000Z', finalized_at: null, attached_at: null }],
				upload_cleanup_queue: [{ id: 18, processed_at: null, report_evidence_upload_id: rejectedUploadId, bucket_id: 'report-evidence', storage_path: rejectedPath }]
			};
			let readBackCalls = 0;
			const serviceClient = {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: { admin: { getUserById: vi.fn(async (id: string) => ({ data: { user: users[id] }, error: null })) } },
				from(table: string) {
					if (table === 'report_evidence_uploads') readBackCalls += 1;
					const filters: Array<[string, unknown]> = [];
					const query: Record<string, any> = {
						select: () => query,
						eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
						gte: () => query,
						order: () => query,
						limit: () => query,
						maybeSingle: async () => {
							const matches = (rows[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value));
							return { data: matches.length === 1 ? matches[0] : null, error: matches.length <= 1 ? null : { code: 'ambiguous' } };
						},
						then: (resolve: (value: unknown) => unknown) => resolve({ data: (rows[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value)), error: null })
					};
					return query;
				},
				storage: { from: () => ({ list: vi.fn(async () => ({ data: [], error: null })) }) }
			};
			const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config: commandConfig as never, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
			const executionContext = createHostedA10ExecutionContext({ config: commandConfig as never, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: vi.fn() as never });
			const result = await runScenarioCommand({
				paths,
				inspectionAdapter: Object.freeze({ inspectRun: vi.fn(async () => { throw new Error('unbound manifest'); }) }),
				executionContext,
				dependencies: { inspectRun: (options: Record<string, unknown>) => inspectGate3HostedRun({ ...(options as Record<string, any>), fetchImpl: vi.fn(async () => new Response('', { status: 200, headers: { 'x-deployed-git-sha': releaseSha } })) } as never) }
			});
			expect(result).toMatchObject({ status: 'confirmed', exitCode: 0, checkpointId: 'rejected-upload-created', replayed: false, receipt: { boundary: 'HTTP', actualResult: 'targeted readback verified', requestId: 'not-exposed' } });
			expect(readBackCalls).toBe(2);
			const persisted = await readRunState(paths);
			expect(persisted.revision).toBe(11);
			expect(persisted.manifest.sha256).toBe(hashBytes(await readFile(paths.manifestPath)));
			expect(persisted.scenarioCheckpoints).toHaveProperty('scenario-rejected-upload-created');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	const mutationSteps = A10_STEP_REGISTRY.filter((step) => step.kind === 'mutation');
	const windows: readonly CrashWindow[] = ['before-mutation', 'after-mutation-before-verification', 'after-verification-before-manifest', 'after-manifest-before-state'];
	const ephemeralMutationIds = new Set([
		'cross-user-storage-denied',
		'duplicate-reuse-denied',
		'assigned-moderator-aal1-denied',
		'unassigned-moderator-denied',
		'malformed-request-rejected',
		'invalid-image-rejected',
		'per-file-limit-rejected',
		'aggregate-limit-rejected',
		'chunked-limit-rejected',
		'understated-length-rejected'
	]);
	const completedCrashCases = new Set<string>();
	let crashMatrixRoot: string | null = null;
	afterAll(async () => {
		if (crashMatrixRoot !== null) await rm(crashMatrixRoot, { recursive: true, force: true });
	});

	const runCrashMatrixCase = async ({ step, window }: { step: (typeof A10_STEP_REGISTRY)[number]; window: CrashWindow }) => {
			const index = A10_STEP_REGISTRY.indexOf(step);
			crashMatrixRoot ??= await mkdtemp(join(tmpdir(), 'gate3-a10-matrix-'));
			const root = join(crashMatrixRoot, `${String(index).padStart(2, '0')}-${window}`);
			await mkdir(root, { recursive: true });
			let manifest = seedManifestFor(step);
			const paths = resolveGate3RunPaths({ root, runId: commandRunId });
			const secretBytes = Buffer.from('opaque-encrypted-secret');
			let state: Record<string, any> = {
				...initialState(index, manifest),
				manifest: { path: paths.manifestPath, sha256: hashBytes(manifestBytes(manifest)) },
				secretStore: { path: paths.secretPath, status: 'persisted', ciphertextSha256: hashBytes(secretBytes) }
			};
			let bytes = manifestBytes(manifest);
			await reserveRunState(paths, state);
			await writeFile(paths.manifestPath, bytes);
			await writeFile(paths.secretPath, secretBytes);
			let hostedApplied = false;
			let manifestCheckpoint = false;
			let mutationAttempts = 0;
			let blindReplayCount = 0;
			let freshAuthorizedRetryCount = 0;
			let freshConclusiveSafetyInspectionCount = 0;
			let safetyInspectionEpoch = 0;
			let lastAttemptSafetyEpoch = 0;
			let readBackCount = 0;
			let manifestWriteCount = 0;
			let stateWriteCount = 0;
			let lockChecks = 0;
			const inspectionAdapter = Object.freeze({
				inspectRun: vi.fn(async () => ({
					counts: {
						actors: 4,
						sessions: 4,
						mfaFactors: 2,
						profiles: 4,
						reports: manifest.reports.length,
						uploads: manifest.uploads.length,
						objects: manifest.uploads.length,
						queueRows: manifest.queueRows.length
					},
					foreignCounts: { syntheticAccounts: 0, profiles: 0, reports: 0, uploads: 0, objects: 0, queueRows: 0 },
					roleCounts: { reporter: 1, 'cross-user': 1, 'assigned-moderator': 1, 'unassigned-moderator': 1 },
					duplicateRoles: 0,
					metadataMismatches: 0,
					manifestActorsAbsent: 0,
					actorIdentityConflicts: 0,
					hostedActorsManifestStale: 0,
					confirmedActors: 4,
					completeProfiles: 4,
					verifiedModeratorTotpFactors: 2,
					moderatorsWithVerifiedTotp: 2,
					actorsWithActiveSessions: 4,
					activeSessionsProven: true,
					scenarioVerified: false,
					scenarioPartial: false,
					foreignEvidenceSha256: '0'.repeat(64)
				}))
			});
			const releaseFetch = vi.fn(async () => new Response('', { status: 200, headers: { 'x-deployed-git-sha': releaseSha } }));
			let lastFreshInspection: Record<string, unknown> | null = null;
			const inspectFromFiles = async (options: Record<string, any> = {}) => {
				lastFreshInspection = await inspectGate3HostedRun({ paths, inspectionAdapter: options.inspectionAdapter ?? inspectionAdapter, fetchImpl: releaseFetch } as never);
				return lastFreshInspection;
			};
			const snapshotFromFiles = async () => {
				const [persistedState, stateBytes, persistedManifestBytes, persistedSecretBytes] = await Promise.all([
					readRunState(paths),
					readFile(paths.statePath),
					readFile(paths.manifestPath),
					readFile(paths.secretPath)
				]);
				return { state: persistedState, stateBytes, manifestBytes: persistedManifestBytes, secretBytes: persistedSecretBytes };
			};
			const firstEvents: string[] = [];
			const mutation = async () => {
				firstEvents.push('mutation');
				if (mutationAttempts > 0) {
					if (safetyInspectionEpoch > lastAttemptSafetyEpoch) freshAuthorizedRetryCount += 1;
					else blindReplayCount += 1;
				}
				mutationAttempts += 1;
				lastAttemptSafetyEpoch = safetyInspectionEpoch;
				if (!ephemeralMutationIds.has(String(step.id))) hostedApplied = true;
			};
			const readBack = async () => {
				firstEvents.push('readback');
				readBackCount += 1;
				return { outcome: 'confirmed', manifestEvidence: reducerEvidence(step), receipt: receipt(step.id) };
			};
			const currentEvidence = () => {
				if (ephemeralMutationIds.has(String(step.id)) && mutationAttempts > 0 && !hostedApplied) {
					safetyInspectionEpoch += 1;
					freshConclusiveSafetyInspectionCount += 1;
				}
				return { hostedCheckpointId: hostedApplied ? String(step.id) : null, manifestCheckpointId: null };
			};
			const firstOperator = await operatorFor(step, state, manifest, firstEvents, mutation, readBack, paths.manifestPath, currentEvidence);
			let firstResult: Record<string, unknown>;
			try {
				firstResult = await runScenarioCommand({
					paths,
					inspectionAdapter,
					executionContext: firstOperator.executionContext,
					dependencies: {
						...firstOperator.dependencies,
						crashAt: window,
						acquireRunLock: vi.fn(async () => { firstEvents.push('acquire'); return { acquiredBytes: 'owned' }; }),
						inspectRunLock: vi.fn(async () => { firstEvents.push('lock-check'); lockChecks += 1; return { status: 'held', acquiredBytes: 'owned' }; }),
						inspectRun: vi.fn(async (options) => { firstEvents.push('inspect'); return inspectFromFiles(options); }),
						readStableSnapshot: vi.fn(async () => { firstEvents.push('snapshot'); return snapshotFromFiles(); }),
						readManifestBytes: vi.fn(async () => { firstEvents.push('manifest-recheck'); return readFile(paths.manifestPath); }),
						persistManifest: vi.fn(async (_config, nextManifest) => {
							firstEvents.push('manifest-write');
							await persistHostedRunManifest(commandConfig as never, nextManifest, paths.manifestPath);
							manifest = nextManifest;
							bytes = manifestBytes(nextManifest);
							manifestCheckpoint = true;
							manifestWriteCount += 1;
						}),
						writeNextRunState: vi.fn(async (writePaths, current, next) => {
							firstEvents.push('state-write');
							await writeNextRunState(writePaths, current, next);
							state = next;
							stateWriteCount += 1;
						}),
						now: vi.fn(() => '2026-08-22T20:00:00.000Z'),
						releaseRunLock: vi.fn(async () => { firstEvents.push('release'); return true; })
					}
				});
			} catch (error) {
				firstResult = { status: (error as { reasonCode: string }).reasonCode, exitCode: (error as { exitCode: number }).exitCode, replayed: (error as { replayed: boolean }).replayed, requiresFreshInspection: (error as { requiresFreshInspection: boolean }).requiresFreshInspection };
			}
			const expectedFirst = window === 'before-mutation'
				? ['acquire', 'lock-check', 'inspect', 'lock-check', 'snapshot', 'manifest-recheck', 'scenario-inspect', 'manifest-recheck', 'lock-check', 'release']
				: window === 'after-mutation-before-verification'
					? ['acquire', 'lock-check', 'inspect', 'lock-check', 'snapshot', 'manifest-recheck', 'scenario-inspect', 'manifest-recheck', 'lock-check', 'mutation', 'release']
					: window === 'after-verification-before-manifest'
						? ['acquire', 'lock-check', 'inspect', 'lock-check', 'snapshot', 'manifest-recheck', 'scenario-inspect', 'manifest-recheck', 'lock-check', 'mutation', 'lock-check', 'readback', 'release']
						: ['acquire', 'lock-check', 'inspect', 'lock-check', 'snapshot', 'manifest-recheck', 'scenario-inspect', 'manifest-recheck', 'lock-check', 'mutation', 'lock-check', 'readback', 'lock-check', 'manifest-write', 'release'];
			expect(firstEvents).toEqual(expectedFirst);
			expect(firstResult).toMatchObject({ status: window === 'after-verification-before-manifest' ? 'uncertain' : 'injected_scenario_crash', exitCode: 41, replayed: false, requiresFreshInspection: true });
			expect(mutationAttempts).toBe(window === 'before-mutation' ? 0 : 1);
			expect(readBackCount).toBe(['before-mutation', 'after-mutation-before-verification'].includes(window) ? 0 : 1);
			expect(manifestWriteCount).toBe(window === 'after-manifest-before-state' ? 1 : 0);
			expect(stateWriteCount).toBe(0);
			expect(state.revision).toBe(10);

			const resumeEvents: string[] = [];
			lockChecks = 0;
			const failClosedEphemeral = ephemeralMutationIds.has(String(step.id)) && window !== 'before-mutation';
			if (window === 'after-manifest-before-state' && step.manifestReducer === 'registerPrimaryReport') {
				const candidate = { ...manifest, reports: manifest.reports.slice(0, -1), uploads: manifest.uploads.slice(0, -1) };
				expect(hashBytes(manifestBytes(candidate))).toBe(state.manifest.sha256);
			}
			const resumeOperator = await operatorFor(step, state, manifest, resumeEvents, async () => {
				resumeEvents.push('mutation');
				if (mutationAttempts > 0) {
					if (safetyInspectionEpoch > lastAttemptSafetyEpoch) freshAuthorizedRetryCount += 1;
					else blindReplayCount += 1;
				}
				mutationAttempts += 1;
				lastAttemptSafetyEpoch = safetyInspectionEpoch;
				if (!ephemeralMutationIds.has(String(step.id))) hostedApplied = true;
			}, async () => {
				resumeEvents.push('readback');
				readBackCount += 1;
				return { outcome: 'confirmed', manifestEvidence: reducerEvidence(step), receipt: receipt(step.id) };
			}, paths.manifestPath, currentEvidence);
			const reducerAheadRecovery = window === 'after-manifest-before-state' && step.manifestReducer !== null;
			const resumeContext = reducerAheadRecovery
				? productionProbeContextFor(step, manifest as ReturnType<typeof baseManifest>, () => { resumeEvents.push('readback'); readBackCount += 1; })
				: resumeOperator.executionContext;
			const resumeResult = await runScenarioCommand({
				paths,
				inspectionAdapter,
				executionContext: resumeContext,
				dependencies: {
					...(reducerAheadRecovery ? {} : resumeOperator.dependencies),
					acquireRunLock: vi.fn(async () => { resumeEvents.push('acquire'); return { acquiredBytes: 'owned' }; }),
					inspectRunLock: vi.fn(async () => { resumeEvents.push('lock-check'); return { status: 'held', acquiredBytes: 'owned' }; }),
					inspectRun: vi.fn(async (options) => { resumeEvents.push('inspect'); return inspectFromFiles(options); }),
					readStableSnapshot: vi.fn(async () => { resumeEvents.push('snapshot'); return snapshotFromFiles(); }),
					readManifestBytes: vi.fn(async () => { resumeEvents.push('manifest-recheck'); return readFile(paths.manifestPath); }),
					persistManifest: vi.fn(async (_config, nextManifest) => {
						resumeEvents.push('manifest-write');
						await persistHostedRunManifest(commandConfig as never, nextManifest, paths.manifestPath);
						manifest = nextManifest;
						bytes = manifestBytes(nextManifest);
						manifestCheckpoint = true;
						manifestWriteCount += 1;
					}),
					writeNextRunState: vi.fn(async (writePaths, current, next) => {
						resumeEvents.push('state-write');
						await writeNextRunState(writePaths, current, next);
						state = next;
						stateWriteCount += 1;
					}),
					now: vi.fn(() => '2026-08-22T20:01:00.000Z'),
					releaseRunLock: vi.fn(async () => { resumeEvents.push('release'); return true; })
				}
			});
			const resumedMutation = window === 'before-mutation' || failClosedEphemeral ? ['lock-check', 'mutation'] : [];
			const resumedManifest = reducerAheadRecovery ? [] : ['lock-check', 'manifest-write'];
			if (window === 'after-manifest-before-state' && step.manifestReducer !== null) {
				const atomic = ['registerPrimaryReport', 'registerRejectedUploadAndQueue'].includes(String(step.manifestReducer));
				expect(lastFreshInspection).toMatchObject(atomic
					? { manifestBindingStatus: 'unexplained-mismatch', hostedEvidenceAvailable: false, ownershipConflict: true, actors: 0, provisionVerified: false }
					: { manifestBindingStatus: 'manifest-ahead-state', hostedEvidenceAvailable: true, ownershipConflict: false, actors: 4, provisionVerified: true });
			}
			expect(resumeResult).toMatchObject({ status: 'confirmed', exitCode: 0, checkpointId: step.id, replayed: false, requiresFreshInspection: false });
			const primaryAheadRecovery = reducerAheadRecovery && step.manifestReducer === 'registerPrimaryReport';
			expect(resumeEvents).toEqual(primaryAheadRecovery
				? ['acquire', 'lock-check', 'inspect', 'lock-check', 'snapshot', 'manifest-recheck', 'readback', 'readback', 'manifest-recheck', 'lock-check', 'readback', 'readback', 'lock-check', 'state-write', 'release']
				: reducerAheadRecovery
				? ['acquire', 'lock-check', 'inspect', 'lock-check', 'snapshot', 'manifest-recheck', 'readback', 'manifest-recheck', 'lock-check', 'readback', 'lock-check', 'state-write', 'release']
				: ['acquire', 'lock-check', 'inspect', 'lock-check', 'snapshot', 'manifest-recheck', 'scenario-inspect', 'manifest-recheck', ...resumedMutation, 'lock-check', 'readback', ...resumedManifest, 'lock-check', 'state-write', 'release']);
			expect(blindReplayCount).toBe(0);
			expect(freshAuthorizedRetryCount).toBe(failClosedEphemeral ? 1 : 0);
			expect(freshConclusiveSafetyInspectionCount).toBe(failClosedEphemeral ? 1 : 0);
			expect(mutationAttempts).toBe(window === 'before-mutation' ? 1 : failClosedEphemeral ? 2 : 1);
			expect(readBackCount).toBe(reducerAheadRecovery ? primaryAheadRecovery ? 5 : 3 : ['before-mutation', 'after-mutation-before-verification'].includes(window) ? 1 : 2);
			expect(manifestWriteCount).toBe(window === 'after-manifest-before-state' && step.manifestReducer === null ? 2 : 1);
			expect(stateWriteCount).toBe(1);
			expect(state.revision).toBe(11);
			expect(state.manifest.sha256).toBe(hashBytes(bytes));
			expect(Object.keys(state.scenarioCheckpoints).at(-1)).toBe(`scenario-${step.id}`);
			const persistedState = await readRunState(paths);
			expect(persistedState.revision).toBe(11);
			expect(persistedState.manifest.sha256).toBe(hashBytes(await readFile(paths.manifestPath)));
			expect(Object.keys(persistedState.scenarioCheckpoints).at(-1)).toBe(`scenario-${step.id}`);
			const nextStep = A10_STEP_REGISTRY[index + 1] ?? null;
			const nextSelectionEvents: string[] = [];
			if (nextStep === null) {
				const result = await runScenarioCommand({
					paths,
					inspectionAdapter,
					executionContext: Object.freeze({}),
					dependencies: {
						acquireRunLock: vi.fn(async () => { nextSelectionEvents.push('acquire'); return { acquiredBytes: 'owned' }; }),
						inspectRunLock: vi.fn(async () => { nextSelectionEvents.push('lock-check'); return { status: 'held', acquiredBytes: 'owned' }; }),
						inspectRun: vi.fn(async (options) => { nextSelectionEvents.push('inspect'); return inspectFromFiles(options); }),
						readStableSnapshot: vi.fn(async () => { nextSelectionEvents.push('snapshot'); return snapshotFromFiles(); }),
						releaseRunLock: vi.fn(async () => { nextSelectionEvents.push('release'); return true; })
					}
				});
				expect(lastFreshInspection).toMatchObject({ scenarioVerified: false, ambiguous: false, manifestBindingStatus: 'exact' });
				expect(result).toMatchObject({ status: 'blocked', classification: 'AMBIGUOUS', exitCode: 20 });
				expect(nextSelectionEvents).toEqual(['acquire', 'lock-check', 'inspect', 'lock-check', 'snapshot', 'release']);
			} else {
				let nextMutationAttempts = 0;
				const nextOperator = await operatorFor(nextStep, state, manifest, nextSelectionEvents, async () => {
					nextSelectionEvents.push('next-mutation');
					nextMutationAttempts += 1;
				}, async () => {
					nextSelectionEvents.push('next-readback');
					return { outcome: 'confirmed-absent', manifestEvidence: null, receipt: receipt(nextStep.id) };
				}, paths.manifestPath, () => ({ hostedCheckpointId: null, manifestCheckpointId: null }));
				const selectedNext = await runScenarioCommand({
					paths,
					inspectionAdapter,
					executionContext: nextOperator.executionContext,
					dependencies: {
						...nextOperator.dependencies,
						acquireRunLock: vi.fn(async () => { nextSelectionEvents.push('acquire'); return { acquiredBytes: 'owned' }; }),
						inspectRunLock: vi.fn(async () => { nextSelectionEvents.push('lock-check'); return { status: 'held', acquiredBytes: 'owned' }; }),
						inspectRun: vi.fn(async (options) => { nextSelectionEvents.push('inspect'); return inspectFromFiles(options); }),
						readStableSnapshot: vi.fn(async () => { nextSelectionEvents.push('snapshot'); return snapshotFromFiles(); }),
						readManifestBytes: vi.fn(async () => { nextSelectionEvents.push('manifest-recheck'); return readFile(paths.manifestPath); }),
						releaseRunLock: vi.fn(async () => { nextSelectionEvents.push('release'); return true; })
					}
				});
				expect(selectedNext).toMatchObject({ checkpointId: nextStep.id, status: 'confirmed-absent', exitCode: 40 });
				expect(nextSelectionEvents).toEqual(nextStep.kind === 'mutation'
					? ['acquire', 'lock-check', 'inspect', 'lock-check', 'snapshot', 'manifest-recheck', 'scenario-inspect', 'manifest-recheck', 'lock-check', 'next-mutation', 'lock-check', 'next-readback', 'release']
					: ['acquire', 'lock-check', 'inspect', 'lock-check', 'snapshot', 'manifest-recheck', 'scenario-inspect', 'manifest-recheck', 'lock-check', 'next-readback', 'release']);
				expect(nextMutationAttempts).toBe(nextStep.kind === 'mutation' ? 1 : 0);
			}
			expect(blindReplayCount).toBe(0);
			completedCrashCases.add(`${step.id}:${window}`);
	};

	it('progresses all 22 checkpoints sequentially with real files and one checkpoint-independent production context', async () => {
		const harness = createSequentialA10ProductionHarness();
		await expect(harness.run()).resolves.toEqual(A10_STEP_REGISTRY.map((step) => step.id));
	}, 30_000);

	it('retries backdating only after fresh inspection proves the exact expiration was unchanged', async () => {
		await expect(createSequentialA10ProductionHarness(null, null, true, null, false, 'abandoned-upload-backdated').run()).resolves.toEqual(A10_STEP_REGISTRY.map((step) => step.id));
	}, 30_000);

	it.each(mutationSteps.flatMap((step) => windows.map((window) => ({ step, window, id: step.id }))))(
		'reconciles $id at $window through a fresh command lifecycle',
		runCrashMatrixCase
	);

	it('has dedicated full scenario-8 crash coverage', () => {
		const scenarioEightMutationIds = A10_STEP_REGISTRY.filter((step) => step.scenario === 8 && step.kind === 'mutation').map((step) => step.id);
		expect(scenarioEightMutationIds).toEqual(['rejected-upload-created', 'manual-cleanup-verified', 'abandoned-upload-allocated', 'abandoned-object-created', 'abandoned-upload-backdated']);
		const expected = scenarioEightMutationIds.flatMap((id) => windows.map((window) => `${id}:${window}`));
		expect(expected).toHaveLength(20);
		expect([...completedCrashCases].filter((entry) => expected.includes(entry))).toEqual(expected);
	});
});
