import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGate3HostedArgs, runGate3HostedCli } from '../../scripts/gate3-hosted-cli.mjs';
import { GATE3_EXIT_CODES } from '../../scripts/gate3-hosted-lifecycle.mjs';
import {
	GATE3_PROJECT_REF,
	GATE3_WORKER_ORIGIN,
	acquireRunLock,
	readActiveRun,
	readRunState,
	releaseRunLock,
	resolveGate3RunPaths,
	setActiveRun
} from '../../scripts/gate3-hosted-state.mjs';

const runId = 'gate3-20260820-abcdef12';
const releaseSha = 'a'.repeat(40);

describe('Gate 3 hosted CLI parser', () => {
	it.each([
		['preflight', ['--new', '--json']],
		['preflight', ['--run', runId, '--release-sha', releaseSha]],
		['inspect', ['--run', runId, '--json']],
		['provision', ['--run', runId]],
		['scenario', []],
		['cleanup', ['--json']],
		['recover', ['--run', runId]]
	])('parses %s command-scoped flags', (command, flags) => {
		expect(parseGate3HostedArgs([command, ...flags])).toMatchObject({ command });
	});

	it.each([
		'--force',
		'--project-ref',
		'--worker-url',
		'--skip-inspect',
		'--skip-verification',
		'--retry',
		'--cleanup-all',
		'--yes'
	])('rejects prohibited flag %s', (flag) => {
		expect(() => parseGate3HostedArgs(['cleanup', flag])).toThrow('unsupported_argument');
	});

	const invalidArgumentCases: string[][] = [
		[],
		['unknown'],
		['inspect', 'extra'],
		['inspect', '--unknown'],
		['inspect', '--run'],
		['inspect', '--run', runId, '--run', runId],
		['inspect', '--json', '--json'],
		['inspect', '--release-sha', releaseSha],
		['preflight', '--run', runId, '--new'],
		['preflight', '--release-sha', 'A'.repeat(40)],
		['preflight', '--run', 'gate3-20260820-ABCDEF12'],
		['recover'],
		['recover', '--new']
	];
	it.each(invalidArgumentCases)('rejects invalid or ignored arguments %#', (argv) => {
		expect(() => parseGate3HostedArgs(argv)).toThrow('unsupported_argument');
	});

	it('returns only normalized command options', () => {
		expect(
			parseGate3HostedArgs(['preflight', '--run', runId, '--release-sha', releaseSha, '--json'])
		).toEqual({
			command: 'preflight',
			runId,
			createNew: false,
			releaseSha,
			json: true
		});
	});
});

const fixtureRoots: string[] = [];

