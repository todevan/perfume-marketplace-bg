import { describe, expect, it, vi } from 'vitest';
import {
	Gate3HostedProvisionError,
	runProvisionBoundary,
	runProvisionCommand
} from '../../scripts/gate3-hosted-provision-runner.mjs';
import {
	HOSTED_STAGING,
	createHostedRunManifest,
	registerHostedActor as hostedRegisterActor
} from '../../scripts/hosted-report-evidence-operator.mjs';
import {
	createInitialRunState
} from '../../scripts/gate3-hosted-state.mjs';

const roles = [
	'reporter',
	'cross-user',
	'assigned-moderator',
	'unassigned-moderator'
] as const;
const moderatorRoles = new Set(['assigned-moderator', 'unassigned-moderator']);
const requiredConsents = [
	{ documentCode: 'beta_terms', documentVersion: '2026-07-22' },
	{ documentCode: 'marketplace_rules', documentVersion: '2026-07-22' }
] as const;
const actorIds = {
	reporter: '11111111-1111-4111-8111-111111111111',
	'cross-user': '22222222-2222-4222-8222-222222222222',
	'assigned-moderator': '33333333-3333-4333-8333-333333333333',
	'unassigned-moderator': '44444444-4444-4444-8444-444444444444'
} as const;
const createdAt = '2026-08-21T10:00:00.000Z';
const fixtureTotpSecret = ['JBSWY3DP', 'EHPK3PXP'].join('');

type BoundaryStep =
	| 'auth-created'
	| 'registration-claimed'
	| 'consent-beta_terms-2026-07-22'
	| 'onboarding-complete'
	| 'role-elevated'
	| 'mfa-enrolled'
	| 'mfa-unenrolled-recovery'
	| 'mfa-verified'
	| 'actor-verified';

function boundaryInput({
	role = 'assigned-moderator',
	step = 'auth-created',
	outcome = 'confirmed-absent',
	mutate = vi.fn(async () => ({
		actor: { role, userId: actorIds[role], createdAt, emailConfirmed: true }
	})),
	readBack = vi.fn(async () => ({ status: 'confirmed' })),
	persistManifest = step === 'auth-created' ? vi.fn(async () => undefined) : null,
	persistCredential = step === 'mfa-enrolled' ? vi.fn(async () => undefined) : null,
	persistState = vi.fn(async () => undefined)
}: {
	role?: (typeof roles)[number];
	step?: BoundaryStep;
	outcome?: 'confirmed' | 'confirmed-absent' | 'uncertain';
	mutate?: ReturnType<typeof vi.fn> | null;
	readBack?: ReturnType<typeof vi.fn>;
	persistManifest?: ReturnType<typeof vi.fn> | null;
	persistCredential?: ReturnType<typeof vi.fn> | null;
	persistState?: ReturnType<typeof vi.fn>;
} = {}) {
	const operationId = `${role}.${step}`;
	return {
		inspection: Object.freeze({
			classification: 'PROVISION_PARTIAL',
			revision: 7,
			role,
			step,
			outcome
		}),
		authorization: Object.freeze({
			command: 'provision',
			phase: 'provision',
			role,
			step,
			operationId,
			revision: 7
		}),
		capabilities: Object.freeze({
			mutate: step === 'actor-verified' ? null : mutate,
			readBack,
			persistCredential,
			persistManifest,
			persistState
		}),
		spies: { mutate, readBack, persistCredential, persistManifest, persistState }
	};
}

function completedActor(role: (typeof roles)[number]) {
	return {
		auth: 'confirmed',
		manifest: 'confirmed',
		userId: actorIds[role],
		createdAt,
		registrationClaimed: true,
		acceptedConsents: requiredConsents.map(
			({ documentCode, documentVersion }) => `${documentCode}-${documentVersion}`
		),
		onboardingComplete: true,
		profileRole: moderatorRoles.has(role) ? 'moderator' : 'user',
		mfa: moderatorRoles.has(role)
			? { status: 'verified', secretStatus: 'available' }
			: { status: 'not-required', secretStatus: 'not-required' },
		actorVerified: true
	};
}

function emptyActor(role: (typeof roles)[number]) {
	return {
		auth: 'absent',
		manifest: 'absent',
		registrationClaimed: false,
		acceptedConsents: [],
		onboardingComplete: false,
		profileRole: 'absent',
		mfa: moderatorRoles.has(role)
			? { status: 'absent', secretStatus: 'missing' }
			: { status: 'not-required', secretStatus: 'not-required' },
		actorVerified: false
	};
}

