import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

/** @typedef {'reporter' | 'cross-user' | 'assigned-moderator' | 'unassigned-moderator'} ActorRole */
/** @typedef {Readonly<{ role: ActorRole, email: string, username: string, password: string, totpSecret?: string | null }>} RunSecretActor */
/** @typedef {Readonly<{ schemaVersion: 1, runId: string, identitySchemeVersion: 1, actors: Readonly<Record<ActorRole, RunSecretActor>> }>} RunSecretPayload */
/** @typedef {{ stdin: import('node:stream').Writable, stdout: import('node:stream').Readable, stderr: import('node:stream').Readable, on: (event: string, listener: (...args: any[]) => void) => unknown, kill?: () => unknown }} SpawnedDpapiProcess */
/** @typedef {(command: string, args: string[], options: Record<string, unknown>) => SpawnedDpapiProcess} SpawnImpl */

const RUN_ID_PATTERN = /^gate3-\d{8}-[a-f0-9]{8}$/u;
const PASSWORD_PATTERN = /^G3![A-Za-z0-9_-]{43}$/u;
const TOTP_SECRET_PATTERN = /^[A-Z2-7]{16,256}$/u;
/** @type {Readonly<Record<ActorRole, string>>} */
const ROLE_TOKENS = Object.freeze({
	reporter: 'rep',
	'cross-user': 'cross',
	'assigned-moderator': 'mod-a',
	'unassigned-moderator': 'mod-u'
});
/** @type {readonly ActorRole[]} */
const ACTOR_ROLES = Object.freeze(/** @type {ActorRole[]} */ (Object.keys(ROLE_TOKENS)));
const MODERATOR_ROLES = new Set(['assigned-moderator', 'unassigned-moderator']);
const SECRET_FILE_NAME = 'gate3-secrets.dpapi';
const MAX_PLAINTEXT_BYTES = 64 * 1024;
const MAX_CIPHERTEXT_BYTES = 256 * 1024;
const NODE_FILESYSTEM = Object.freeze({ chmod, lstat, open, readFile, realpath, rename, unlink });

export const GATE3_SECRET_SCHEMA_VERSION = 1;
export const GATE3_IDENTITY_SCHEME_VERSION = 1;

export class Gate3HostedSecretsError extends Error {
	/** @param {string} reasonCode */
	constructor(reasonCode) {
		super(reasonCode);
		this.name = 'Gate3HostedSecretsError';
		this.reasonCode = reasonCode;
	}
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, any>} value @param {readonly string[]} keys @param {string} reasonCode */
function assertExactKeys(value, keys, reasonCode) {
	const actual = Object.keys(value);
	if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
		throw new Gate3HostedSecretsError(reasonCode);
	}
}

/** @param {unknown} runId */
function assertRunId(runId) {
	if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
		throw new Gate3HostedSecretsError('identity_invalid');
	}
}

/**
 * @param {{ runId: unknown, role: unknown, identitySchemeVersion: unknown }} options
 */
export function deriveSyntheticIdentity({ runId, role, identitySchemeVersion }) {
	assertRunId(runId);
	if (
		identitySchemeVersion !== GATE3_IDENTITY_SCHEME_VERSION ||
		typeof role !== 'string' ||
		!Object.hasOwn(ROLE_TOKENS, role)
	) {
		throw new Gate3HostedSecretsError('identity_invalid');
	}
	const exactRole = /** @type {ActorRole} */ (role);
	const token = ROLE_TOKENS[exactRole];
	const digest = createHash('sha256')
		.update(`gate3-identity-v1\0${runId}\0${exactRole}`, 'utf8')
		.digest('hex')
		.slice(0, 16);
	return Object.freeze({
		role: exactRole,
		email: `gate3-v1-${token}-${digest}@example.invalid`,
		username: `g3_v1_${token.replaceAll('-', '_')}_${digest}`
	});
}

/** @param {unknown} randomValue */
function passwordFromRandomBytes(randomValue) {
	if (!(randomValue instanceof Uint8Array) || randomValue.byteLength !== 32) {
		throw new Gate3HostedSecretsError('random_bytes_invalid');
	}
	const bytes = Buffer.from(randomValue);
	try {
		return `G3!${bytes.toString('base64url')}`;
	} finally {
		bytes.fill(0);
		if (typeof randomValue.fill === 'function') randomValue.fill(0);
	}
}

/**
 * @param {{ runId: unknown, randomBytesImpl?: (size: number) => Uint8Array }} options
 * @returns {RunSecretPayload}
 */
