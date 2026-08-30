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
const issue24Roles = [
	'reporter',
	'cross-user',
	'aal1-staff',
	'assigned-moderator',
	'unassigned-moderator',
	'unassigned-admin'
] as const;
const issue24Ids = Object.fromEntries(
	issue24Roles.map((role, index) => [
		role,
		`${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000000`
	])
) as Record<(typeof issue24Roles)[number], string>;
const issue24Environment = {
	...environment,
	E2E_REAL_REPORT_EVIDENCE_RUN_ID: 'issue24-20260831-abcdef0',
	E2E_REAL_BASE_URL:
		'https://aromatika-issue-24-20260831-abcdef0-aaaaaaa.perfume-marketplace-bg.workers.dev',
	PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
	EXPECTED_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
	E2E_REAL_ISSUE_24_RUN: 'true',
	E2E_REAL_ISSUE_24_APPROVAL: 'ISSUE-24',
	E2E_REAL_ISSUE_24_ORGANIZATION_ID: hostedOperator.HOSTED_STAGING.organizationId,
	E2E_REAL_ISSUE_24_REGION: 'eu-central-1',
	E2E_REAL_ISSUE_24_WORKER_NAME: 'aromatika-issue-24-20260831-abcdef0-aaaaaaa',
	E2E_REAL_ISSUE_24_CANDIDATE_SHA: 'a'.repeat(40),
	RELEASE_COMMIT_SHA: 'a'.repeat(40),
	E2E_REAL_AAL1_STAFF_EMAIL: 'aal1-staff@example.invalid',
	E2E_REAL_AAL1_STAFF_PASSWORD: 'aal1-staff-password',
	E2E_REAL_AAL1_STAFF_USERNAME: 'issue24-aal1',
	E2E_REAL_UNASSIGNED_ADMIN_EMAIL: 'unassigned-admin@example.invalid',
	E2E_REAL_UNASSIGNED_ADMIN_PASSWORD: 'unassigned-admin-password',
	E2E_REAL_UNASSIGNED_ADMIN_USERNAME: 'issue24-admin'
};
const issue24PrerequisiteReceipt = {
	...prerequisiteReceipt,
	target: {
		...prerequisiteReceipt.target,
		projectRef: issue24Environment.EXPECTED_SUPABASE_PROJECT_REF,
		region: issue24Environment.E2E_REAL_ISSUE_24_REGION
	}
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

function issue24FakeAdapters(events: string[]) {
	return {
		inspectRequiredAccessDocuments: vi.fn(async () => requiredConsents),
		assertFreshActorAbsent: vi.fn(async ({ role }: { role: string }) => ({ role, absent: true })),
		createConfirmedUser: vi.fn(async ({ role }: { role: (typeof issue24Roles)[number] }) => ({
			role,
			userId: issue24Ids[role],
			createdAt,
			emailConfirmed: true
		})),
		createActorSession: vi.fn(async ({ role }: { role: (typeof issue24Roles)[number] }) => ({
			claimOpenRegistration: vi.fn(),
			acceptBetaConsent: vi.fn(),
			completeBetaOnboarding: vi.fn(),
			getMyBetaAccess: vi.fn(),
			mfa: {
				enrollAndVerify: vi.fn(async () => {
					events.push(`mfa:${role}`);
					return {
						factorId: `factor-${role}`,
						factorType: 'totp',
						factorStatus: 'verified',
						initialAal: 'aal1',
						finalAal: 'aal2'
					};
				}),
				rollbackEnrollment: vi.fn()
			}
		})),
		elevateFreshActorRole: vi.fn(async ({ role, toRole }: { role: string; toRole: string }) => {
			events.push(`elevate:${role}:${toRole}`);
		}),
		inspectFreshActor: vi.fn(async ({ role }: { role: (typeof issue24Roles)[number] }) => ({
			role,
			userId: issue24Ids[role],
			emailConfirmed: true,
			profileRole:
				role === 'unassigned-admin'
					? 'admin'
					: role === 'reporter' || role === 'cross-user'
						? 'user'
						: 'moderator',
			isSuspended: false,
			membershipStatus: 'active',
			onboardingComplete: true
		})),
		inspectZeroA9Artifacts: vi.fn(async () => ({
			reports: 0,
			uploads: 0,
			objects: 0,
			queueRows: 0
		})),
		deleteFreshUser: vi.fn()
	};
}

describe('executable A9-only provisioning transaction', () => {
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

	it('re-verifies the disposable Issue #24 project through the management API before provisioning', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
					id: issue24Environment.EXPECTED_SUPABASE_PROJECT_REF,
					organization_id: hostedOperator.HOSTED_STAGING.organizationId,
					region: 'eu-central-1',
					status: 'ACTIVE_HEALTHY',
					database: { postgres_engine: '17' }
				})
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
					disable_signup: false,
					mailer_autoconfirm: false,
					external: { anonymous_users: false }
				})
			});

		const receipt = await provisioningApi().verifyHostedA9Prerequisites({
			environment: { ...issue24Environment, SUPABASE_ACCESS_TOKEN: 'management-token' },
			dependencies: { fetchImpl }
		});

		expect(receipt).toEqual(issue24PrerequisiteReceipt);
		expect(fetchImpl).toHaveBeenNthCalledWith(
			1,
			`https://api.supabase.com/v1/projects/${issue24Environment.EXPECTED_SUPABASE_PROJECT_REF}`,
			expect.objectContaining({ cache: 'no-store' })
		);
	});

	it('provisions the six Issue #24 actors with one AAL1 staff actor and three real AAL2 staff sessions', async () => {
		const events: string[] = [];
		const adapters = issue24FakeAdapters(events);

		const receipt = await provisioningApi().executeHostedA9Provisioning({
			environment: issue24Environment,
			adapters,
			clock: vi.fn(() => 59_000),
			verifyPrerequisites: vi.fn(async () => issue24PrerequisiteReceipt),
			persistManifest: vi.fn()
		});

		expect(adapters.createConfirmedUser.mock.calls.map(([input]) => input.role)).toEqual(
			issue24Roles
		);
		expect(events.filter((event) => event.startsWith('elevate:'))).toEqual([
			'elevate:aal1-staff:moderator',
			'elevate:assigned-moderator:moderator',
			'elevate:unassigned-moderator:moderator',
			'elevate:unassigned-admin:admin'
		]);
		expect(events.filter((event) => event.startsWith('mfa:'))).toEqual([
			'mfa:assigned-moderator',
			'mfa:unassigned-moderator',
			'mfa:unassigned-admin'
		]);
		expect((receipt as { actors: unknown[] }).actors).toHaveLength(6);
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
