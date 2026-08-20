import { lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { atomicPrivateWrite, reservePrivateFile } from './hosted-private-file.mjs';

const RUN_ID_PATTERN = /^gate3-\d{8}-[a-f0-9]{8}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SAFE_CACHE_KEYS = new Set([
	'observedAt',
	'classification',
	'status',
	'phase',
	'step',
	'reasonCode',
	'runId',
	'projectRef',
	'workerOrigin',
	'releaseCommitSha',
	'manifestSha256',
	'revision',
	'archived',
	'cleanupVerified',
	'independentZeroVerified',
	'counts',
	'foreignCounts',
	'scenarioId',
	'operationId',
	'destination',
	'requestedAt',
	'completedAt'
]);
const TOP_LEVEL_STATE_KEYS = new Set([
	'schemaVersion',
	'revision',
	'runId',
	'createdAt',
	'target',
	'identitySchemeVersion',
	'manifest',
	'secretStore',
	'phases',
	'scenarioCheckpoints',
	'lastInspection',
	'archive'
]);
const PHASE_NAMES = ['preflight', 'provision', 'scenario', 'cleanup', 'recovery'];

export class Gate3HostedStateError extends Error {
	/** @param {string} reasonCode */
	constructor(reasonCode) {
		super(reasonCode);
		this.name = 'Gate3HostedStateError';
		this.reasonCode = reasonCode;
	}
}

export const GATE3_STATE_SCHEMA_VERSION = 1;
export const GATE3_PROJECT_REF = 'nuhkpqjjyuygiemrxbdp';
export const GATE3_WORKER_ORIGIN =
	'https://perfume-marketplace-bg-staging.perfume-marketplace-bg.workers.dev';

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {Record<string, unknown>} value @param {readonly string[]} keys */
function assertExactKeys(value, keys) {
	const actualKeys = Object.keys(value);
	if (actualKeys.length !== keys.length || actualKeys.some((key) => !keys.includes(key))) {
		throw new Gate3HostedStateError('state_invalid');
	}
}

/** @param {unknown} value */
function assertSafeCachedValue(value) {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number') {
		if (Number.isFinite(value)) return;
		throw new Gate3HostedStateError('state_invalid');
	}
	if (!isPlainObject(value)) throw new Gate3HostedStateError('state_invalid');
	for (const [key, entry] of Object.entries(value)) {
		if (!SAFE_CACHE_KEYS.has(key)) throw new Gate3HostedStateError('state_invalid');
		if (key === 'counts' || key === 'foreignCounts') {
			assertSafeCountMap(entry);
		} else {
			assertSafeCachedValue(entry);
		}
	}
}

/** @param {unknown} value */
function assertSafeCountMap(value) {
	if (!isPlainObject(value)) throw new Gate3HostedStateError('state_invalid');
	for (const count of Object.values(value)) {
		if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
			throw new Gate3HostedStateError('state_invalid');
		}
	}
}

/** @param {unknown} value */
function assertShaOrNull(value) {
	if (value === null || (typeof value === 'string' && SHA256_PATTERN.test(value))) return;
	throw new Gate3HostedStateError('state_invalid');
}

/** @param {unknown} value */
function assertAbsolutePath(value) {
	if (typeof value !== 'string' || !isAbsolute(value)) throw new Gate3HostedStateError('state_invalid');
}

