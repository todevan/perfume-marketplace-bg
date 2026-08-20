import { lstat, mkdir, open, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { atomicPrivateWrite, reservePrivateFile } from './hosted-private-file.mjs';

const RUN_ID_PATTERN = /^gate3-\d{8}-[a-f0-9]{8}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const CHECKPOINT_KEYS = new Set([
	'observedAt',
	'status',
	'phase',
	'step',
	'reasonCode',
	'revision',
	'scenarioId',
	'operationId'
]);
const INSPECTION_KEYS = new Set([
	'observedAt',
	'classification',
	'status',
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
	'foreignCounts'
]);
const ARCHIVE_KEYS = new Set([
	'status',
	'destination',
	'requestedAt',
	'completedAt',
	'manifestSha256'
]);
const RUN_LOCK_COMMANDS = new Set(['preflight', 'provision', 'scenario', 'cleanup', 'recovery', 'archive']);
const GUARD_PUBLICATION_CONFLICT_CODES = new Set(['EEXIST', 'ENOTEMPTY', 'EPERM']);
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
const NODE_FILESYSTEM = Object.freeze({ lstat, mkdir, open, readFile, realpath, rename, rm, unlink, writeFile });

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
function assertSafeCacheScalar(value) {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number') {
		if (Number.isFinite(value)) return;
		throw new Gate3HostedStateError('state_invalid');
	}
	throw new Gate3HostedStateError('state_invalid');
}

