import { describe, expect, it, vi } from 'vitest';
import {
	GATE3_EXIT_CODES,
	classifyGate3Lifecycle,
	consumeGate3ScenarioCapabilityGrant,
	mintGate3ScenarioCapabilityGrant,
	selectGate3NextBoundary,
	selectNextCleanupStep,
	selectNextProvisionStep,
	selectNextScenarioProbe,
	selectNextScenarioStep
} from '../../scripts/gate3-hosted-lifecycle.mjs';

function inspection(overrides: Record<string, unknown> = {}) {
	return {
		actors: 0,
		provisionVerified: false,
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
		state: {},
		...overrides
	};
}

function scenarioRegistry() {
	const first = Object.freeze({
		id: 'first-step',
		scenario: 1,
		kind: 'mutation',
		prerequisiteIds: Object.freeze([]),
		roleCapability: 'reporter',
		mutationMethod: 'mutateFirst',
		readBackMethod: 'readFirst',
		manifestReducer: 'registerPrimaryReport'
	});
	const second = Object.freeze({
		id: 'second-step',
		scenario: 1,
		kind: 'verification',
		prerequisiteIds: Object.freeze(['first-step']),
		roleCapability: 'reporter',
		mutationMethod: null,
		readBackMethod: 'readSecond',
		manifestReducer: null
	});
	return Object.freeze([first, second]);
}

const scenarioCoordinates = Object.freeze({
	runId: 'gate3-20260822-abcdef12',
	projectRef: 'nuhkpqjjyuygiemrxbdp',
	supabaseUrl: 'https://nuhkpqjjyuygiemrxbdp.supabase.co',
	workerOrigin: 'https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev',
	releaseCommitSha: 'b'.repeat(40),
	stateRevision: 7,
	stateSha256: 'c'.repeat(64),
	manifestPath: 'C:/private/gate3-run-manifest.json',
	manifestSha256: 'd'.repeat(64),
	inspectionNonce: 'e'.repeat(64),
	checkpointObservedAfter: '2026-08-22T19:00:00.000Z'
});

function scenarioInspection(overrides: Record<string, unknown> = {}) {
	return inspection({
		actors: 4,
		provisionVerified: true,
		...scenarioCoordinates,
		boundReleaseCommitSha: scenarioCoordinates.releaseCommitSha,
		currentReleaseCommitSha: scenarioCoordinates.releaseCommitSha,
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
		hostedActorsManifestStale: 0,
		...overrides
	});
}

function scenarioEvidence(overrides: Record<string, unknown> = {}) {
	return {
		completedCheckpointIds: [],
		hostedCheckpointId: null,
		manifestCheckpointId: null,
		...scenarioCoordinates,
		...overrides
	};
}