/** @param {unknown} state @returns {Record<string, any>} */
function validateRunState(state) {
	if (!isPlainObject(state)) throw new Gate3HostedStateError('state_invalid');
	assertExactKeys(state, [...TOP_LEVEL_STATE_KEYS]);
	if (state.schemaVersion !== GATE3_STATE_SCHEMA_VERSION) throw new Gate3HostedStateError('state_invalid');
	if (typeof state.revision !== 'number' || !Number.isSafeInteger(state.revision) || state.revision < 0) {
		throw new Gate3HostedStateError('state_invalid');
	}
	if (typeof state.runId !== 'string' || !RUN_ID_PATTERN.test(state.runId)) {
		throw new Gate3HostedStateError('state_invalid');
	}
	if (typeof state.createdAt !== 'string' || Number.isNaN(Date.parse(state.createdAt))) {
		throw new Gate3HostedStateError('state_invalid');
	}
	if (!isPlainObject(state.target)) throw new Gate3HostedStateError('state_invalid');
	assertExactKeys(state.target, ['projectRef', 'workerOrigin', 'releaseCommitSha']);
	if (
		typeof state.target.projectRef !== 'string' ||
		typeof state.target.workerOrigin !== 'string' ||
		typeof state.target.releaseCommitSha !== 'string' ||
		!COMMIT_SHA_PATTERN.test(state.target.releaseCommitSha)
	) {
		throw new Gate3HostedStateError('state_invalid');
	}
	if (state.identitySchemeVersion !== 1) throw new Gate3HostedStateError('state_invalid');
	if (!isPlainObject(state.manifest)) throw new Gate3HostedStateError('state_invalid');
	assertExactKeys(state.manifest, ['path', 'sha256']);
	assertAbsolutePath(state.manifest.path);
	assertShaOrNull(state.manifest.sha256);
	if (!isPlainObject(state.secretStore)) throw new Gate3HostedStateError('state_invalid');
	assertExactKeys(state.secretStore, ['path', 'status', 'ciphertextSha256']);
	assertAbsolutePath(state.secretStore.path);
	if (typeof state.secretStore.status !== 'string') throw new Gate3HostedStateError('state_invalid');
	assertShaOrNull(state.secretStore.ciphertextSha256);
	if (!isPlainObject(state.phases)) throw new Gate3HostedStateError('state_invalid');
	assertExactKeys(state.phases, PHASE_NAMES);
	for (const phaseName of PHASE_NAMES) {
		const phase = state.phases[phaseName];
		if (!isPlainObject(phase)) throw new Gate3HostedStateError('state_invalid');
		assertExactKeys(phase, ['status', 'checkpoint']);
		if (typeof phase.status !== 'string') throw new Gate3HostedStateError('state_invalid');
		assertSafeCachedValue(phase.checkpoint);
	}
	if (!isPlainObject(state.scenarioCheckpoints)) throw new Gate3HostedStateError('state_invalid');
	for (const [key, value] of Object.entries(state.scenarioCheckpoints)) {
		if (!/^scenario-[a-z0-9-]+$/u.test(key)) throw new Gate3HostedStateError('state_invalid');
		assertSafeCachedValue(value);
	}
	if (state.lastInspection !== null && !isPlainObject(state.lastInspection)) {
		throw new Gate3HostedStateError('state_invalid');
	}
	if (state.archive !== null && !isPlainObject(state.archive)) {
		throw new Gate3HostedStateError('state_invalid');
	}
	assertSafeCachedValue(state.lastInspection);
	assertSafeCachedValue(state.archive);
	return /** @type {Record<string, any>} */ (state);
}

/** @param {unknown} paths @returns {Record<string, string>} */
function validatePaths(paths) {
	if (!isPlainObject(paths)) throw new Gate3HostedStateError('state_path_invalid');
	if (typeof paths.root !== 'string' || typeof paths.runId !== 'string') {
		throw new Gate3HostedStateError('state_path_invalid');
	}
	const expected = resolveGate3RunPaths({ root: paths.root, runId: paths.runId });
	for (const [key, value] of Object.entries(expected)) {
		if (paths[key] !== value) throw new Gate3HostedStateError('state_path_invalid');
	}
	return /** @type {Record<string, string>} */ (expected);
}

/** @param {Record<string, string>} paths @param {unknown} state @returns {Record<string, any>} */
function assertStateMatchesPaths(paths, state) {
	const validState = validateRunState(state);
	if (
		validState.runId !== paths.runId ||
		validState.target.projectRef !== GATE3_PROJECT_REF ||
		validState.target.workerOrigin !== GATE3_WORKER_ORIGIN ||
		validState.manifest.path !== paths.manifestPath ||
		validState.secretStore.path !== paths.secretPath
	) {
		throw new Gate3HostedStateError('state_invalid');
	}
	return validState;
}

/** @param {string} candidate @param {string} root */
function pathIsInside(candidate, root) {
	const rootRelative = relative(root, candidate);
	return rootRelative === '' || (!rootRelative.startsWith('..') && !isAbsolute(rootRelative));
}

/** @param {string} directory */
async function assertRealDirectory(directory) {
	try {
		const entry = await lstat(directory);
		if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('unsafe directory');
		if ((await realpath(directory)).toLowerCase() !== resolve(directory).toLowerCase()) {
			throw new Error('reparse directory');
		}
	} catch (error) {
		if (error instanceof Gate3HostedStateError) throw error;
		throw new Gate3HostedStateError('state_path_invalid');
	}
}

/** @param {Record<string, string>} paths @param {{ createRunDirectory?: boolean }} [options] */
async function assertSafeRunPaths(paths, { createRunDirectory = false } = {}) {
	await assertRealDirectory(paths.root);
	if (createRunDirectory) {
		try {
			await assertRealDirectory(paths.activeRoot);
		} catch (error) {
			if (!(error instanceof Gate3HostedStateError)) throw error;
			try {
				await mkdir(paths.activeRoot, { recursive: false, mode: 0o700 });
			} catch (mkdirError) {
				if (/** @type {NodeJS.ErrnoException} */ (mkdirError).code !== 'EEXIST') throw mkdirError;
			}
			await assertRealDirectory(paths.activeRoot);
		}
		await mkdir(paths.runDirectory, { recursive: false, mode: 0o700 }).catch((error) => {
			if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
		});
	}
	for (const directory of [paths.activeRoot, paths.runDirectory]) await assertRealDirectory(directory);
	if (!pathIsInside(resolve(paths.statePath), resolve(paths.runDirectory))) {
		throw new Gate3HostedStateError('state_path_invalid');
	}
}

