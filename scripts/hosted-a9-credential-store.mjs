import { createHash, randomBytes } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import {
	atomicPrivateWrite,
	reservePrivateFile,
	resolveOutsideRepositoryFile
} from './hosted-private-file.mjs';
import { decryptBuffer, deriveBackupKey, encryptBuffer } from './storage-backup-crypto.mjs';

/** @typedef {Record<string, string | undefined>} OperatorEnvironment */
/** @typedef {Readonly<{ format: string, version: number, projectRef: string, runId: string, credentialStoreId: string, status: 'active' | 'purged', credentials: Readonly<Record<string, string>> }>} CredentialState */

const FORMAT = 'perfume-marketplace-hosted-moderator-credentials';
const FORMAT_VERSION = 1;
const CIPHER = 'aes-256-gcm';
const KDF = 'scrypt-N32768-r8-p1';
const MODERATOR_ROLES = new Set([
	'assigned-moderator',
	'unassigned-moderator',
	'unassigned-admin'
]);

export class HostedA9CredentialStoreError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'HostedA9CredentialStoreError';
	}
}

/** @param {string} filePath */
export function resolveHostedCredentialStorePath(filePath) {
	try {
		return resolveOutsideRepositoryFile(filePath, { extension: '.enc' });
	} catch {
		throw new HostedA9CredentialStoreError('moderator credential store path is invalid');
	}
}

/** @param {string} filePath */
export function hostedCredentialStoreId(filePath) {
	return createHash('sha256').update(resolveHostedCredentialStorePath(filePath), 'utf8').digest('hex');
}

/** @param {OperatorEnvironment} [environment] */
export function validateHostedCredentialStoreEnvironment(environment = process.env) {
	const filePath = resolveHostedCredentialStorePath(
		environment.E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH ?? ''
	);
	const encryptionKey = environment.E2E_REAL_REPORT_EVIDENCE_TOTP_ENCRYPTION_KEY;
	if (typeof encryptionKey !== 'string' || encryptionKey.length < 32) {
		throw new HostedA9CredentialStoreError(
			'E2E_REAL_REPORT_EVIDENCE_TOTP_ENCRYPTION_KEY must contain at least 32 characters'
		);
	}
	return Object.freeze({ filePath, encryptionKey });
}

/** @param {string} role */
function exactModeratorRole(role) {
	if (!MODERATOR_ROLES.has(role)) {
		throw new HostedA9CredentialStoreError('moderator credential role is invalid');
	}
	return role;
}

/** @param {string} secret */
function exactTotpSecret(secret) {
	if (typeof secret !== 'string' || !/^[A-Z2-7]{16,256}$/u.test(secret)) {
		throw new HostedA9CredentialStoreError('moderator credential is invalid');
	}
	return secret;
}

/** @param {string} projectRef @param {string} runId */
function validateScope(projectRef, runId) {
	const canonicalGate3 =
		projectRef === 'nuhkpqjjyuygiemrxbdp' && /^gate3-[a-z0-9-]{8,64}$/u.test(runId);
	const disposableIssue24 =
		projectRef !== 'nuhkpqjjyuygiemrxbdp' &&
		/^[a-z]{20}$/u.test(projectRef) &&
		/^issue24-[a-z0-9-]{8,64}$/u.test(runId);
	if (!canonicalGate3 && !disposableIssue24) {
		throw new HostedA9CredentialStoreError('moderator credential store scope is invalid');
	}
}

