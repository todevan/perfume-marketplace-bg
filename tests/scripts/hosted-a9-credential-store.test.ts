import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
	createEncryptedModeratorCredentialStore,
	validateHostedCredentialStoreEnvironment
} from '../../scripts/hosted-a9-credential-store.mjs';

const execFileAsync = promisify(execFile);
const projectRef = 'nuhkpqjjyuygiemrxbdp';
const runId = 'gate3-20260809-0001';
const encryptionKey = 'k'.repeat(48);
const wrongEncryptionKey = 'w'.repeat(48);
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const assignedSecret = Array.from({ length: 32 }, (_, index) => base32Alphabet[index % 32]).join('');
const unassignedSecret = Array.from(
	{ length: 32 },
	(_, index) => base32Alphabet[(index + 7) % 32]
).join('');
const temporaryDirectories: string[] = [];

async function temporaryStorePath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'hosted-a9-credentials-'));
	temporaryDirectories.push(directory);
	return join(directory, 'moderator-totp.enc');
}

function createStore(filePath: string, key = encryptionKey) {
	return createEncryptedModeratorCredentialStore({
		filePath,
		encryptionKey: key,
		projectRef,
		runId
	});
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true })
		)
	);
});

describe('hosted A9 encrypted moderator credential store', () => {
	it('stores only authenticated ciphertext and recovers both generated seeds', async () => {
		const filePath = await temporaryStorePath();
		const store = createStore(filePath);

		await store.storeModeratorTotpSecret({ role: 'assigned-moderator', secret: assignedSecret });
		await store.storeModeratorTotpSecret({
			role: 'unassigned-moderator',
			secret: unassignedSecret
		});

		const persisted = await readFile(filePath, 'utf8');
		expect(persisted).toContain('aes-256-gcm');
		expect(persisted).toContain('scrypt-N32768-r8-p1');
		expect(persisted).not.toContain(assignedSecret);
		expect(persisted).not.toContain(unassignedSecret);
		expect(persisted).not.toContain(encryptionKey);
		await expect(
			createStore(filePath).getModeratorTotpSecret({ role: 'assigned-moderator' })
		).resolves.toBe(assignedSecret);
		await expect(
			createStore(filePath).getModeratorTotpSecret({ role: 'unassigned-moderator' })
		).resolves.toBe(unassignedSecret);
		if (process.platform !== 'win32') {
			expect((await stat(filePath)).mode & 0o777).toBe(0o600);
		}
		expect((await readdir(resolve(filePath, '..'))).filter((name) => name.endsWith('.tmp'))).toEqual(
			[]
		);
	});

	it('binds an Issue #24 disposable store and recovers the unassigned administrator seed', async () => {
		const filePath = await temporaryStorePath();
		const store = createEncryptedModeratorCredentialStore({
			filePath,
			encryptionKey,
			projectRef: 'abcdefghijklmnopqrst',
			runId: 'issue24-20260831-abcdef0'
		});

		await store.storeModeratorTotpSecret({
			role: 'unassigned-admin',
			secret: assignedSecret
		});

		await expect(
			store.getModeratorTotpSecret({ role: 'unassigned-admin' })
		).resolves.toBe(assignedSecret);
		expect(await readFile(filePath, 'utf8')).not.toContain(assignedSecret);
	});

	it('recovers the same seed in a separate process without printing it', async () => {
		const filePath = await temporaryStorePath();
		await createStore(filePath).storeModeratorTotpSecret({
			role: 'assigned-moderator',
			secret: assignedSecret
		});
		const expectedDigest = createHash('sha256').update(assignedSecret).digest('hex');
		const moduleUrl = new URL('../../scripts/hosted-a9-credential-store.mjs', import.meta.url).href;
		const script = `
			import { createHash } from 'node:crypto';
			import { createEncryptedModeratorCredentialStore } from ${JSON.stringify(moduleUrl)};
			const store = createEncryptedModeratorCredentialStore({
				filePath: process.env.TEST_STORE_PATH,
				encryptionKey: process.env.TEST_STORE_KEY,
				projectRef: process.env.TEST_PROJECT_REF,
				runId: process.env.TEST_RUN_ID
			});
			const secret = await store.getModeratorTotpSecret({ role: 'assigned-moderator' });
			process.stdout.write(createHash('sha256').update(secret).digest('hex'));
		`;
		const result = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
			env: {
				...process.env,
				TEST_STORE_PATH: filePath,
				TEST_STORE_KEY: encryptionKey,
				TEST_PROJECT_REF: projectRef,
				TEST_RUN_ID: runId
			},
			windowsHide: true
		});

		expect(result.stdout).toBe(expectedDigest);
		expect(result.stdout).not.toContain(assignedSecret);
		expect(result.stderr).toBe('');
	});

	it('fails closed with a sanitized error for a wrong key or corrupted ciphertext', async () => {
		const filePath = await temporaryStorePath();
		await createStore(filePath).storeModeratorTotpSecret({
			role: 'assigned-moderator',
			secret: assignedSecret
		});

		for (const action of [
			() => createStore(filePath, wrongEncryptionKey).getModeratorTotpSecret({ role: 'assigned-moderator' }),
			async () => {
				const envelope = JSON.parse(await readFile(filePath, 'utf8')) as { sealed: string };
				const sealed = Buffer.from(envelope.sealed, 'base64');
				sealed[sealed.length - 1] ^= 1;
				await writeFile(filePath, `${JSON.stringify({ ...envelope, sealed: sealed.toString('base64') })}\n`);
				return createStore(filePath).getModeratorTotpSecret({ role: 'assigned-moderator' });
			}
		]) {
			let caught: unknown;
			try {
				await action();
			} catch (error) {
				caught = error;
			}
			expect(String(caught)).toContain('moderator credential store authentication failed');
			expect(String(caught)).not.toContain(assignedSecret);
			expect(String(caught)).not.toContain(filePath);
		}
	});

	it('deletes one compensated enrollment and purges the complete A11 store idempotently', async () => {
		const filePath = await temporaryStorePath();
		const store = createStore(filePath);
		await store.storeModeratorTotpSecret({ role: 'assigned-moderator', secret: assignedSecret });
		await store.storeModeratorTotpSecret({
			role: 'unassigned-moderator',
			secret: unassignedSecret
		});

		await store.deleteModeratorTotpSecret({ role: 'unassigned-moderator' });
		await expect(
			store.getModeratorTotpSecret({ role: 'unassigned-moderator' })
		).rejects.toThrow('moderator credential is unavailable');
		await expect(
			store.getModeratorTotpSecret({ role: 'assigned-moderator' })
		).resolves.toBe(assignedSecret);

		await store.purgeModeratorTotpSecrets();
		await store.purgeModeratorTotpSecrets();
		await store.finalizePurgeTombstone();
		await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
		await expect(store.purgeModeratorTotpSecrets()).rejects.toThrow(
			'moderator credential store is unavailable'
		);
	});

	it('reserves an authenticated empty store exclusively before hosted mutation', async () => {
		const filePath = await temporaryStorePath();
		const store = createStore(filePath);

		await store.initializeModeratorTotpSecrets();
		const persisted = await readFile(filePath, 'utf8');
		expect(persisted).toContain('aes-256-gcm');
		expect(persisted).not.toContain(encryptionKey);
		await expect(store.initializeModeratorTotpSecrets()).rejects.toThrow(
			'moderator credential store already exists'
		);
		await expect(
			createStore(filePath, wrongEncryptionKey).getModeratorTotpSecret({
				role: 'assigned-moderator'
			})
		).rejects.toThrow('moderator credential store authentication failed');
	});

	it('binds ciphertext to its canonical path and leaves a retryable authenticated purge tombstone', async () => {
		const filePath = await temporaryStorePath();
		const copiedPath = await temporaryStorePath();
		const store = createStore(filePath);
		await store.initializeModeratorTotpSecrets();
		await store.storeModeratorTotpSecret({ role: 'assigned-moderator', secret: assignedSecret });
		await writeFile(copiedPath, await readFile(filePath));

		await expect(
			createStore(copiedPath).getModeratorTotpSecret({ role: 'assigned-moderator' })
		).rejects.toThrow('moderator credential store authentication failed');
		await store.purgeModeratorTotpSecrets();
		await store.purgeModeratorTotpSecrets();
		const tombstone = await readFile(filePath, 'utf8');
		expect(tombstone).not.toContain(assignedSecret);
		await expect(
			store.getModeratorTotpSecret({ role: 'assigned-moderator' })
		).rejects.toThrow('moderator credential store was purged');
		await store.finalizePurgeTombstone();
		await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('rejects repository-local, relative, wrong-scope, and malformed configuration before writing', async () => {
		const outsidePath = await temporaryStorePath();
		const repositoryPath = resolve('credential-store.enc');
		for (const environment of [
			{
				E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH: 'relative.enc',
				E2E_REAL_REPORT_EVIDENCE_TOTP_ENCRYPTION_KEY: encryptionKey
			},
			{
				E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH: repositoryPath,
				E2E_REAL_REPORT_EVIDENCE_TOTP_ENCRYPTION_KEY: encryptionKey
			},
			{
				E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH: outsidePath,
				E2E_REAL_REPORT_EVIDENCE_TOTP_ENCRYPTION_KEY: 'short'
			}
		]) {
			expect(() => validateHostedCredentialStoreEnvironment(environment)).toThrow();
		}

		expect(
			validateHostedCredentialStoreEnvironment({
				E2E_REAL_REPORT_EVIDENCE_TOTP_CREDENTIAL_PATH: outsidePath,
				E2E_REAL_REPORT_EVIDENCE_TOTP_ENCRYPTION_KEY: encryptionKey
			})
		).toEqual({ filePath: outsidePath, encryptionKey });
		await expect(
			createStore(outsidePath).storeModeratorTotpSecret({ role: 'reporter', secret: assignedSecret })
		).rejects.toThrow('moderator credential role is invalid');
		await expect(stat(outsidePath)).rejects.toMatchObject({ code: 'ENOENT' });
	});
});
