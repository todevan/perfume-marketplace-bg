import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	HOSTED_STAGING,
	createHostedRunManifest,
	loadHostedRunManifest,
	registerHostedActor,
	validateHostedA9Environment
} from '../../scripts/hosted-report-evidence-operator.mjs';
import {
	runHostedA9Cli,
	runHostedA9Provisioning,
	validateHostedA9RunnerEnvironment
} from '../../scripts/hosted-a9-runner.mjs';

const actorRoles = [
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
const temporaryDirectories: string[] = [];

async function runnerEnvironment() {
	const directory = await mkdtemp(join(tmpdir(), 'hosted-a9-runner-'));
	temporaryDirectories.push(directory);
	return {
		APP_ENV: 'staging',
		E2E_REAL_RUN: 'true',
		E2E_REAL_REPORT_EVIDENCE_RUN: 'true',
		E2E_REAL_REPORT_EVIDENCE_RUN_ID: 'gate3-20260809-0001',
		E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE: '55555555-5555-4555-8555-555555555555',
		E2E_REAL_REPORT_EVIDENCE_PROVISIONED_AFTER: '2026-08-09T11:59:00.000Z',
		E2E_REAL_BASE_URL: HOSTED_STAGING.workerOrigin,
		PUBLIC_SUPABASE_URL: HOSTED_STAGING.supabaseUrl,
		PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only',
		EXPECTED_SUPABASE_PROJECT_REF: HOSTED_STAGING.projectRef,
		SUPABASE_SECRET_KEY: 'server-secret-test-only',
		SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role-test-only',
		SUPABASE_ACCESS_TOKEN: 'management-access-test-only',
		E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_RUN: 'true',
		E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_APPROVAL: 'A9',
		E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH: join(directory, 'run-manifest.json'),
		E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH: join(directory, 'moderator-totp.enc'),
		E2E_REAL_REPORT_EVIDENCE_TOTP_ENCRYPTION_KEY: 'e'.repeat(48),
		E2E_REAL_REPORTER_EMAIL: 'reporter@example.invalid',
		E2E_REAL_REPORTER_PASSWORD: 'reporter-password-test-only',
		E2E_REAL_REPORTER_USERNAME: 'gate3-reporter',
		E2E_REAL_CROSS_USER_EMAIL: 'cross-user@example.invalid',
		E2E_REAL_CROSS_USER_PASSWORD: 'cross-user-password-test-only',
		E2E_REAL_CROSS_USER_USERNAME: 'gate3-cross-user',
		E2E_REAL_ASSIGNED_MODERATOR_EMAIL: 'assigned@example.invalid',
		E2E_REAL_ASSIGNED_MODERATOR_PASSWORD: 'assigned-password-test-only',
		E2E_REAL_ASSIGNED_MODERATOR_USERNAME: 'gate3-assigned',
		E2E_REAL_UNASSIGNED_MODERATOR_EMAIL: 'unassigned@example.invalid',
		E2E_REAL_UNASSIGNED_MODERATOR_PASSWORD: 'unassigned-password-test-only',
		E2E_REAL_UNASSIGNED_MODERATOR_USERNAME: 'gate3-unassigned'
	};
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true })
		)
	);
});