function commandFixture() {
	const runId = 'gate3-20260821-abcdef12';
	const paths = {
		root: 'C:\\gate3-test-root',
		runId,
		activeRoot: 'C:\\gate3-test-root\\active',
		runDirectory: `C:\\gate3-test-root\\active\\${runId}`,
		statePath: `C:\\gate3-test-root\\active\\${runId}\\gate3-run-state.json`,
		manifestPath: `C:\\gate3-test-root\\active\\${runId}\\run-manifest.json`,
		secretPath: `C:\\gate3-test-root\\active\\${runId}\\gate3-secrets.dpapi`,
		lockPath: `C:\\gate3-test-root\\active\\${runId}\\gate3-run.lock`,
		archiveRoot: 'C:\\gate3-test-root\\archive',
		archiveDirectory: `C:\\gate3-test-root\\archive\\${runId}`,
		activePointerPath: 'C:\\gate3-test-root\\active-run.json'
	};
	let state = createInitialRunState({
		runId,
		createdAt,
		releaseCommitSha: 'a'.repeat(40),
		manifestPath: paths.manifestPath,
		secretPath: paths.secretPath
	}) as Record<string, any>;
	state = {
		...state,
		revision: 1,
		manifest: { ...state.manifest, sha256: 'b'.repeat(64) },
		secretStore: { ...state.secretStore, status: 'available', ciphertextSha256: 'c'.repeat(64) },
		phases: {
			...state.phases,
			preflight: { status: 'complete', checkpoint: { step: 'preflight-verified' } }
		}
	};
	const config = {
		target: HOSTED_STAGING,
		runId,
		provisioningNonce: '55555555-5555-4555-8555-555555555555',
		provisionedAfter: createdAt,
		actorRoles: {},
		serviceKey: ''
	};
	let manifest = createHostedRunManifest(config, {
		provisioningAttemptId: config.provisioningNonce,
		credentialStoreId: 'd'.repeat(64)
	}) as Record<string, any>;
	let snapshot: Record<string, any> = {
		requiredConsents: [...requiredConsents].reverse(),
		exactRecoveryProvenance: true,
		actors: Object.fromEntries(roles.map((role) => [role, emptyActor(role)]))
	};
	let classificationOverride: string | null = null;
	const events: string[] = [];
	const mutations: string[] = [];
	let protectedPayload: Record<string, any> | null = null;
	const secretPayload: Record<string, any> = {
		schemaVersion: 1,
		runId,
		identitySchemeVersion: 1,
		actors: Object.fromEntries(
			roles.map((role) => [
				role,
				{
					role,
					email: `${role}@gate3.invalid`,
					username: `g3_${role.replaceAll('-', '_')}`,
					password: `G3!${'x'.repeat(43)}`,
					...(moderatorRoles.has(role) ? { totpSecret: null } : {})
				}
			])
		)
	};
	const acquireRunLock = vi.fn(async () => {
		events.push('lock:acquire');
		return { acquiredBytes: 'exact-lock' };
	});
	const releaseRunLock = vi.fn(async () => {
		events.push('lock:release');
		return true;
	});
	const inspectRun = vi.fn(async () => {
		events.push('inspect');
		const allVerified = roles.every((role) => snapshot.actors[role].actorVerified === true);
		const anyCreated = roles.some((role) => snapshot.actors[role].auth === 'confirmed');
		return Object.freeze({
			classification:
				classificationOverride ??
				(allVerified ? 'PROVISION_VERIFIED' : anyCreated ? 'PROVISION_PARTIAL' : 'PREFLIGHT_READY'),
			stateRevision: state.revision,
			revision: state.revision,
			releaseChanged: classificationOverride === 'RELEASE_CHANGED',
			ambiguous: classificationOverride === 'AMBIGUOUS',
			exactRecoveryProvenance: snapshot.exactRecoveryProvenance
		});
	});
	const inspectProvision = vi.fn(async () => structuredClone(snapshot));
	const mutationFor = vi.fn(({ authorization }: { authorization: { role: (typeof roles)[number]; step: string } }) => {
		const { role, step } = authorization;
		const mutate = step === 'actor-verified'
			? null
			: vi.fn(async () => {
				mutations.push(`${role}.${step}`);
				events.push(`mutate:${role}.${step}`);
				const actor = snapshot.actors[role];
				if (step === 'auth-created') {
					actor.auth = 'confirmed';
					actor.manifest = 'confirmed';
					return { actor: { role, userId: actorIds[role], createdAt, emailConfirmed: true } };
				}
				if (step === 'registration-claimed') actor.registrationClaimed = true;
				else if (step.startsWith('consent-')) actor.acceptedConsents.push(step.slice('consent-'.length));
				else if (step === 'onboarding-complete') {
					actor.onboardingComplete = true;
					actor.profileRole = 'user';
				}
				else if (step === 'role-elevated') actor.profileRole = 'moderator';
				else if (step === 'mfa-enrolled') {
					actor.mfa = { status: 'unverified', secretStatus: 'available' };
					return { factorId: `factor-${role}`, secret: fixtureTotpSecret };
				}
				else if (step === 'mfa-unenrolled-recovery') actor.mfa = { status: 'absent', secretStatus: 'missing' };
				else if (step === 'mfa-verified') actor.mfa.status = 'verified';
				return {};
			});
		return Object.freeze({
			mutate,
			readBack: vi.fn(async () => {
				events.push(`verify:${role}.${step}`);
				if (step === 'actor-verified') snapshot.actors[role].actorVerified = true;
				return { status: 'confirmed' };
			})
		});
	});
	const dependencies = {
		acquireRunLock,
		releaseRunLock,
		inspectRun,
		selectNextProvisionStep: vi.fn(() => Object.freeze({ command: 'provision', phase: 'provision' })),
		readRunState: vi.fn(async () => state),
		readStableSnapshot: vi.fn(async () => ({
			state,
			secretBytes: Buffer.alloc(0)
		})),
		writeNextRunState: vi.fn(async (_paths: unknown, _current: unknown, next: Record<string, any>) => {
			events.push('state');
			state = next;
		}),
		loadManifest: vi.fn(async () => manifest),
		persistManifest: vi.fn(async (_config: unknown, next: Record<string, any>) => {
			events.push('manifest');
			manifest = next;
		}),
		unprotectRunSecrets: vi.fn(async () => protectedPayload ?? secretPayload),
		unprotectRunSecretBytes: vi.fn(async () => protectedPayload ?? secretPayload),
		protectRunSecrets: vi.fn(async ({ payload }: { payload: Record<string, any> }) => {
			events.push('dpapi');
			protectedPayload = payload;
			return { status: 'available', ciphertextSha256: 'e'.repeat(64) };
		}),
		recordProviderTotpSecret: vi.fn(({ payload, role, secret }: Record<string, any>) => ({
			...payload,
			actors: { ...payload.actors, [role]: { ...payload.actors[role], totpSecret: secret } }
		})),
		hashManifest: vi.fn(() => 'f'.repeat(64)),
		now: vi.fn(() => createdAt)
	};
	const provisionCapabilities = Object.freeze({ inspectProvision, mutationFor });
	return {
		paths,
		state: () => state,
		manifest: () => manifest,
		snapshot: () => snapshot,
		setSnapshot(value: Record<string, any>) {
			snapshot = value;
			manifest = createHostedRunManifest(config, {
				provisioningAttemptId: config.provisioningNonce,
				credentialStoreId: 'd'.repeat(64)
			}) as Record<string, any>;
			for (const role of roles) {
				if (snapshot.actors[role].manifest === 'confirmed') {
					const actor = snapshot.actors[role];
					manifest = hostedRegisterActor(
						manifest as any,
						role,
						actor.userId,
						actor.createdAt
					);
				}
			}
		},
		setClassification(value: string | null) {
			classificationOverride = value;
		},
		dependencies,
		provisionCapabilities,
		inspectionAdapter: Object.freeze({ inspectRun: vi.fn() }),
		dpapi: Object.freeze({ protect: vi.fn(), unprotect: vi.fn() }),
		events,
		mutations
	};
}

