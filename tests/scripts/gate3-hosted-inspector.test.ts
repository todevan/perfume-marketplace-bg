import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	GATE3_PROJECT_REF,
	GATE3_WORKER_ORIGIN,
	createInitialRunState,
	reserveRunState,
	resolveGate3RunPaths,
	writeNextRunState
} from '../../scripts/gate3-hosted-state.mjs';
import { deriveSyntheticIdentity } from '../../scripts/gate3-hosted-secrets.mjs';
import {
	HOSTED_STAGING,
	createSupabaseHostedInspectionAdapter,
	createHostedRunManifest,
	persistHostedRunManifest,
	registerHostedActor,
	registerHostedActorIntent,
	registerHostedReport,
	registerHostedUpload
} from '../../scripts/hosted-report-evidence-operator.mjs';
import {
	inspectGate3HostedRun,
	resolveDeployedRelease,
	verifyIndependentHostedZero
} from '../../scripts/gate3-hosted-inspector.mjs';

const runId = 'gate3-20260820-abcdef12';
const releaseCommitSha = 'a'.repeat(40);
const provisioningAttemptId = '55555555-5555-4555-8555-555555555555';
const actorCreatedAt = '2026-08-20T10:01:00.000Z';
const actorId = '11111111-1111-4111-8111-111111111111';
const actorIds = {
	reporter: actorId,
	'cross-user': '22222222-2222-4222-8222-222222222222',
	'assigned-moderator': '33333333-3333-4333-8333-333333333333',
	'unassigned-moderator': '44444444-4444-4444-8444-444444444444'
} as const;

function expectedIdentities() {
	return ['reporter', 'cross-user', 'assigned-moderator', 'unassigned-moderator'].map(
		(role) => deriveSyntheticIdentity({ runId, role, identitySchemeVersion: 1 })
	);
}

const emptyCounts = {
	actors: 0,
	sessions: 0,
	mfaFactors: 0,
	profiles: 0,
	reports: 0,
	uploads: 0,
	objects: 0,
	queueRows: 0
};
const emptyForeignCounts = {
	syntheticAccounts: 0,
	profiles: 0,
	reports: 0,
	uploads: 0,
	objects: 0,
	queueRows: 0
};

function hostedFacts(overrides: Record<string, unknown> = {}) {
	return {
		counts: { ...emptyCounts },
		foreignCounts: { ...emptyForeignCounts },
		roleCounts: {
			reporter: 0,
			'cross-user': 0,
			'assigned-moderator': 0,
			'unassigned-moderator': 0
		},
		duplicateRoles: 0,
		metadataMismatches: 0,
		manifestActorsAbsent: 0,
		actorIdentityConflicts: 0,
		hostedActorsManifestStale: 0,
		confirmedActors: 0,
		completeProfiles: 0,
		verifiedModeratorTotpFactors: 0,
		actorsWithActiveSessions: 0,
		activeSessionsProven: false,
		foreignEvidenceSha256: createHash('sha256').update('').digest('hex'),
		...overrides
	};
}

function inspectionAdapter(overrides: Record<string, unknown> = {}) {
	return Object.freeze({
		inspectRun: vi.fn().mockResolvedValue(hostedFacts(overrides))
	});
}

const fixtureRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
	);
});

async function createFixture(options: {
	manifest?: 'empty' | 'pending' | 'actor' | 'artifact';
	manifestSha256?: string | null;
	secret?: 'missing' | 'valid' | 'corrupt';
	archived?: boolean;
} = {}) {
	const root = await mkdtemp(join(tmpdir(), 'gate3-hosted-inspector-'));
	fixtureRoots.push(root);
	const paths = resolveGate3RunPaths({ root, runId });
	const initial = createInitialRunState({
		runId,
		createdAt: '2026-08-20T10:00:00.000Z',
		releaseCommitSha,
		manifestPath: paths.manifestPath,
		secretPath: paths.secretPath
	});
	await reserveRunState(paths, initial);
	const config = { target: { projectRef: GATE3_PROJECT_REF }, runId } as never;
	let manifest = createHostedRunManifest(config, { provisioningAttemptId });
	if (options.manifest === 'pending') {
		manifest = registerHostedActorIntent(manifest, 'reporter');
	}
	if (options.manifest === 'actor' || options.manifest === 'artifact') {
		manifest = registerHostedActor(manifest, 'reporter', actorId, actorCreatedAt);
	}
	if (options.manifest === 'artifact') {
		manifest = registerHostedReport(
			manifest,
			'66666666-6666-4666-8666-666666666666',
			'reporter'
		);
	}
	await persistHostedRunManifest(config, manifest, paths.manifestPath);
	const manifestBytes = await readFile(paths.manifestPath);
	const actualManifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
	const secretBytes = Buffer.from('ciphertext-never-returned');
	let secretStore: { path: string; status: string; ciphertextSha256: string | null } =
		initial.secretStore;
	if (options.secret === 'valid' || options.secret === 'corrupt') {
		await writeFile(paths.secretPath, secretBytes);
		secretStore = {
			path: paths.secretPath,
			status: 'persisted',
			ciphertextSha256:
				options.secret === 'corrupt'
					? 'f'.repeat(64)
					: createHash('sha256').update(secretBytes).digest('hex')
		};
	}
	const archived = options.archived
		? {
				status: 'complete',
				destination: paths.archiveDirectory,
				requestedAt: '2026-08-20T11:00:00.000Z',
				completedAt: '2026-08-20T11:01:00.000Z',
				manifestSha256: actualManifestSha256
			}
		: null;
	const state = {
		...initial,
		revision: 1,
		manifest: {
			path: paths.manifestPath,
			sha256:
				options.manifestSha256 === undefined
					? actualManifestSha256
					: options.manifestSha256
		},
		secretStore,
		archive: archived
	};
	await writeNextRunState(paths, initial, state);
	return { paths, state, manifest, actualManifestSha256 };
}

