import { describe, expect, it, vi } from 'vitest';
import * as hostedOperator from '../../scripts/hosted-report-evidence-operator.mjs';
import { runProvisionBoundary } from '../../scripts/gate3-hosted-provision-runner.mjs';

const roles = [
	'reporter',
	'cross-user',
	'assigned-moderator',
	'unassigned-moderator'
] as const;
const actorIds = {
	reporter: '11111111-1111-4111-8111-111111111111',
	'cross-user': '22222222-2222-4222-8222-222222222222',
	'assigned-moderator': '33333333-3333-4333-8333-333333333333',
	'unassigned-moderator': '44444444-4444-4444-8444-444444444444'
} as const;
const createdAt = '2026-08-09T12:00:00.000Z';
const fixtureTotpSecret = ['JBSWY3DP', 'EHPK3PXP'].join('');
const environment = {
	APP_ENV: 'staging',
	E2E_REAL_RUN: 'true',
	E2E_REAL_REPORT_EVIDENCE_RUN: 'true',
	E2E_REAL_REPORT_EVIDENCE_RUN_ID: 'gate3-20260809-0001',
	E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE: '55555555-5555-4555-8555-555555555555',
	E2E_REAL_REPORT_EVIDENCE_PROVISIONED_AFTER: '2026-08-09T11:59:00.000Z',
	E2E_REAL_BASE_URL: hostedOperator.HOSTED_STAGING.workerOrigin,
	PUBLIC_SUPABASE_URL: hostedOperator.HOSTED_STAGING.supabaseUrl,
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only',
	EXPECTED_SUPABASE_PROJECT_REF: hostedOperator.HOSTED_STAGING.projectRef,
	SUPABASE_SECRET_KEY: 'server-secret-value',
	E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_RUN: 'true',
	E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_APPROVAL: 'A9',
	E2E_REAL_REPORTER_EMAIL: 'reporter@example.invalid',
	E2E_REAL_REPORTER_PASSWORD: 'reporter-password',
	E2E_REAL_REPORTER_USERNAME: 'gate3-reporter',
	E2E_REAL_CROSS_USER_EMAIL: 'cross-user@example.invalid',
	E2E_REAL_CROSS_USER_PASSWORD: 'cross-user-password',
	E2E_REAL_CROSS_USER_USERNAME: 'gate3-cross-user',
	E2E_REAL_ASSIGNED_MODERATOR_EMAIL: 'assigned@example.invalid',
	E2E_REAL_ASSIGNED_MODERATOR_PASSWORD: 'assigned-password',
	E2E_REAL_ASSIGNED_MODERATOR_USERNAME: 'gate3-assigned',
	E2E_REAL_UNASSIGNED_MODERATOR_EMAIL: 'unassigned@example.invalid',
	E2E_REAL_UNASSIGNED_MODERATOR_PASSWORD: 'unassigned-password',
	E2E_REAL_UNASSIGNED_MODERATOR_USERNAME: 'gate3-unassigned'
};
const prerequisiteReceipt = {
	target: {
		projectRef: hostedOperator.HOSTED_STAGING.projectRef,
		organizationId: hostedOperator.HOSTED_STAGING.organizationId,
		region: hostedOperator.HOSTED_STAGING.region,
		postgresMajor: 17,
		status: 'ACTIVE_HEALTHY'
	},
	publicSignupEnabled: true,
	emailAutoconfirmEnabled: false,
	anonymousUsersEnabled: false
};
const requiredConsents = [
	{ documentCode: 'age_18_confirmation', documentVersion: '2026-07-22' },
	{ documentCode: 'beta_terms', documentVersion: '2026-07-22' },
	{ documentCode: 'marketplace_rules', documentVersion: '2026-07-22' },
	{ documentCode: 'privacy_notice', documentVersion: '2026-07-22' }
] as const;

function provisioningApi() {
	return hostedOperator as unknown as {
		verifyHostedA9Prerequisites: (options: unknown) => Promise<unknown>;
		executeHostedA9Provisioning: (options: unknown) => Promise<unknown>;
		createHostedA9ProvisionOperations: (options: unknown) => Record<string, Function>;
	};
}

function fakeAdapters(events: string[], failFinalInspection = false) {
	return {
		inspectRequiredAccessDocuments: vi.fn(async () => requiredConsents),
		assertFreshActorAbsent: vi.fn(async ({ role }: { role: string }) => {
			events.push(`absent:${role}`);
			return { role, absent: true };
		}),
		createConfirmedUser: vi.fn(async ({ role }: { role: (typeof roles)[number] }) => {
			events.push(`create:${role}`);
			return { role, userId: actorIds[role], createdAt, emailConfirmed: true };
		}),
		createActorSession: vi.fn(async ({ role }: { role: (typeof roles)[number] }) => ({
			claimOpenRegistration: vi.fn(async () => events.push(`claim:${role}`)),
			acceptBetaConsent: vi.fn(async (consent: { documentCode: string }) =>
				events.push(`consent:${role}:${consent.documentCode}`)
			),
			completeBetaOnboarding: vi.fn(async () => events.push(`onboard:${role}`)),
			getMyBetaAccess: vi.fn(async () => events.push(`access:${role}`)),
			mfa: {
				enrollAndVerify: vi.fn(async ({ clock }: { clock: () => number }) => {
					const timestampMs = clock();
					events.push(`mfa:${role}:${timestampMs}`);
					return {
						factorId: `factor-${role}`,
						factorType: 'totp',
						factorStatus: 'verified',
						initialAal: 'aal1',
						finalAal: 'aal2'
					};
				}),
				rollbackEnrollment: vi.fn(async () => events.push(`rollback-mfa:${role}`))
			}
		})),
		elevateFreshActorRole: vi.fn(async ({ role }: { role: string }) => {
			events.push(`elevate:${role}`);
		}),
		inspectFreshActor: vi.fn(async ({ role }: { role: (typeof roles)[number] }) => {
			events.push(`inspect:${role}`);
			if (failFinalInspection && role === 'unassigned-moderator') {
				throw new Error('provider leaked actor@example.invalid');
			}
			return {
				role,
				userId: actorIds[role],
				emailConfirmed: true,
				profileRole: role.endsWith('moderator') ? 'moderator' : 'user',
				isSuspended: false,
				membershipStatus: 'active',
				onboardingComplete: true
			};
		}),
		inspectZeroA9Artifacts: vi.fn(async () => ({
			reports: 0,
			uploads: 0,
			objects: 0,
			queueRows: 0
		})),
		deleteFreshUser: vi.fn(async ({ role }: { role: string }) => {
			events.push(`rollback-user:${role}`);
		})
	};
}

