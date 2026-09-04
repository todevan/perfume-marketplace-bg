import { execFile as execFileCallback } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';

type CandidateModule = typeof import('../../scripts/issue22-hosted/candidate.mjs');

const candidate = await import('../../scripts/issue22-hosted/candidate.mjs').catch(
	() => ({}) as Partial<CandidateModule>
);

function requiredFunction<Name extends keyof CandidateModule>(name: Name): CandidateModule[Name] {
	const value = candidate[name];
	if (typeof value !== 'function') throw new Error(`${String(name)} is not implemented`);
	return value as CandidateModule[Name];
}

const execFile = promisify(execFileCallback);
const playwrightCli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryGitRepository() {
	const directory = await mkdtemp(join(tmpdir(), 'issue22-candidate-'));
	temporaryDirectories.push(directory);
	await execFile('git', ['init'], { cwd: directory });
	await execFile('git', ['config', 'user.email', 'issue22@example.invalid'], { cwd: directory });
	await execFile('git', ['config', 'user.name', 'Issue 22 Test'], { cwd: directory });
	await writeFile(join(directory, 'tracked.txt'), 'candidate\n', 'utf8');
	await execFile('git', ['add', 'tracked.txt'], { cwd: directory });
	await execFile('git', ['commit', '-m', 'test: candidate'], { cwd: directory });
	const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: directory });
	return { directory, sha: stdout.trim() };
}

describe('candidate Git and deployment identity', () => {
	test('accepts only the exact clean worktree HEAD and rejects non-ignored untracked files', async () => {
		const attest = requiredFunction('attestCandidateWorktree');
		const { directory, sha } = await temporaryGitRepository();
		await expect(attest(directory, sha)).resolves.toEqual({ headSha: sha, trackedClean: true });
		await writeFile(join(directory, 'untracked.txt'), 'can affect a build\n', 'utf8');
		await expect(attest(directory, sha)).rejects.toThrow('Issue #22 candidate worktree is not clean.');
		await expect(attest(directory, 'b'.repeat(40))).rejects.toThrow(
			'Issue #22 candidate worktree does not match the expected SHA.'
		);
	});

	test('rejects a dirty tracked worktree', async () => {
		const attest = requiredFunction('attestCandidateWorktree');
		const { directory, sha } = await temporaryGitRepository();
		await writeFile(join(directory, 'tracked.txt'), 'changed\n', 'utf8');
		await expect(attest(directory, sha)).rejects.toThrow('Issue #22 candidate worktree is not clean.');
	});

	test('hashes the exact tracked acceptance surface and detects drift after verification', async () => {
		const snapshotSurface = requiredFunction('snapshotTrackedAcceptanceSurface');
		const assertUnchanged = requiredFunction('assertTrackedAcceptanceSurfaceUnchanged');
		const { directory, sha } = await temporaryGitRepository();
		const snapshot = await snapshotSurface(directory, sha);
		expect(snapshot).toMatchObject({ headSha: sha, files: [{ path: 'tracked.txt' }] });
		expect(snapshot.files[0].sha256).toMatch(/^[a-f0-9]{64}$/u);
		await expect(assertUnchanged(directory, snapshot)).resolves.toBeUndefined();
		await writeFile(join(directory, 'tracked.txt'), 'drifted after checks\n', 'utf8');
		await expect(assertUnchanged(directory, snapshot)).rejects.toThrow(
			'Issue #22 candidate acceptance surface changed.'
		);
	});

	test('binds current Wrangler deployment and version identity to the manifest candidate', () => {
		const assertDeployment = requiredFunction('assertWranglerDeploymentIdentity');
		const expected = {
			workerName: 'aromatika-issue-22-a1b2c3d',
			versionId: '11111111-1111-4111-8111-111111111111',
			candidateSha: 'a'.repeat(40)
		};
		expect(assertDeployment({ ...expected }, expected)).toEqual(expected);
		expect(() => assertDeployment({ ...expected, versionId: '22222222-2222-4222-8222-222222222222' }, expected)).toThrow(
			'Issue #22 Wrangler deployment identity is invalid.'
		);
		expect(() => assertDeployment({ ...expected, candidateSha: 'b'.repeat(40) }, expected)).toThrow(
			'Issue #22 Wrangler deployment identity is invalid.'
		);
	});
});

