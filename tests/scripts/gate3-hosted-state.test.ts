import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicPrivateWrite } from '../../scripts/hosted-private-file.mjs';
import {
	acquireRunLock,
	clearActiveRun,
	createInitialRunState,
	finalizeRunArchive,
	inspectRunLock,
	readActiveRun,
	readArchivedRunState,
	readRunState,
	recoverStaleRunLock,
	releaseRunLock,
	reserveRunState,
	resolveGate3RunPaths,
	setActiveRun,
	writeNextRunState
} from '../../scripts/gate3-hosted-state.mjs';

const root = 'C:\\gate3-hosted-fixtures';

describe('Gate 3 hosted state', () => {
	const fixtureRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(fixtureRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
	});

	async function createFixture() {
		const fixtureRoot = await mkdtemp(join(tmpdir(), 'gate3-hosted-state-'));
		fixtureRoots.push(fixtureRoot);
		const paths = resolveGate3RunPaths({ root: fixtureRoot, runId: 'gate3-20260820-abcdef12' });
		return {
			paths,
			state: createInitialRunState({
				runId: paths.runId,
				createdAt: '2026-08-20T10:00:00.000Z',
				releaseCommitSha: 'a'.repeat(40),
				manifestPath: paths.manifestPath,
				secretPath: paths.secretPath
			})
		};
	}

	it('maps an exact run into the established Aromatika hosted-fixture root', () => {
		expect(resolveGate3RunPaths({ root, runId: 'gate3-20260820-abcdef12' })).toEqual({
			root,
			activeRoot: join(root, 'active'),
			archiveRoot: join(root, 'archive'),
			runId: 'gate3-20260820-abcdef12',
			runDirectory: join(root, 'active', 'gate3-20260820-abcdef12'),
			archiveDirectory: join(root, 'archive', 'gate3-20260820-abcdef12'),
			statePath: join(root, 'active', 'gate3-20260820-abcdef12', 'gate3-run-state.json'),
			secretPath: join(root, 'active', 'gate3-20260820-abcdef12', 'gate3-secrets.dpapi'),
			manifestPath: join(root, 'active', 'gate3-20260820-abcdef12', 'gate3-run-manifest.json'),
			lockPath: join(root, 'active', 'gate3-20260820-abcdef12', '.gate3.lock'),
			activePointerPath: join(root, 'active-run.json')
		});
	});

	it.each(['gate3-x', '../gate3-escape', 'GATE3-20260820-abcdef12'])(
		'rejects unsafe run id %s',
		(runId) => expect(() => resolveGate3RunPaths({ root, runId })).toThrow('run_id_invalid')
	);

	it('reserves the initial state exclusively and reads back its exact schema', async () => {
		const { paths, state } = await createFixture();

		await reserveRunState(paths, state);
		await expect(readRunState(paths)).resolves.toEqual(state);
		await expect(reserveRunState(paths, state)).rejects.toMatchObject({ reasonCode: 'state_already_exists' });
	});

	it('requires one monotonic revision and preserves immutable bindings', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		const nextState = { ...state, revision: 1, phases: { ...state.phases, preflight: { status: 'complete', checkpoint: { observedAt: '2026-08-20T10:01:00.000Z' } } } };

		await writeNextRunState(paths, state, nextState);
		await expect(readRunState(paths)).resolves.toEqual(nextState);
		await expect(
			writeNextRunState(paths, state, {
				...state,
				revision: 1,
				phases: { ...state.phases, scenario: { status: 'complete', checkpoint: { observedAt: '2026-08-20T10:02:00.000Z' } } }
			})
		).rejects.toMatchObject({ reasonCode: 'state_changed' });
		await expect(writeNextRunState(paths, nextState, { ...nextState, revision: 3 })).rejects.toMatchObject({ reasonCode: 'revision_invalid' });
		await expect(writeNextRunState(paths, nextState, { ...nextState, revision: 2, runId: 'gate3-20260820-deadbeef' })).rejects.toMatchObject({ reasonCode: 'immutable_binding_changed' });
		await expect(writeNextRunState(paths, nextState, { ...nextState, revision: 2, target: { ...nextState.target, releaseCommitSha: 'b'.repeat(40) } })).rejects.toMatchObject({ reasonCode: 'immutable_binding_changed' });
		await expect(writeNextRunState(paths, nextState, { ...nextState, revision: 2, manifest: { ...nextState.manifest, path: join(paths.runDirectory, 'other.json') } })).rejects.toMatchObject({ reasonCode: 'immutable_binding_changed' });
		await expect(writeNextRunState(paths, nextState, { ...nextState, revision: 2, secretStore: { ...nextState.secretStore, path: join(paths.runDirectory, 'other.dpapi') } })).rejects.toMatchObject({ reasonCode: 'immutable_binding_changed' });
		const metadataNextState = {
			...nextState,
			revision: 2,
			manifest: { ...nextState.manifest, sha256: 'c'.repeat(64) },
			secretStore: {
				...nextState.secretStore,
				status: 'persisted',
				ciphertextSha256: 'd'.repeat(64)
			}
		};
		await writeNextRunState(paths, nextState, metadataNextState);
		await expect(readRunState(paths)).resolves.toEqual(metadataNextState);
	});

	it('fails closed for corrupt, invalid, and secret-shaped persisted state', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		await writeFile(paths.statePath, '{not-json');
		await expect(readRunState(paths)).rejects.toMatchObject({ reasonCode: 'state_invalid' });
		await writeFile(paths.statePath, JSON.stringify({ ...state, schemaVersion: 2 }));
		await expect(readRunState(paths)).rejects.toMatchObject({ reasonCode: 'state_invalid' });
		await writeFile(paths.statePath, JSON.stringify({ ...state, revision: -1 }));
		await expect(readRunState(paths)).rejects.toMatchObject({ reasonCode: 'state_invalid' });
		await writeFile(paths.statePath, JSON.stringify({ ...state, revision: 0.5 }));
		await expect(readRunState(paths)).rejects.toMatchObject({ reasonCode: 'state_invalid' });
		await writeFile(paths.statePath, JSON.stringify({ ...state, unrecognized: true }));
		await expect(readRunState(paths)).rejects.toMatchObject({ reasonCode: 'state_invalid' });
		await writeFile(paths.statePath, JSON.stringify({ ...state, lastInspection: { apiToken: 'x' } }));
		await expect(readRunState(paths)).rejects.toMatchObject({ reasonCode: 'state_invalid' });
		await expect(readRunState({ ...paths, statePath: join(paths.root, 'escaped-state.json') })).rejects.toMatchObject({
			reasonCode: 'state_path_invalid'
		});
	});

	it.each(['actorEmail', 'totpSeed', 'accessJwt', 'providerBody'])(
		'rejects unsafe cached inspection key %s',
		async (unsafeKey) => {
			const { paths, state } = await createFixture();
			await reserveRunState(paths, state);
			await writeFile(paths.statePath, JSON.stringify({ ...state, lastInspection: { [unsafeKey]: 'x' } }));

			await expect(readRunState(paths)).rejects.toMatchObject({ reasonCode: 'state_invalid' });
		}
	);

	it('rejects nested cached inspection objects under an otherwise allowed key', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		await writeFile(paths.statePath, JSON.stringify({ ...state, lastInspection: { status: { status: 'x' } } }));

		await expect(readRunState(paths)).rejects.toMatchObject({ reasonCode: 'state_invalid' });
	});

	it('validates a simulated reparse root before a pointer lock can be opened or unlinked', async () => {
		const root = 'C:\\gate3-reparse-fixture';
		const calls: string[] = [];
		const filesystem = {
			lstat: async () => {
				calls.push('lstat');
				return { isDirectory: () => true, isSymbolicLink: () => false };
			},
			realpath: async () => {
				calls.push('realpath');
				return 'C:\\outside-reparse-fixture';
			},
			mkdir: async () => {
				calls.push('mkdir');
			},
			open: async () => {
				calls.push('open');
				throw new Error('must not open');
			},
			readFile: async () => {
				calls.push('readFile');
				return '';
			},
			unlink: async () => {
				calls.push('unlink');
			}
		} as never;

		await expect(
			clearActiveRun({ root, runId: 'gate3-20260820-abcdef12', filesystem })
		).rejects.toMatchObject({ reasonCode: 'state_path_invalid' });
		expect(calls).toEqual(['lstat', 'realpath']);
	});

	it('rejects a simulated active-root reparse target before creating a run directory', async () => {
		const paths = resolveGate3RunPaths({ root: 'C:\\gate3-active-reparse-fixture', runId: 'gate3-20260820-abcdef12' });
		const state = createInitialRunState({
			runId: paths.runId,
			createdAt: '2026-08-20T10:00:00.000Z',
			releaseCommitSha: 'a'.repeat(40),
			manifestPath: paths.manifestPath,
			secretPath: paths.secretPath
		});
		const calls: string[] = [];
		const filesystem = {
			lstat: async (path: string) => {
				calls.push(`lstat:${path}`);
				return { isDirectory: () => true, isSymbolicLink: () => false };
			},
			realpath: async (path: string) => {
				calls.push(`realpath:${path}`);
				return path === paths.activeRoot ? 'C:\\outside-active-reparse-fixture' : path;
			},
			mkdir: async () => {
				calls.push('mkdir');
			},
			open: async () => {
				calls.push('open');
				throw new Error('must not open');
			},
			readFile: async () => '',
			unlink: async () => {
				calls.push('unlink');
			}
		} as never;

		await expect(reserveRunState(paths, state, { filesystem })).rejects.toMatchObject({
			reasonCode: 'state_path_invalid'
		});
			expect(calls).toEqual([
			`lstat:${paths.root}`,
			`realpath:${paths.root}`,
			`lstat:${paths.activeRoot}`,
			`lstat:${paths.activeRoot}`,
			`realpath:${paths.activeRoot}`
		]);
	});

	it('does not follow a Windows active-directory junction before rejecting it', async ({ skip }) => {
		const { paths, state } = await createFixture();
		const outside = await mkdtemp(join(tmpdir(), 'gate3-hosted-junction-target-'));
		fixtureRoots.push(outside);
		const result = spawnSync(
			'cmd.exe',
			['/d', '/c', `mklink /J "${paths.activeRoot}" "${outside}"`],
			{ encoding: 'utf8' }
		);

		if (result.status !== 0) {
			skip(`Windows junction fixture unavailable: ${result.status}`);
			return;
		}
		await expect(reserveRunState(paths, state)).rejects.toMatchObject({ reasonCode: 'state_path_invalid' });
		await expect(readFile(join(outside, paths.runId, 'gate3-run-state.json'), 'utf8')).rejects.toMatchObject({
			code: 'ENOENT'
		});
	});

	it('reads a renamed replacement back byte-for-byte before accepting it', async () => {
		const fixtureRoot = await mkdtemp(join(tmpdir(), 'gate3-private-write-'));
		fixtureRoots.push(fixtureRoot);
		const filePath = join(fixtureRoot, 'state.json');
		const contents = '{"revision":1}\n';
		let verifiedBytes: string | undefined;

		await atomicPrivateWrite(filePath, contents, {
			verify: (replacementBytes) => {
				verifiedBytes = replacementBytes;
				expect(replacementBytes).toBe(contents);
			}
		});

		expect(verifiedBytes).toBe(contents);
		await expect(readFile(filePath, 'utf8')).resolves.toBe(contents);
	});

	it('compares the active pointer and never infers a run from directory timestamps or order', async () => {
		const { paths } = await createFixture();
		const anotherRun = resolveGate3RunPaths({ root: paths.root, runId: 'gate3-20260820-fedcba98' });
		await Promise.all([mkdir(paths.runDirectory, { recursive: true }), mkdir(anotherRun.runDirectory, { recursive: true })]);
		await Promise.all([
			writeFile(join(paths.root, 'active', paths.runId, 'unrelated.txt'), 'first', { flag: 'w' }),
			writeFile(join(paths.root, 'active', anotherRun.runId, 'unrelated.txt'), 'second', { flag: 'w' })
		].map(async (operation) => operation));

		await expect(readActiveRun(paths.root)).resolves.toBeNull();
		await setActiveRun({ root: paths.root, runId: anotherRun.runId, expectedCurrentRunId: null });
		await expect(readActiveRun(paths.root)).resolves.toBe(anotherRun.runId);
		await expect(setActiveRun({ root: paths.root, runId: paths.runId, expectedCurrentRunId: paths.runId })).rejects.toMatchObject({ reasonCode: 'active_run_changed' });
	});

	it('serializes concurrent active-pointer compare-and-swap operations', async () => {
		const { paths } = await createFixture();
		const runs = Array.from({ length: 12 }, (_, index) =>
			resolveGate3RunPaths({
				root: paths.root,
				runId: `gate3-20260820-${index.toString(16).padStart(8, '0')}`
			})
		);
		await Promise.all([
			mkdir(paths.runDirectory, { recursive: true }),
			...runs.map((run) => mkdir(run.runDirectory, { recursive: true }))
		]);
		await setActiveRun({ root: paths.root, runId: paths.runId, expectedCurrentRunId: null });

		const outcomes = await Promise.allSettled(
			runs.map((run) =>
				setActiveRun({ root: paths.root, runId: run.runId, expectedCurrentRunId: paths.runId })
			)
		);

		expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
		expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(11);
		expect(runs.map((run) => run.runId)).toContain(await readActiveRun(paths.root));
	});

	it('does not clear a pointer installed by a concurrent compare-and-swap', async () => {
		const { paths } = await createFixture();
		const anotherRun = resolveGate3RunPaths({ root: paths.root, runId: 'gate3-20260820-fedcba98' });
		await Promise.all([mkdir(paths.runDirectory, { recursive: true }), mkdir(anotherRun.runDirectory, { recursive: true })]);
		await setActiveRun({ root: paths.root, runId: paths.runId, expectedCurrentRunId: null });

		const outcomes = await Promise.allSettled([
			clearActiveRun({ root: paths.root, runId: paths.runId }),
			setActiveRun({ root: paths.root, runId: anotherRun.runId, expectedCurrentRunId: paths.runId })
		]);

		expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
		expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
		expect([null, anotherRun.runId]).toContain(await readActiveRun(paths.root));
	});

	it('does not treat elapsed time as stale while the recorded pid exists', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		await writeFile(paths.lockPath, JSON.stringify({
			runId: paths.runId,
			command: 'scenario',
			pid: 77,
			startedAt: '2026-08-19T00:00:00.000Z'
		}));

		await expect(inspectRunLock({ paths, isPidRunning: (pid) => pid === 77 }))
			.resolves.toMatchObject({ status: 'held' });
	});

	it('requires a fresh read-only inspection before removing a dead-pid lock', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		await writeFile(paths.lockPath, JSON.stringify({
			runId: paths.runId,
			command: 'scenario',
			pid: 77,
			startedAt: '2026-08-19T00:00:00.000Z'
		}));

		const observed = await inspectRunLock({ paths, isPidRunning: () => false });
		await expect(recoverStaleRunLock({ paths, observedLock: observed, inspection: null }))
			.rejects.toThrow('fresh_inspection_required');
	});

	it('releases only the exact lock bytes acquired by its owner', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		const acquired = await acquireRunLock({ paths, command: 'scenario', pid: 77, startedAt: '2026-08-20T10:00:00.000Z' });
		await writeFile(paths.lockPath, JSON.stringify({ runId: paths.runId, command: 'scenario', pid: 78, startedAt: '2026-08-20T10:01:00.000Z' }));

		await expect(releaseRunLock({ paths, acquiredLock: acquired })).resolves.toBe(false);
		await expect(readFile(paths.lockPath, 'utf8')).resolves.toContain('"pid":78');
	});

	it('rejects unsupported per-run lock commands', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		await expect(acquireRunLock({ paths, command: 'deploy', pid: 77, startedAt: '2026-08-20T10:00:00.000Z' }))
			.rejects.toMatchObject({ reasonCode: 'lock_command_invalid' });
	});

	it('requires independently verified cleanup before archive finalization', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		const cleanupOnly = {
			...state,
			revision: 1,
			phases: { ...state.phases, cleanup: { status: 'complete', checkpoint: null } },
			lastInspection: { cleanupVerified: true, independentZeroVerified: false }
		};
		await writeNextRunState(paths, state, cleanupOnly);

		await expect(finalizeRunArchive({ paths, currentState: cleanupOnly, completedAt: '2026-08-20T11:00:00.000Z' }))
			.rejects.toMatchObject({ reasonCode: 'cleanup_not_independently_verified' });
	});

	it('never archives a live DPAPI secret file', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		await writeFile(paths.secretPath, 'ciphertext');
		const verified = {
			...state,
			revision: 1,
			phases: { ...state.phases, cleanup: { status: 'complete', checkpoint: null } },
			lastInspection: { cleanupVerified: true, independentZeroVerified: true }
		};
		await writeNextRunState(paths, state, verified);

		await expect(finalizeRunArchive({ paths, currentState: verified, completedAt: '2026-08-20T11:00:00.000Z' }))
			.rejects.toMatchObject({ reasonCode: 'secret_file_present' });
		await expect(readFile(paths.secretPath, 'utf8')).resolves.toBe('ciphertext');
		await expect(readFile(join(paths.archiveDirectory, 'gate3-secrets.dpapi'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('fails closed when the archive destination already exists', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		await mkdir(paths.archiveDirectory, { recursive: true });
		const verified = {
			...state,
			revision: 1,
			phases: { ...state.phases, cleanup: { status: 'complete', checkpoint: null } },
			lastInspection: { cleanupVerified: true, independentZeroVerified: true }
		};
		await writeNextRunState(paths, state, verified);

		await expect(finalizeRunArchive({ paths, currentState: verified, completedAt: '2026-08-20T11:00:00.000Z' }))
			.rejects.toMatchObject({ reasonCode: 'archive_destination_exists' });
	});

	it('resumes archive finalization after a crash following the pending state write', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		const verified = {
			...state,
			revision: 1,
			phases: { ...state.phases, cleanup: { status: 'complete', checkpoint: null } },
			lastInspection: { cleanupVerified: true, independentZeroVerified: true }
		};
		await writeNextRunState(paths, state, verified);
		const filesystem = {
			rename: async () => { throw new Error('simulated crash'); }
		};

		await expect(finalizeRunArchive({ paths, currentState: verified, completedAt: '2026-08-20T11:00:00.000Z', filesystem: filesystem as never }))
			.rejects.toMatchObject({ reasonCode: 'archive_rename_failed' });
		const pending = await readRunState(paths);
		expect(pending.archive).toMatchObject({ status: 'pending', destination: paths.archiveDirectory });

		await finalizeRunArchive({ paths, currentState: pending, completedAt: '2026-08-20T11:01:00.000Z' });
		await expect(readArchivedRunState(paths)).resolves.toMatchObject({ archive: { status: 'complete' } });
	});

	it('resumes archive finalization after a crash following the directory rename', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		const verified = {
			...state,
			revision: 1,
			phases: { ...state.phases, cleanup: { status: 'complete', checkpoint: null } },
			lastInspection: { cleanupVerified: true, independentZeroVerified: true }
		};
		await writeNextRunState(paths, state, verified);
		const filesystem = {
			rename: async (from: string, to: string) => {
				const { rename } = await import('node:fs/promises');
				await rename(from, to);
				throw new Error('simulated crash');
			}
		};

		await expect(finalizeRunArchive({ paths, currentState: verified, completedAt: '2026-08-20T11:00:00.000Z', filesystem: filesystem as never }))
			.rejects.toMatchObject({ reasonCode: 'archive_rename_failed' });
		await expect(readArchivedRunState(paths)).resolves.toMatchObject({ archive: { status: 'pending' } });

		await finalizeRunArchive({ paths, currentState: verified, completedAt: '2026-08-20T11:01:00.000Z' });
		const complete = await readArchivedRunState(paths);
		expect(complete.archive).toMatchObject({ status: 'complete', completedAt: '2026-08-20T11:01:00.000Z' });
		await expect(writeNextRunState(paths, complete, { ...complete, revision: complete.revision + 1 })).rejects.toMatchObject({ reasonCode: 'archive_terminal' });
	});

	it('preserves another run active pointer while finalizing this run archive', async () => {
		const { paths, state } = await createFixture();
		const anotherRun = resolveGate3RunPaths({ root: paths.root, runId: 'gate3-20260820-fedcba98' });
		await reserveRunState(paths, state);
		await mkdir(anotherRun.runDirectory, { recursive: true });
		await setActiveRun({ root: paths.root, runId: anotherRun.runId, expectedCurrentRunId: null });
		const verified = {
			...state,
			revision: 1,
			phases: { ...state.phases, cleanup: { status: 'complete', checkpoint: null } },
			lastInspection: { cleanupVerified: true, independentZeroVerified: true }
		};
		await writeNextRunState(paths, state, verified);

		await finalizeRunArchive({ paths, currentState: verified, completedAt: '2026-08-20T11:00:00.000Z' });
		await expect(readActiveRun(paths.root)).resolves.toBe(anotherRun.runId);
	});

	it('removes a stale lock after a separately refreshed inspection', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		await writeFile(paths.lockPath, JSON.stringify({ runId: paths.runId, command: 'scenario', pid: 77, startedAt: '2026-08-19T00:00:00.000Z' }));
		const observed = await inspectRunLock({ paths, isPidRunning: () => false });
		const inspection = await inspectRunLock({ paths, isPidRunning: () => false });

		await expect(recoverStaleRunLock({ paths, observedLock: observed, inspection, isPidRunning: () => false })).resolves.toBe(true);
		await expect(inspectRunLock({ paths })).resolves.toMatchObject({ status: 'missing' });
	});

	it('treats access-denied PID probes as a live lock holder', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		await writeFile(paths.lockPath, JSON.stringify({ runId: paths.runId, command: 'scenario', pid: 77, startedAt: '2026-08-19T00:00:00.000Z' }));

		await expect(inspectRunLock({ paths, isPidRunning: () => true })).resolves.toMatchObject({ status: 'held' });
	});

	it('rejects an archived state whose destination is not this run canonical archive path', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		const verified = { ...state, revision: 1, phases: { ...state.phases, cleanup: { status: 'complete', checkpoint: null } }, lastInspection: { cleanupVerified: true, independentZeroVerified: true } };
		await writeNextRunState(paths, state, verified);
		await finalizeRunArchive({ paths, currentState: verified, completedAt: '2026-08-20T11:00:00.000Z' });
		const archived = await readArchivedRunState(paths);
		await writeFile(join(paths.archiveDirectory, 'gate3-run-state.json'), JSON.stringify({ ...archived, archive: { ...archived.archive, destination: join(paths.root, 'archive', 'other-run') } }));

		await expect(readArchivedRunState(paths)).rejects.toMatchObject({ reasonCode: 'state_invalid' });
	});

	it('completed archive retries reject secrets and clear a surviving self pointer', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		const verified = { ...state, revision: 1, phases: { ...state.phases, cleanup: { status: 'complete', checkpoint: null } }, lastInspection: { cleanupVerified: true, independentZeroVerified: true } };
		await writeNextRunState(paths, state, verified);
		await finalizeRunArchive({ paths, currentState: verified, completedAt: '2026-08-20T11:00:00.000Z' });
		await writeFile(paths.activePointerPath, JSON.stringify({ schemaVersion: 1, runId: paths.runId }));
		await writeFile(join(paths.archiveDirectory, 'gate3-secrets.dpapi'), 'ciphertext');

		await expect(finalizeRunArchive({ paths, currentState: verified, completedAt: '2026-08-20T11:01:00.000Z' })).rejects.toMatchObject({ reasonCode: 'secret_file_present' });
		await rm(join(paths.archiveDirectory, 'gate3-secrets.dpapi'));
		await finalizeRunArchive({ paths, currentState: verified, completedAt: '2026-08-20T11:01:00.000Z' });
		await expect(readActiveRun(paths.root)).resolves.toBeNull();
	});

	it('keeps generated CodeGraph and ATL directories out of version control', () => {
		for (const localToolDirectory of ['.codegraph/', '.atl/']) {
			const result = spawnSync('git', ['check-ignore', '-q', localToolDirectory], {
				cwd: process.cwd(),
				encoding: 'utf8'
			});
			expect(result.status).toBe(0);
		}
	});
});