/** @param {unknown} value @param {Set<string>} allowedKeys @param {Set<string>} [countMapKeys] */
function assertSafeCacheRecord(value, allowedKeys, countMapKeys = new Set()) {
	if (!isPlainObject(value)) throw new Gate3HostedStateError('state_invalid');
	for (const [key, entry] of Object.entries(value)) {
		if (!allowedKeys.has(key)) throw new Gate3HostedStateError('state_invalid');
		if (countMapKeys.has(key)) {
			assertSafeCountMap(entry);
		} else {
			assertSafeCacheScalar(entry);
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
		if (phase.checkpoint !== null) assertSafeCacheRecord(phase.checkpoint, CHECKPOINT_KEYS);
	}
	if (!isPlainObject(state.scenarioCheckpoints)) throw new Gate3HostedStateError('state_invalid');
	for (const [key, value] of Object.entries(state.scenarioCheckpoints)) {
		if (!/^scenario-[a-z0-9-]+$/u.test(key)) throw new Gate3HostedStateError('state_invalid');
		assertSafeCacheRecord(value, CHECKPOINT_KEYS);
	}
	if (state.lastInspection !== null && !isPlainObject(state.lastInspection)) {
		throw new Gate3HostedStateError('state_invalid');
	}
	if (state.archive !== null && !isPlainObject(state.archive)) {
		throw new Gate3HostedStateError('state_invalid');
	}
	if (state.lastInspection !== null) {
		assertSafeCacheRecord(state.lastInspection, INSPECTION_KEYS, new Set(['counts', 'foreignCounts']));
	}
	if (state.archive !== null) {
		assertExactKeys(state.archive, [...ARCHIVE_KEYS]);
		if (typeof state.archive.status !== 'string' || !['pending', 'complete'].includes(state.archive.status)) throw new Gate3HostedStateError('state_invalid');
		if (typeof state.archive.destination !== 'string') throw new Gate3HostedStateError('state_invalid');
		assertAbsolutePath(state.archive.destination);
		if (typeof state.archive.requestedAt !== 'string' || Number.isNaN(Date.parse(state.archive.requestedAt))) {
			throw new Gate3HostedStateError('state_invalid');
		}
		if (state.archive.completedAt !== null && (typeof state.archive.completedAt !== 'string' || Number.isNaN(Date.parse(state.archive.completedAt)))) {
			throw new Gate3HostedStateError('state_invalid');
		}
		if ((state.archive.status === 'pending') !== (state.archive.completedAt === null)) {
			throw new Gate3HostedStateError('state_invalid');
		}
		assertShaOrNull(state.archive.manifestSha256);
	}
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

/** @param {string} directory @param {typeof NODE_FILESYSTEM} [filesystem] */
async function assertRealDirectory(directory, filesystem = NODE_FILESYSTEM) {
	try {
		const entry = await filesystem.lstat(directory);
		if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('unsafe directory');
		if ((await filesystem.realpath(directory)).toLowerCase() !== resolve(directory).toLowerCase()) {
			throw new Error('reparse directory');
		}
	} catch (error) {
		if (error instanceof Gate3HostedStateError) throw error;
		throw new Gate3HostedStateError('state_path_invalid');
	}
}

/** @param {string} directory @param {typeof NODE_FILESYSTEM} [filesystem] */
async function captureDirectoryIdentity(directory, filesystem = NODE_FILESYSTEM) {
	await assertRealDirectory(directory, filesystem);
	const entry = await filesystem.lstat(directory, { bigint: true });
	return Object.freeze({ dev: entry.dev, ino: entry.ino, realpath: await filesystem.realpath(directory) });
}

/** @param {{ dev: number | bigint, ino: number | bigint, realpath: string }} left @param {{ dev: number | bigint, ino: number | bigint, realpath: string }} right */
function sameDirectoryIdentity(left, right) {
	return left.dev === right.dev && left.ino === right.ino && left.realpath.toLowerCase() === right.realpath.toLowerCase();
}

/** @param {string} directory @param {typeof NODE_FILESYSTEM} [filesystem] */
async function directoryIsMissing(directory, filesystem = NODE_FILESYSTEM) {
	try {
		await filesystem.lstat(directory);
		return false;
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return true;
		throw new Gate3HostedStateError('state_path_invalid');
	}
}

/** @param {Record<string, string>} paths @param {{ createRunDirectory?: boolean, filesystem?: typeof NODE_FILESYSTEM }} [options] */
async function assertSafeRunPaths(paths, { createRunDirectory = false, filesystem = NODE_FILESYSTEM } = {}) {
	await assertRealDirectory(paths.root, filesystem);
	if (createRunDirectory) {
		if (await directoryIsMissing(paths.activeRoot, filesystem)) {
			await filesystem.mkdir(paths.activeRoot, { recursive: false, mode: 0o700 });
		}
		await assertRealDirectory(paths.activeRoot, filesystem);
		await filesystem.mkdir(paths.runDirectory, { recursive: false, mode: 0o700 }).catch((error) => {
			if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
		});
	}
	for (const directory of [paths.activeRoot, paths.runDirectory]) await assertRealDirectory(directory, filesystem);
	if (!pathIsInside(resolve(paths.statePath), resolve(paths.runDirectory))) {
		throw new Gate3HostedStateError('state_path_invalid');
	}
}

/** @param {Record<string, string>} paths @param {typeof NODE_FILESYSTEM} [filesystem] */
async function assertSafeArchivePaths(paths, filesystem = NODE_FILESYSTEM) {
	await assertRealDirectory(paths.root, filesystem);
	await assertRealDirectory(paths.archiveRoot, filesystem);
	await assertRealDirectory(paths.archiveDirectory, filesystem);
	if (!pathIsInside(resolve(paths.archiveDirectory), resolve(paths.archiveRoot))) {
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

/** @param {string} filePath @param {typeof NODE_FILESYSTEM} [filesystem] */
async function regularFileIsMissing(filePath, filesystem = NODE_FILESYSTEM) {
	try {
		const entry = await filesystem.lstat(filePath);
		if (!entry.isFile() || entry.isSymbolicLink()) throw new Gate3HostedStateError('state_path_invalid');
		return false;
	} catch (error) {
		if (error instanceof Gate3HostedStateError) throw error;
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return true;
		throw new Gate3HostedStateError('state_unavailable');
	}
}

/** @param {string} value */
function assertTimestamp(value) {
	if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Gate3HostedStateError('lock_invalid');
}

/** @param {Record<string, string>} paths @param {unknown} lock */
function validateRunLock(paths, lock) {
	if (!isPlainObject(lock)) throw new Gate3HostedStateError('lock_invalid');
	assertExactKeys(lock, ['runId', 'command', 'pid', 'startedAt']);
	if (
		lock.runId !== paths.runId ||
		typeof lock.command !== 'string' ||
		!RUN_LOCK_COMMANDS.has(lock.command) ||
		typeof lock.pid !== 'number' ||
		!Number.isSafeInteger(lock.pid) ||
		lock.pid <= 0
	) {
		throw new Gate3HostedStateError('lock_invalid');
	}
	if (typeof lock.startedAt !== 'string') throw new Gate3HostedStateError('lock_invalid');
	assertTimestamp(lock.startedAt);
	return /** @type {{ runId: string, command: string, pid: number, startedAt: string }} */ (lock);
}

/** @param {number} pid */
function pidIsRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return /** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH';
	}
}

/** @param {Record<string, string>} paths */
function runLockGuardPath(paths) {
	return `${paths.lockPath}.guard`;
}

/** @param {string} guardPath @param {typeof NODE_FILESYSTEM} [filesystem] */
async function readRunLockGuard(guardPath, filesystem = NODE_FILESYSTEM) {
	try {
		const entry = await filesystem.lstat(guardPath);
		if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Gate3HostedStateError('lock_guard_invalid');
		const owner = JSON.parse(await filesystem.readFile(join(guardPath, 'owner.json'), 'utf8'));
		if (!isPlainObject(owner) || owner.version !== 1 || typeof owner.guardId !== 'string' || !/^[a-f0-9-]{36}$/u.test(owner.guardId) || typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Gate3HostedStateError('lock_guard_invalid');
		return owner;
	} catch (error) {
		if (error instanceof Gate3HostedStateError) throw error;
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
		throw new Gate3HostedStateError('lock_guard_invalid');
	}
}

/** @param {string} guardPath @param {Record<string, any>} expectedOwner @param {typeof NODE_FILESYSTEM} [filesystem] */
async function retireRunLockGuard(guardPath, expectedOwner, filesystem = NODE_FILESYSTEM) {
	const owner = await readRunLockGuard(guardPath, filesystem);
	if (owner === null || owner.guardId !== expectedOwner.guardId || owner.pid !== expectedOwner.pid) return false;
	try {
		await filesystem.rename(guardPath, `${guardPath}.retired-${owner.guardId}`);
		return true;
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT' || /** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST') return false;
		throw new Gate3HostedStateError('lock_guard_failed');
	}
}

/** @param {Record<string, string>} paths @param {() => Promise<any>} operation @param {typeof NODE_FILESYSTEM} [filesystem] */
async function withRunLockGuard(paths, operation, filesystem = NODE_FILESYSTEM) {
	const guardFilesystem = { ...NODE_FILESYSTEM, ...filesystem };
	const guardPath = runLockGuardPath(paths);
	let owner;
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const candidatePath = `${guardPath}.candidate-${randomUUID()}`;
		const candidateOwner = { version: 1, guardId: candidatePath.slice(candidatePath.lastIndexOf('-') + 1), pid: process.pid };
		try {
			candidateOwner.guardId = candidatePath.slice(`${guardPath}.candidate-`.length);
			await guardFilesystem.mkdir(candidatePath, { mode: 0o700 });
			await guardFilesystem.writeFile(join(candidatePath, 'owner.json'), JSON.stringify(candidateOwner), { mode: 0o600 });
			await guardFilesystem.rename(candidatePath, guardPath);
			owner = candidateOwner;
			break;
		} catch (error) {
			await guardFilesystem.rm(candidatePath, { recursive: true, force: true }).catch(() => {});
			if (!GUARD_PUBLICATION_CONFLICT_CODES.has(/** @type {NodeJS.ErrnoException} */ (error).code ?? '')) {
				throw new Gate3HostedStateError('lock_guard_failed');
			}
			const held = await readRunLockGuard(guardPath, guardFilesystem);
			if (held === null) continue;
			if (typeof held.pid !== 'number') throw new Gate3HostedStateError('lock_guard_invalid');
			if (pidIsRunning(held.pid)) await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
			else await retireRunLockGuard(guardPath, held, guardFilesystem);
		}
	}
	if (!owner) throw new Gate3HostedStateError('lock_guard_held');
	try {
		return await operation();
	} finally {
		if (!(await retireRunLockGuard(guardPath, owner, guardFilesystem))) throw new Gate3HostedStateError('lock_guard_failed');
	}
}

/** @param {string} lockPath */
async function readRunLockBytes(lockPath) {
	try {
		const entry = await lstat(lockPath);
		if (!entry.isFile() || entry.isSymbolicLink()) throw new Gate3HostedStateError('lock_invalid');
		return await readFile(lockPath, 'utf8');
	} catch (error) {
		if (error instanceof Gate3HostedStateError) throw error;
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
		throw new Gate3HostedStateError('lock_unavailable');
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

/** @param {Record<string, string>} paths @param {unknown} state @param {{ filesystem?: typeof NODE_FILESYSTEM }} [options] */
export async function reserveRunState(paths, state, { filesystem = NODE_FILESYSTEM } = {}) {
	const exactPaths = validatePaths(paths);
	assertStateMatchesPaths(exactPaths, state);
	await assertSafeRunPaths(exactPaths, { createRunDirectory: true, filesystem });
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
	if (validCurrentState.archive?.status === 'complete') throw new Gate3HostedStateError('archive_terminal');
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

/** @param {{ paths: Record<string, string>, command: string, pid?: number, startedAt?: string, filesystem?: Partial<typeof NODE_FILESYSTEM>, guardFilesystem?: Partial<typeof NODE_FILESYSTEM> }} options */
export async function acquireRunLock({ paths, command, pid = process.pid, startedAt = new Date().toISOString(), filesystem = {}, guardFilesystem = {} }) {
	const exactPaths = validatePaths(paths);
	if (typeof command !== 'string' || !RUN_LOCK_COMMANDS.has(command)) {
		throw new Gate3HostedStateError('lock_command_invalid');
	}
	const lock = validateRunLock(exactPaths, { runId: exactPaths.runId, command, pid, startedAt });
	await assertSafeRunPaths(exactPaths);
	const acquiredBytes = `${JSON.stringify(lock)}\n`;
	const mainLockFilesystem = { ...NODE_FILESYSTEM, ...filesystem };
	await withRunLockGuard(exactPaths, async () => {
		let handle;
		let created = false;
		try {
			handle = await mainLockFilesystem.open(exactPaths.lockPath, 'wx', 0o600);
			created = true;
			await handle.writeFile(acquiredBytes, 'utf8');
			await handle.sync();
		} catch (error) {
			try { await handle?.close(); } catch {}
			handle = undefined;
			if (created) {
				try { await mainLockFilesystem.unlink(exactPaths.lockPath); } catch { throw new Gate3HostedStateError('lock_cleanup_failed'); }
			}
			if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST') throw new Gate3HostedStateError('lock_held');
			throw new Gate3HostedStateError('lock_acquire_failed');
		} finally {
			try { await handle?.close(); } catch { throw new Gate3HostedStateError('lock_acquire_failed'); }
		}
	}, /** @type {typeof NODE_FILESYSTEM} */ ({ ...NODE_FILESYSTEM, ...guardFilesystem }));
	return Object.freeze({ lock: Object.freeze(lock), acquiredBytes });
}

/** @param {{ paths: Record<string, string>, isPidRunning?: (pid: number) => boolean }} options */
export async function inspectRunLock({ paths, isPidRunning = pidIsRunning }) {
	const exactPaths = validatePaths(paths);
	await assertSafeRunPaths(exactPaths);
	const acquiredBytes = await readRunLockBytes(exactPaths.lockPath);
	if (acquiredBytes === null) return Object.freeze({ status: 'missing' });
	let lock;
	try {
		lock = validateRunLock(exactPaths, JSON.parse(acquiredBytes));
	} catch (error) {
		if (error instanceof Gate3HostedStateError) return Object.freeze({ status: 'invalid', acquiredBytes });
		return Object.freeze({ status: 'invalid', acquiredBytes });
	}
	return Object.freeze({ status: isPidRunning(lock.pid) ? 'held' : 'stale', lock: Object.freeze(lock), acquiredBytes });
}

/** @param {{ paths: Record<string, string>, acquiredLock: { acquiredBytes: string } }} options */
export async function releaseRunLock({ paths, acquiredLock }) {
	const exactPaths = validatePaths(paths);
	if (!isPlainObject(acquiredLock) || typeof acquiredLock.acquiredBytes !== 'string') {
		throw new Gate3HostedStateError('lock_invalid');
	}
	await assertSafeRunPaths(exactPaths);
	return withRunLockGuard(exactPaths, async () => {
		const currentBytes = await readRunLockBytes(exactPaths.lockPath);
		if (currentBytes === null || currentBytes !== acquiredLock.acquiredBytes) return false;
		try { await unlink(exactPaths.lockPath); return true; } catch (error) {
			if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return false;
			throw new Gate3HostedStateError('lock_release_failed');
		}
	});
}

/** @param {{ paths: Record<string, string>, observedLock: unknown, inspection: unknown, isPidRunning?: (pid: number) => boolean }} options */
export async function recoverStaleRunLock({ paths, observedLock, inspection, isPidRunning = pidIsRunning }) {
	const exactPaths = validatePaths(paths);
	if (
		!isPlainObject(observedLock) ||
		observedLock.status !== 'stale' ||
		!isPlainObject(inspection) ||
		inspection.status !== 'stale' ||
		inspection === observedLock ||
		typeof observedLock.acquiredBytes !== 'string' ||
		inspection.acquiredBytes !== observedLock.acquiredBytes
	) {
		throw new Gate3HostedStateError('fresh_inspection_required');
	}
	return withRunLockGuard(exactPaths, async () => {
		const freshInspection = await inspectRunLock({ paths: exactPaths, isPidRunning });
		if (freshInspection.status !== 'stale' || freshInspection.acquiredBytes !== inspection.acquiredBytes || freshInspection.acquiredBytes !== observedLock.acquiredBytes) {
			throw new Gate3HostedStateError('fresh_inspection_required');
		}
		try { await unlink(exactPaths.lockPath); return true; } catch (error) {
			if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') throw new Gate3HostedStateError('fresh_inspection_required');
			throw new Gate3HostedStateError('lock_recovery_failed');
		}
	});
}

/** @param {Record<string, string>} paths */
export async function readArchivedRunState(paths) {
	const exactPaths = validatePaths(paths);
	await assertSafeArchivePaths(exactPaths);
	const archiveStatePath = join(exactPaths.archiveDirectory, 'gate3-run-state.json');
	await assertRegularFile(archiveStatePath);
	try {
		const state = assertStateMatchesPaths(exactPaths, JSON.parse(await readFile(archiveStatePath, 'utf8')));
		if (state.archive?.status !== 'complete' && state.archive?.status !== 'pending') throw new Gate3HostedStateError('state_invalid');
		if (state.archive.destination !== exactPaths.archiveDirectory) throw new Gate3HostedStateError('state_invalid');
		return state;
	} catch (error) {
		if (error instanceof Gate3HostedStateError) throw error;
		throw new Gate3HostedStateError('state_invalid');
	}
}

/** @param {Record<string, string>} paths @param {Record<string, any>} currentState @param {Record<string, any>} nextState */
async function writeArchivedRunState(paths, currentState, nextState) {
	const current = assertStateMatchesPaths(paths, currentState);
	const next = assertStateMatchesPaths(paths, nextState);
	if (next.revision !== current.revision + 1) throw new Gate3HostedStateError('revision_invalid');
	if (next.archive?.status !== 'complete' || current.archive?.status !== 'pending') {
		throw new Gate3HostedStateError('archive_invalid');
	}
	const archiveStatePath = join(paths.archiveDirectory, 'gate3-run-state.json');
	try {
		await atomicPrivateWrite(archiveStatePath, `${JSON.stringify(next)}\n`, {
			verify: (replacementBytes) => {
				if (replacementBytes !== `${JSON.stringify(next)}\n`) throw new Gate3HostedStateError('state_invalid');
				assertStateMatchesPaths(paths, JSON.parse(replacementBytes));
			}
		});
	} catch (error) {
		if (error instanceof Gate3HostedStateError) throw error;
		throw new Gate3HostedStateError('state_write_failed');
	}
}

/** @param {{ paths: Record<string, string>, currentState: unknown, completedAt: string, filesystem?: Partial<typeof NODE_FILESYSTEM> }} options */
export async function finalizeRunArchive({ paths, currentState, completedAt, filesystem = {} }) {
	const exactPaths = validatePaths(paths);
	const archiveFilesystem = { ...NODE_FILESYSTEM, ...filesystem };
	if (typeof completedAt !== 'string' || Number.isNaN(Date.parse(completedAt))) {
		throw new Gate3HostedStateError('archive_invalid');
	}
	await assertRealDirectory(exactPaths.root, archiveFilesystem);
	if (await directoryIsMissing(exactPaths.archiveRoot, archiveFilesystem)) {
		await archiveFilesystem.mkdir(exactPaths.archiveRoot, { recursive: false, mode: 0o700 });
	}
	await assertRealDirectory(exactPaths.archiveRoot, archiveFilesystem);
	const activeMissing = await directoryIsMissing(exactPaths.runDirectory, archiveFilesystem);
	const archiveMissing = await directoryIsMissing(exactPaths.archiveDirectory, archiveFilesystem);
	if (!archiveMissing) await assertRealDirectory(exactPaths.archiveDirectory, archiveFilesystem);
	if (!activeMissing && !archiveMissing) throw new Gate3HostedStateError('archive_destination_exists');

	if (activeMissing) {
		if (archiveMissing) throw new Gate3HostedStateError('state_unavailable');
		const archived = await readArchivedRunState(exactPaths);
		if (!(await regularFileIsMissing(join(exactPaths.archiveDirectory, 'gate3-secrets.dpapi'), archiveFilesystem))) {
			throw new Gate3HostedStateError('secret_file_present');
		}
		if (archived.archive.status === 'complete') {
			if ((await readActiveRun(exactPaths.root)) === exactPaths.runId) {
				try { await clearActiveRun({ root: exactPaths.root, runId: exactPaths.runId }); } catch (error) {
					if (!(error instanceof Gate3HostedStateError) || error.reasonCode !== 'active_run_changed') throw error;
				}
			}
			return archived;
		}
		const complete = {
			...archived,
			revision: archived.revision + 1,
			archive: { ...archived.archive, status: 'complete', completedAt }
		};
		await writeArchivedRunState(exactPaths, archived, complete);
		if ((await readActiveRun(exactPaths.root)) === exactPaths.runId) {
			try {
				await clearActiveRun({ root: exactPaths.root, runId: exactPaths.runId });
			} catch (error) {
				if (!(error instanceof Gate3HostedStateError) || error.reasonCode !== 'active_run_changed') throw error;
			}
		}
		return complete;
	}

	const persisted = await readRunState(exactPaths);
	const sourceIdentity = await captureDirectoryIdentity(exactPaths.runDirectory, archiveFilesystem);
	const archiveRootIdentity = await captureDirectoryIdentity(exactPaths.archiveRoot, archiveFilesystem);
	const expected = assertStateMatchesPaths(exactPaths, currentState);
	if (JSON.stringify(persisted) !== JSON.stringify(expected)) throw new Gate3HostedStateError('state_changed');
	if (
		persisted.phases.cleanup.status !== 'complete' ||
		persisted.lastInspection?.cleanupVerified !== true ||
		persisted.lastInspection?.independentZeroVerified !== true
	) {
		throw new Gate3HostedStateError('cleanup_not_independently_verified');
	}
	if (!(await regularFileIsMissing(exactPaths.secretPath, archiveFilesystem))) throw new Gate3HostedStateError('secret_file_present');
	let pending = persisted;
	if (pending.archive === null) {
		pending = {
			...persisted,
			revision: persisted.revision + 1,
			archive: {
				status: 'pending',
				destination: exactPaths.archiveDirectory,
				requestedAt: completedAt,
				completedAt: null,
				manifestSha256: persisted.manifest.sha256
			}
		};
		await writeNextRunState(exactPaths, persisted, pending);
	} else if (pending.archive.status !== 'pending' || pending.archive.destination !== exactPaths.archiveDirectory) {
		throw new Gate3HostedStateError('archive_invalid');
	}
	try {
		if (!sameDirectoryIdentity(sourceIdentity, await captureDirectoryIdentity(exactPaths.runDirectory, archiveFilesystem)) || !sameDirectoryIdentity(archiveRootIdentity, await captureDirectoryIdentity(exactPaths.archiveRoot, archiveFilesystem))) {
			throw new Gate3HostedStateError('archive_ambiguous');
		}
		await archiveFilesystem.rename(exactPaths.runDirectory, exactPaths.archiveDirectory);
		const destinationIdentity = await captureDirectoryIdentity(exactPaths.archiveDirectory, archiveFilesystem);
		if (!(await directoryIsMissing(exactPaths.runDirectory, archiveFilesystem)) || !sameDirectoryIdentity(archiveRootIdentity, await captureDirectoryIdentity(exactPaths.archiveRoot, archiveFilesystem)) || sourceIdentity.dev !== destinationIdentity.dev || sourceIdentity.ino !== destinationIdentity.ino) {
			throw new Gate3HostedStateError('archive_ambiguous');
		}
	} catch (error) {
		if (error instanceof Gate3HostedStateError) throw error;
		throw new Gate3HostedStateError('archive_rename_failed');
	}
	return finalizeRunArchive({ paths: exactPaths, currentState: pending, completedAt });
}

/** @param {string} root @param {{ filesystem?: typeof NODE_FILESYSTEM }} [options] */
export async function readActiveRun(root, { filesystem = NODE_FILESYSTEM } = {}) {
	if (typeof root !== 'string' || !isAbsolute(root)) throw new Gate3HostedStateError('root_invalid');
	await assertRealDirectory(root, filesystem);
	const pointerPath = join(root, 'active-run.json');
	try {
		const entry = await filesystem.lstat(pointerPath);
		if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('unsafe pointer');
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
		throw new Gate3HostedStateError('active_pointer_invalid');
	}
	try {
		const pointer = JSON.parse(await filesystem.readFile(pointerPath, 'utf8'));
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

/** @param {string} root @param {() => Promise<string | null | void>} operation @param {typeof NODE_FILESYSTEM} [filesystem] */
async function withActivePointerLock(root, operation, filesystem = NODE_FILESYSTEM) {
	const lockPath = join(root, '.active-run.lock');
	let handle;
	let acquired = false;
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			handle = await filesystem.open(lockPath, 'wx', 0o600);
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
			await filesystem.unlink(lockPath);
		} catch {
			throw new Gate3HostedStateError('active_pointer_lock_failed');
		}
	}
}

/** @param {{ root: string, runId: string, expectedCurrentRunId: string | null, filesystem?: typeof NODE_FILESYSTEM }} options */
export async function setActiveRun({ root, runId, expectedCurrentRunId, filesystem = NODE_FILESYSTEM }) {
	const paths = resolveGate3RunPaths({ root, runId });
	if (expectedCurrentRunId !== null && (typeof expectedCurrentRunId !== 'string' || !RUN_ID_PATTERN.test(expectedCurrentRunId))) {
		throw new Gate3HostedStateError('active_pointer_invalid');
	}
	await assertSafeRunPaths(paths, { filesystem });
	return withActivePointerLock(root, async () => {
		const currentRunId = await readActiveRun(root, { filesystem });
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
	}, filesystem);
}

/** @param {{ root: string, runId: string, filesystem?: typeof NODE_FILESYSTEM }} options */
export async function clearActiveRun({ root, runId, filesystem = NODE_FILESYSTEM }) {
	const paths = resolveGate3RunPaths({ root, runId });
	await assertRealDirectory(paths.root, filesystem);
	return withActivePointerLock(root, async () => {
		if ((await readActiveRun(root, { filesystem })) !== runId) throw new Gate3HostedStateError('active_run_changed');
		try {
			await filesystem.unlink(join(root, 'active-run.json'));
		} catch {
			throw new Gate3HostedStateError('active_pointer_write_failed');
		}
	}, filesystem);
}
