import {
	lstat,
	mkdir,
	mkdtemp,
	open,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	utimes,
	writeFile
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
	reserveGate3RunDirectory,
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

	function deferred() {
		let resolve!: () => void;
		const promise = new Promise<void>((resolvePromise) => {
			resolve = resolvePromise;
		});
		return { promise, resolve };
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

	it('reserves only the exact validated run directory with exclusive creation', async () => {
		const { paths } = await createFixture();

		await reserveGate3RunDirectory(paths);
		expect((await lstat(paths.runDirectory)).isDirectory()).toBe(true);
		expect(await readdir(paths.runDirectory)).toEqual([]);
		await expect(reserveGate3RunDirectory(paths)).rejects.toMatchObject({
			reasonCode: 'state_already_exists'
		});
	});

	it('rejects an active-root reparse before an exclusive run-directory reservation', async () => {
		const paths = resolveGate3RunPaths({
			root: 'C:\\gate3-run-directory-reparse-fixture',
			runId: 'gate3-20260820-abcdef12'
		});
		const calls: string[] = [];
		const filesystem = {
			lstat: async (path: string) => {
				calls.push(`lstat:${path}`);
				return { isDirectory: () => true, isSymbolicLink: () => false };
			},
			realpath: async (path: string) => {
				calls.push(`realpath:${path}`);
				return path === paths.activeRoot ? 'C:\\outside-active-root' : path;
			},
			mkdir: async (path: string) => {
				calls.push(`mkdir:${path}`);
			}
		} as never;

		await expect(reserveGate3RunDirectory(paths, { filesystem })).rejects.toMatchObject({
			reasonCode: 'state_path_invalid'
		});
		expect(calls).not.toContain(`mkdir:${paths.runDirectory}`);
	});

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

	it('treats EPERM from the production process.kill PID probe as a live lock holder', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		await writeFile(paths.lockPath, JSON.stringify({ runId: paths.runId, command: 'scenario', pid: 77, startedAt: '2026-08-19T00:00:00.000Z' }));
		const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
			throw Object.assign(new Error('access denied'), { code: 'EPERM' });
		});

		try {
			await expect(inspectRunLock({ paths })).resolves.toMatchObject({ status: 'held' });
		} finally {
			killSpy.mockRestore();
		}
	});

	it('never age-reaps malformed, unreadable, or ownerless management guards', async () => {
		for (const ownerKind of ['malformed', 'unreadable', 'missing'] as const) {
			const { paths } = await createFixture();
			await mkdir(paths.runDirectory, { recursive: true });
			const guardPath = `${paths.lockPath}.guard`;
			const ownerPath = join(guardPath, 'owner.json');
			await mkdir(guardPath);
			if (ownerKind === 'malformed') await writeFile(ownerPath, '{not-json');
			if (ownerKind === 'unreadable') await mkdir(ownerPath);
			await utimes(guardPath, new Date(0), new Date(0));

			await expect(acquireRunLock({ paths, command: 'scenario' })).rejects.toMatchObject({
				reasonCode: ownerKind === 'missing' ? 'lock_guard_held' : 'lock_guard_invalid'
			});
			await expect(lstat(guardPath)).resolves.toMatchObject({});
		}
	});

	it('does not let an injected main-lock PID probe reap a live management guard', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		const guardPath = `${paths.lockPath}.guard`;
		const ownerPath = join(guardPath, 'owner.json');
		const owner = { version: 1, guardId: '00000000-0000-4000-8000-000000000001', pid: process.pid };
		await mkdir(guardPath);
		await writeFile(ownerPath, JSON.stringify(owner));
		const lockBytes = JSON.stringify({ runId: paths.runId, command: 'scenario', pid: 77, startedAt: '2026-08-19T00:00:00.000Z' });
		await writeFile(paths.lockPath, lockBytes);
		const observed = await inspectRunLock({ paths, isPidRunning: () => false });
		const inspection = await inspectRunLock({ paths, isPidRunning: () => false });

		await expect(recoverStaleRunLock({ paths, observedLock: observed, inspection, isPidRunning: () => false }))
			.rejects.toMatchObject({ reasonCode: 'lock_guard_held' });
		await expect(readFile(ownerPath, 'utf8')).resolves.toBe(JSON.stringify(owner));
		await expect(readFile(paths.lockPath, 'utf8')).resolves.toBe(lockBytes);
	});

	it('keeps a persistent stale-owner tombstone while two reapers serialize a successor lock', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		const guardPath = `${paths.lockPath}.guard`;
		const staleOwner = { version: 1, guardId: '00000000-0000-4000-8000-000000000002', pid: 2147483647 };
		await mkdir(guardPath);
		await writeFile(join(guardPath, 'owner.json'), JSON.stringify(staleOwner));

		const outcomes = await Promise.allSettled([
			acquireRunLock({ paths, command: 'scenario', pid: 77, startedAt: '2026-08-20T10:00:00.000Z' }),
			acquireRunLock({ paths, command: 'cleanup', pid: 78, startedAt: '2026-08-20T10:01:00.000Z' })
		]);

		const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
		const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]).toMatchObject({ reason: { reasonCode: 'lock_held' } });
		if (fulfilled[0]?.status !== 'fulfilled') throw new Error('missing successor lock');
		await expect(readFile(paths.lockPath, 'utf8')).resolves.toBe(fulfilled[0].value.acquiredBytes);
		await expect(readFile(`${guardPath}.retired-${staleOwner.guardId}/owner.json`, 'utf8'))
			.resolves.toBe(JSON.stringify(staleOwner));
		const tombstones = (await readdir(paths.runDirectory)).filter((entry) => entry.startsWith('.gate3.lock.guard.retired-'));
		expect(tombstones).toContain(`.gate3.lock.guard.retired-${staleOwner.guardId}`);
	});

	it('does not let a delayed stale observer move or delete a successor after normal guard release', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		const guardPath = `${paths.lockPath}.guard`;
		const ownerPath = join(guardPath, 'owner.json');
		const ownerEntered = deferred();
		const ownerProceed = deferred();
		const delayedRetireRead = deferred();
		const delayedRetireProceed = deferred();
		const successorEntered = deferred();
		const successorProceed = deferred();
		let guardOwnerReads = 0;
		const ownerPromise = acquireRunLock({
			paths,
			command: 'scenario',
			pid: 77,
			startedAt: '2026-08-20T10:00:00.000Z',
			filesystem: {
				open: async (...args: Parameters<typeof open>) => {
					const handle = await open(...args);
					ownerEntered.resolve();
					await ownerProceed.promise;
					return handle;
				}
			}
		} as never);
		await Promise.race([
			ownerEntered.promise,
			ownerPromise.then(() => { throw new Error('main lock filesystem injection was ignored'); })
		]);
		const originalOwnerBytes = await readFile(ownerPath, 'utf8');
		expect(JSON.parse(originalOwnerBytes)).toMatchObject({ pid: process.pid });

		const killSpy = vi.spyOn(process, 'kill');
		killSpy.mockImplementationOnce(() => {
			throw Object.assign(new Error('missing'), { code: 'ESRCH' });
		});
		killSpy.mockImplementation(() => true);
		const delayedObserver = acquireRunLock({
			paths,
			command: 'cleanup',
			pid: 78,
			startedAt: '2026-08-20T10:01:00.000Z',
			guardFilesystem: {
				lstat,
				mkdir,
				readFile: async (...args: Parameters<typeof readFile>) => {
					if (String(args[0]) === ownerPath) {
						guardOwnerReads += 1;
						if (guardOwnerReads === 2) {
							delayedRetireRead.resolve();
							await delayedRetireProceed.promise;
						}
					}
					return readFile(...args);
				},
				rename,
				rm,
				writeFile
			}
		} as never);

		let successorPromise: ReturnType<typeof acquireRunLock> | undefined;
		try {
			await delayedRetireRead.promise;
			ownerProceed.resolve();
			const originalLock = await ownerPromise;
			await releaseRunLock({ paths, acquiredLock: originalLock });

			successorPromise = acquireRunLock({
				paths,
				command: 'scenario',
				pid: 79,
				startedAt: '2026-08-20T10:02:00.000Z',
				filesystem: {
					open: async (...args: Parameters<typeof open>) => {
						const handle = await open(...args);
						successorEntered.resolve();
						await successorProceed.promise;
						return handle;
					}
				}
			} as never);
			await successorEntered.promise;
			const successorOwnerBytes = await readFile(ownerPath, 'utf8');
			delayedRetireProceed.resolve();

			await expect(delayedObserver).rejects.toMatchObject({ reasonCode: 'lock_guard_held' });
			await expect(readFile(ownerPath, 'utf8')).resolves.toBe(successorOwnerBytes);
			successorProceed.resolve();
			const successorLock = await successorPromise;
			await releaseRunLock({ paths, acquiredLock: successorLock });
		} finally {
			ownerProceed.resolve();
			delayedRetireProceed.resolve();
			successorProceed.resolve();
			killSpy.mockRestore();
			await Promise.allSettled([ownerPromise, delayedObserver, ...(successorPromise ? [successorPromise] : [])]);
		}
	});

	it.each(['writeFile', 'sync'] as const)('cleans only its created main lock after post-open %s failure', async (failure) => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		const unrelatedPath = join(paths.runDirectory, 'unrelated-evidence.json');
		await writeFile(unrelatedPath, 'preserve');

		await expect(acquireRunLock({
			paths,
			command: 'scenario',
			pid: 77,
			startedAt: '2026-08-20T10:00:00.000Z',
			filesystem: {
				open: async (...args: Parameters<typeof open>) => {
					const handle = await open(...args);
					return {
						writeFile: failure === 'writeFile'
							? async () => { throw new Error('simulated write failure'); }
							: handle.writeFile.bind(handle),
						sync: failure === 'sync'
							? async () => { throw new Error('simulated sync failure'); }
							: handle.sync.bind(handle),
						close: handle.close.bind(handle)
					};
				}
			}
		} as never)).rejects.toMatchObject({ reasonCode: 'lock_acquire_failed' });
		await expect(readFile(paths.lockPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
		await expect(readFile(unrelatedPath, 'utf8')).resolves.toBe('preserve');
	});

	it('fails closed when created main-lock cleanup fails after a sync error', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });

		await expect(acquireRunLock({
			paths,
			command: 'scenario',
			pid: 77,
			startedAt: '2026-08-20T10:00:00.000Z',
			filesystem: {
				open: async (...args: Parameters<typeof open>) => {
					const handle = await open(...args);
					return {
						writeFile: handle.writeFile.bind(handle),
						sync: async () => { throw new Error('simulated sync failure'); },
						close: handle.close.bind(handle)
					};
				},
				unlink: async () => {
					throw Object.assign(new Error('access denied'), { code: 'EACCES' });
				}
			}
		} as never)).rejects.toMatchObject({ reasonCode: 'lock_cleanup_failed' });
		await expect(readFile(paths.lockPath, 'utf8')).resolves.toContain(`"runId":"${paths.runId}"`);
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

	it('never unlinks an existing lock when exclusive acquisition reports EEXIST', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		await writeFile(paths.lockPath, JSON.stringify({ runId: paths.runId, command: 'scenario', pid: 77, startedAt: '2026-08-20T10:00:00.000Z' }));

		await expect(acquireRunLock({ paths, command: 'scenario', pid: 78, startedAt: '2026-08-20T10:01:00.000Z' })).rejects.toMatchObject({ reasonCode: 'lock_held' });
		await expect(readFile(paths.lockPath, 'utf8')).resolves.toContain('"pid":77');
	});

	it('does not remove changed main lock bytes during stale recovery', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		await writeFile(paths.lockPath, JSON.stringify({ runId: paths.runId, command: 'scenario', pid: 77, startedAt: '2026-08-20T10:00:00.000Z' }));
		const observed = await inspectRunLock({ paths, isPidRunning: () => false });
		const successorBytes = JSON.stringify({ runId: paths.runId, command: 'scenario', pid: 78, startedAt: '2026-08-20T10:01:00.000Z' });
		await writeFile(paths.lockPath, successorBytes);
		const inspection = await inspectRunLock({ paths, isPidRunning: () => false });

		await expect(recoverStaleRunLock({ paths, observedLock: observed, inspection, isPidRunning: () => false })).rejects.toMatchObject({ reasonCode: 'fresh_inspection_required' });
		await expect(readFile(paths.lockPath, 'utf8')).resolves.toBe(successorBytes);
	});

	it('rejects a simulated archive-root reparse before pending state or rename', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		await mkdir(paths.archiveRoot);
		const verified = { ...state, revision: 1, phases: { ...state.phases, cleanup: { status: 'complete', checkpoint: null } }, lastInspection: { cleanupVerified: true, independentZeroVerified: true } };
		await writeNextRunState(paths, state, verified);
		const filesystem = {
			lstat: async (path: Parameters<typeof lstat>[0]) => {
				const entry = await lstat(path);
				if (String(path) !== paths.archiveRoot) return entry;
				return { ...entry, isDirectory: () => true, isSymbolicLink: () => true };
			},
			realpath,
			rename: async () => { throw new Error('rename must not run'); }
		};

		await expect(finalizeRunArchive({ paths, currentState: verified, completedAt: '2026-08-20T11:00:00.000Z', filesystem: filesystem as never }))
			.rejects.toMatchObject({ reasonCode: 'state_path_invalid' });
		await expect(readRunState(paths)).resolves.toMatchObject({ archive: null });
	});

	it('rejects a simulated archive-destination reparse before pending state or rename', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		await mkdir(paths.archiveDirectory, { recursive: true });
		const verified = { ...state, revision: 1, phases: { ...state.phases, cleanup: { status: 'complete', checkpoint: null } }, lastInspection: { cleanupVerified: true, independentZeroVerified: true } };
		await writeNextRunState(paths, state, verified);
		const filesystem = {
			lstat: async (path: Parameters<typeof lstat>[0]) => {
				const entry = await lstat(path);
				if (String(path) !== paths.archiveDirectory) return entry;
				return { ...entry, isDirectory: () => true, isSymbolicLink: () => true };
			},
			realpath,
			rename: async () => { throw new Error('rename must not run'); }
		};

		await expect(finalizeRunArchive({ paths, currentState: verified, completedAt: '2026-08-20T11:00:00.000Z', filesystem: filesystem as never }))
			.rejects.toMatchObject({ reasonCode: 'state_path_invalid' });
		await expect(readRunState(paths)).resolves.toMatchObject({ archive: null });
	});

	it('never overwrites a destination that appears at the archive rename boundary', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		await setActiveRun({ root: paths.root, runId: paths.runId, expectedCurrentRunId: null });
		const verified = { ...state, revision: 1, phases: { ...state.phases, cleanup: { status: 'complete', checkpoint: null } }, lastInspection: { cleanupVerified: true, independentZeroVerified: true } };
		await writeNextRunState(paths, state, verified);
		const markerPath = join(paths.archiveDirectory, 'successor-owner.txt');
		const filesystem = {
			rename: async (from: string, to: string) => {
				await mkdir(to);
				await writeFile(markerPath, 'preserve successor');
				await rename(from, to);
			}
		};

		await expect(finalizeRunArchive({ paths, currentState: verified, completedAt: '2026-08-20T11:00:00.000Z', filesystem: filesystem as never }))
			.rejects.toMatchObject({ reasonCode: 'archive_rename_failed' });
		await expect(readFile(markerPath, 'utf8')).resolves.toBe('preserve successor');
		await expect(readRunState(paths)).resolves.toMatchObject({ archive: { status: 'pending' } });
		await expect(readActiveRun(paths.root)).resolves.toBe(paths.runId);
	});

	it('returns ambiguous on a cooperative pre-rename source identity swap and preserves pending recovery state', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		await setActiveRun({ root: paths.root, runId: paths.runId, expectedCurrentRunId: null });
		const verified = { ...state, revision: 1, phases: { ...state.phases, cleanup: { status: 'complete', checkpoint: null } }, lastInspection: { cleanupVerified: true, independentZeroVerified: true } };
		await writeNextRunState(paths, state, verified);
		let sourceLstatCount = 0;
		const filesystem = {
			lstat: async (path: Parameters<typeof lstat>[0], options?: { bigint?: boolean }) => {
				const entry = options?.bigint ? await lstat(path, { bigint: true }) : await lstat(path);
				if (String(path) !== paths.runDirectory) return entry;
				sourceLstatCount += 1;
				if (sourceLstatCount < 4 || typeof entry.ino !== 'bigint') return entry;
				return {
					...entry,
					ino: entry.ino + 1n,
					isDirectory: () => entry.isDirectory(),
					isSymbolicLink: () => entry.isSymbolicLink()
				};
			},
			realpath
		};

		await expect(finalizeRunArchive({ paths, currentState: verified, completedAt: '2026-08-20T11:00:00.000Z', filesystem: filesystem as never }))
			.rejects.toMatchObject({ reasonCode: 'archive_ambiguous' });
		await expect(readRunState(paths)).resolves.toMatchObject({ archive: { status: 'pending' } });
		await expect(readActiveRun(paths.root)).resolves.toBe(paths.runId);
		await expect(lstat(paths.archiveDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('fails ambiguous archive completion after a cooperative source replacement during rename', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		await setActiveRun({ root: paths.root, runId: paths.runId, expectedCurrentRunId: null });
		const verified = { ...state, revision: 1, phases: { ...state.phases, cleanup: { status: 'complete', checkpoint: null } }, lastInspection: { cleanupVerified: true, independentZeroVerified: true } };
		await writeNextRunState(paths, state, verified);
		const filesystem = { rename: async (from: string, to: string) => {
			const { rename, mkdir, writeFile } = await import('node:fs/promises');
			await rename(from, to);
			await mkdir(from);
			await writeFile(join(from, 'replacement.txt'), 'replacement');
		} };

		await expect(finalizeRunArchive({ paths, currentState: verified, completedAt: '2026-08-20T11:00:00.000Z', filesystem: filesystem as never })).rejects.toMatchObject({ reasonCode: 'archive_ambiguous' });
		await expect(readArchivedRunState(paths)).resolves.toMatchObject({ archive: { status: 'pending' } });
		await expect(readFile(join(paths.runDirectory, 'replacement.txt'), 'utf8')).resolves.toBe('replacement');
		await expect(readActiveRun(paths.root)).resolves.toBe(paths.runId);
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