/** @param {string} filePath */
async function assertRegularFile(filePath) {
	try {
		const entry = await lstat(filePath);
		if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('unsafe file');
	} catch (error) {
		if (error instanceof Gate3HostedStateError) throw error;
		throw new Gate3HostedStateError('state_unavailable');
	}
}

/** @param {{ root: string, runId: string }} options */
export function resolveGate3RunPaths({ root, runId }) {
	if (typeof root !== 'string' || !isAbsolute(root)) throw new Gate3HostedStateError('root_invalid');
	if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
		throw new Gate3HostedStateError('run_id_invalid');
	}
	const activeRoot = join(root, 'active');
	const archiveRoot = join(root, 'archive');
	const runDirectory = join(activeRoot, runId);
	return Object.freeze({
		root,
		activeRoot,
		archiveRoot,
		runId,
		runDirectory,
		archiveDirectory: join(archiveRoot, runId),
		statePath: join(runDirectory, 'gate3-run-state.json'),
		secretPath: join(runDirectory, 'gate3-secrets.dpapi'),
		manifestPath: join(runDirectory, 'gate3-run-manifest.json'),
		lockPath: join(runDirectory, '.gate3.lock'),
		activePointerPath: join(root, 'active-run.json')
	});
}

/** @param {{ runId: string, createdAt: string, releaseCommitSha: string, manifestPath: string, secretPath: string }} options */
export function createInitialRunState({ runId, createdAt, releaseCommitSha, manifestPath, secretPath }) {
	const state = {
		schemaVersion: GATE3_STATE_SCHEMA_VERSION,
		revision: 0,
		runId,
		createdAt,
		target: {
			projectRef: GATE3_PROJECT_REF,
			workerOrigin: GATE3_WORKER_ORIGIN,
			releaseCommitSha
		},
		identitySchemeVersion: 1,
		manifest: { path: manifestPath, sha256: null },
		secretStore: { path: secretPath, status: 'missing', ciphertextSha256: null },
		phases: Object.fromEntries(PHASE_NAMES.map((name) => [name, { status: 'pending', checkpoint: null }])),
		scenarioCheckpoints: {},
		lastInspection: null,
		archive: null
	};
	validateRunState(state);
	return Object.freeze({
		...state,
		target: Object.freeze(state.target),
		manifest: Object.freeze(state.manifest),
		secretStore: Object.freeze(state.secretStore),
		phases: Object.freeze(
			Object.fromEntries(Object.entries(state.phases).map(([name, phase]) => [name, Object.freeze(phase)]))
		),
		scenarioCheckpoints: Object.freeze(state.scenarioCheckpoints)
	});
}

/** @param {Record<string, string>} paths */
export async function readRunState(paths) {
	const exactPaths = validatePaths(paths);
	await assertSafeRunPaths(exactPaths);
	await assertRegularFile(exactPaths.statePath);
	try {
		const state = JSON.parse(await readFile(exactPaths.statePath, 'utf8'));
		return assertStateMatchesPaths(exactPaths, state);
	} catch (error) {
		if (error instanceof Gate3HostedStateError) throw error;
		throw new Gate3HostedStateError('state_invalid');
	}
}

/** @param {Record<string, string>} paths @param {unknown} state */
export async function reserveRunState(paths, state) {
	const exactPaths = validatePaths(paths);
	assertStateMatchesPaths(exactPaths, state);
	await assertSafeRunPaths(exactPaths, { createRunDirectory: true });
	try {
		await reservePrivateFile(exactPaths.statePath, `${JSON.stringify(state)}\n`);
	} catch {
		throw new Gate3HostedStateError('state_already_exists');
	}
}

