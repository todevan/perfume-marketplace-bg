import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as hostedOperatorModule from '../../scripts/hosted-report-evidence-operator.mjs';
import { createEncryptedModeratorCredentialStore } from '../../scripts/hosted-a9-credential-store.mjs';
import { deriveSyntheticIdentity } from '../../scripts/gate3-hosted-secrets.mjs';
import { A10_STEP_REGISTRY } from '../../scripts/gate3-hosted-scenario-runner.mjs';
import {
	mintGate3ScenarioCapabilityGrant,
	selectNextScenarioProbe,
	selectNextScenarioStep
} from '../../scripts/gate3-hosted-lifecycle.mjs';
import {
	HOSTED_STAGING,
	HostedEvidenceOperatorError,
	assertServiceRoleOperation,
	assertSanitizedHostedErrorBody,
	assertSyntheticAccountAllowed,
	cleanupHostedManifestFile,
	cleanupHostedRun,
	bindHostedA10CheckpointCapability,
	createHostedA10ExecutionContext,
	createHostedEvidenceOperator,
	createHostedRunManifest,
	createSanitizedOperatorRecord,
	createSupabaseHostedA9Adapters,
	createSupabaseHostedEvidenceAdapters,
	createSupabaseHostedEvidenceReadAdapters,
	createSupabaseHostedInspectionAdapter,
	generateTotpCode,
	inspectHostedA10CheckpointEvidence,
	loadHostedRunManifest,
	persistHostedRunManifest,
	registerHostedActor,
	registerHostedActorIntent,
	registerHostedQueueRow,
	registerHostedReport,
	registerHostedUpload,
	validateHostedA9Environment,
	validateHostedCleanupEnvironment,
	validateHostedProvisionEnvironment,
	validateHostedOperatorEnvironment
} from '../../scripts/hosted-report-evidence-operator.mjs';

const runId = 'gate3-20260809-0001';
const actorCreatedAt = '2026-08-09T12:00:00.000Z';
const actorIds = {
	reporter: '11111111-1111-4111-8111-111111111111',
	'cross-user': '22222222-2222-4222-8222-222222222222',
	'assigned-moderator': '33333333-3333-4333-8333-333333333333',
	'unassigned-moderator': '44444444-4444-4444-8444-444444444444'
} as const;
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
	E2E_REAL_UNASSIGNED_MODERATOR_EMAIL: 'unassigned@example.invalid',
	E2E_REAL_UNASSIGNED_MODERATOR_PASSWORD: 'unassigned-password',
	E2E_REAL_UNASSIGNED_MODERATOR_USERNAME: 'gate3-unassigned'
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

let reportTokenSequence = 0;
function freshReportTokenProvider(factory: (() => Promise<string>) | null = null) {
	return Object.freeze({
		freshReportToken: vi.fn(factory ?? (async () => `turnstile-token-${++reportTokenSequence}-${'x'.repeat(24)}`))
	});
}

function actorAuthorizationRead(input: RequestInfo | URL, init?: RequestInit): Response | null {
	const request = input instanceof Request ? input : new Request(input, init);
	const url = new URL(request.url);
	if (!['/rest/v1/profiles', '/rest/v1/beta_memberships'].includes(url.pathname)) return null;
	let actorId = '';
	try {
		const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /u, '');
		actorId = String(JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')).sub ?? '');
	} catch { /* fail closed below */ }
	const role = Object.entries(actorIds).find(([, id]) => id === actorId)?.[0] ?? '';
	const data = url.pathname === '/rest/v1/profiles'
		? (role ? [{ id: actorId, role: role.includes('moderator') ? 'moderator' : 'user', is_suspended: false }] : [])
		: (role ? [{ profile_id: actorId, status: 'active', onboarding_completed_at: actorCreatedAt }] : []);
	return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
}

function a10LifecycleFacts(coordinates: Record<string, unknown>, index: number) {
	return {
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
		...coordinates,
		boundReleaseCommitSha: coordinates.releaseCommitSha,
		currentReleaseCommitSha: coordinates.releaseCommitSha,
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
}

function a10LifecycleEvidence(coordinates: Record<string, unknown>, index: number) {
	return {
		completedCheckpointIds: A10_STEP_REGISTRY.slice(0, index).map((entry) => entry.id),
		hostedCheckpointId: null,
		manifestCheckpointId: null,
		...coordinates
	};
}

function a10CapabilityGrant(coordinates: Record<string, unknown>, index: number, confirmed = false, checkpointProof: unknown = null) {
	const inspection = a10LifecycleFacts(coordinates, index);
	const evidence = a10LifecycleEvidence(coordinates, index);
	const selected = selectNextScenarioStep(inspection, A10_STEP_REGISTRY, confirmed ? { ...evidence, hostedCheckpointId: A10_STEP_REGISTRY[index].id } : evidence);
	if (!selected) throw new Error('test authorization unavailable');
	const grant = mintGate3ScenarioCapabilityGrant(selected, A10_STEP_REGISTRY, inspection, checkpointProof);
	if (!grant) throw new Error('test grant unavailable');
	return grant;
}
const approvedProvisionEnvironment = {
	...baseEnvironment,
	E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_RUN: 'true',
	E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_APPROVAL: 'A9'
};
const a9Environment = approvedProvisionEnvironment;
const syntheticTotpSecret = Array.from(
	{ length: 32 },
	(_, index) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[index % 32]
).join('');

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
		email_confirmed_at: actorCreatedAt,
		user_metadata: {
			gate3_report_evidence_run_id: runId,
			gate3_report_evidence_provisioning_nonce:
				baseEnvironment.E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE,
			gate3_report_evidence_provisioning_attempt_id:
				baseEnvironment.E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE
		}
	};
}

function noopModeratorCredentialSink() {
	return {
		storeModeratorTotpSecret: vi.fn(),
		deleteModeratorTotpSecret: vi.fn()
	};
}

function reporterIntentManifest(config: ReturnType<typeof validateHostedA9Environment>) {
	return registerHostedActorIntent(createHostedRunManifest(config), 'reporter');
}

function completeActorManifest(config: ReturnType<typeof validateHostedA9Environment>) {
	return Object.entries(actorIds).reduce(
		(manifest, [role, userId]) => registerHostedActor(manifest, role, userId, actorCreatedAt),
		createHostedRunManifest(config)
	);
}

function hostedManifestDigest(manifest: unknown): string {
	return createHash('sha256').update(Buffer.from(`${JSON.stringify(manifest)}\n`)).digest('hex');
}

function createInspectorServiceClient(options: {
	users?: Array<Record<string, unknown>>;
	authPages?: Record<number, { users: Array<Record<string, unknown>>; total?: number; lastPage?: number }>;
	rows?: Record<string, Array<Record<string, unknown>>>;
	objects?: Record<string, Array<Record<string, unknown>>>;
	downloads?: Record<string, Uint8Array>;
	selectedColumns?: string[];
	queryCalls?: Array<Record<string, unknown>>;
} = {}) {
	const rows = options.rows ?? {};
	return {
		supabaseUrl: HOSTED_STAGING.supabaseUrl,
		auth: {
			admin: {
				listUsers: vi.fn(async ({ page }: { page: number }) => {
					const selected = options.authPages?.[page];
					return {
						data: selected ?? {
							users: page === 1 ? (options.users ?? []) : [],
							total: options.users?.length ?? 0,
							lastPage: 1
						},
						error: null
					};
				})
			}
		},
		from(table: string) {
			const filters: Array<(row: Record<string, unknown>) => boolean> = [];
			let orderColumn = 'id';
			let ascending = true;
			const execute = (from = 0, to = 999) => {
				const matching = (rows[table] ?? [])
					.filter((row) => filters.every((filter) => filter(row)))
					.sort((left, right) => {
						const comparison = String(left[orderColumn] ?? '').localeCompare(
							String(right[orderColumn] ?? ''),
							undefined,
							{ numeric: true }
						);
						return ascending ? comparison : -comparison;
					});
				return { data: matching.slice(from, to + 1), error: null };
			};
			const query = {
				select: (columns: string) => {
					options.selectedColumns?.push(`${table}:${columns}`);
					return query;
				},
				in: (column: string, values: Array<string | number>) => {
					filters.push((row) => values.map(String).includes(String(row[column])));
					return query;
				},
				like: (column: string, pattern: string) => {
					const prefix = pattern.endsWith('%') ? pattern.slice(0, -1) : pattern;
					filters.push((row) => String(row[column] ?? '').startsWith(prefix));
					return query;
				},
				order: (column: string, settings: { ascending?: boolean } = {}) => {
					orderColumn = column;
					ascending = settings.ascending !== false;
					return query;
				},
				range: (from: number, to: number) => {
					options.queryCalls?.push({ table, from, to });
					return Promise.resolve(execute(from, to));
				},
				then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
					Promise.resolve(execute()).then(resolve, reject)
			};
			return query;
		},
		storage: {
			from: () => ({
				list: (prefix: string) =>
					Promise.resolve({ data: options.objects?.[prefix] ?? [], error: null }),
				download: (path: string) => Promise.resolve(
					Object.hasOwn(options.downloads ?? {}, path)
						? { data: new Blob([Uint8Array.from(options.downloads?.[path] as Uint8Array).buffer as ArrayBuffer]), error: null }
						: { data: null, error: { message: 'not found' } }
				)
			})
		}
	};
}