describe('Gate 3 hosted lifecycle policy', () => {
	const cases = [
		['fresh bound run', inspection({ actors: 0 }), 'PREFLIGHT_READY', ['inspect', 'provision']],
		['partial actors', inspection({ actors: 2 }), 'PROVISION_PARTIAL', ['inspect', 'provision', 'cleanup']],
		[
			'four verified actors',
			inspection({ actors: 4, provisionVerified: true }),
			'PROVISION_VERIFIED',
			['inspect', 'scenario', 'cleanup']
		],
		[
			'scenario partial',
			inspection({ actors: 4, provisionVerified: true, scenarioPartial: true }),
			'SCENARIO_PARTIAL',
			['inspect', 'scenario', 'cleanup']
		],
		['cleanup partial', inspection({ cleanupPartial: true }), 'CLEANUP_PARTIAL', ['inspect', 'cleanup']],
		['archived', inspection({ archived: true }), 'ARCHIVED', ['inspect']]
	] as const;

	it.each(cases)('%s', (_name, input, classification, allowed) => {
		expect(classifyGate3Lifecycle(input)).toMatchObject({ classification, allowedCommands: allowed });
	});

	it('classifies all remaining normal lifecycle stages', () => {
		expect(classifyGate3Lifecycle(inspection({ actors: 4, provisionVerified: true, scenarioVerified: true }))).toMatchObject({
		classification: 'SCENARIO_VERIFIED',
		allowedCommands: ['inspect', 'cleanup']
	});
		expect(classifyGate3Lifecycle(inspection({ cleanupRequired: true }))).toMatchObject({
		classification: 'CLEANUP_REQUIRED',
		allowedCommands: ['inspect', 'cleanup']
	});
		expect(classifyGate3Lifecycle(inspection({ cleanupVerified: true }))).toMatchObject({
		classification: 'CLEANUP_VERIFIED',
		allowedCommands: ['inspect', 'archive']
	});
	});

	it('gives ambiguous evidence precedence over a release mismatch', () => {
		expect(
		classifyGate3Lifecycle(inspection({ releaseMismatch: true, manifestMatches: false }))
	).toMatchObject({ classification: 'AMBIGUOUS', allowedCommands: ['inspect'] });
	});

	it('gives a proven release mismatch precedence over lost credentials', () => {
		expect(
		classifyGate3Lifecycle(
			inspection({ releaseMismatch: true, credentialsLost: true, exactRecoveryProvenance: true })
		)
	).toMatchObject({ classification: 'RELEASE_CHANGED', allowedCommands: ['inspect'] });
	});

	it('requires exact recovery provenance for lost credentials', () => {
		expect(
		classifyGate3Lifecycle(inspection({ credentialsLost: true, exactRecoveryProvenance: true }))
	).toMatchObject({ classification: 'RECOVERY_REQUIRED', allowedCommands: ['inspect', 'recover'] });
		expect(classifyGate3Lifecycle(inspection({ credentialsLost: true }))).toMatchObject({
		classification: 'AMBIGUOUS',
		allowedCommands: ['inspect']
	});
	});

	it('does not let a persisted state assertion prove advancement', () => {
		expect(
		classifyGate3Lifecycle(
			inspection({ state: { phases: { scenario: { status: 'verified' } } } })
		)
	).toMatchObject({ classification: 'PREFLIGHT_READY' });
	});

	it('does not select a scenario boundary before verified provisioning', () => {
		const preflight = inspection({ actors: 0 });
		expect(selectGate3NextBoundary(preflight, 'scenario')).toBeNull();
		expect(selectGate3NextBoundary(preflight, 'provision')).toEqual({
		command: 'provision',
		phase: 'provision'
	});
	});

	it('fails closed when required inspection proof is missing', () => {
		const lifecycle = classifyGate3Lifecycle({ actors: 0 });
		expect(lifecycle).toMatchObject({ classification: 'AMBIGUOUS', allowedCommands: ['inspect'] });
		expect(selectGate3NextBoundary(lifecycle, 'provision')).toBeNull();
	});

	it.each([
		['partial scenario without verified provision', { actors: 4, provisionVerified: false, scenarioPartial: true }],
		['verified scenario without four actors', { actors: 0, provisionVerified: true, scenarioVerified: true }]
	])('%s is ambiguous', (_name, stage) => {
		expect(classifyGate3Lifecycle(inspection(stage))).toMatchObject({
			classification: 'AMBIGUOUS',
			allowedCommands: ['inspect']
		});
	});

	it('selects one exact residual artifact for cleanup', () => {
		const input = inspection({
			cleanupPartial: true,
			residualArtifacts: [{ kind: 'auth-user', id: 'user-123' }]
		});
		expect(selectGate3NextBoundary(input, 'cleanup')).toEqual({
		command: 'cleanup',
		phase: 'cleanup',
		target: { kind: 'auth-user', id: 'user-123' }
	});
	});

	it.each([
		['missing target', undefined],
		['empty identifier', [{ kind: 'auth-user', id: '' }]],
		['unapproved kind', [{ kind: 'wildcard', id: 'user-123' }]],
		['multiple targets', [{ kind: 'auth-user', id: 'user-123' }, { kind: 'report', id: 'report-123' }]]
	])('blocks cleanup with %s', (_name, residualArtifacts) => {
		const lifecycle = classifyGate3Lifecycle(inspection({ cleanupPartial: true, residualArtifacts }));
		expect(lifecycle.nextBoundary).toBeNull();
		expect(selectGate3NextBoundary(lifecycle, 'cleanup')).toBeNull();
	});

	it('returns only serializable data without force, retry, wildcard, or mutation functions', () => {
		const lifecycle = classifyGate3Lifecycle(inspection({ cleanupPartial: true }));
		expect(JSON.parse(JSON.stringify(lifecycle))).toEqual(lifecycle);
		expect(Object.values(lifecycle).every((value) => typeof value !== 'function')).toBe(true);
		expect(lifecycle.allowedCommands).not.toContain('force');
		expect(lifecycle.allowedCommands).not.toContain('retry');
		expect(JSON.stringify(lifecycle)).not.toMatch(/\*|force|retry|mutation/u);
	});

	it('exposes the specified exit-code mapping', () => {
		expect(GATE3_EXIT_CODES).toEqual({
		success: 0,
		precondition: 10,
		AMBIGUOUS: 20,
		RELEASE_CHANGED: 21,
		RECOVERY_REQUIRED: 22,
		approvalDeclined: 30,
		confirmedNoMutation: 40,
		uncertainMutation: 41
	});
	});

	it('fails closed when a forged lifecycle claims a command outside its classification allow-list', () => {
		expect(
		selectGate3NextBoundary(
			{
				classification: 'PREFLIGHT_READY',
				allowedCommands: ['scenario'],
				nextBoundary: { command: 'scenario', phase: 'scenario' }
			},
			'scenario'
		)
	).toBeNull();
	});

	describe('mutation blockers', () => {
		it.each([
			['corrupt state', { stateValid: false }],
			['manifest mismatch', { manifestMismatch: true }],
			['conflicting ownership', { conflictingOwnership: true }],
			['untrusted deletion scope', { untrustedDeletionScope: true }],
			['unavailable authoritative release', { authoritativeReleaseUnavailable: true }]
		])('%s fails closed', (_name, blocker) => {
			expect(classifyGate3Lifecycle(inspection(blocker))).toMatchObject({
				classification: 'AMBIGUOUS',
				allowedCommands: ['inspect']
			});
		});
	});

	it('rejects a canonical-looking copied lifecycle output', () => {
		const canonical = classifyGate3Lifecycle(inspection({ actors: 0 }));
		const forged = {
			...canonical,
			allowedCommands: [...canonical.allowedCommands],
			nextBoundary: { ...canonical.nextBoundary }
		};
		expect(selectGate3NextBoundary(forged, 'provision')).toBeNull();
	});

	it('recomputes provision policy from equivalent serialized inspection facts', () => {
		const source = inspection({ actors: 0 });
		const restored = JSON.parse(JSON.stringify(source));
		expect(selectNextProvisionStep(source)).toEqual({ command: 'provision', phase: 'provision' });
		expect(selectNextProvisionStep(restored)).toEqual(selectNextProvisionStep(source));
		expect(
			selectNextProvisionStep({
				classification: 'PREFLIGHT_READY',
				allowedCommands: ['inspect', 'provision'],
				nextBoundary: { command: 'provision', phase: 'provision' },
				reasonCode: 'preflight_ready',
				exitCodeKey: 'success'
			})
		).toBeNull();
	});

	it.each([
		['provision partial', inspection({ actors: 2, residualArtifacts: [{ kind: 'auth-user', id: 'user-1' }] })],
		[
			'provision verified',
			inspection({ actors: 4, provisionVerified: true, residualArtifacts: [{ kind: 'auth-user', id: 'user-2' }] })
		],
		[
			'scenario partial',
			inspection({
				actors: 4,
				provisionVerified: true,
				stateRevision: 7,
				scenarioPartial: true,
				residualArtifacts: [{ kind: 'report', id: 'report-1' }]
			})
		]
	])('selects exact cleanup for %s', (_name, input) => {
		expect(selectNextCleanupStep(input)).toMatchObject({ command: 'cleanup', phase: 'cleanup' });
	});

	it.each([
		[undefined],
		[[{ kind: 'auth-user', id: '' }]],
		[[{ kind: 'wildcard', id: 'user-1' }]],
		[[{ kind: 'auth-user', id: 'user-1' }, { kind: 'report', id: 'report-1' }]]
	])('does not select cleanup without one exact residual target', (residualArtifacts) => {
		expect(selectNextCleanupStep(inspection({ actors: 2, residualArtifacts }))).toBeNull();
	});

	it('enforces provision and scenario preconditions through inspection selectors', () => {
		expect(selectNextProvisionStep({ actors: 0 })).toBeNull();
		expect(selectNextScenarioStep(inspection({ actors: 4, provisionVerified: true }))).toBeNull();
		expect(selectNextScenarioStep(inspection({ actors: 2, provisionVerified: true }))).toBeNull();
	});

	it('does not treat a generic scenario lifecycle result as exact step authorization', () => {
		const registry = scenarioRegistry();
		const generic = classifyGate3Lifecycle(inspection({ actors: 4, provisionVerified: true }));

		expect(selectNextScenarioStep(generic, registry)).toBeNull();
		expect(selectNextScenarioStep(inspection({ actors: 4, provisionVerified: true }), registry)).toBeNull();
	});

	it('selects exactly one registry entry only from exact fresh run, target, release, state, and manifest evidence', () => {
		const registry = scenarioRegistry();
		const selected = selectNextScenarioStep(scenarioInspection(), registry, scenarioEvidence());

		expect(selected).toMatchObject({
			command: 'scenario',
			phase: 'scenario',
			checkpoint: registry[0],
			mode: 'mutate',
			revision: 7,
			coordinates: scenarioCoordinates
		});
		expect(selected?.checkpoint).toBe(registry[0]);
		expect(Object.isFrozen(selected?.coordinates)).toBe(true);
	});

	it('mints a read-only canonical probe before final mutation authorization', () => {
		const registry = scenarioRegistry();
		const probe = selectNextScenarioProbe(scenarioInspection(), registry, scenarioEvidence());
		expect(probe).toMatchObject({ checkpoint: registry[0], revision: 7, coordinates: scenarioCoordinates });
		expect(Reflect.ownKeys(probe ?? {})).toEqual(['checkpoint', 'revision', 'coordinates']);
		expect(Object.isFrozen(probe)).toBe(true);
	});

	it('mints at most one capability grant for one exact lifecycle authorization and consumes that grant once', () => {
		const registry = scenarioRegistry();
		const inspected = scenarioInspection();
		const selected = selectNextScenarioStep(inspected, registry, scenarioEvidence());
		expect(selected).not.toBeNull();
		const first = mintGate3ScenarioCapabilityGrant(selected, registry, inspected);
		expect(first).not.toBeNull();
		expect(mintGate3ScenarioCapabilityGrant(selected, registry, inspected)).toBeNull();
		expect(consumeGate3ScenarioCapabilityGrant(first)).toMatchObject({ checkpoint: registry[0], mode: 'mutate' });
		expect(consumeGate3ScenarioCapabilityGrant(first)).toBeNull();
	});

	it('mints only an inert exact readback probe for a strict one-artifact manifest-ahead window', () => {
		const registry = scenarioRegistry();
		const inspected = scenarioInspection({
			ambiguous: true,
			manifestBindingStatus: 'manifest-ahead-state',
			manifestExactMatch: false,
			manifestAheadState: true,
			manifestMatches: false,
			manifestMismatch: false,
			deletionScopeTrusted: false
		});
		const probe = selectNextScenarioProbe(inspected, registry, scenarioEvidence());
		expect(probe).toMatchObject({ checkpoint: registry[0], revision: 7, coordinates: scenarioCoordinates });
		expect(Reflect.ownKeys(probe ?? {})).toEqual(['checkpoint', 'revision', 'coordinates']);
		expect(Object.isFrozen(probe)).toBe(true);
	});

	it.each([
		['run', { runId: 'gate3-20260822-deadbeef' }],
		['project', { projectRef: 'wrong-project' }],
		['Supabase URL', { supabaseUrl: 'https://attacker.invalid' }],
		['worker', { workerOrigin: 'https://wrong.invalid' }],
		['release', { releaseCommitSha: 'f'.repeat(40) }],
		['revision', { stateRevision: 8 }],
		['state SHA', { stateSha256: 'f'.repeat(64) }],
		['manifest path', { manifestPath: 'C:/private/other.json' }],
		['manifest SHA', { manifestSha256: 'f'.repeat(64) }],
		['inspection provenance', { inspectionNonce: 'f'.repeat(64) }]
	])('fails closed for same-looking evidence from a different %s', (_name, attack) => {
		const registry = scenarioRegistry();
		expect(selectNextScenarioStep(scenarioInspection(), registry, scenarioEvidence(attack))).toBeNull();
	});

	it('selects reconciliation for the same exact entry without advancing or replaying it', () => {
		const registry = scenarioRegistry();
		const selected = selectNextScenarioStep(
			scenarioInspection(),
			registry,
			scenarioEvidence({ hostedCheckpointId: 'first-step' })
		);

		expect(selected).toMatchObject({
			checkpoint: registry[0],
			mode: 'reconcile',
			revision: 7
		});
	});

	it('authorizes only a lifecycle-matched exact multi-field A10 manifest-ahead delta', () => {
		const registry = scenarioRegistry();
		const inspected = scenarioInspection({
			ambiguous: true,
			manifestBindingStatus: 'unexplained-mismatch',
			manifestExactMatch: false,
			manifestAheadState: false,
			manifestMatches: false,
			manifestMismatch: true,
			deletionScopeTrusted: false,
			recognizedA10AtomicManifestAhead: true,
			a10AtomicManifestDelta: 'report-upload'
		});
		const selected = selectNextScenarioStep(inspected, registry, scenarioEvidence({
			hostedCheckpointId: 'first-step',
			manifestCheckpointId: null
		}));
		expect(selected).toMatchObject({ checkpoint: registry[0], mode: 'reconcile', manifestState: 'ahead' });
		expect(selectNextScenarioStep({ ...inspected, a10AtomicManifestDelta: 'upload-queue' }, registry, scenarioEvidence({ hostedCheckpointId: 'first-step', manifestCheckpointId: null }))).toBeNull();
	});

	it.each([
		['unknown completed checkpoint', { completedCheckpointIds: ['unknown-step'] }],
		['non-prefix completed checkpoints', { completedCheckpointIds: ['second-step'] }],
		['ambiguous hosted and manifest checkpoints', { hostedCheckpointId: 'first-step', manifestCheckpointId: 'second-step' }],
		['stale hosted checkpoint behind persisted evidence', { completedCheckpointIds: ['first-step'], hostedCheckpointId: 'first-step' }],
		['manifest checkpoint without hosted proof', { manifestCheckpointId: 'first-step' }],
		['no remaining step', { completedCheckpointIds: ['first-step', 'second-step'] }]
	])('fails closed for independently valid %s', (_name, attack) => {
		const registry = scenarioRegistry();
		expect(selectNextScenarioStep(scenarioInspection(), registry, scenarioEvidence(attack))).toBeNull();
	});

	it('fails closed for accessor, symbol, proxy, substituted, reordered, ambiguous, and prerequisite attacks', () => {
		const registry = scenarioRegistry();
		const accessor = scenarioEvidence();
		Object.defineProperty(accessor, 'runId', { enumerable: true, get: () => scenarioCoordinates.runId });
		const symbol = { ...scenarioEvidence(), [Symbol('hidden')]: true };
		const proxy = new Proxy(scenarioEvidence(), {});
		const substituted = Object.freeze([Object.freeze({ ...registry[0], id: 'substituted-step' }), registry[1]]);
		const reordered = Object.freeze([...registry].reverse());
		const ambiguous = scenarioInspection({ ambiguous: true });
		const badPrerequisite = Object.freeze([
			registry[0],
			Object.freeze({ ...registry[1], prerequisiteIds: Object.freeze([]) })
		]);

		for (const [candidateRegistry, candidateInspection, candidateEvidence] of [
			[registry, scenarioInspection(), accessor],
			[registry, scenarioInspection(), symbol],
			[registry, scenarioInspection(), proxy],
			[substituted, scenarioInspection(), scenarioEvidence()],
			[reordered, scenarioInspection(), scenarioEvidence()],
			[registry, ambiguous, scenarioEvidence()],
			[badPrerequisite, scenarioInspection(), scenarioEvidence()]
		] as const) {
			expect(selectNextScenarioStep(candidateInspection, candidateRegistry, candidateEvidence)).toBeNull();
		}
	});

	it('rejects hostile frozen registry arrays, entries, and prerequisite arrays without invoking accessors', () => {
		const getter = vi.fn(() => scenarioRegistry()[0]);
		const arrayAccessor: unknown[] = [];
		Object.defineProperty(arrayAccessor, '0', { enumerable: true, configurable: false, get: getter });
		Object.defineProperty(arrayAccessor, 'length', { value: 1, writable: false, configurable: false });
		Object.freeze(arrayAccessor);

		const entryGetter = vi.fn(() => 'first-step');
		const entry = { ...scenarioRegistry()[0] } as Record<string, unknown>;
		Object.defineProperty(entry, 'id', { enumerable: true, configurable: false, get: entryGetter });
		Object.freeze(entry);
		const entryAccessor = Object.freeze([entry]);

		const prerequisiteGetter = vi.fn(() => 'first-step');
		const prerequisite: unknown[] = [];
		Object.defineProperty(prerequisite, '0', { enumerable: true, configurable: false, get: prerequisiteGetter });
		Object.defineProperty(prerequisite, 'length', { value: 1, writable: false, configurable: false });
		Object.freeze(prerequisite);
		const base = scenarioRegistry();
		const prerequisiteAccessor = Object.freeze([
			base[0],
			Object.freeze({ ...base[1], prerequisiteIds: prerequisite })
		]);

		const hole = Object.freeze([base[0], , base[1]]);
		const symbol = Object.freeze(Object.assign([...base], { [Symbol('hidden')]: true }));
		const proxyTrap = vi.fn();
		const proxied = new Proxy(base, { get: proxyTrap, ownKeys: proxyTrap, getOwnPropertyDescriptor: proxyTrap });

		for (const candidate of [arrayAccessor, entryAccessor, prerequisiteAccessor, hole, symbol, proxied]) {
			expect(selectNextScenarioStep(scenarioInspection(), candidate, scenarioEvidence())).toBeNull();
		}
		expect(getter).not.toHaveBeenCalled();
		expect(entryGetter).not.toHaveBeenCalled();
		expect(prerequisiteGetter).not.toHaveBeenCalled();
		expect(proxyTrap).not.toHaveBeenCalled();
	});

	it('rejects hostile scenario inspections without invoking accessors, symbols, or proxy traps', () => {
		const registry = scenarioRegistry();
		const getter = vi.fn(() => false);
		const accessorInspection = scenarioInspection();
		Object.defineProperty(accessorInspection, 'ambiguous', { enumerable: true, get: getter });
		const symbolInspection = { ...scenarioInspection(), [Symbol('hidden')]: true };
		const proxyTrap = vi.fn();
		const proxiedInspection = new Proxy(scenarioInspection(), {
			get: proxyTrap,
			getOwnPropertyDescriptor: proxyTrap,
			ownKeys: proxyTrap,
			getPrototypeOf: proxyTrap
		});

		expect(selectNextScenarioStep(accessorInspection, registry, scenarioEvidence())).toBeNull();
		expect(selectNextScenarioStep(symbolInspection, registry, scenarioEvidence())).toBeNull();
		expect(selectNextScenarioStep(proxiedInspection, registry, scenarioEvidence())).toBeNull();
		expect(getter).not.toHaveBeenCalled();
		expect(proxyTrap).not.toHaveBeenCalled();
	});

	it('rejects hostile completed checkpoint arrays without invoking nested accessors or proxy traps', () => {
		const registry = scenarioRegistry();
		const getter = vi.fn(() => 'first-step');
		const accessorIds: string[] = [];
		Object.defineProperty(accessorIds, '0', { enumerable: true, get: getter });
		Object.defineProperty(accessorIds, 'length', { value: 1 });
		const holeIds = new Array(1);
		const symbolIds = Object.assign(['first-step'], { [Symbol('hidden')]: true });
		const proxyTrap = vi.fn();
		const proxyIds = new Proxy(['first-step'], {
			get: proxyTrap,
			getOwnPropertyDescriptor: proxyTrap,
			ownKeys: proxyTrap,
			getPrototypeOf: proxyTrap
		});

		for (const completedCheckpointIds of [accessorIds, holeIds, symbolIds, proxyIds]) {
			expect(selectNextScenarioStep(
				scenarioInspection(),
				registry,
				scenarioEvidence({ completedCheckpointIds })
			)).toBeNull();
		}
		expect(getter).not.toHaveBeenCalled();
		expect(proxyTrap).not.toHaveBeenCalled();
	});
});