function responseWith(sha: string) {
	return vi.fn().mockResolvedValue(
		new Response('', {
			status: 200,
			headers: { 'x-deployed-git-sha': sha }
		})
	);
}

function realInspectionClient(options: {
	users?: Array<Record<string, unknown>>;
	rows?: Record<string, Array<Record<string, unknown>>>;
	objects?: Record<string, Array<Record<string, unknown>>>;
} = {}) {
	const rows = options.rows ?? {};
	const client = {
		supabaseUrl: HOSTED_STAGING.supabaseUrl,
		auth: {
			admin: {
				listUsers: async ({ page, perPage }: { page: number; perPage: number }) => ({
					data: {
						users: (options.users ?? []).slice((page - 1) * perPage, page * perPage),
						total: options.users?.length ?? 0,
						lastPage: 1
					},
					error: null
				})
			}
		},
		from(table: string) {
			const filters: Array<(row: Record<string, unknown>) => boolean> = [];
			let orderColumn = 'id';
			const query = {
				select: () => query,
				in: (column: string, values: Array<string | number>) => {
					filters.push((row) => values.map(String).includes(String(row[column])));
					return query;
				},
				like: (column: string, pattern: string) => {
					const prefix = pattern.slice(0, -1);
					filters.push((row) => String(row[column] ?? '').startsWith(prefix));
					return query;
				},
				order: (column: string) => {
					orderColumn = column;
					return query;
				},
				range: (from: number, to: number) => {
					const data = (rows[table] ?? [])
						.filter((row) => filters.every((filter) => filter(row)))
						.sort((left, right) =>
							String(left[orderColumn] ?? '').localeCompare(String(right[orderColumn] ?? ''), undefined, {
								numeric: true
							})
						)
						.slice(from, to + 1);
					return Promise.resolve({ data, error: null });
				}
			};
			return query;
		},
		schema(name: string) {
			return { from: (table: string) => client.from(`${name}.${table}`) };
		},
		storage: {
			from: () => ({
				list: (prefix: string, range: { offset: number; limit: number }) =>
					Promise.resolve({
						data: (options.objects?.[prefix] ?? []).slice(range.offset, range.offset + range.limit),
						error: null
					})
			})
		}
	};
	return client;
}

async function replaceFixtureManifest(
	fixture: Awaited<ReturnType<typeof createFixture>>,
	manifest: ReturnType<typeof createHostedRunManifest>,
	stateOverrides: Record<string, unknown> = {}
) {
	const config = { target: { projectRef: GATE3_PROJECT_REF }, runId } as never;
	await persistHostedRunManifest(config, manifest, fixture.paths.manifestPath);
	const sha256 = createHash('sha256')
		.update(await readFile(fixture.paths.manifestPath))
		.digest('hex');
	const next = {
		...fixture.state,
		...stateOverrides,
		revision: fixture.state.revision + 1,
		manifest: { ...fixture.state.manifest, sha256 }
	};
	await writeNextRunState(fixture.paths, fixture.state, next as never);
	return next;
}