/** @param {unknown} candidate @param {string} projectRef @param {string} runId @param {string} credentialStoreId */
function validatePlainState(candidate, projectRef, runId, credentialStoreId) {
	const value =
		candidate && typeof candidate === 'object'
			? /** @type {Record<string, unknown>} */ (candidate)
			: {};
	if (
		value.format !== FORMAT ||
		value.version !== FORMAT_VERSION ||
		value.projectRef !== projectRef ||
		value.runId !== runId ||
		value.credentialStoreId !== credentialStoreId ||
		!new Set(['active', 'purged']).has(String(value.status)) ||
		!value.credentials ||
		typeof value.credentials !== 'object' ||
		Array.isArray(value.credentials)
	) {
		throw new Error('invalid credential state');
	}
	const credentials = /** @type {Record<string, unknown>} */ (value.credentials);
	const roles = Object.keys(credentials);
	if (
		(value.status === 'purged' && roles.length !== 0) ||
		roles.some((role) => !MODERATOR_ROLES.has(role)) ||
		roles.some((role) => typeof credentials[role] !== 'string')
	) {
		throw new Error('invalid credential state');
	}
	return /** @type {CredentialState} */ (Object.freeze({
		format: FORMAT,
		version: FORMAT_VERSION,
		projectRef,
		runId,
		credentialStoreId,
		status: /** @type {'active' | 'purged'} */ (value.status),
		credentials: Object.freeze(
			Object.fromEntries(roles.map((role) => [role, exactTotpSecret(String(credentials[role]))]))
		)
	}));
}

/**
 * Authenticated, run-scoped moderator seed store. The encryption key remains a
 * process-only input; the file contains only a versioned AES-256-GCM envelope.
 *
 * @param {{ filePath: string, encryptionKey: string, projectRef: string, runId: string }} options
 */