describe('Gate 3 provision boundary', () => {
	it('creates only the lifecycle-authorized deterministic role after fresh absence proof', async () => {
		const input = boundaryInput({ role: 'reporter' });
		const result = await runProvisionBoundary(input);

		expect(result).toEqual({
			role: 'reporter',
			step: 'auth-created',
			status: 'confirmed',
			classification: 'PROVISION_PARTIAL',
			revision: 8,
			reasonCode: 'provision_boundary_confirmed'
		});
		expect(input.spies.mutate).toHaveBeenCalledOnce();
		expect(input.spies.readBack).toHaveBeenCalledOnce();
		expect(input.spies.persistManifest).toHaveBeenCalledOnce();
		expect(input.spies.persistState).toHaveBeenCalledOnce();
	});

	it('reconciles transport failure through targeted read-back instead of replaying', async () => {
		const mutate = vi.fn(async () => {
			throw new Error('provider body actor@example.invalid bearer-secret');
		});
		const input = boundaryInput({ mutate });
		await expect(runProvisionBoundary(input)).resolves.toMatchObject({ status: 'confirmed' });
		expect(input.spies.persistManifest).toHaveBeenCalledOnce();
		expect(input.spies.persistState).toHaveBeenCalledOnce();
	});

	it.each([
		['confirmed-absent', 40, 'provider_failure_confirmed_absent'],
		['uncertain', 41, 'mutation_outcome_uncertain']
	] as const)('maps %s read-back to a safe non-retry result', async (status, exitCode, reasonCode) => {
		const input = boundaryInput({
			mutate: vi.fn(async () => {
				throw new Error('sensitive provider transport');
			}),
			readBack: vi.fn(async () => ({ status }))
		});
		await expect(runProvisionBoundary(input)).resolves.toEqual(
			expect.objectContaining({ status, reasonCode })
		);
		expect(input.spies.persistManifest).not.toHaveBeenCalled();
		expect(input.spies.persistState).not.toHaveBeenCalled();
		expect(exitCode).toBe(status === 'confirmed-absent' ? 40 : 41);
	});

	it('persists a provider TOTP credential before read-back and never returns it', async () => {
		const events: string[] = [];
		const input = boundaryInput({
			step: 'mfa-enrolled',
			mutate: vi.fn(async () => {
				events.push('mutate');
				return { factorId: 'factor-exact', secret: fixtureTotpSecret };
			}),
			persistCredential: vi.fn(async () => events.push('dpapi')),
			readBack: vi.fn(async () => {
				events.push('verify');
				return { status: 'confirmed' };
			}),
			persistState: vi.fn(async () => events.push('state'))
		});
		const result = await runProvisionBoundary(input);
		expect(events).toEqual(['mutate', 'dpapi', 'verify', 'state']);
		expect(JSON.stringify(result)).not.toMatch(/factor|secret|JBSW|cipher/i);
	});

	it('does not advance state when DPAPI persistence fails after enrollment', async () => {
		const input = boundaryInput({
			step: 'mfa-enrolled',
			mutate: vi.fn(async () => ({ factorId: 'factor-exact', secret: fixtureTotpSecret })),
			persistCredential: vi.fn(async () => {
				throw new Error('ciphertext C:\\private\\secret');
			})
		});
		await expect(runProvisionBoundary(input)).resolves.toMatchObject({
			status: 'uncertain',
			reasonCode: 'credential_persistence_failed'
		});
		expect(input.spies.readBack).toHaveBeenCalledOnce();
		expect(input.spies.persistState).not.toHaveBeenCalled();
	});

	it.each([
		'auth-created',
		'registration-claimed',
		'consent-beta_terms-2026-07-22',
		'onboarding-complete',
		'role-elevated',
		'mfa-enrolled',
		'mfa-unenrolled-recovery',
		'mfa-verified',
		'actor-verified'
	] as BoundaryStep[])('resumes %s after every persistence crash window without replay', async (step) => {
		const role = step === 'role-elevated' || step.startsWith('mfa-') ? 'assigned-moderator' : 'reporter';
		let hostedMutations = 0;
		let manifestPersisted = false;
		let statePersisted = false;
		const mutate = step === 'actor-verified'
			? null
			: vi.fn(async () => {
				hostedMutations += 1;
				return step === 'mfa-enrolled'
					? { factorId: 'factor-exact', secret: fixtureTotpSecret }
					: { actor: { role, userId: actorIds[role], createdAt, emailConfirmed: true } };
			});
		const first = boundaryInput({
			role,
			step,
			mutate,
			persistManifest:
				step === 'auth-created'
					? vi.fn(async () => {
						manifestPersisted = true;
					})
					: null,
			persistCredential: step === 'mfa-enrolled' ? vi.fn(async () => undefined) : null,
			persistState: vi.fn(async () => {
				throw new Error('simulated crash before state persistence');
			})
		});
		await expect(runProvisionBoundary(first)).rejects.toMatchObject({ exitCode: 41 });
		expect(statePersisted).toBe(false);

		const resumed = boundaryInput({
			role,
			step,
			outcome: 'confirmed',
			mutate: vi.fn(async () => {
				hostedMutations += 1;
			}),
			persistManifest:
				step === 'auth-created'
					? vi.fn(async () => {
						manifestPersisted = true;
					})
					: null,
			persistCredential: step === 'mfa-enrolled' ? vi.fn(async () => undefined) : null,
			persistState: vi.fn(async () => {
				statePersisted = true;
			})
		});
		await expect(runProvisionBoundary(resumed)).resolves.toMatchObject({ status: 'confirmed' });
		expect(hostedMutations).toBe(step === 'actor-verified' ? 0 : 1);
		expect(manifestPersisted).toBe(step === 'auth-created');
		expect(statePersisted).toBe(true);
	});

	it.each(
		([
			'auth-created',
			'registration-claimed',
			'consent-beta_terms-2026-07-22',
			'onboarding-complete',
			'role-elevated',
			'mfa-enrolled',
			'mfa-unenrolled-recovery',
			'mfa-verified',
			'actor-verified'
		] as BoundaryStep[]).flatMap((step) =>
			[
				'before-mutation',
				'after-mutation-before-read-back',
				'after-read-back-before-manifest',
				'after-manifest-before-state',
				'before-state-persistence'
			].map((window) => [step, window] as const)
		)
	)('reconciles %s from the %s crash window', async (step, window) => {
		const role = step === 'role-elevated' || step.startsWith('mfa-') ? 'assigned-moderator' : 'reporter';
		let hostedMutations = window === 'before-mutation' ? 0 : step === 'actor-verified' ? 0 : 1;
		const mutate = vi.fn(async () => {
			hostedMutations += 1;
			return step === 'mfa-enrolled'
				? { factorId: 'factor-exact', secret: fixtureTotpSecret }
				: { actor: { role, userId: actorIds[role], createdAt, emailConfirmed: true } };
		});
		const input = boundaryInput({
			role,
			step,
			outcome: window === 'before-mutation' ? 'confirmed-absent' : 'confirmed',
			mutate,
			persistCredential: step === 'mfa-enrolled' ? vi.fn(async () => undefined) : null
		});

		await expect(runProvisionBoundary(input)).resolves.toMatchObject({ status: 'confirmed' });
		expect(hostedMutations).toBe(step === 'actor-verified' ? 0 : 1);
		if (step === 'auth-created') expect(input.spies.persistManifest).toHaveBeenCalledOnce();
		else expect(input.spies.persistManifest).toBeNull();
		expect(input.spies.persistState).toHaveBeenCalledOnce();
	});

	it('fails closed on malformed or over-broad injected capabilities before invoking them', async () => {
		const mutation = vi.fn();
		for (const capabilities of [
			{ ...boundaryInput().capabilities, mutate: mutation },
			Object.freeze({ ...boundaryInput().capabilities, mutate: mutation, deleteAllUsers: vi.fn() }),
			new Proxy(Object.freeze({ ...boundaryInput().capabilities, mutate: mutation }), {})
		]) {
			const input = boundaryInput();
			await expect(
				runProvisionBoundary({ ...input, capabilities } as Parameters<typeof runProvisionBoundary>[0])
			).rejects.toMatchObject({ exitCode: 10, reasonCode: 'provision_capability_invalid' });
		}
		expect(mutation).not.toHaveBeenCalled();
	});
});