export function createRunSecretPayload({ runId, randomBytesImpl = randomBytes }) {
	assertRunId(runId);
	const exactRunId = /** @type {string} */ (runId);
	if (typeof randomBytesImpl !== 'function') {
		throw new Gate3HostedSecretsError('random_bytes_invalid');
	}
	/** @type {Partial<Record<ActorRole, RunSecretActor>>} */
	const actors = {};
	for (const role of ACTOR_ROLES) {
		const identity = deriveSyntheticIdentity({
			runId: exactRunId,
			role,
			identitySchemeVersion: GATE3_IDENTITY_SCHEME_VERSION
		});
		let password;
		try {
			password = passwordFromRandomBytes(randomBytesImpl(32));
		} catch (error) {
			if (error instanceof Gate3HostedSecretsError) throw error;
			throw new Gate3HostedSecretsError('random_bytes_invalid');
		}
		actors[role] = Object.freeze({
			...identity,
			password,
			...(MODERATOR_ROLES.has(role) ? { totpSecret: null } : {})
		});
	}
	return Object.freeze({
		schemaVersion: GATE3_SECRET_SCHEMA_VERSION,
		runId: exactRunId,
		identitySchemeVersion: GATE3_IDENTITY_SCHEME_VERSION,
		actors: Object.freeze(/** @type {Record<ActorRole, RunSecretActor>} */ (actors))
	});
}

/** @param {unknown} candidate @param {string | undefined} [expectedRunId] @returns {RunSecretPayload} */
function validateRunSecretPayload(candidate, expectedRunId) {
	if (!isPlainObject(candidate)) throw new Gate3HostedSecretsError('secret_payload_invalid');
	assertExactKeys(
		candidate,
		['schemaVersion', 'runId', 'identitySchemeVersion', 'actors'],
		'secret_payload_invalid'
	);
	if (
		candidate.schemaVersion !== GATE3_SECRET_SCHEMA_VERSION ||
		candidate.identitySchemeVersion !== GATE3_IDENTITY_SCHEME_VERSION ||
		typeof candidate.runId !== 'string' ||
		!RUN_ID_PATTERN.test(candidate.runId) ||
		(expectedRunId !== undefined && candidate.runId !== expectedRunId) ||
		!isPlainObject(candidate.actors)
	) {
		throw new Gate3HostedSecretsError('secret_payload_invalid');
	}
	assertExactKeys(candidate.actors, ACTOR_ROLES, 'secret_payload_invalid');
	/** @type {Partial<Record<ActorRole, RunSecretActor>>} */
	const actors = {};
	for (const role of ACTOR_ROLES) {
		const actor = candidate.actors[role];
		if (!isPlainObject(actor)) throw new Gate3HostedSecretsError('secret_payload_invalid');
		const actorKeys = MODERATOR_ROLES.has(role)
			? ['role', 'email', 'username', 'password', 'totpSecret']
			: ['role', 'email', 'username', 'password'];
		assertExactKeys(actor, actorKeys, 'secret_payload_invalid');
		const identity = deriveSyntheticIdentity({
			runId: candidate.runId,
			role,
			identitySchemeVersion: candidate.identitySchemeVersion
		});
		if (
			actor.role !== role ||
			actor.email !== identity.email ||
			actor.username !== identity.username ||
			typeof actor.password !== 'string' ||
			!PASSWORD_PATTERN.test(actor.password) ||
			(MODERATOR_ROLES.has(role) &&
				actor.totpSecret !== null &&
				(typeof actor.totpSecret !== 'string' || !TOTP_SECRET_PATTERN.test(actor.totpSecret)))
		) {
			throw new Gate3HostedSecretsError('secret_payload_invalid');
		}
		actors[role] = Object.freeze(/** @type {RunSecretActor} */ ({ ...actor }));
	}
	return Object.freeze({
		schemaVersion: candidate.schemaVersion,
		runId: candidate.runId,
		identitySchemeVersion: candidate.identitySchemeVersion,
		actors: Object.freeze(/** @type {Record<ActorRole, RunSecretActor>} */ (actors))
	});
}

/**
 * Records a TOTP seed returned by Supabase Auth enrollment. This function never
 * generates a seed and accepts only the provider's canonical uppercase base32 form.
 *
 * @param {{ payload: unknown, role: unknown, secret: unknown }} options
 * @returns {RunSecretPayload}
 */
