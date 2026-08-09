import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	HOSTED_STAGING,
	HostedEvidenceOperatorError,
	assertServiceRoleOperation,
	assertSanitizedHostedErrorBody,
	assertSyntheticAccountAllowed,
	cleanupHostedManifestFile,
	cleanupHostedRun,
	createHostedEvidenceOperator,
	createHostedRunManifest,
	createSanitizedOperatorRecord,
	createSupabaseHostedEvidenceAdapters,
	loadHostedRunManifest,
	persistHostedRunManifest,
	registerHostedActor,
	registerHostedReport,
	registerHostedUpload,
	validateHostedCleanupEnvironment,
	validateHostedProvisionEnvironment,
	validateHostedOperatorEnvironment
} from '../../scripts/hosted-report-evidence-operator.mjs';

const runId = 'gate3-20260809-0001';
const actorCreatedAt = '2026-08-09T12:00:00.000Z';
const actorEnvironment = {
	E2E_REAL_REPORTER_EMAIL: 'reporter@example.invalid',
	E2E_REAL_REPORTER_PASSWORD: 'reporter-password',
	E2E_REAL_REPORTER_USERNAME: 'gate3-reporter',
	E2E_REAL_CROSS_USER_EMAIL: 'cross-user@example.invalid',
	E2E_REAL_CROSS_USER_PASSWORD: 'cross-user-password',
	E2E_REAL_CROSS_USER_USERNAME: 'gate3-cross-user',
	E2E_REAL_ASSIGNED_MODERATOR_EMAIL: 'assigned@example.invalid',
	E2E_REAL_ASSIGNED_MODERATOR_PASSWORD: 'assigned-password',
	E2E_REAL_ASSIGNED_MODERATOR_USERNAME: 'gate3-assigned',
	E2E_REAL_ASSIGNED_MODERATOR_TOTP_SECRET: 'ASSIGNEDTOTPSECRET',
	E2E_REAL_UNASSIGNED_MODERATOR_EMAIL: 'unassigned@example.invalid',
	E2E_REAL_UNASSIGNED_MODERATOR_PASSWORD: 'unassigned-password',
	E2E_REAL_UNASSIGNED_MODERATOR_USERNAME: 'gate3-unassigned',
	E2E_REAL_UNASSIGNED_MODERATOR_TOTP_SECRET: 'UNASSIGNEDTOTPSECRET'
};

const baseEnvironment = {
	APP_ENV: 'staging',
	E2E_REAL_RUN: 'true',
	E2E_REAL_REPORT_EVIDENCE_RUN: 'true',
	E2E_REAL_REPORT_EVIDENCE_RUN_ID: runId,
	E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE: '55555555-5555-4555-8555-555555555555',
	E2E_REAL_REPORT_EVIDENCE_PROVISIONED_AFTER: '2026-08-09T11:59:00.000Z',
	E2E_REAL_BASE_URL: HOSTED_STAGING.workerOrigin,
	PUBLIC_SUPABASE_URL: HOSTED_STAGING.supabaseUrl,
	EXPECTED_SUPABASE_PROJECT_REF: HOSTED_STAGING.projectRef,
	SUPABASE_SECRET_KEY: 'server-secret-value',
	...actorEnvironment
};
const approvedCleanupEnvironment = {
	...baseEnvironment,
	E2E_REAL_REPORT_EVIDENCE_CLEANUP_RUN: 'true',
	E2E_REAL_REPORT_EVIDENCE_CLEANUP_APPROVAL: 'A11'
};
const approvedProvisionEnvironment = {
	...baseEnvironment,
	E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_RUN: 'true',
	E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_APPROVAL: 'A9'
};

function reporterManifest(config: ReturnType<typeof validateHostedOperatorEnvironment>) {
	return registerHostedActor(
		createHostedRunManifest(config),
		'reporter',
		'11111111-1111-4111-8111-111111111111',
		actorCreatedAt
	);
}

function cleanInventory(overrides: Record<string, number> = {}) {
	return {
		accounts: 0,
		reports: 0,
		uploads: 0,
		objects: 0,
		queueRows: 0,
		foreignArtifacts: 0,
		preExistingAccounts: 0,
		...overrides
	};
}