describe('child-process and issue-scoped config safety', () => {
	test('omits only stale CLOUDFLARE_API_TOKEN from Wrangler while preserving encrypted OAuth environment', () => {
		const buildEnvironment = requiredFunction('buildWranglerChildEnvironment');
		expect(
			buildEnvironment({
				PATH: 'test-path',
				HOME: 'C:/Users/Admin',
				CLOUDFLARE_API_TOKEN: 'stale-private-token',
				CLOUDFLARE_ACCOUNT_ID: 'manifest-must-own-this-value',
				WRANGLER_LOG: 'warn'
			})
		).toEqual({
			PATH: 'test-path',
			HOME: 'C:/Users/Admin',
			CLOUDFLARE_ACCOUNT_ID: 'manifest-must-own-this-value',
			WRANGLER_LOG: 'warn'
		});
	});

	test('allowlists operator secrets per non-Wrangler child', () => {
		const buildEnvironment = requiredFunction('buildAllowlistedChildEnvironment');
		expect(
			buildEnvironment(
				{
					PATH: 'test-path',
					SUPABASE_ACCESS_TOKEN: 'allowed-private',
					SUPABASE_DB_PASSWORD: 'not-allowed-for-this-child',
					MAILTRAP_SMTP_PASSWORD: 'unrelated-private'
				},
				['PATH', 'SUPABASE_ACCESS_TOKEN']
			)
		).toEqual({ PATH: 'test-path', SUPABASE_ACCESS_TOKEN: 'allowed-private' });
	});

	test('materializes a free-compatible Worker config with logs, traces, and request observability disabled', async () => {
		const materialize = requiredFunction('materializeWranglerConfig');
		const validate = requiredFunction('validateWranglerConfig');
		const directory = await mkdtemp(join(tmpdir(), 'issue22-wrangler-'));
		temporaryDirectories.push(directory);
		const outputPath = join(directory, 'wrangler.issue22.json');
		await materialize({
			templatePath: join(process.cwd(), 'scripts/issue22-hosted/wrangler.issue22.template.json'),
			outputPath,
			workerName: 'aromatika-issue-22-a1b2c3d',
			candidateOrigin: 'https://aromatika-issue-22-a1b2c3d.workers.dev',
			expectedSha: 'a'.repeat(40),
			supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
			publishableKey: 'sb_publishable_test-only'
		});
		const config = JSON.parse(await readFile(outputPath, 'utf8'));
		expect(validate(config)).toMatchObject({
			name: 'aromatika-issue-22-a1b2c3d',
			workers_dev: true,
			observability: {
				enabled: false,
				logs: { enabled: false, invocation_logs: false, persist: false },
				traces: { enabled: false, persist: false }
			},
			vars: { RELEASE_COMMIT_SHA: 'a'.repeat(40) }
		});
		expect(config).not.toHaveProperty('images');
		expect(config).not.toHaveProperty('routes');
	});

	test('ships a Playwright configuration that never records token-bearing navigation artifacts', async () => {
		const playwrightConfig = await import('../../scripts/issue22-hosted/playwright.config.mjs').catch(() => ({ default: null }));
		expect(playwrightConfig.default).toMatchObject({
			fullyParallel: false,
			workers: 1,
			retries: 0,
			preserveOutput: 'never',
			use: { trace: 'off', video: 'off', screenshot: 'off' }
		});
	});

	test('discovers exactly the intended executable Issue #22 hosted proof', async () => {
		const { stdout } = await execFile(
			process.execPath,
			[
				playwrightCli,
				'test',
				'--config',
				join(process.cwd(), 'scripts/issue22-hosted/playwright.config.mjs'),
				'--list'
			],
			{
				cwd: process.cwd(),
				env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
				windowsHide: true
			}
		);
		const discoveredTests = stdout
			.split(/\r?\n/u)
			.filter((line) => line.includes(' › '));

		expect(discoveredTests).toEqual([
			expect.stringMatching(
				/^\s*\[chromium\] › issue22-hosted-proof\.e2e\.mjs:\d+:\d+ › Issue #22 hosted registration proof$/u
			)
		]);
		expect(stdout).toContain('Total: 1 test in 1 file');
		expect(stdout).not.toContain('tests/e2e/');
	});
});