describe('Gate 3 deployed release evidence', () => {
	it('accepts only the bound staging origin and exact response SHA header', async () => {
		const fetchImpl = responseWith('a'.repeat(40));

		await expect(
			resolveDeployedRelease({ workerOrigin: GATE3_WORKER_ORIGIN, fetchImpl })
		).resolves.toBe('a'.repeat(40));
		expect(fetchImpl).toHaveBeenCalledWith(
			GATE3_WORKER_ORIGIN,
			expect.objectContaining({ method: 'GET', redirect: 'error' })
		);
	});

	it.each(['', 'abc', 'A'.repeat(40)])('rejects release header %s', async (sha) => {
		await expect(
			resolveDeployedRelease({
				workerOrigin: GATE3_WORKER_ORIGIN,
				fetchImpl: responseWith(sha)
			})
		).rejects.toThrow('release_evidence_invalid');
	});

	it('rejects every origin except the fixed staging Worker without fetching', async () => {
		const fetchImpl = responseWith('a'.repeat(40));

		await expect(
			resolveDeployedRelease({ workerOrigin: 'https://example.invalid', fetchImpl })
		).rejects.toThrow('worker_origin_invalid');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('fails closed when the bound Worker is unavailable', async () => {
		await expect(
			resolveDeployedRelease({
				workerOrigin: GATE3_WORKER_ORIGIN,
				fetchImpl: vi.fn().mockRejectedValue(new Error('provider body with token'))
			})
		).rejects.toThrow('release_evidence_unavailable');
	});
});

describe('universal read-only Gate 3 inspection', () => {
	it.each([
		['zero actors', hostedFacts(), 'PREFLIGHT_READY'],
		[
			'one actor',
			hostedFacts({
				counts: { ...emptyCounts, actors: 1 },
				roleCounts: {
					reporter: 1,
					'cross-user': 0,
					'assigned-moderator': 0,
					'unassigned-moderator': 0
				},
				confirmedActors: 1,
				completeProfiles: 1
			}),
			'PROVISION_PARTIAL'
		],
		[
			'four fully proven actors',
			hostedFacts({
				counts: { ...emptyCounts, actors: 4, sessions: 4, profiles: 4, mfaFactors: 2 },
				roleCounts: {
					reporter: 1,
					'cross-user': 1,
					'assigned-moderator': 1,
					'unassigned-moderator': 1
				},
				confirmedActors: 4,
				completeProfiles: 4,
				verifiedModeratorTotpFactors: 2,
				actorsWithActiveSessions: 4,
				activeSessionsProven: true
			}),
			'PROVISION_VERIFIED'
		],
		[
			'verified scenario',
			hostedFacts({
				counts: {
					...emptyCounts,
					actors: 4,
					sessions: 4,
					profiles: 4,
					mfaFactors: 2,
					reports: 1
				},
				roleCounts: {
					reporter: 1,
					'cross-user': 1,
					'assigned-moderator': 1,
					'unassigned-moderator': 1
				},
				confirmedActors: 4,
				completeProfiles: 4,
				verifiedModeratorTotpFactors: 2,
				actorsWithActiveSessions: 4,
				activeSessionsProven: true,
				scenarioVerified: true
			}),
			'SCENARIO_VERIFIED'
		]
	])('classifies %s without prematurely entering cleanup', async (_label, facts, expected) => {
		const { paths } = await createFixture();
		const result = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: inspectionAdapter(facts),
			fetchImpl: responseWith(releaseCommitSha)
		});

		expect(result.classification).toBe(expected);
		expect(result.cleanupRequired).toBe(false);
	});

	it('classifies residuals as cleanup partial only after a persisted cleanup start', async () => {
		const { paths, state } = await createFixture();
		await writeNextRunState(paths, state, {
			...state,
			revision: state.revision + 1,
			phases: {
				...state.phases,
				cleanup: {
					status: 'in-progress',
					checkpoint: { status: 'started', observedAt: '2026-08-20T10:30:00.000Z' }
				}
			}
		});
		const result = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: inspectionAdapter({ counts: { ...emptyCounts, actors: 1 } }),
			fetchImpl: responseWith(releaseCommitSha)
		});

		expect(result).toMatchObject({
			cleanupRequired: false,
			cleanupPartial: true,
			classification: 'CLEANUP_PARTIAL'
		});
	});

	it('classifies exact hosted lifecycle facts through the real read-only adapter path', async () => {
		const identities = expectedIdentities();
		const users = identities.map((identity) => ({
			id: actorIds[identity.role as keyof typeof actorIds],
			email: identity.email,
			created_at: actorCreatedAt,
			email_confirmed_at: actorCreatedAt,
			factors: identity.role.includes('moderator')
				? [{ factor_type: 'totp', status: 'verified' }]
				: [],
			user_metadata: {
				gate3_report_evidence_run_id: runId,
				gate3_report_evidence_provisioning_attempt_id: provisioningAttemptId
			}
		}));
		const profiles = identities.map((identity) => ({
			id: actorIds[identity.role as keyof typeof actorIds],
			username: identity.username,
			role: identity.role.includes('moderator') ? 'moderator' : 'user',
			is_suspended: false
		}));
		const memberships = identities.map((identity) => ({
			profile_id: actorIds[identity.role as keyof typeof actorIds],
			status: 'active',
			onboarding_completed_at: actorCreatedAt
		}));
		const inspect = async (
			fixture: Awaited<ReturnType<typeof createFixture>>,
			client: ReturnType<typeof realInspectionClient>
		) =>
			inspectGate3HostedRun({
				paths: fixture.paths,
				inspectionAdapter: createSupabaseHostedInspectionAdapter({
					projectRef: GATE3_PROJECT_REF,
					serviceClient: client as never
				}),
				fetchImpl: responseWith(releaseCommitSha)
			});

		const zero = await createFixture();
		await expect(inspect(zero, realInspectionClient())).resolves.toMatchObject({
			classification: 'PREFLIGHT_READY',
			cleanupRequired: false
		});

		const one = await createFixture({ manifest: 'actor' });
		await expect(
			inspect(one, realInspectionClient({ users: [users[0] ?? {}] }))
		).resolves.toMatchObject({
			classification: 'PROVISION_PARTIAL',
			cleanupRequired: false
		});

		const prepareFour = async (scenario: boolean, cleanupStatus?: 'in-progress' | 'required') => {
			const fixture = await createFixture();
			let manifest = fixture.manifest;
			for (const identity of identities) {
				manifest = registerHostedActor(
					manifest,
					identity.role,
					actorIds[identity.role as keyof typeof actorIds],
					actorCreatedAt
				);
			}
			const reportId = '66666666-6666-4666-8666-666666666666';
			const uploadId = '77777777-7777-4777-8777-777777777777';
			const objectPath = `${actorIds.reporter}/${uploadId}.webp`;
			if (scenario) {
				manifest = registerHostedReport(manifest, reportId, 'reporter');
				manifest = registerHostedUpload(manifest, uploadId, 'reporter', objectPath);
			}
			const checkpoint = {
				status: 'complete',
				step: 'primary-upload-attached-verified',
				observedAt: actorCreatedAt
			};
			const phases = {
				...fixture.state.phases,
				...(scenario
					? { scenario: { status: 'complete', checkpoint } }
					: {}),
				...(cleanupStatus
					? {
							cleanup: {
								status: cleanupStatus,
								checkpoint: {
									status: cleanupStatus === 'required' ? 'required' : 'started',
									observedAt: actorCreatedAt,
									...(cleanupStatus === 'required'
										? { reasonCode: 'cleanup_required' }
										: {})
								}
							}
						}
					: {})
			};
			await replaceFixtureManifest(fixture, manifest, {
				phases,
				scenarioCheckpoints: scenario
					? { 'scenario-primary-upload-attached-verified': checkpoint }
					: {}
			});
			return {
				fixture,
				client: realInspectionClient({
					users,
					rows: {
						'auth.sessions': users.map((user, index) => ({
							id: `session-${index}`,
							user_id: user.id,
							not_after: '2099-01-01T00:00:00.000Z'
						})),
						profiles,
						beta_memberships: memberships,
						...(scenario
							? {
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
											attached_at: actorCreatedAt
										}
									]
								}
							: {})
					},
					objects: scenario ? { [actorIds.reporter]: [{ name: `${uploadId}.webp` }] } : {}
				})
			};
		};

		const four = await prepareFour(false);
		await expect(inspect(four.fixture, four.client)).resolves.toMatchObject({
			classification: 'PROVISION_VERIFIED',
			activeSessionsProven: true,
			actorsWithActiveSessions: 4,
			cleanupRequired: false
		});
		const scenario = await prepareFour(true);
		await expect(inspect(scenario.fixture, scenario.client)).resolves.toMatchObject({
			classification: 'SCENARIO_VERIFIED',
			manifestMatches: true,
			ownershipConflict: false,
			metadataMismatches: 0,
			scenarioVerified: true,
			provisionVerified: true,
			activeSessionsProven: true,
			cleanupRequired: false
		});
		const cleanupStarted = await prepareFour(false, 'in-progress');
		await expect(inspect(cleanupStarted.fixture, cleanupStarted.client)).resolves.toMatchObject({
			classification: 'CLEANUP_PARTIAL',
			cleanupRequired: false
		});
		const residualCleanup = await prepareFour(false, 'required');
		await expect(inspect(residualCleanup.fixture, residualCleanup.client)).resolves.toMatchObject({
			classification: 'CLEANUP_REQUIRED',
			cleanupRequired: true
		});
	});

	it('keeps four incomplete actor shells unverified until A9 proof is complete', async () => {
		const { paths } = await createFixture();
		const result = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: inspectionAdapter({
				counts: { ...emptyCounts, actors: 4, profiles: 4, mfaFactors: 2 },
				roleCounts: {
					reporter: 1,
					'cross-user': 1,
					'assigned-moderator': 1,
					'unassigned-moderator': 1
				},
				confirmedActors: 3,
				completeProfiles: 3,
				verifiedModeratorTotpFactors: 1,
				activeSessionsProven: false
			}),
			fetchImpl: responseWith(releaseCommitSha)
		});

		expect(result).toMatchObject({
			provisionVerified: false,
			classification: 'PROVISION_PARTIAL',
			confirmedActors: 3,
			completeProfiles: 3,
			verifiedModeratorTotpFactors: 1,
			activeSessionsProven: false
		});
	});

	it('blocks provision verification when active sessions lack authoritative proof', async () => {
		const { paths } = await createFixture();
		const completeExceptSessions = hostedFacts({
			counts: { ...emptyCounts, actors: 4, profiles: 4, mfaFactors: 2 },
			roleCounts: {
				reporter: 1,
				'cross-user': 1,
				'assigned-moderator': 1,
				'unassigned-moderator': 1
			},
			confirmedActors: 4,
			completeProfiles: 4,
			verifiedModeratorTotpFactors: 2,
			actorsWithActiveSessions: 0,
			activeSessionsProven: false
		});
		const result = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: inspectionAdapter(completeExceptSessions),
			fetchImpl: responseWith(releaseCommitSha)
		});

		expect(result).toMatchObject({
			provisionVerified: false,
			classification: 'PROVISION_PARTIAL',
			activeSessionsProven: false
		});
	});

	it.each([
		['zero actors', 'empty', hostedFacts()],
		[
			'one exact pending role',
			'pending',
			hostedFacts({
				counts: { ...emptyCounts, actors: 1 },
				roleCounts: {
					reporter: 1,
					'cross-user': 0,
					'assigned-moderator': 0,
					'unassigned-moderator': 0
				},
				hostedActorsManifestStale: 0
			})
		],
		[
			'four exact roles',
			'empty',
			hostedFacts({
				counts: { ...emptyCounts, actors: 4 },
				roleCounts: {
					reporter: 1,
					'cross-user': 1,
					'assigned-moderator': 1,
					'unassigned-moderator': 1
				},
				hostedActorsManifestStale: 4
			})
		]
	])('reports %s using safe immutable facts', async (_label, manifestKind, adapterFacts) => {
		const { paths } = await createFixture({ manifest: manifestKind as 'empty' | 'pending' });
		const result = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: inspectionAdapter(adapterFacts),
			fetchImpl: responseWith(releaseCommitSha)
		});

		expect(result.stateValid).toBe(true);
		expect(result.manifestMatches).toBe(true);
		expect(result.counts.actors).toBe(adapterFacts.counts.actors);
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.counts)).toBe(true);
	});

	it.each([
		['duplicate role matches', { duplicateRoles: 1 }],
		['mismatched metadata', { metadataMismatches: 1 }],
		['same-role live replacement', { actorIdentityConflicts: 1, manifestActorsAbsent: 1 }]
	])('fails deletion-scope trust for %s', async (_label, override) => {
		const { paths } = await createFixture({ manifest: 'actor' });
		const result = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: inspectionAdapter(override),
			fetchImpl: responseWith(releaseCommitSha)
		});

		expect(result.ownershipConflict).toBe(true);
		expect(result.deletionScopeTrusted).toBe(false);
	});

	it.each([
		['manifest actor absent', 'actor', { manifestActorsAbsent: 1 }],
		[
			'hosted actor after intent but before actor registration',
			'pending',
			{ counts: { ...emptyCounts, actors: 1 }, hostedActorsManifestStale: 0 }
		],
		[
			'hosted actor before intent persistence',
			'empty',
			{ counts: { ...emptyCounts, actors: 1 }, hostedActorsManifestStale: 1 }
		]
	])('keeps the documented crash window distinct: %s', async (_label, manifestKind, override) => {
		const { paths } = await createFixture({ manifest: manifestKind as 'empty' | 'pending' | 'actor' });
		const result = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: inspectionAdapter(override),
			fetchImpl: responseWith(releaseCommitSha)
		});

		expect(result.ownershipConflict).toBe(false);
		expect(result.manifestActorsAbsent).toBe(
			'manifestActorsAbsent' in override ? override.manifestActorsAbsent : 0
		);
		expect(result.hostedActorsManifestStale).toBe(
			'hostedActorsManifestStale' in override ? override.hostedActorsManifestStale : 0
		);
	});

	it('separates foreign synthetic accounts and artifacts from exact run ownership', async () => {
		const { paths } = await createFixture();
		const result = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: inspectionAdapter({
				counts: { ...emptyCounts, actors: 1, reports: 1 },
				foreignCounts: {
					...emptyForeignCounts,
					syntheticAccounts: 1,
					reports: 2,
					objects: 1
				}
			}),
			fetchImpl: responseWith(releaseCommitSha)
		});

		expect(result.counts).toMatchObject({ actors: 1, reports: 1, objects: 0 });
		expect(result.foreignCounts).toMatchObject({
			syntheticAccounts: 1,
			reports: 2,
			objects: 1
		});
	});

	it('returns sanitized ambiguity facts for corrupt state without hosted reads', async () => {
		const { paths } = await createFixture();
		await writeFile(paths.statePath, '{corrupt-state');
		const adapter = inspectionAdapter();
		const result = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: adapter,
			fetchImpl: responseWith(releaseCommitSha)
		});

		expect(result).toMatchObject({
			stateValid: false,
			stateCorrupt: true,
			ambiguous: true,
			classification: 'AMBIGUOUS'
		});
		expect(adapter.inspectRun).not.toHaveBeenCalled();
	});

	it('distinguishes an invalid manifest from a valid manifest SHA mismatch', async () => {
		const invalid = await createFixture();
		await writeFile(invalid.paths.manifestPath, '{provider-body-secret');
		const invalidResult = await inspectGate3HostedRun({
			paths: invalid.paths,
			inspectionAdapter: inspectionAdapter(),
			fetchImpl: responseWith(releaseCommitSha)
		});
		expect(invalidResult).toMatchObject({ manifestValid: false, manifestMatches: false });

		const mismatch = await createFixture({ manifestSha256: 'b'.repeat(64) });
		const mismatchResult = await inspectGate3HostedRun({
			paths: mismatch.paths,
			inspectionAdapter: inspectionAdapter(),
			fetchImpl: responseWith(releaseCommitSha)
		});
		expect(mismatchResult).toMatchObject({
			manifestValid: true,
			manifestMismatch: true,
			manifestMatches: false
		});
	});

	it('recognizes only the initial empty manifest as a safe unbound baseline', async () => {
		const root = await mkdtemp(join(tmpdir(), 'gate3-hosted-inspector-unbound-'));
		fixtureRoots.push(root);
		const paths = resolveGate3RunPaths({ root, runId });
		const state = createInitialRunState({
			runId,
			createdAt: '2026-08-20T10:00:00.000Z',
			releaseCommitSha,
			manifestPath: paths.manifestPath,
			secretPath: paths.secretPath
		});
		await reserveRunState(paths, state);
		await persistHostedRunManifest(
			{ target: { projectRef: GATE3_PROJECT_REF }, runId } as never,
			createHostedRunManifest(
				{ target: { projectRef: GATE3_PROJECT_REF }, runId } as never,
				{ provisioningAttemptId }
			),
			paths.manifestPath
		);

		const result = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: inspectionAdapter(),
			fetchImpl: responseWith(releaseCommitSha)
		});

		expect(result).toMatchObject({
			manifestBindingStatus: 'unbound-empty-baseline',
			manifestExactMatch: false,
			manifestMatches: false,
			manifestMismatch: false,
			deletionScopeTrusted: false
		});
	});

	it.each(['pending', 'actor', 'artifact'] as const)(
		'treats a null-SHA %s manifest as unexplained and never deletion-trusted',
		async (manifest) => {
			const { paths } = await createFixture({ manifest, manifestSha256: null });
			const result = await inspectGate3HostedRun({
				paths,
				inspectionAdapter: inspectionAdapter(),
				fetchImpl: responseWith(releaseCommitSha)
			});

			expect(result).toMatchObject({
				manifestBindingStatus: 'unexplained-mismatch',
				manifestExactMatch: false,
				manifestMatches: false,
				manifestMismatch: true,
				deletionScopeTrusted: false,
				classification: 'AMBIGUOUS'
			});
		}
	);

	it('distinguishes a one-step manifest-ahead crash from an unexplained mismatch', async () => {
		const emptyManifest = createHostedRunManifest(
			{ target: { projectRef: GATE3_PROJECT_REF }, runId } as never,
			{ provisioningAttemptId }
		);
		const emptySha = createHash('sha256')
			.update(`${JSON.stringify(emptyManifest)}\n`)
			.digest('hex');
		const explained = await createFixture({ manifest: 'pending', manifestSha256: emptySha });
		const explainedResult = await inspectGate3HostedRun({
			paths: explained.paths,
			inspectionAdapter: inspectionAdapter(),
			fetchImpl: responseWith(releaseCommitSha)
		});
		expect(explainedResult).toMatchObject({
			manifestBindingStatus: 'manifest-ahead-state',
			manifestExactMatch: false,
			manifestMatches: false,
			manifestAheadState: true,
			manifestMismatch: false,
			deletionScopeTrusted: false
		});

		const unexplained = await createFixture({ manifest: 'pending', manifestSha256: 'b'.repeat(64) });
		const unexplainedResult = await inspectGate3HostedRun({
			paths: unexplained.paths,
			inspectionAdapter: inspectionAdapter(),
			fetchImpl: responseWith(releaseCommitSha)
		});
		expect(unexplainedResult).toMatchObject({
			manifestBindingStatus: 'unexplained-mismatch',
			manifestAheadState: false,
			manifestMismatch: true,
			deletionScopeTrusted: false
		});
	});

	it('fails closed when the release changed or authoritative evidence is unavailable', async () => {
		const { paths } = await createFixture();
		const changed = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: inspectionAdapter(),
			fetchImpl: responseWith('b'.repeat(40))
		});
		expect(changed).toMatchObject({
			authoritativeReleaseAvailable: true,
			releaseChanged: true,
			releaseMismatch: true
		});

		const unavailable = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: inspectionAdapter(),
			fetchImpl: vi.fn().mockRejectedValue(new Error('secret provider body'))
		});
		expect(unavailable).toMatchObject({
			authoritativeReleaseAvailable: false,
			authoritativeReleaseUnavailable: true,
			ambiguous: true
		});
	});

	it.each([
		['missing', 'missing'],
		['corrupt', 'corrupt']
	])('reports %s DPAPI metadata without decrypting ciphertext', async (_label, secret) => {
		const { paths } = await createFixture({ secret: secret as 'missing' | 'corrupt' });
		const decryptSecretStore = vi.fn();
		const result = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: inspectionAdapter(),
			fetchImpl: responseWith(releaseCommitSha),
			dependencies: { decryptSecretStore }
		});

		expect(result.secretStoreStatus).toBe(secret === 'missing' ? 'missing' : 'corrupt');
		expect(decryptSecretStore).not.toHaveBeenCalled();
	});

	it('recognizes an archived run without rewriting its state', async () => {
		const { paths } = await createFixture({ archived: true });
		await mkdir(paths.archiveRoot, { mode: 0o700 });
		await rename(paths.runDirectory, paths.archiveDirectory);
		const archivedStatePath = join(paths.archiveDirectory, 'gate3-run-state.json');
		const before = await readFile(archivedStatePath);
		const result = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: inspectionAdapter(),
			fetchImpl: responseWith(releaseCommitSha)
		});

		expect(result.archived).toBe(true);
		expect(await readFile(archivedStatePath)).toEqual(before);
	});

	it('does not treat a stale local scenario phase as hosted proof', async () => {
		const { paths, state } = await createFixture();
		await writeNextRunState(paths, state, {
			...state,
			revision: 2,
			phases: {
				...state.phases,
				scenario: {
					status: 'complete',
					checkpoint: { observedAt: '2026-08-20T10:30:00.000Z' }
				}
			}
		});

		const result = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: inspectionAdapter(),
			fetchImpl: responseWith(releaseCommitSha)
		});

		expect(result.scenarioVerified).toBe(false);
	});

	it('passes persisted safe scenario checkpoints to the hosted adapter for fresh derivation', async () => {
		const { paths, state } = await createFixture();
		const checkpoint = {
			status: 'complete',
			step: 'primary-upload-attached-verified',
			observedAt: '2026-08-20T10:30:00.000Z'
		};
		await writeNextRunState(paths, state, {
			...state,
			revision: state.revision + 1,
			phases: {
				...state.phases,
				scenario: { status: 'complete', checkpoint }
			},
			scenarioCheckpoints: {
				'scenario-primary-upload-attached-verified': checkpoint
			}
		});
		const inspectRun = vi.fn(async (scope: Record<string, any>) =>
			hostedFacts({
				counts: {
					...emptyCounts,
					actors: 4,
					sessions: 4,
					profiles: 4,
					mfaFactors: 2,
					reports: 1
				},
				roleCounts: {
					reporter: 1,
					'cross-user': 1,
					'assigned-moderator': 1,
					'unassigned-moderator': 1
				},
				confirmedActors: 4,
				completeProfiles: 4,
				verifiedModeratorTotpFactors: 2,
				actorsWithActiveSessions: 4,
				activeSessionsProven: true,
				scenarioVerified:
					scope.scenarioEvidence?.phase?.status === 'complete' &&
					Object.keys(scope.scenarioEvidence?.checkpoints ?? {}).length === 1
			})
		);
		const result = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: Object.freeze({ inspectRun }),
			fetchImpl: responseWith(releaseCommitSha)
		});

		expect(inspectRun).toHaveBeenCalledWith(
			expect.objectContaining({
				scenarioEvidence: {
					phase: { status: 'complete', checkpoint },
					checkpoints: { 'scenario-primary-upload-attached-verified': checkpoint }
				}
			})
		);
		expect(result.classification).toBe('SCENARIO_VERIFIED');
	});

	it('does not treat a stale local cleanup phase as hosted zero proof', async () => {
		const { paths, state } = await createFixture();
		await writeNextRunState(paths, state, {
			...state,
			revision: 2,
			phases: {
				...state.phases,
				cleanup: {
					status: 'complete',
					checkpoint: { observedAt: '2026-08-20T10:30:00.000Z' }
				}
			}
		});
		const adapter = Object.freeze({
			inspectRun: vi.fn().mockRejectedValue(new Error('provider unavailable'))
		});

		const result = await inspectGate3HostedRun({
			paths,
			inspectionAdapter: adapter,
			fetchImpl: responseWith(releaseCommitSha)
		});

		expect(result.cleanupVerified).toBe(false);
	});

	it('serializes only safe facts and hashes', async () => {
		const { paths } = await createFixture({ secret: 'valid' });
		const opaqueToken = ['access', 'token-never-returned'].join('-');
		const adapter = inspectionAdapter({
			providerBody: 'provider-body-never-returned',
			email: 'actor@example.invalid',
			token: opaqueToken,
			ciphertext: 'ciphertext-never-returned'
		});
		const serialized = JSON.stringify(
			await inspectGate3HostedRun({
				paths,
				inspectionAdapter: adapter,
				fetchImpl: responseWith(releaseCommitSha)
			})
		);

		for (const forbidden of [
			'actor@example.invalid',
			opaqueToken,
			'provider-body-never-returned',
			'ciphertext-never-returned'
		]) {
			expect(serialized).not.toContain(forbidden);
		}
	});

	it('rejects a mutation-capable adapter before any hosted read', async () => {
		const { paths } = await createFixture();
		const inspectRun = vi.fn().mockResolvedValue(hostedFacts());

		await expect(
			inspectGate3HostedRun({
				paths,
				inspectionAdapter: { inspectRun, deleteUser: vi.fn() } as never,
				fetchImpl: responseWith(releaseCommitSha)
			})
		).rejects.toThrow('inspection_adapter_not_read_only');
		expect(inspectRun).not.toHaveBeenCalled();
	});
});

