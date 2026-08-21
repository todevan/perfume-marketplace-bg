import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
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
	const inspectRunLock = vi.fn(async () => ({ status: 'held', acquiredBytes: 'exact-lock' }));
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
	const dependencies: Record<string, any> = {
		acquireRunLock,
		releaseRunLock,
		inspectRunLock,
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
	const provisionCapabilities: any = Object.freeze({ inspectProvision, mutationFor });
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
		setState(value: Record<string, any>) {
			state = value;
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
	)('restarts %s from an actual %s interruption without replay', async (step, window) => {
		const fixture = commandFixture();
		const role = step === 'role-elevated' || step.startsWith('mfa-')
			? 'assigned-moderator'
			: 'reporter';
		const operationId = `${role}.${step}`;
		const hashManifest = (value: unknown) =>
			createHash('sha256').update(`${JSON.stringify(value)}\n`).digest('hex');
		fixture.dependencies.hashManifest.mockImplementation(hashManifest);
		fixture.setState({
			...fixture.state(),
			manifest: { ...fixture.state().manifest, sha256: hashManifest(fixture.manifest()) }
		});

		if (step === 'mfa-unenrolled-recovery') {
			const assigned = completedActor('assigned-moderator');
			assigned.mfa = { status: 'unverified', secretStatus: 'missing' };
			assigned.actorVerified = false;
			fixture.setSnapshot({
				requiredConsents,
				exactRecoveryProvenance: true,
				actors: {
					reporter: completedActor('reporter'),
					'cross-user': completedActor('cross-user'),
					'assigned-moderator': assigned,
					'unassigned-moderator': emptyActor('unassigned-moderator')
				}
			});
			fixture.setState({
				...fixture.state(),
				manifest: { ...fixture.state().manifest, sha256: hashManifest(fixture.manifest()) },
				phases: {
					...fixture.state().phases,
					provision: {
						status: 'in-progress',
						checkpoint: {
							observedAt: createdAt,
							status: 'confirmed',
							phase: 'provision',
							step: 'assigned-moderator.role-elevated',
							reasonCode: 'provision_boundary_confirmed',
							revision: fixture.state().revision,
							operationId: 'assigned-moderator.role-elevated'
						}
					}
				}
			});
		}

		let armed = true;
		let pendingBeforeMutationAbsence = false;
		const originalMutationFor = fixture.provisionCapabilities.mutationFor.getMockImplementation();
		if (!originalMutationFor) throw new Error('fixture mutation factory unavailable');
		fixture.provisionCapabilities.mutationFor.mockImplementation((scope: any) => {
			const original = originalMutationFor(scope);
			if (scope.authorization.operationId !== operationId) return original;
			const originalMutate = original.mutate;
			const originalReadBack = original.readBack;
			return Object.freeze({
				mutate:
					originalMutate === null
						? null
						: vi.fn(async () => {
							if (armed && window === 'before-mutation') {
								armed = false;
								pendingBeforeMutationAbsence = true;
								throw new Error('interrupted before mutation');
							}
							const result = await originalMutate();
							if (step === 'auth-created') {
								Object.assign(fixture.snapshot().actors[role], {
									manifest: 'absent',
									userId: actorIds[role],
									createdAt
								});
							}
							return result;
						}),
				readBack: vi.fn(async (...args: any[]) => {
					if (armed && step === 'actor-verified' && window === 'before-mutation') {
						armed = false;
						throw new Error('interrupted before read-back-only attestation');
					}
					if (!armed && window === 'before-mutation' && pendingBeforeMutationAbsence) {
						pendingBeforeMutationAbsence = false;
						return { status: 'confirmed-absent' };
					}
					if (armed && window === 'after-mutation-before-read-back') {
						armed = false;
						throw new Error('interrupted after mutation');
					}
					return originalReadBack(...args);
				})
			});
		});

		const originalPersistManifest = fixture.dependencies.persistManifest.getMockImplementation();
		if (!originalPersistManifest) throw new Error('fixture manifest writer unavailable');
		fixture.dependencies.persistManifest.mockImplementation(async (...args: any[]) => {
			const nextManifest = args[1] as Record<string, any>;
			const targetWrite = step === 'auth-created' && nextManifest.actors.at(-1)?.role === role;
			if (armed && targetWrite && window === 'after-read-back-before-manifest') {
				armed = false;
				throw new Error('interrupted before manifest persistence');
			}
			const result = await originalPersistManifest(...args);
			if (targetWrite) fixture.snapshot().actors[role].manifest = 'confirmed';
			return result;
		});
		const originalWriteState = fixture.dependencies.writeNextRunState.getMockImplementation();
		if (!originalWriteState) throw new Error('fixture state writer unavailable');
		fixture.dependencies.writeNextRunState.mockImplementation(async (...args: any[]) => {
			const nextState = args[2] as Record<string, any>;
			const targetWrite = nextState.phases?.provision?.checkpoint?.step === operationId;
			const stateWindow =
				window === 'before-state-persistence' ||
				window === 'after-manifest-before-state' ||
				(window === 'after-read-back-before-manifest' && step !== 'auth-created');
			if (armed && targetWrite && stateWindow) {
				armed = false;
				throw new Error(`interrupted at ${window}`);
			}
			return originalWriteState(...args);
		});

		const invoke = () =>
			runProvisionCommand({
				paths: fixture.paths,
				inspectionAdapter: fixture.inspectionAdapter,
				provisionCapabilities: fixture.provisionCapabilities,
				dpapi: fixture.dpapi,
				dependencies: fixture.dependencies
			});
		await expect(invoke()).rejects.toMatchObject({
			exitCode: window === 'before-mutation' && step !== 'actor-verified' ? 40 : 41
		});
		expect(fixture.state().phases.provision.checkpoint?.step).not.toBe(operationId);

		const manifestPersisted =
			step === 'auth-created' &&
			['after-manifest-before-state', 'before-state-persistence'].includes(window);
		if (manifestPersisted) {
			fixture.dependencies.inspectRun.mockResolvedValueOnce({
				classification: 'AMBIGUOUS',
				stateRevision: fixture.state().revision,
				revision: fixture.state().revision,
				manifestBindingStatus: 'manifest-ahead-state',
				manifestAheadState: true,
				manifestSha256: hashManifest(fixture.manifest()),
				foreignCounts: { syntheticAccounts: 0 }
			});
		}
		if (step === 'mfa-enrolled' && window !== 'before-mutation') {
			const ciphertext = Buffer.from('one-step-enrollment-ciphertext');
			fixture.dependencies.inspectRun.mockResolvedValueOnce({
				classification: 'RECOVERY_REQUIRED',
				stateRevision: fixture.state().revision,
				revision: fixture.state().revision,
				credentialsLost: true,
				exactRecoveryProvenance: true,
				secretStoreStatus: 'corrupt',
				manifestBindingStatus: 'exact',
				verifiedModeratorTotpFactors: 0,
				moderatorsWithVerifiedTotp: 0,
				foreignCounts: { syntheticAccounts: 0 }
			});
			fixture.dependencies.readStableSnapshot.mockResolvedValueOnce({
				state: fixture.state(),
				secretBytes: ciphertext
			});
			fixture.dependencies.unprotectRunSecretBytes.mockImplementationOnce(async () =>
				fixture.dependencies.unprotectRunSecrets()
			);
		}

		await expect(invoke()).resolves.toMatchObject({
			status: 'confirmed',
			classification: 'PROVISION_VERIFIED'
		});
		const targetMutations = fixture.mutations.filter((entry) => entry === operationId);
		expect(targetMutations).toHaveLength(step === 'actor-verified' ? 0 : 1);
		expect(fixture.state().phases.provision).toMatchObject({
			status: 'complete',
			checkpoint: { step: 'unassigned-moderator.actor-verified' }
		});
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
		fixture.setState({
			...fixture.state(),
			phases: {
				...fixture.state().phases,
				provision: {
					status: 'in-progress',
					checkpoint: {
						observedAt: createdAt,
						status: 'confirmed',
						phase: 'provision',
						step: 'assigned-moderator.role-elevated',
						reasonCode: 'provision_boundary_confirmed',
						revision: fixture.state().revision,
						operationId: 'assigned-moderator.role-elevated'
					}
				}
			}
		});

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
		fixture.setState({
			...fixture.state(),
			phases: {
				...fixture.state().phases,
				provision: {
					status: 'in-progress',
					checkpoint: {
						observedAt: createdAt,
						status: 'confirmed',
						phase: 'provision',
						step: 'assigned-moderator.role-elevated',
						reasonCode: 'provision_boundary_confirmed',
						revision: fixture.state().revision,
						operationId: 'assigned-moderator.role-elevated'
					}
				}
			}
		});
		fixture.dependencies.inspectRun.mockImplementationOnce(async () => ({
			classification: 'RECOVERY_REQUIRED',
			stateRevision: fixture.state().revision,
			revision: fixture.state().revision,
			releaseChanged: false,
			ambiguous: false,
			credentialsLost: true,
			exactRecoveryProvenance: true,
			secretStoreStatus: 'corrupt',
			manifestBindingStatus: 'exact',
			verifiedModeratorTotpFactors: 0,
			moderatorsWithVerifiedTotp: 0
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
				'assigned-moderator': { role: 'assigned-moderator', totpSecret: fixtureTotpSecret },
				'unassigned-moderator': { role: 'unassigned-moderator', totpSecret: null }
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

	it.each([
		['stale checkpoint', 'assigned-moderator.mfa-verified', fixtureTotpSecret, null, false],
		['wrong role', 'assigned-moderator.role-elevated', null, fixtureTotpSecret, false],
		['both seeds for assigned', 'assigned-moderator.role-elevated', fixtureTotpSecret, fixtureTotpSecret, false],
		['older assigned-only payload', 'unassigned-moderator.role-elevated', fixtureTotpSecret, null, false],
		['equal ciphertext hash', 'assigned-moderator.role-elevated', fixtureTotpSecret, null, true]
	] as const)(
		'rejects non-provable DPAPI repair residue: %s',
		async (_name, checkpointStep, assignedSecret, unassignedSecret, equalHash) => {
			const fixture = commandFixture();
			const ciphertext = Buffer.from('candidate-ciphertext');
			fixture.setState({
				...fixture.state(),
				secretStore: {
					...fixture.state().secretStore,
					ciphertextSha256: equalHash
						? createHash('sha256').update(ciphertext).digest('hex')
						: fixture.state().secretStore.ciphertextSha256
				},
				phases: {
					...fixture.state().phases,
					provision: {
						status: 'in-progress',
						checkpoint: {
							observedAt: createdAt,
							status: 'confirmed',
							phase: 'provision',
							step: checkpointStep,
							reasonCode: 'provision_boundary_confirmed',
							revision: fixture.state().revision,
							operationId: checkpointStep
						}
					}
				}
			});
			fixture.dependencies.inspectRun.mockResolvedValueOnce({
				classification: 'RECOVERY_REQUIRED',
				stateRevision: fixture.state().revision,
				revision: fixture.state().revision,
				credentialsLost: true,
				exactRecoveryProvenance: true,
				secretStoreStatus: 'corrupt',
				manifestBindingStatus: 'exact',
				verifiedModeratorTotpFactors: checkpointStep.startsWith('unassigned-') ? 1 : 0,
				moderatorsWithVerifiedTotp: checkpointStep.startsWith('unassigned-') ? 1 : 0
			});
			fixture.dependencies.readStableSnapshot.mockResolvedValueOnce({
				state: fixture.state(),
				secretBytes: ciphertext
			});
			fixture.dependencies.unprotectRunSecretBytes.mockResolvedValueOnce({
				runId: fixture.paths.runId,
				actors: {
					'assigned-moderator': { totpSecret: assignedSecret },
					'unassigned-moderator': { totpSecret: unassignedSecret }
				}
			});

			const result = await runProvisionCommand({
				paths: fixture.paths,
				inspectionAdapter: fixture.inspectionAdapter,
				provisionCapabilities: fixture.provisionCapabilities,
				dpapi: fixture.dpapi,
				dependencies: fixture.dependencies
			});

			expect(result).toMatchObject({ classification: 'RECOVERY_REQUIRED', status: 'uncertain' });
			expect(fixture.dependencies.writeNextRunState).not.toHaveBeenCalled();
			expect(fixture.mutations).toEqual([]);
		}
	);

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

	it('persists exact read-back actor coordinates after create transport failure', async () => {
		const fixture = commandFixture();
		let creates = 0;
		fixture.provisionCapabilities.mutationFor.mockImplementationOnce(() =>
			Object.freeze({
				mutate: vi.fn(async () => {
					creates += 1;
					fixture.snapshot().actors.reporter.auth = 'confirmed';
					throw new Error('transport failed after commit');
				}),
				readBack: vi.fn(async () => {
					fixture.snapshot().actors.reporter.manifest = 'confirmed';
					Object.assign(fixture.snapshot().actors.reporter, {
						userId: actorIds.reporter,
						createdAt
					});
					return {
						status: 'confirmed',
						actor: { role: 'reporter', userId: actorIds.reporter, createdAt }
					};
				})
			})
		);

		await runProvisionCommand({
			paths: fixture.paths,
			inspectionAdapter: fixture.inspectionAdapter,
			provisionCapabilities: fixture.provisionCapabilities,
			dpapi: fixture.dpapi,
			dependencies: fixture.dependencies
		});

		expect(creates).toBe(1);
		expect(fixture.manifest().actors[0]).toMatchObject({
			role: 'reporter',
			userId: actorIds.reporter,
			createdAt
		});
		expect(fixture.mutations).not.toContain('reporter.auth-created');
	});

	it('rejects mismatched mutation and read-back actor coordinates before manifest persistence', async () => {
		const fixture = commandFixture();
		fixture.provisionCapabilities.mutationFor.mockImplementationOnce(() =>
			Object.freeze({
				mutate: vi.fn(async () => ({
					actor: { role: 'reporter', userId: actorIds.reporter, createdAt, emailConfirmed: true }
				})),
				readBack: vi.fn(async () => ({
					status: 'confirmed',
					actor: { role: 'reporter', userId: actorIds['cross-user'], createdAt }
				}))
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
		).rejects.toMatchObject({ reasonCode: 'provision_evidence_invalid' });
		expect(fixture.dependencies.persistManifest).not.toHaveBeenCalled();
	});

	it('reconciles an exact actor manifest-ahead crash under the lock without recreating it', async () => {
		const fixture = commandFixture();
		const predecessor = fixture.manifest();
		const predecessorSha = createHash('sha256')
			.update(`${JSON.stringify(predecessor)}\n`)
			.digest('hex');
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
		fixture.setState({
			...fixture.state(),
			manifest: { ...fixture.state().manifest, sha256: predecessorSha }
		});
		const currentSha = createHash('sha256')
			.update(`${JSON.stringify(fixture.manifest())}\n`)
			.digest('hex');
		fixture.dependencies.hashManifest.mockImplementation((value: unknown) =>
			createHash('sha256').update(`${JSON.stringify(value)}\n`).digest('hex')
		);
		fixture.dependencies.inspectRun.mockImplementationOnce(async () => ({
			classification: 'AMBIGUOUS',
			stateRevision: fixture.state().revision,
			revision: fixture.state().revision,
			manifestBindingStatus: 'manifest-ahead-state',
			manifestAheadState: true,
			manifestSha256: currentSha,
			foreignCounts: { syntheticAccounts: 0 },
			exactRecoveryProvenance: true
		}));

		await runProvisionCommand({
			paths: fixture.paths,
			inspectionAdapter: fixture.inspectionAdapter,
			provisionCapabilities: fixture.provisionCapabilities,
			dpapi: fixture.dpapi,
			dependencies: fixture.dependencies
		});

		const repaired = fixture.dependencies.writeNextRunState.mock.calls[0][2] as Record<string, any>;
		expect(repaired.manifest.sha256).toBe(currentSha);
		expect(repaired.phases.provision.checkpoint.step).toBe('reporter.auth-created');
		expect(fixture.mutations).not.toContain('reporter.auth-created');
	});

	it('catches the final durable checkpoint up before accepting hosted PROVISION_VERIFIED truth', async () => {
		const fixture = commandFixture();
		fixture.setSnapshot({
			requiredConsents,
			exactRecoveryProvenance: true,
			actors: Object.fromEntries(roles.map((role) => [role, completedActor(role)]))
		});
		fixture.setState({
			...fixture.state(),
			phases: {
				...fixture.state().phases,
				provision: {
					status: 'in-progress',
					checkpoint: {
						observedAt: createdAt,
						status: 'confirmed',
						phase: 'provision',
						step: 'unassigned-moderator.mfa-verified',
						reasonCode: 'provision_boundary_confirmed',
						revision: fixture.state().revision,
						operationId: 'unassigned-moderator.mfa-verified'
					}
				}
			}
		});

		const result = await runProvisionCommand({
			paths: fixture.paths,
			inspectionAdapter: fixture.inspectionAdapter,
			provisionCapabilities: fixture.provisionCapabilities,
			dpapi: fixture.dpapi,
			dependencies: fixture.dependencies
		});

		expect(result).toMatchObject({ status: 'confirmed', classification: 'PROVISION_VERIFIED' });
		expect(fixture.mutations).toEqual([]);
		expect(fixture.state().phases.provision).toMatchObject({
			status: 'complete',
			checkpoint: { step: 'unassigned-moderator.actor-verified' }
		});
	});

	it('stops on canonical foreign synthetic-account evidence before capability exposure', async () => {
		const fixture = commandFixture();
		fixture.dependencies.inspectRun.mockResolvedValueOnce({
			classification: 'PREFLIGHT_READY',
			stateRevision: fixture.state().revision,
			revision: fixture.state().revision,
			foreignCounts: { syntheticAccounts: 1 },
			exactRecoveryProvenance: true
		});

		const result = await runProvisionCommand({
			paths: fixture.paths,
			inspectionAdapter: fixture.inspectionAdapter,
			provisionCapabilities: fixture.provisionCapabilities,
			dpapi: fixture.dpapi,
			dependencies: fixture.dependencies
		});

		expect(result).toMatchObject({ status: 'uncertain', classification: 'AMBIGUOUS' });
		expect(fixture.provisionCapabilities.inspectProvision).not.toHaveBeenCalled();
		expect(fixture.provisionCapabilities.mutationFor).not.toHaveBeenCalled();
		expect(fixture.mutations).toEqual([]);
	});

	it.each(['accessor', 'proxy-array', 'extra-key'] as const)(
		'rejects unstable snapshot evidence (%s) before capability exposure',
		async (kind) => {
			const fixture = commandFixture();
			const snapshot = structuredClone(fixture.snapshot());
			let getterReads = 0;
			if (kind === 'accessor') {
				Object.defineProperty(snapshot.actors.reporter, 'auth', {
					enumerable: true,
					get() {
						getterReads += 1;
						return 'absent';
					}
				});
			} else if (kind === 'proxy-array') {
				snapshot.actors.reporter.acceptedConsents = new Proxy([], {});
			} else {
				snapshot.actors.reporter.untrusted = true;
			}
			fixture.provisionCapabilities.inspectProvision.mockResolvedValueOnce(snapshot);

			await expect(
				runProvisionCommand({
					paths: fixture.paths,
					inspectionAdapter: fixture.inspectionAdapter,
					provisionCapabilities: fixture.provisionCapabilities,
					dpapi: fixture.dpapi,
					dependencies: fixture.dependencies
				})
			).rejects.toMatchObject({ reasonCode: 'provision_evidence_invalid' });
			expect(getterReads).toBe(0);
			expect(fixture.provisionCapabilities.mutationFor).not.toHaveBeenCalled();
			expect(fixture.mutations).toEqual([]);
		}
	);

	it('stops before mutation when exact lock ownership is replaced', async () => {
		const fixture = commandFixture();
		fixture.dependencies.inspectRunLock.mockResolvedValueOnce({
			status: 'held',
			acquiredBytes: 'replacement-lock'
		});

		await expect(
			runProvisionCommand({
				paths: fixture.paths,
				inspectionAdapter: fixture.inspectionAdapter,
				provisionCapabilities: fixture.provisionCapabilities,
				dpapi: fixture.dpapi,
				dependencies: fixture.dependencies
			})
		).rejects.toMatchObject({ reasonCode: 'run_lock_lost' });
		expect(fixture.provisionCapabilities.mutationFor).not.toHaveBeenCalled();
		expect(fixture.mutations).toEqual([]);
	});

	it('stops after mutation and before read-back or persistence when lock ownership is lost', async () => {
		const fixture = commandFixture();
		fixture.dependencies.inspectRunLock.mockImplementation(async () =>
			fixture.mutations.includes('reporter.auth-created')
				? { status: 'held', acquiredBytes: 'replacement-lock' }
				: { status: 'held', acquiredBytes: 'exact-lock' }
		);

		await expect(
			runProvisionCommand({
				paths: fixture.paths,
				inspectionAdapter: fixture.inspectionAdapter,
				provisionCapabilities: fixture.provisionCapabilities,
				dpapi: fixture.dpapi,
				dependencies: fixture.dependencies
			})
		).rejects.toMatchObject({ reasonCode: 'run_lock_lost' });
		expect(fixture.mutations).toEqual(['reporter.auth-created']);
		expect(fixture.dependencies.persistManifest).not.toHaveBeenCalled();
		expect(fixture.dependencies.writeNextRunState).not.toHaveBeenCalled();
	});

	it('fails a successful command when exact lock release returns false', async () => {
		const fixture = commandFixture();
		fixture.setSnapshot({
			requiredConsents,
			exactRecoveryProvenance: true,
			actors: Object.fromEntries(roles.map((role) => [role, completedActor(role)]))
		});
		fixture.dependencies.releaseRunLock.mockResolvedValueOnce(false);
		await expect(
			runProvisionCommand({
				paths: fixture.paths,
				inspectionAdapter: fixture.inspectionAdapter,
				provisionCapabilities: fixture.provisionCapabilities,
				dpapi: fixture.dpapi,
				dependencies: fixture.dependencies
			})
		).rejects.toMatchObject({ reasonCode: 'run_lock_release_failed' });
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