afterEach(async () => {
	await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function cliFixture() {
	const root = await mkdtemp(join(tmpdir(), 'gate3-hosted-cli-'));
	fixtureRoots.push(root);
	const lines: string[] = [];
	const errors: string[] = [];
	const environment = {
		GATE3_HOSTED_ROOT: root,
		GATE3_PROJECT_REF,
		GATE3_WORKER_ORIGIN
	};
	const dpapi = {
		protect: vi.fn(async (input: Uint8Array) =>
			Buffer.concat([Buffer.from('dpapi-v1:'), Buffer.from(input)])),
		unprotect: vi.fn(async (input: Uint8Array) => Buffer.from(input).subarray(9))
	};
	const zeroCounts = {
		accounts: 0,
		profiles: 0,
		reports: 0,
		uploads: 0,
		objects: 0,
		queueRows: 0
	};
	const inspectHostedAbsence = vi.fn(async (_scope: Record<string, unknown> = {}) => ({
		counts: zeroCounts
	}));
	const dependencies = {
		createRunId: vi.fn(() => runId),
		now: vi.fn(() => '2026-08-20T10:00:00.000Z'),
		randomUUID: vi.fn(() => '11111111-1111-4111-8111-111111111111'),
		resolveDeployedRelease: vi.fn(async () => releaseSha),
		dpapi,
		inspectHostedAbsence
	};
	return {
		root,
		environment,
		dependencies,
		dpapi,
		inspectHostedAbsence,
		lines,
		errors,
		output: (line: string) => lines.push(line),
		errorOutput: (line: string) => errors.push(line)
	};
}

async function runCli(
	fixture: Awaited<ReturnType<typeof cliFixture>>,
	argv: string[],
	dependencyOverrides: Record<string, unknown> = {}
) {
	return runGate3HostedCli({
		argv,
		environment: fixture.environment,
		dependencies: { ...fixture.dependencies, ...dependencyOverrides },
		input: async () => '',
		output: fixture.output,
		errorOutput: fixture.errorOutput
	});
}

describe('Gate 3 hosted preflight CLI', () => {
	it('creates exactly one new local preflight and publishes the pointer last', async () => {
		const fixture = await cliFixture();

		await expect(runCli(fixture, ['preflight', '--new', '--json'])).resolves.toBe(
			GATE3_EXIT_CODES.success
		);

		expect(fixture.dependencies.createRunId).toHaveBeenCalledTimes(1);
		expect(await readActiveRun(fixture.root)).toBe(runId);
		const paths = resolveGate3RunPaths({ root: fixture.root, runId });
		const state = await readRunState(paths);
		expect(state).toMatchObject({
			revision: 1,
			runId,
			target: { releaseCommitSha: releaseSha },
			secretStore: { status: 'available', ciphertextSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
			manifest: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
			phases: {
				preflight: {
					status: 'complete',
					checkpoint: { reasonCode: 'preflight_verified' }
				}
			}
		});
		expect(JSON.parse(fixture.lines.at(-1) ?? '{}')).toMatchObject({
			runId,
			classification: 'PREFLIGHT_READY',
			reasonCode: 'preflight_ready'
		});
	});

	it('resumes the active unfinished run by default as a read-only successful preflight no-op', async () => {
		const fixture = await cliFixture();
		await runCli(fixture, ['preflight', '--new']);
		fixture.dependencies.resolveDeployedRelease.mockClear();
		fixture.inspectHostedAbsence.mockClear();
		fixture.dpapi.protect.mockClear();
		const paths = resolveGate3RunPaths({ root: fixture.root, runId });
		const before = await readFile(paths.statePath);

		await expect(runCli(fixture, ['preflight'])).resolves.toBe(GATE3_EXIT_CODES.success);

		expect(fixture.dependencies.createRunId).toHaveBeenCalledTimes(1);
		expect(fixture.dependencies.resolveDeployedRelease).not.toHaveBeenCalled();
		expect(fixture.inspectHostedAbsence).not.toHaveBeenCalled();
		expect(fixture.dpapi.protect).not.toHaveBeenCalled();
		expect(await readFile(paths.statePath)).toEqual(before);
	});

	it('never selects a newest directory when no active pointer exists', async () => {
		const fixture = await cliFixture();
		const newerRun = 'gate3-20260821-fedcba98';
		await mkdir(resolveGate3RunPaths({ root: fixture.root, runId: newerRun }).runDirectory, {
			recursive: true
		});

		await expect(runCli(fixture, ['preflight'])).resolves.toBe(GATE3_EXIT_CODES.precondition);
		expect(fixture.lines.join('\n')).not.toContain(newerRun);
		expect(fixture.inspectHostedAbsence).not.toHaveBeenCalled();
	});

	it('selects an exact older completed run without switching the newer active pointer', async () => {
		const fixture = await cliFixture();
		await runCli(fixture, ['preflight', '--new']);
		const olderRun = runId;
		const newerRun = 'gate3-20260821-fedcba98';
		fixture.dependencies.createRunId.mockReturnValue(newerRun);
		await runCli(fixture, ['preflight', '--new']);
		fixture.lines.length = 0;

		await expect(runCli(fixture, ['preflight', '--run', olderRun, '--json'])).resolves.toBe(
			GATE3_EXIT_CODES.success
		);

		expect(await readActiveRun(fixture.root)).toBe(newerRun);
		expect(JSON.parse(fixture.lines.at(-1) ?? '{}')).toMatchObject({ runId: olderRun });
	});

	it('finishes the DPAPI round-trip before any run directory is created', async () => {
		const fixture = await cliFixture();
		fixture.dpapi.protect.mockRejectedValueOnce(new Error('sensitive provider body'));

		await expect(runCli(fixture, ['preflight', '--new'])).resolves.toBe(
			GATE3_EXIT_CODES.precondition
		);

		await expect(stat(resolveGate3RunPaths({ root: fixture.root, runId }).runDirectory)).rejects.toMatchObject({
			code: 'ENOENT'
		});
		expect(fixture.inspectHostedAbsence).not.toHaveBeenCalled();
		expect(fixture.errors.join('\n')).not.toContain('sensitive provider body');
	});

	it('uses an exact fallback SHA only when authoritative release resolution throws', async () => {
		const fallbackRun = 'gate3-20260820-bbbbbbbb';
		const fallback = await cliFixture();
		fallback.dependencies.createRunId.mockReturnValue(fallbackRun);
		fallback.dependencies.resolveDeployedRelease.mockRejectedValue(new Error('offline'));
		await expect(
			runCli(fallback, ['preflight', '--new', '--release-sha', 'b'.repeat(40)])
		).resolves.toBe(GATE3_EXIT_CODES.success);
		expect(
			(await readRunState(resolveGate3RunPaths({ root: fallback.root, runId: fallbackRun }))).target
				.releaseCommitSha
		).toBe('b'.repeat(40));

		const invalid = await cliFixture();
		invalid.dependencies.resolveDeployedRelease.mockResolvedValue('invalid-release');
		await expect(
			runCli(invalid, ['preflight', '--new', '--release-sha', 'c'.repeat(40)])
		).resolves.toBe(GATE3_EXIT_CODES.precondition);
		await expect(stat(resolveGate3RunPaths({ root: invalid.root, runId }).runDirectory)).rejects.toMatchObject({
			code: 'ENOENT'
		});
	});

	it('prefers authoritative release evidence over a supplied fallback SHA', async () => {
		const fixture = await cliFixture();
		await runCli(fixture, ['preflight', '--new', '--release-sha', 'b'.repeat(40)]);

		const state = await readRunState(resolveGate3RunPaths({ root: fixture.root, runId }));
		expect(state.target.releaseCommitSha).toBe(releaseSha);
	});

	it('performs allow-list and hosted-absence reads before creating local files and passes no mutation capability', async () => {
		const fixture = await cliFixture();
		const createUser = vi.fn();
		const deleteUser = vi.fn();
		fixture.inspectHostedAbsence.mockImplementation(async (scope: Record<string, unknown> = {}) => {
			expect(Reflect.ownKeys(scope).sort()).toEqual(
				['createdAfter', 'expectedIdentities', 'runId'].sort()
			);
			expect(Object.values(scope).some((value) => typeof value === 'function')).toBe(false);
			await expect(stat(resolveGate3RunPaths({ root: fixture.root, runId }).runDirectory)).rejects.toMatchObject({
				code: 'ENOENT'
			});
			throw Object.assign(new Error('provider response with token'), { reasonCode: 'hosted_absence_unavailable' });
		});

		await expect(
			runCli(fixture, ['preflight', '--new'], { createUser, deleteUser })
		).resolves.toBe(GATE3_EXIT_CODES.precondition);

		expect(createUser).not.toHaveBeenCalled();
		expect(deleteUser).not.toHaveBeenCalled();
		await expect(stat(resolveGate3RunPaths({ root: fixture.root, runId }).runDirectory)).rejects.toMatchObject({
			code: 'ENOENT'
		});
		expect(fixture.errors.join('\n')).not.toContain('provider response');
	});

	it('rejects an active pointer switch while the current run lock is valid', async () => {
		const fixture = await cliFixture();
		await runCli(fixture, ['preflight', '--new']);
		const currentPaths = resolveGate3RunPaths({ root: fixture.root, runId });
		const acquiredLock = await acquireRunLock({ paths: currentPaths, command: 'scenario' });
		const nextRun = 'gate3-20260821-1234abcd';
		fixture.dependencies.createRunId.mockReturnValue(nextRun);
		try {
			await expect(runCli(fixture, ['preflight', '--new'])).resolves.toBe(
				GATE3_EXIT_CODES.precondition
			);
			await expect(stat(resolveGate3RunPaths({ root: fixture.root, runId: nextRun }).runDirectory)).rejects.toMatchObject({
				code: 'ENOENT'
			});
		} finally {
			await releaseRunLock({ paths: currentPaths, acquiredLock });
		}
	});

	it('has a crash-safe exact run before pointer publication and cleans exact local files after an ordinary failure', async () => {
		const fixture = await cliFixture();
		const sibling = join(fixture.root, 'preserve.txt');
		await writeFile(sibling, 'preserve');
		let observedBeforeFailure = false;
		const failPointer = vi.fn(async ({ root, runId: selectedRun }: { root: string; runId: string }) => {
			const paths = resolveGate3RunPaths({ root, runId: selectedRun });
			const state = await readRunState(paths);
			expect(state.revision).toBe(1);
			expect(await stat(paths.secretPath)).toBeTruthy();
			expect(await stat(paths.manifestPath)).toBeTruthy();
			observedBeforeFailure = true;
			throw Object.assign(new Error('pointer failed with secret'), { reasonCode: 'active_pointer_write_failed' });
		});

		await expect(
			runCli(fixture, ['preflight', '--new'], { setActiveRun: failPointer })
		).resolves.toBe(GATE3_EXIT_CODES.precondition);

		expect(observedBeforeFailure).toBe(true);
		const paths = resolveGate3RunPaths({ root: fixture.root, runId });
		await expect(stat(paths.runDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
		expect(await readFile(sibling, 'utf8')).toBe('preserve');
		expect(await readActiveRun(fixture.root)).toBeNull();
		expect(fixture.errors.join('\n')).not.toContain('secret');
	});

	it('never rolls back a run whose active pointer was published before pointer-lock cleanup failed', async () => {
		const fixture = await cliFixture();
		const publishThenFail = vi.fn(async (options: Parameters<typeof setActiveRun>[0]) => {
			await setActiveRun(options);
			throw Object.assign(new Error('pointer lock cleanup failed'), {
				reasonCode: 'active_pointer_lock_failed'
			});
		});

		await expect(
			runCli(fixture, ['preflight', '--new'], { setActiveRun: publishThenFail })
		).resolves.toBe(GATE3_EXIT_CODES.precondition);

		expect(await readActiveRun(fixture.root)).toBe(runId);
		await expect(
			readRunState(resolveGate3RunPaths({ root: fixture.root, runId }))
		).resolves.toMatchObject({ revision: 1 });
	});

	it('rejects a damaged existing preflight instead of reporting a successful no-op', async () => {
		const fixture = await cliFixture();
		await runCli(fixture, ['preflight', '--new']);
		const paths = resolveGate3RunPaths({ root: fixture.root, runId });
		await rm(paths.secretPath);
		fixture.lines.length = 0;

		await expect(runCli(fixture, ['preflight'])).resolves.toBe(GATE3_EXIT_CODES.precondition);

		expect(fixture.lines).toEqual([]);
		expect(await readActiveRun(fixture.root)).toBe(runId);
		expect(fixture.errors.join('\n')).toContain('preflight_recovery_required');
	});
});

function inspectFacts(overrides: Record<string, unknown> = {}) {
	return {
		runId,
		stateValid: true,
		manifestMatches: true,
		ownershipConflict: false,
		deletionScopeTrusted: true,
		authoritativeReleaseAvailable: true,
		actors: 0,
		counts: { actors: 0, profiles: 0, reports: 0 },
		roleCounts: { reporter: 0 },
		secretStoreCiphertextSha256: 'd'.repeat(64),
		manifestSha256: 'e'.repeat(64),
		stateSha256: 'f'.repeat(64),
		...overrides
	};
}

describe('Gate 3 hosted inspect CLI and safe output', () => {
	it('uses only read-only inspect plus lifecycle classification and may run while a stateful lock exists', async () => {
		const fixture = await cliFixture();
		await runCli(fixture, ['preflight', '--new']);
		const paths = resolveGate3RunPaths({ root: fixture.root, runId });
		const acquiredLock = await acquireRunLock({ paths, command: 'scenario' });
		const inspectionAdapter = Object.freeze({ inspectRun: vi.fn(async () => ({})) });
		const inspectGate3HostedRun = vi.fn(async (options: Record<string, unknown>) => {
			expect(Reflect.ownKeys(options).sort()).toEqual(['inspectionAdapter', 'paths'].sort());
			expect(options.inspectionAdapter).toBe(inspectionAdapter);
			return inspectFacts({
				email: 'leak@example.invalid',
				credentialMaterial: 'sensitive-material',
				accessToken: 'secret-token',
				providerBody: { secret: true }
			});
		});
		try {
			fixture.lines.length = 0;
			await expect(
				runCli(fixture, ['inspect', '--run', runId, '--json'], {
					inspectionAdapter,
					inspectGate3HostedRun,
					createUser: vi.fn(),
					deleteUser: vi.fn(),
					upload: vi.fn(),
					cleanup: vi.fn()
				})
			).resolves.toBe(GATE3_EXIT_CODES.success);
		} finally {
			await releaseRunLock({ paths, acquiredLock });
		}

		expect(inspectGate3HostedRun).toHaveBeenCalledTimes(1);
		const serialized = fixture.lines.join('\n');
		expect(serialized).toContain('PREFLIGHT_READY');
		for (const forbidden of ['leak@example.invalid', 'sensitive-material', 'secret-token', 'providerBody']) {
			expect(serialized).not.toContain(forbidden);
		}
	});

	it('drops secret-shaped count, phase, and checkpoint fields from inspected output', async () => {
		const fixture = await cliFixture();
		const inspectionAdapter = Object.freeze({ inspectRun: vi.fn(async () => ({})) });
		const inspectGate3HostedRun = vi.fn(async () =>
			inspectFacts({
				counts: { actors: 0, password: 123 },
				phases: {
					preflight: {
						status: 'service-role-key-must-not-leak',
						checkpoint: { reasonCode: 'access-token-must-not-leak' }
					}
				},
				scenarioCheckpoints: {
					'scenario-a': { status: 'refresh-token-must-not-leak' }
				}
			})
		);

		await runCli(fixture, ['inspect', '--run', runId], {
			inspectionAdapter,
			inspectGate3HostedRun
		});

		const serialized = fixture.lines.join('\n');
		for (const forbidden of ['password', 'service-role-key', 'access-token', 'refresh-token']) {
			expect(serialized).not.toContain(forbidden);
		}
	});

	it.each([
		[{ ambiguous: true }, GATE3_EXIT_CODES.AMBIGUOUS],
		[{ releaseMismatch: true }, GATE3_EXIT_CODES.RELEASE_CHANGED],
		[
			{ credentialsLost: true, exactRecoveryProvenance: true, actors: 1 },
			GATE3_EXIT_CODES.RECOVERY_REQUIRED
		]
	])('maps lifecycle result %# to its deterministic exit', async (overrides, expectedExit) => {
		const fixture = await cliFixture();
		const inspectionAdapter = Object.freeze({ inspectRun: vi.fn(async () => ({})) });
		const inspectGate3HostedRun = vi.fn(async () => inspectFacts(overrides));

		await expect(
			runCli(fixture, ['inspect', '--run', runId], {
				inspectionAdapter,
				inspectGate3HostedRun
			})
		).resolves.toBe(expectedExit);
	});

	it('does not accept a forged mutation exit key from an inspection dependency', async () => {
		const fixture = await cliFixture();
		const inspectionAdapter = Object.freeze({ inspectRun: vi.fn(async () => ({})) });

		await expect(
			runCli(fixture, ['inspect', '--run', runId], {
				inspectionAdapter,
				inspectGate3HostedRun: vi.fn(async () => inspectFacts()),
				classifyGate3Lifecycle: vi.fn(() => ({
					classification: 'PREFLIGHT_READY',
					allowedCommands: ['inspect', 'provision'],
					reasonCode: 'preflight_ready',
					exitCodeKey: 'uncertainMutation'
				}))
			})
		).resolves.toBe(GATE3_EXIT_CODES.success);
	});

	it('fails parsed mutation commands closed until their runners are wired', async () => {
		const fixture = await cliFixture();
		const createUser = vi.fn();

		await expect(
			runCli(fixture, ['provision', '--run', runId], { createUser })
		).resolves.toBe(GATE3_EXIT_CODES.precondition);
		expect(createUser).not.toHaveBeenCalled();
		expect(fixture.errors.join('\n')).toContain('command_unwired');
	});

	it('sanitizes parser and raw dependency failures to safe reason-only stderr', async () => {
		const fixture = await cliFixture();
		await expect(runCli(fixture, ['cleanup', '--force'])).resolves.toBe(
			GATE3_EXIT_CODES.precondition
		);
		expect(JSON.parse(fixture.errors.at(-1) ?? '{}')).toEqual({ reasonCode: 'unsupported_argument' });

		fixture.errors.length = 0;
		await expect(
			runCli(fixture, ['inspect', '--run', runId], {
				inspectionAdapter: Object.freeze({ inspectRun: vi.fn(async () => ({})) }),
				inspectGate3HostedRun: vi.fn(async () => {
					throw new Error('service-role-key=must-not-leak');
				})
			})
		).resolves.toBe(GATE3_EXIT_CODES.precondition);
		expect(JSON.parse(fixture.errors.at(-1) ?? '{}')).toEqual({ reasonCode: 'precondition_failed' });
	});
});