describe('Gate 3 provision command', () => {
	it('advances zero actors through the deterministic exact role and checkpoint order under one lock', async () => {
		const fixture = commandFixture();
		const result = await runProvisionCommand({
			paths: fixture.paths,
			inspectionAdapter: fixture.inspectionAdapter,
			provisionCapabilities: fixture.provisionCapabilities,
			dpapi: fixture.dpapi,
			dependencies: fixture.dependencies
		});

		expect(result).toEqual(
			expect.objectContaining({ status: 'confirmed', classification: 'PROVISION_VERIFIED' })
		);
		expect(fixture.dependencies.acquireRunLock).toHaveBeenCalledOnce();
		expect(fixture.dependencies.releaseRunLock).toHaveBeenCalledOnce();
		expect(fixture.mutations.map((entry) => entry.split('.')[0]).filter((role, index, all) => index === 0 || role !== all[index - 1])).toEqual(roles);
		expect(fixture.mutations).toContain('assigned-moderator.mfa-enrolled');
		expect(fixture.events.indexOf('dpapi')).toBeLessThan(
			fixture.events.indexOf('verify:assigned-moderator.mfa-enrolled')
		);
	});

	it('treats four verified exact actors as a mutation-free success without rotating credentials', async () => {
		const fixture = commandFixture();
		fixture.setSnapshot({
			requiredConsents,
			exactRecoveryProvenance: true,
			actors: Object.fromEntries(roles.map((role) => [role, completedActor(role)]))
		});

		const result = await runProvisionCommand({
			paths: fixture.paths,
			inspectionAdapter: fixture.inspectionAdapter,
			provisionCapabilities: fixture.provisionCapabilities,
			dpapi: fixture.dpapi,
			dependencies: fixture.dependencies
		});
		expect(result).toEqual(
			expect.objectContaining({ status: 'confirmed', classification: 'PROVISION_VERIFIED' })
		);
		expect(fixture.mutations).toEqual([]);
		expect(fixture.dependencies.protectRunSecrets).not.toHaveBeenCalled();
	});

	it('reconciles a partial exact run from the stable checkpoint without a second actor', async () => {
		const fixture = commandFixture();
		const reporter = completedActor('reporter');
		reporter.actorVerified = false;
		fixture.setSnapshot({
			requiredConsents,
			exactRecoveryProvenance: true,
			actors: {
				reporter,
				'cross-user': emptyActor('cross-user'),
				'assigned-moderator': emptyActor('assigned-moderator'),
				'unassigned-moderator': emptyActor('unassigned-moderator')
			}
		});

		await runProvisionCommand({
			paths: fixture.paths,
			inspectionAdapter: fixture.inspectionAdapter,
			provisionCapabilities: fixture.provisionCapabilities,
			dpapi: fixture.dpapi,
			dependencies: fixture.dependencies
		});
		expect(fixture.mutations.filter((entry) => entry === 'reporter.auth-created')).toHaveLength(0);
		expect(fixture.mutations[0]?.startsWith('cross-user.')).toBe(true);
	});

	it.each(['RELEASE_CHANGED', 'AMBIGUOUS', 'RECOVERY_REQUIRED'])(
		'performs zero mutation under %s',
		async (classification) => {
			const fixture = commandFixture();
			fixture.setClassification(classification);
			const result = await runProvisionCommand({
				paths: fixture.paths,
				inspectionAdapter: fixture.inspectionAdapter,
				provisionCapabilities: fixture.provisionCapabilities,
				dpapi: fixture.dpapi,
				dependencies: fixture.dependencies
			});
			expect(result).toEqual(expect.objectContaining({ status: 'uncertain', classification }));
			expect(fixture.mutations).toEqual([]);
			expect(fixture.provisionCapabilities.mutationFor).not.toHaveBeenCalled();
		}
	);

	it.each(['foreign-actor', 'duplicate-mfa'] as const)(
		'fails closed without mutation for %s evidence',
		async (caseName) => {
			const fixture = commandFixture();
			const actors = Object.fromEntries(roles.map((role) => [role, completedActor(role)]));
			if (caseName === 'foreign-actor') {
				actors.reporter = { ...actors.reporter, auth: 'conflict', actorVerified: false };
			} else {
				actors['assigned-moderator'] = {
					...actors['assigned-moderator'],
					mfa: { status: 'duplicate', secretStatus: 'available' },
					actorVerified: false
				};
			}
			fixture.setSnapshot({ requiredConsents, exactRecoveryProvenance: true, actors });

			const command = runProvisionCommand({
				paths: fixture.paths,
				inspectionAdapter: fixture.inspectionAdapter,
				provisionCapabilities: fixture.provisionCapabilities,
				dpapi: fixture.dpapi,
				dependencies: fixture.dependencies
			});

			if (caseName === 'foreign-actor') {
				await expect(command).rejects.toMatchObject({ reasonCode: 'provision_evidence_invalid' });
			} else {
				await expect(command).resolves.toMatchObject({ status: 'uncertain', classification: 'AMBIGUOUS' });
			}
			expect(fixture.mutations).toEqual([]);
		}
	);

	it('stops when the release changes between boundaries and does not expose a second capability', async () => {
		const fixture = commandFixture();
		fixture.dependencies.inspectRun
			.mockImplementationOnce(async () => ({
				classification: 'PREFLIGHT_READY',
				stateRevision: 1,
				revision: 1,
				releaseChanged: false,
				ambiguous: false,
				exactRecoveryProvenance: true
			}))
			.mockImplementationOnce(async () => ({
				classification: 'RELEASE_CHANGED',
				stateRevision: 2,
				revision: 2,
				releaseChanged: true,
				ambiguous: false,
				exactRecoveryProvenance: true
			}));
		const result = await runProvisionCommand({
			paths: fixture.paths,
			inspectionAdapter: fixture.inspectionAdapter,
			provisionCapabilities: fixture.provisionCapabilities,
			dpapi: fixture.dpapi,
			dependencies: fixture.dependencies
		});
		expect(result).toMatchObject({ status: 'uncertain', classification: 'RELEASE_CHANGED' });
		expect(fixture.mutations).toHaveLength(1);
		expect(fixture.provisionCapabilities.mutationFor).toHaveBeenCalledTimes(1);
	});

	it('uses a distinct verified unenrollment boundary before re-enrolling a lost unverified factor', async () => {
		const fixture = commandFixture();
		const actors = Object.fromEntries(roles.map((role) => [role, completedActor(role)]));
		actors['assigned-moderator'] = {
			...completedActor('assigned-moderator'),
			mfa: { status: 'unverified', secretStatus: 'missing' },
			actorVerified: false
		};
		fixture.setSnapshot({ requiredConsents, exactRecoveryProvenance: true, actors });

		await runProvisionCommand({
			paths: fixture.paths,
			inspectionAdapter: fixture.inspectionAdapter,
			provisionCapabilities: fixture.provisionCapabilities,
			dpapi: fixture.dpapi,
			dependencies: fixture.dependencies
		});
		const moderatorMutations = fixture.mutations.filter((entry) => entry.startsWith('assigned-moderator.'));
		expect(moderatorMutations).toEqual([
			'assigned-moderator.mfa-unenrolled-recovery',
			'assigned-moderator.mfa-enrolled',
			'assigned-moderator.mfa-verified'
		]);
	});

	it('resumes verification of an exact unverified factor when its stored secret is available', async () => {
		const fixture = commandFixture();
		const actors = Object.fromEntries(roles.map((role) => [role, completedActor(role)]));
		actors['assigned-moderator'] = {
			...completedActor('assigned-moderator'),
			mfa: { status: 'unverified', secretStatus: 'available' },
			actorVerified: false
		};
		fixture.setSnapshot({ requiredConsents, exactRecoveryProvenance: true, actors });

		await runProvisionCommand({
			paths: fixture.paths,
			inspectionAdapter: fixture.inspectionAdapter,
			provisionCapabilities: fixture.provisionCapabilities,
			dpapi: fixture.dpapi,
			dependencies: fixture.dependencies
		});
		expect(fixture.mutations.filter((entry) => entry.startsWith('assigned-moderator.'))).toEqual([
			'assigned-moderator.mfa-verified'
		]);
	});

	it('reconciles a DPAPI-ahead/state-behind enrollment crash before resuming verification', async () => {
		const fixture = commandFixture();
		const actors = Object.fromEntries(roles.map((role) => [role, completedActor(role)]));
		actors['assigned-moderator'] = {
			...completedActor('assigned-moderator'),
			mfa: { status: 'unverified', secretStatus: 'available' },
			actorVerified: false
		};
		fixture.setSnapshot({ requiredConsents, exactRecoveryProvenance: true, actors });
		fixture.dependencies.inspectRun.mockImplementationOnce(async () => ({
			classification: 'RECOVERY_REQUIRED',
			stateRevision: fixture.state().revision,
			revision: fixture.state().revision,
			releaseChanged: false,
			ambiguous: false,
			credentialsLost: true,
			exactRecoveryProvenance: true,
			secretStoreStatus: 'corrupt'
		}));
		fixture.dependencies.readStableSnapshot = vi.fn(async () => ({
			state: fixture.state(),
			secretBytes: Buffer.from('new-exact-ciphertext')
		}));
		fixture.dependencies.unprotectRunSecretBytes = vi.fn(async () => ({
			schemaVersion: 1,
			runId: fixture.paths.runId,
			identitySchemeVersion: 1,
			actors: {
				...Object.fromEntries(roles.map((role) => [role, { role }])),
				'assigned-moderator': { role: 'assigned-moderator', totpSecret: fixtureTotpSecret }
			}
		}));

		await runProvisionCommand({
			paths: fixture.paths,
			inspectionAdapter: fixture.inspectionAdapter,
			provisionCapabilities: fixture.provisionCapabilities,
			dpapi: fixture.dpapi,
			dependencies: fixture.dependencies
		});
		const repairedState = fixture.dependencies.writeNextRunState.mock.calls[0][2] as Record<string, any>;
		expect(repairedState.secretStore).toEqual({
			...fixture.state().secretStore,
			status: 'available',
			ciphertextSha256: '02ed6e3705f840c3947334c8681acb32ac754ddcce3bae541b36cf31fbdce2a7'
		});
		expect(fixture.mutations.filter((entry) => entry.startsWith('assigned-moderator.'))).toEqual([
			'assigned-moderator.mfa-verified'
		]);
	});

	it('classifies verified-factor secret loss without blind unenrollment', async () => {
		for (const exactRecoveryProvenance of [true, false]) {
			const fixture = commandFixture();
			const actors = Object.fromEntries(roles.map((role) => [role, completedActor(role)]));
			actors['assigned-moderator'] = {
				...completedActor('assigned-moderator'),
				mfa: { status: 'verified', secretStatus: 'missing' }
			};
			fixture.setSnapshot({ requiredConsents, exactRecoveryProvenance, actors });
			fixture.setClassification(exactRecoveryProvenance ? 'RECOVERY_REQUIRED' : 'AMBIGUOUS');
			const result = await runProvisionCommand({
				paths: fixture.paths,
				inspectionAdapter: fixture.inspectionAdapter,
				provisionCapabilities: fixture.provisionCapabilities,
				dpapi: fixture.dpapi,
				dependencies: fixture.dependencies
			});
			expect(result.classification).toBe(exactRecoveryProvenance ? 'RECOVERY_REQUIRED' : 'AMBIGUOUS');
			expect(fixture.mutations).toEqual([]);
		}
	});

	it('maps confirmed absence and uncertain outcomes to deterministic safe errors', async () => {
		for (const [status, exitCode] of [
			['confirmed-absent', 40],
			['uncertain', 41]
		] as const) {
			const fixture = commandFixture();
			fixture.provisionCapabilities.mutationFor.mockImplementationOnce(() =>
				Object.freeze({
					mutate: vi.fn(async () => {
						throw new Error('provider secret');
					}),
					readBack: vi.fn(async () => ({ status }))
				})
			);
			await expect(
				runProvisionCommand({
					paths: fixture.paths,
					inspectionAdapter: fixture.inspectionAdapter,
					provisionCapabilities: fixture.provisionCapabilities,
					dpapi: fixture.dpapi,
					dependencies: fixture.dependencies
				})
			).rejects.toMatchObject({ exitCode });
		}
	});

	it('reports lock contention safely and never inspects or mutates', async () => {
		const fixture = commandFixture();
		fixture.dependencies.acquireRunLock.mockRejectedValueOnce(new Error('lock path and token'));
		await expect(
			runProvisionCommand({
				paths: fixture.paths,
				inspectionAdapter: fixture.inspectionAdapter,
				provisionCapabilities: fixture.provisionCapabilities,
				dpapi: fixture.dpapi,
				dependencies: fixture.dependencies
			})
		).rejects.toEqual(
			expect.objectContaining({
				exitCode: 10,
				reasonCode: 'active_run_locked'
			})
		);
		expect(fixture.dependencies.inspectRun).not.toHaveBeenCalled();
		expect(fixture.mutations).toEqual([]);
	});

	it('classifies a post-inspection manifest/state read failure as ambiguous, not credential recovery', async () => {
		const fixture = commandFixture();
		fixture.dependencies.loadManifest.mockRejectedValueOnce(new Error('local path detail'));
		const result = await runProvisionCommand({
			paths: fixture.paths,
			inspectionAdapter: fixture.inspectionAdapter,
			provisionCapabilities: fixture.provisionCapabilities,
			dpapi: fixture.dpapi,
			dependencies: fixture.dependencies
		});
		expect(result).toMatchObject({ status: 'uncertain', classification: 'AMBIGUOUS' });
		expect(fixture.mutations).toEqual([]);
	});

	it.each([
		[true, 'RECOVERY_REQUIRED'],
		[false, 'AMBIGUOUS']
	] as const)('classifies DPAPI loss by exact recovery provenance=%s', async (exactRecoveryProvenance, classification) => {
		const fixture = commandFixture();
		fixture.setSnapshot({
			requiredConsents,
			exactRecoveryProvenance,
			actors: Object.fromEntries(roles.map((role) => [role, emptyActor(role)]))
		});
		fixture.dependencies.unprotectRunSecrets.mockRejectedValueOnce(new Error('DPAPI private detail'));
		const result = await runProvisionCommand({
			paths: fixture.paths,
			inspectionAdapter: fixture.inspectionAdapter,
			provisionCapabilities: fixture.provisionCapabilities,
			dpapi: fixture.dpapi,
			dependencies: fixture.dependencies
		});
		expect(result).toMatchObject({ status: 'uncertain', classification });
		expect(fixture.mutations).toEqual([]);
	});

	it('keeps every public success and failure result allow-listed and secret-free', async () => {
		const fixture = commandFixture();
		fixture.setClassification('AMBIGUOUS');
		const result = await runProvisionCommand({
			paths: fixture.paths,
			inspectionAdapter: fixture.inspectionAdapter,
			provisionCapabilities: fixture.provisionCapabilities,
			dpapi: fixture.dpapi,
			dependencies: fixture.dependencies
		});
		expect(Object.keys(result).sort()).toEqual(
			['classification', 'reasonCode', 'revision', 'status'].sort()
		);
		expect(JSON.stringify(result)).not.toMatch(/@|password|totp|secret|factor|token|cipher|userId/i);
		expect(Gate3HostedProvisionError).toBeTypeOf('function');
	});
});
