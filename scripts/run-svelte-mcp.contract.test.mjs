import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
	SVELTE_MCP_ENTRYPOINT,
	SVELTE_MCP_ENV_ALLOWLIST,
	buildSvelteMcpEnvironment,
	getSvelteMcpLaunchSpec,
	getSvelteMcpSpawnOptions
} from './run-svelte-mcp.mjs'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_RAW = readFileSync(join(REPOSITORY_ROOT, '.codex/config.toml'), 'utf8')
const SVELTE_CONFIG_BODY = CONFIG_RAW.match(
	/\[mcp_servers\.aromatika-svelte\]\n([\s\S]*?)(?=\n\[|$)/
)?.[1]

assert.ok(SVELTE_CONFIG_BODY, 'Svelte MCP config table must exist')

function parseJsonCompatibleTomlField(name) {
	const value = SVELTE_CONFIG_BODY.match(new RegExp(`^${name} = (.+)$`, 'm'))?.[1]
	assert.ok(value, `${name} must exist in the Svelte MCP config table`)
	return JSON.parse(value)
}

const SVELTE_CONFIG = Object.freeze({
	command: parseJsonCompatibleTomlField('command'),
	args: parseJsonCompatibleTomlField('args'),
	cwd: SVELTE_CONFIG_BODY.match(/^cwd = (.+)$/m)?.[1]
		? parseJsonCompatibleTomlField('cwd')
		: undefined
})

function runConfiguredBootstrap(hostDirectory) {
	assert.equal(SVELTE_CONFIG.command, 'node')

	const childDirectory = SVELTE_CONFIG.cwd
		? resolve(hostDirectory, SVELTE_CONFIG.cwd)
		: hostDirectory

	return spawnSync(
		process.execPath,
		[...SVELTE_CONFIG.args, '--', '--aromatika-resolve-only'],
		{
			cwd: childDirectory,
			encoding: 'utf8',
			env: buildSvelteMcpEnvironment(process.env)
		}
	)
}

test('Svelte MCP environment contains only approved non-secret runtime variables', () => {
	const source = {
		PATH: '/approved/bin',
		HOME: '/approved/home',
		TEMP: '/approved/temp',
		CLOUDFLARE_API_TOKEN: 'sentinel-token',
		SUPABASE_SECRET_KEY: 'sentinel-key',
		TURNSTILE_SECRET: 'sentinel-secret',
		UNRELATED_VALUE: 'sentinel-unrelated'
	}

	assert.deepEqual(buildSvelteMcpEnvironment(source), {
		PATH: '/approved/bin',
		HOME: '/approved/home',
		TEMP: '/approved/temp'
	})
})

test('Svelte MCP entrypoint and environment allowlist are immutable', () => {
	assert.equal(isAbsolute(SVELTE_MCP_ENTRYPOINT), true)
	assert.deepEqual(SVELTE_MCP_ENV_ALLOWLIST, [
		'PATH',
		'PATHEXT',
		'SYSTEMROOT',
		'WINDIR',
		'COMSPEC',
		'TEMP',
		'TMP',
		'TMPDIR',
		'HOME',
		'USERPROFILE',
		'APPDATA',
		'LOCALAPPDATA'
	])
	assert.equal(Object.isFrozen(SVELTE_MCP_ENV_ALLOWLIST), true)
})

test('Svelte MCP entrypoint stays repository-rooted from a nested session directory', () => {
	const originalDirectory = process.cwd()
	const expectedEntrypoint = resolve(
		originalDirectory,
		'node_modules/@sveltejs/mcp/dist/index.mjs'
	)

	process.chdir(resolve(originalDirectory, 'src'))

	try {
		assert.equal(SVELTE_MCP_ENTRYPOINT, expectedEntrypoint)
		assert.deepEqual(getSvelteMcpLaunchSpec('linux', '/usr/bin/node'), {
			command: '/usr/bin/node',
			args: [expectedEntrypoint]
		})
	} finally {
		process.chdir(originalDirectory)
	}
})

test('configured bootstrap resolves the trusted wrapper from root and nested sessions', () => {
	const expectedWrapper = realpathSync(join(REPOSITORY_ROOT, 'scripts/run-svelte-mcp.mjs'))
	assert.equal(SVELTE_CONFIG.cwd, undefined)

	for (const hostDirectory of [
		REPOSITORY_ROOT,
		join(REPOSITORY_ROOT, 'src'),
		join(REPOSITORY_ROOT, 'src/routes/listing/[slug]')
	]) {
		const result = runConfiguredBootstrap(hostDirectory)

		assert.equal(result.status, 0, result.stderr)
		assert.equal(result.stdout, expectedWrapper)
	}
})

test('configured bootstrap ignores a nested forged Aromatika lookalike', () => {
	const forgedRoot = mkdtempSync(join(REPOSITORY_ROOT, '.svelte-mcp-forgery-'))
	const nestedDirectory = join(forgedRoot, 'src/routes')
	const forgedWrapper = join(forgedRoot, 'scripts/run-svelte-mcp.mjs')
	const sideEffect = join(forgedRoot, 'malicious-wrapper-imported')

	mkdirSync(join(forgedRoot, '.codex'), { recursive: true })
	mkdirSync(dirname(forgedWrapper), { recursive: true })
	mkdirSync(nestedDirectory, { recursive: true })
	writeFileSync(
		join(forgedRoot, '.codex/aromatika-project-root'),
		'aromatika-codex-root-v1\n',
		'utf8'
	)
	writeFileSync(
		join(forgedRoot, 'package.json'),
		'{"name":"perfume-marketplace-bg","private":true}\n',
		'utf8'
	)
	writeFileSync(
		forgedWrapper,
		`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(sideEffect)},'selected');process.stdout.write('malicious-wrapper-ran')\n`,
		'utf8'
	)

	try {
		const result = runConfiguredBootstrap(nestedDirectory)
		assert.equal(result.status, 0, result.stderr)
		assert.equal(
			result.stdout,
			realpathSync(join(REPOSITORY_ROOT, 'scripts/run-svelte-mcp.mjs'))
		)
		assert.equal(existsSync(sideEffect), false)
		assert.doesNotMatch(result.stdout, /malicious-wrapper-ran/)
	} finally {
		rmSync(forgedRoot, { recursive: true, force: true })
	}
})

test(
	'configured bootstrap does not execute a forged Git binary from the session directory',
	{ skip: process.platform !== 'win32' },
	() => {
		const sessionRoot = mkdtempSync(join(REPOSITORY_ROOT, '.svelte-mcp-git-binary-'))
		const nestedDirectory = join(sessionRoot, 'nested')
		mkdirSync(nestedDirectory)
		copyFileSync(
			join(process.env.SYSTEMROOT, 'System32/where.exe'),
			join(nestedDirectory, 'git.exe')
		)

		try {
			const result = runConfiguredBootstrap(nestedDirectory)
			assert.equal(result.status, 0, result.stderr)
			assert.equal(
				result.stdout,
				realpathSync(join(REPOSITORY_ROOT, 'scripts/run-svelte-mcp.mjs'))
			)
		} finally {
			rmSync(sessionRoot, { recursive: true, force: true })
		}
	}
)

test('configured bootstrap prefers the containing Aromatika worktree over a nested Git root', () => {
	const nestedGitRoot = mkdtempSync(join(REPOSITORY_ROOT, '.svelte-mcp-nested-git-'))
	const nestedDirectory = join(nestedGitRoot, 'nested')
	const forgedWrapper = join(nestedGitRoot, 'scripts/run-svelte-mcp.mjs')
	mkdirSync(join(nestedGitRoot, '.codex'), { recursive: true })
	mkdirSync(dirname(forgedWrapper), { recursive: true })
	mkdirSync(nestedDirectory)
	writeFileSync(
		join(nestedGitRoot, '.codex/aromatika-project-root'),
		'aromatika-codex-root-v1\n',
		'utf8'
	)
	writeFileSync(
		join(nestedGitRoot, 'package.json'),
		'{"name":"perfume-marketplace-bg","private":true}\n',
		'utf8'
	)
	writeFileSync(forgedWrapper, "process.stdout.write('nested-git-wrapper-ran')\n", 'utf8')
	const initialized = spawnSync('git', ['init', '--quiet'], {
		cwd: nestedGitRoot,
		env: buildSvelteMcpEnvironment(process.env),
		shell: false,
		windowsHide: true
	})
	assert.equal(initialized.status, 0, initialized.stderr?.toString())

	try {
		const result = runConfiguredBootstrap(nestedDirectory)
		assert.equal(result.status, 0, result.stderr)
		assert.equal(
			result.stdout,
			realpathSync(join(REPOSITORY_ROOT, 'scripts/run-svelte-mcp.mjs'))
		)
		assert.doesNotMatch(result.stdout, /nested-git-wrapper-ran/)
	} finally {
		rmSync(nestedGitRoot, { recursive: true, force: true })
	}
})

test(
	'configured bootstrap rejects a wrapper symlink that escapes the project root',
	{ skip: process.platform === 'win32' },
	() => {
		const temporaryRoot = mkdtempSync(join(tmpdir(), 'aromatika-mcp-symlink-'))
		const projectRoot = join(temporaryRoot, 'project')
		const nestedDirectory = join(projectRoot, 'src/routes')
		const wrapper = join(projectRoot, 'scripts/run-svelte-mcp.mjs')
		const outsideTarget = join(temporaryRoot, 'outside-wrapper.mjs')

		mkdirSync(join(projectRoot, '.codex'), { recursive: true })
		mkdirSync(dirname(wrapper), { recursive: true })
		mkdirSync(nestedDirectory, { recursive: true })
		const initialized = spawnSync('git', ['init', '--quiet'], {
			cwd: projectRoot,
			env: buildSvelteMcpEnvironment(process.env),
			shell: false,
			windowsHide: true
		})
		assert.equal(initialized.status, 0, initialized.stderr?.toString())
		writeFileSync(
			join(projectRoot, '.codex/aromatika-project-root'),
			'aromatika-codex-root-v1\n',
			'utf8'
		)
		writeFileSync(
			join(projectRoot, 'package.json'),
			'{"name":"perfume-marketplace-bg","private":true}\n',
			'utf8'
		)
		writeFileSync(outsideTarget, "process.stdout.write('escaped-wrapper-ran')\n", 'utf8')
		symlinkSync(outsideTarget, wrapper)

		try {
			const result = runConfiguredBootstrap(nestedDirectory)

			assert.notEqual(result.status, 0)
			assert.equal(result.stdout, '')
			assert.match(result.stderr, /wrapper is outside the project root/)
		} finally {
			rmSync(temporaryRoot, { recursive: true, force: true })
		}
	}
)

test('configured bootstrap rejects an unrelated host with a parent-level wrapper', () => {
	const unrelatedRoot = mkdtempSync(join(tmpdir(), 'aromatika-mcp-unrelated-'))
	const nestedDirectory = join(unrelatedRoot, 'nested')
	const fakeWrapper = join(unrelatedRoot, 'scripts/run-svelte-mcp.mjs')

	mkdirSync(join(unrelatedRoot, '.codex'), { recursive: true })
	mkdirSync(dirname(fakeWrapper), { recursive: true })
	mkdirSync(nestedDirectory)
	writeFileSync(
		join(unrelatedRoot, '.codex/aromatika-project-root'),
		'aromatika-codex-root-v1\n',
		'utf8'
	)
	writeFileSync(
		join(unrelatedRoot, 'package.json'),
		'{"name":"perfume-marketplace-bg","private":true}\n',
		'utf8'
	)
	writeFileSync(fakeWrapper, "process.stdout.write('untrusted-wrapper-ran')\n", 'utf8')

	try {
		const result = runConfiguredBootstrap(nestedDirectory)

		assert.notEqual(result.status, 0)
		assert.equal(result.stdout, '')
		assert.match(result.stderr, /Aromatika Git worktree root not found/)
	} finally {
		rmSync(unrelatedRoot, { recursive: true, force: true })
	}
})

test('Svelte MCP child is spawned without a shell or inherited secret variables', () => {
	assert.deepEqual(
		getSvelteMcpSpawnOptions({
			PATH: '/approved/bin',
			CLOUDFLARE_API_TOKEN: 'sentinel-token',
			SUPABASE_SECRET_KEY: 'sentinel-key',
			TURNSTILE_SECRET: 'sentinel-secret',
			UNRELATED_VALUE: 'sentinel-unrelated'
		}),
		{
			env: { PATH: '/approved/bin' },
			stdio: 'inherit',
			shell: false,
			windowsHide: true
		}
	)
})

test('Windows launch uses the current Node executable without a command shell', () => {
	const entrypoint = 'C:\\repo\\node_modules\\@sveltejs\\mcp\\dist\\index.mjs'

	assert.deepEqual(
		getSvelteMcpLaunchSpec('win32', 'C:\\Program Files\\nodejs\\node.exe', entrypoint),
		{
			command: 'C:\\Program Files\\nodejs\\node.exe',
			args: [entrypoint]
		}
	)
})

test('POSIX launch uses the current Node executable without a command shell', () => {
	const entrypoint = '/repo/node_modules/@sveltejs/mcp/dist/index.mjs'

	assert.deepEqual(getSvelteMcpLaunchSpec('linux', '/usr/bin/node', entrypoint), {
		command: '/usr/bin/node',
		args: [entrypoint]
	})
})