export function createEncryptedModeratorCredentialStore({
	filePath,
	encryptionKey,
	projectRef,
	runId
}) {
	const exactPath = resolveHostedCredentialStorePath(filePath);
	const credentialStoreId = hostedCredentialStoreId(exactPath);
	if (typeof encryptionKey !== 'string' || encryptionKey.length < 32) {
		throw new HostedA9CredentialStoreError('moderator credential store key is invalid');
	}
	validateScope(projectRef, runId);

	/** @returns {CredentialState} */
	function emptyState() {
		return Object.freeze({
			format: FORMAT,
			version: FORMAT_VERSION,
			projectRef,
			runId,
			credentialStoreId,
			status: 'active',
			credentials: Object.freeze({})
		});
	}

	/** @param {{ allowMissing: boolean }} options @returns {Promise<CredentialState>} */
	async function readState({ allowMissing }) {
		let encoded;
		try {
			encoded = await readFile(exactPath, 'utf8');
		} catch (error) {
			if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
				if (allowMissing) return emptyState();
				throw new HostedA9CredentialStoreError('moderator credential store does not exist');
			}
			throw new HostedA9CredentialStoreError('moderator credential store is unavailable');
		}
		let plain;
		try {
			const envelope = JSON.parse(encoded);
			if (
				envelope?.format !== FORMAT ||
				envelope?.version !== FORMAT_VERSION ||
				envelope?.cipher !== CIPHER ||
				envelope?.kdf !== KDF ||
				typeof envelope?.salt !== 'string' ||
				typeof envelope?.sealed !== 'string'
			) {
				throw new Error('invalid envelope');
			}
			const salt = Buffer.from(envelope.salt, 'base64');
			const sealed = Buffer.from(envelope.sealed, 'base64');
			if (salt.length !== 32 || sealed.length < 29) throw new Error('invalid envelope');
			const key = deriveBackupKey(encryptionKey, salt);
			plain = decryptBuffer(sealed, key);
			key.fill(0);
			return validatePlainState(
				JSON.parse(plain.toString('utf8')),
				projectRef,
				runId,
				credentialStoreId
			);
		} catch {
			throw new HostedA9CredentialStoreError(
				'moderator credential store authentication failed'
			);
		} finally {
			plain?.fill(0);
		}
	}

	/** @param {CredentialState} state */
	async function writeState(state, { exclusive = false } = {}) {
		const salt = randomBytes(32);
		const key = deriveBackupKey(encryptionKey, salt);
		const plain = Buffer.from(JSON.stringify(state), 'utf8');
		try {
			const sealed = encryptBuffer(plain, key);
			try {
				const write = exclusive ? reservePrivateFile : atomicPrivateWrite;
				await write(
					exactPath,
					`${JSON.stringify({
					format: FORMAT,
					version: FORMAT_VERSION,
					cipher: CIPHER,
					kdf: KDF,
					salt: salt.toString('base64'),
					sealed: sealed.toString('base64')
					})}\n`
				);
			} catch (error) {
				if (
					exclusive &&
					error instanceof Error &&
					error.message === 'private file already exists'
				) {
					throw new HostedA9CredentialStoreError(
						'moderator credential store already exists'
					);
				}
				throw new HostedA9CredentialStoreError('moderator credential store write failed');
			}
		} finally {
			plain.fill(0);
			key.fill(0);
		}
	}

	return Object.freeze({
		credentialStoreId,
		async initializeModeratorTotpSecrets() {
			await writeState(emptyState(), { exclusive: true });
		},

		/** @param {{ role: string, secret: string }} credential */
		async storeModeratorTotpSecret(credential) {
			const role = exactModeratorRole(credential?.role);
			const secret = exactTotpSecret(credential?.secret);
			const state = await readState({ allowMissing: true });
			if (state.status !== 'active') {
				throw new HostedA9CredentialStoreError('moderator credential store was purged');
			}
			const existing = state.credentials[role];
			if (existing && existing !== secret) {
				throw new HostedA9CredentialStoreError('moderator credential already exists');
			}
			if (existing === secret) return;
			await writeState(
				Object.freeze({
					...state,
					credentials: Object.freeze({ ...state.credentials, [role]: secret })
				})
			);
		},

		/** @param {{ role: string }} credential */
		async getModeratorTotpSecret(credential) {
			const role = exactModeratorRole(credential?.role);
			const state = await readState({ allowMissing: false });
			if (state.status !== 'active') {
				throw new HostedA9CredentialStoreError('moderator credential store was purged');
			}
			const secret = state.credentials[role];
			if (!secret) {
				throw new HostedA9CredentialStoreError('moderator credential is unavailable');
			}
			return secret;
		},

		/** @param {{ role: string }} credential */
		async deleteModeratorTotpSecret(credential) {
			const role = exactModeratorRole(credential?.role);
			const state = await readState({ allowMissing: true });
			if (state.status !== 'active') {
				throw new HostedA9CredentialStoreError('moderator credential store was purged');
			}
			if (!state.credentials[role]) return;
			const credentials = Object.fromEntries(
				Object.entries(state.credentials).filter(([candidate]) => candidate !== role)
			);
			if (Object.keys(credentials).length === 0) {
				await unlink(exactPath);
				return;
			}
			await writeState(Object.freeze({ ...state, credentials: Object.freeze(credentials) }));
		},

		async purgeModeratorTotpSecrets() {
			try {
				const state = await readState({ allowMissing: false });
				if (state.status === 'purged') return;
				await writeState(
					Object.freeze({ ...state, status: 'purged', credentials: Object.freeze({}) })
				);
			} catch {
				throw new HostedA9CredentialStoreError('moderator credential store is unavailable');
			}
		},

		async finalizePurgeTombstone() {
			let state;
			try {
				state = await readState({ allowMissing: false });
			} catch (error) {
				if (
					error instanceof HostedA9CredentialStoreError &&
					error.message === 'moderator credential store does not exist'
				) return;
				throw error;
			}
			if (state.status !== 'purged' || Object.keys(state.credentials).length !== 0) {
				throw new HostedA9CredentialStoreError('moderator credential purge is incomplete');
			}
			try {
				await unlink(exactPath);
			} catch (error) {
				if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return;
				throw new HostedA9CredentialStoreError('moderator credential store is unavailable');
			}
		},

		async discardAfterVerifiedRollback() {
			let state;
			try {
				state = await readState({ allowMissing: false });
			} catch (error) {
				if (
					error instanceof HostedA9CredentialStoreError &&
					error.message === 'moderator credential store does not exist'
				) return;
				throw error;
			}
			if (Object.keys(state.credentials).length !== 0) {
				throw new HostedA9CredentialStoreError('moderator credential rollback is incomplete');
			}
			try {
				await unlink(exactPath);
			} catch {
				throw new HostedA9CredentialStoreError('moderator credential store is unavailable');
			}
		}
	});
}