const readBackSteps = [
	'auth-created',
	'registration-claimed',
	...requiredConsents.map(
		({ documentCode, documentVersion }) => `consent-${documentCode}-${documentVersion}`
	),
	'onboarding-complete',
	'role-elevated',
	'mfa-enrolled',
	'mfa-unenrolled-recovery',
	'mfa-verified',
	'actor-verified'
] as const;

function createRealReadBackFixture(
	step: (typeof readBackSteps)[number],
	outcome: 'confirmed' | 'confirmed-absent' | 'uncertain'
) {
	const config = hostedOperator.validateHostedA9Environment(environment);
	const role: keyof typeof actorIds = new Set([
		'role-elevated',
		'mfa-enrolled',
		'mfa-unenrolled-recovery',
		'mfa-verified',
		'actor-verified'
	]).has(step)
		? 'assigned-moderator'
		: 'reporter';
	const userId = actorIds[role];
	const credentials = config.actorRoles[role];
	const user = {
		id: userId,
		email: credentials.email,
		created_at: createdAt,
		email_confirmed_at: createdAt,
		user_metadata: {
			username: credentials.username,
			gate3_report_evidence_run_id: config.runId,
			gate3_report_evidence_provisioning_nonce: config.provisioningNonce,
			gate3_report_evidence_provisioning_attempt_id: config.provisioningNonce
		}
	};
	const profile = {
		id: userId,
		username: credentials.username,
		role: role.endsWith('moderator') ? 'moderator' : 'user',
		is_suspended: false
	};
	const membership = {
		profile_id: userId,
		invite_id: null,
		status: 'active',
		onboarding_completed_at: createdAt
	};
	const consent = step.startsWith('consent-')
		? requiredConsents.find(
				({ documentCode, documentVersion }) =>
					step === `consent-${documentCode}-${documentVersion}`
			)
		: null;
	const consentRow = consent
		? {
				profile_id: userId,
				document_code: consent.documentCode,
				document_version: consent.documentVersion,
				accepted_at: createdAt,
				source: 'web'
			}
		: null;
	const access = {
		profile_id: userId,
		membership_status: 'active',
		onboarding_completed_at: createdAt,
		membership_expires_at: null,
		email_verified_at: createdAt,
		phone_verified_at: null,
		merchant_verified_at: null,
		role: profile.role,
		username: credentials.username,
		is_suspended: false,
		account_kind: 'private',
		has_current_consents: true,
		is_active: true
	};
	const evidence: Record<string, any> = {
		authUsers: [user],
		listUsersResult: null,
		listUsersPages: null,
		getUserResult: { data: { user }, error: null },
		profileRows: [profile],
		membershipRows: [membership],
		consentRows: consentRow ? [consentRow] : [],
		accessRows: [access],
		accessResult: null,
		factors: [{ id: 'private-factor-id', status: 'verified' }],
		factorsResult: null,
		aal: { currentLevel: 'aal1', nextLevel: 'aal2' },
		aalResult: null,
		tableResults: {},
		signInResult: {
			data: { user: { id: userId, email: credentials.email } },
			error: null
		}
	};
	if (step === 'mfa-unenrolled-recovery' && outcome === 'confirmed') {
		evidence.factors = [];
		evidence.aal = { currentLevel: 'aal1', nextLevel: 'aal1' };
	}

	if (outcome === 'confirmed-absent') {
		if (step === 'auth-created') evidence.authUsers = [];
		else if (step === 'registration-claimed') evidence.membershipRows = [];
		else if (step.startsWith('consent-')) evidence.consentRows = [];
		else if (step === 'onboarding-complete') {
			evidence.membershipRows = [
				{ ...membership, status: 'pending', onboarding_completed_at: null }
			];
		} else if (step === 'role-elevated') {
			evidence.profileRows = [{ ...profile, role: 'user' }];
		} else if (step === 'mfa-enrolled') {
			evidence.factors = [];
			evidence.aal = { currentLevel: 'aal1', nextLevel: 'aal1' };
		} else if (step === 'mfa-unenrolled-recovery' || step === 'mfa-verified') {
			evidence.factors = [{ id: 'private-factor-id', status: 'unverified' }];
			evidence.aal = { currentLevel: 'aal1', nextLevel: 'aal1' };
		} else if (step === 'actor-verified') {
			evidence.accessRows = [
				{
					...access,
					membership_status: 'pending',
					onboarding_completed_at: null,
					has_current_consents: false,
					is_active: false
				}
			];
		}
	}
	if (outcome === 'uncertain') {
		if (step === 'auth-created') {
			evidence.authUsers = [user, { ...user, id: actorIds['cross-user'] }];
		} else if (step === 'registration-claimed') {
			evidence.membershipRows = [membership, { ...membership }];
		} else if (step.startsWith('consent-')) {
			evidence.consentRows = [consentRow, { ...consentRow }];
		} else if (step === 'onboarding-complete') {
			evidence.membershipRows = [{ ...membership, onboarding_completed_at: null }];
		} else if (step === 'role-elevated') {
			evidence.profileRows = [{ ...profile, role: 'admin' }];
		} else if (step === 'actor-verified') {
			evidence.accessRows = [access, { ...access }];
		} else {
			evidence.factors = [
				{ id: 'private-factor-id', status: 'unverified' },
				{ id: 'second-private-factor-id', status: 'verified' }
			];
		}
	}

	const createUser = vi.fn();
	const deleteUser = vi.fn();
	const update = vi.fn();
	const insert = vi.fn();
	const upsert = vi.fn();
	const remove = vi.fn();
	const rpc = vi.fn(async (functionName: string) => {
		if (functionName !== 'get_my_beta_access') {
			return { data: null, error: { message: 'mutation RPC was not expected' } };
		}
		return evidence.accessResult ?? { data: evidence.accessRows, error: null };
	});
	const enroll = vi.fn();
	const unenroll = vi.fn();
	const challengeAndVerify = vi.fn();
	const actorClient = {
		auth: {
			signInWithPassword: vi.fn(async () => evidence.signInResult),
			mfa: {
				enroll,
				unenroll,
				challengeAndVerify,
				listFactors: vi.fn(async () =>
					evidence.factorsResult ?? {
						data: { totp: evidence.factors, phone: [] },
						error: null
					}
				),
				getAuthenticatorAssuranceLevel: vi.fn(async () =>
					evidence.aalResult ?? { data: evidence.aal, error: null }
				)
			}
		},
		rpc
	};
	const from = vi.fn((table: string) => {
		const filters: Record<string, unknown> = {};
		const query: Record<string, any> = {
			select: vi.fn(() => query),
			eq: vi.fn((name: string, value: unknown) => {
				filters[name] = value;
				return query;
			}),
			limit: vi.fn(async () => {
				const rows =
					table === 'profiles'
						? evidence.profileRows
						: table === 'beta_memberships'
							? evidence.membershipRows
							: table === 'beta_consent_events'
								? evidence.consentRows
								: null;
				return rows === null
					? { data: null, error: { message: 'unexpected table' } }
					: { data: rows, error: null };
			}),
			update,
			insert,
			upsert,
			delete: remove
		};
		if (Object.hasOwn(evidence.tableResults, table)) {
			query.limit = vi.fn(async () => evidence.tableResults[table]);
		}
		return query;
	});
	const listUsers = vi.fn(async ({ page }: { page: number }) =>
		evidence.listUsersPages?.[page - 1] ??
		evidence.listUsersResult ?? {
			data: { users: evidence.authUsers, lastPage: 1 },
			error: null
		}
	);
	const serviceClient = {
		supabaseUrl: hostedOperator.HOSTED_STAGING.supabaseUrl,
		auth: {
			admin: {
				listUsers,
				getUserById: vi.fn(async () => evidence.getUserResult),
				createUser,
				deleteUser
			}
		},
		from
	};
	const adapters = hostedOperator.createSupabaseHostedA9Adapters({
		config,
		serviceClient: serviceClient as never,
		createActorClient: vi.fn(() => actorClient) as never,
		credentialSink: {
			storeModeratorTotpSecret: vi.fn(),
			deleteModeratorTotpSecret: vi.fn()
		}
	});
	const operations = provisioningApi().createHostedA9ProvisionOperations({ config, adapters });
	const manifest =
		step === 'auth-created'
			? hostedOperator.createHostedRunManifest(config)
			: hostedOperator.registerHostedActor(
					hostedOperator.createHostedRunManifest(config),
					role,
					userId,
					createdAt
				);
	return {
		adapters,
		evidence,
		manifest,
		operations,
		role,
		spies: { challengeAndVerify, createUser, deleteUser, enroll, insert, listUsers, remove, rpc, unenroll, update, upsert }
	};
}

