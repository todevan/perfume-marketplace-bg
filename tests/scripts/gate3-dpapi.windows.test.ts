import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
	createPowerShellDpapi,
	createRunSecretPayload,
	destroyRunSecretStore,
	protectRunSecrets,
	unprotectRunSecrets
} from '../../scripts/gate3-hosted-secrets.mjs';

const windowsDescribe = process.platform === 'win32' ? describe : describe.skip;
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptPath = join(repositoryRoot, 'scripts', 'gate3-dpapi.ps1');
const runId = 'gate3-20260820-abcdef12';
const temporaryRoots: string[] = [];

async function createSecretPath(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'gate3-dpapi-windows-'));
	temporaryRoots.push(root);
	const runDirectory = join(root, 'active', runId);
	await mkdir(runDirectory, { recursive: true });
	return join(runDirectory, 'gate3-secrets.dpapi');
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

windowsDescribe('Gate 3 CurrentUser DPAPI helper', () => {
	it('round-trips binary stdin/stdout without a UTF-8 BOM in the PowerShell source', async () => {
		const source = await readFile(scriptPath);
		expect(source.subarray(0, 3)).not.toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
		const dpapi = createPowerShellDpapi({ scriptPath });
		const plaintext = Buffer.from('windows-dpapi-sensitive-fixture', 'utf8');
		let ciphertext: Buffer | undefined;
		let restored: Buffer | undefined;
		try {
			ciphertext = await dpapi.protect(plaintext);
			expect(ciphertext.length).toBeGreaterThan(plaintext.length);
			expect(ciphertext).not.toEqual(plaintext);
			restored = await dpapi.unprotect(ciphertext);
			expect(createHash('sha256').update(restored).digest('hex')).toBe(createHash('sha256').update(plaintext).digest('hex'));
		} finally { restored?.fill(0); ciphertext?.fill(0); plaintext.fill(0); }
	});

	it('fails closed on corrupt ciphertext without echoing sensitive bytes', async () => {
		const dpapi = createPowerShellDpapi({ scriptPath });
		const corrupt = Buffer.from('corrupt-sensitive-ciphertext-fixture', 'utf8');
		let caught: unknown;
		try {
			await dpapi.unprotect(corrupt);
		} catch (error) {
			caught = error;
		} finally {
			corrupt.fill(0);
		}
		expect(String(caught)).toContain('dpapi_failed');
		expect(String(caught).includes('corrupt-sensitive-ciphertext-fixture')).toBe(false);
	});

	it('persists only ciphertext at the exact run path and verifies destruction', async () => {
		const path = await createSecretPath();
		const payload = createRunSecretPayload({ runId });
		const plaintextMarker = payload.actors.reporter.password;
		const dpapi = createPowerShellDpapi({ scriptPath });

		const metadata = await protectRunSecrets({ payload, path, dpapi });
		const directoryEntries = await readdir(dirname(path));
		const stored = await readFile(path);
		try {
			expect(directoryEntries).toEqual(['gate3-secrets.dpapi']);
			expect(stored.includes(Buffer.from(plaintextMarker, 'utf8'))).toBe(false);
		} finally { stored.fill(0); }
		expect(JSON.stringify(metadata).includes(plaintextMarker)).toBe(false);

		const restored = await unprotectRunSecrets({ runId, path, dpapi });
		expect(createHash('sha256').update(JSON.stringify(restored)).digest('hex')).toBe(
			createHash('sha256').update(JSON.stringify(payload)).digest('hex')
		);
		const destroyed = await destroyRunSecretStore(path);
		expect(destroyed.status).toBe('destroyed-after-cleanup');
		expect(await readdir(dirname(path))).toEqual([]);
	});
});