function provisionedUser(
	role: 'reporter' | 'cross-user' | 'assigned-moderator' | 'unassigned-moderator',
	userId: string
) {
	const emailNames = {
		reporter: 'E2E_REAL_REPORTER_EMAIL',
		'cross-user': 'E2E_REAL_CROSS_USER_EMAIL',
		'assigned-moderator': 'E2E_REAL_ASSIGNED_MODERATOR_EMAIL',
		'unassigned-moderator': 'E2E_REAL_UNASSIGNED_MODERATOR_EMAIL'
	} as const;
	return {
		id: userId,
		email: actorEnvironment[emailNames[role]],
		created_at: actorCreatedAt,
		user_metadata: {
			gate3_report_evidence_run_id: runId,
			gate3_report_evidence_provisioning_nonce:
				baseEnvironment.E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE
		}
	};
}

describe('hosted report-evidence target lock', () => {
	it('accepts only the exact Frankfurt project, URL, and Worker origin', () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		expect(config.target).toEqual(HOSTED_STAGING);
		expect(config.runId).toBe(runId);

		for (const environment of [
			{
				...baseEnvironment,
				EXPECTED_SUPABASE_PROJECT_REF: 'zllqwlekadiuyejgbuxc'
			},
			{
				...baseEnvironment,
				PUBLIC_SUPABASE_URL: 'https://zllqwlekadiuyejgbuxc.supabase.co'
			},
			{ ...baseEnvironment, E2E_REAL_BASE_URL: 'https://example.invalid' }
		]) {
			expect(() => validateHostedOperatorEnvironment(environment)).toThrow(
				HostedEvidenceOperatorError
			);
		}
	});

	it.each([
		['APP_ENV', 'development'],
		['E2E_REAL_RUN', 'false'],
		['E2E_REAL_REPORT_EVIDENCE_RUN', 'false']
	])('requires the explicit %s mutation gate', (name, value) => {
		expect(() =>
			validateHostedOperatorEnvironment({ ...baseEnvironment, [name]: value })
		).toThrow(/hosted report-evidence operator is disabled/u);
	});

	it('rejects accounts outside the configured synthetic allow-list without echoing them', () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const unknownAccount = 'not-allowed@example.invalid';
		let caught: unknown;
		try {
			assertSyntheticAccountAllowed(config, unknownAccount);
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(HostedEvidenceOperatorError);
		expect(String(caught)).not.toContain(unknownAccount);
		expect(assertSyntheticAccountAllowed(config, actorEnvironment.E2E_REAL_REPORTER_EMAIL)).toBe(
			'reporter'
		);
	});

	it('allows service-role access only for provision, inspect, and cleanup', () => {
		for (const operation of ['provision', 'inspect', 'cleanup'] as const) {
			expect(assertServiceRoleOperation(operation)).toBe(operation);
		}
		for (const forbidden of ['access-assertion', 'download-evidence', 'moderator-read']) {
			expect(() => assertServiceRoleOperation(forbidden)).toThrow(
				/service role cannot perform access assertions/u
			);
		}
	});

	it('creates a fresh actor only through the A9-gated target-locked operator', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const userId = '11111111-1111-4111-8111-111111111111';
		const createUser = vi.fn().mockResolvedValue({
			data: { user: provisionedUser('reporter', userId) },
			error: null
		});
		const adapters = createSupabaseHostedEvidenceAdapters({
			config,
			serviceClient: { auth: { admin: { createUser } } } as never,
			managementAccessToken: 'management-token',
			cleanupSecret: 'x'.repeat(32),
			fetchImpl: vi.fn() as never
		});
		const operator = createHostedEvidenceOperator({ config, adapters });

		expect(() => validateHostedProvisionEnvironment(baseEnvironment)).toThrow(
			/A9 account-provisioning gate is disabled/u
		);
		await expect(operator.provisionFreshActor('reporter', baseEnvironment)).rejects.toThrow(
			/A9 account-provisioning gate is disabled/u
		);
		expect(createUser).not.toHaveBeenCalled();
		await expect(
			operator.provisionFreshActor('reporter', approvedProvisionEnvironment)
		).resolves.toEqual({ role: 'reporter', userId, createdAt: actorCreatedAt });
		expect(createUser).toHaveBeenCalledWith(
			expect.objectContaining({
				email_confirm: true,
				user_metadata: expect.objectContaining({
					gate3_report_evidence_run_id: runId,
					gate3_report_evidence_provisioning_nonce:
						baseEnvironment.E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE
				})
			})
		);
	});
});