describe('universal Supabase inspection adapter', () => {
	const inspectorRunId = 'gate3-20260820-abcdef12';
	const expectedIdentities = [
		'reporter',
		'cross-user',
		'assigned-moderator',
		'unassigned-moderator'
	].map((role) => deriveSyntheticIdentity({ runId: inspectorRunId, role, identitySchemeVersion: 1 }));
	const gate3Manifest = () =>
		createHostedRunManifest(
			{ target: HOSTED_STAGING, runId: inspectorRunId } as never,
			{ provisioningAttemptId: baseEnvironment.E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE }
		);
	const exactReporter = {
		id: actorIds.reporter,
		email: expectedIdentities[0].email,
		created_at: actorCreatedAt,
		last_sign_in_at: actorCreatedAt,
		factors: [{ id: 'factor-id', status: 'verified' }],
		user_metadata: {
			gate3_report_evidence_run_id: inspectorRunId,
			gate3_report_evidence_provisioning_attempt_id:
				baseEnvironment.E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE
		}
	};

	it('extracts the legacy exact-scope reads without changing the privileged adapter contract', () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const reads = createSupabaseHostedEvidenceReadAdapters({
			config,
			serviceClient: { supabaseUrl: HOSTED_STAGING.supabaseUrl } as never
		});
		expect(Object.keys(reads)).toEqual(['listPendingManifestUsers', 'inspectManifest']);
		expect(Object.keys(reads)).not.toEqual(
			expect.arrayContaining(['createUser', 'deleteUser', 'upload', 'removeManifest'])
		);
	});

	it('exposes only one read method and separates exact ownership from foreign evidence', async () => {
		const selectedColumns: string[] = [];
		const foreignId = actorIds['cross-user'];
		const exactUploadId = '66666666-6666-4666-8666-666666666666';
		const foreignUploadId = '77777777-7777-4777-8777-777777777777';
		const exactPath = `${actorIds.reporter}/${exactUploadId}.webp`;
		const foreignPath = `${foreignId}/${foreignUploadId}.webp`;
		const serviceClient = createInspectorServiceClient({
			selectedColumns,
			users: [
				exactReporter,
				{
					id: foreignId,
					email: expectedIdentities[1].email,
					created_at: actorCreatedAt,
					user_metadata: {
						gate3_report_evidence_run_id: 'gate3-20260809-foreign00',
						gate3_report_evidence_provisioning_attempt_id:
							baseEnvironment.E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE
					}
				}
			],
			rows: {
				profiles: [{ id: actorIds.reporter }, { id: foreignId }],
				reports: [
					{ id: actorIds.reporter, reporter_id: actorIds.reporter },
					{ id: foreignId, reporter_id: foreignId }
				],
				report_evidence_uploads: [
					{ id: exactUploadId, uploader_id: actorIds.reporter, storage_path: exactPath },
					{ id: foreignUploadId, uploader_id: foreignId, storage_path: foreignPath }
				],
				upload_cleanup_queue: [
					{ id: 1, storage_path: exactPath },
					{ id: 2, storage_path: foreignPath }
				]
			},
			objects: {
				[actorIds.reporter]: [{ name: `${exactUploadId}.webp` }],
				[foreignId]: [{ name: `${foreignUploadId}.webp` }]
			}
		});
		const adapter = createSupabaseHostedInspectionAdapter({
			projectRef: HOSTED_STAGING.projectRef,
			serviceClient: serviceClient as never
		});

		expect(Object.keys(adapter)).toEqual(['inspectRun']);
		await expect(
			adapter.inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest: gate3Manifest(),
				expectedIdentities
			})
		).resolves.toMatchObject({
			counts: {
				actors: 1,
				sessions: 0,
				mfaFactors: 0,
				profiles: 1,
				reports: 1,
				uploads: 1,
				objects: 1,
				queueRows: 1
			},
			foreignCounts: {
				syntheticAccounts: 1,
				profiles: 1,
				reports: 1,
				uploads: 1,
				objects: 1,
				queueRows: 1
			},
			metadataMismatches: 1,
			hostedActorsManifestStale: 1
		});
		expect(selectedColumns.some((selection) => selection.endsWith(':*'))).toBe(false);
	});

	it.each([
		[
			'duplicate role matches',
			gate3Manifest(),
			[exactReporter, { ...exactReporter, id: actorIds['cross-user'] }],
			{ duplicateRoles: 1, metadataMismatches: 0, manifestActorsAbsent: 0, hostedActorsManifestStale: 2 }
		],
		[
			'duplicate role matches after manifest registration',
			registerHostedActor(gate3Manifest(), 'reporter', actorIds.reporter, actorCreatedAt),
			[exactReporter, { ...exactReporter, id: actorIds['cross-user'] }],
			{ duplicateRoles: 1, metadataMismatches: 0, manifestActorsAbsent: 0, hostedActorsManifestStale: 0 }
		],
		[
			'mismatched metadata',
			gate3Manifest(),
			[
				{
					...exactReporter,
					user_metadata: {
						...exactReporter.user_metadata,
						gate3_report_evidence_run_id: 'gate3-20260809-foreign00'
					}
				}
			],
			{ duplicateRoles: 0, metadataMismatches: 1, manifestActorsAbsent: 0, hostedActorsManifestStale: 0 }
		],
		[
			'manifest actor absent',
			registerHostedActor(gate3Manifest(), 'reporter', actorIds.reporter, actorCreatedAt),
			[],
			{ duplicateRoles: 0, metadataMismatches: 0, manifestActorsAbsent: 1, hostedActorsManifestStale: 0 }
		],
		[
			'manifest actor timestamp mismatch',
			registerHostedActor(gate3Manifest(), 'reporter', actorIds.reporter, actorCreatedAt),
			[{ ...exactReporter, created_at: '2026-08-09T12:01:00.000Z' }],
			{ duplicateRoles: 0, metadataMismatches: 1, manifestActorsAbsent: 1, hostedActorsManifestStale: 0 }
		],
		[
			'hosted actor after pending intent',
			registerHostedActorIntent(gate3Manifest(), 'reporter'),
			[exactReporter],
			{ duplicateRoles: 0, metadataMismatches: 0, manifestActorsAbsent: 0, hostedActorsManifestStale: 0 }
		],
		[
			'hosted actor before intent persistence',
			gate3Manifest(),
			[exactReporter],
			{ duplicateRoles: 0, metadataMismatches: 0, manifestActorsAbsent: 0, hostedActorsManifestStale: 1 }
		]
	])('derives %s from authoritative Auth metadata', async (_label, manifest, users, expected) => {
		const adapter = createSupabaseHostedInspectionAdapter({
			projectRef: HOSTED_STAGING.projectRef,
			serviceClient: createInspectorServiceClient({ users }) as never
		});
		await expect(
			adapter.inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest,
				expectedIdentities
			})
		).resolves.toMatchObject(expected);
	});

	it('rejects an unbound client and sanitizes provider failures', async () => {
		expect(() =>
			createSupabaseHostedInspectionAdapter({
				projectRef: HOSTED_STAGING.projectRef,
				serviceClient: { supabaseUrl: 'https://example.invalid' } as never
			})
		).toThrow('hosted_inspection_target_invalid');

		const providerBody = 'provider-secret-body-never-echo';
		const client = createInspectorServiceClient();
		client.auth.admin.listUsers.mockRejectedValue(new Error(providerBody));
		let caught: unknown;
		try {
			await createSupabaseHostedInspectionAdapter({
				projectRef: HOSTED_STAGING.projectRef,
				serviceClient: client as never
			}).inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest: gate3Manifest(),
				expectedIdentities
			});
		} catch (error) {
			caught = error;
		}
		expect(String(caught)).toContain('hosted_inspection_failed');
		expect(String(caught)).not.toContain(providerBody);
	});

	it('distinguishes a same-role replacement from safe manifest absence after deletion', async () => {
		const manifest = registerHostedActor(
			gate3Manifest(),
			'reporter',
			actorIds.reporter,
			actorCreatedAt
		);
		const replacement = { ...exactReporter, id: actorIds['cross-user'] };
		for (const [users, expected] of [
			[[replacement], { actorIdentityConflicts: 1, manifestActorsAbsent: 1 }],
			[[], { actorIdentityConflicts: 0, manifestActorsAbsent: 1 }]
		] as const) {
			const adapter = createSupabaseHostedInspectionAdapter({
				projectRef: HOSTED_STAGING.projectRef,
				serviceClient: createInspectorServiceClient({ users: [...users] }) as never
			});
			await expect(
				adapter.inspectRun({
					runId: inspectorRunId,
					createdAfter: '2026-08-09T11:59:00.000Z',
					manifest,
					expectedIdentities
				})
			).resolves.toMatchObject(expected);
		}
	});

	it('does not treat four incomplete Auth shells or last sign-in timestamps as A9 proof', async () => {
		const users = expectedIdentities.map((identity, index) => ({
			id: Object.values(actorIds)[index],
			email: identity.email,
			created_at: actorCreatedAt,
			last_sign_in_at: actorCreatedAt,
			factors: [{ factor_type: 'phone', status: 'verified' }],
			user_metadata: {
				gate3_report_evidence_run_id: inspectorRunId,
				gate3_report_evidence_provisioning_attempt_id:
					baseEnvironment.E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE
			}
		}));
		const adapter = createSupabaseHostedInspectionAdapter({
			projectRef: HOSTED_STAGING.projectRef,
			serviceClient: createInspectorServiceClient({ users }) as never
		});

		await expect(
			adapter.inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest: gate3Manifest(),
				expectedIdentities
			})
		).resolves.toMatchObject({
			counts: { actors: 4, sessions: 0, mfaFactors: 0 },
			confirmedActors: 0,
			completeProfiles: 0,
			verifiedModeratorTotpFactors: 0,
			activeSessionsProven: false
		});
	});

	it('derives complete A9 confirmation, profile, membership, and moderator TOTP proof', async () => {
		const users = expectedIdentities.map((identity, index) => {
			const moderator = identity.role.includes('moderator');
			return {
				id: Object.values(actorIds)[index],
				email: identity.email,
				created_at: actorCreatedAt,
				email_confirmed_at: actorCreatedAt,
				last_sign_in_at: actorCreatedAt,
				factors: moderator
					? [{ factor_type: 'totp', status: 'verified' }]
					: [],
				user_metadata: {
					gate3_report_evidence_run_id: inspectorRunId,
					gate3_report_evidence_provisioning_attempt_id:
						baseEnvironment.E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE
				}
			};
		});
		const profiles = expectedIdentities.map((identity, index) => ({
			id: Object.values(actorIds)[index],
			username: identity.username,
			role: identity.role.includes('moderator') ? 'moderator' : 'user',
			is_suspended: false
		}));
		const memberships = expectedIdentities.map((_identity, index) => ({
			profile_id: Object.values(actorIds)[index],
			status: 'active',
			onboarding_completed_at: actorCreatedAt
		}));
		const adapter = createSupabaseHostedInspectionAdapter({
			projectRef: HOSTED_STAGING.projectRef,
			serviceClient: createInspectorServiceClient({
				users,
				rows: { profiles, beta_memberships: memberships }
			}) as never
		});

		await expect(
			adapter.inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest: gate3Manifest(),
				expectedIdentities
			})
		).resolves.toMatchObject({
			counts: { actors: 4, profiles: 4, sessions: 0, mfaFactors: 2 },
			confirmedActors: 4,
			completeProfiles: 4,
			verifiedModeratorTotpFactors: 2,
			moderatorsWithVerifiedTotp: 2,
			activeSessionsProven: false
		});
	});

	it('does not treat two verified TOTP factors on one moderator as coverage of both roles', async () => {
		const users = expectedIdentities.map((identity, index) => ({
			id: Object.values(actorIds)[index],
			email: identity.email,
			created_at: actorCreatedAt,
			factors:
				identity.role === 'assigned-moderator'
					? [
							{ factor_type: 'totp', status: 'verified' },
							{ factor_type: 'totp', status: 'verified' },
							{ factor_type: 'phone', status: 'verified' },
							{ factor_type: 'totp', status: 'unverified' }
						]
					: [],
			user_metadata: {
				gate3_report_evidence_run_id: inspectorRunId,
				gate3_report_evidence_provisioning_attempt_id:
					baseEnvironment.E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE
			}
		}));
		const adapter = createSupabaseHostedInspectionAdapter({
			projectRef: HOSTED_STAGING.projectRef,
			serviceClient: createInspectorServiceClient({ users }) as never
		});

		await expect(
			adapter.inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest: gate3Manifest(),
				expectedIdentities
			})
		).resolves.toMatchObject({
			counts: { mfaFactors: 2 },
			verifiedModeratorTotpFactors: 2,
			moderatorsWithVerifiedTotp: 1
		});
	});

	it('derives authoritative active-session proof only from the constrained reader', async () => {
		const users = expectedIdentities.map((identity, index) => ({
			id: Object.values(actorIds)[index],
			email: identity.email,
			created_at: actorCreatedAt,
			user_metadata: {
				gate3_report_evidence_run_id: inspectorRunId,
				gate3_report_evidence_provisioning_attempt_id:
					baseEnvironment.E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE
			}
		}));
		const client = createInspectorServiceClient({ users }) as ReturnType<
			typeof createInspectorServiceClient
		> & { schema: ReturnType<typeof vi.fn> };
		client.schema = vi.fn(() => {
			throw new Error('unreachable Auth schema must not be queried');
		});
		const readActiveUserIds = vi.fn().mockResolvedValue({
			activeUserIds: users.map((user) => user.id)
		});
		const adapter = createSupabaseHostedInspectionAdapter({
			projectRef: HOSTED_STAGING.projectRef,
			serviceClient: client as never,
			sessionCoverageReader: Object.freeze({
				targetProjectRef: HOSTED_STAGING.projectRef,
				readActiveUserIds
			})
		});

		await expect(
			adapter.inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest: gate3Manifest(),
				expectedIdentities
			})
		).resolves.toMatchObject({
			counts: { sessions: 4 },
			actorsWithActiveSessions: 4,
			activeSessionsProven: true
		});
		expect(readActiveUserIds).toHaveBeenCalledWith({ userIds: Object.values(actorIds) });
		expect(client.schema).not.toHaveBeenCalled();
	});

	it('does not query the unreachable Auth schema and fails closed on absent or failing readers', async () => {
		const providerSecret = 'provider-session-body-never-returned';
		for (const sessionCoverageReader of [
			undefined,
			Object.freeze({
				targetProjectRef: HOSTED_STAGING.projectRef,
				readActiveUserIds: vi.fn().mockRejectedValue(new Error(providerSecret))
			})
		]) {
			const client = createInspectorServiceClient({ users: [exactReporter] }) as ReturnType<
				typeof createInspectorServiceClient
		> & { schema: ReturnType<typeof vi.fn> };
			client.schema = vi.fn(() => {
				throw new Error('unreachable Auth schema must not be queried');
			});
			const adapter = createSupabaseHostedInspectionAdapter({
				projectRef: HOSTED_STAGING.projectRef,
				serviceClient: client as never,
				sessionCoverageReader
			});
			const result = await adapter.inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest: gate3Manifest(),
				expectedIdentities
			});
			expect(result).toMatchObject({
				counts: { sessions: 0 },
				actorsWithActiveSessions: 0,
				activeSessionsProven: false
			});
			expect(JSON.stringify(result)).not.toContain(providerSecret);
			expect(client.schema).not.toHaveBeenCalled();
		}
	});

	it('rejects foreign-target or mutation-capable session coverage readers as unavailable proof', async () => {
		for (const sessionCoverageReader of [
			{
				targetProjectRef: 'foreign-project',
				readActiveUserIds: vi.fn().mockResolvedValue({ activeUserIds: [actorIds.reporter] })
			},
			{
				targetProjectRef: HOSTED_STAGING.projectRef,
				readActiveUserIds: vi.fn().mockResolvedValue({ activeUserIds: [actorIds.reporter] }),
				deleteSession: vi.fn()
			}
		]) {
			const adapter = createSupabaseHostedInspectionAdapter({
				projectRef: HOSTED_STAGING.projectRef,
				serviceClient: createInspectorServiceClient({ users: [exactReporter] }) as never,
				sessionCoverageReader
			});
			await expect(
				adapter.inspectRun({
					runId: inspectorRunId,
					createdAfter: '2026-08-09T11:59:00.000Z',
					manifest: gate3Manifest(),
					expectedIdentities
				})
			).resolves.toMatchObject({ activeSessionsProven: false });
			expect(sessionCoverageReader.readActiveUserIds).not.toHaveBeenCalled();
		}
	});

	it('rejects hidden, inherited, symbolic, and accessor session-reader capabilities', async () => {
		const inherited = Object.create({ deleteSession: vi.fn() });
		Object.assign(inherited, {
			targetProjectRef: HOSTED_STAGING.projectRef,
			readActiveUserIds: vi.fn().mockResolvedValue({ activeUserIds: [actorIds.reporter] })
		});
		const symbolic = {
			targetProjectRef: HOSTED_STAGING.projectRef,
			readActiveUserIds: vi.fn().mockResolvedValue({ activeUserIds: [actorIds.reporter] }),
			[Symbol('deleteSession')]: vi.fn()
		};
		const nonEnumerable = {
			targetProjectRef: HOSTED_STAGING.projectRef,
			readActiveUserIds: vi.fn().mockResolvedValue({ activeUserIds: [actorIds.reporter] })
		};
		Object.defineProperty(nonEnumerable, 'deleteSession', { value: vi.fn() });
		const accessorRead = vi.fn().mockResolvedValue({ activeUserIds: [actorIds.reporter] });
		const accessor = {
			targetProjectRef: HOSTED_STAGING.projectRef,
			get readActiveUserIds() {
				return accessorRead;
			}
		};

		for (const sessionCoverageReader of [inherited, symbolic, nonEnumerable, accessor]) {
			const adapter = createSupabaseHostedInspectionAdapter({
				projectRef: HOSTED_STAGING.projectRef,
				serviceClient: createInspectorServiceClient({ users: [exactReporter] }) as never,
				sessionCoverageReader
			});
			await expect(
				adapter.inspectRun({
					runId: inspectorRunId,
					createdAfter: '2026-08-09T11:59:00.000Z',
					manifest: gate3Manifest(),
					expectedIdentities
				})
			).resolves.toMatchObject({ activeSessionsProven: false });
		}

		expect(inherited.readActiveUserIds).not.toHaveBeenCalled();
		expect(symbolic.readActiveUserIds).not.toHaveBeenCalled();
		expect(nonEnumerable.readActiveUserIds).not.toHaveBeenCalled();
		expect(accessorRead).not.toHaveBeenCalled();
	});

	it('rejects fake promises and proxy-backed session coverage boundaries without invoking them', async () => {
		const scope = {
			runId: inspectorRunId,
			createdAfter: '2026-08-09T11:59:00.000Z',
			manifest: gate3Manifest(),
			expectedIdentities
		};
		const inspectWith = async (sessionCoverageReader: unknown) => {
			const adapter = createSupabaseHostedInspectionAdapter({
				projectRef: HOSTED_STAGING.projectRef,
				serviceClient: createInspectorServiceClient({ users: [exactReporter] }) as never,
				sessionCoverageReader: sessionCoverageReader as never
			});
			return adapter.inspectRun(scope);
		};

		const thenGetter = vi.fn(() =>
			(resolve: (coverage: { activeUserIds: string[] }) => void) =>
				resolve({ activeUserIds: [actorIds.reporter] })
		);
		const fakePromise = Object.defineProperty(Object.create(Promise.prototype), 'then', {
			get: thenGetter
		});
		await expect(
			inspectWith({
				targetProjectRef: HOSTED_STAGING.projectRef,
				readActiveUserIds: () => fakePromise
			})
		).resolves.toMatchObject({ activeSessionsProven: false });
		expect(thenGetter).not.toHaveBeenCalled();

		const readerRecordTrap = vi.fn(() => {
			throw new Error('reader-record-provider-token');
		});
		const proxyReaderRecord = new Proxy(
			{
				targetProjectRef: HOSTED_STAGING.projectRef,
				readActiveUserIds: vi.fn().mockResolvedValue({
					activeUserIds: [actorIds.reporter]
				})
			},
			{
				getPrototypeOf: readerRecordTrap,
				ownKeys: readerRecordTrap,
				getOwnPropertyDescriptor: readerRecordTrap
			}
		);
		await expect(inspectWith(proxyReaderRecord)).resolves.toMatchObject({
			activeSessionsProven: false
		});
		expect(readerRecordTrap).not.toHaveBeenCalled();

		const callableTrap = vi.fn(() => {
			throw new Error('reader-callable-provider-token');
		});
		const proxyCallable = new Proxy(
			() => Promise.resolve({ activeUserIds: [actorIds.reporter] }),
			{ apply: callableTrap }
		);
		await expect(
			inspectWith({
				targetProjectRef: HOSTED_STAGING.projectRef,
				readActiveUserIds: proxyCallable
			})
		).resolves.toMatchObject({ activeSessionsProven: false });
		expect(callableTrap).not.toHaveBeenCalled();

		const coverageRecordTrap = vi.fn(() => {
			throw new Error('coverage-record-provider-token');
		});
		const proxyCoverageRecord = new Proxy(
			{ activeUserIds: [actorIds.reporter] },
			{
				getPrototypeOf: coverageRecordTrap,
				ownKeys: coverageRecordTrap,
				getOwnPropertyDescriptor: coverageRecordTrap
			}
		);
		await expect(
			inspectWith({
				targetProjectRef: HOSTED_STAGING.projectRef,
				readActiveUserIds: vi.fn(() => Promise.resolve(proxyCoverageRecord))
			})
		).resolves.toMatchObject({ activeSessionsProven: false });
		expect(coverageRecordTrap).not.toHaveBeenCalled();

		const idArrayTrap = vi.fn(() => {
			throw new Error('id-array-provider-token');
		});
		const proxyIdArray = new Proxy([actorIds.reporter], {
			getPrototypeOf: idArrayTrap,
			ownKeys: idArrayTrap,
			getOwnPropertyDescriptor: idArrayTrap
		});
		await expect(
			inspectWith({
				targetProjectRef: HOSTED_STAGING.projectRef,
				readActiveUserIds: vi.fn(() =>
					Promise.resolve({ activeUserIds: proxyIdArray })
				)
			})
		).resolves.toMatchObject({ activeSessionsProven: false });
		expect(idArrayTrap).not.toHaveBeenCalled();
	});

	it('rejects hidden, inherited, symbolic, accessor, and thenable session coverage results', async () => {
		const privateFieldName = ['to', 'ken'].join('');
		const inherited = Object.create({ [privateFieldName]: 'inherited-provider-value' });
		inherited.activeUserIds = [actorIds.reporter];
		const symbolic = {
			activeUserIds: [actorIds.reporter],
			[Symbol('sessionId')]: 'symbol-provider-session'
		};
		const nonEnumerable = { activeUserIds: [actorIds.reporter] };
		Object.defineProperty(nonEnumerable, 'providerBody', { value: 'hidden-provider-body' });
		const accessor = Object.defineProperty({}, 'activeUserIds', {
			enumerable: true,
			get: () => [actorIds.reporter]
		});
		const then = vi.fn((resolve) => resolve({ activeUserIds: [actorIds.reporter] }));
		const malformedThenable = { then };
		const extraEnumerable = {
			activeUserIds: [actorIds.reporter],
			providerBody: 'provider-body'
		};
		const symbolicIds = [actorIds.reporter];
		Object.defineProperty(symbolicIds, Symbol('sessionId'), { value: 'array-symbol-session' });
		const hiddenIds = [actorIds.reporter];
		Object.defineProperty(hiddenIds, privateFieldName, { value: 'array-hidden-value' });
		const accessorIds: string[] = [];
		Object.defineProperty(accessorIds, '0', {
			enumerable: true,
			get: () => actorIds.reporter
		});
		accessorIds.length = 1;
		const duplicate = { activeUserIds: [actorIds.reporter, actorIds.reporter] };
		const outsideSubset = { activeUserIds: [actorIds['cross-user']] };

		for (const coverage of [
			inherited,
			symbolic,
			nonEnumerable,
			accessor,
			malformedThenable,
			extraEnumerable,
			{ activeUserIds: symbolicIds },
			{ activeUserIds: hiddenIds },
			{ activeUserIds: accessorIds },
			duplicate,
			outsideSubset
		]) {
			const adapter = createSupabaseHostedInspectionAdapter({
				projectRef: HOSTED_STAGING.projectRef,
				serviceClient: createInspectorServiceClient({ users: [exactReporter] }) as never,
				sessionCoverageReader: {
					targetProjectRef: HOSTED_STAGING.projectRef,
					readActiveUserIds: vi.fn(() => coverage as never)
				}
			});
			const result = await adapter.inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest: gate3Manifest(),
				expectedIdentities
			});
			expect(result).toMatchObject({ activeSessionsProven: false });
			expect(JSON.stringify(result)).not.toMatch(/provider|session-id|token/i);
		}

		expect(then).not.toHaveBeenCalled();
	});

	it('accepts exact plain and null-prototype readers and obtains fresh coverage per inspection', async () => {
		for (const nullPrototype of [false, true]) {
			const responses = [
				{ activeUserIds: [actorIds.reporter] },
				Object.assign(Object.create(null), { activeUserIds: [] })
			];
			const readActiveUserIds = vi
				.fn()
				.mockImplementation(() => Promise.resolve(responses.shift()));
			const reader = Object.assign(nullPrototype ? Object.create(null) : {}, {
				targetProjectRef: HOSTED_STAGING.projectRef,
				readActiveUserIds
			});
			const adapter = createSupabaseHostedInspectionAdapter({
				projectRef: HOSTED_STAGING.projectRef,
				serviceClient: createInspectorServiceClient({ users: [exactReporter] }) as never,
				sessionCoverageReader: reader
			});
			reader.targetProjectRef = 'mutated-foreign-project';
			reader.readActiveUserIds = vi
				.fn()
				.mockRejectedValue(new Error('mutated-provider-body'));
			const scope = {
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest: gate3Manifest(),
				expectedIdentities
			};

			await expect(adapter.inspectRun(scope)).resolves.toMatchObject({
				activeSessionsProven: true,
				actorsWithActiveSessions: 1
			});
			await expect(adapter.inspectRun(scope)).resolves.toMatchObject({
				activeSessionsProven: true,
				actorsWithActiveSessions: 0
			});
			expect(readActiveUserIds).toHaveBeenCalledTimes(2);
		}
	});

	it.each([
		['in-progress', 'complete', false, true],
		['complete', 'complete', true, false]
	] as const)(
		'derives %s scenario progress from persisted checkpoints and live hosted rows',
		async (phaseStatus, checkpointStatus, scenarioVerified, scenarioPartial) => {
			let manifest = gate3Manifest();
			for (const [role, userId] of Object.entries(actorIds)) {
				manifest = registerHostedActor(manifest, role, userId, actorCreatedAt);
			}
			const reportId = '66666666-6666-4666-8666-666666666666';
			const uploadId = '77777777-7777-4777-8777-777777777777';
			const objectPath = `${actorIds.reporter}/${uploadId}.webp`;
			manifest = registerHostedReport(manifest, reportId, 'reporter');
			manifest = registerHostedUpload(manifest, uploadId, 'reporter', objectPath);
			const users = expectedIdentities.map((identity, index) => ({
				id: Object.values(actorIds)[index],
				email: identity.email,
				created_at: actorCreatedAt,
				user_metadata: {
					gate3_report_evidence_run_id: inspectorRunId,
					gate3_report_evidence_provisioning_attempt_id:
						baseEnvironment.E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE
				}
			}));
			const adapter = createSupabaseHostedInspectionAdapter({
				projectRef: HOSTED_STAGING.projectRef,
				serviceClient: createInspectorServiceClient({
					users,
					rows: {
						reports: [
							{
								id: reportId,
								reporter_id: actorIds.reporter,
								target_id: actorIds['cross-user'],
								evidence_paths: [objectPath],
								status: 'investigating',
								assigned_to: actorIds['assigned-moderator']
							}
						],
						report_evidence_uploads: [
							{
								id: uploadId,
								uploader_id: actorIds.reporter,
								storage_path: objectPath,
								status: 'attached',
								report_id: reportId,
								created_at: actorCreatedAt,
								finalized_at: actorCreatedAt,
								attached_at: actorCreatedAt
							}
						]
					},
					objects: { [actorIds.reporter]: [{ name: `${uploadId}.webp` }] }
				}) as never
			});

			await expect(
				adapter.inspectRun({
					runId: inspectorRunId,
					createdAfter: '2026-08-09T11:59:00.000Z',
					manifest,
					expectedIdentities,
					scenarioEvidence: {
						phase: {
							status: phaseStatus,
							checkpoint: {
								status: checkpointStatus,
								step: 'primary-upload-attached',
								observedAt: actorCreatedAt
							}
						},
						checkpoints: {
							'scenario-primary-upload-attached': {
								status: checkpointStatus,
								step: 'primary-upload-attached',
								observedAt: actorCreatedAt
							}
						}
					}
				})
			).resolves.toMatchObject({ scenarioVerified, scenarioPartial });
		}
	);

	it('derives canonical completion only from the exact reducer-implied manifest and every durable live anchor', async () => {
		let manifest = gate3Manifest();
		for (const [role, userId] of Object.entries(actorIds)) {
			manifest = registerHostedActor(manifest, role, userId, actorCreatedAt);
		}
		const reportId = '66666666-6666-4666-8666-666666666666';
		const uploadIds = {
			primary: '77777777-7777-4777-8777-777777777777',
			duplicate: '88888888-8888-4888-8888-888888888888',
			rejected: '99999999-9999-4999-8999-999999999999',
			abandoned: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
		};
		const objectPath = `${actorIds.reporter}/${uploadIds.primary}.webp`;
		const primaryBytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA', 'base64');
		manifest = registerHostedReport(manifest, reportId, 'reporter');
		for (const uploadId of Object.values(uploadIds)) {
			manifest = registerHostedUpload(manifest, uploadId, 'reporter', `${actorIds.reporter}/${uploadId}.webp`);
		}
		manifest = registerHostedQueueRow(manifest, 17, uploadIds.duplicate);
		manifest = registerHostedQueueRow(manifest, 18, uploadIds.rejected);
		manifest = registerHostedQueueRow(manifest, 19, uploadIds.abandoned);
		const users = expectedIdentities.map((identity, index) => ({
			id: Object.values(actorIds)[index],
			email: identity.email,
			created_at: actorCreatedAt,
			user_metadata: {
				gate3_report_evidence_run_id: inspectorRunId,
				gate3_report_evidence_provisioning_attempt_id:
					baseEnvironment.E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE
			}
		}));
		const checkpoints = Object.fromEntries(A10_STEP_REGISTRY.map(({ id }) => [
			`scenario-${id}`,
			{ status: 'complete', step: id, observedAt: actorCreatedAt }
		]));
		const finalCheckpoint = checkpoints[`scenario-${A10_STEP_REGISTRY.at(-1)?.id}`];
		const inspect = async (omit: string | null = null) => {
			const uploadRows = [
				{ id: uploadIds.primary, status: 'attached', report_id: reportId, actual_content_hash: createHash('sha256').update(primaryBytes).digest('hex'), actual_byte_size: primaryBytes.length, actual_mime_type: 'image/webp', width_px: 1, height_px: 1, finalized_at: actorCreatedAt, attached_at: actorCreatedAt },
				{ id: uploadIds.duplicate, status: 'rejected', report_id: null },
				{ id: uploadIds.rejected, status: 'rejected', report_id: null },
				{ id: uploadIds.abandoned, status: 'expired', report_id: null }
			].filter((row) => omit !== `${row.id}-upload`).map((row) => ({ ...row, uploader_id: actorIds.reporter, storage_path: `${actorIds.reporter}/${row.id}.webp`, created_at: actorCreatedAt }));
			const queueRows = [
				{ id: 17, report_evidence_upload_id: uploadIds.duplicate },
				{ id: 18, report_evidence_upload_id: uploadIds.rejected },
				{ id: 19, report_evidence_upload_id: uploadIds.abandoned }
			].filter((row) => omit !== `${row.report_evidence_upload_id}-queue`).map((row) => ({ ...row, storage_path: `${actorIds.reporter}/${row.report_evidence_upload_id}.webp`, processed_at: actorCreatedAt }));
			const adapter = createSupabaseHostedInspectionAdapter({
				projectRef: HOSTED_STAGING.projectRef,
				serviceClient: createInspectorServiceClient({
				users,
				rows: {
					reports: [{
						id: reportId,
						reporter_id: actorIds.reporter,
						target_id: actorIds['cross-user'],
						evidence_paths: [objectPath],
						status: 'investigating',
						assigned_to: actorIds['assigned-moderator']
					}],
					report_evidence_uploads: uploadRows,
					upload_cleanup_queue: queueRows,
					moderation_audit: omit === 'assignment-audit' ? [] : [{ id: 1, report_id: reportId, actor_id: actorIds['assigned-moderator'], action: 'report_assigned', created_at: actorCreatedAt }]
				},
				objects: { [actorIds.reporter]: [{ name: `${uploadIds.primary}.webp`, metadata: { size: primaryBytes.length, mimetype: 'image/webp' } }] },
				downloads: { [objectPath]: omit === 'primary-bytes' ? Buffer.from('wrong') : primaryBytes }
			}) as never
			});
			return adapter.inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest,
				expectedIdentities,
				scenarioRegistry: A10_STEP_REGISTRY,
				scenarioEvidence: { phase: { status: 'complete', checkpoint: finalCheckpoint }, checkpoints }
			});
		};

		await expect(inspect()).resolves.toMatchObject({ scenarioVerified: true, scenarioPartial: false });
		for (const missing of [
			`${uploadIds.duplicate}-upload`, `${uploadIds.rejected}-upload`, `${uploadIds.abandoned}-upload`,
			`${uploadIds.duplicate}-queue`, `${uploadIds.rejected}-queue`, `${uploadIds.abandoned}-queue`,
			'assignment-audit', 'primary-bytes'
		]) {
			await expect(inspect(missing)).resolves.toMatchObject({ scenarioVerified: false, scenarioPartial: true });
		}
	});

	it.each([
		['unrelated checkpoint', 'scenario-unrelated', 'unrelated-step', true, actorIds.reporter, true, true, true, false],
		['unmanifested upload', 'scenario-primary-upload-attached', 'primary-upload-attached', false, actorIds.reporter, true, true, true, false],
		['wrong uploader', 'scenario-primary-upload-attached', 'primary-upload-attached', true, actorIds['cross-user'], true, true, true, false],
		['missing object', 'scenario-primary-upload-attached', 'primary-upload-attached', true, actorIds.reporter, false, true, true, false],
		['mismatched report linkage', 'scenario-primary-upload-attached', 'primary-upload-attached', true, actorIds.reporter, true, false, true, false],
		['mismatched evidence path', 'scenario-primary-upload-attached', 'primary-upload-attached', true, actorIds.reporter, true, true, false, false],
		['exact valid shape', 'scenario-primary-upload-attached', 'primary-upload-attached', true, actorIds.reporter, true, true, true, true]
	] as const)(
		'accepts only the exact scenario evidence contract: %s',
		async (
			_label,
			checkpointKey,
			checkpointStep,
			manifestUpload,
			uploaderId,
			objectPresent,
			correctReportLink,
			correctEvidencePath,
			expectedVerified
		) => {
			let manifest = gate3Manifest();
			for (const [role, userId] of Object.entries(actorIds)) {
				manifest = registerHostedActor(manifest, role, userId, actorCreatedAt);
			}
			const reportId = '66666666-6666-4666-8666-666666666666';
			const uploadId = '77777777-7777-4777-8777-777777777777';
			const objectPath = `${actorIds.reporter}/${uploadId}.webp`;
			manifest = registerHostedReport(manifest, reportId, 'reporter');
			if (manifestUpload) {
				manifest = registerHostedUpload(manifest, uploadId, 'reporter', objectPath);
			}
			const users = expectedIdentities.map((identity, index) => ({
				id: Object.values(actorIds)[index],
				email: identity.email,
				created_at: actorCreatedAt,
				user_metadata: {
					gate3_report_evidence_run_id: inspectorRunId,
					gate3_report_evidence_provisioning_attempt_id:
						baseEnvironment.E2E_REAL_REPORT_EVIDENCE_PROVISIONING_NONCE
				}
			}));
			const checkpoint = {
				status: 'complete',
				step: checkpointStep,
				observedAt: actorCreatedAt
			};
			const adapter = createSupabaseHostedInspectionAdapter({
				projectRef: HOSTED_STAGING.projectRef,
				serviceClient: createInspectorServiceClient({
					users,
					rows: {
						reports: [
							{
								id: reportId,
								reporter_id: actorIds.reporter,
								target_id: actorIds['cross-user'],
								evidence_paths: [
									correctEvidencePath ? objectPath : `${actorIds.reporter}/other.webp`
								],
								status: 'investigating',
								assigned_to: actorIds['assigned-moderator']
							}
						],
						report_evidence_uploads: [
							{
								id: uploadId,
								uploader_id: uploaderId,
								storage_path: objectPath,
								status: 'attached',
								report_id: correctReportLink
									? reportId
									: '88888888-8888-4888-8888-888888888888',
								attached_at: actorCreatedAt
							}
						]
					},
					objects: objectPresent
						? { [actorIds.reporter]: [{ name: `${uploadId}.webp` }] }
						: {}
				}) as never
			});

			await expect(
				adapter.inspectRun({
					runId: inspectorRunId,
					createdAfter: '2026-08-09T11:59:00.000Z',
					manifest,
					expectedIdentities,
					scenarioEvidence: {
						phase: { status: 'complete', checkpoint },
						checkpoints: { [checkpointKey]: checkpoint }
					}
				})
			).resolves.toMatchObject({
				scenarioVerified: expectedVerified,
				scenarioPartial: !expectedVerified
			});
		}
	);

	it('finds a surviving manifest queue row by ID even when its path changed', async () => {
		const uploadId = '77777777-7777-4777-8777-777777777777';
		const expectedPath = `${actorIds.reporter}/${uploadId}.webp`;
		let manifest = registerHostedActor(
			gate3Manifest(),
			'reporter',
			actorIds.reporter,
			actorCreatedAt
		);
		manifest = registerHostedUpload(manifest, uploadId, 'reporter', expectedPath);
		manifest = registerHostedQueueRow(manifest, 51, uploadId);
		const adapter = createSupabaseHostedInspectionAdapter({
			projectRef: HOSTED_STAGING.projectRef,
			serviceClient: createInspectorServiceClient({
				users: [exactReporter],
				rows: {
					upload_cleanup_queue: [
						{
							id: 51,
							storage_path: `${actorIds.reporter}/changed.webp`,
							report_evidence_upload_id: uploadId,
							upload_id: null
						}
					]
				}
			}) as never
		});

		await expect(
			adapter.inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest,
				expectedIdentities
			})
		).resolves.toMatchObject({ counts: { queueRows: 1 }, metadataMismatches: 1 });
	});

	it('finds owner-prefixed orphan queue rows outside manifest paths', async () => {
		const adapter = createSupabaseHostedInspectionAdapter({
			projectRef: HOSTED_STAGING.projectRef,
			serviceClient: createInspectorServiceClient({
				users: [exactReporter],
				rows: {
					upload_cleanup_queue: [
						{
							id: 99,
							storage_path: `${actorIds.reporter}/orphan.webp`,
							report_evidence_upload_id: null,
							upload_id: null
						}
					]
				}
			}) as never
		});

		await expect(
			adapter.inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest: gate3Manifest(),
				expectedIdentities
			})
		).resolves.toMatchObject({ counts: { queueRows: 1 } });
	});

	it('continues Auth enumeration past a misleading multi-digit lastPage', async () => {
		const fillerUsers = Array.from({ length: 1000 }, (_, index) => ({
			id: `ordinary-${index}`,
			email: `ordinary-${index}@example.com`,
			created_at: actorCreatedAt,
			user_metadata: {}
		}));
		const client = createInspectorServiceClient({
			authPages: {
				1: { users: fillerUsers, total: 1001, lastPage: 1 },
				2: { users: [exactReporter], total: 1001, lastPage: 1 }
			}
		});
		const adapter = createSupabaseHostedInspectionAdapter({
			projectRef: HOSTED_STAGING.projectRef,
			serviceClient: client as never
		});

		await expect(
			adapter.inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest: gate3Manifest(),
				expectedIdentities
			})
		).resolves.toMatchObject({ counts: { actors: 1 } });
		expect(client.auth.admin.listUsers).toHaveBeenCalledTimes(2);
	});

	it('fails closed when Auth pagination total cannot be reconciled', async () => {
		const fillerUsers = Array.from({ length: 1000 }, (_, index) => ({
			id: `ordinary-${index}`,
			email: `ordinary-${index}@example.com`,
			created_at: actorCreatedAt,
			user_metadata: {}
		}));
		const adapter = createSupabaseHostedInspectionAdapter({
			projectRef: HOSTED_STAGING.projectRef,
			serviceClient: createInspectorServiceClient({
				authPages: {
					1: { users: fillerUsers, total: 1001, lastPage: 99 },
					2: { users: [], total: 1001, lastPage: 99 }
				}
			}) as never
		});

		await expect(
			adapter.inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest: gate3Manifest(),
				expectedIdentities
			})
		).rejects.toThrow('hosted_inspection_failed');
	});

	it('paginates every multirow hosted table and preserves the 100-ID query boundary', async () => {
		const foreignUsers = Array.from({ length: 101 }, (_, index) => ({
			id: `foreign-${index}`,
			email: `gate3-v1-foreign-${index}-${index.toString(16).padStart(16, '0')}@example.invalid`,
			created_at: actorCreatedAt,
			user_metadata: {}
		}));
		const reports = Array.from({ length: 1001 }, (_, index) => ({
			id: `report-${index}`,
			reporter_id: foreignUsers[0]?.id,
			target_id: actorIds.reporter,
			evidence_paths: [],
			status: 'open',
			assigned_to: null
		}));
		const uploads = Array.from({ length: 1001 }, (_, index) => ({
			id: `upload-${index}`,
			uploader_id: foreignUsers[0]?.id,
			storage_path: `${foreignUsers[0]?.id}/${index}.webp`,
			status: 'pending',
			report_id: null
		}));
		const queueRows = Array.from({ length: 1001 }, (_, index) => ({
			id: index + 1,
			storage_path: `${foreignUsers[0]?.id}/${index}.webp`,
			report_evidence_upload_id: uploads[index]?.id,
			upload_id: null
		}));
		const queryCalls: Array<Record<string, unknown>> = [];
		const client = createInspectorServiceClient({
			users: foreignUsers,
			rows: {
				profiles: foreignUsers.map((user) => ({ id: user.id })),
				reports,
				report_evidence_uploads: uploads,
				upload_cleanup_queue: queueRows
			},
			queryCalls
		});
		const adapter = createSupabaseHostedInspectionAdapter({
			projectRef: HOSTED_STAGING.projectRef,
			serviceClient: client as never
		});

		await expect(
			adapter.inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest: gate3Manifest(),
				expectedIdentities
			})
		).resolves.toMatchObject({
			foreignCounts: { profiles: 101, reports: 1001, uploads: 1001, queueRows: 1001 }
		});
		expect(
			queryCalls.filter(
				(call) => call.table === 'profiles' && call.from === 0 && call.to === 999
			)
		).toHaveLength(2);
		expect(queryCalls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ table: 'reports', from: 1000, to: 1999 }),
				expect.objectContaining({ table: 'report_evidence_uploads', from: 1000, to: 1999 }),
				expect.objectContaining({ table: 'upload_cleanup_queue', from: 1000, to: 1999 })
			])
		);
	});

	it('includes foreign rows beyond the first PostgREST page in the preservation fingerprint', async () => {
		const foreign = {
			id: 'foreign-owner',
			email: 'gate3-v1-foreign-0000000000000001@example.invalid',
			created_at: actorCreatedAt,
			user_metadata: {}
		};
		const inspect = async (tailId: string) =>
			createSupabaseHostedInspectionAdapter({
				projectRef: HOSTED_STAGING.projectRef,
				serviceClient: createInspectorServiceClient({
					users: [foreign],
					rows: {
						reports: Array.from({ length: 1001 }, (_, index) => ({
							id: index === 1000 ? tailId : `foreign-report-${index}`,
							reporter_id: foreign.id
						}))
					}
				}) as never
			}).inspectRun({
				runId: inspectorRunId,
				createdAfter: '2026-08-09T11:59:00.000Z',
				manifest: gate3Manifest(),
				expectedIdentities
			});

		const before = await inspect('foreign-tail-a');
		const after = await inspect('foreign-tail-b');
		expect(before.foreignCounts.reports).toBe(1001);
		expect(after.foreignCounts.reports).toBe(1001);
		expect(before.foreignEvidenceSha256).not.toBe(after.foreignEvidenceSha256);
	});
});

