import { describe, expect, it } from 'vitest';
import {
	GATE3_EXIT_CODES,
	classifyGate3Lifecycle,
	selectGate3NextBoundary
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
		const preflight = classifyGate3Lifecycle(inspection({ actors: 0 }));
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
		const lifecycle = classifyGate3Lifecycle(
			inspection({
				cleanupPartial: true,
				residualArtifacts: [{ kind: 'auth-user', id: 'user-123' }]
			})
		);
		expect(selectGate3NextBoundary(lifecycle, 'cleanup')).toEqual({
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
});
