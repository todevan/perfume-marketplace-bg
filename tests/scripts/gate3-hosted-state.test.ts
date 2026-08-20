import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicPrivateWrite } from '../../scripts/hosted-private-file.mjs';
import {
	createInitialRunState,
	readActiveRun,
	readRunState,
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