describe('hosted report-evidence audit and cleanup safety', () => {
	it('emits only role, run ID, event, status, and aggregate counts', () => {
		const record = createSanitizedOperatorRecord({
			event: 'cleanup_verified',
			runId,
			actorRole: 'reporter',
			status: 'PASS',
			boundary: 'operator',
			actualResult: 'zero residual artifacts',
			requestId: 'not-exposed',
			before: cleanInventory({ reports: 1, objects: 1 }),
			after: cleanInventory(),
			cleanup: 'verified',
			email: actorEnvironment.E2E_REAL_REPORTER_EMAIL,
			password: actorEnvironment.E2E_REAL_REPORTER_PASSWORD,
			totpSecret: actorEnvironment.E2E_REAL_ASSIGNED_MODERATOR_TOTP_SECRET,
			objectPath: `${runId}/private-object.webp`
		});
		const serialized = JSON.stringify(record);

		expect(record).toEqual({
			event: 'cleanup_verified',
			runId,
			actorRole: 'reporter',
			status: 'PASS',
			boundary: 'operator',
			actualResult: 'zero residual artifacts',
			requestId: 'not-exposed',
			before: cleanInventory({ reports: 1, objects: 1 }),
			after: cleanInventory(),
			cleanup: 'verified'
		});
		expect(serialized).not.toContain('@');
		expect(serialized).not.toContain('password');
		expect(serialized).not.toContain('TOTP');
		expect(serialized).not.toContain('private-object');
	});

	it('rejects private data smuggled through an allowed receipt field', () => {
		for (const unsafe of [
			actorEnvironment.E2E_REAL_REPORTER_EMAIL,
			`${runId}/private-object.webp`,
			actorEnvironment.E2E_REAL_REPORTER_PASSWORD
		]) {
			expect(() =>
				createSanitizedOperatorRecord({
					event: unsafe,
					runId,
					actorRole: 'reporter',
					status: 'PASS',
					boundary: 'operator',
					actualResult: 'verified',
					requestId: 'not-exposed',
					before: cleanInventory(),
					after: cleanInventory(),
					cleanup: 'none'
				})
			).toThrow(HostedEvidenceOperatorError);
		}
	});

	it('rejects malformed-response bodies that expose provider or private details', () => {
		const expected = 'Заявката за сигнал е невалидна.';
		expect(assertSanitizedHostedErrorBody(`{"error":"${expected}"}`, expected, [])).toBe(true);
		for (const body of [
			'{"error":"Supabase Storage rejected private/path.webp"}',
			'{"error":"Bearer credential leaked"}',
			`{"error":"${expected} reporter@example.invalid"}`,
			`{"error":"${expected} 11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.webp"}`,
			`{"error":"${expected} submitted-private-detail"}`,
			'x'.repeat(8193)
		]) {
			expect(() =>
				assertSanitizedHostedErrorBody(body, expected, ['submitted-private-detail'])
			).toThrow(
				/hosted error response is not sanitized/u
			);
		}
	});

	it('tracks exact run artifacts and rejects unregistered or pre-existing coordinates', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		let manifest = createHostedRunManifest(config);
		const reporterId = '11111111-1111-4111-8111-111111111111';
		const reportId = '22222222-2222-4222-8222-222222222222';
		const uploadId = '33333333-3333-4333-8333-333333333333';
		manifest = registerHostedActor(manifest, 'reporter', reporterId, actorCreatedAt);
		manifest = registerHostedReport(manifest, reportId, 'reporter');
		manifest = registerHostedUpload(
			manifest,
			uploadId,
			'reporter',
			`${reporterId}/${uploadId}.webp`
		);

		const backdateExactUpload = vi.fn().mockResolvedValue(undefined);
		const operator = createHostedEvidenceOperator({
			config,
			adapters: {
				inspectManifest: vi.fn().mockResolvedValue(cleanInventory({ accounts: 1, reports: 1, uploads: 1 })),
				backdateExactUpload,
				removeManifest: vi.fn()
			}
		});
		await expect(operator.backdateAbandonedUpload(manifest, uploadId)).resolves.toBeUndefined();
		expect(backdateExactUpload).toHaveBeenCalledWith(
			expect.objectContaining({ projectRef: HOSTED_STAGING.projectRef, uploadId })
		);
		await expect(
			operator.backdateAbandonedUpload(manifest, '44444444-4444-4444-8444-444444444444')
		).rejects.toThrow(/outside the exact run manifest/u);
		expect(backdateExactUpload).toHaveBeenCalledOnce();
		expect(() => registerHostedActor(manifest, 'cross-user', reporterId, actorCreatedAt)).toThrow(
			/actor is already present/u
		);
	});

	it('counts processed cleanup rows until the exact run removes them', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const reporterId = '11111111-1111-4111-8111-111111111111';
		const reportId = '22222222-2222-4222-8222-222222222222';
		const uploadId = '33333333-3333-4333-8333-333333333333';
		const objectPath = `${reporterId}/${uploadId}.webp`;
		let manifest = registerHostedActor(
			createHostedRunManifest(config),
			'reporter',
			reporterId,
			actorCreatedAt
		);
		manifest = registerHostedReport(manifest, reportId, 'reporter');
		manifest = registerHostedUpload(manifest, uploadId, 'reporter', objectPath);
		const rows = {
			reports: [{ id: reportId, reporter_id: reporterId }],
			report_evidence_uploads: [
				{ id: uploadId, uploader_id: reporterId, storage_path: objectPath }
			],
			upload_cleanup_queue: [
				{ id: 7, storage_path: objectPath, processed_at: '2026-08-09T00:00:00Z' }
			]
		};
		const serviceClient = {
			auth: {
				admin: {
					getUserById: vi.fn().mockResolvedValue({
						data: { user: provisionedUser('reporter', reporterId) },
						error: null
					})
				}
			},
			from(table: keyof typeof rows) {
				const query = {
					select: () => query,
					in: () => Promise.resolve({ data: rows[table], error: null })
				};
				return query;
			},
			storage: {
				from: () => ({
					list: vi.fn().mockResolvedValue({
						data: [{ name: `${uploadId}.webp` }],
						error: null
					})
				})
			}
		};
		const adapters = createSupabaseHostedEvidenceAdapters({
			config,
			serviceClient: serviceClient as never,
			managementAccessToken: 'management-token',
			cleanupSecret: 'x'.repeat(32),
			fetchImpl: vi.fn() as never
		});

		await expect(
			createHostedEvidenceOperator({ config, adapters }).inspect(manifest)
		).resolves.toMatchObject({ queueRows: 1, foreignArtifacts: 0 });
	});

	it('removes only exact-manifest cleanup rows after object and account cleanup', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const reporterId = '11111111-1111-4111-8111-111111111111';
		const uploadId = '33333333-3333-4333-8333-333333333333';
		const objectPath = `${reporterId}/${uploadId}.webp`;
		let manifest = registerHostedActor(
			createHostedRunManifest(config),
			'reporter',
			reporterId,
			actorCreatedAt
		);
		manifest = registerHostedUpload(manifest, uploadId, 'reporter', objectPath);
		const serviceClient = {
			auth: {
				admin: {
					getUserById: vi.fn().mockResolvedValue({
						data: { user: provisionedUser('reporter', reporterId) },
						error: null
					}),
					deleteUser: vi.fn().mockResolvedValue({ error: null })
				}
			},
			from(table: string) {
				const query = {
					delete: () => query,
					select: () => query,
					in: () =>
						Promise.resolve({
							data:
								table === 'report_evidence_uploads'
									? [
										{
											id: uploadId,
											uploader_id: reporterId,
											storage_path: objectPath,
											status: 'expired'
										}
									]
									: [],
							error: null
						})
				};
				return query;
			},
			rpc: vi.fn(),
			storage: {
				from: () => ({
					list: vi.fn().mockResolvedValue({
						data: [{ name: `${uploadId}.webp` }],
						error: null
					})
				})
			}
		};
		const requestId = '44444444-4444-4444-8444-444444444444';
		const fetchImpl = vi.fn(async (url: URL | string, init?: RequestInit) => {
			if (String(url).includes('/database/query')) {
				return {
					ok: true,
					json: async () => [{ id: 7, storage_path: objectPath }]
				};
			}
			return { status: 202, json: async () => ({ requestId }) };
		});
		const adapters = createSupabaseHostedEvidenceAdapters({
			config,
			serviceClient: serviceClient as never,
			managementAccessToken: 'management-token',
			cleanupSecret: 'x'.repeat(32),
			fetchImpl: fetchImpl as never
		});

		await createHostedEvidenceOperator({ config, adapters }).remove(manifest);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		const queueDeletion = fetchImpl.mock.calls.find(([url]) =>
			String(url).includes('/database/query')
		);
		expect(queueDeletion).toBeDefined();
		const body = JSON.parse(String(queueDeletion?.[1]?.body)) as { query: string };
		expect(body.query).toContain('delete from public.upload_cleanup_queue');
		expect(body.query).toContain(objectPath);
		expect(body.query).not.toContain('delete from auth.users');
	});

	it('treats a verified missing Auth actor as already cleaned on an A11 retry', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = reporterManifest(config);
		const deleteUser = vi.fn();
		const serviceClient = {
			auth: {
				admin: {
					getUserById: vi.fn().mockResolvedValue({
						data: { user: null },
						error: { status: 404 }
					}),
					deleteUser
				}
			},
			from() {
				const query = {
					delete: () => query,
					select: () => query,
					in: () => Promise.resolve({ data: [], error: null })
				};
				return query;
			},
			storage: {
				from: () => ({ list: vi.fn().mockResolvedValue({ data: [], error: null }) })
			}
		};
		const fetchImpl = vi.fn().mockResolvedValue({
			status: 202,
			json: async () => ({ requestId: '44444444-4444-4444-8444-444444444444' })
		});
		const adapters = createSupabaseHostedEvidenceAdapters({
			config,
			serviceClient: serviceClient as never,
			managementAccessToken: 'management-token',
			cleanupSecret: 'x'.repeat(32),
			fetchImpl: fetchImpl as never
		});
		const operator = createHostedEvidenceOperator({ config, adapters });

		await expect(operator.inspect(manifest)).resolves.toMatchObject({ accounts: 0 });
		await expect(operator.remove(manifest)).resolves.toBeUndefined();
		expect(deleteUser).not.toHaveBeenCalled();
	});

	it('refuses a self-asserted run actor without matching authoritative Auth provenance', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = reporterManifest(config);
		const deleteUser = vi.fn();
		const serviceClient = {
			auth: {
				admin: {
					getUserById: vi.fn().mockResolvedValue({
						data: {
							user: {
								id: manifest.actors[0].userId,
								email: actorEnvironment.E2E_REAL_CROSS_USER_EMAIL,
								created_at: actorCreatedAt,
								user_metadata: {}
							}
						},
						error: null
					}),
					deleteUser
				}
			},
			from() {
				const query = {
					select: () => query,
					in: () => Promise.resolve({ data: [], error: null })
				};
				return query;
			},
			storage: {
				from: () => ({ list: vi.fn().mockResolvedValue({ data: [], error: null }) })
			}
		};
		const adapters = createSupabaseHostedEvidenceAdapters({
			config,
			serviceClient: serviceClient as never,
			managementAccessToken: 'management-token',
			cleanupSecret: 'x'.repeat(32),
			fetchImpl: vi.fn() as never
		});

		await expect(
			createHostedEvidenceOperator({ config, adapters }).inspect(manifest)
		).rejects.toThrow(/cleanup scope is not isolated|provenance/u);
		expect(deleteUser).not.toHaveBeenCalled();
	});

	it('rejects a forged manifest report coordinate before any privileged mutation', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const reporterId = '11111111-1111-4111-8111-111111111111';
		const foreignReportId = '22222222-2222-4222-8222-222222222222';
		let manifest = registerHostedActor(
			createHostedRunManifest(config),
			'reporter',
			reporterId,
			actorCreatedAt
		);
		manifest = registerHostedReport(manifest, foreignReportId, 'reporter');
		const deleteCalls = vi.fn();
		const deleteUser = vi.fn();
		const serviceClient = {
			auth: {
				admin: {
					getUserById: vi.fn().mockResolvedValue({
						data: { user: provisionedUser('reporter', reporterId) },
						error: null
					}),
					deleteUser
				}
			},
			from() {
				let deleting = false;
				const query = {
					select: () => query,
					delete: () => {
						deleting = true;
						return query;
					},
					in: () => {
						if (deleting) deleteCalls();
						return Promise.resolve({ data: [], error: null });
					}
				};
				return query;
			},
			storage: {
				from: () => ({ list: vi.fn().mockResolvedValue({ data: [], error: null }) })
			},
			rpc: vi.fn()
		};
		const adapters = createSupabaseHostedEvidenceAdapters({
			config,
			serviceClient: serviceClient as never,
			managementAccessToken: 'management-token',
			cleanupSecret: 'x'.repeat(32),
			fetchImpl: vi.fn().mockResolvedValue({
				status: 202,
				json: async () => ({ requestId: '44444444-4444-4444-8444-444444444444' })
			}) as never
		});
		const operator = createHostedEvidenceOperator({ config, adapters });

		await expect(operator.inspect(manifest)).rejects.toThrow(/cleanup scope is not isolated/u);
		await expect(operator.remove(manifest)).rejects.toThrow(/cleanup scope is not isolated/u);
		expect(deleteCalls).not.toHaveBeenCalled();
		expect(serviceClient.rpc).not.toHaveBeenCalled();
		expect(deleteUser).not.toHaveBeenCalled();
	});

	it('keeps the destructive cleanup entrypoint disabled without the explicit A11 gate', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		let manifest = createHostedRunManifest(config);
		manifest = registerHostedActor(
			manifest,
			'reporter',
			'11111111-1111-4111-8111-111111111111',
			actorCreatedAt
		);
		const removeScopedArtifacts = vi.fn();
		await expect(
			cleanupHostedRun({
				config,
				manifest,
				environment: baseEnvironment,
				inspectScopedArtifacts: vi.fn().mockResolvedValue(cleanInventory({ accounts: 1 })),
				removeScopedArtifacts,
				logger: { info: vi.fn() }
			})
		).rejects.toThrow(/A11 cleanup gate is disabled/u);
		expect(removeScopedArtifacts).not.toHaveBeenCalled();
		expect(() =>
			validateHostedCleanupEnvironment({
				...baseEnvironment,
				E2E_REAL_REPORT_EVIDENCE_CLEANUP_RUN: 'true',
				E2E_REAL_REPORT_EVIDENCE_CLEANUP_APPROVAL: 'not-A11'
			})
		).toThrow(/A11 cleanup gate is disabled/u);
	});

	it('hands an exact private manifest from A10 to the separately gated A11 entrypoint', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = reporterManifest(config);
		const directory = await mkdtemp(join(tmpdir(), 'gate3-manifest-'));
		const manifestPath = join(directory, 'run.json');
		const inspect = vi
			.fn()
			.mockResolvedValueOnce(cleanInventory({ accounts: 1 }))
			.mockResolvedValueOnce(cleanInventory());
		const remove = vi.fn().mockResolvedValue(undefined);
		try {
			await persistHostedRunManifest(config, manifest, manifestPath);
			await expect(loadHostedRunManifest(config, manifestPath)).resolves.toEqual(manifest);
			await expect(
				cleanupHostedManifestFile({
					config,
					environment: baseEnvironment,
					manifestPath,
					operator: { inspect, remove },
					logger: { info: vi.fn() }
				})
			).rejects.toThrow(/A11 cleanup gate is disabled/u);
			expect(remove).not.toHaveBeenCalled();
			await expect(loadHostedRunManifest(config, manifestPath)).resolves.toEqual(manifest);

			await expect(
				cleanupHostedManifestFile({
					config,
					environment: approvedCleanupEnvironment,
					manifestPath,
					operator: { inspect, remove },
					logger: { info: vi.fn() }
				})
			).resolves.toEqual({ cleaned: true, counts: cleanInventory() });
			expect(remove).toHaveBeenCalledOnce();
			await expect(loadHostedRunManifest(config, manifestPath)).rejects.toThrow(
				/hosted run manifest is unavailable/u
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('keeps A10 scenario execution separate from the A11 manifest cleanup test', async () => {
		const hostedSpec = await readFile(
			new URL('../e2e/hosted-report-evidence.spec.ts', import.meta.url),
			'utf8'
		);

		expect(hostedSpec).toContain('persistHostedRunManifest');
		expect(hostedSpec).toContain('cleanupHostedManifestFile');
		expect(hostedSpec).toContain("test('cleans only the persisted A10 manifest under A11'");
		expect(hostedSpec).toContain('test.skip(!HOSTED_SCENARIO_ENABLED');
		expect(hostedSpec).toContain('test.skip(!HOSTED_CLEANUP_ENABLED');
		expect(hostedSpec).toContain('const HOSTED_CLEANUP_REQUESTED');
		expect(hostedSpec).toContain(
			'HOSTED_SCENARIO_ENABLED = HOSTED_RUN_ENABLED && !HOSTED_CLEANUP_REQUESTED'
		);
		expect(hostedSpec).not.toContain('await cleanupHostedRun({');
	});

	it('refuses cleanup when scope includes a pre-existing account or foreign artifact', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = reporterManifest(config);
		const removeScopedArtifacts = vi.fn();

		for (const inventory of [
			cleanInventory({ preExistingAccounts: 1 }),
			cleanInventory({ foreignArtifacts: 1 })
		]) {
			await expect(
				cleanupHostedRun({
					config,
					manifest,
					environment: approvedCleanupEnvironment,
					inspectScopedArtifacts: vi.fn().mockResolvedValue(inventory),
					removeScopedArtifacts,
					logger: { info: vi.fn() }
				})
			).rejects.toThrow(/cleanup scope is not isolated/u);
		}
		expect(removeScopedArtifacts).not.toHaveBeenCalled();
	});

	it('is idempotent for an already-empty run and never invokes deletion', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = reporterManifest(config);
		const removeScopedArtifacts = vi.fn();
		const logger = { info: vi.fn() };
		const result = await cleanupHostedRun({
			config,
			manifest,
			environment: approvedCleanupEnvironment,
			inspectScopedArtifacts: vi.fn().mockResolvedValue(cleanInventory()),
			removeScopedArtifacts,
			logger
		});

		expect(result).toEqual({ cleaned: false, counts: cleanInventory() });
		expect(removeScopedArtifacts).not.toHaveBeenCalled();
		expect(JSON.stringify(logger.info.mock.calls)).not.toContain('@');
	});

	it('deletes only the exact run scope and verifies every residual count', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = reporterManifest(config);
		const before = cleanInventory({ accounts: 4, reports: 1, uploads: 2, objects: 2 });
		const inspectScopedArtifacts = vi
			.fn()
			.mockResolvedValueOnce(before)
			.mockResolvedValueOnce(cleanInventory());
		const removeScopedArtifacts = vi.fn().mockResolvedValue(undefined);

		await expect(
			cleanupHostedRun({
				config,
				manifest,
				environment: approvedCleanupEnvironment,
				inspectScopedArtifacts,
				removeScopedArtifacts,
				logger: { info: vi.fn() }
			})
		).resolves.toEqual({ cleaned: true, counts: cleanInventory() });
		expect(removeScopedArtifacts).toHaveBeenCalledOnce();
		expect(removeScopedArtifacts).toHaveBeenCalledWith({ runId, manifest });
	});

	it('never reports success while a scoped row or object remains', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = reporterManifest(config);
		const logger = { info: vi.fn() };
		const privatePath = `${runId}/must-not-leak.webp`;
		const inspectScopedArtifacts = vi
			.fn()
			.mockResolvedValueOnce(cleanInventory({ reports: 1, objects: 1 }))
			.mockResolvedValueOnce(cleanInventory({ objects: 1 }));

		let caught: unknown;
		try {
			await cleanupHostedRun({
					config,
					manifest,
					environment: approvedCleanupEnvironment,
					inspectScopedArtifacts,
					removeScopedArtifacts: vi.fn().mockRejectedValue(new Error(privatePath)),
					logger
				});
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(HostedEvidenceOperatorError);
		expect(String(caught)).not.toContain(privatePath);
		expect(logger.info).not.toHaveBeenCalledWith(
			expect.objectContaining({ status: 'PASS' })
		);
	});
});