/** @param {Record<string, string>} paths @param {unknown} currentState @param {unknown} nextState */
export async function writeNextRunState(paths, currentState, nextState) {
	const exactPaths = validatePaths(paths);
	const validCurrentState = assertStateMatchesPaths(exactPaths, currentState);
	const persistedState = await readRunState(exactPaths);
	if (JSON.stringify(persistedState) !== JSON.stringify(validCurrentState)) {
		throw new Gate3HostedStateError('state_changed');
	}
	const validNextState = validateRunState(nextState);
	if (
		validNextState.revision !== validCurrentState.revision + 1
	) {
		throw new Gate3HostedStateError('revision_invalid');
	}
	for (const key of ['runId', 'createdAt', 'target', 'identitySchemeVersion']) {
		if (JSON.stringify(validNextState[key]) !== JSON.stringify(validCurrentState[key])) {
			throw new Gate3HostedStateError('immutable_binding_changed');
		}
	}
	if (
		validNextState.manifest.path !== validCurrentState.manifest.path ||
		validNextState.secretStore.path !== validCurrentState.secretStore.path
	) {
		throw new Gate3HostedStateError('immutable_binding_changed');
	}
	assertStateMatchesPaths(exactPaths, validNextState);
	await assertSafeRunPaths(exactPaths);
	try {
		await atomicPrivateWrite(exactPaths.statePath, `${JSON.stringify(validNextState)}\n`, {
			verify: (replacementBytes) => {
				if (replacementBytes !== `${JSON.stringify(validNextState)}\n`) {
					throw new Gate3HostedStateError('state_invalid');
				}
				assertStateMatchesPaths(exactPaths, JSON.parse(replacementBytes));
			}
		});
	} catch (error) {
		if (error instanceof Gate3HostedStateError) throw error;
		throw new Gate3HostedStateError('state_write_failed');
	}
}

/** @param {string} root */
export async function readActiveRun(root) {
	if (typeof root !== 'string' || !isAbsolute(root)) throw new Gate3HostedStateError('root_invalid');
	await assertRealDirectory(root);
	const pointerPath = join(root, 'active-run.json');
	try {
		const entry = await lstat(pointerPath);
		if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('unsafe pointer');
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
		throw new Gate3HostedStateError('active_pointer_invalid');
	}
	try {
		const pointer = JSON.parse(await readFile(pointerPath, 'utf8'));
		if (!isPlainObject(pointer)) throw new Error('invalid pointer');
		assertExactKeys(pointer, ['schemaVersion', 'runId']);
		if (pointer.schemaVersion !== 1 || typeof pointer.runId !== 'string' || !RUN_ID_PATTERN.test(pointer.runId)) {
			throw new Error('invalid pointer');
		}
		return pointer.runId;
	} catch {
		throw new Gate3HostedStateError('active_pointer_invalid');
	}
}

/** @param {string} root @param {() => Promise<string | null | void>} operation */
async function withActivePointerLock(root, operation) {
	const lockPath = join(root, '.active-run.lock');
	let handle;
	let acquired = false;
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			handle = await open(lockPath, 'wx', 0o600);
			await handle.writeFile(`${process.pid}\n`, 'utf8');
			await handle.sync();
			await handle.close();
			handle = undefined;
			acquired = true;
			break;
		} catch (error) {
			try {
				await handle?.close();
			} catch {
				// The lock acquisition result remains fail-closed.
			}
			handle = undefined;
			if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') {
				throw new Gate3HostedStateError('active_pointer_lock_failed');
			}
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
		}
	}
	if (!acquired) throw new Gate3HostedStateError('active_pointer_lock_failed');
	try {
		return await operation();
	} finally {
		try {
			await unlink(lockPath);
		} catch {
			throw new Gate3HostedStateError('active_pointer_lock_failed');
		}
	}
}

/** @param {{ root: string, runId: string, expectedCurrentRunId: string | null }} options */
export async function setActiveRun({ root, runId, expectedCurrentRunId }) {
	const paths = resolveGate3RunPaths({ root, runId });
	if (expectedCurrentRunId !== null && (typeof expectedCurrentRunId !== 'string' || !RUN_ID_PATTERN.test(expectedCurrentRunId))) {
		throw new Gate3HostedStateError('active_pointer_invalid');
	}
	await assertSafeRunPaths(paths);
	return withActivePointerLock(root, async () => {
		const currentRunId = await readActiveRun(root);
		if (currentRunId !== expectedCurrentRunId) throw new Gate3HostedStateError('active_run_changed');
		const contents = `${JSON.stringify({ schemaVersion: 1, runId })}\n`;
		try {
			await atomicPrivateWrite(paths.activePointerPath, contents, {
				verify: (replacementBytes) => {
					if (replacementBytes !== contents) throw new Gate3HostedStateError('active_pointer_invalid');
				}
			});
		} catch (error) {
			if (error instanceof Gate3HostedStateError) throw error;
			throw new Gate3HostedStateError('active_pointer_write_failed');
		}
		return runId;
	});
}

/** @param {{ root: string, runId: string }} options */
export async function clearActiveRun({ root, runId }) {
	resolveGate3RunPaths({ root, runId });
	return withActivePointerLock(root, async () => {
		if ((await readActiveRun(root)) !== runId) throw new Gate3HostedStateError('active_run_changed');
		try {
			await unlink(join(root, 'active-run.json'));
		} catch {
			throw new Gate3HostedStateError('active_pointer_write_failed');
		}
	});
}