export function recordProviderTotpSecret({ payload, role, secret }) {
	const validPayload = validateRunSecretPayload(payload);
	if (typeof role !== 'string' || !MODERATOR_ROLES.has(role)) {
		throw new Gate3HostedSecretsError('totp_role_invalid');
	}
	if (typeof secret !== 'string' || !TOTP_SECRET_PATTERN.test(secret)) {
		throw new Gate3HostedSecretsError('totp_secret_invalid');
	}
	const moderatorRole = /** @type {ActorRole} */ (role);
	return Object.freeze({
		...validPayload,
		actors: Object.freeze({
			...validPayload.actors,
			[moderatorRole]: Object.freeze({
				...validPayload.actors[moderatorRole],
				totpSecret: secret
			})
		})
	});
}

/** @param {unknown} input @param {number} maximum @param {string} reasonCode */
function exactBoundedBuffer(input, maximum, reasonCode) {
	if (!(input instanceof Uint8Array) || input.byteLength === 0 || input.byteLength > maximum) {
		throw new Gate3HostedSecretsError(reasonCode);
	}
	return Buffer.from(input);
}

/**
 * @param {{ scriptPath: string, spawnImpl?: SpawnImpl, onSettle?: () => void }} options
 * @returns {Readonly<{ protect: (input: Uint8Array) => Promise<Buffer>, unprotect: (input: Uint8Array) => Promise<Buffer> }>}
 */