function createRealActorCreationBoundaryFixture(
	afterCreate: 'confirmed' | 'confirmed-absent' | 'uncertain'
) {
	const config = hostedOperator.validateHostedA9Environment(environment);
	const role = 'reporter' as const;
	const credentials = config.actorRoles[role];
	const exactUser: Record<string, any> = {
		id: actorIds[role],
		email: credentials.email,
		created_at: createdAt,
		email_confirmed_at: createdAt,
		user_metadata: {
			username: credentials.username,
			gate3_report_evidence_run_id: config.runId,
			gate3_report_evidence_provisioning_nonce: config.provisioningNonce,
			gate3_report_evidence_provisioning_attempt_id: config.provisioningNonce
		}
	};
	let authUsers: Array<Record<string, any>> = [];
	const createUser = vi.fn(async () => {
		authUsers =
			afterCreate === 'confirmed'
				? [exactUser]
				: afterCreate === 'uncertain'
					? [exactUser, { ...exactUser, id: actorIds['cross-user'] }]
					: [];
		throw new Error('transport failed after Auth outcome');
	});
	const deleteUser = vi.fn(async () => {
		authUsers = [];
		return { data: {}, error: null };
	});
	const listUsers = vi.fn(async () => ({
		data: { users: authUsers, total: authUsers.length, lastPage: 1 },
		error: null
	}));
	const getUserById = vi.fn(async (userId: string) => {
		const user = authUsers.find((candidate) => candidate.id === userId) ?? null;
		return user
			? { data: { user }, error: null }
			: { data: { user: null }, error: { status: 404 } };
	});
	const adapters = hostedOperator.createSupabaseHostedA9Adapters({
		config,
		serviceClient: {
			supabaseUrl: hostedOperator.HOSTED_STAGING.supabaseUrl,
			auth: { admin: { createUser, deleteUser, getUserById, listUsers } }
		} as never,
		createActorClient: vi.fn() as never,
		credentialSink: {
			storeModeratorTotpSecret: vi.fn(),
			deleteModeratorTotpSecret: vi.fn()
		}
	});
	const operations = provisioningApi().createHostedA9ProvisionOperations({ config, adapters });
	const manifest = hostedOperator.createHostedRunManifest(config);
	const intent = hostedOperator.registerHostedActorIntent(manifest, role);
	const events: string[] = [];
	let persistedManifest: ReturnType<typeof hostedOperator.createHostedRunManifest> | null = null;
	let targetedReadBack: Record<string, unknown> | null = null;
	const readBack = vi.fn(async () => {
		events.push('read-back');
		targetedReadBack = await operations.readBack({ manifest: intent, role, step: 'auth-created' });
		return targetedReadBack;
	});
	const execute = () =>
		runProvisionBoundary({
			inspection: Object.freeze({
				classification: 'PREFLIGHT_READY',
				revision: 1,
				role,
				step: 'auth-created',
				outcome: 'confirmed-absent'
			}),
			authorization: Object.freeze({
				command: 'provision',
				phase: 'provision',
				role,
				step: 'auth-created',
				operationId: `${role}.auth-created`,
				revision: 1
			}),
			capabilities: Object.freeze({
				mutate: async () => {
					events.push('create');
					return operations.createActor({ manifest, role });
				},
				readBack,
				persistCredential: null,
				persistManifest: async ({ readBackReceipt }: { readBackReceipt: { actor: { userId: string; createdAt: string } } }) => {
					events.push('manifest');
					persistedManifest = hostedOperator.registerHostedActor(
						intent,
						role,
						readBackReceipt.actor.userId,
						readBackReceipt.actor.createdAt
					);
				},
				persistState: async () => events.push('state')
			})
		});
	return {
		authUsers: () => authUsers,
		createUser,
		deleteUser,
		events,
		execute,
		persistedManifest: () => persistedManifest,
		readBack,
		targetedReadBack: () => targetedReadBack
	};
}

