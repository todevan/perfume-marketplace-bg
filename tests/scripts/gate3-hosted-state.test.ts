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
	rmdir,
	unlink,
	utimes,
	writeFile
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { atomicPrivateWrite } from '../../scripts/hosted-private-file.mjs';
import { createRunSecretPayload, unprotectRunSecretBytes } from '../../scripts/gate3-hosted-secrets.mjs';
import {
	acquireRunLock,
	clearActiveRun,
	createInitialRunState,
	finalizeRunArchive,
	inspectRunLock,
	publishActiveRunIfUnlocked,
	readActiveRun,
	readArchivedRunState,
	readRunState,
	readStableGate3PreflightSnapshot,
	recoverStaleRunLock,
	releaseRunLock,
	reserveGate3RunDirectory,
	reserveRunState,
	rollbackGate3RunDirectory,
	resolveGate3RunPaths,
	setActiveRun,
	writeNextRunState
} from '../../scripts/gate3-hosted-state.mjs';

const root = 'C:\\gate3-hosted-fixtures';

describe('Gate 3 hosted state', () => {
	const fixtureRoots: string[] = [];
	const testFilesystem = { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir, unlink, writeFile };

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
	}, 15_000);

	it('survives death after active-pointer candidate creation without deleting the unpublished candidate', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		const guardPath = join(paths.root, '.active-run.lock');
		const crashLeftCandidate = `${guardPath}.candidate-00000000-0000-4000-8000-000000000010`;
		await mkdir(crashLeftCandidate, { mode: 0o700 });

		await expect(setActiveRun({
			root: paths.root,
			runId: paths.runId,
			expectedCurrentRunId: null
		})).resolves.toBe(paths.runId);

		await expect(lstat(crashLeftCandidate)).resolves.toMatchObject({});
		const retired = (await readdir(paths.root)).filter((entry) => entry.startsWith('.active-run.lock.retired-'));
		expect(retired).toHaveLength(1);
		const owner = JSON.parse(await readFile(join(paths.root, retired[0], 'owner.json'), 'utf8'));
		expect(Reflect.ownKeys(owner).sort()).toEqual(['guardId', 'pid', 'version']);
		expect(owner).toMatchObject({ version: 1, pid: process.pid, guardId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
	});

	it('recovers death after active-pointer guard publication by exact owner tombstone identity', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		const guardPath = join(paths.root, '.active-run.lock');
		const staleOwner = { version: 1, guardId: '00000000-0000-4000-8000-000000000011', pid: 2147483647 };
		await mkdir(guardPath, { mode: 0o700 });
		await writeFile(join(guardPath, 'owner.json'), JSON.stringify(staleOwner), { mode: 0o600 });
		const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid) => {
			if (pid === staleOwner.pid) throw Object.assign(new Error('missing'), { code: 'ESRCH' });
			return true;
		});

		try {
			await expect(setActiveRun({
				root: paths.root,
				runId: paths.runId,
				expectedCurrentRunId: null
			})).resolves.toBe(paths.runId);
		} finally {
			killSpy.mockRestore();
		}

		await expect(readFile(`${guardPath}.retired-${staleOwner.guardId}/owner.json`, 'utf8'))
			.resolves.toBe(JSON.stringify(staleOwner));
		await expect(readActiveRun(paths.root)).resolves.toBe(paths.runId);
	});

	it.each(['writeFile', 'sync', 'close'] as const)(
		'cleans only the exact unpublished active-pointer candidate after owner %s failure',
		async (failure) => {
			const { paths } = await createFixture();
			await mkdir(paths.runDirectory, { recursive: true });
			const unrelatedPath = join(paths.root, 'unrelated-evidence.json');
			await writeFile(unrelatedPath, 'preserve');
			let closeAttempts = 0;
			const filesystem = {
				...testFilesystem,
				open: async (...args: Parameters<typeof open>) => {
					const handle = await open(...args);
					if (!String(args[0]).includes('.active-run.lock.candidate-') || !String(args[0]).endsWith('owner.json')) {
						return handle;
					}
					return {
						writeFile: failure === 'writeFile'
							? async () => { throw new Error('simulated owner write failure'); }
							: handle.writeFile.bind(handle),
						sync: failure === 'sync'
							? async () => { throw new Error('simulated owner sync failure'); }
							: handle.sync.bind(handle),
						close: async () => {
							if (failure === 'close' && closeAttempts++ === 0) throw new Error('simulated owner close failure');
							await handle.close();
						}
					};
				}
			};

			await expect(setActiveRun({
				root: paths.root,
				runId: paths.runId,
				expectedCurrentRunId: null,
				filesystem: filesystem as never
			})).rejects.toMatchObject({ reasonCode: 'active_pointer_lock_failed' });

			const guards = (await readdir(paths.root)).filter((entry) => entry.startsWith('.active-run.lock'));
			expect(guards).toEqual([]);
			await expect(readFile(unrelatedPath, 'utf8')).resolves.toBe('preserve');
			await expect(readActiveRun(paths.root)).resolves.toBeNull();
		}
	);

	it('retains attributable active-pointer ownership after final cleanup failure for later stale recovery', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		const guardPath = join(paths.root, '.active-run.lock');
		let cleanupFailed = false;
		const failingFilesystem = {
			...testFilesystem,
			rename: async (from: Parameters<typeof rename>[0], to: Parameters<typeof rename>[1]) => {
				if (String(from) === guardPath && String(to).startsWith(`${guardPath}.retired-`) && !cleanupFailed) {
					cleanupFailed = true;
					throw Object.assign(new Error('simulated cleanup failure'), { code: 'EACCES' });
				}
				return rename(from, to);
			}
		};

		await expect(setActiveRun({
			root: paths.root,
			runId: paths.runId,
			expectedCurrentRunId: null,
			filesystem: failingFilesystem as never
		})).rejects.toMatchObject({ reasonCode: 'active_pointer_lock_failed' });

		const ownerBytes = await readFile(join(guardPath, 'owner.json'), 'utf8');
		const owner = JSON.parse(ownerBytes);
		await expect(readActiveRun(paths.root)).resolves.toBe(paths.runId);
		const killSpy = vi.spyOn(process, 'kill').mockImplementationOnce(() => {
			throw Object.assign(new Error('missing'), { code: 'ESRCH' });
		}).mockImplementation(() => true);
		try {
			await expect(clearActiveRun({ root: paths.root, runId: paths.runId })).resolves.toBeUndefined();
		} finally {
			killSpy.mockRestore();
		}

		await expect(readFile(`${guardPath}.retired-${owner.guardId}/owner.json`, 'utf8'))
			.resolves.toBe(ownerBytes);
		await expect(lstat(guardPath)).rejects.toMatchObject({ code: 'ENOENT' });
		await expect(readActiveRun(paths.root)).resolves.toBeNull();
	});

	it('never steals a live active-pointer owner based on elapsed time', async () => {
		const { paths } = await createFixture();
		await mkdir(paths.runDirectory, { recursive: true });
		const guardPath = join(paths.root, '.active-run.lock');
		const liveOwner = { version: 1, guardId: '00000000-0000-4000-8000-000000000012', pid: process.pid };
		await mkdir(guardPath, { mode: 0o700 });
		await writeFile(join(guardPath, 'owner.json'), JSON.stringify(liveOwner), { mode: 0o600 });
		await utimes(guardPath, new Date(0), new Date(0));

		await expect(setActiveRun({
			root: paths.root,
			runId: paths.runId,
			expectedCurrentRunId: null
		})).rejects.toMatchObject({ reasonCode: 'active_pointer_lock_failed' });

		await expect(readFile(join(guardPath, 'owner.json'), 'utf8')).resolves.toBe(JSON.stringify(liveOwner));
		await expect(readActiveRun(paths.root)).resolves.toBeNull();
	});

	it('uses stale-owner tombstones to stop a delayed observer from retiring an active successor guard', async () => {
		const { paths } = await createFixture();
		const successorPaths = resolveGate3RunPaths({ root: paths.root, runId: 'gate3-20260821-fedcba98' });
		await Promise.all([
			mkdir(paths.runDirectory, { recursive: true }),
			mkdir(successorPaths.runDirectory, { recursive: true })
		]);
		const guardPath = join(paths.root, '.active-run.lock');
		const ownerPath = join(guardPath, 'owner.json');
		const staleOwner = { version: 1, guardId: '00000000-0000-4000-8000-000000000013', pid: 2147483647 };
		await mkdir(guardPath, { mode: 0o700 });
		await writeFile(ownerPath, JSON.stringify(staleOwner), { mode: 0o600 });
		const delayedRetireRead = deferred();
		const delayedRetireProceed = deferred();
		const delayedRetireAttempted = deferred();
		const successorEntered = deferred();
		const successorProceed = deferred();
		let ownerReads = 0;
		const staleTombstone = `${guardPath}.retired-${staleOwner.guardId}`;
		const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid) => {
			if (pid === staleOwner.pid) throw Object.assign(new Error('missing'), { code: 'ESRCH' });
			return true;
		});
		const delayedObserver = setActiveRun({
			root: paths.root,
			runId: paths.runId,
			expectedCurrentRunId: null,
			filesystem: {
				...testFilesystem,
				readFile: async (...args: Parameters<typeof readFile>) => {
					const bytes = await readFile(...args);
					if (String(args[0]) === ownerPath && ++ownerReads === 2) {
						delayedRetireRead.resolve();
						await delayedRetireProceed.promise;
					}
					return bytes;
				},
				rename: async (from: Parameters<typeof rename>[0], to: Parameters<typeof rename>[1]) => {
					try {
						return await rename(from, to);
					} finally {
						if (String(from) === guardPath && String(to) === staleTombstone) delayedRetireAttempted.resolve();
					}
				}
			} as never
		});
		let successor: ReturnType<typeof setActiveRun> | undefined;

		try {
			await Promise.race([
				delayedRetireRead.promise,
				delayedObserver.then(
					() => { throw new Error('delayed observer acquired before stale-owner inspection'); },
					() => { throw new Error('active-pointer guard owner metadata was not inspected'); }
				)
			]);
			successor = setActiveRun({
				root: successorPaths.root,
				runId: successorPaths.runId,
				expectedCurrentRunId: null,
				filesystem: {
					...testFilesystem,
					lstat: async (...args: Parameters<typeof lstat>) => {
						if (String(args[0]) === successorPaths.activePointerPath) {
							successorEntered.resolve();
							await successorProceed.promise;
						}
						return lstat(...args);
					}
				} as never
			});
			await successorEntered.promise;
			const successorOwnerBytes = await readFile(ownerPath, 'utf8');
			delayedRetireProceed.resolve();
			await delayedRetireAttempted.promise;
			await expect(readFile(ownerPath, 'utf8')).resolves.toBe(successorOwnerBytes);
			successorProceed.resolve();
			await expect(successor).resolves.toBe(successorPaths.runId);
			await expect(delayedObserver).rejects.toMatchObject({ reasonCode: 'active_run_changed' });
		} finally {
			delayedRetireProceed.resolve();
			successorProceed.resolve();
			killSpy.mockRestore();
			await Promise.allSettled([delayedObserver, ...(successor ? [successor] : [])]);
		}
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
		const staleOwner = { version: 1, guardId: '00000000-0000-4000-8000-000000000014', pid: 2147483647 };
		const acquiredBytes = `${JSON.stringify({
			runId: paths.runId,
			command: 'scenario',
			pid: 77,
			startedAt: '2026-08-20T10:00:00.000Z'
		})}\n`;
		await mkdir(guardPath);
		await writeFile(ownerPath, JSON.stringify(staleOwner));
		await writeFile(paths.lockPath, acquiredBytes);
		const delayedRetireRead = deferred();
		const delayedRetireProceed = deferred();
		const delayedRetireAttempted = deferred();
		const successorEntered = deferred();
		const successorProceed = deferred();
		let guardOwnerReads = 0;
		const staleTombstone = `${guardPath}.retired-${staleOwner.guardId}`;
		const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid) => {
			if (pid === staleOwner.pid) throw Object.assign(new Error('missing'), { code: 'ESRCH' });
			return true;
		});
		const delayedObserver = releaseRunLock({
			paths,
			acquiredLock: { acquiredBytes },
			guardFilesystem: {
				...testFilesystem,
				readFile: async (...args: Parameters<typeof readFile>) => {
					const bytes = await readFile(...args);
					if (String(args[0]) === ownerPath) {
						guardOwnerReads += 1;
						if (guardOwnerReads === 2) {
							delayedRetireRead.resolve();
							await delayedRetireProceed.promise;
						}
					}
					return bytes;
				},
				rename: async (from: Parameters<typeof rename>[0], to: Parameters<typeof rename>[1]) => {
					try {
						return await rename(from, to);
					} finally {
						if (String(from) === guardPath && String(to) === staleTombstone) delayedRetireAttempted.resolve();
					}
				}
			}
		} as never);

		let successorPromise: ReturnType<typeof releaseRunLock> | undefined;
		try {
			await Promise.race([
				delayedRetireRead.promise,
				delayedObserver.then(() => { throw new Error('release guard filesystem injection was ignored'); })
			]);
			successorPromise = releaseRunLock({
				paths,
				acquiredLock: { acquiredBytes },
				filesystem: {
					...testFilesystem,
					readFile: async (...args: Parameters<typeof readFile>) => {
						if (String(args[0]) === paths.lockPath) {
							successorEntered.resolve();
							await successorProceed.promise;
						}
						return readFile(...args);
					}
				}
			} as never);
			await successorEntered.promise;
			const successorOwnerBytes = await readFile(ownerPath, 'utf8');
			delayedRetireProceed.resolve();
			await delayedRetireAttempted.promise;
			await expect(readFile(ownerPath, 'utf8')).resolves.toBe(successorOwnerBytes);
			successorProceed.resolve();
			await expect(successorPromise).resolves.toBe(true);
			await expect(delayedObserver).rejects.toMatchObject({ reasonCode: 'lock_guard_failed' });
		} finally {
			delayedRetireProceed.resolve();
			successorProceed.resolve();
			killSpy.mockRestore();
			await Promise.allSettled([delayedObserver, ...(successorPromise ? [successorPromise] : [])]);
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

	it('serializes active publication with run-lock acquisition so the old run cannot lock after the switch', async () => {
		const { paths: oldPaths } = await createFixture();
		await reserveGate3RunDirectory(oldPaths);
		await setActiveRun({ root: oldPaths.root, runId: oldPaths.runId, expectedCurrentRunId: null });
		const newPaths = resolveGate3RunPaths({
			root: oldPaths.root,
			runId: 'gate3-20260821-fedcba98'
		});
		await reserveGate3RunDirectory(newPaths);
		const publisherEntered = deferred();
		const publisherProceed = deferred();
		const lockAttempted = deferred();
		let pointerReads = 0;
		const publisher = publishActiveRunIfUnlocked({
			root: newPaths.root,
			runId: newPaths.runId,
			expectedCurrentRunId: oldPaths.runId,
			filesystem: {
				readFile: async (...args: Parameters<typeof readFile>) => {
					if (String(args[0]) === newPaths.activePointerPath && pointerReads++ === 0) {
						publisherEntered.resolve();
						await publisherProceed.promise;
					}
					return readFile(...args);
				}
			} as never
		});
		await publisherEntered.promise;
		const acquisition = acquireRunLock({
			paths: oldPaths,
			command: 'scenario',
			coordinationFilesystem: {
				rename: async (...args: Parameters<typeof rename>) => {
					if (String(args[1]) === join(oldPaths.root, '.active-run.lock')) lockAttempted.resolve();
					return rename(...args);
				}
			} as never
		});
		await lockAttempted.promise;
		await expect(lstat(oldPaths.lockPath)).rejects.toMatchObject({ code: 'ENOENT' });

		publisherProceed.resolve();
		await expect(publisher).resolves.toBe(newPaths.runId);
		await expect(acquisition).rejects.toMatchObject({ reasonCode: 'active_run_changed' });
		await expect(lstat(oldPaths.lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('refuses rollback after the reserved run is published and preserves its files', async () => {
		const { paths } = await createFixture();
		const reservation = await reserveGate3RunDirectory(paths);
		await writeFile(paths.manifestPath, 'manifest');
		await setActiveRun({ root: paths.root, runId: paths.runId, expectedCurrentRunId: null });

		await expect(rollbackGate3RunDirectory({ paths, reservation })).rejects.toMatchObject({
			reasonCode: 'active_run_changed'
		});
		await expect(readFile(paths.manifestPath, 'utf8')).resolves.toBe('manifest');
	});

	it('refuses rollback of a replacement directory and preserves both identities', async () => {
		const { paths } = await createFixture();
		const reservation = await reserveGate3RunDirectory(paths);
		const originalDirectory = `${paths.runDirectory}-original`;
		await rename(paths.runDirectory, originalDirectory);
		await mkdir(paths.runDirectory);
		const replacementMarker = join(paths.runDirectory, 'replacement.txt');
		await writeFile(replacementMarker, 'preserve replacement');

		await expect(rollbackGate3RunDirectory({ paths, reservation })).rejects.toMatchObject({
			reasonCode: 'rollback_ambiguous'
		});
		await expect(readFile(replacementMarker, 'utf8')).resolves.toBe('preserve replacement');
		await expect(lstat(originalDirectory)).resolves.toMatchObject({});
	});

	it('rejects a cooperative preflight file identity swap instead of returning mixed bytes', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		await atomicPrivateWrite(paths.manifestPath, '{}\n');
		await atomicPrivateWrite(paths.secretPath, 'ciphertext');
		let manifestIdentityReads = 0;
		const filesystem = {
			lstat: async (path: Parameters<typeof lstat>[0], options?: { bigint?: boolean }) => {
				const entry = options?.bigint ? await lstat(path, { bigint: true }) : await lstat(path);
				if (String(path) !== paths.manifestPath || !options?.bigint) return entry;
				manifestIdentityReads += 1;
				if (manifestIdentityReads === 1 || typeof entry.ino !== 'bigint') return entry;
				return {
					...entry,
					ino: entry.ino + 1n,
					isFile: () => entry.isFile(),
					isSymbolicLink: () => entry.isSymbolicLink()
				};
			}
		};

		await expect(
			readStableGate3PreflightSnapshot(paths, { filesystem: filesystem as never })
		).rejects.toMatchObject({ reasonCode: 'preflight_snapshot_changed' });
	});

	it('reads ciphertext through its opened handle during a transient pathname ABA substitution', async () => {
		const { paths, state } = await createFixture();
		await reserveRunState(paths, state);
		await atomicPrivateWrite(paths.manifestPath, '{}\n');
		let randomCall = 0;
		const payload = createRunSecretPayload({
			runId: paths.runId,
			randomBytesImpl: (size: number) => Buffer.alloc(size, ++randomCall)
		});
		const originalCiphertext = Buffer.from(JSON.stringify(payload), 'utf8');
		const substituteCiphertext = Buffer.from(originalCiphertext);
		substituteCiphertext[0] ^= 1;
		await atomicPrivateWrite(paths.secretPath, originalCiphertext.toString('utf8'));
		const stableSecretIdentity = await lstat(paths.secretPath, { bigint: true });
		let pathnameSecretReads = 0;
		const filesystem = {
			lstat: async (path: Parameters<typeof lstat>[0], options?: { bigint?: boolean }) => {
				if (String(path) === paths.secretPath && options?.bigint) return stableSecretIdentity;
				return options?.bigint ? lstat(path, { bigint: true }) : lstat(path);
			},
			readFile: async (...args: Parameters<typeof readFile>) => {
				if (String(args[0]) === paths.secretPath) {
					pathnameSecretReads += 1;
					return Buffer.from(substituteCiphertext);
				}
				return readFile(...args);
			},
			open: async (...args: Parameters<typeof open>) => {
				const handle = await open(...args);
				if (String(args[0]) !== paths.secretPath) return handle;
				return {
					stat: async () => stableSecretIdentity,
					readFile: async () => Buffer.from(originalCiphertext),
					close: handle.close.bind(handle)
				};
			}
		};

		const snapshot = await readStableGate3PreflightSnapshot(paths, {
			filesystem: filesystem as never
		});

		expect(snapshot.secretBytes).toEqual(originalCiphertext);
		expect(pathnameSecretReads).toBe(0);
		let decryptedCiphertext: Buffer | undefined;
		await unprotectRunSecretBytes({
			runId: paths.runId,
			ciphertext: snapshot.secretBytes,
			dpapi: {
				unprotect: async (input: Buffer) => {
					decryptedCiphertext = Buffer.from(input);
					return Buffer.from(input);
				}
			}
		});
		expect(decryptedCiphertext).toEqual(originalCiphertext);
		expect(decryptedCiphertext).not.toEqual(substituteCiphertext);
		expect(snapshot.secretBytes.every((byte) => byte === 0)).toBe(true);
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