export function createPowerShellDpapi({ scriptPath, spawnImpl = /** @type {SpawnImpl} */ (spawn), onSettle = () => {} }) {
	if (
		typeof scriptPath !== 'string' ||
		!isAbsolute(scriptPath) ||
		basename(scriptPath).toLowerCase() !== 'gate3-dpapi.ps1' ||
		typeof spawnImpl !== 'function'
	) {
		throw new Gate3HostedSecretsError('dpapi_configuration_invalid');
	}

	/** @param {'protect' | 'unprotect'} operation @param {Uint8Array} input */
	async function invoke(operation, input) {
		const outputLimit = operation === 'protect' ? MAX_CIPHERTEXT_BYTES : MAX_PLAINTEXT_BYTES;
		const inputBytes = exactBoundedBuffer(
			input,
			operation === 'protect' ? MAX_PLAINTEXT_BYTES : MAX_CIPHERTEXT_BYTES,
			'dpapi_input_invalid'
		);
		return await new Promise((resolvePromise, rejectPromise) => {
			/** @type {SpawnedDpapiProcess | undefined} */
			let child;
			let settled = false;
			let outputSize = 0;
			/** @type {string | null} */
			let failureReason = null;
			/** @type {Buffer[]} */
			const outputChunks = [];

			/** @param {string} reasonCode */
			const rejectSanitized = (reasonCode) => {
				if (settled) return;
				settled = true;
				try { onSettle(); } catch { /* Test observation cannot affect settlement. */ }
				inputBytes.fill(0);
				for (const chunk of outputChunks) chunk.fill(0);
				rejectPromise(new Gate3HostedSecretsError(reasonCode));
			};
			/** @param {string} reasonCode */
			const fail = (reasonCode) => {
				failureReason = reasonCode;
				child?.stdin?.destroy?.(); child?.stdout?.destroy?.(); child?.stderr?.destroy?.(); child?.kill?.();
				rejectSanitized(reasonCode);
			};

			try {
				child = spawnImpl(
					'powershell.exe',
					['-NoLogo', '-NoProfile', '-NonInteractive', '-File', scriptPath, operation],
					{ stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
				);
			} catch {
				rejectSanitized('dpapi_unavailable');
				return;
			}

			if (!child?.stdin || !child.stdout || !child.stderr) {
				rejectSanitized('dpapi_unavailable');
				return;
			}
			child.stdout.on('data', (chunk) => {
				const bytes = Buffer.from(chunk);
				chunk?.fill?.(0);
				if (settled || failureReason) { bytes.fill(0); return; }
				outputSize += bytes.length;
				if (outputSize > outputLimit) {
					bytes.fill(0);
					fail('dpapi_output_too_large');
					return;
				}
				outputChunks.push(bytes);
			});
			// Drain stderr so the helper cannot block, but never retain or echo it.
			child.stderr.on('data', (chunk) => chunk?.fill?.(0));
			child.stdout.on('error', () => fail('dpapi_failed'));
			child.stderr.on('error', () => fail('dpapi_failed'));
			child.on('error', () => fail('dpapi_unavailable'));
			child.stdin.on('error', () => fail('dpapi_failed'));
			child.on('close', (exitCode) => {
				if (settled) return;
				inputBytes.fill(0);
				if (failureReason || exitCode !== 0 || outputSize === 0) {
					rejectSanitized(failureReason ?? 'dpapi_failed');
					return;
				}
				const output = Buffer.concat(outputChunks, outputSize);
				for (const chunk of outputChunks) chunk.fill(0);
				settled = true;
				try { onSettle(); } catch { /* Test observation cannot affect settlement. */ }
				resolvePromise(output);
			});
			try { child.stdin.end(inputBytes); } catch { fail('dpapi_failed'); }
		});
	}

	return Object.freeze({
		protect: /** @param {Uint8Array} input */ (input) => invoke('protect', input),
		unprotect: /** @param {Uint8Array} input */ (input) => invoke('unprotect', input)
	});
}

/** @param {string} filePath @param {string | undefined} [expectedRunId] */
async function assertExactSecretPath(filePath, expectedRunId, filesystem = NODE_FILESYSTEM) {
	if (
		typeof filePath !== 'string' ||
		!isAbsolute(filePath) ||
		basename(filePath) !== SECRET_FILE_NAME ||
		!RUN_ID_PATTERN.test(basename(dirname(filePath))) ||
		basename(dirname(dirname(filePath))) !== 'active' ||
		(expectedRunId !== undefined && basename(dirname(filePath)) !== expectedRunId)
	) {
		throw new Gate3HostedSecretsError('secret_path_invalid');
	}
	try {
		const parent = dirname(filePath);
		const active = dirname(parent);
		const activeEntry = await filesystem.lstat(active);
		if (!activeEntry.isDirectory() || activeEntry.isSymbolicLink()) throw new Error('unsafe active');
		const parentEntry = await filesystem.lstat(parent);
		if (!parentEntry.isDirectory() || parentEntry.isSymbolicLink()) throw new Error('unsafe parent');
		const exactParent = await filesystem.realpath(parent);
		const sameParent =
			process.platform === 'win32'
				? exactParent.toLowerCase() === resolve(parent).toLowerCase()
				: exactParent === resolve(parent);
		if (!sameParent) throw new Error('reparse parent');
		try {
			const entry = await filesystem.lstat(filePath);
			if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('unsafe file');
		} catch (error) {
			if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
		}
	} catch (error) {
		if (error instanceof Gate3HostedSecretsError) throw error;
		throw new Gate3HostedSecretsError('secret_path_invalid');
	}
	return resolve(filePath);
}

/** @param {string} filePath */
async function readBoundedCiphertext(filePath, filesystem = NODE_FILESYSTEM) {
	try {
		const entry = await filesystem.lstat(filePath);
		if (
			!entry.isFile() ||
			entry.isSymbolicLink() ||
			entry.size <= 0 ||
			entry.size > MAX_CIPHERTEXT_BYTES
		) {
			throw new Gate3HostedSecretsError('secret_store_invalid');
		}
		const bytes = await filesystem.readFile(filePath);
		if (bytes.length === 0 || bytes.length > MAX_CIPHERTEXT_BYTES) {
			bytes.fill(0);
			throw new Gate3HostedSecretsError('secret_store_invalid');
		}
		return bytes;
	} catch (error) {
		if (error instanceof Gate3HostedSecretsError) throw error;
		throw new Gate3HostedSecretsError('secret_store_unavailable');
	}
}

/** @param {string} filePath @param {Buffer} ciphertext */
async function atomicCiphertextWrite(filePath, ciphertext, filesystem = NODE_FILESYSTEM) {
	const temporaryPath = resolve(
		dirname(filePath),
		`.${SECRET_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`
	);
	let handle;
	try {
		handle = await filesystem.open(temporaryPath, 'wx', 0o600);
		await handle.writeFile(ciphertext);
		await handle.sync();
		await handle.close();
		handle = undefined;
		await filesystem.chmod(temporaryPath, 0o600);
		const verified = await readBoundedCiphertext(temporaryPath, filesystem);
		try {
			if (!verified.equals(ciphertext)) throw new Error('replacement mismatch');
		} finally {
			verified.fill(0);
		}
		await filesystem.rename(temporaryPath, filePath);
	} catch {
		try {
			await handle?.close();
		} catch {
			// Only the sanitized store-write error crosses this boundary.
		}
		try {
			await filesystem.unlink(temporaryPath);
		} catch {
			// The replacement may already have been renamed or never created.
		}
		throw new Gate3HostedSecretsError('secret_store_write_failed');
	}
}

/**
 * @param {{ payload: unknown, path: string, dpapi: { protect: (input: Buffer) => Promise<Uint8Array> }, filesystem?: typeof NODE_FILESYSTEM, hashImpl?: (input: Buffer) => string, onMetadataPrepared?: (value: Readonly<{ status: 'available', ciphertextSha256: string }>) => unknown }} options
 */
export async function protectRunSecrets({ payload, path, dpapi, filesystem = NODE_FILESYSTEM, hashImpl = (input) => createHash('sha256').update(input).digest('hex'), onMetadataPrepared }) {
	const validPayload = validateRunSecretPayload(payload);
	const exactPath = await assertExactSecretPath(path, validPayload.runId, filesystem);
	if (!dpapi || typeof dpapi.protect !== 'function') {
		throw new Gate3HostedSecretsError('dpapi_configuration_invalid');
	}
	const plaintext = Buffer.from(JSON.stringify(validPayload), 'utf8');
	let protectedBytes;
	let ciphertext;
	try {
		protectedBytes = await dpapi.protect(plaintext);
		ciphertext = exactBoundedBuffer(
			protectedBytes,
			MAX_CIPHERTEXT_BYTES,
			'dpapi_output_too_large'
		);
		const ciphertextSha256 = hashImpl(ciphertext);
		if (!/^[a-f0-9]{64}$/u.test(ciphertextSha256)) throw new Gate3HostedSecretsError('secret_store_write_failed');
		const metadata = Object.freeze({ status: /** @type {const} */ ('available'), ciphertextSha256 });
		try { onMetadataPrepared?.(metadata); } catch { /* Test observation cannot affect persistence. */ }
		await atomicCiphertextWrite(exactPath, ciphertext, filesystem);
		return metadata;
	} catch (error) {
		if (error instanceof Gate3HostedSecretsError) throw error;
		throw new Gate3HostedSecretsError('dpapi_failed');
	} finally {
		plaintext.fill(0);
		protectedBytes?.fill?.(0);
		ciphertext?.fill(0);
	}
}

/**
 * @param {{ runId: string, path: string, dpapi: { unprotect: (input: Buffer) => Promise<Uint8Array> } }} options
 */
export async function unprotectRunSecrets({ runId, path, dpapi }) {
	assertRunId(runId);
	const exactPath = await assertExactSecretPath(path, runId);
	if (!dpapi || typeof dpapi.unprotect !== 'function') {
		throw new Gate3HostedSecretsError('dpapi_configuration_invalid');
	}
	const ciphertext = await readBoundedCiphertext(exactPath);
	let unprotectedBytes;
	let plaintext;
	try {
		unprotectedBytes = await dpapi.unprotect(ciphertext);
		plaintext = exactBoundedBuffer(
			unprotectedBytes,
			MAX_PLAINTEXT_BYTES,
			'dpapi_output_too_large'
		);
		let parsed;
		try {
			parsed = JSON.parse(plaintext.toString('utf8'));
		} catch {
			throw new Gate3HostedSecretsError('secret_payload_invalid');
		}
		return validateRunSecretPayload(parsed, runId);
	} catch (error) {
		if (error instanceof Gate3HostedSecretsError) throw error;
		throw new Gate3HostedSecretsError('dpapi_failed');
	} finally {
		ciphertext.fill(0);
		unprotectedBytes?.fill?.(0);
		plaintext?.fill(0);
	}
}

/** @param {string} path */
export async function destroyRunSecretStore(path) {
	const exactPath = await assertExactSecretPath(path);
	let ciphertext;
	try {
		try {
			ciphertext = await readBoundedCiphertext(exactPath);
		} catch (error) {
			if (
				error instanceof Gate3HostedSecretsError &&
				error.reasonCode === 'secret_store_unavailable'
			) {
				try {
					await lstat(exactPath);
				} catch (missingError) {
					if (/** @type {NodeJS.ErrnoException} */ (missingError).code === 'ENOENT') {
						return Object.freeze({
							status: 'destroyed-after-cleanup',
							ciphertextSha256: null
						});
					}
				}
			}
			throw error;
		}
		const ciphertextSha256 = createHash('sha256').update(ciphertext).digest('hex');
		await unlink(exactPath);
		try {
			await lstat(exactPath);
			throw new Gate3HostedSecretsError('secret_store_destroy_failed');
		} catch (error) {
			if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
		}
		return Object.freeze({ status: 'destroyed-after-cleanup', ciphertextSha256 });
	} catch (error) {
		if (error instanceof Gate3HostedSecretsError) throw error;
		throw new Gate3HostedSecretsError('secret_store_destroy_failed');
	} finally {
		ciphertext?.fill(0);
	}
}