describe('independent hosted zero verification', () => {
	it('requires the complete deterministic identity set before creating an adapter', async () => {
		const adapterFactory = vi.fn();

		await expect(
			verifyIndependentHostedZero({
				adapterFactory,
				scope: {
					runId,
					createdAfter: '2026-08-20T10:00:00.000Z',
					manifest: createHostedRunManifest(
						{ target: { projectRef: GATE3_PROJECT_REF }, runId } as never,
						{ provisioningAttemptId }
					),
					expectedIdentities: []
				},
				expectedForeignEvidenceSha256: hostedFacts().foreignEvidenceSha256
			})
		).rejects.toThrow('independent_zero_scope_invalid');
		expect(adapterFactory).not.toHaveBeenCalled();
	});

	it('validates the exact manifest before creating an independent adapter', async () => {
		const adapterFactory = vi.fn();
		const manifest = createHostedRunManifest(
			{ target: { projectRef: GATE3_PROJECT_REF }, runId } as never,
			{ provisioningAttemptId }
		);

		await expect(
			verifyIndependentHostedZero({
				adapterFactory,
				scope: {
					runId,
					createdAfter: '2026-08-20T10:00:00.000Z',
					manifest: {
						...manifest,
						actors: [
							{
								role: 'reporter',
								userId: 'forged-user-id',
								createdAt: actorCreatedAt,
								provisioningAttemptId
							}
						]
					},
					expectedIdentities: expectedIdentities()
				},
				expectedForeignEvidenceSha256: hostedFacts().foreignEvidenceSha256
			})
		).rejects.toThrow('independent_zero_scope_invalid');
		expect(adapterFactory).not.toHaveBeenCalled();
	});

	it('uses a separately created adapter and fresh inspection facts', async () => {
		const freshInspect = vi.fn().mockResolvedValue(hostedFacts());
		const adapterFactory = vi.fn(() => Object.freeze({ inspectRun: freshInspect }));
		const manifest = createHostedRunManifest(
			{ target: { projectRef: GATE3_PROJECT_REF }, runId } as never,
			{ provisioningAttemptId }
		);

		await expect(
			verifyIndependentHostedZero({
				adapterFactory,
				scope: {
					runId,
					createdAfter: '2026-08-20T10:00:00.000Z',
					manifest,
					expectedIdentities: expectedIdentities()
				},
				expectedForeignEvidenceSha256: hostedFacts().foreignEvidenceSha256
			})
		).resolves.toMatchObject({ independentZeroVerified: true });
		expect(adapterFactory).toHaveBeenCalledOnce();
		expect(freshInspect).toHaveBeenCalledOnce();
	});

	it('fails independent zero when exact artifacts remain or foreign evidence changed', async () => {
		const scope = {
			runId,
			createdAfter: '2026-08-20T10:00:00.000Z',
			manifest: createHostedRunManifest(
				{ target: { projectRef: GATE3_PROJECT_REF }, runId } as never,
				{ provisioningAttemptId }
			),
			expectedIdentities: expectedIdentities()
		};
		for (const facts of [
			hostedFacts({ counts: { ...emptyCounts, queueRows: 1 } }),
			hostedFacts({ foreignEvidenceSha256: 'b'.repeat(64) })
		]) {
			await expect(
				verifyIndependentHostedZero({
					adapterFactory: () => ({ inspectRun: vi.fn().mockResolvedValue(facts) }),
					scope,
					expectedForeignEvidenceSha256: hostedFacts().foreignEvidenceSha256
				})
			).resolves.toMatchObject({ independentZeroVerified: false });
		}
	});

	it('fails independent zero on changed-path and owner-prefixed orphan queue survivors', async () => {
		let manifest = createHostedRunManifest(
			{ target: { projectRef: GATE3_PROJECT_REF }, runId } as never,
			{ provisioningAttemptId }
		);
		manifest = registerHostedActor(manifest, 'reporter', actorId, actorCreatedAt);
		const uploadId = '77777777-7777-4777-8777-777777777777';
		const objectPath = `${actorId}/${uploadId}.webp`;
		manifest = registerHostedUpload(manifest, uploadId, 'reporter', objectPath);
		const manifestWithQueue = {
			...manifest,
			queueRows: [{ id: 51, uploadId }]
		};
		for (const [candidateManifest, row] of [
			[
				manifestWithQueue,
				{
					id: 51,
					storage_path: `${actorId}/changed.webp`,
					report_evidence_upload_id: uploadId,
					upload_id: null
				}
			],
			[
				manifest,
				{
					id: 99,
					storage_path: `${actorId}/orphan.webp`,
					report_evidence_upload_id: null,
					upload_id: null
				}
			]
		] as const) {
			await expect(
				verifyIndependentHostedZero({
					adapterFactory: () =>
						createSupabaseHostedInspectionAdapter({
							projectRef: GATE3_PROJECT_REF,
							serviceClient: realInspectionClient({
								rows: { upload_cleanup_queue: [{ ...row }] }
							}) as never
						}),
					scope: {
						runId,
						createdAfter: '2026-08-20T10:00:00.000Z',
						manifest: candidateManifest,
						expectedIdentities: expectedIdentities()
					},
					expectedForeignEvidenceSha256: hostedFacts().foreignEvidenceSha256
				})
			).resolves.toMatchObject({
				independentZeroVerified: false,
				counts: { queueRows: 1 }
			});
		}
	});

	it('rejects a mutation-capable independently created adapter', async () => {
		const inspectRun = vi.fn().mockResolvedValue(hostedFacts());

		await expect(
			verifyIndependentHostedZero({
				adapterFactory: () => ({ inspectRun, removeManifest: vi.fn() }) as never,
				scope: {
					runId,
					createdAfter: '2026-08-20T10:00:00.000Z',
					manifest: createHostedRunManifest(
						{ target: { projectRef: GATE3_PROJECT_REF }, runId } as never,
						{ provisioningAttemptId }
					),
					expectedIdentities: expectedIdentities()
				},
				expectedForeignEvidenceSha256: hostedFacts().foreignEvidenceSha256
			})
		).rejects.toThrow('inspection_adapter_not_read_only');
		expect(inspectRun).not.toHaveBeenCalled();
	});

	it('sanitizes independent provider failures', async () => {
		const providerBody = 'provider-token-never-echo';
		let caught: unknown;
		try {
			await verifyIndependentHostedZero({
				adapterFactory: () => ({
					inspectRun: vi.fn().mockRejectedValue(new Error(providerBody))
				}),
				scope: {
					runId,
					createdAfter: '2026-08-20T10:00:00.000Z',
					manifest: createHostedRunManifest(
						{ target: { projectRef: GATE3_PROJECT_REF }, runId } as never,
						{ provisioningAttemptId }
					),
					expectedIdentities: expectedIdentities()
				},
				expectedForeignEvidenceSha256: hostedFacts().foreignEvidenceSha256
			});
		} catch (error) {
			caught = error;
		}

		expect(String(caught)).toContain('independent_zero_unavailable');
		expect(String(caught)).not.toContain(providerBody);
	});

	it('rejects cached canonical inspection data from the independent scope', async () => {
		const adapterFactory = vi.fn(() => ({ inspectRun: vi.fn().mockResolvedValue(hostedFacts()) }));

		await expect(
			verifyIndependentHostedZero({
				adapterFactory,
				scope: {
					runId,
					createdAfter: '2026-08-20T10:00:00.000Z',
					manifest: createHostedRunManifest(
						{ target: { projectRef: GATE3_PROJECT_REF }, runId } as never,
						{ provisioningAttemptId }
					),
					expectedIdentities: expectedIdentities(),
					lastInspection: hostedFacts()
				},
				expectedForeignEvidenceSha256: hostedFacts().foreignEvidenceSha256
			})
		).rejects.toThrow('independent_zero_scope_invalid');
		expect(adapterFactory).not.toHaveBeenCalled();
	});
});