it('accepts Supabase microsecond actor timestamps without normalization', () => {
	const config = validateHostedOperatorEnvironment(baseEnvironment);
	const createdAt = '2026-08-09T12:00:00.123456Z';

	const manifest = registerHostedActor(
		createHostedRunManifest(config),
		'reporter',
		actorIds.reporter,
		createdAt
	);

	expect(manifest.actors).toHaveLength(1);
	expect(manifest.actors[0]?.createdAt).toBe(createdAt);
});

it.each([
	'2026-02-30T12:00:00Z',
	'2026-08-09T24:00:00Z',
	'2026-08-09T12:00:00.1234567Z',
	'2026-08-09T12:00:00+00:00',
	'2026-08-09 12:00:00Z'
])('rejects unsupported actor timestamp %s', (createdAt) => {
	const config = validateHostedOperatorEnvironment(baseEnvironment);

	expect(() =>
		registerHostedActor(
			createHostedRunManifest(config),
			'reporter',
			actorIds.reporter,
			createdAt
		)
	).toThrow(/actor provisioning timestamp is invalid/u);
});

describe('hosted report-evidence target lock', () => {
	it('distinguishes exact primary-report absence and requires same-origin HTTP 200 transport evidence', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = completeActorManifest(config as never);
		const rows: Record<string, Array<Record<string, unknown>>> = { reports: [], report_evidence_uploads: [] };
		const reportId = '99999999-9999-4999-8999-999999999999';
		const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const objectPath = `${actorIds.reporter}/${uploadId}.webp`;
		const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
		const serviceClient = {
			supabaseUrl: HOSTED_STAGING.supabaseUrl,
			from(table: string) {
				const filters: Array<(row: Record<string, unknown>) => boolean> = [];
				const query: Record<string, unknown> = {
					select: () => query,
					eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
					in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
					like: (key: string, pattern: string) => { const prefix = pattern.replace(/%$/u, ''); filters.push((row) => String(row[key] ?? '').startsWith(prefix)); return query; },
					gte: () => query,
					then: (resolve: (value: unknown) => unknown) => resolve({ data: (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))), error: null })
				};
				return query;
			},
			storage: { from: () => ({ list: vi.fn(async (prefix: string) => ({ data: prefix === actorIds.reporter ? [{ name: `${uploadId}.webp`, created_at: actorCreatedAt, metadata: { size: 68, mimetype: 'image/webp' } }] : [], error: null })) }) },
			auth: { admin: { getUserById: vi.fn(async (id: string) => ({ data: { user: provisionedUser(Object.entries(actorIds).find(([, userId]) => userId === id)?.[0] as keyof typeof actorIds, id) }, error: null })) } }
		};
		const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: actorIds.reporter, aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.${Buffer.from('signature').toString('base64url')}`;
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : String(input);
			const actorScopeResponse = actorAuthorizationRead(input, init);
			if (actorScopeResponse) return actorScopeResponse;
			if (url.includes('/auth/v1/token')) return new Response(JSON.stringify({ access_token: jwt, refresh_token: 'refresh-token-value', expires_in: 3600, token_type: 'bearer', user: { id: actorIds.reporter, email: actorEnvironment.E2E_REAL_REPORTER_EMAIL } }), { status: 200, headers: { 'content-type': 'application/json' } });
			if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: actorIds.reporter, email: actorEnvironment.E2E_REAL_REPORTER_EMAIL }), { status: 200, headers: { 'content-type': 'application/json' } });
			if (url.endsWith('/report')) {
				expect(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('origin')).toBe(HOSTED_STAGING.workerOrigin);
				rows.reports.push({ id: reportId, reporter_id: actorIds.reporter, target_id: actorIds['cross-user'], details: `Synthetic Gate 3 evidence ${config.runId}`, evidence_paths: [objectPath], status: 'open', assigned_to: null, created_at: actorCreatedAt });
				rows.report_evidence_uploads.push({ id: uploadId, uploader_id: actorIds.reporter, storage_path: objectPath, status: 'attached', source_byte_size: 68, actual_content_hash: 'a'.repeat(64), actual_byte_size: 68, actual_mime_type: 'image/webp', width_px: 1, height_px: 1, report_id: reportId, finalized_at: actorCreatedAt, attached_at: actorCreatedAt });
				return new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-deployed-git-sha': 'a'.repeat(40) } });
			}
			throw new Error('unexpected request');
		});
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
		const context = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: fetchImpl as never });
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
		const coordinates = { runId: config.runId, projectRef: HOSTED_STAGING.projectRef, supabaseUrl: HOSTED_STAGING.supabaseUrl, workerOrigin: HOSTED_STAGING.workerOrigin, releaseCommitSha: 'a'.repeat(40), stateRevision: 7, stateSha256: 'b'.repeat(64), manifestPath: 'C:/private/gate3-run-manifest.json', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), inspectionNonce: 'c'.repeat(64), checkpointObservedAfter: '2026-08-22T19:00:00.000Z' };
		const grant = a10CapabilityGrant(coordinates, 0);
		const capability = bindHostedA10CheckpointCapability(context, { grant, manifestBytes });
		expect(() => bindHostedA10CheckpointCapability(context, { grant, manifestBytes })).toThrow(/scenario authorization is invalid/u);
		await capability.mutation?.();
		await expect(capability.readBack({ mutationAttempted: true, mutationFailed: false })).resolves.toMatchObject({
			outcome: 'confirmed',
			receipt: { boundary: 'HTTP', actualResult: 'HTTP 200', requestId }
		});
		await expect(capability.mutation?.()).rejects.toThrow(/scenario capability is already consumed/u);
		await expect(capability.readBack({ mutationAttempted: true, mutationFailed: false })).rejects.toThrow(/scenario capability is already consumed/u);
		expect(fetchImpl.mock.calls.filter(([input]) => String(input).endsWith('/report'))).toHaveLength(1);

		const readBackFirst = bindHostedA10CheckpointCapability(context, { grant: a10CapabilityGrant(coordinates, 0), manifestBytes });
		await expect(readBackFirst.readBack({ mutationAttempted: false, mutationFailed: false })).rejects.toThrow(/scenario capability is already consumed/u);
		await expect(readBackFirst.mutation?.()).rejects.toThrow(/scenario capability is already consumed/u);
		expect(fetchImpl.mock.calls.filter(([input]) => String(input).endsWith('/report'))).toHaveLength(1);

		const racing = bindHostedA10CheckpointCapability(context, { grant: a10CapabilityGrant(coordinates, 0), manifestBytes });
		const raceResults = await Promise.allSettled([
			racing.mutation?.(),
			racing.readBack({ mutationAttempted: true, mutationFailed: false })
		]);
		expect(raceResults.map(({ status }) => status)).toEqual(['fulfilled', 'rejected']);
		expect(fetchImpl.mock.calls.filter(([input]) => String(input).endsWith('/report'))).toHaveLength(2);
		await expect(racing.readBack({ mutationAttempted: true, mutationFailed: false })).rejects.toThrow(/scenario capability is already consumed/u);

		const reusedProvider = freshReportTokenProvider(async () => `turnstile-reused-${'x'.repeat(24)}`);
		const reusedContext = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: reusedProvider, fetchImpl: fetchImpl as never });
		const firstReuse = bindHostedA10CheckpointCapability(reusedContext, { grant: a10CapabilityGrant(coordinates, 0), manifestBytes });
		const secondReuse = bindHostedA10CheckpointCapability(reusedContext, { grant: a10CapabilityGrant(coordinates, 0), manifestBytes });
		const beforeReusePosts = fetchImpl.mock.calls.filter(([input]) => String(input).endsWith('/report')).length;
		await firstReuse.mutation?.();
		await expect(secondReuse.mutation?.()).rejects.toThrow(/exact scenario operation failed/u);
		expect(reusedProvider.freshReportToken).toHaveBeenCalledTimes(2);
		expect(fetchImpl.mock.calls.filter(([input]) => String(input).endsWith('/report'))).toHaveLength(beforeReusePosts + 1);

		for (const attack of ['demoted-role', 'suspended', 'inactive-membership'] as const) {
			const attackedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
				if (path === '/rest/v1/profiles') return new Response(JSON.stringify([{ id: actorIds.reporter, role: attack === 'demoted-role' ? 'moderator' : 'user', is_suspended: attack === 'suspended' }]), { status: 200, headers: { 'content-type': 'application/json' } });
				if (path === '/rest/v1/beta_memberships') return new Response(JSON.stringify([{ profile_id: actorIds.reporter, status: attack === 'inactive-membership' ? 'inactive' : 'active', onboarding_completed_at: actorCreatedAt }]), { status: 200, headers: { 'content-type': 'application/json' } });
				return fetchImpl(input, init);
			});
			const attackedContext = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: attackedFetch as never });
			const attackedCapability = bindHostedA10CheckpointCapability(attackedContext, { grant: a10CapabilityGrant(coordinates, 0), manifestBytes });
			const postCount = fetchImpl.mock.calls.filter(([input]) => String(input).endsWith('/report')).length;
			await expect(attackedCapability.mutation?.()).rejects.toThrow(/exact scenario operation failed/u);
			expect(fetchImpl.mock.calls.filter(([input]) => String(input).endsWith('/report'))).toHaveLength(postCount);
		}
	});

	it.each([403, 302, 500, 'network', 'missing-request-id', 'invalid-request-id', 'missing-release', 'mismatch-release'])('never confirms primary-report transport status %s as absence or success', async (status) => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = completeActorManifest(config as never);
		const reportId = '99999999-9999-4999-8999-999999999999';
		const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const objectPath = `${actorIds.reporter}/${uploadId}.webp`;
		const rows: Record<string, Array<Record<string, unknown>>> = { reports: [], report_evidence_uploads: [] };
		const serviceClient = {
			supabaseUrl: HOSTED_STAGING.supabaseUrl,
			from(table: string) {
				const filters: Array<[string, unknown]> = [];
				const query: Record<string, unknown> = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; }, gte: () => query, then: (resolve: (value: unknown) => unknown) => resolve({ data: (rows[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value)), error: null }) };
				return query;
			},
			storage: { from: () => ({ list: vi.fn(async () => ({ data: rows.reports.length > 0 ? [{ name: `${uploadId}.webp`, created_at: actorCreatedAt, metadata: { size: 68, mimetype: 'image/webp' } }] : [], error: null })) }) },
			auth: { admin: { getUserById: vi.fn() } }
		};
		const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: actorIds.reporter, aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.${Buffer.from('signature').toString('base64url')}`;
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : String(input);
			const actorScopeResponse = actorAuthorizationRead(input, init);
			if (actorScopeResponse) return actorScopeResponse;
			if (url.includes('/auth/v1/token')) return new Response(JSON.stringify({ access_token: jwt, refresh_token: 'refresh-token-value', expires_in: 3600, token_type: 'bearer', user: { id: actorIds.reporter, email: actorEnvironment.E2E_REAL_REPORTER_EMAIL } }), { status: 200, headers: { 'content-type': 'application/json' } });
			if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: actorIds.reporter, email: actorEnvironment.E2E_REAL_REPORTER_EMAIL }), { status: 200, headers: { 'content-type': 'application/json' } });
			expect(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('origin')).toBe(HOSTED_STAGING.workerOrigin);
			if (status === 'network') throw new Error('private provider network failure');
			if (status === 'missing-request-id') return new Response('', { status: 200, headers: { 'x-deployed-git-sha': 'a'.repeat(40) } });
			if (status === 'invalid-request-id') return new Response('', { status: 200, headers: { 'x-request-id': 'private-provider-token', 'x-deployed-git-sha': 'a'.repeat(40) } });
			if (status === 'missing-release' || status === 'mismatch-release') {
				rows.reports.push({ id: reportId, reporter_id: actorIds.reporter, target_id: actorIds['cross-user'], details: `Synthetic Gate 3 evidence ${config.runId}`, evidence_paths: [objectPath], status: 'open', assigned_to: null, created_at: actorCreatedAt });
				rows.report_evidence_uploads.push({ id: uploadId, uploader_id: actorIds.reporter, storage_path: objectPath, status: 'attached', report_id: reportId });
				return new Response('', { status: 200, headers: { 'x-request-id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ...(status === 'mismatch-release' ? { 'x-deployed-git-sha': 'f'.repeat(40) } : {}) } });
			}
			return new Response('', { status: Number(status), headers: { 'x-request-id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'x-deployed-git-sha': 'a'.repeat(40) } });
		});
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
		const context = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: fetchImpl as never });
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
		const coordinates = { runId: config.runId, projectRef: HOSTED_STAGING.projectRef, supabaseUrl: HOSTED_STAGING.supabaseUrl, workerOrigin: HOSTED_STAGING.workerOrigin, releaseCommitSha: 'a'.repeat(40), stateRevision: 7, stateSha256: 'b'.repeat(64), manifestPath: 'C:/private/gate3-run-manifest.json', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), inspectionNonce: 'c'.repeat(64), checkpointObservedAfter: '2026-08-22T19:00:00.000Z' };
		const capability = bindHostedA10CheckpointCapability(context, { grant: a10CapabilityGrant(coordinates, 0), manifestBytes });
		await expect(capability.mutation?.()).rejects.toThrow(/exact scenario operation failed/u);
		await expect(capability.readBack({ mutationAttempted: true, mutationFailed: true })).resolves.toMatchObject({ outcome: 'uncertain' });
	});

	it.each([
		['upload', true, false, false],
		['object', false, true, false],
		['queue', false, false, true],
		['compound', true, true, true]
	] as const)('treats report-absent residual %s evidence as uncertain before any POST', async (_label, withUpload, withObject, withQueue) => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = completeActorManifest(config as never);
		const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const path = `${actorIds.reporter}/${uploadId}.webp`;
		const rows: Record<string, Array<Record<string, unknown>>> = {
			reports: [],
			report_evidence_uploads: withUpload ? [{ id: uploadId, uploader_id: actorIds.reporter, storage_path: path }] : [],
			upload_cleanup_queue: withQueue ? [{ id: 17, storage_path: path, report_evidence_upload_id: uploadId, processed_at: null }] : []
		};
		const users = Object.fromEntries(Object.entries(actorIds).map(([role, id]) => [id, provisionedUser(role as keyof typeof actorIds, id)]));
		const serviceClient = {
			supabaseUrl: HOSTED_STAGING.supabaseUrl,
			auth: { admin: { getUserById: vi.fn(async (id: string) => ({ data: { user: users[id] }, error: null })), listUsers: vi.fn(async () => ({ data: { users: [], lastPage: 1 }, error: null })) } },
			from(table: string) {
				const filters: Array<(row: Record<string, unknown>) => boolean> = [];
				const query: Record<string, any> = {
					select: () => query,
					eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
					gte: () => query,
					in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
					like: (key: string, pattern: string) => { const prefix = pattern.replace(/%$/u, ''); filters.push((row) => String(row[key] ?? '').startsWith(prefix)); return query; },
					order: () => query,
					limit: () => query,
					maybeSingle: async () => { const data = (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))); return { data: data.length === 1 ? data[0] : null, error: data.length > 1 ? { code: 'ambiguous' } : null }; },
					then: (resolve: (value: unknown) => unknown) => resolve({ data: (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))), error: null })
				};
				return query;
			},
			storage: { from: () => ({ list: vi.fn(async (prefix: string) => ({ data: withObject && prefix === actorIds.reporter ? [{ name: `${uploadId}.webp` }] : [], error: null })) }) }
		};
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
		const operationTrap = vi.fn(async () => { throw new Error('POST must not run'); });
		const context = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: operationTrap as never });
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
		const coordinates = { runId: config.runId, projectRef: HOSTED_STAGING.projectRef, supabaseUrl: HOSTED_STAGING.supabaseUrl, workerOrigin: HOSTED_STAGING.workerOrigin, releaseCommitSha: 'a'.repeat(40), stateRevision: 7, stateSha256: 'b'.repeat(64), manifestPath: 'C:/private/gate3-run-manifest.json', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), inspectionNonce: 'c'.repeat(64), checkpointObservedAfter: '2026-08-22T19:00:00.000Z' };
		const inspection = a10LifecycleFacts(coordinates, 0);
		const probe = selectNextScenarioProbe(inspection, A10_STEP_REGISTRY, a10LifecycleEvidence(coordinates, 0));
		await expect(inspectHostedA10CheckpointEvidence(context, { probe, manifestBytes })).resolves.toMatchObject({ outcome: 'uncertain' });
		expect(operationTrap).not.toHaveBeenCalled();
	});

	it.each([
		['report-upload-no-object', 'attached', 'exact', false, false, false],
		['wrong-object', 'attached', 'exact', true, false, true],
		['wrong-status', 'pending', 'exact', true, false, false],
		['wrong-link', 'attached', 'wrong', true, false, false],
		['wrong-metadata', 'attached', 'exact', true, true, false]
	] as const)('treats an existing incomplete primary boundary %s as uncertain and never authorizes POST', async (_label, status, linkage, withObject, wrongMetadata, wrongObject) => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = completeActorManifest(config as never);
		const reportId = '99999999-9999-4999-8999-999999999999';
		const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const objectPath = `${actorIds.reporter}/${uploadId}.webp`;
		const rows: Record<string, Array<Record<string, unknown>>> = {
			reports: [{ id: reportId, reporter_id: actorIds.reporter, target_id: actorIds['cross-user'], details: `Synthetic Gate 3 evidence ${config.runId}`, evidence_paths: [objectPath], status: 'open', assigned_to: null, created_at: actorCreatedAt }],
			report_evidence_uploads: [{ id: uploadId, uploader_id: actorIds.reporter, storage_path: objectPath, status, source_byte_size: 68, actual_content_hash: wrongMetadata ? 'invalid' : 'a'.repeat(64), actual_byte_size: wrongMetadata ? null : 68, actual_mime_type: 'image/webp', width_px: 1, height_px: 1, report_id: linkage === 'exact' ? reportId : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', created_at: actorCreatedAt, updated_at: actorCreatedAt, expires_at: '2026-08-22T21:00:00.000Z', finalized_at: actorCreatedAt, attached_at: actorCreatedAt }],
			upload_cleanup_queue: []
		};
		const users = Object.fromEntries(Object.entries(actorIds).map(([role, id]) => [id, provisionedUser(role as keyof typeof actorIds, id)]));
		const serviceClient = {
			supabaseUrl: HOSTED_STAGING.supabaseUrl,
			auth: { admin: { getUserById: vi.fn(async (id: string) => ({ data: { user: users[id] }, error: null })), listUsers: vi.fn(async () => ({ data: { users: [], lastPage: 1 }, error: null })) } },
			from(table: string) {
				const filters: Array<(row: Record<string, unknown>) => boolean> = [];
				const query: Record<string, any> = {
					select: () => query,
					eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
					gte: () => query,
					in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
					like: (key: string, pattern: string) => { const prefix = pattern.replace(/%$/u, ''); filters.push((row) => String(row[key] ?? '').startsWith(prefix)); return query; },
					order: () => query,
					limit: () => query,
					maybeSingle: async () => { const data = (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))); return { data: data.length === 1 ? data[0] : null, error: data.length > 1 ? { code: 'ambiguous' } : null }; },
					then: (resolve: (value: unknown) => unknown) => resolve({ data: (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))), error: null })
				};
				return query;
			},
			storage: { from: () => ({ list: vi.fn(async () => ({ data: withObject ? [{ name: `${uploadId}.webp`, created_at: actorCreatedAt, updated_at: actorCreatedAt, metadata: { size: wrongObject ? 69 : 68, mimetype: 'image/webp' } }] : [], error: null })) }) }
		};
		const operationTrap = vi.fn(async () => { throw new Error('POST must not run'); });
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
		const context = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: operationTrap as never });
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
		const coordinates = { runId: config.runId, projectRef: HOSTED_STAGING.projectRef, supabaseUrl: HOSTED_STAGING.supabaseUrl, workerOrigin: HOSTED_STAGING.workerOrigin, releaseCommitSha: 'a'.repeat(40), stateRevision: 7, stateSha256: 'b'.repeat(64), manifestPath: 'C:/private/gate3-run-manifest.json', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), inspectionNonce: 'c'.repeat(64), checkpointObservedAfter: '2026-08-22T19:00:00.000Z' };
		const probe = selectNextScenarioProbe(a10LifecycleFacts(coordinates, 0), A10_STEP_REGISTRY, a10LifecycleEvidence(coordinates, 0));
		await expect(inspectHostedA10CheckpointEvidence(context, { probe, manifestBytes })).resolves.toMatchObject({ outcome: 'uncertain' });
		expect(operationTrap).not.toHaveBeenCalled();
	});

	it.each([
		['duplicate', 4, 'pending-upload', 'pending', true, false, false, 'confirmed'],
		['duplicate', 4, 'finalized-upload', 'attached', true, false, false, 'uncertain'],
		['duplicate', 4, 'rejected-upload', 'rejected', true, false, false, 'uncertain'],
		['duplicate', 4, 'expired-upload', 'expired', true, false, false, 'uncertain'],
		['duplicate', 4, 'object-only', 'pending', false, true, false, 'uncertain'],
		['duplicate', 4, 'queue-only', 'pending', false, false, true, 'uncertain'],
		['rejected', 10, 'pending-upload', 'pending', true, false, false, 'uncertain'],
		['rejected', 10, 'finalized-upload', 'attached', true, false, false, 'uncertain'],
		['rejected', 10, 'rejected-upload', 'rejected', true, false, false, 'uncertain'],
		['rejected', 10, 'expired-upload', 'expired', true, false, false, 'uncertain'],
		['rejected', 10, 'object-only', 'pending', false, true, false, 'uncertain'],
		['rejected', 10, 'queue-only', 'pending', false, false, true, 'uncertain']
	] as const)('does not treat %s checkpoint residual %s as clean status-filtered absence', async (boundary, checkpointIndex, _label, residualStatus, withUpload, withObject, withQueue, expectedOutcome) => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const primaryReportId = '99999999-9999-4999-8999-999999999999';
		const primaryUploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const duplicateUploadId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
		const residualUploadId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
		let manifest = completeActorManifest(config as never);
		manifest = registerHostedUpload(registerHostedReport(manifest, primaryReportId, 'reporter'), primaryUploadId, 'reporter', `${actorIds.reporter}/${primaryUploadId}.webp`);
		if (boundary === 'rejected') {
			manifest = registerHostedQueueRow(registerHostedUpload(manifest, duplicateUploadId, 'reporter', `${actorIds.reporter}/${duplicateUploadId}.webp`), 17, duplicateUploadId);
		}
		const residualPath = `${actorIds.reporter}/${residualUploadId}.webp`;
		const rows: Record<string, Array<Record<string, unknown>>> = {
			reports: [{ id: primaryReportId, reporter_id: actorIds.reporter }],
			report_evidence_uploads: [
				{ id: primaryUploadId, uploader_id: actorIds.reporter, storage_path: `${actorIds.reporter}/${primaryUploadId}.webp`, status: 'attached', source_byte_size: 68 },
				...(boundary === 'rejected' ? [{ id: duplicateUploadId, uploader_id: actorIds.reporter, storage_path: `${actorIds.reporter}/${duplicateUploadId}.webp`, status: 'rejected', source_byte_size: 68 }] : []),
				...(withUpload ? [{ id: residualUploadId, uploader_id: actorIds.reporter, storage_path: residualPath, status: residualStatus, source_byte_size: 68, report_id: null, created_at: '2026-08-22T20:00:01.000Z', finalized_at: residualStatus === 'attached' ? actorCreatedAt : null, attached_at: residualStatus === 'attached' ? actorCreatedAt : null }] : [])
			],
			upload_cleanup_queue: [
				...(boundary === 'rejected' ? [{ id: 17, storage_path: `${actorIds.reporter}/${duplicateUploadId}.webp`, report_evidence_upload_id: duplicateUploadId, processed_at: actorCreatedAt }] : []),
				...(withQueue ? [{ id: 18, storage_path: residualPath, report_evidence_upload_id: residualUploadId, bucket_id: 'report-evidence', processed_at: null }] : [])
			]
		};
		const users = Object.fromEntries(Object.entries(actorIds).map(([role, id]) => [id, provisionedUser(role as keyof typeof actorIds, id)]));
		const serviceClient = {
			supabaseUrl: HOSTED_STAGING.supabaseUrl,
			auth: { admin: { getUserById: vi.fn(async (id: string) => ({ data: { user: users[id] }, error: null })), listUsers: vi.fn(async () => ({ data: { users: [], lastPage: 1 }, error: null })) } },
			from(table: string) {
				const filters: Array<(row: Record<string, unknown>) => boolean> = [];
				const query: Record<string, any> = {
					select: () => query,
					eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
					gte: (key: string, value: string) => { filters.push((row) => Date.parse(String(row[key])) >= Date.parse(value)); return query; },
					in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
					like: (key: string, pattern: string) => { const prefix = pattern.replace(/%$/u, ''); filters.push((row) => String(row[key] ?? '').startsWith(prefix)); return query; },
					order: () => query,
					limit: () => query,
					maybeSingle: async () => { const data = (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))); return { data: data.length === 1 ? data[0] : null, error: data.length > 1 ? { code: 'ambiguous' } : null }; },
					then: (resolve: (value: unknown) => unknown) => resolve({ data: (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))), error: null })
				};
				return query;
			},
			storage: { from: () => ({ list: vi.fn(async (prefix: string) => ({ data: [
				...(prefix === actorIds.reporter ? [{ name: `${primaryUploadId}.webp` }] : []),
				...(withObject && prefix === actorIds.reporter ? [{ name: `${residualUploadId}.webp` }] : [])
			], error: null })) }) }
		};
		const operationTrap = vi.fn(async () => { throw new Error('mutation must not run during inspection'); });
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
		const context = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: operationTrap as never });
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
		const coordinates = { runId: config.runId, projectRef: HOSTED_STAGING.projectRef, supabaseUrl: HOSTED_STAGING.supabaseUrl, workerOrigin: HOSTED_STAGING.workerOrigin, releaseCommitSha: 'a'.repeat(40), stateRevision: 7, stateSha256: 'b'.repeat(64), manifestPath: 'C:/private/gate3-run-manifest.json', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), inspectionNonce: 'c'.repeat(64), checkpointObservedAfter: '2026-08-22T19:00:00.000Z' };
		const probe = selectNextScenarioProbe(a10LifecycleFacts(coordinates, checkpointIndex), A10_STEP_REGISTRY, a10LifecycleEvidence(coordinates, checkpointIndex));
		await expect(inspectHostedA10CheckpointEvidence(context, { probe, manifestBytes })).resolves.toMatchObject({ outcome: expectedOutcome });
		expect(operationTrap).not.toHaveBeenCalled();
	});

	it.each([
		[400, 'current', 'exact', false],
		[401, 'current', 'exact', false],
		[403, 'staging', 'exact', true],
		[403, 'current', 'exact', true],
		[403, 'legacy', 'exact', true],
		[404, 'current', 'exact', true],
		[404, 'legacy', 'exact', true],
		[429, 'current', 'exact', false],
		[500, 'current', 'exact', false],
		[403, 'empty', 'exact', false],
		[403, 'current', 'wrong-size', false],
		[403, 'current', 'wrong-hash', false],
		['network', 'current', 'exact', false]
	] as const)('accepts only an exact authenticated storage denial with byte-bound reporter control: %s/%s/%s', async (storageStatus, bodyKind, positiveKind, expectedConfirmed) => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const fixtureBytes = Buffer.from('fixture-bytes');
		let manifest = completeActorManifest(config as never);
		manifest = registerHostedUpload(manifest, uploadId, 'reporter', `${actorIds.reporter}/${uploadId}.webp`);
		const serviceClient = {
			supabaseUrl: HOSTED_STAGING.supabaseUrl,
			from: vi.fn((table: string) => {
				const query: Record<string, unknown> = {
					select: () => query,
					eq: () => query,
					maybeSingle: async () => ({ data: { id: uploadId, actual_byte_size: fixtureBytes.length, actual_content_hash: positiveKind === 'wrong-hash' ? 'f'.repeat(64) : createHash('sha256').update(fixtureBytes).digest('hex') }, error: null })
				};
				return query;
			}),
			storage: { from: vi.fn() },
			auth: { admin: { getUserById: vi.fn(async (id: string) => {
				const actor = Object.entries(actorIds).find(([, actorId]) => actorId === id);
				return { data: { user: actor ? provisionedUser(actor[0] as keyof typeof actorIds, id) : null }, error: null };
			}) } }
		};
		const jwtFor = (actorId: string) => `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: actorId, aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.${Buffer.from('signature').toString('base64url')}`;
		const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
		let deniedReads = 0;
		let positiveReads = 0;
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : String(input);
			const actorScopeResponse = actorAuthorizationRead(input, init);
			if (actorScopeResponse) return actorScopeResponse;
			const authorization = new Headers(init?.headers).get('authorization');
			const isReporter = authorization === `Bearer ${jwtFor(actorIds.reporter)}`;
			if (url.includes('/auth/v1/token')) {
				const body = JSON.parse(String(init?.body ?? '{}')) as { email?: string };
				const reporter = body.email === actorEnvironment.E2E_REAL_REPORTER_EMAIL;
				const id = reporter ? actorIds.reporter : actorIds['cross-user'];
				const email = reporter ? actorEnvironment.E2E_REAL_REPORTER_EMAIL : actorEnvironment.E2E_REAL_CROSS_USER_EMAIL;
				return new Response(JSON.stringify({ access_token: jwtFor(id), refresh_token: 'refresh-token-value', expires_in: 3600, token_type: 'bearer', user: { id, email } }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (url.endsWith('/auth/v1/user')) {
				const id = isReporter ? actorIds.reporter : actorIds['cross-user'];
				const email = isReporter ? actorEnvironment.E2E_REAL_REPORTER_EMAIL : actorEnvironment.E2E_REAL_CROSS_USER_EMAIL;
				return new Response(JSON.stringify({ id, email }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			expect(url).toBe(`${HOSTED_STAGING.supabaseUrl}/storage/v1/object/authenticated/report-evidence/${actorIds.reporter}/${uploadId}.webp`);
			if (isReporter) {
				positiveReads += 1;
				const bytes = positiveKind === 'wrong-size' ? Buffer.from('wrong') : fixtureBytes;
				return new Response(bytes, { status: 200, headers: { 'sb-request-id': 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } });
			}
			deniedReads += 1;
			if (storageStatus === 'network') throw new Error('private provider network failure');
			const body = bodyKind === 'staging'
				? { statusCode: String(storageStatus), error: 'Unauthorized' }
				: bodyKind === 'legacy'
					? { httpStatusCode: storageStatus, code: storageStatus === 404 ? 'NoSuchKey' : 'AccessDenied', message: storageStatus === 404 ? 'Object not found' : 'Unauthorized' }
					: bodyKind === 'empty'
						? {}
						: { code: storageStatus === 404 ? 'NoSuchKey' : 'AccessDenied', message: storageStatus === 404 ? 'Object not found' : 'Unauthorized' };
			return new Response(JSON.stringify(body), {
				status: storageStatus,
				headers: { 'content-type': 'application/json', 'sb-request-id': requestId, 'x-request-id': 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }
			});
		});
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
		const context = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: fetchImpl as never });
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
		const coordinates = { runId: config.runId, projectRef: HOSTED_STAGING.projectRef, supabaseUrl: HOSTED_STAGING.supabaseUrl, workerOrigin: HOSTED_STAGING.workerOrigin, releaseCommitSha: 'a'.repeat(40), stateRevision: 7, stateSha256: 'b'.repeat(64), manifestPath: 'C:/private/gate3-run-manifest.json', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), inspectionNonce: 'c'.repeat(64), checkpointObservedAfter: '2026-08-22T19:00:00.000Z' };
		const inspection = a10LifecycleFacts(coordinates, 2);
		const probe = selectNextScenarioProbe(inspection, A10_STEP_REGISTRY, a10LifecycleEvidence(coordinates, 2));
		await expect(inspectHostedA10CheckpointEvidence(context, { probe, manifestBytes })).resolves.toMatchObject({ outcome: positiveKind === 'exact' || positiveKind === 'wrong-hash' ? (positiveKind === 'exact' ? 'confirmed-absent' : 'uncertain') : 'uncertain' });
		expect(deniedReads).toBe(0);
		expect(positiveReads).toBe(1);
		const capability = bindHostedA10CheckpointCapability(context, { grant: a10CapabilityGrant(coordinates, 2), manifestBytes });
		if (expectedConfirmed) {
			await capability.mutation?.();
			await expect(capability.readBack({ mutationAttempted: true, mutationFailed: false })).resolves.toMatchObject({ outcome: 'confirmed', receipt: { boundary: 'Storage', actualResult: 'Storage denied non-2xx', requestId } });
			expect(positiveReads).toBe(2);
		} else {
			await expect(capability.mutation?.()).rejects.toThrow(/exact scenario operation failed/u);
			await expect(capability.readBack({ mutationAttempted: true, mutationFailed: true })).resolves.toMatchObject({ outcome: 'uncertain' });
			expect(positiveReads).toBe(bodyKind === 'current' && [403].includes(Number(storageStatus)) ? 2 : 1);
		}
		expect(deniedReads).toBe(1);
	});

	it.each([
		[403, '42501', 'report evidence is not a finalized owned object', true],
		[401, 'PGRST301', 'JWT expired', false],
		[409, '23505', 'unrelated duplicate row', false],
		[404, 'PGRST116', 'target missing', false],
		[429, 'PGRST003', 'resource exhausted', false]
	] as const)('accepts only the exact duplicate-reuse database denial: %s/%s', async (status, code, message, expectedConfirmed) => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const reportId = '99999999-9999-4999-8999-999999999999';
		const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const objectPath = `${actorIds.reporter}/${uploadId}.webp`;
		let manifest = completeActorManifest(config as never);
		manifest = registerHostedReport(manifest, reportId, 'reporter');
		manifest = registerHostedUpload(manifest, uploadId, 'reporter', objectPath);
		const actorUsers = Object.entries(actorIds).map(([role, id]) => provisionedUser(role as keyof typeof actorIds, id));
		const serviceClient = {
			supabaseUrl: HOSTED_STAGING.supabaseUrl,
			auth: { admin: { getUserById: vi.fn(async (id: string) => ({ data: { user: actorUsers.find((user) => user.id === id) }, error: null })) } },
			from: vi.fn((table: string) => {
				const query: Record<string, unknown> = {
					select: () => query,
					contains: () => Promise.resolve({ data: [{ id: reportId, reporter_id: actorIds.reporter, evidence_paths: [objectPath] }], error: null })
				};
				return query;
			}),
			storage: { from: vi.fn() }
		};
		const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: actorIds.reporter, aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.${Buffer.from('signature').toString('base64url')}`;
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : String(input);
			const actorScopeResponse = actorAuthorizationRead(input, init);
			if (actorScopeResponse) return actorScopeResponse;
			if (url.includes('/auth/v1/token')) return new Response(JSON.stringify({ access_token: jwt, refresh_token: 'refresh-token-value', expires_in: 3600, token_type: 'bearer', user: { id: actorIds.reporter, email: actorEnvironment.E2E_REAL_REPORTER_EMAIL } }), { status: 200, headers: { 'content-type': 'application/json' } });
			if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: actorIds.reporter, email: actorEnvironment.E2E_REAL_REPORTER_EMAIL }), { status: 200, headers: { 'content-type': 'application/json' } });
			if (url.includes('/rest/v1/reports')) return new Response(JSON.stringify({ code, message, details: null, hint: null }), { status, headers: { 'content-type': 'application/json' } });
			throw new Error('unexpected request');
		});
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
		const context = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: fetchImpl as never });
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
		const coordinates = { runId: config.runId, projectRef: HOSTED_STAGING.projectRef, supabaseUrl: HOSTED_STAGING.supabaseUrl, workerOrigin: HOSTED_STAGING.workerOrigin, releaseCommitSha: 'a'.repeat(40), stateRevision: 7, stateSha256: 'b'.repeat(64), manifestPath: 'C:/private/gate3-run-manifest.json', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), inspectionNonce: 'c'.repeat(64), checkpointObservedAfter: '2026-08-22T19:00:00.000Z' };
		const inspection = a10LifecycleFacts(coordinates, 3);
		const probe = selectNextScenarioProbe(inspection, A10_STEP_REGISTRY, a10LifecycleEvidence(coordinates, 3));
		await expect(inspectHostedA10CheckpointEvidence(context, { probe, manifestBytes })).resolves.toMatchObject({ outcome: 'confirmed-absent' });
		const capability = bindHostedA10CheckpointCapability(context, { grant: a10CapabilityGrant(coordinates, 3), manifestBytes });
		await capability.mutation?.();
		await expect(capability.readBack({ mutationAttempted: true, mutationFailed: false })).resolves.toMatchObject({ outcome: expectedConfirmed ? 'confirmed' : 'uncertain' });
	});

	it('discovers the exact rejected fixture from the checkpoint lower bound and excludes earlier same-size rows', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const oldId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
		const newId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
		const newPath = `${actorIds.reporter}/${newId}.webp`;
		const rows: Record<string, Array<Record<string, unknown>>> = {
			report_evidence_uploads: [
				{ id: oldId, uploader_id: actorIds.reporter, storage_path: `${actorIds.reporter}/${oldId}.webp`, status: 'rejected', source_byte_size: 68, created_at: '2026-08-22T19:59:59.000Z' },
				{ id: newId, uploader_id: actorIds.reporter, storage_path: newPath, status: 'rejected', source_byte_size: 68, created_at: '2026-08-22T20:00:01.000Z' }
			],
			upload_cleanup_queue: [{ id: 18, report_evidence_upload_id: newId, bucket_id: 'report-evidence', storage_path: newPath, processed_at: null }]
		};
		const actorUsers = Object.entries(actorIds).map(([role, id]) => provisionedUser(role as keyof typeof actorIds, id));
		const serviceClient = {
			supabaseUrl: HOSTED_STAGING.supabaseUrl,
			auth: { admin: { getUserById: vi.fn(async (id: string) => ({ data: { user: actorUsers.find((user) => user.id === id) }, error: null })) } },
			from(table: string) {
				const filters: Array<(row: Record<string, unknown>) => boolean> = [];
				const query: Record<string, unknown> = {
					select: () => query,
					eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
					gte: (key: string, value: string) => { filters.push((row) => Date.parse(String(row[key])) >= Date.parse(value)); return query; },
					in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
					like: (key: string, pattern: string) => { const prefix = pattern.replace(/%$/u, ''); filters.push((row) => String(row[key] ?? '').startsWith(prefix)); return query; },
					order: () => query,
					limit: () => query,
					maybeSingle: async () => {
						const data = (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
						return { data: data.length === 1 ? data[0] : null, error: data.length > 1 ? { code: 'ambiguous' } : null };
					},
					then: (resolve: (value: unknown) => unknown) => resolve({ data: (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))), error: null })
				};
				return query;
			},
			storage: { from: () => ({ list: vi.fn(async () => ({ data: [], error: null })) }) }
		};
		let manifest = completeActorManifest(config as never);
		manifest = registerHostedUpload(manifest, oldId, 'reporter', `${actorIds.reporter}/${oldId}.webp`);
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
		const context = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: vi.fn() as never });
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
		const coordinates = { runId: config.runId, projectRef: HOSTED_STAGING.projectRef, supabaseUrl: HOSTED_STAGING.supabaseUrl, workerOrigin: HOSTED_STAGING.workerOrigin, releaseCommitSha: 'a'.repeat(40), stateRevision: 7, stateSha256: 'b'.repeat(64), manifestPath: 'C:/private/gate3-run-manifest.json', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), inspectionNonce: 'c'.repeat(64), checkpointObservedAfter: '2026-08-22T20:00:00.000Z' };
		const inspection = a10LifecycleFacts(coordinates, 10);
		const probe = selectNextScenarioProbe(inspection, A10_STEP_REGISTRY, a10LifecycleEvidence(coordinates, 10));
		await expect(inspectHostedA10CheckpointEvidence(context, { probe, manifestBytes })).resolves.toMatchObject({
			outcome: 'confirmed',
			manifestEvidence: { uploadId: newId, objectPath: newPath, queueId: 18 }
		});
	});

	it.each([
		['malformed', 16, 400, 'Заявката за сигнал е невалидна.'],
		['invalid-image', 17, 400, 'Изображението не можа да бъде проверено и безопасно обработено.'],
		['per-file', 18, 413, 'Общият размер на заявката е твърде голям.'],
		['aggregate', 19, 413, 'Общият размер на заявката е твърде голям.'],
		['chunked', 20, 413, 'Общият размер на заявката е твърде голям.'],
		['understated', 21, 413, 'Общият размер на заявката е твърде голям.']
	] as const)('constructs the exact %s hostile request and requires release-bound reason plus zero side effects', async (kind, checkpointIndex, expectedStatus, expectedReason) => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = completeActorManifest(config as never);
		const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
		const releaseCommitSha = 'a'.repeat(40);
		let responseReason: string = expectedReason;
		const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: actorIds.reporter, aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.${Buffer.from('signature').toString('base64url')}`;
		const actorUsers = Object.entries(actorIds).map(([role, id]) => provisionedUser(role as keyof typeof actorIds, id));
		const serviceClient = {
			supabaseUrl: HOSTED_STAGING.supabaseUrl,
			auth: { admin: { getUserById: vi.fn(async (id: string) => ({ data: { user: actorUsers.find((user) => user.id === id) }, error: null })) } },
			from: vi.fn(() => {
				const query: Record<string, unknown> = { select: () => query, in: () => query, like: () => query, then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }) };
				return query;
			}),
			storage: { from: vi.fn(() => ({ list: vi.fn(async () => ({ data: [], error: null })) })) }
		};
		const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : String(input);
			const actorScopeResponse = actorAuthorizationRead(input, init);
			if (actorScopeResponse) return actorScopeResponse;
			if (url.includes('/auth/v1/token')) return new Response(JSON.stringify({ access_token: jwt, refresh_token: 'refresh-token-value', expires_in: 3600, token_type: 'bearer', user: { id: actorIds.reporter, email: actorEnvironment.E2E_REAL_REPORTER_EMAIL } }), { status: 200, headers: { 'content-type': 'application/json' } });
			if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: actorIds.reporter, email: actorEnvironment.E2E_REAL_REPORTER_EMAIL }), { status: 200, headers: { 'content-type': 'application/json' } });
			fetchCalls.push({ url, init });
			return new Response(responseReason, { status: expectedStatus, headers: { 'x-request-id': requestId, 'x-deployed-git-sha': releaseCommitSha } });
		});
		const rawCalls: Array<{ url: string; options: Record<string, unknown>; bytes: number }> = [];
		const httpsRequestImpl = vi.fn((url: URL, options: Record<string, unknown>, onResponse: (response: unknown) => void) => {
			const call = { url: String(url), options, bytes: 0 };
			rawCalls.push(call);
			const response: Record<string, any> = {
				statusCode: expectedStatus,
				headers: { 'x-request-id': requestId, 'x-deployed-git-sha': releaseCommitSha }
			};
			response.on = (event: string, listener: (chunk: Buffer) => void) => { if (event === 'data') queueMicrotask(() => listener(Buffer.from(responseReason))); return response; };
			response.once = (event: string, listener: () => void) => { if (event === 'end') setTimeout(listener, 0); return response; };
			onResponse(response);
			const request = {
				once: vi.fn(() => request),
				write: vi.fn((bytes: Buffer) => { call.bytes += bytes.length; return true; }),
				end: vi.fn()
			};
			return request;
		});
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
		const context = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: fetchImpl as never, httpsRequestImpl: httpsRequestImpl as never });
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
		const coordinates = { runId: config.runId, projectRef: HOSTED_STAGING.projectRef, supabaseUrl: HOSTED_STAGING.supabaseUrl, workerOrigin: HOSTED_STAGING.workerOrigin, releaseCommitSha, stateRevision: 7, stateSha256: 'b'.repeat(64), manifestPath: 'C:/private/gate3-run-manifest.json', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), inspectionNonce: 'c'.repeat(64), checkpointObservedAfter: '2026-08-22T19:00:00.000Z' };
		const inspection = a10LifecycleFacts(coordinates, checkpointIndex);
		const probe = selectNextScenarioProbe(inspection, A10_STEP_REGISTRY, a10LifecycleEvidence(coordinates, checkpointIndex));
		await expect(inspectHostedA10CheckpointEvidence(context, { probe, manifestBytes })).resolves.toMatchObject({ outcome: 'confirmed-absent' });
		const capability = bindHostedA10CheckpointCapability(context, { grant: a10CapabilityGrant(coordinates, checkpointIndex), manifestBytes });
		await capability.mutation?.();
		await expect(capability.readBack({ mutationAttempted: true, mutationFailed: false })).resolves.toMatchObject({ outcome: 'confirmed', receipt: { boundary: 'HTTP', actualResult: `HTTP ${expectedStatus}`, requestId } });
		if (kind === 'chunked' || kind === 'understated') {
			expect(fetchCalls).toEqual([]);
			expect(rawCalls).toHaveLength(1);
			expect(rawCalls[0]?.url).toBe(`${HOSTED_STAGING.workerOrigin}/report`);
			const headers = new Headers(rawCalls[0]?.options.headers as HeadersInit);
			expect(headers.get('origin')).toBe(HOSTED_STAGING.workerOrigin);
			expect(headers.get(kind === 'chunked' ? 'transfer-encoding' : 'content-length')).toBe(kind === 'chunked' ? 'chunked' : '1024');
			expect(rawCalls[0]?.bytes).toBeGreaterThan(40 * 1024 * 1024);
		} else {
			expect(rawCalls).toEqual([]);
			expect(fetchCalls).toHaveLength(1);
			expect(fetchCalls[0]?.url).toBe(`${HOSTED_STAGING.workerOrigin}/report`);
			expect(fetchCalls[0]?.init?.method).toBe('POST');
			expect(new Headers(fetchCalls[0]?.init?.headers).get('origin')).toBe(HOSTED_STAGING.workerOrigin);
		}
		responseReason = 'Проверката срещу автоматични заявки не беше успешна.';
		const wrongReasonCapability = bindHostedA10CheckpointCapability(context, { grant: a10CapabilityGrant(coordinates, checkpointIndex), manifestBytes });
		await expect(wrongReasonCapability.mutation?.()).rejects.toThrow(/exact scenario operation failed/u);
		await expect(wrongReasonCapability.readBack({ mutationAttempted: true, mutationFailed: true })).resolves.toMatchObject({ outcome: 'uncertain' });

		for (const drift of ['object', 'provenance'] as const) {
			const callsByActor = new Map<string, number>();
			const operationTrap = vi.fn(async () => { throw new Error('mutation must not run'); });
			const driftClient = {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: { admin: { getUserById: vi.fn(async (id: string) => {
					const calls = (callsByActor.get(id) ?? 0) + 1;
					callsByActor.set(id, calls);
					const exact = actorUsers.find((user) => user.id === id);
					return { data: { user: drift === 'provenance' && id === actorIds.reporter && calls > 1 ? { ...exact, user_metadata: {} } : exact }, error: null };
				}) } },
				from: vi.fn(() => {
					const query: Record<string, unknown> = { select: () => query, in: () => query, like: () => query, then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }) };
					return query;
				}),
				storage: { from: vi.fn(() => ({ list: vi.fn(async () => ({ data: drift === 'object' ? [{ name: 'foreign.webp' }] : [], error: null })) })) }
			};
			const driftAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: driftClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
			const driftContext = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters: driftAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: operationTrap as never });
			const driftProbe = selectNextScenarioProbe(inspection, A10_STEP_REGISTRY, a10LifecycleEvidence(coordinates, checkpointIndex));
			await expect(inspectHostedA10CheckpointEvidence(driftContext, { probe: driftProbe, manifestBytes })).resolves.toMatchObject({ outcome: 'uncertain' });
			expect(operationTrap).not.toHaveBeenCalled();
		}
	});

	it('does not export any legacy checkpoint-preselected actor or operator authority', async () => {
		const module = await import('../../scripts/hosted-report-evidence-operator.mjs');
		expect(module).not.toHaveProperty('createHostedA10ActorCapability');
		expect(module).not.toHaveProperty('createHostedA10ScenarioOperator');
		expect(module).not.toHaveProperty('inspectHostedA10ScenarioEvidence');
	});

	it('rejects privileged adapters branded for a different run and service-role keys in the actor path', () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: { supabaseUrl: HOSTED_STAGING.supabaseUrl } as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
		const otherConfig = { ...config, runId: 'gate3-20260809-deadbeef' };
		expect(() => createHostedA10ExecutionContext({ config: otherConfig as never, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: vi.fn() as never })).toThrow(/scenario adapter configuration is invalid/u);
		expect(() => createHostedA10ExecutionContext({ config, publishableKey: 'sb_secret_service-role-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: vi.fn() as never })).toThrow(/scenario publishable key is invalid/u);
	});

	it('binds the complete immutable staging target and rejects wrong configured or actual Supabase URLs before credential use', () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const credentialTrap = vi.fn();
		const wrongServiceAdapters = createSupabaseHostedEvidenceAdapters({
			config,
			serviceClient: { supabaseUrl: 'https://attacker.invalid', auth: new Proxy({}, { get: credentialTrap }) } as never,
			managementAccessToken: 'management-token',
			cleanupSecret: 'x'.repeat(32),
			fetchImpl: vi.fn() as never
		});
		expect(() => createHostedA10ExecutionContext({
			config,
			publishableKey: 'sb_publishable_test-key',
			privilegedAdapters: wrongServiceAdapters,
			reportTokenProvider: freshReportTokenProvider(),
			fetchImpl: vi.fn() as never
		})).toThrow(/scenario adapter configuration is invalid/u);

		const exactAdapters = createSupabaseHostedEvidenceAdapters({
			config,
			serviceClient: { supabaseUrl: HOSTED_STAGING.supabaseUrl } as never,
			managementAccessToken: 'management-token',
			cleanupSecret: 'x'.repeat(32),
			fetchImpl: vi.fn() as never
		});
		const wrongConfig = { ...config, target: { ...config.target, supabaseUrl: 'https://attacker.invalid' } };
		expect(() => createHostedA10ExecutionContext({
			config: wrongConfig as never,
			publishableKey: 'sb_publishable_test-key',
			privilegedAdapters: exactAdapters,
			reportTokenProvider: freshReportTokenProvider(),
			fetchImpl: vi.fn() as never
		})).toThrow(/scenario adapter configuration is invalid/u);
		expect(credentialTrap).not.toHaveBeenCalled();
	});

	it('rejects substituted production transports before any credential or client use', () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const originalNodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = 'production';
		try {
			expect(() => createSupabaseHostedEvidenceAdapters({
				config,
				serviceClient: { supabaseUrl: HOSTED_STAGING.supabaseUrl } as never,
				managementAccessToken: 'management-token',
				cleanupSecret: 'x'.repeat(32),
				fetchImpl: vi.fn() as never
			})).toThrow(/adapter configuration is invalid/u);

			const privilegedAdapters = createSupabaseHostedEvidenceAdapters({
				config,
				serviceClient: { supabaseUrl: HOSTED_STAGING.supabaseUrl } as never,
				managementAccessToken: 'management-token',
				cleanupSecret: 'x'.repeat(32)
			});
			expect(() => createHostedA10ExecutionContext({
				config,
				publishableKey: 'sb_publishable_test-key',
				privilegedAdapters,
				reportTokenProvider: freshReportTokenProvider(),
				fetchImpl: vi.fn() as never,
				httpsRequestImpl: vi.fn() as never
			} as never)).toThrow(/scenario adapter configuration is invalid/u);
		} finally {
			process.env.NODE_ENV = originalNodeEnv;
		}
	});

	it('rejects credential-store proxy and accessor smuggling without invocation', () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: { supabaseUrl: HOSTED_STAGING.supabaseUrl } as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
		const trap = vi.fn();
		const proxy = new Proxy({}, { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap });
		expect(() => createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: vi.fn() as never, credentialStore: proxy })).toThrow(/scenario adapter configuration is invalid/u);
		expect(trap).not.toHaveBeenCalled();
	});

	it('creates a checkpoint-independent opaque execution context and binds only lifecycle-selected stable manifest bytes', () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = completeActorManifest(config as never);
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
		const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({
			config,
			serviceClient: { supabaseUrl: HOSTED_STAGING.supabaseUrl } as never,
			managementAccessToken: 'management-token',
			cleanupSecret: 'x'.repeat(32),
			fetchImpl: vi.fn() as never
		});
		const context = createHostedA10ExecutionContext({
			config,
			publishableKey: 'sb_publishable_test-key',
			privilegedAdapters,
			reportTokenProvider: freshReportTokenProvider(),
			fetchImpl: vi.fn() as never
		});
		expect(Object.keys(context)).toEqual([]);
		expect(JSON.stringify(context)).toBe('{}');

		const checkpoint = {
			id: 'primary-report-created',
			scenario: 2,
			kind: 'mutation',
			roleCapability: 'reporter',
			mutationMethod: 'createPrimaryReport',
			readBackMethod: 'readPrimaryReport',
			manifestReducer: 'registerPrimaryReport'
		};
		const coordinates = {
			runId: config.runId,
			projectRef: HOSTED_STAGING.projectRef,
			workerOrigin: HOSTED_STAGING.workerOrigin,
			releaseCommitSha: 'a'.repeat(40),
			stateRevision: 7,
			stateSha256: 'b'.repeat(64),
			manifestPath: 'C:/private/gate3-run-manifest.json',
			manifestSha256
		};
		expect(() => bindHostedA10CheckpointCapability(context, {
			checkpoint,
			mode: 'mutate',
			coordinates,
			manifestBytes
		} as never)).toThrow(/scenario authorization is invalid/u);
	});

	it('requires an exact fresh single-use report-token provider instead of a reusable token string', () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: { supabaseUrl: HOSTED_STAGING.supabaseUrl } as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
		expect(() => createHostedA10ExecutionContext({
			config,
			publishableKey: 'sb_publishable_test-key',
			privilegedAdapters,
			reportTokenProvider: freshReportTokenProvider(),
			fetchImpl: vi.fn() as never
		} as never)).not.toThrow();
		expect(() => createHostedA10ExecutionContext({
			config,
			publishableKey: 'sb_publishable_test-key',
			privilegedAdapters,
			turnstileToken: 'test-turnstile-token',
			fetchImpl: vi.fn() as never
		} as never)).toThrow(/scenario adapter configuration is invalid/u);
	});

	it('mints a genuinely read-only exact capability only after a verification checkpoint is selected', () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		let manifest = completeActorManifest(config as never);
		const reportId = '55555555-5555-4555-8555-555555555555';
		const uploadId = '66666666-6666-4666-8666-666666666666';
		manifest = registerHostedReport(manifest, reportId, 'reporter');
		manifest = registerHostedUpload(manifest, uploadId, 'reporter', `${actorIds.reporter}/${uploadId}.webp`);
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
		const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({
			config,
			serviceClient: { supabaseUrl: HOSTED_STAGING.supabaseUrl } as never,
			managementAccessToken: 'management-token',
			cleanupSecret: 'x'.repeat(32),
			fetchImpl: vi.fn() as never
		});
		const context = createHostedA10ExecutionContext({
			config,
			publishableKey: 'sb_publishable_test-key',
			privilegedAdapters,
			reportTokenProvider: freshReportTokenProvider(),
			fetchImpl: vi.fn() as never
		});
		const coordinates = {
				runId: config.runId,
				projectRef: HOSTED_STAGING.projectRef,
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				workerOrigin: HOSTED_STAGING.workerOrigin,
				releaseCommitSha: 'a'.repeat(40),
				stateRevision: 7,
				stateSha256: 'b'.repeat(64),
				manifestPath: 'C:/private/gate3-run-manifest.json',
				manifestSha256,
				inspectionNonce: 'c'.repeat(64),
				checkpointObservedAfter: '2026-08-22T19:00:00.000Z'
			};
		const capability = bindHostedA10CheckpointCapability(context, {
			grant: a10CapabilityGrant(coordinates, 1),
			manifestBytes
		} as never);
		expect(capability).toMatchObject({ roleCapability: 'reporter', mutation: null, reduceManifest: null });
		expect(typeof capability.readBack).toBe('function');
		expect(Reflect.ownKeys(capability)).toEqual(['roleCapability', 'mutation', 'readBack', 'reduceManifest']);
		expect(JSON.stringify(capability)).not.toMatch(/service|secret|client|fetch|cleanup/u);
	});

	it('requires a one-shot same-context pre-probe expiry proof before binding the exact backdate CAS', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const objectPath = `${actorIds.reporter}/${uploadId}.webp`;
		let manifest = completeActorManifest(config as never);
		manifest = registerHostedUpload(manifest, uploadId, 'reporter', objectPath);
		const expiresAt = '2026-08-22T21:00:00.000Z';
		const selectedColumns: string[] = [];
		const serviceClient = {
			supabaseUrl: HOSTED_STAGING.supabaseUrl,
			auth: { admin: { getUserById: vi.fn(async (id: string) => {
				const role = Object.entries(actorIds).find(([, value]) => value === id)?.[0] as keyof typeof actorIds | undefined;
				return { data: { user: role ? provisionedUser(role, id) : null }, error: null };
			}) } },
			from: vi.fn((table: string) => {
				const query: Record<string, any> = {
					select: (columns: string) => { selectedColumns.push(columns); return query; },
					eq: () => query,
					order: () => query,
					limit: () => query,
					maybeSingle: async () => ({ data: table === 'report_evidence_uploads' ? { id: uploadId, uploader_id: actorIds.reporter, storage_path: objectPath, status: 'pending', expires_at: expiresAt } : null, error: null })
				};
				return query;
			}),
			storage: { from: vi.fn() }
		};
		const managementFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([{ id: uploadId }]), { status: 200, headers: { 'content-type': 'application/json' } }));
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: managementFetch as never });
		const context = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: vi.fn() as never });
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
		const coordinates = { runId: config.runId, projectRef: HOSTED_STAGING.projectRef, supabaseUrl: HOSTED_STAGING.supabaseUrl, workerOrigin: HOSTED_STAGING.workerOrigin, releaseCommitSha: 'a'.repeat(40), stateRevision: 7, stateSha256: 'b'.repeat(64), manifestPath: 'C:/private/gate3-run-manifest.json', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), inspectionNonce: 'c'.repeat(64), checkpointObservedAfter: '2026-08-22T19:00:00.000Z' };
		const probe = selectNextScenarioProbe(a10LifecycleFacts(coordinates, 14), A10_STEP_REGISTRY, a10LifecycleEvidence(coordinates, 14));
		const observed = await inspectHostedA10CheckpointEvidence(context, { probe, manifestBytes });
		expect(observed).toMatchObject({ outcome: 'confirmed-absent', checkpointProof: expect.any(Object) });
		expect(selectedColumns.some((columns) => columns.split(',').map((column) => column.trim()).includes('expires_at'))).toBe(true);
		expect(() => bindHostedA10CheckpointCapability(context, { grant: a10CapabilityGrant(coordinates, 14), manifestBytes })).toThrow(/scenario authorization is invalid|scenario artifact binding is invalid/u);
		const checkpointProof = (observed as Record<string, unknown>).checkpointProof;
		const capability = bindHostedA10CheckpointCapability(context, { grant: a10CapabilityGrant(coordinates, 14, false, checkpointProof), manifestBytes } as never);
		await capability.mutation?.();
		const query = JSON.parse(String(managementFetch.mock.calls[0]?.[1]?.body)).query as string;
		expect(query).toContain(`expires_at = '${expiresAt}'::timestamptz`);
		expect(query).toContain("status = 'pending'");
		expect(() => bindHostedA10CheckpointCapability(context, { grant: a10CapabilityGrant(coordinates, 14, false, checkpointProof), manifestBytes } as never)).toThrow(/scenario authorization is invalid|scenario artifact binding is invalid/u);
	});

	it('rejects a checkpoint probe whose decoded manifest bytes do not match its fresh digest', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = completeActorManifest(config as never);
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: { supabaseUrl: HOSTED_STAGING.supabaseUrl } as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
		const context = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: vi.fn() as never });
		const coordinates = { runId: config.runId, projectRef: HOSTED_STAGING.projectRef, supabaseUrl: HOSTED_STAGING.supabaseUrl, workerOrigin: HOSTED_STAGING.workerOrigin, releaseCommitSha: 'a'.repeat(40), stateRevision: 7, stateSha256: 'b'.repeat(64), manifestPath: 'C:/private/gate3-run-manifest.json', manifestSha256: createHash('sha256').update('stale-manifest').digest('hex'), inspectionNonce: 'c'.repeat(64), checkpointObservedAfter: '2026-08-22T19:00:00.000Z' };
		const inspection = a10LifecycleFacts(coordinates, 0);
		const probe = selectNextScenarioProbe(inspection, A10_STEP_REGISTRY, a10LifecycleEvidence(coordinates, 0));
		await expect(inspectHostedA10CheckpointEvidence(context, {
			probe,
			manifestBytes
		} as never)).rejects.toThrow(/exact scenario inspection failed/u);
	});

	it('revalidates the exact actor session immediately before every actor operation', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		let manifest = completeActorManifest(config as never);
		manifest = registerHostedUpload(manifest, uploadId, 'reporter', `${actorIds.reporter}/${uploadId}.webp`);
		const serviceClient = { supabaseUrl: HOSTED_STAGING.supabaseUrl, from: vi.fn(), storage: { from: vi.fn() }, auth: { admin: { getUserById: vi.fn() } } };
		const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: actorIds['cross-user'], aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.${Buffer.from('signature').toString('base64url')}`;
		let userReads = 0;
		let storageCalls = 0;
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : String(input);
			const actorScopeResponse = actorAuthorizationRead(input, init);
			if (actorScopeResponse) return actorScopeResponse;
			if (url.includes('/auth/v1/token')) return new Response(JSON.stringify({ access_token: jwt, refresh_token: 'refresh-token-value', expires_in: 3600, token_type: 'bearer', user: { id: actorIds['cross-user'], email: actorEnvironment.E2E_REAL_CROSS_USER_EMAIL } }), { status: 200, headers: { 'content-type': 'application/json' } });
			if (url.endsWith('/auth/v1/user')) {
				userReads += 1;
				const id = userReads === 1 ? actorIds['cross-user'] : actorIds.reporter;
				const email = userReads === 1 ? actorEnvironment.E2E_REAL_CROSS_USER_EMAIL : actorEnvironment.E2E_REAL_REPORTER_EMAIL;
				return new Response(JSON.stringify({ id, email }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			storageCalls += 1;
			return new Response('', { status: 403, headers: { 'x-request-id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } });
		});
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: serviceClient as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
		const context = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: fetchImpl as never });
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
		const coordinates = { runId: config.runId, projectRef: HOSTED_STAGING.projectRef, supabaseUrl: HOSTED_STAGING.supabaseUrl, workerOrigin: HOSTED_STAGING.workerOrigin, releaseCommitSha: 'a'.repeat(40), stateRevision: 7, stateSha256: 'b'.repeat(64), manifestPath: 'C:/private/gate3-run-manifest.json', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), inspectionNonce: 'c'.repeat(64), checkpointObservedAfter: '2026-08-22T19:00:00.000Z' };
		const capability = bindHostedA10CheckpointCapability(context, { grant: a10CapabilityGrant(coordinates, 2), manifestBytes });
		await expect(capability.mutation?.()).rejects.toThrow(/scenario actor provenance is invalid|exact scenario operation failed/u);
		expect(storageCalls).toBe(1);
	});
	it('registers duplicate, rejected, and scheduled queue coordinates with exact cleanup scope', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		let manifest = completeActorManifest(config as never);
		const uploadId = '77777777-7777-4777-8777-777777777777';
		manifest = registerHostedUpload(
			manifest,
			uploadId,
			'reporter',
			`${actorIds.reporter}/${uploadId}.webp`
		);
		const rejectedId = '88888888-8888-4888-8888-888888888888';
		const rejectedPath = `${actorIds.reporter}/${rejectedId}.webp`;
		const reducers = [
			[5, { queueId: 17, uploadId }, [{ id: 17, uploadId }]],
			[10, { uploadId: rejectedId, objectPath: rejectedPath, queueId: 18 }, [{ id: 18, uploadId: rejectedId }]],
			[14, { queueId: 19, uploadId }, [{ id: 19, uploadId }]]
		] as const;
		const privilegedAdapters = createSupabaseHostedEvidenceAdapters({ config, serviceClient: { supabaseUrl: HOSTED_STAGING.supabaseUrl } as never, managementAccessToken: 'management-token', cleanupSecret: 'x'.repeat(32), fetchImpl: vi.fn() as never });
		const context = createHostedA10ExecutionContext({ config, publishableKey: 'sb_publishable_test-key', privilegedAdapters, reportTokenProvider: freshReportTokenProvider(), fetchImpl: vi.fn() as never });
		for (const [index, evidence, expectedQueue] of reducers) {
			const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
			const coordinates = { runId: config.runId, projectRef: HOSTED_STAGING.projectRef, supabaseUrl: HOSTED_STAGING.supabaseUrl, workerOrigin: HOSTED_STAGING.workerOrigin, releaseCommitSha: 'a'.repeat(40), stateRevision: 7, stateSha256: 'b'.repeat(64), manifestPath: 'C:/private/gate3-run-manifest.json', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), inspectionNonce: 'c'.repeat(64), checkpointObservedAfter: '2026-08-22T19:00:00.000Z' };
			const capability = bindHostedA10CheckpointCapability(context, { grant: a10CapabilityGrant(coordinates, index, index === 14), manifestBytes });
			if (typeof capability.reduceManifest !== 'function') throw new Error('expected reducer capability');
			const next = capability.reduceManifest(evidence);
			expect(next.queueRows).toEqual(expectedQueue);
			if (index === 10) expect(next.uploads.at(-1)).toMatchObject({ id: rejectedId, objectPath: rejectedPath });
		}
	});

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
		for (const forbidden of [
			'access-assertion',
			'actor-authorization-evidence',
			'download-evidence',
			'moderator-read'
		]) {
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

	it('attests an A9 actor against the persisted manifest when its attempt differs from the provisioning nonce', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const provisioningAttemptId = '66666666-6666-4666-8666-666666666666';
		const userId = actorIds.reporter;
		const manifestDirectory = await mkdtemp(join(tmpdir(), 'hosted-a9-a10-handoff-'));
		const manifestPath = join(manifestDirectory, 'manifest.json');
		const a9Manifest = registerHostedActor(
			createHostedRunManifest(config, { provisioningAttemptId }),
			'reporter',
			userId,
			actorCreatedAt
		);
		const user = {
			...provisionedUser('reporter', userId),
			user_metadata: {
				...provisionedUser('reporter', userId).user_metadata,
				gate3_report_evidence_provisioning_attempt_id: provisioningAttemptId
			}
		};
		const adapters = createSupabaseHostedEvidenceAdapters({
			config,
			serviceClient: {
				auth: {
					admin: {
						getUserById: vi.fn().mockResolvedValue({ data: { user }, error: null })
					}
				}
			} as never,
			managementAccessToken: 'management-token',
			cleanupSecret: 'x'.repeat(32),
			fetchImpl: vi.fn() as never
		});
		const operator = createHostedEvidenceOperator({ config, adapters });

		try {
			await persistHostedRunManifest(config, a9Manifest, manifestPath);
			await expect(readFile(manifestPath, 'utf8')).resolves.toBe(`${JSON.stringify(a9Manifest)}\n`);
			const persistedManifest = await loadHostedRunManifest(config, manifestPath);

			await expect(
				operator.attestFreshActor(persistedManifest, 'reporter', userId)
			).resolves.toEqual({
				role: 'reporter',
				userId,
				createdAt: actorCreatedAt,
				provisioningAttemptId
			});
		} finally {
			await rm(manifestDirectory, { recursive: true, force: true });
		}
	});

	it('rejects A10 attestation when manifest provenance or actor coordinates differ', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const provisioningAttemptId = '66666666-6666-4666-8666-666666666666';
		const wrongProvisioningAttemptId = '77777777-7777-4777-8777-777777777777';
		const userId = actorIds.reporter;
		const user = {
			...provisionedUser('reporter', userId),
			user_metadata: {
				...provisionedUser('reporter', userId).user_metadata,
				gate3_report_evidence_provisioning_attempt_id: provisioningAttemptId
			}
		};
		const getUserById = vi.fn().mockResolvedValue({ data: { user }, error: null });
		const adapters = createSupabaseHostedEvidenceAdapters({
			config,
			serviceClient: { auth: { admin: { getUserById } } } as never,
			managementAccessToken: 'management-token',
			cleanupSecret: 'x'.repeat(32),
			fetchImpl: vi.fn() as never
		});
		const operator = createHostedEvidenceOperator({ config, adapters });
		const manifest = registerHostedActor(
			createHostedRunManifest(config, { provisioningAttemptId }),
			'reporter',
			userId,
			actorCreatedAt
		);
		const wrongAttemptManifest = registerHostedActor(
			createHostedRunManifest(config, { provisioningAttemptId: wrongProvisioningAttemptId }),
			'reporter',
			userId,
			actorCreatedAt
		);
		const wrongCreatedAtManifest = registerHostedActor(
			createHostedRunManifest(config, { provisioningAttemptId }),
			'reporter',
			userId,
			'2026-08-09T12:00:01.000Z'
		);
		const wrongRunConfig = validateHostedOperatorEnvironment({
			...baseEnvironment,
			E2E_REAL_REPORT_EVIDENCE_RUN_ID: 'gate3-20260809-0002'
		});
		const wrongRunManifest = registerHostedActor(
			createHostedRunManifest(wrongRunConfig, { provisioningAttemptId }),
			'reporter',
			userId,
			actorCreatedAt
		);

		await expect(
			operator.attestFreshActor(wrongAttemptManifest, 'reporter', userId)
		).rejects.toThrow(/fresh hosted actor provenance is invalid/u);
		await expect(
			operator.attestFreshActor(wrongCreatedAtManifest, 'reporter', userId)
		).rejects.toThrow(/fresh hosted actor provenance is invalid/u);
		await expect(
			operator.attestFreshActor(wrongRunManifest, 'reporter', userId)
		).rejects.toThrow(/run manifest target does not match approved staging/u);
		await expect(
			operator.attestFreshActor(manifest, 'reporter', actorIds['cross-user'])
		).rejects.toThrow(/actor is outside the exact run manifest/u);
		await expect(
			operator.attestFreshActor(manifest, 'cross-user', userId)
		).rejects.toThrow(/actor is outside the exact run manifest/u);
		expect(getUserById).toHaveBeenCalledTimes(2);
	});
});

describe('A9 foundation environment and TOTP safety', () => {
	it('never treats an A9 or A11 approval as authorization for the A10 hostile suite', () => {
		const isApproved = (
			hostedOperatorModule as unknown as {
				isHostedA10ScenarioApproved: (environment: Record<string, string>) => boolean;
			}
		).isHostedA10ScenarioApproved;
		expect(isApproved(a9Environment)).toBe(false);
		expect(isApproved(approvedCleanupEnvironment)).toBe(false);
		expect(
			isApproved({
				...baseEnvironment,
				E2E_REAL_REPORT_EVIDENCE_SCENARIO_RUN: 'true',
				E2E_REAL_REPORT_EVIDENCE_SCENARIO_APPROVAL: 'A10'
			})
		).toBe(true);
	});

	it('accepts the exact four actors without incoming TOTP or later-step secrets', () => {
		const config = validateHostedA9Environment(a9Environment);

		expect(Object.keys(config.actorRoles)).toEqual([
			'reporter',
			'cross-user',
			'assigned-moderator',
			'unassigned-moderator'
		]);
		expect(Object.values(config.actorRoles)).not.toContainEqual(
			expect.objectContaining({ totpSecret: expect.anything() })
		);
		expect(a9Environment).not.toHaveProperty('SUPABASE_ACCESS_TOKEN');
		expect(a9Environment).not.toHaveProperty('UPLOAD_CLEANUP_SECRET');
	});

	it('rejects plaintext moderator seed environment variables for every gate', () => {
		for (const environment of [
			a9Environment,
			baseEnvironment,
			approvedCleanupEnvironment
		]) {
			expect(() =>
				validateHostedOperatorEnvironment({
					...environment,
					E2E_REAL_ASSIGNED_MODERATOR_TOTP_SECRET: syntheticTotpSecret
				})
			).toThrow(/actor is outside the approved hosted scope/u);
		}
	});

	it.each([
		['EXPECTED_SUPABASE_PROJECT_REF', 'wrong-project'],
		['PUBLIC_SUPABASE_URL', 'https://example.invalid'],
		['E2E_REAL_BASE_URL', 'https://example.invalid'],
		['E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_RUN', 'false'],
		['E2E_REAL_REPORT_EVIDENCE_ACCOUNT_PROVISIONING_APPROVAL', 'A10']
	])('fails closed when the exact A9 %s lock is wrong', (name, value) => {
		expect(() => validateHostedA9Environment({ ...a9Environment, [name]: value })).toThrow(
			HostedEvidenceOperatorError
		);
	});

	it.each([
		'E2E_REAL_REPORTER_EMAIL',
		'E2E_REAL_CROSS_USER_PASSWORD',
		'E2E_REAL_ASSIGNED_MODERATOR_USERNAME',
		'E2E_REAL_UNASSIGNED_MODERATOR_EMAIL'
	])('requires every credential in the exact four-actor set (%s)', (name) => {
		expect(() => validateHostedA9Environment({ ...a9Environment, [name]: undefined })).toThrow(
			/required hosted operator configuration is incomplete/u
		);
	});

	it('rejects duplicate, extra, and administrator actor credentials', () => {
		expect(() =>
			validateHostedA9Environment({
				...a9Environment,
				E2E_REAL_CROSS_USER_EMAIL: a9Environment.E2E_REAL_REPORTER_EMAIL
			})
		).toThrow(/synthetic hosted actors must be unique/u);
		expect(() =>
			validateHostedA9Environment({
				...a9Environment,
				E2E_REAL_SHADOW_ACTOR_EMAIL: 'shadow@example.invalid'
			})
		).toThrow(/actor is outside the approved hosted scope/u);
		expect(() =>
			validateHostedA9Environment({
				...a9Environment,
				E2E_REAL_ADMIN_PASSWORD: 'administrator-password'
			})
		).toThrow(/administrator actor is outside the approved hosted scope/u);
	});

	it('matches the RFC 6238 SHA-1 vector at a fixed timestamp', () => {
		expect(generateTotpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082');
	});

	it('keeps one shared TOTP implementation for the hosted E2E', async () => {
		const hostedSpec = await readFile(
			new URL('../e2e/hosted-report-evidence.spec.ts', import.meta.url),
			'utf8'
		);

		expect(hostedSpec).toContain('generateTotpCode');
		expect(hostedSpec).not.toContain('function decodeBase32');
		expect(hostedSpec).not.toContain('function currentTotp');
		expect(hostedSpec).not.toContain('createHmac');
	});
});

describe('A9-only Supabase adapter foundations', () => {
	it('rejects a privileged client that is not bound to the exact Frankfurt staging project', () => {
		expect(() =>
			createSupabaseHostedA9Adapters({
				config: validateHostedA9Environment(a9Environment),
				serviceClient: {
					supabaseUrl: 'https://zllqwlekadiuyejgbuxc.supabase.co'
				} as never,
				createActorClient: vi.fn() as never,
				credentialSink: noopModeratorCredentialSink()
			})
		).toThrow('A9 privileged client does not match the exact staging target');
	});

	it('has no management-token, cleanup-secret, scheduler, or generic role dependency', () => {
		const adapters = createSupabaseHostedA9Adapters({
			config: validateHostedA9Environment(a9Environment),
			serviceClient: { supabaseUrl: HOSTED_STAGING.supabaseUrl } as never,
			createActorClient: vi.fn() as never,
			credentialSink: noopModeratorCredentialSink()
		});

		expect(Object.keys(adapters)).toEqual([
			'assertFreshActorAbsent',
			'createConfirmedUser',
			'createResumableUser',
			'lookupConfirmedUser',
			'deleteFreshUser',
			'createActorSession',
			'inspectFreshActor',
			'inspectRequiredAccessDocuments',
			'inspectZeroA9Artifacts',
			'elevateFreshActorRole',
			'inspectProvisionBoundary'
		]);
		expect(Object.keys(adapters)).not.toEqual(
			expect.arrayContaining(['setRole', 'invokeCleanupWorker', 'reportSubmit'])
		);
	});

	it('creates, attests, and deletes only a confirmed exact-manifest Auth actor', async () => {
		const config = validateHostedA9Environment(a9Environment);
		const user = provisionedUser('reporter', actorIds.reporter);
		const createUser = vi.fn().mockResolvedValue({ data: { user }, error: null });
		const getUserById = vi
			.fn()
			.mockResolvedValueOnce({ data: { user }, error: null })
			.mockResolvedValueOnce({ data: { user }, error: null })
			.mockResolvedValueOnce({ data: { user: null }, error: { status: 404 } });
		const deleteUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
		const adapters = createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: {
					admin: {
						createUser,
						getUserById,
						deleteUser,
						listUsers: vi.fn().mockResolvedValue({ data: { users: [], lastPage: 1 }, error: null })
					}
				}
			} as never,
			createActorClient: vi.fn() as never,
			credentialSink: noopModeratorCredentialSink()
		});
		const manifest = registerHostedActor(
			createHostedRunManifest(config),
			'reporter',
			actorIds.reporter,
			actorCreatedAt
		);
		const intentManifest = reporterIntentManifest(config);

		await expect(
			adapters.assertFreshActorAbsent({ manifest: intentManifest, role: 'reporter' })
		).resolves.toEqual({
			role: 'reporter',
			absent: true
		});
		await expect(
			adapters.createConfirmedUser({ manifest: intentManifest, role: 'reporter' })
		).resolves.toEqual({
			role: 'reporter',
			userId: actorIds.reporter,
			createdAt: actorCreatedAt,
			emailConfirmed: true
		});
		const lookupReceipt = await adapters.lookupConfirmedUser({
			role: 'reporter',
			userId: actorIds.reporter,
			createdAt: actorCreatedAt
		});
		expect(lookupReceipt).toEqual({
			role: 'reporter',
			userId: actorIds.reporter,
			createdAt: actorCreatedAt,
			emailConfirmed: true
		});
		await expect(
			adapters.deleteFreshUser({ manifest, role: 'reporter', userId: actorIds.reporter })
		).resolves.toBeUndefined();
		expect(createUser).toHaveBeenCalledWith(
			expect.objectContaining({ email_confirm: true, password: actorEnvironment.E2E_REAL_REPORTER_PASSWORD })
		);
		expect(deleteUser).toHaveBeenCalledWith(actorIds.reporter);
		expect(JSON.stringify(lookupReceipt)).not.toContain(actorEnvironment.E2E_REAL_REPORTER_PASSWORD);
	});

	it('treats an already-absent exact manifest actor as an idempotent rollback success', async () => {
		const config = validateHostedA9Environment(a9Environment);
		const manifest = registerHostedActor(
			createHostedRunManifest(config),
			'reporter',
			actorIds.reporter,
			actorCreatedAt
		);
		const deleteUser = vi.fn();
		const adapters = createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: {
					admin: {
						getUserById: vi.fn().mockResolvedValue({
							data: { user: null },
							error: { status: 404 }
						}),
						deleteUser
					}
				}
			} as never,
			createActorClient: vi.fn() as never,
			credentialSink: noopModeratorCredentialSink()
		});

		await expect(
			adapters.deleteFreshUser({ manifest, role: 'reporter', userId: actorIds.reporter })
		).resolves.toBeUndefined();
		expect(deleteUser).not.toHaveBeenCalled();
	});

	it('compensates an exact newly-created Auth actor when confirmation attestation fails', async () => {
		const config = validateHostedA9Environment(a9Environment);
		const unconfirmedUser = {
			...provisionedUser('reporter', actorIds.reporter),
			email_confirmed_at: undefined
		};
		const deleteUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
		const getUserById = vi
			.fn()
			.mockResolvedValue({ data: { user: null }, error: { status: 404 } });
		const adapters = createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: {
					admin: {
						createUser: vi.fn().mockResolvedValue({ data: { user: unconfirmedUser }, error: null }),
						listUsers: vi.fn().mockResolvedValue({ data: { users: [], lastPage: 1 }, error: null }),
						getUserById,
						deleteUser
					}
				}
			} as never,
			createActorClient: vi.fn() as never,
			credentialSink: noopModeratorCredentialSink()
		});

		const intentManifest = reporterIntentManifest(config);
		await adapters.assertFreshActorAbsent({ manifest: intentManifest, role: 'reporter' });
		await expect(
			adapters.createConfirmedUser({ manifest: intentManifest, role: 'reporter' })
		).rejects.toThrow(
			/confirmed A9 actor creation failed/u
		);
		expect(deleteUser).toHaveBeenCalledWith(actorIds.reporter);
		expect(getUserById).toHaveBeenCalledWith(actorIds.reporter);
	});

	it('reconciles and removes an exact actor when Auth creation commits before a transport error', async () => {
		const config = validateHostedA9Environment(a9Environment);
		const user = provisionedUser('reporter', actorIds.reporter);
		const deleteUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
		const adapters = createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: {
					admin: {
						createUser: vi.fn(async () => {
							throw new Error('provider timeout with private details');
						}),
						listUsers: vi
							.fn()
							.mockResolvedValueOnce({ data: { users: [], lastPage: 1 }, error: null })
							.mockResolvedValueOnce({ data: { users: [user], lastPage: 1 }, error: null }),
						getUserById: vi.fn().mockResolvedValue({
							data: { user: null },
							error: { status: 404 }
						}),
						deleteUser
					}
				}
			} as never,
			createActorClient: vi.fn() as never,
			credentialSink: noopModeratorCredentialSink()
		});
		let caught: unknown;
		const intentManifest = reporterIntentManifest(config);
		try {
			await adapters.assertFreshActorAbsent({ manifest: intentManifest, role: 'reporter' });
			await adapters.createConfirmedUser({ manifest: intentManifest, role: 'reporter' });
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(HostedEvidenceOperatorError);
		expect(String(caught)).not.toContain('provider timeout');
		expect(deleteUser).toHaveBeenCalledWith(actorIds.reporter);
	});

	it('never deletes an actor created by a competing provisioning attempt', async () => {
		const config = validateHostedA9Environment(a9Environment);
		const competingAttemptId = '66666666-6666-4666-8666-666666666666';
		const currentAttemptId = '77777777-7777-4777-8777-777777777777';
		const competingUser = {
			...provisionedUser('reporter', actorIds.reporter),
			user_metadata: {
				...provisionedUser('reporter', actorIds.reporter).user_metadata,
				gate3_report_evidence_provisioning_attempt_id: competingAttemptId
			}
		};
		const deleteUser = vi.fn();
		const adapters = createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: {
					admin: {
						createUser: vi.fn(async () => {
							throw new Error('ambiguous provider response');
						}),
						listUsers: vi
							.fn()
							.mockResolvedValueOnce({ data: { users: [], lastPage: 1 }, error: null })
							.mockResolvedValueOnce({
								data: { users: [competingUser], lastPage: 1 },
								error: null
							}),
						deleteUser
					}
				}
			} as never,
			createActorClient: vi.fn() as never,
			credentialSink: noopModeratorCredentialSink()
		});
		const intentManifest = registerHostedActorIntent(
			createHostedRunManifest(config, { provisioningAttemptId: currentAttemptId }),
			'reporter'
		);

		await adapters.assertFreshActorAbsent({ manifest: intentManifest, role: 'reporter' });
		await expect(
			adapters.createConfirmedUser({ manifest: intentManifest, role: 'reporter' })
		).rejects.toThrow(/confirmed A9 actor creation failed after reconciliation/u);
		expect(deleteUser).not.toHaveBeenCalled();
	});

	it('refuses a prior matching actor without creating or deleting it', async () => {
		const config = validateHostedA9Environment(a9Environment);
		const user = provisionedUser('reporter', actorIds.reporter);
		const createUser = vi.fn();
		const deleteUser = vi.fn();
		const adapters = createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: {
					admin: {
						listUsers: vi.fn().mockResolvedValue({
							data: { users: [user], lastPage: 1 },
							error: null
						}),
						createUser,
						deleteUser
					}
				}
			} as never,
			createActorClient: vi.fn() as never,
			credentialSink: noopModeratorCredentialSink()
		});

		await expect(
			adapters.assertFreshActorAbsent({
				manifest: reporterIntentManifest(config),
				role: 'reporter'
			})
		).rejects.toThrow(
			'A9 configured actor already exists'
		);
		expect(createUser).not.toHaveBeenCalled();
		expect(deleteUser).not.toHaveBeenCalled();
	});

	it('compensates a successful Auth creation when returned provenance attestation fails', async () => {
		const config = validateHostedA9Environment(a9Environment);
		const wrongProvenanceUser = {
			...provisionedUser('reporter', actorIds.reporter),
			user_metadata: {
				gate3_report_evidence_run_id: runId,
				gate3_report_evidence_provisioning_nonce: 'wrong-nonce'
			}
		};
		const deleteUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
		const getUserById = vi
			.fn()
			.mockResolvedValue({ data: { user: null }, error: { status: 404 } });
		const adapters = createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: {
					admin: {
						createUser: vi.fn().mockResolvedValue({
							data: { user: wrongProvenanceUser },
							error: null
						}),
						listUsers: vi.fn().mockResolvedValue({ data: { users: [], lastPage: 1 }, error: null }),
						getUserById,
						deleteUser
					}
				}
			} as never,
			createActorClient: vi.fn() as never,
			credentialSink: noopModeratorCredentialSink()
		});

		const intentManifest = reporterIntentManifest(config);
		await adapters.assertFreshActorAbsent({ manifest: intentManifest, role: 'reporter' });
		await expect(
			adapters.createConfirmedUser({ manifest: intentManifest, role: 'reporter' })
		).rejects.toThrow(
			/fresh A9 actor provenance is invalid/u
		);
		expect(deleteUser).toHaveBeenCalledWith(actorIds.reporter);
		expect(getUserById).toHaveBeenCalledWith(actorIds.reporter);
	});

	it('does not report rollback success until Auth confirms the actor is absent', async () => {
		const config = validateHostedA9Environment(a9Environment);
		const user = provisionedUser('reporter', actorIds.reporter);
		const getUserById = vi.fn().mockResolvedValue({ data: { user }, error: null });
		const deleteUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
		const adapters = createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: { admin: { getUserById, deleteUser } }
			} as never,
			createActorClient: vi.fn() as never,
			credentialSink: noopModeratorCredentialSink()
		});
		const manifest = registerHostedActor(
			createHostedRunManifest(config),
			'reporter',
			actorIds.reporter,
			actorCreatedAt
		);

		await expect(
			adapters.deleteFreshUser({ manifest, role: 'reporter', userId: actorIds.reporter })
		).rejects.toThrow(/A9 actor rollback was not confirmed/u);
		expect(deleteUser).toHaveBeenCalledOnce();
	});

	it('runs lifecycle RPC and MFA calls only through the signed-in actor client', async () => {
		const config = validateHostedA9Environment(a9Environment);
		const totpSecret = syntheticTotpSecret;
		const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
		const getAuthenticatorAssuranceLevel = vi.fn().mockResolvedValue({
			data: { currentLevel: 'aal2', nextLevel: 'aal2' },
			error: null
		});
		const enroll = vi.fn().mockResolvedValue({
			data: {
				id: 'factor-1',
				type: 'totp',
				totp: { secret: totpSecret, qr_code: 'sensitive-qr', uri: 'sensitive-uri' }
			},
			error: null
		});
		const challengeAndVerify = vi.fn().mockResolvedValue({ data: {}, error: null });
		const listFactors = vi.fn().mockResolvedValue({
			data: { totp: [{ id: 'factor-1', status: 'verified', friendly_name: 'A9' }], phone: [] },
			error: null
		});
		const actorClient = {
			auth: {
				signInWithPassword: vi.fn().mockResolvedValue({
					data: {
						user: {
							id: actorIds['assigned-moderator'],
							email: actorEnvironment.E2E_REAL_ASSIGNED_MODERATOR_EMAIL
						}
					},
					error: null
				}),
				mfa: { getAuthenticatorAssuranceLevel, enroll, challengeAndVerify, listFactors }
			},
			rpc
		};
		const serviceRpc = vi.fn();
		const serviceMfa = {
			getAuthenticatorAssuranceLevel: vi.fn(),
			enroll: vi.fn(),
			challengeAndVerify: vi.fn(),
			listFactors: vi.fn()
		};
		const storeModeratorTotpSecret = vi.fn().mockResolvedValue(undefined);
		const adapters = createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				rpc: serviceRpc,
				auth: {
					mfa: serviceMfa,
					admin: {
						getUserById: vi.fn().mockResolvedValue({
							data: {
								user: provisionedUser(
									'assigned-moderator',
									actorIds['assigned-moderator']
								)
							},
							error: null
						})
					}
				}
			} as never,
			createActorClient: vi.fn(() => actorClient) as never,
			credentialSink: {
				storeModeratorTotpSecret,
				deleteModeratorTotpSecret: vi.fn()
			}
		});
		const manifest = registerHostedActor(
			createHostedRunManifest(config),
			'assigned-moderator',
			actorIds['assigned-moderator'],
			actorCreatedAt
		);
		const session = await adapters.createActorSession({
			manifest,
			role: 'assigned-moderator',
			userId: actorIds['assigned-moderator']
		});

		await session.claimOpenRegistration();
		await session.acceptBetaConsent({ documentCode: 'terms', documentVersion: '2026-08-02' });
		await session.completeBetaOnboarding({ username: 'gate3-assigned', city: 'Sofia' });
		await session.getMyBetaAccess();
		await session.mfa.getAuthenticatorAssuranceLevel();
		const enrollment = await session.mfa.enroll();
		await session.mfa.challengeAndVerify({ factorId: 'factor-1', code: '287082' });
		await session.mfa.listFactors();

		expect(rpc.mock.calls).toEqual([
			['claim_open_registration'],
			[
				'accept_beta_consent',
				{ requested_document_code: 'terms', requested_document_version: '2026-08-02' }
			],
			['complete_beta_onboarding', { desired_username: 'gate3-assigned', home_city: 'Sofia' }],
			['get_my_beta_access']
		]);
		expect(enrollment).toEqual({ factorId: 'factor-1', factorType: 'totp' });
		expect(JSON.stringify(enrollment)).not.toContain(totpSecret);
		expect(storeModeratorTotpSecret).toHaveBeenCalledWith({
			role: 'assigned-moderator',
			secret: totpSecret
		});
		expect(serviceRpc).not.toHaveBeenCalled();
		expect(Object.values(serviceMfa).every((operation) => operation.mock.calls.length === 0)).toBe(
			true
		);
	});

	it('enrolls and verifies moderator TOTP through an AAL1-to-AAL2 actor-owned transition', async () => {
		const config = validateHostedA9Environment(a9Environment);
		const totpSecret = syntheticTotpSecret;
		const getAuthenticatorAssuranceLevel = vi
			.fn()
			.mockResolvedValueOnce({
				data: { currentLevel: 'aal1', nextLevel: 'aal1' },
				error: null
			})
			.mockResolvedValueOnce({
				data: { currentLevel: 'aal2', nextLevel: 'aal2' },
				error: null
			});
		const challengeAndVerify = vi.fn().mockResolvedValue({ data: {}, error: null });
		const listFactors = vi
			.fn()
			.mockResolvedValueOnce({ data: { totp: [], phone: [] }, error: null })
			.mockResolvedValueOnce({
				data: {
					totp: [{ id: 'factor-1', status: 'verified' }],
					phone: []
				},
				error: null
			});
		const actorClient = {
			auth: {
				signInWithPassword: vi.fn().mockResolvedValue({
					data: {
						user: {
							id: actorIds['assigned-moderator'],
							email: actorEnvironment.E2E_REAL_ASSIGNED_MODERATOR_EMAIL
						}
					},
					error: null
				}),
				mfa: {
					getAuthenticatorAssuranceLevel,
					enroll: vi.fn().mockResolvedValue({
						data: { id: 'factor-1', type: 'totp', totp: { secret: totpSecret } },
						error: null
					}),
					challengeAndVerify,
					listFactors,
					unenroll: vi.fn()
				}
			},
			rpc: vi.fn()
		};
		const adapters = createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: {
					admin: {
						getUserById: vi.fn().mockResolvedValue({
							data: {
								user: provisionedUser(
									'assigned-moderator',
									actorIds['assigned-moderator']
								)
							},
							error: null
						})
					}
				}
			} as never,
			createActorClient: vi.fn(() => actorClient) as never,
			credentialSink: noopModeratorCredentialSink()
		});
		const manifest = registerHostedActor(
			createHostedRunManifest(config),
			'assigned-moderator',
			actorIds['assigned-moderator'],
			actorCreatedAt
		);
		const session = await adapters.createActorSession({
			manifest,
			role: 'assigned-moderator',
			userId: actorIds['assigned-moderator']
		});

		await expect(
			(session.mfa as unknown as {
				enrollAndVerify: (input: { clock: () => number }) => Promise<unknown>;
			}).enrollAndVerify({ clock: () => 59_000 })
		).resolves.toEqual({
			factorId: 'factor-1',
			factorType: 'totp',
			factorStatus: 'verified',
			initialAal: 'aal1',
			finalAal: 'aal2'
		});
		expect(challengeAndVerify).toHaveBeenCalledWith({
			factorId: 'factor-1',
			code: generateTotpCode(totpSecret, 59_000)
		});
		expect(JSON.stringify(challengeAndVerify.mock.calls)).not.toContain(totpSecret);
	});

	it('sanitizes credential-sink failures and never returns or logs the TOTP seed', async () => {
		const config = validateHostedA9Environment(a9Environment);
		const totpSecret = syntheticTotpSecret;
		const unenroll = vi.fn().mockResolvedValue({ data: {}, error: null });
		const listFactors = vi.fn().mockResolvedValue({
			data: { totp: [], phone: [] },
			error: null
		});
		const deleteModeratorTotpSecret = vi.fn().mockResolvedValue(undefined);
		const consoleSpies = [
			vi.spyOn(console, 'log').mockImplementation(() => undefined),
			vi.spyOn(console, 'info').mockImplementation(() => undefined),
			vi.spyOn(console, 'warn').mockImplementation(() => undefined),
			vi.spyOn(console, 'error').mockImplementation(() => undefined)
		];
		const actorClient = {
			auth: {
				signInWithPassword: vi.fn().mockResolvedValue({
					data: {
						user: {
							id: actorIds['assigned-moderator'],
							email: actorEnvironment.E2E_REAL_ASSIGNED_MODERATOR_EMAIL
						}
					},
					error: null
				}),
				mfa: {
					enroll: vi.fn().mockResolvedValue({
						data: { id: 'factor-1', type: 'totp', totp: { secret: totpSecret } },
						error: null
					}),
					unenroll,
					listFactors
				}
			}
		};
		const adapters = createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: {
					admin: {
						getUserById: vi.fn().mockResolvedValue({
							data: {
								user: provisionedUser(
									'assigned-moderator',
									actorIds['assigned-moderator']
								)
							},
							error: null
						})
					}
				}
			} as never,
			createActorClient: vi.fn(() => actorClient) as never,
			credentialSink: {
				storeModeratorTotpSecret: vi.fn(async () => {
					throw new Error(`sink rejected ${totpSecret}`);
				}),
				deleteModeratorTotpSecret
			}
		});
		const manifest = registerHostedActor(
			createHostedRunManifest(config),
			'assigned-moderator',
			actorIds['assigned-moderator'],
			actorCreatedAt
		);
		const session = await adapters.createActorSession({
			manifest,
			role: 'assigned-moderator',
			userId: actorIds['assigned-moderator']
		});
		let caught: unknown;
		try {
			await session.mfa.enroll();
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(HostedEvidenceOperatorError);
		expect(String(caught)).not.toContain(totpSecret);
		expect(unenroll).toHaveBeenCalledWith({ factorId: 'factor-1' });
		expect(listFactors).toHaveBeenCalledOnce();
		expect(deleteModeratorTotpSecret).toHaveBeenCalledWith({
			role: 'assigned-moderator'
		});
		expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
		expect(JSON.stringify(createHostedRunManifest(config))).not.toContain(totpSecret);
		for (const spy of consoleSpies) spy.mockRestore();
	});

	it('binds actor-owned sessions to exact fresh manifest provenance', async () => {
		const config = validateHostedA9Environment(a9Environment);
		const actorClient = {
			auth: {
				signInWithPassword: vi.fn().mockResolvedValue({
					data: {
						user: {
							id: actorIds.reporter,
							email: actorEnvironment.E2E_REAL_REPORTER_EMAIL
						}
					},
					error: null
				})
			}
		};
		const createActorClient = vi.fn(() => actorClient);
		const getUserById = vi.fn().mockResolvedValue({
			data: { user: provisionedUser('reporter', actorIds.reporter) },
			error: null
		});
		const adapters = createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: { admin: { getUserById } }
			} as never,
			createActorClient: createActorClient as never,
			credentialSink: noopModeratorCredentialSink()
		});
		const validManifest = registerHostedActor(
			createHostedRunManifest(config),
			'reporter',
			actorIds.reporter,
			actorCreatedAt
		);
		const tamperedManifest = {
			...validManifest,
			actors: validManifest.actors.map((actor) => ({
				...actor,
				createdAt: '2026-08-09T12:00:01.000Z'
			}))
		};

		await expect(
			adapters.createActorSession({
				manifest: tamperedManifest,
				role: 'reporter',
				userId: actorIds.reporter
			})
		).rejects.toThrow(/fresh A9 actor provenance is invalid/u);
		expect(createActorClient).not.toHaveBeenCalled();
	});

	it('elevates only an exact fresh manifest actor from user to moderator', async () => {
		const config = validateHostedA9Environment(a9Environment);
		const manifest = completeActorManifest(config);
		const user = provisionedUser('assigned-moderator', actorIds['assigned-moderator']);
		const updateResult = vi.fn().mockResolvedValue({
			data: { id: actorIds['assigned-moderator'], role: 'moderator' },
			error: null
		});
		const updateChain: Record<string, ReturnType<typeof vi.fn>> = {};
		updateChain.eq = vi.fn(() => updateChain);
		updateChain.select = vi.fn(() => updateChain);
		updateChain.maybeSingle = updateResult;
		const update = vi.fn(() => updateChain);
		const getUserById = vi.fn().mockResolvedValue({ data: { user }, error: null });
		const adapters = createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: { admin: { getUserById } },
				from: vi.fn(() => ({ update }))
			} as never,
			createActorClient: vi.fn() as never,
			credentialSink: noopModeratorCredentialSink()
		});

		await expect(
			adapters.elevateFreshActorRole({
				manifest,
				role: 'assigned-moderator',
				userId: actorIds['assigned-moderator'],
				fromRole: 'user',
				toRole: 'moderator'
			})
		).resolves.toEqual({
			role: 'assigned-moderator',
			userId: actorIds['assigned-moderator'],
			fromRole: 'user',
			toRole: 'moderator'
		});
		expect(update).toHaveBeenCalledWith({ role: 'moderator' });

		for (const roles of [
			{ fromRole: 'moderator', toRole: 'moderator' },
			{ fromRole: 'user', toRole: 'admin' }
		]) {
			await expect(
				adapters.elevateFreshActorRole({
					manifest,
					role: 'assigned-moderator',
					userId: actorIds['assigned-moderator'],
					...roles
				})
			).rejects.toThrow(/only user to moderator elevation is permitted/u);
		}
		expect(update).toHaveBeenCalledTimes(1);

		const tamperedManifest = {
			...manifest,
			actors: manifest.actors.map((actor) =>
				actor.role === 'assigned-moderator'
					? { ...actor, createdAt: '2026-08-09T12:00:01.000Z' }
					: actor
			)
		};
		await expect(
			adapters.elevateFreshActorRole({
				manifest: tamperedManifest,
				role: 'assigned-moderator',
				userId: actorIds['assigned-moderator'],
				fromRole: 'user',
				toRole: 'moderator'
			})
		).rejects.toThrow(/fresh A9 actor provenance is invalid/u);
		expect(update).toHaveBeenCalledTimes(1);
	});

	it('inspects exact profile, membership, role, and zero A9 artifact counts', async () => {
		const config = validateHostedA9Environment(a9Environment);
		const manifest = completeActorManifest(config);
		const getUserById = vi.fn().mockImplementation(async (userId: string) => {
			const role = Object.entries(actorIds).find(([, id]) => id === userId)?.[0] as keyof typeof actorIds;
			return { data: { user: provisionedUser(role, userId) }, error: null };
		});
		const from = vi.fn((table: string) => {
			if (table === 'profiles' || table === 'beta_memberships') {
				const data =
					table === 'profiles'
						? { id: actorIds.reporter, role: 'user', is_suspended: false }
						: {
								profile_id: actorIds.reporter,
								status: 'active',
								onboarding_completed_at: actorCreatedAt
							};
				const query: Record<string, ReturnType<typeof vi.fn>> = {};
				query.select = vi.fn(() => query);
				query.eq = vi.fn(() => query);
				query.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
				return query;
			}
			const countQuery: Record<string, ReturnType<typeof vi.fn>> = {};
			countQuery.select = vi.fn(() => countQuery);
			countQuery.in = vi.fn().mockResolvedValue({ data: null, error: null, count: 0 });
			countQuery.or = vi.fn().mockResolvedValue({ data: null, error: null, count: 0 });
			return countQuery;
		});
		const adapters = createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: { admin: { getUserById } },
				from,
				storage: {
					from: vi.fn(() => ({
						list: vi.fn().mockResolvedValue({ data: [], error: null })
					}))
				}
			} as never,
			createActorClient: vi.fn() as never,
			credentialSink: noopModeratorCredentialSink()
		});

		await expect(
			adapters.inspectFreshActor({ manifest, role: 'reporter', userId: actorIds.reporter })
		).resolves.toEqual({
			role: 'reporter',
			userId: actorIds.reporter,
			emailConfirmed: true,
			profileRole: 'user',
			isSuspended: false,
			membershipStatus: 'active',
			onboardingComplete: true
		});
		await expect(adapters.inspectZeroA9Artifacts({ manifest })).resolves.toEqual({
			reports: 0,
			uploads: 0,
			objects: 0,
			queueRows: 0
		});
		expect(from.mock.calls.map(([table]) => table)).toEqual(
			expect.arrayContaining([
				'profiles',
				'beta_memberships',
				'reports',
				'report_evidence_uploads',
				'upload_cleanup_queue'
			])
		);
	});

	it('rejects suspended, inactive, incomplete, or role-mismatched final actor state', async () => {
		const config = validateHostedA9Environment(a9Environment);
		const manifest = completeActorManifest(config);
		let profile = { id: actorIds.reporter, role: 'user', is_suspended: false };
		let membership: {
			profile_id: string;
			status: string;
			onboarding_completed_at: string | null;
		} = {
			profile_id: actorIds.reporter,
			status: 'active',
			onboarding_completed_at: actorCreatedAt
		};
		const from = vi.fn((table: string) => {
			const query: Record<string, ReturnType<typeof vi.fn>> = {};
			query.select = vi.fn(() => query);
			query.eq = vi.fn(() => query);
			query.maybeSingle = vi.fn().mockImplementation(async () => ({
				data: table === 'profiles' ? profile : membership,
				error: null
			}));
			return query;
		});
		const adapters = createSupabaseHostedA9Adapters({
			config,
			serviceClient: {
				supabaseUrl: HOSTED_STAGING.supabaseUrl,
				auth: {
					admin: {
						getUserById: vi.fn().mockResolvedValue({
							data: { user: provisionedUser('reporter', actorIds.reporter) },
							error: null
						})
					}
				},
				from
			} as never,
			createActorClient: vi.fn() as never,
			credentialSink: noopModeratorCredentialSink()
		});
		const inspect = () =>
			adapters.inspectFreshActor({ manifest, role: 'reporter', userId: actorIds.reporter });

		profile = { ...profile, is_suspended: true };
		await expect(inspect()).rejects.toThrow(/exact A9 actor state inspection failed/u);
		profile = { ...profile, is_suspended: false };
		membership = { ...membership, status: 'pending' };
		await expect(inspect()).rejects.toThrow(/exact A9 actor state inspection failed/u);
		membership = { ...membership, status: 'active', onboarding_completed_at: null };
		await expect(inspect()).rejects.toThrow(/exact A9 actor state inspection failed/u);
		membership = { ...membership, onboarding_completed_at: actorCreatedAt };
		profile = { ...profile, role: 'moderator' };
		await expect(inspect()).rejects.toThrow(/exact A9 actor state inspection failed/u);
	});
});


it('compensates a created actor whose provider timestamp is outside the hosted contract', async () => {
	const config = validateHostedA9Environment(a9Environment);
	const userId = actorIds.reporter;
	const unsupportedCreatedAt = '2026-08-09T12:00:00+00:00';
	const user = {
		...provisionedUser('reporter', userId),
		created_at: unsupportedCreatedAt
	};

	const listUsers = vi.fn().mockResolvedValue({
		data: { users: [], lastPage: 1 },
		error: null
	});
	const createUser = vi.fn().mockResolvedValue({
		data: { user },
		error: null
	});
	const deleteUser = vi.fn().mockResolvedValue({ error: null });
	const getUserById = vi.fn().mockResolvedValue({
		data: { user: null },
		error: { status: 404 }
	});

	const adapters = createSupabaseHostedA9Adapters({
		config,
		serviceClient: {
			supabaseUrl: HOSTED_STAGING.supabaseUrl,
			auth: {
				admin: {
					listUsers,
					createUser,
					deleteUser,
					getUserById
				}
			}
		} as never,
		createActorClient: vi.fn() as never,
		credentialSink: noopModeratorCredentialSink()
	});

	const manifest = registerHostedActorIntent(
		createHostedRunManifest(config),
		'reporter'
	);

	await expect(
		adapters.assertFreshActorAbsent({ manifest, role: 'reporter' })
	).resolves.toEqual({ role: 'reporter', absent: true });

	await expect(
		adapters.createConfirmedUser({ manifest, role: 'reporter' })
	).rejects.toThrow(/confirmed A9 actor creation failed/u);

	expect(createUser).toHaveBeenCalledOnce();
	expect(deleteUser).toHaveBeenCalledWith(userId);
	expect(getUserById).toHaveBeenCalledWith(userId);
});


it('keeps timestamp compensation failures sanitized', async () => {
	const config = validateHostedA9Environment(a9Environment);
	const userId = actorIds.reporter;
	const privateProviderDetail = actorEnvironment.E2E_REAL_REPORTER_EMAIL;
	const user = {
		...provisionedUser('reporter', userId),
		created_at: '2026-08-09T12:00:00+00:00'
	};

	const adapters = createSupabaseHostedA9Adapters({
		config,
		serviceClient: {
			supabaseUrl: HOSTED_STAGING.supabaseUrl,
			auth: {
				admin: {
					listUsers: vi.fn().mockResolvedValue({
						data: { users: [], lastPage: 1 },
						error: null
					}),
					createUser: vi.fn().mockResolvedValue({
						data: { user },
						error: null
					}),
					deleteUser: vi.fn().mockResolvedValue({
						error: { message: privateProviderDetail }
					}),
					getUserById: vi.fn()
				}
			}
		} as never,
		createActorClient: vi.fn() as never,
		credentialSink: noopModeratorCredentialSink()
	});

	const manifest = registerHostedActorIntent(
		createHostedRunManifest(config),
		'reporter'
	);

	await adapters.assertFreshActorAbsent({ manifest, role: 'reporter' });

	let caught: unknown;
	try {
		await adapters.createConfirmedUser({ manifest, role: 'reporter' });
	} catch (error) {
		caught = error;
	}

	expect(caught).toBeInstanceOf(HostedEvidenceOperatorError);
	expect(String(caught)).toContain('A9 actor creation compensation failed');
	expect(String(caught)).not.toContain(privateProviderDetail);
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
			totpSecret: syntheticTotpSecret,
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
					in: () => Promise.resolve({ data: rows[table], error: null }),
					like: () => Promise.resolve({ data: rows[table], error: null })
				};
				return query;
			},
			storage: {
				from: () => ({
					list: vi
						.fn()
						.mockResolvedValueOnce({
							data: [{ name: `${uploadId}.webp` }],
							error: null
						})
						.mockResolvedValue({ data: [], error: null })
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
		const listObjects = vi
			.fn()
			.mockResolvedValueOnce({ data: [{ name: `${uploadId}.webp` }], error: null })
			.mockResolvedValue({ data: [], error: null });
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
						}),
					like: () => Promise.resolve({ data: [], error: null })
				};
				return query;
			},
			rpc: vi.fn(),
			storage: {
				from: () => ({ list: listObjects })
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
			return {
				status: 202,
				json: async () => ({ claimed: 1, completed: 1, failed: 0, requestId })
			};
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

	it('adds only the exact canonical checkpoint ID to the approved A10 receipt allow-list', () => {
		const record = createSanitizedOperatorRecord(
			{
				event: 'hosted_scenario_2',
				runId,
				actorRole: 'reporter',
				status: 'PASS',
				boundary: 'HTTP',
				actualResult: 'HTTP 200',
				requestId: 'not-exposed',
				before: cleanInventory(),
				after: cleanInventory(),
				cleanup: 'pending-A11',
				providerBody: 'private-provider-body'
			},
			'primary-report-created'
		);

		expect(record).toEqual({
			event: 'hosted_scenario_2',
			runId,
			actorRole: 'reporter',
			status: 'PASS',
			boundary: 'HTTP',
			actualResult: 'HTTP 200',
			requestId: 'not-exposed',
			before: cleanInventory(),
			after: cleanInventory(),
			cleanup: 'pending-A11',
			checkpointId: 'primary-report-created'
		});
		expect(JSON.stringify(record)).not.toContain('private-provider-body');
	});

	it('binds and deeply freezes annotation evidence to the exact run, scenario, role, and checkpoint', () => {
		const base = {
			event: 'hosted_scenario_2',
			runId,
			actorRole: 'reporter',
			status: 'PASS',
			boundary: 'HTTP',
			actualResult: 'HTTP 200',
			requestId: 'not-exposed',
			before: cleanInventory(),
			after: cleanInventory(),
			cleanup: 'pending-A11',
			checkpointId: 'primary-report-created'
		};
		const expected = { checkpointId: 'primary-report-created', runId, scenario: 2, actorRole: 'reporter' };
		const record = createSanitizedOperatorRecord(base, expected as never);
		expect(Object.isFrozen(record)).toBe(true);
		expect(Object.isFrozen(record.before)).toBe(true);
		expect(Object.isFrozen(record.after)).toBe(true);
		for (const attack of [
			{ ...base, runId: 'gate3-20260809-deadbeef' },
			{ ...base, event: 'hosted_scenario_3' },
			{ ...base, actorRole: 'cross-user' },
			base
		]) {
			const attackedExpected = attack === base ? { ...expected, checkpointId: 'other-checkpoint' } : expected;
			expect(() => createSanitizedOperatorRecord(attack, attackedExpected as never)).toThrow(
				/operator receipt contains an unsafe field/u
			);
		}
	});

	it('does not probe or leak inherited, accessor, symbol, nested accessor, or proxy receipt attacks', () => {
		const sensitiveSentinel = ['receipt', 'secret', 'reporter@example.invalid'].join('-');
		const base = {
			event: 'hosted_scenario_2',
			runId,
			actorRole: 'reporter',
			status: 'PASS',
			boundary: 'HTTP',
			actualResult: 'HTTP 200',
			requestId: 'not-exposed',
			before: cleanInventory(),
			after: cleanInventory(),
			cleanup: 'pending-A11'
		};
		let accessorCalls = 0;
		const accessor = { ...base } as Record<string, unknown>;
		Object.defineProperty(accessor, 'event', {
			enumerable: true,
			get() {
				accessorCalls += 1;
				throw new Error(sensitiveSentinel);
			}
		});
		const nested = { ...base, before: {} as Record<string, unknown> };
		Object.defineProperty(nested.before, 'accounts', {
			enumerable: true,
			get() {
				accessorCalls += 1;
				throw new Error(sensitiveSentinel);
			}
		});
		const inherited = Object.assign(Object.create({ password: sensitiveSentinel }), base);
		const symbol = { ...base, [Symbol(sensitiveSentinel)]: sensitiveSentinel };
		const proxy = new Proxy(base, {
			get() {
				accessorCalls += 1;
				throw new Error(sensitiveSentinel);
			}
		});

		for (const hostile of [accessor, nested, inherited, symbol, proxy]) {
			let caught: unknown;
			try {
				createSanitizedOperatorRecord(hostile as never, 'primary-report-created');
			} catch (error) {
				caught = error;
			}
			const serialized = caught ? String(caught) : JSON.stringify(createSanitizedOperatorRecord(hostile as never, 'primary-report-created'));
			expect(serialized).not.toContain(sensitiveSentinel);
		}
		expect(accessorCalls).toBe(0);
	});

	it('routes a manifest-owned upload and queue row to exact cleanup coordinates', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const uploadId = '33333333-3333-4333-8333-333333333333';
		const objectPath = `${actorIds.reporter}/${uploadId}.webp`;
		let manifest = reporterManifest(config);
		manifest = registerHostedUpload(manifest, uploadId, 'reporter', objectPath);
		manifest = registerHostedQueueRow(manifest, 17, uploadId);
		const invokeCleanupWorker = vi.fn();
		const invokeExactCleanupWorker = vi.fn().mockResolvedValue({
			status: 202,
			requestId: '44444444-4444-4444-8444-444444444444'
		});
		const operator = createHostedEvidenceOperator({
			config,
			adapters: { invokeCleanupWorker, invokeExactCleanupWorker } as never
		});

		await expect(operator.processCleanupQueue(manifest, uploadId, 17)).resolves.toEqual({
			status: 202,
			requestId: '44444444-4444-4444-8444-444444444444'
		});
		expect(invokeExactCleanupWorker).toHaveBeenCalledOnce();
		expect(invokeExactCleanupWorker).toHaveBeenCalledWith({
			queueId: 17,
			bucketId: 'report-evidence',
			storagePath: objectPath
		});
		expect(invokeCleanupWorker).not.toHaveBeenCalled();
	});

	it('rejects a mismatched manifest queue linkage before privileged cleanup', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const firstUploadId = '33333333-3333-4333-8333-333333333333';
		const secondUploadId = '44444444-4444-4444-8444-444444444444';
		let manifest = reporterManifest(config);
		manifest = registerHostedUpload(
			manifest,
			firstUploadId,
			'reporter',
			`${actorIds.reporter}/${firstUploadId}.webp`
		);
		manifest = registerHostedUpload(
			manifest,
			secondUploadId,
			'reporter',
			`${actorIds.reporter}/${secondUploadId}.webp`
		);
		manifest = registerHostedQueueRow(manifest, 17, secondUploadId);
		const invokeCleanupWorker = vi.fn();
		const invokeExactCleanupWorker = vi.fn();
		const operator = createHostedEvidenceOperator({
			config,
			adapters: { invokeCleanupWorker, invokeExactCleanupWorker } as never
		});

		await expect(
			operator.processCleanupQueue(manifest, firstUploadId, 17)
		).rejects.toThrow('queue row is outside the exact manifest upload scope');
		expect(invokeExactCleanupWorker).not.toHaveBeenCalled();
		expect(invokeCleanupWorker).not.toHaveBeenCalled();
	});

	it('rejects structurally inconsistent exact cleanup coordinates even when queue linkage is self-consistent', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const uploadId = '33333333-3333-4333-8333-333333333333';
		const registeredPath = `${actorIds.reporter}/${uploadId}.webp`;
		let manifest = reporterManifest(config);
		manifest = registerHostedUpload(manifest, uploadId, 'reporter', registeredPath);
		manifest = registerHostedQueueRow(manifest, 17, uploadId);
		const forgedManifest = {
			...manifest,
			uploads: [
				{
					...manifest.uploads[0],
					objectPath: `22222222-2222-4222-8222-222222222222/${uploadId}.webp`
				}
			]
		};
		const invokeExactCleanupWorker = vi.fn();
		const operator = createHostedEvidenceOperator({
			config,
			adapters: {
				invokeCleanupWorker: vi.fn(),
				invokeExactCleanupWorker
			} as never
		});

		await expect(
			operator.processCleanupQueue(forgedManifest as never, uploadId, 17)
		).rejects.toThrow('object path is outside the exact run manifest');
		expect(invokeExactCleanupWorker).not.toHaveBeenCalled();
	});

	it('posts one exact cleanup request and validates its scoped receipt', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const uploadId = '33333333-3333-4333-8333-333333333333';
		const objectPath = `${actorIds.reporter}/${uploadId}.webp`;
		const requestId = '44444444-4444-4444-8444-444444444444';
		const fetchImpl = vi.fn().mockResolvedValue({
			status: 202,
			json: async () => ({
				claimed: 1,
				completed: 1,
				failed: 0,
				requestId,
				scope: 'exact'
			})
		});
		const adapters = createSupabaseHostedEvidenceAdapters({
			config,
			serviceClient: { supabaseUrl: HOSTED_STAGING.supabaseUrl } as never,
			managementAccessToken: 'management-token',
			cleanupSecret: 'x'.repeat(32),
			fetchImpl: fetchImpl as never
		});

		await expect(
			adapters.invokeExactCleanupWorker({
				queueId: 17,
				bucketId: 'report-evidence',
				storagePath: objectPath
			})
		).resolves.toEqual({ status: 202, requestId });
		expect(fetchImpl).toHaveBeenCalledOnce();
		const [url, init] = fetchImpl.mock.calls[0];
		expect(String(url)).toBe(`${HOSTED_STAGING.supabaseUrl}/functions/v1/upload-cleanup`);
		expect(init).toMatchObject({
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-upload-cleanup-secret': 'x'.repeat(32)
			}
		});
		expect(JSON.parse(String(init?.body))).toEqual({
			queueId: 17,
			bucketId: 'report-evidence',
			storagePath: objectPath
		});
	});

	it('rejects a 202 cleanup receipt that reports any failed deletion', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const requestId = '44444444-4444-4444-8444-444444444444';
		const adapters = createSupabaseHostedEvidenceAdapters({
			config,
			serviceClient: { supabaseUrl: HOSTED_STAGING.supabaseUrl } as never,
			managementAccessToken: 'management-token',
			cleanupSecret: 'x'.repeat(32),
			fetchImpl: vi.fn().mockResolvedValue({
				status: 202,
				json: async () => ({ claimed: 1, completed: 0, failed: 1, requestId })
			}) as never
		});

		await expect(
			createHostedEvidenceOperator({ config, adapters }).processCleanupQueue()
		).rejects.toThrow('exact hosted cleanup receipt is invalid');
	});

	it('recovers and removes an exact actor left after a pre-create intent checkpoint', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = reporterIntentManifest(config);
		const user = provisionedUser('reporter', actorIds.reporter);
		let deleted = false;
		const listUsers = vi.fn(async () => ({
			data: { users: deleted ? [] : [user], lastPage: 1 },
			error: null
		}));
		const serviceClient = {
			auth: {
				admin: {
					listUsers,
					getUserById: vi.fn(async () =>
						deleted
							? { data: { user: null }, error: { status: 404 } }
							: { data: { user }, error: null }
					),
					deleteUser: vi.fn(async () => {
						deleted = true;
						return { error: null };
					})
				}
			},
			from: () => {
				const query = {
					select: () => query,
					in: () => Promise.resolve({ data: [], error: null }),
					like: () => Promise.resolve({ data: [], error: null })
				};
				return query;
			},
			storage: { from: () => ({ list: vi.fn().mockResolvedValue({ data: [], error: null }) }) },
			rpc: vi.fn()
		};
		const requestId = '44444444-4444-4444-8444-444444444444';
		const adapters = createSupabaseHostedEvidenceAdapters({
			config,
			serviceClient: serviceClient as never,
			managementAccessToken: 'management-token',
			cleanupSecret: 'x'.repeat(32),
			fetchImpl: vi.fn().mockResolvedValue({
				status: 202,
				json: async () => ({ claimed: 0, completed: 0, failed: 0, requestId })
			}) as never
		});
		const operator = createHostedEvidenceOperator({ config, adapters });

		await expect(operator.inspect(manifest)).resolves.toMatchObject({
			accounts: 1,
			foreignArtifacts: 0
		});
		await operator.remove(manifest);
		expect(deleted).toBe(true);
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
					in: () => Promise.resolve({ data: [], error: null }),
					like: () => Promise.resolve({ data: [], error: null })
				};
				return query;
			},
			storage: {
				from: () => ({ list: vi.fn().mockResolvedValue({ data: [], error: null }) })
			}
		};
		const fetchImpl = vi.fn().mockResolvedValue({
			status: 202,
			json: async () => ({
				claimed: 0,
				completed: 0,
				failed: 0,
				requestId: '44444444-4444-4444-8444-444444444444'
			})
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
					in: () => Promise.resolve({ data: [], error: null }),
					like: () => Promise.resolve({ data: [], error: null })
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
					},
					like: () => Promise.resolve({ data: [], error: null })
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
				json: async () => ({
					claimed: 0,
					completed: 0,
					failed: 0,
					requestId: '44444444-4444-4444-8444-444444444444'
				})
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
		const purgeModeratorTotpSecrets = vi.fn().mockResolvedValue(undefined);
		try {
			await persistHostedRunManifest(config, manifest, manifestPath);
			await expect(loadHostedRunManifest(config, manifestPath)).resolves.toEqual(manifest);
			await expect(
				cleanupHostedManifestFile({
					config,
					environment: baseEnvironment,
					manifestPath,
					operator: { inspect, remove },
					credentialStore: { purgeModeratorTotpSecrets },
					logger: { info: vi.fn() }
				})
			).rejects.toThrow(/A11 cleanup gate is disabled/u);
			expect(remove).not.toHaveBeenCalled();
			expect(purgeModeratorTotpSecrets).not.toHaveBeenCalled();
			await expect(loadHostedRunManifest(config, manifestPath)).resolves.toEqual(manifest);

			await expect(
				cleanupHostedManifestFile({
					config,
					environment: approvedCleanupEnvironment,
					manifestPath,
					operator: { inspect, remove },
					credentialStore: { purgeModeratorTotpSecrets },
					logger: { info: vi.fn() }
				})
			).resolves.toEqual({ cleaned: true, counts: cleanInventory() });
			expect(remove).toHaveBeenCalledOnce();
			expect(purgeModeratorTotpSecrets).toHaveBeenCalledOnce();
			await expect(loadHostedRunManifest(config, manifestPath)).rejects.toThrow(
				/hosted run manifest is unavailable/u
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('retries authenticated tombstone finalization after the manifest was removed', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = reporterManifest(config);
		const directory = await mkdtemp(join(tmpdir(), 'gate3-manifest-'));
		const manifestPath = join(directory, 'run.json');
		const inspect = vi
			.fn()
			.mockResolvedValueOnce(cleanInventory({ accounts: 1 }))
			.mockResolvedValueOnce(cleanInventory());
		const remove = vi.fn().mockResolvedValue(undefined);
		const purgeModeratorTotpSecrets = vi.fn().mockResolvedValue(undefined);
		const finalizePurgeTombstone = vi
			.fn()
			.mockRejectedValueOnce(new Error('transient local file lock'))
			.mockResolvedValueOnce(undefined);
		try {
			await persistHostedRunManifest(config, manifest, manifestPath);
			await expect(
				cleanupHostedManifestFile({
					config,
					environment: approvedCleanupEnvironment,
					manifestPath,
					operator: { inspect, remove },
					credentialStore: { purgeModeratorTotpSecrets, finalizePurgeTombstone },
					logger: { info: vi.fn() }
				})
			).rejects.toThrow(/moderator credential tombstone removal failed/u);
			await expect(loadHostedRunManifest(config, manifestPath)).rejects.toThrow(
				/hosted run manifest is unavailable/u
			);

			await expect(
				cleanupHostedManifestFile({
					config,
					environment: approvedCleanupEnvironment,
					manifestPath,
					operator: { inspect, remove },
					credentialStore: { purgeModeratorTotpSecrets, finalizePurgeTombstone },
					logger: { info: vi.fn() }
				})
			).resolves.toEqual({ cleaned: true, counts: cleanInventory() });
			expect(remove).toHaveBeenCalledOnce();
			expect(purgeModeratorTotpSecrets).toHaveBeenCalledOnce();
			expect(finalizePurgeTombstone).toHaveBeenCalledTimes(2);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('authenticates the concrete purged store before missing-manifest recovery', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const directory = await mkdtemp(join(tmpdir(), 'gate3-manifest-'));
		const manifestPath = join(directory, 'missing-run.json');
		const storePath = join(directory, 'moderator-totp.enc');
		const store = createEncryptedModeratorCredentialStore({
			filePath: storePath,
			encryptionKey: 'k'.repeat(48),
			projectRef: config.target.projectRef,
			runId: config.runId
		});
		const inspect = vi.fn();
		const remove = vi.fn();
		try {
			await store.initializeModeratorTotpSecrets();
			await store.purgeModeratorTotpSecrets();

			await expect(
				cleanupHostedManifestFile({
					config,
					environment: approvedCleanupEnvironment,
					manifestPath,
					operator: { inspect, remove },
					credentialStore: store,
					logger: { info: vi.fn() }
				})
			).resolves.toEqual({ cleaned: true, counts: cleanInventory() });
			expect(inspect).not.toHaveBeenCalled();
			expect(remove).not.toHaveBeenCalled();
			await expect(stat(storePath)).rejects.toMatchObject({ code: 'ENOENT' });
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('treats an already-absent purge tombstone as completed missing-manifest recovery', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const directory = await mkdtemp(join(tmpdir(), 'gate3-manifest-'));
		const manifestPath = join(directory, 'missing-run.json');
		const storePath = join(directory, 'missing-moderator-totp.enc');
		const store = createEncryptedModeratorCredentialStore({
			filePath: storePath,
			encryptionKey: 'k'.repeat(48),
			projectRef: config.target.projectRef,
			runId: config.runId
		});
		const finalizePurgeTombstone = vi.fn(() => store.finalizePurgeTombstone());
		try {
			await expect(
				cleanupHostedManifestFile({
					config,
					environment: approvedCleanupEnvironment,
					manifestPath,
					operator: { inspect: vi.fn(), remove: vi.fn() },
					credentialStore: {
						credentialStoreId: store.credentialStoreId,
						purgeModeratorTotpSecrets: vi.fn(),
						finalizePurgeTombstone
					},
					logger: { info: vi.fn() }
				})
			).resolves.toEqual({ cleaned: true, counts: cleanInventory() });
			expect(finalizePurgeTombstone).toHaveBeenCalledOnce();
			await expect(stat(manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
			await expect(stat(storePath)).rejects.toMatchObject({ code: 'ENOENT' });
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('fails closed for non-finalizable concrete stores when the manifest is absent', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const directory = await mkdtemp(join(tmpdir(), 'gate3-manifest-'));
		const encryptionKey = 'k'.repeat(48);
		const wrongEncryptionKey = 'w'.repeat(48);
		try {
			for (const scenario of ['active', 'wrong-key', 'corrupt'] as const) {
				const manifestPath = join(directory, `${scenario}.json`);
				const storePath = join(directory, `${scenario}.enc`);
				const exactStore = createEncryptedModeratorCredentialStore({
					filePath: storePath,
					encryptionKey,
					projectRef: config.target.projectRef,
					runId: config.runId
				});
				await exactStore.initializeModeratorTotpSecrets();
				if (scenario === 'wrong-key' || scenario === 'corrupt') {
					await exactStore.purgeModeratorTotpSecrets();
				}
				if (scenario === 'corrupt') await writeFile(storePath, 'not-an-envelope\n');
				const recoveryStore =
					scenario === 'wrong-key'
						? createEncryptedModeratorCredentialStore({
								filePath: storePath,
								encryptionKey: wrongEncryptionKey,
								projectRef: config.target.projectRef,
								runId: config.runId
							})
						: exactStore;
				const inspect = vi.fn();
				const remove = vi.fn();
				const purgeModeratorTotpSecrets = vi.fn(() =>
					recoveryStore.purgeModeratorTotpSecrets()
				);
				const finalizePurgeTombstone = vi.fn(() => recoveryStore.finalizePurgeTombstone());

				await expect(
					cleanupHostedManifestFile({
						config,
						environment: approvedCleanupEnvironment,
						manifestPath,
						operator: { inspect, remove },
						credentialStore: {
							credentialStoreId: recoveryStore.credentialStoreId,
							purgeModeratorTotpSecrets,
							finalizePurgeTombstone
						},
						logger: { info: vi.fn() }
					})
				).rejects.toThrow(/moderator credential tombstone removal failed/u);
				expect(inspect).not.toHaveBeenCalled();
				expect(remove).not.toHaveBeenCalled();
				expect(purgeModeratorTotpSecrets).not.toHaveBeenCalled();
				expect(finalizePurgeTombstone).toHaveBeenCalledOnce();
				await expect(readFile(storePath, 'utf8')).resolves.toBeTruthy();
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('does not finalize a concrete tombstone without the exact A11 gate and run', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const directory = await mkdtemp(join(tmpdir(), 'gate3-manifest-'));
		try {
			for (const scenario of ['gate', 'run'] as const) {
				const manifestPath = join(directory, `${scenario}.json`);
				const storePath = join(directory, `${scenario}.enc`);
				const store = createEncryptedModeratorCredentialStore({
					filePath: storePath,
					encryptionKey: 'k'.repeat(48),
					projectRef: config.target.projectRef,
					runId: config.runId
				});
				await store.initializeModeratorTotpSecrets();
				await store.purgeModeratorTotpSecrets();
				const inspect = vi.fn();
				const remove = vi.fn();
				const purgeModeratorTotpSecrets = vi.fn(() => store.purgeModeratorTotpSecrets());
				const finalizePurgeTombstone = vi.fn(() => store.finalizePurgeTombstone());
				const environment =
					scenario === 'gate'
						? baseEnvironment
						: {
								...approvedCleanupEnvironment,
								E2E_REAL_REPORT_EVIDENCE_RUN_ID: 'gate3-20260809-0002'
							};

				await expect(
					cleanupHostedManifestFile({
						config,
						environment,
						manifestPath,
						operator: { inspect, remove },
						credentialStore: {
							credentialStoreId: store.credentialStoreId,
							purgeModeratorTotpSecrets,
							finalizePurgeTombstone
						},
						logger: { info: vi.fn() }
					})
				).rejects.toThrow(
					scenario === 'gate'
						? /A11 cleanup gate is disabled/u
						: /run manifest target does not match approved staging/u
				);
				expect(inspect).not.toHaveBeenCalled();
				expect(remove).not.toHaveBeenCalled();
				expect(purgeModeratorTotpSecrets).not.toHaveBeenCalled();
				expect(finalizePurgeTombstone).not.toHaveBeenCalled();
				await expect(readFile(storePath, 'utf8')).resolves.toBeTruthy();
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('keeps the manifest when the A11 credential purge cannot be authenticated', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = reporterManifest(config);
		const directory = await mkdtemp(join(tmpdir(), 'gate3-manifest-'));
		const manifestPath = join(directory, 'run.json');
		try {
			await persistHostedRunManifest(config, manifest, manifestPath);
			await expect(
				cleanupHostedManifestFile({
					config,
					environment: approvedCleanupEnvironment,
					manifestPath,
					operator: {
						inspect: vi.fn().mockResolvedValue(cleanInventory()),
						remove: vi.fn()
					},
					credentialStore: {
						purgeModeratorTotpSecrets: vi
							.fn()
							.mockRejectedValue(new Error(`wrong key ${syntheticTotpSecret}`))
					},
					logger: { info: vi.fn() }
				})
			).rejects.toThrow(/moderator credential purge failed/u);
			await expect(loadHostedRunManifest(config, manifestPath)).resolves.toEqual(manifest);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('rejects a copied or substituted credential store before hosted A11 cleanup', async () => {
		const config = validateHostedOperatorEnvironment(baseEnvironment);
		const manifest = createHostedRunManifest(config, { credentialStoreId: 'a'.repeat(64) });
		const directory = await mkdtemp(join(tmpdir(), 'gate3-manifest-'));
		const manifestPath = join(directory, 'run.json');
		const inspect = vi.fn();
		try {
			await persistHostedRunManifest(config, manifest, manifestPath);
			await expect(
				cleanupHostedManifestFile({
					config,
					environment: approvedCleanupEnvironment,
					manifestPath,
					operator: { inspect, remove: vi.fn() },
					credentialStore: {
						credentialStoreId: 'b'.repeat(64),
						purgeModeratorTotpSecrets: vi.fn()
					},
					logger: { info: vi.fn() }
				})
			).rejects.toThrow('credential store binding is invalid');
			expect(inspect).not.toHaveBeenCalled();
			await expect(loadHostedRunManifest(config, manifestPath)).resolves.toEqual(manifest);
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
		expect(hostedSpec).toContain('isHostedA10ScenarioApproved(process.env)');
		expect(hostedSpec).toContain('validateHostedA10Environment(process.env)');
		expect(hostedSpec).toContain('validateHostedCleanupEnvironment(process.env)');
		expect(hostedSpec).toContain('createEncryptedModeratorCredentialStore');
		expect(hostedSpec).toContain('getModeratorTotpSecret');
		expect(hostedSpec).toContain('credentialStore,');
		expect(hostedSpec).not.toContain('_TOTP_SECRET');
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
