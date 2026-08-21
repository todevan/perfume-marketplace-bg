import { describe, expect, it, vi } from 'vitest';
import * as hostedOperator from '../../scripts/hosted-report-evidence-operator.mjs';

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

describe('executable A9-only provisioning transaction', () => {
	it('exposes narrow exact-role A9 operations without changing the compatibility transaction', async () => {
		const config = hostedOperator.validateHostedA9Environment(environment);
		const manifest = hostedOperator.createHostedRunManifest(config);
		const events: string[] = [];
		const session = {
			claimOpenRegistration: vi.fn(async () => events.push('registration')),
			acceptBetaConsent: vi.fn(async ({ documentCode }: { documentCode: string }) =>
				events.push(`consent:${documentCode}`)
			),
			completeBetaOnboarding: vi.fn(async () => events.push('onboarding')),
			mfa: {
				enroll: vi.fn(async () => ({ factorId: 'factor-exact', factorType: 'totp' })),
				challengeAndVerify: vi.fn(async ({ code }: { code: string }) => {
					events.push(`verify:${code}`);
					return { verified: true };
				}),
				rollbackEnrollment: vi.fn(async () => events.push('unenroll'))
			}
		};
		const adapters = {
			assertFreshActorAbsent: vi.fn(async ({ role }: { role: string }) => ({ role, absent: true })),
			createConfirmedUser: vi.fn(async ({ manifest: exactManifest, role }: { manifest: { pendingActors: unknown[] }; role: string }) => {
				expect(exactManifest.pendingActors).toHaveLength(1);
				return { role, userId: actorIds.reporter, createdAt, emailConfirmed: true };
			}),
			lookupConfirmedUser: vi.fn(async ({ role }: { role: string }) => ({ role, userId: actorIds.reporter, createdAt, emailConfirmed: true })),
			createActorSession: vi.fn(async () => session),
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
		await operations.enrollMfa({ manifest: moderatorManifest, role: 'assigned-moderator' });
		await operations.verifyMfa({
			manifest: moderatorManifest,
			role: 'assigned-moderator',
			factorId: 'factor-exact',
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