describe('executable A9-only provisioning transaction', () => {
	it.each(
		readBackSteps.flatMap((step) =>
			(['confirmed', 'confirmed-absent', 'uncertain'] as const).map((outcome) => ({ step, outcome }))
		)
	)(
		'reads $step as sanitized $outcome through the unmodified real Supabase A9 adapter',
		async ({ step, outcome }) => {
			const fixture = createRealReadBackFixture(step, outcome);
			const result = await fixture.operations.readBack({
				manifest: fixture.manifest,
				role: fixture.role,
				step
			});

			expect(result).toEqual(
				step === 'auth-created' && outcome === 'confirmed'
					? {
							status: 'confirmed',
							actor: { role: fixture.role, userId: actorIds[fixture.role], createdAt }
						}
					: { status: outcome }
			);
			expect(Object.isFrozen(result)).toBe(true);
			expect(JSON.stringify(result)).not.toMatch(
				/@|password|secret|token|cipher|factor|private-factor|provider/iu
			);
			expect(fixture.spies.createUser).not.toHaveBeenCalled();
			expect(fixture.spies.deleteUser).not.toHaveBeenCalled();
			expect(fixture.spies.update).not.toHaveBeenCalled();
			expect(fixture.spies.insert).not.toHaveBeenCalled();
			expect(fixture.spies.upsert).not.toHaveBeenCalled();
			expect(fixture.spies.remove).not.toHaveBeenCalled();
			expect(fixture.spies.enroll).not.toHaveBeenCalled();
			expect(fixture.spies.unenroll).not.toHaveBeenCalled();
			expect(fixture.spies.challengeAndVerify).not.toHaveBeenCalled();
			expect(fixture.spies.rpc.mock.calls.every(([name]) => name === 'get_my_beta_access')).toBe(
				true
			);
		}
	);

	it.each([
		'provider-error',
		'missing-provenance',
		'foreign-actor',
		'malformed',
		'accessor',
		'proxy'
	] as const)('fails closed on %s Auth read-back evidence', async (kind) => {
		const fixture = createRealReadBackFixture('auth-created', 'confirmed');
		const exactUser = fixture.evidence.authUsers[0];
		if (kind === 'provider-error') {
			fixture.evidence.listUsersResult = { data: { users: [] }, error: { message: 'private' } };
		} else if (kind === 'missing-provenance') {
			fixture.evidence.authUsers = [
				{ ...exactUser, user_metadata: { ...exactUser.user_metadata, gate3_report_evidence_provisioning_nonce: undefined } }
			];
		} else if (kind === 'foreign-actor') {
			fixture.evidence.authUsers = [
				{ ...exactUser, email: environment.E2E_REAL_CROSS_USER_EMAIL }
			];
		} else if (kind === 'malformed') {
			fixture.evidence.listUsersResult = { data: { users: 'not-an-array' }, error: null };
		} else if (kind === 'accessor') {
			const accessor = { ...exactUser };
			Object.defineProperty(accessor, 'email', { enumerable: true, get: () => exactUser.email });
			fixture.evidence.authUsers = [accessor];
		} else {
			fixture.evidence.authUsers = [new Proxy(exactUser, {})];
		}

		await expect(
			fixture.operations.readBack({
				manifest: fixture.manifest,
				role: fixture.role,
				step: 'auth-created'
			})
		).resolves.toEqual({ status: 'uncertain' });
	});

	it.each([
		'database-provider-error',
		'database-missing-field',
		'session-mismatch',
		'session-accessor',
		'rpc-provider-error',
		'rpc-malformed',
		'mfa-provider-error',
		'mfa-accessor',
		'mfa-array-prototype'
	] as const)('fails closed on %s targeted read-back evidence', async (kind) => {
		const step = kind.startsWith('rpc') || kind === 'session-accessor'
			? 'actor-verified'
			: kind.startsWith('database-')
				? 'registration-claimed'
				: 'mfa-verified';
		const fixture = createRealReadBackFixture(step, 'confirmed');
		if (kind === 'database-provider-error') {
			fixture.evidence.tableResults.beta_memberships = {
				data: [],
				error: { message: 'private database response' }
			};
		} else if (kind === 'database-missing-field') {
			fixture.evidence.membershipRows = [
				{
					profile_id: actorIds.reporter,
					invite_id: null,
					status: 'active'
				}
			];
		} else if (kind === 'session-mismatch') {
			fixture.evidence.signInResult = {
				data: {
					user: {
						id: actorIds.reporter,
						email: environment.E2E_REAL_ASSIGNED_MODERATOR_EMAIL
					}
				},
				error: null
			};
		} else if (kind === 'session-accessor') {
			const sessionUser = {
				id: actorIds['assigned-moderator'],
				email: environment.E2E_REAL_ASSIGNED_MODERATOR_EMAIL
			};
			Object.defineProperty(sessionUser, 'id', {
				enumerable: true,
				get: () => actorIds['assigned-moderator']
			});
			fixture.evidence.signInResult = { data: { user: sessionUser }, error: null };
		} else if (kind === 'rpc-provider-error') {
			fixture.evidence.accessResult = {
				data: null,
				error: { message: 'private RPC response' }
			};
		} else if (kind === 'rpc-malformed') {
			fixture.evidence.accessResult = { data: { profile_id: actorIds.reporter }, error: null };
		} else if (kind === 'mfa-provider-error') {
			fixture.evidence.factorsResult = {
				data: { totp: [], phone: [] },
				error: { message: 'private MFA response' }
			};
		} else if (kind === 'mfa-accessor') {
			const factor = { id: 'private-factor-id', status: 'verified' };
			Object.defineProperty(factor, 'status', {
				enumerable: true,
				get: () => 'verified'
			});
			fixture.evidence.factors = [factor];
		} else {
			const factors = [{ id: 'private-factor-id', status: 'verified' }];
			Object.setPrototypeOf(factors, {});
			fixture.evidence.factors = factors;
		}

		await expect(
			fixture.operations.readBack({
				manifest: fixture.manifest,
				role: fixture.role,
				step
			})
		).resolves.toEqual({ status: 'uncertain' });
	});

	it('accepts one exact actor on a full final Auth page without widening the role scope', async () => {
		const fixture = createRealReadBackFixture('auth-created', 'confirmed');
		const users = [
			fixture.evidence.authUsers[0],
			...Array.from({ length: 999 }, (_, index) => ({
				id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
				email: `unrelated-${index}@example.invalid`,
				user_metadata: {}
			}))
		];
		fixture.evidence.listUsersResult = {
			data: { users, total: users.length, lastPage: 1 },
			error: null
		};

		await expect(
			fixture.operations.readBack({
				manifest: fixture.manifest,
				role: fixture.role,
				step: 'auth-created'
			})
		).resolves.toEqual({
			status: 'confirmed',
			actor: { role: 'reporter', userId: actorIds.reporter, createdAt }
		});
	});

	it('scans past a misleading Auth lastPage when total proves a later exact actor exists', async () => {
		const fixture = createRealReadBackFixture('auth-created', 'confirmed');
		const exactActor = fixture.evidence.authUsers[0];
		const firstPage = Array.from({ length: 1000 }, (_, index) => ({
			id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, '0')}`,
			email: `unrelated-${index}@example.invalid`,
			user_metadata: {}
		}));
		fixture.evidence.listUsersPages = [
			{ data: { users: firstPage, total: 1001, lastPage: 1 }, error: null },
			{ data: { users: [exactActor], total: 1001, lastPage: 2 }, error: null }
		];

		await expect(
			fixture.operations.readBack({
				manifest: fixture.manifest,
				role: fixture.role,
				step: 'auth-created'
			})
		).resolves.toEqual({
			status: 'confirmed',
			actor: { role: 'reporter', userId: actorIds.reporter, createdAt }
		});
		expect(fixture.spies.listUsers).toHaveBeenCalledTimes(2);
	});

	it('returns uncertain when a later Auth page contains a duplicate exact actor', async () => {
		const fixture = createRealReadBackFixture('auth-created', 'confirmed');
		const exactActor = fixture.evidence.authUsers[0];
		const firstPage = [
			exactActor,
			...Array.from({ length: 999 }, (_, index) => ({
				id: `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, '0')}`,
				email: `unrelated-${index}@example.invalid`,
				user_metadata: {}
			}))
		];
		fixture.evidence.listUsersPages = [
			{ data: { users: firstPage, total: 1001, lastPage: 1 }, error: null },
			{
				data: {
					users: [{ ...exactActor, id: actorIds['cross-user'] }],
					total: 1001,
					lastPage: 2
				},
				error: null
			}
		];

		await expect(
			fixture.operations.readBack({
				manifest: fixture.manifest,
				role: fixture.role,
				step: 'auth-created'
			})
		).resolves.toEqual({ status: 'uncertain' });
		expect(fixture.spies.listUsers).toHaveBeenCalledTimes(2);
	});

	it('returns uncertain when a short Auth page claims more total users', async () => {
		const fixture = createRealReadBackFixture('auth-created', 'confirmed');
		fixture.evidence.listUsersPages = [
			{
				data: {
					users: [
						{
							id: actorIds['cross-user'],
							email: 'unrelated@example.invalid',
							user_metadata: {}
						}
					],
					total: 2,
					lastPage: 2
				},
				error: null
			}
		];

		await expect(
			fixture.operations.readBack({
				manifest: fixture.manifest,
				role: fixture.role,
				step: 'auth-created'
			})
		).resolves.toEqual({ status: 'uncertain' });
		expect(fixture.spies.listUsers).toHaveBeenCalledTimes(1);
	});

	it('returns uncertain when Auth totals change between pages', async () => {
		const fixture = createRealReadBackFixture('auth-created', 'confirmed');
		const firstPage = Array.from({ length: 1000 }, (_, index) => ({
			id: `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, '0')}`,
			email: `unrelated-${index}@example.invalid`,
			user_metadata: {}
		}));
		fixture.evidence.listUsersPages = [
			{ data: { users: firstPage, total: 1001, lastPage: 1 }, error: null },
			{
				data: { users: [fixture.evidence.authUsers[0]], total: 1002, lastPage: 2 },
				error: null
			}
		];

		await expect(
			fixture.operations.readBack({
				manifest: fixture.manifest,
				role: fixture.role,
				step: 'auth-created'
			})
		).resolves.toEqual({ status: 'uncertain' });
		expect(fixture.spies.listUsers).toHaveBeenCalledTimes(2);
	});

	it('reconciles an uncertain resumable Auth create without compensating the committed actor', async () => {
		const fixture = createRealActorCreationBoundaryFixture('confirmed');

		await expect(fixture.execute()).resolves.toMatchObject({
			status: 'confirmed',
			reasonCode: 'provision_boundary_confirmed'
		});

		expect(fixture.createUser).toHaveBeenCalledOnce();
		expect(fixture.deleteUser).not.toHaveBeenCalled();
		expect(fixture.authUsers()).toHaveLength(1);
		expect(fixture.authUsers()[0]?.id).toBe(actorIds.reporter);
		expect(fixture.targetedReadBack()).toEqual(
			expect.objectContaining({
				status: 'confirmed',
				actor: expect.objectContaining({ userId: actorIds.reporter })
			})
		);
		expect(fixture.persistedManifest()?.actors).toEqual([
			expect.objectContaining({ role: 'reporter', userId: actorIds.reporter, createdAt })
		]);
		expect(fixture.events).toEqual(['create', 'read-back', 'manifest', 'state']);
	});

	it.each([
		['confirmed-absent', 'confirmed-absent', 'provider_failure_confirmed_absent'],
		['uncertain', 'uncertain', 'mutation_outcome_uncertain']
	] as const)(
		'returns resumable Auth create %s as boundary %s without compensation',
		async (outcome, status, reasonCode) => {
			const fixture = createRealActorCreationBoundaryFixture(outcome);

			await expect(fixture.execute()).resolves.toMatchObject({ status, reasonCode });
			expect(fixture.createUser).toHaveBeenCalledOnce();
			expect(fixture.deleteUser).not.toHaveBeenCalled();
			expect(fixture.persistedManifest()).toBeNull();
			expect(fixture.events).toEqual(['create', 'read-back']);
		}
	);

	it('exposes narrow exact-role A9 operations without changing the compatibility transaction', async () => {
		const config = hostedOperator.validateHostedA9Environment(environment);
		const manifest = hostedOperator.createHostedRunManifest(config);
		const events: string[] = [];
		const legacyEnroll = vi.fn(async () => ({ factorId: 'legacy-factor', factorType: 'totp' }));
		const session = Object.freeze({
			role: 'assigned-moderator',
			userId: actorIds['assigned-moderator'],
			claimOpenRegistration: vi.fn(async () => events.push('registration')),
			acceptBetaConsent: vi.fn(async ({ documentCode }: { documentCode: string }) =>
				events.push(`consent:${documentCode}`)
			),
			completeBetaOnboarding: vi.fn(async () => events.push('onboarding')),
			mfa: Object.freeze({
				enroll: legacyEnroll,
				enrollForProvisioning: vi.fn(async () => ({
					factorId: 'factor-exact',
					factorType: 'totp',
					secret: fixtureTotpSecret
				})),
				listFactors: vi.fn(async () => [{ id: 'factor-exact', status: 'unverified' }]),
				challengeAndVerify: vi.fn(async ({ code }: { code: string }) => {
					events.push(`verify:${code}`);
					return { verified: true };
				}),
				rollbackEnrollment: vi.fn(async () => events.push('unenroll'))
			})
		});
		const adapters = {
			assertFreshActorAbsent: vi.fn(async ({ role }: { role: string }) => ({ role, absent: true })),
			createConfirmedUser: vi.fn(),
			createResumableUser: vi.fn(async ({ manifest: exactManifest, role }: { manifest: { pendingActors: unknown[] }; role: string }) => {
				expect(exactManifest.pendingActors).toHaveLength(1);
				return { role, userId: actorIds.reporter, createdAt, emailConfirmed: true };
			}),
			lookupConfirmedUser: vi.fn(async ({ role }: { role: string }) => ({ role, userId: actorIds.reporter, createdAt, emailConfirmed: true })),
			createActorSession: vi.fn(async ({ role }: { role: (typeof roles)[number] }) =>
				Object.freeze({ ...session, role, userId: actorIds[role] })
			),
			elevateFreshActorRole: vi.fn(async () => events.push('elevate')),
			inspectProvisionBoundary: vi.fn(async () => ({ status: 'confirmed' }))
		};
		const operations = provisioningApi().createHostedA9ProvisionOperations({ config, adapters });

		await operations.inspectActorAbsence({ manifest, role: 'reporter' });
		const actor = await operations.createActor({ manifest, role: 'reporter' });
		const actorManifest = hostedOperator.registerHostedActor(
			manifest,
			'reporter',
			actor.userId,
			actor.createdAt
		);
		await operations.inspectActorProvenance({ manifest: actorManifest, role: 'reporter' });
		await operations.claimRegistration({ manifest: actorManifest, role: 'reporter' });
		await operations.acceptConsent({
			manifest: actorManifest,
			role: 'reporter',
			consent: requiredConsents[0]
		});
		await operations.completeOnboarding({ manifest: actorManifest, role: 'reporter', city: 'Sofia' });

		const moderatorManifest = hostedOperator.registerHostedActor(
			manifest,
			'assigned-moderator',
			actorIds['assigned-moderator'],
			createdAt
		);
		await operations.elevateRole({ manifest: moderatorManifest, role: 'assigned-moderator' });
		const enrollment = await operations.enrollMfa({
			manifest: moderatorManifest,
			role: 'assigned-moderator'
		});
		expect(enrollment).toEqual({
			factorId: 'factor-exact',
			factorType: 'totp',
			secret: fixtureTotpSecret
		});
		expect(legacyEnroll).not.toHaveBeenCalled();
		await operations.verifyMfa({
			manifest: moderatorManifest,
			role: 'assigned-moderator',
			secret: fixtureTotpSecret,
			clock: () => 59_000
		});
		await operations.unenrollMfa({
			manifest: moderatorManifest,
			role: 'assigned-moderator',
			factorId: 'factor-exact'
		});
		await operations.readBack({
			manifest: moderatorManifest,
			role: 'assigned-moderator',
			step: 'mfa-unenrolled-recovery'
		});

		expect(Object.keys(operations).sort()).toEqual(
			[
				'acceptConsent',
				'claimRegistration',
				'completeOnboarding',
				'createActor',
				'elevateRole',
				'enrollMfa',
				'inspectActorAbsence',
				'inspectActorProvenance',
				'readBack',
				'unenrollMfa',
				'verifyMfa'
			].sort()
		);
		expect(events).toEqual([
			'registration',
			'consent:age_18_confirmation',
			'onboarding',
			'elevate',
			'verify:996554',
			'unenroll'
		]);
		expect(manifest.pendingActors).toEqual([]);
		expect(adapters.inspectProvisionBoundary).toHaveBeenCalledWith(
			expect.objectContaining({ role: 'assigned-moderator', step: 'mfa-unenrolled-recovery' })
		);
	});

	it.each(['missing-identity', 'wrong-role', 'wrong-user', 'accessor', 'proxy'] as const)(
		'rejects %s actor sessions before exposing actor-owned methods',
		async (kind) => {
			const config = hostedOperator.validateHostedA9Environment(environment);
			const manifest = hostedOperator.registerHostedActor(
				hostedOperator.createHostedRunManifest(config),
				'assigned-moderator',
				actorIds['assigned-moderator'],
				createdAt
			);
			const claim = vi.fn();
			const base = {
				role: 'assigned-moderator',
				userId: actorIds['assigned-moderator'],
				claimOpenRegistration: claim,
				mfa: Object.freeze({})
			};
			let session: object;
			if (kind === 'missing-identity') {
				session = Object.freeze({ claimOpenRegistration: claim, mfa: Object.freeze({}) });
			} else if (kind === 'wrong-role') {
				session = Object.freeze({ ...base, role: 'reporter' });
			} else if (kind === 'wrong-user') {
				session = Object.freeze({ ...base, userId: actorIds.reporter });
			} else if (kind === 'accessor') {
				session = { ...base };
				Object.defineProperty(session, 'userId', {
					enumerable: true,
					get: () => actorIds['assigned-moderator']
				});
				Object.freeze(session);
			} else {
				session = new Proxy(Object.freeze(base), {});
			}
			const adapters = {
				assertFreshActorAbsent: vi.fn(),
				createConfirmedUser: vi.fn(),
				createResumableUser: vi.fn(),
				lookupConfirmedUser: vi.fn(),
				createActorSession: vi.fn(async () => session),
				elevateFreshActorRole: vi.fn(),
				inspectProvisionBoundary: vi.fn()
			};
			const operations = provisioningApi().createHostedA9ProvisionOperations({ config, adapters });

			await expect(
				operations.claimRegistration({ manifest, role: 'assigned-moderator' })
			).rejects.toThrow('A9 actor session is invalid');
			expect(claim).not.toHaveBeenCalled();
		}
	);

	it('hands the real actor-owned enrollment seed directly to DPAPI persistence and re-derives its factor', async () => {
		const config = hostedOperator.validateHostedA9Environment(environment);
		const role = 'assigned-moderator';
		const userId = actorIds[role];
		const storeModeratorTotpSecret = vi.fn();
		const enroll = vi.fn(async () => ({
			data: { id: 'factor-real-seam', type: 'totp', totp: { secret: fixtureTotpSecret } },
			error: null
		}));
		const listFactors = vi.fn(async () => ({
			data: { totp: [{ id: 'factor-real-seam', status: 'unverified' }], phone: [] },
			error: null
		}));
		const challengeAndVerify = vi.fn(async () => ({ data: {}, error: null }));
		const actorClient = {
			auth: {
				signInWithPassword: vi.fn(async () => ({
					data: { user: { id: userId, email: environment.E2E_REAL_ASSIGNED_MODERATOR_EMAIL } },
					error: null
				})),
				mfa: {
					enroll,
					listFactors,
					challengeAndVerify,
					getAuthenticatorAssuranceLevel: vi.fn()
				}
			},
			rpc: vi.fn()
		};
		const user = {
			id: userId,
			email: environment.E2E_REAL_ASSIGNED_MODERATOR_EMAIL,
			created_at: createdAt,
			email_confirmed_at: createdAt,
			user_metadata: {
				gate3_report_evidence_run_id: config.runId,
				gate3_report_evidence_provisioning_nonce: config.provisioningNonce,
				gate3_report_evidence_provisioning_attempt_id: config.provisioningNonce
			}
		};
		const realAdapters = hostedOperator.createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: hostedOperator.HOSTED_STAGING.supabaseUrl,
				auth: { admin: { getUserById: vi.fn(async () => ({ data: { user }, error: null })) } }
			} as never,
			createActorClient: vi.fn(() => actorClient) as never,
			credentialSink: {
				storeModeratorTotpSecret,
				deleteModeratorTotpSecret: vi.fn()
			}
		});
		const operations = provisioningApi().createHostedA9ProvisionOperations({
			config,
			adapters: realAdapters
		});
		const manifest = hostedOperator.registerHostedActor(
			hostedOperator.createHostedRunManifest(config),
			role,
			userId,
			createdAt
		);
		const events: string[] = [];
		const result = await runProvisionBoundary({
			inspection: Object.freeze({
				classification: 'PROVISION_PARTIAL',
				revision: 9,
				role,
				step: 'mfa-enrolled',
				outcome: 'confirmed-absent'
			}),
			authorization: Object.freeze({
				command: 'provision',
				phase: 'provision',
				role,
				step: 'mfa-enrolled',
				operationId: `${role}.mfa-enrolled`,
				revision: 9
			}),
			capabilities: Object.freeze({
				mutate: async () => {
					events.push('enroll');
					return operations.enrollMfa({ manifest, role });
				},
				readBack: async () => {
					events.push('read-back');
					return { status: 'confirmed' };
				},
				persistCredential: async (enrollment: { secret: string }) => {
					events.push('dpapi');
					expect(enrollment.secret).toBe(fixtureTotpSecret);
					return { status: 'available', ciphertextSha256: 'a'.repeat(64) };
				},
				persistManifest: null,
				persistState: async () => events.push('state')
			})
		});

		expect(events).toEqual(['enroll', 'dpapi', 'read-back', 'state']);
		expect(storeModeratorTotpSecret).not.toHaveBeenCalled();
		expect(JSON.stringify(result)).not.toMatch(/JBSW|secret|factor-real/u);
		await operations.verifyMfa({ manifest, role, secret: fixtureTotpSecret, clock: () => 59_000 });
		expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor-real-seam', code: '996554' });
	});

	it('re-verifies the exact target and hosted Auth policy without exposing the publishable key', async () => {
		const verifyTarget = vi.fn(() => ({
			ref: hostedOperator.HOSTED_STAGING.projectRef,
			organizationId: hostedOperator.HOSTED_STAGING.organizationId,
			region: hostedOperator.HOSTED_STAGING.region,
			postgresMajor: 17,
			status: 'ACTIVE_HEALTHY',
			url: hostedOperator.HOSTED_STAGING.supabaseUrl
		}));
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				disable_signup: false,
				mailer_autoconfirm: false,
				external: { anonymous_users: false }
			})
		}));

		const receipt = await provisioningApi().verifyHostedA9Prerequisites({
			environment,
			dependencies: { verifyTarget, fetchImpl }
		});

		expect(receipt).toEqual(prerequisiteReceipt);
		expect(verifyTarget).toHaveBeenCalledWith({
			environment,
			requireServiceRole: true
		});
		expect(fetchImpl).toHaveBeenCalledWith(
			`${hostedOperator.HOSTED_STAGING.supabaseUrl}/auth/v1/settings`,
			expect.objectContaining({ cache: 'no-store' })
		);
		expect(JSON.stringify(receipt)).not.toContain(environment.PUBLIC_SUPABASE_PUBLISHABLE_KEY);
	});

	it('creates exactly four actors, completes lifecycle, elevates only moderators, and attests AAL2', async () => {
		const events: string[] = [];
		const adapters = fakeAdapters(events);
		const persistedActorCounts: number[] = [];
		const persistedPendingCounts: number[] = [];
		const receipt = await provisioningApi().executeHostedA9Provisioning({
			environment,
			adapters,
			city: 'Sofia',
			clock: vi
				.fn()
				.mockReturnValueOnce(1_000)
				.mockReturnValueOnce(59_000)
				.mockReturnValueOnce(89_000),
			verifyPrerequisites: vi.fn(async () => {
				events.push('prerequisites');
				return prerequisiteReceipt;
			}),
			persistManifest: vi.fn(async (manifest: { actors: unknown[]; pendingActors: unknown[] }) => {
				persistedActorCounts.push(manifest.actors.length);
				persistedPendingCounts.push(manifest.pendingActors.length);
			})
		});

		expect(events[0]).toBe('prerequisites');
		expect(adapters.assertFreshActorAbsent.mock.calls.map(([input]) => input.role)).toEqual(roles);
		for (const role of roles) {
			expect(events.indexOf(`absent:${role}`)).toBeLessThan(events.indexOf(`create:${role}`));
		}
		expect(adapters.createConfirmedUser.mock.calls.map(([input]) => input.role)).toEqual(roles);
		expect(adapters.inspectRequiredAccessDocuments).toHaveBeenCalledOnce();
		expect(events.filter((event) => event.startsWith('consent:'))).toHaveLength(16);
		expect(persistedActorCounts).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
		expect(persistedPendingCounts).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
		expect(adapters.elevateFreshActorRole.mock.calls.map(([input]) => input.role)).toEqual([
			'assigned-moderator',
			'unassigned-moderator'
		]);
		expect(events.filter((event) => event.startsWith('mfa:'))).toEqual([
			'mfa:assigned-moderator:59000',
			'mfa:unassigned-moderator:89000'
		]);
		expect(receipt).toEqual(
			expect.objectContaining({
				status: 'PASS',
				runId: environment.E2E_REAL_REPORT_EVIDENCE_RUN_ID,
				target: prerequisiteReceipt.target,
				artifacts: { reports: 0, uploads: 0, objects: 0, queueRows: 0 }
			})
		);
		expect((receipt as { actors: unknown[] }).actors).toHaveLength(4);
		expect(
			(receipt as { actors: Array<{ role: string; initialAal?: string; finalAal?: string }> })
				.actors.filter((actor) => actor.role.endsWith('moderator'))
		).toEqual([
			expect.objectContaining({ initialAal: 'aal1', finalAal: 'aal2' }),
			expect.objectContaining({ initialAal: 'aal1', finalAal: 'aal2' })
		]);
		expect(JSON.stringify(receipt)).not.toMatch(/@|password|secret|totp/i);
	});

	it('stops before the first create when any configured actor is already present', async () => {
		const events: string[] = [];
		const adapters = fakeAdapters(events);
		adapters.assertFreshActorAbsent.mockRejectedValueOnce(new Error('existing actor'));

		await expect(
			provisioningApi().executeHostedA9Provisioning({
				environment,
				adapters,
				clock: vi.fn(() => 59_000),
				verifyPrerequisites: vi.fn(async () => prerequisiteReceipt),
				persistManifest: vi.fn()
			})
		).rejects.toThrow('verified rollback');
		expect(adapters.createConfirmedUser).not.toHaveBeenCalled();
		expect(adapters.deleteFreshUser).not.toHaveBeenCalled();
	});

	it('preserves an unconfirmed ambiguous-create rollback signal for the runner ledger', async () => {
		const events: string[] = [];
		const adapters = fakeAdapters(events);
		adapters.createConfirmedUser.mockRejectedValueOnce(
			new hostedOperator.HostedEvidenceOperatorError(
				'A9 actor creation rollback was not confirmed'
			)
		);

		await expect(
			provisioningApi().executeHostedA9Provisioning({
				environment,
				adapters,
				clock: vi.fn(() => 59_000),
				verifyPrerequisites: vi.fn(async () => prerequisiteReceipt),
				persistManifest: vi.fn()
			})
		).rejects.toThrow('A9 provisioning rollback was not confirmed');
	});

	it('compensates enrolled factors and users in reverse order when final attestation fails', async () => {
		const events: string[] = [];
		const adapters = fakeAdapters(events, true);
		let caught: unknown;
		try {
			await provisioningApi().executeHostedA9Provisioning({
				environment,
				adapters,
				city: null,
				clock: vi.fn(() => 59_000),
				verifyPrerequisites: vi.fn(async () => prerequisiteReceipt),
				persistManifest: vi.fn(async () => undefined)
			});
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(hostedOperator.HostedEvidenceOperatorError);
		expect(String(caught)).toContain('verified rollback');
		expect(String(caught)).not.toContain('actor@example.invalid');
		expect(events.filter((event) => event.startsWith('rollback-mfa:'))).toEqual([
			'rollback-mfa:unassigned-moderator',
			'rollback-mfa:assigned-moderator'
		]);
		expect(events.filter((event) => event.startsWith('rollback-user:'))).toEqual([
			'rollback-user:unassigned-moderator',
			'rollback-user:assigned-moderator',
			'rollback-user:cross-user',
			'rollback-user:reporter'
		]);
	});
});
