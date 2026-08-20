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
	createHostedRunManifest,
	persistHostedRunManifest,
	registerHostedActor,
	registerHostedActorIntent
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
		hostedActorsManifestStale: 0,
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
	manifest?: 'empty' | 'pending' | 'actor';
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
	if (options.manifest === 'actor') {
		manifest = registerHostedActor(manifest, 'reporter', actorId, actorCreatedAt);
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
		['mismatched metadata', { metadataMismatches: 1 }]
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