describe('hosted A9 runner', () => {
	it('rejects incomplete, mixed-gate, plaintext-TOTP, and repository-local input before clients exist', async () => {
		const valid = await runnerEnvironment();
		const createClientImpl = vi.fn();
		for (const environment of [
			{ ...valid, SUPABASE_SECRET_KEY: '' },
			{ ...valid, SUPABASE_ACCESS_TOKEN: '' },
			{ ...valid, SUPABASE_SERVICE_ROLE_KEY: '' },
			{ ...valid, PUBLIC_SUPABASE_URL: 'https://example.invalid' },
			{ ...valid, E2E_REAL_REPORT_EVIDENCE_SCENARIO_RUN: 'true' },
			{ ...valid, E2E_REAL_ASSIGNED_MODERATOR_TOTP_SECRET: 'plaintext-is-forbidden' },
			{ ...valid, E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH: resolve('run-manifest.json') },
			{
				...valid,
				E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH: resolve('moderator-totp.enc')
			},
			{ ...valid, E2E_REAL_REPORTER_USERNAME: 'bad username' },
			{ ...valid, E2E_REAL_REPORTER_EMAIL: 'not-an-email' },
			{ ...valid, E2E_REAL_REPORTER_EMAIL: 'bad..dots@example.invalid' },
			{ ...valid, E2E_REAL_REPORT_EVIDENCE_PROVISIONED_AFTER: '2099-01-01T00:00:00.000Z' },
			{ ...valid, E2E_REAL_REPORTER_PASSWORD: 'short' }
		]) {
			await expect(
				runHostedA9Provisioning({ environment, dependencies: { createClientImpl } })
			).rejects.toThrow();
		}
		expect(createClientImpl).not.toHaveBeenCalled();
	});

	it('refuses existing manifest or credential collisions before clients or hosted execution', async () => {
		for (const collision of ['manifest', 'credential'] as const) {
			const environment = await runnerEnvironment();
			const collisionPath =
				collision === 'manifest'
					? environment.E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH
					: environment.E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH;
			await writeFile(collisionPath, 'owner-existing-data', 'utf8');
			const createClientImpl = vi.fn();
			const executeProvisioningImpl = vi.fn();

			await expect(
				runHostedA9Provisioning({
					environment,
					dependencies: { createClientImpl, executeProvisioningImpl }
				})
			).rejects.toThrow();

			expect(createClientImpl).not.toHaveBeenCalled();
			expect(executeProvisioningImpl).not.toHaveBeenCalled();
			expect(await readFile(collisionPath, 'utf8')).toBe('owner-existing-data');
		}
	});

	it('constructs one exact privileged client and fresh non-persistent actor clients', async () => {
		const environment = await runnerEnvironment();
		const clients: Array<{ sequence: number }> = [];
		const createClientImpl = vi.fn(() => {
			const client = { sequence: clients.length + 1 };
			clients.push(client);
			return client;
		});
		const credentialStore = {
			initializeModeratorTotpSecrets: vi.fn(),
			discardAfterVerifiedRollback: vi.fn(),
			storeModeratorTotpSecret: vi.fn(),
			getModeratorTotpSecret: vi.fn(),
			deleteModeratorTotpSecret: vi.fn(),
			purgeModeratorTotpSecrets: vi.fn()
		};
		const createCredentialStoreImpl = vi.fn(() => credentialStore);
		const reserveManifestImpl = vi.fn();
		const actorClients: unknown[] = [];
		const adapters = { exact: 'a9-adapters' };
		const createAdaptersImpl = vi.fn((options: { createActorClient: () => unknown }) => {
			actorClients.push(options.createActorClient(), options.createActorClient());
			return adapters;
		});
		const executeProvisioningImpl = vi.fn(async () => ({
			status: 'PASS',
			runId: environment.E2E_REAL_REPORT_EVIDENCE_RUN_ID,
			target: {
				projectRef: HOSTED_STAGING.projectRef,
				organizationId: HOSTED_STAGING.organizationId,
				region: HOSTED_STAGING.region,
				postgresMajor: 17,
				status: 'ACTIVE_HEALTHY'
			},
			actors: actorRoles.map((role) => ({
				role,
				userId: actorIds[role],
				profileRole: role.endsWith('moderator') ? 'moderator' : 'user',
				membershipStatus: 'active',
				onboardingComplete: true,
				mfaStatus: role.endsWith('moderator') ? 'verified' : 'not-required',
				initialAal: role.endsWith('moderator') ? 'aal1' : null,
				finalAal: role.endsWith('moderator') ? 'aal2' : null
			})),
			artifacts: { reports: 0, uploads: 0, objects: 0, queueRows: 0 }
		}));

		const receipt = await runHostedA9Provisioning({
			environment,
			dependencies: {
				createClientImpl,
				createCredentialStoreImpl,
				createAdaptersImpl,
				executeProvisioningImpl,
				reserveManifestImpl
			}
		});

		expect(createClientImpl).toHaveBeenNthCalledWith(
			1,
			environment.PUBLIC_SUPABASE_URL,
			environment.SUPABASE_SECRET_KEY,
			{ auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } }
		);
		for (const callIndex of [2, 3]) {
			expect(createClientImpl).toHaveBeenNthCalledWith(
				callIndex,
				environment.PUBLIC_SUPABASE_URL,
				environment.PUBLIC_SUPABASE_PUBLISHABLE_KEY,
				{ auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } }
			);
		}
		expect(actorClients[0]).not.toBe(actorClients[1]);
		expect(createCredentialStoreImpl).toHaveBeenCalledWith({
			filePath: environment.E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH,
			encryptionKey: environment.E2E_REAL_REPORT_EVIDENCE_TOTP_ENCRYPTION_KEY,
			projectRef: HOSTED_STAGING.projectRef,
			runId: environment.E2E_REAL_REPORT_EVIDENCE_RUN_ID
		});
		expect(createAdaptersImpl).toHaveBeenCalledWith(
			expect.objectContaining({ credentialSink: credentialStore, serviceClient: clients[0] })
		);
		expect(credentialStore.initializeModeratorTotpSecrets).toHaveBeenCalledOnce();
		expect(reserveManifestImpl).toHaveBeenCalledOnce();
		const reservedManifest = reserveManifestImpl.mock.calls[0][1] as {
			provisioningAttemptId: string;
			credentialStoreId: string;
			pendingActors: unknown[];
		};
		expect(reservedManifest.provisioningAttemptId).toMatch(/^[0-9a-f-]{36}$/u);
		expect(reservedManifest.credentialStoreId).toMatch(/^[a-f0-9]{64}$/u);
		expect(reservedManifest.pendingActors).toEqual([]);
		expect(executeProvisioningImpl).toHaveBeenCalledWith(
			expect.objectContaining({ adapters, environment })
		);
		expect(JSON.stringify(receipt)).not.toMatch(/userId|@|password|secret|credential|totp/i);
	});

	it('binds all four transaction checkpoints to the exact external manifest path atomically', async () => {
		const environment = await runnerEnvironment();
		const config = validateHostedA9Environment(environment);
		const persistedCounts: number[] = [];
		const persistManifestImpl = vi.fn(async (exactConfig, manifest, filePath) => {
			const { persistHostedRunManifest } = await import(
				'../../scripts/hosted-report-evidence-operator.mjs'
			);
			await persistHostedRunManifest(exactConfig, manifest, filePath);
			persistedCounts.push(
				(await loadHostedRunManifest(config, environment.E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH))
					.actors.length
			);
		});
		const executeProvisioningImpl = vi.fn(async ({ persistManifest }) => {
			let manifest = createHostedRunManifest(config);
			for (const role of actorRoles) {
				manifest = registerHostedActor(manifest, role, actorIds[role], createdAt);
				await persistManifest(manifest);
			}
			return {
				status: 'PASS',
				runId: config.runId,
				target: {
					projectRef: HOSTED_STAGING.projectRef,
					region: HOSTED_STAGING.region,
					postgresMajor: 17,
					status: 'ACTIVE_HEALTHY'
				},
				actors: [],
				artifacts: { reports: 0, uploads: 0, objects: 0, queueRows: 0 }
			};
		});

		await runHostedA9Provisioning({
			environment,
			dependencies: {
				createClientImpl: vi.fn(() => ({})),
				createCredentialStoreImpl: vi.fn(() => ({
					initializeModeratorTotpSecrets: vi.fn(),
					discardAfterVerifiedRollback: vi.fn(),
					storeModeratorTotpSecret: vi.fn(),
					deleteModeratorTotpSecret: vi.fn()
				})),
				createAdaptersImpl: vi.fn(() => ({})),
				executeProvisioningImpl,
				reserveManifestImpl: vi.fn(async (exactConfig, manifest, filePath) => {
					const { reserveHostedRunManifest } = await import(
						'../../scripts/hosted-report-evidence-operator.mjs'
					);
					await reserveHostedRunManifest(exactConfig, manifest, filePath);
				}),
				persistManifestImpl
			}
		});

		expect(persistedCounts).toEqual([1, 2, 3, 4]);
		expect(persistManifestImpl.mock.calls.every(([, , path]) => path === environment.E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH)).toBe(true);
		expect(
			(await loadHostedRunManifest(config, environment.E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH)).actors
		).toHaveLength(4);
		expect(
			(await readdir(resolve(environment.E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH, '..'))).filter(
				(name) => name.endsWith('.tmp')
			)
		).toEqual([]);
	});

	it('emits a sanitized receipt and a constant failure message only', async () => {
		const environment = await runnerEnvironment();
		const output = vi.fn();
		const errorOutput = vi.fn();
		const exitCode = await runHostedA9Cli({
			environment,
			dependencies: {
				createClientImpl: vi.fn(() => ({})),
				createCredentialStoreImpl: vi.fn(() => ({
					initializeModeratorTotpSecrets: vi.fn(),
					discardAfterVerifiedRollback: vi.fn(),
					storeModeratorTotpSecret: vi.fn(),
					deleteModeratorTotpSecret: vi.fn()
				})),
				createAdaptersImpl: vi.fn(() => ({})),
				reserveManifestImpl: vi.fn(),
				executeProvisioningImpl: vi.fn(async () => {
					throw new Error(`provider failure ${environment.SUPABASE_SECRET_KEY}`);
				})
			},
			output,
			errorOutput
		});

		expect(exitCode).toBe(1);
		expect(output).not.toHaveBeenCalled();
		expect(errorOutput).toHaveBeenCalledWith('Hosted A9 runner failed safely.');
		expect(JSON.stringify(errorOutput.mock.calls)).not.toContain(environment.SUPABASE_SECRET_KEY);
		expect(JSON.stringify(errorOutput.mock.calls)).not.toContain(
			environment.E2E_REAL_REPORT_EVIDENCE_TOTP_ENCRYPTION_KEY
		);
		await expect(stat(environment.E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH)).rejects.toMatchObject({
			code: 'ENOENT'
		});
	});

	it('removes empty local reservations after the transaction confirms rollback', async () => {
		const environment = await runnerEnvironment();

		await expect(
			runHostedA9Provisioning({
				environment,
				dependencies: {
					createClientImpl: vi.fn(() => ({})),
					createAdaptersImpl: vi.fn(() => ({})),
					executeProvisioningImpl: vi.fn(async () => {
						throw new Error('A9 provisioning failed after verified rollback');
					})
				}
			})
		).rejects.toThrow('verified rollback');
		for (const path of [
			environment.E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH,
			environment.E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH
		]) {
			await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
		}
	});

	it('preserves the manifest when verified-rollback credential cleanup is not confirmed', async () => {
		const environment = await runnerEnvironment();
		const credentialStore = {
			initializeModeratorTotpSecrets: vi.fn(),
			discardAfterVerifiedRollback: vi.fn().mockRejectedValue(new Error('private path detail')),
			storeModeratorTotpSecret: vi.fn(),
			deleteModeratorTotpSecret: vi.fn()
		};

		await expect(
			runHostedA9Provisioning({
				environment,
				dependencies: {
					createClientImpl: vi.fn(() => ({})),
					createCredentialStoreImpl: vi.fn(() => credentialStore),
					createAdaptersImpl: vi.fn(() => ({})),
					executeProvisioningImpl: vi.fn(async () => {
						throw new Error('A9 provisioning failed after verified rollback');
					})
				}
			})
		).rejects.toThrow('verified rollback');
		await expect(stat(environment.E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH)).resolves.toBeDefined();
	});

	it('exposes the exact runner contract without revealing its values', async () => {
		const environment = await runnerEnvironment();
		const contract = validateHostedA9RunnerEnvironment(environment);

		expect(contract.config.target).toBe(HOSTED_STAGING);
		expect(contract.manifestPath).toBe(environment.E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH);
		expect(contract.credentialStore.filePath).toBe(
			environment.E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH
		);
		expect(JSON.stringify(Object.keys(contract))).not.toContain(environment.SUPABASE_SECRET_KEY);
		expect(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).toContain(
			'"a9:staging:provision"'
		);
	});
});
