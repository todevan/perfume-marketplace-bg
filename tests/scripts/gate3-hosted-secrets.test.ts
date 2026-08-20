import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	createPowerShellDpapi,
	createRunSecretPayload,
	deriveSyntheticIdentity,
	destroyRunSecretStore,
	protectRunSecrets,
	recordProviderTotpSecret,
	unprotectRunSecrets
} from '../../scripts/gate3-hosted-secrets.mjs';

const runId = 'gate3-20260820-abcdef12';
const base32Fixture = 'JBSWY3DPEHPK3PXP';

function deterministicDistinctBytes(size: number): Buffer {
	const call = (deterministicDistinctBytes.calls += 1);
	return Buffer.alloc(size, call);
}
deterministicDistinctBytes.calls = 0;

const temporaryRoots: string[] = [];

async function createSecretPath(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'gate3-secrets-test-'));
	temporaryRoots.push(root);
	const runDirectory = join(root, 'active', runId);
	await mkdir(runDirectory, { recursive: true });
	return join(runDirectory, 'gate3-secrets.dpapi');
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Gate 3 hosted run secrets', () => {
	it('derives stable versioned identities without embedding a password', () => {
		expect(
			deriveSyntheticIdentity({ runId, role: 'assigned-moderator', identitySchemeVersion: 1 })
		).toEqual({
			role: 'assigned-moderator',
			email: 'gate3-v1-mod-a-a8f5c2720cc35a38@example.invalid',
			username: 'g3_v1_mod_a_a8f5c2720cc35a38'
		});
	});

	it('rejects identity inputs outside the exact version-1 run and role contract', () => {
		for (const input of [
			{ runId: '../escape', role: 'reporter', identitySchemeVersion: 1 },
			{ runId, role: 'administrator', identitySchemeVersion: 1 },
			{ runId, role: 'reporter', identitySchemeVersion: 2 }
		]) {
			expect(() => deriveSyntheticIdentity(input)).toThrow('identity_invalid');
		}
	});

	it('uses independent random bytes for every actor password', () => {
		deterministicDistinctBytes.calls = 0;
		const payload = createRunSecretPayload({ runId, randomBytesImpl: deterministicDistinctBytes });

		expect(Object.keys(payload)).toEqual([
			'schemaVersion',
			'runId',
			'identitySchemeVersion',
			'actors'
		]);
		expect(Object.keys(payload.actors)).toEqual([
			'reporter',
			'cross-user',
			'assigned-moderator',
			'unassigned-moderator'
		]);
		expect(Object.values(payload.actors).map((actor) => actor.password)).toEqual([
			'G3!AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
			'G3!AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
			'G3!AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM',
			'G3!BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ'
		]);
		expect(new Set(Object.values(payload.actors).map((actor) => actor.password)).size).toBe(4);
		expect(payload.actors.reporter).not.toHaveProperty('totpSecret');
		expect(payload.actors['cross-user']).not.toHaveProperty('totpSecret');
		expect(payload.actors['assigned-moderator'].totpSecret).toBeNull();
		expect(payload.actors['unassigned-moderator'].totpSecret).toBeNull();
		expect(JSON.stringify(payload)).not.toContain('SUPABASE_');
	});

	it('rejects malformed random output instead of weakening password generation', () => {
		expect(() =>
			createRunSecretPayload({ runId, randomBytesImpl: () => Buffer.alloc(31) })
		).toThrow('random_bytes_invalid');
	});

	it('records only provider-returned uppercase base32 TOTP secrets for moderator roles', () => {
		deterministicDistinctBytes.calls = 0;
		const payload = createRunSecretPayload({ runId, randomBytesImpl: deterministicDistinctBytes });
		const updated = recordProviderTotpSecret({
			payload,
			role: 'assigned-moderator',
			['secret']: base32Fixture
		});

		expect(payload.actors['assigned-moderator'].totpSecret).toBeNull();
		expect(updated.actors['assigned-moderator'].totpSecret).toBe('JBSWY3DPEHPK3PXP');
		expect(updated.actors['unassigned-moderator'].totpSecret).toBeNull();
	});

	it('fails closed on malformed provider TOTP updates without leaking the value', () => {
		deterministicDistinctBytes.calls = 0;
		const payload = createRunSecretPayload({ runId, randomBytesImpl: deterministicDistinctBytes });
		const invalidSecret = 'lowercase-provider-secret';

		try {
			recordProviderTotpSecret({ payload, role: 'assigned-moderator', secret: invalidSecret });
			throw new Error('expected provider TOTP validation to fail');
		} catch (error) {
			expect(String(error)).toContain('totp_secret_invalid');
			expect(String(error).includes(invalidSecret)).toBe(false);
		}
	});

	it('rejects TOTP updates for non-moderator actors', () => {
		deterministicDistinctBytes.calls = 0;
		const payload = createRunSecretPayload({ runId, randomBytesImpl: deterministicDistinctBytes });
		expect(() =>
			recordProviderTotpSecret({ payload, role: 'reporter', ['secret']: base32Fixture })
		).toThrow('totp_role_invalid');
	});

	it('passes only the operation in PowerShell arguments and transports bytes only through pipes', async () => {
		const input = Buffer.from('pipe-only-sensitive-fixture', 'utf8');
		const output = Buffer.from('protected-binary-output', 'utf8');
		const calls: Array<{
			command: string;
			args: string[];
			options: Record<string, unknown>;
			stdin: Buffer;
		}> = [];
		const spawnImpl = (command: string, args: string[], options: Record<string, unknown>) => {
			const child = new EventEmitter() as EventEmitter & {
				stdin: PassThrough;
				stdout: PassThrough;
				stderr: PassThrough;
			};
			child.stdin = new PassThrough();
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			const stdinChunks: Buffer[] = [];
			child.stdin.on('data', (chunk) => stdinChunks.push(Buffer.from(chunk)));
			child.stdin.on('finish', () => {
				calls.push({ command, args, options, stdin: Buffer.concat(stdinChunks) });
				child.stderr.end();
				child.stdout.end(output);
				setImmediate(() => child.emit('close', 0, null));
			});
			return child;
		};
		const dpapi = createPowerShellDpapi({ scriptPath: 'C:\\gate3\\gate3-dpapi.ps1', spawnImpl });

		const protectedResult = await dpapi.protect(input);
		expect(protectedResult.toString('utf8')).toBe('protected-binary-output');
		expect(output.every((byte) => byte === 0)).toBe(true);
		protectedResult.fill(0);
		expect(calls).toHaveLength(1);
		expect(calls[0].command).toBe('powershell.exe');
		expect(calls[0].args).toEqual([
				'-NoLogo',
				'-NoProfile',
				'-NonInteractive',
				'-File',
				'C:\\gate3\\gate3-dpapi.ps1',
				'protect'
			]);
		expect(calls[0].options).toEqual({ stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
		expect(calls[0].stdin.equals(input)).toBe(true);
		expect(JSON.stringify(calls[0].args).includes(input.toString('utf8'))).toBe(false);
		expect(Object.hasOwn(calls[0].options, 'env')).toBe(false);
	});

	it('discards sensitive PowerShell stderr and returns only a sanitized failure', async () => {
		const stderrPayload = 'stderr-sensitive-fixture';
		const spawnImpl = () => {
			const child = new EventEmitter() as EventEmitter & {
				stdin: PassThrough;
				stdout: PassThrough;
				stderr: PassThrough;
			};
			child.stdin = new PassThrough();
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.stdin.on('finish', () => {
				child.stdout.end();
				child.stderr.end(stderrPayload);
				setImmediate(() => child.emit('close', 1, null));
			});
			return child;
		};
		const dpapi = createPowerShellDpapi({ scriptPath: 'C:\\gate3\\gate3-dpapi.ps1', spawnImpl });

		let caught: unknown;
		try {
			await dpapi.unprotect(Buffer.from('corrupt-ciphertext'));
		} catch (error) {
			caught = error;
		}
		expect(String(caught)).toContain('dpapi_failed');
		expect(String(caught).includes(stderrPayload)).toBe(false);
		expect(JSON.stringify(caught).includes(stderrPayload)).toBe(false);
	});

	it('atomically persists only bounded ciphertext and returns safe metadata', async () => {
		const path = await createSecretPath();
		deterministicDistinctBytes.calls = 0;
		const payload = recordProviderTotpSecret({
			payload: createRunSecretPayload({ runId, randomBytesImpl: deterministicDistinctBytes }),
			role: 'assigned-moderator',
			['secret']: base32Fixture
		});
		const ciphertext = Buffer.from('ciphertext-only-fixture', 'utf8');
		let protectedPlaintext: Buffer | undefined;
		let returnedProtectBuffer: Buffer | undefined;
		let returnedUnprotectBuffer: Buffer | undefined;
		const dpapi = {
			protect: async (plain: Buffer) => {
				protectedPlaintext = Buffer.from(plain);
				returnedProtectBuffer = Buffer.from(ciphertext);
				return returnedProtectBuffer;
			},
			unprotect: async () => {
				returnedUnprotectBuffer = Buffer.from(protectedPlaintext!);
				return returnedUnprotectBuffer;
			}
		};

		const metadata = await protectRunSecrets({ payload, path, dpapi });
		expect(metadata).toEqual({
			status: 'available',
			ciphertextSha256: '808c07913790c01939b93c5b6de8b706a2736ffeb75fe5ba985c44d623874788'
		});
		expect(await readFile(path)).toEqual(ciphertext);
		expect(await readdir(join(path, '..'))).toEqual(['gate3-secrets.dpapi']);
		expect(JSON.stringify(metadata).includes('JBSWY3DPEHPK3PXP')).toBe(false);
		expect(JSON.stringify(metadata).includes(ciphertext.toString('utf8'))).toBe(false);
		expect(returnedProtectBuffer?.every((byte) => byte === 0)).toBe(true);

		const restored = await unprotectRunSecrets({ runId, path, dpapi });
		expect(createHash('sha256').update(JSON.stringify(restored)).digest('hex')).toBe(
			createHash('sha256').update(JSON.stringify(payload)).digest('hex')
		);
		expect(returnedUnprotectBuffer?.every((byte) => byte === 0)).toBe(true);
	});

	it('fails closed before writing oversized ciphertext', async () => {
		const path = await createSecretPath();
		deterministicDistinctBytes.calls = 0;
		const payload = createRunSecretPayload({ runId, randomBytesImpl: deterministicDistinctBytes });
		const dpapi = { protect: async () => Buffer.alloc(1024 * 1024), unprotect: vi.fn() };

		await expect(protectRunSecrets({ payload, path, dpapi })).rejects.toThrow(
			'dpapi_output_too_large'
		);
		expect(await readdir(join(path, '..'))).toEqual([]);
	});

	it('verifies secret-store destruction and returns no ciphertext', async () => {
		const path = await createSecretPath();
		deterministicDistinctBytes.calls = 0;
		const payload = createRunSecretPayload({ runId, randomBytesImpl: deterministicDistinctBytes });
		const dpapi = {
			protect: async () => Buffer.from('ciphertext-only-fixture', 'utf8'),
			unprotect: vi.fn()
		};
		await protectRunSecrets({ payload, path, dpapi });

		const metadata = await destroyRunSecretStore(path);
		expect(metadata).toEqual({
			status: 'destroyed-after-cleanup',
			ciphertextSha256: '808c07913790c01939b93c5b6de8b706a2736ffeb75fe5ba985c44d623874788'
		});
		expect(await readdir(join(path, '..'))).toEqual([]);
		expect(JSON.stringify(metadata).includes('ciphertext-only-fixture')).toBe(false);
	});

	it.each(['archive', 'other'])('rejects %s run paths before DPAPI invocation', async (parent) => {
		const root = await mkdtemp(join(tmpdir(), 'gate3-path-scope-'));
		temporaryRoots.push(root);
		const path = join(root, parent, runId, 'gate3-secrets.dpapi');
		await mkdir(join(path, '..'), { recursive: true });
		const dpapi = { protect: vi.fn(), unprotect: vi.fn() };
		deterministicDistinctBytes.calls = 0;
		const payload = createRunSecretPayload({ runId, randomBytesImpl: deterministicDistinctBytes });
		await expect(protectRunSecrets({ payload, path, dpapi })).rejects.toThrow('secret_path_invalid');
		await expect(unprotectRunSecrets({ runId, path, dpapi })).rejects.toThrow('secret_path_invalid');
		await expect(destroyRunSecretStore(path)).rejects.toThrow('secret_path_invalid');
		expect(dpapi.protect).not.toHaveBeenCalled();
		expect(dpapi.unprotect).not.toHaveBeenCalled();
	});

	it('rejects secret-shaped and mismatched actor payloads before DPAPI invocation', async () => {
		const path = await createSecretPath();
		deterministicDistinctBytes.calls = 0;
		const base = createRunSecretPayload({ runId, randomBytesImpl: deterministicDistinctBytes });
		const dpapi = { protect: vi.fn(), unprotect: vi.fn() };
		for (const payload of [
			{ ...base, actors: { ...base.actors, reporter: { ...base.actors.reporter, serviceKey: 'fixture' } } },
			{ ...base, actors: { ...base.actors, reporter: { ...base.actors.reporter, email: 'wrong@example.invalid' } } }
		]) await expect(protectRunSecrets({ payload, path, dpapi })).rejects.toThrow('secret_payload_invalid');
		expect(dpapi.protect).not.toHaveBeenCalled();
	});

	it('preserves the existing final store when temp verification fails before rename', async () => {
		const path = await createSecretPath();
		const original = Buffer.from('existing-ciphertext');
		await writeFile(path, original);
		deterministicDistinctBytes.calls = 0;
		const payload = createRunSecretPayload({ runId, randomBytesImpl: deterministicDistinctBytes });
		const filesystem = { chmod: async (candidate: string, mode: number) => {
			if (candidate !== path) throw new Error('injected chmod failure');
			return chmod(candidate, mode);
		}, lstat, open, readFile, realpath, rename, unlink };
		await expect(protectRunSecrets({ payload, path, dpapi: { protect: async () => Buffer.from('replacement') }, filesystem: filesystem as any })).rejects.toThrow('secret_store_write_failed');
		expect(await readFile(path)).toEqual(original);
		expect(await readdir(join(path, '..'))).toEqual(['gate3-secrets.dpapi']);
	});

	it('computes metadata before rename so no post-commit dependency can fail', async () => {
		const path = await createSecretPath();
		await writeFile(path, 'existing-ciphertext');
		deterministicDistinctBytes.calls = 0;
		const payload = createRunSecretPayload({ runId, randomBytesImpl: deterministicDistinctBytes });
		const renameSpy = vi.fn(rename);
		await expect(protectRunSecrets({
			payload,
			path,
			dpapi: { protect: async () => Buffer.from('replacement') },
			filesystem: { chmod, lstat, open, readFile, realpath, rename: renameSpy, unlink },
			hashImpl: () => { throw new Error('post-commit-sensitive-fixture'); }
		} as any)).rejects.toThrow('dpapi_failed');
		expect(renameSpy).not.toHaveBeenCalled();
		expect((await readFile(path, 'utf8'))).toBe('existing-ciphertext');
	});

	it('prepares complete frozen metadata before the rename commit point', async () => {
		const path = await createSecretPath();
		deterministicDistinctBytes.calls = 0;
		const payload = createRunSecretPayload({ runId, randomBytesImpl: deterministicDistinctBytes });
		const order: string[] = [];
		const metadataImpl = (value: unknown) => { order.push('metadata'); return Object.freeze(value as object); };
		const filesystem = { chmod, lstat, open, readFile, realpath, rename: async (...args: Parameters<typeof rename>) => { order.push('rename'); return rename(...args); }, unlink };
		await protectRunSecrets({ payload, path, dpapi: { protect: async () => Buffer.from('replacement') }, filesystem, metadataImpl } as any);
		expect(order).toEqual(['metadata', 'rename']);
	});

	it.each(['stdout', 'stderr', 'stdin', 'child', 'stdin-end'])(
		'sanitizes and settles once for %s pipe failures',
		async (surface) => {
			const sensitiveMessage = 'pipe-error-sensitive-fixture';
			const lateStdout = Buffer.from('late-stdout-sensitive');
			const lateStderr = Buffer.from('late-stderr-sensitive');
			let settlements = 0;
			const spawnImpl = () => {
				const child = new EventEmitter() as any;
				child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
				child.kill = vi.fn();
				if (surface === 'stdin-end') child.stdin.end = () => { setImmediate(() => {
					child.stdout.emit('data', lateStdout); child.stderr.emit('data', lateStderr); child.stdout.emit('error', new Error(sensitiveMessage)); child.emit('close', 1, null);
				}); throw new Error(sensitiveMessage); };
				else setImmediate(() => {
					(surface === 'child' ? child : child[surface]).emit('error', new Error(sensitiveMessage));
					child.stdout.emit('data', lateStdout); child.stderr.emit('data', lateStderr); child.stderr.emit('error', new Error(sensitiveMessage));
					child.emit('close', 1, null);
				});
				return child;
			};
			let caught: unknown;
			try { await createPowerShellDpapi({ scriptPath: 'C:\\gate3\\gate3-dpapi.ps1', spawnImpl, onSettle: () => { settlements += 1; } } as any).protect(Buffer.from('input')); }
			catch (error) { caught = error; }
			await new Promise((resolve) => setImmediate(resolve));
			expect(['dpapi_failed', 'dpapi_unavailable'].some((code) => String(caught).includes(code))).toBe(true);
			expect(String(caught).includes(sensitiveMessage)).toBe(false);
			expect(settlements).toBe(1);
			expect(lateStdout.every((byte) => byte === 0)).toBe(true);
			expect(lateStderr.every((byte) => byte === 0)).toBe(true);
		}
	);

	it('rejects all secret-shaped payload additions before DPAPI', async () => {
		const path = await createSecretPath();
		deterministicDistinctBytes.calls = 0;
		const base = createRunSecretPayload({ runId, randomBytesImpl: deterministicDistinctBytes });
		const protect = vi.fn();
		for (const [key, value] of Object.entries({ adminKey: 'admin-fixture', providerBody: 'body-fixture', sessionToken: 'token-fixture' })) {
			const payload = { ...base, actors: { ...base.actors, reporter: { ...base.actors.reporter, [key]: value } } };
			let caught: unknown;
			try { await protectRunSecrets({ payload, path, dpapi: { protect } }); } catch (error) { caught = error; }
			expect(String(caught)).toContain('secret_payload_invalid');
			expect(String(caught).includes(value)).toBe(false);
		}
		await expect(protectRunSecrets({ payload: { ...base, actors: { ...base.actors, administrator: base.actors.reporter } }, path, dpapi: { protect } })).rejects.toThrow('secret_payload_invalid');
		expect(protect).not.toHaveBeenCalled();
	});
});
