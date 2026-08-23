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
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WRAPPER_PATH = join(REPOSITORY_ROOT, 'scripts/run-codegraph-mcp.mjs')

test('the project CodeGraph MCP wrapper exists', () => {
	assert.equal(existsSync(WRAPPER_PATH), true)
})

if (existsSync(WRAPPER_PATH)) {
	const {
		CODEGRAPH_MCP_ENV_ALLOWLIST,
		EXPECTED_CODEGRAPH_VERSION,
		buildCodegraphMcpEnvironment,
		getCodegraphMcpLaunchSpec,
		getCodegraphMcpSpawnOptions,
		resolveCodegraphInstallation
	} = await import(pathToFileURL(WRAPPER_PATH).href)
	const CONFIG_RAW = readFileSync(join(REPOSITORY_ROOT, '.codex/config.toml'), 'utf8')
	const CONFIG_BODY = CONFIG_RAW.match(
		/\[mcp_servers\.codegraph\]\n([\s\S]*?)(?=\n\[|$)/
	)?.[1]

	assert.ok(CONFIG_BODY, 'CodeGraph MCP config table must exist')

	function parseJsonCompatibleTomlField(name) {
		const value = CONFIG_BODY.match(new RegExp(`^${name} = (.+)$`, 'm'))?.[1]
		assert.ok(value, `${name} must exist in the CodeGraph MCP config table`)
		return JSON.parse(value)
	}

	const CODEGRAPH_CONFIG = Object.freeze({
		command: parseJsonCompatibleTomlField('command'),
		args: parseJsonCompatibleTomlField('args'),
		cwd: CONFIG_BODY.match(/^cwd = (.+)$/m)?.[1]
			? parseJsonCompatibleTomlField('cwd')
			: undefined
	})

	function runConfiguredBootstrap(hostDirectory) {
		assert.equal(CODEGRAPH_CONFIG.command, 'node')
		return spawnSync(
			process.execPath,
			[...CODEGRAPH_CONFIG.args, '--', '--aromatika-resolve-only'],
			{
				cwd: CODEGRAPH_CONFIG.cwd
					? resolve(hostDirectory, CODEGRAPH_CONFIG.cwd)
					: hostDirectory,
				encoding: 'utf8',
				env: buildCodegraphMcpEnvironment(process.env)
			}
		)
	}

	test('CodeGraph is an exact project-local dependency and entrypoint', () => {
		const projectPackage = JSON.parse(
			readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8')
		)
		const installation = resolveCodegraphInstallation(REPOSITORY_ROOT)

		assert.equal(EXPECTED_CODEGRAPH_VERSION, '1.5.0')
		assert.equal(
			projectPackage.devDependencies['@colbymchenry/codegraph'],
			EXPECTED_CODEGRAPH_VERSION
		)
		assert.equal(installation.version, EXPECTED_CODEGRAPH_VERSION)
		assert.equal(installation.platformPackageVersion, EXPECTED_CODEGRAPH_VERSION)
		assert.equal(isAbsolute(installation.platformPackagePath), true)
		assert.equal(isAbsolute(installation.entrypoint), true)
		assert.equal(
			installation.entrypoint,
			realpathSync(
				join(REPOSITORY_ROOT, 'node_modules/@colbymchenry/codegraph/npm-shim.js')
			)
		)
	})

	test('CodeGraph MCP environment strips secrets and disables network self-heal', () => {
		const environment = buildCodegraphMcpEnvironment({
			PATH: '/approved/bin',
			HOME: '/approved/home',
			TEMP: '/approved/temp',
			CODEGRAPH_NO_DOWNLOAD: '0',
			CODEGRAPH_DOWNLOAD_BASE: 'https://hostile.invalid',
			CLOUDFLARE_API_TOKEN: 'sentinel-token',
			SUPABASE_SECRET_KEY: 'sentinel-key',
			TURNSTILE_SECRET: 'sentinel-secret',
			UNRELATED_VALUE: 'sentinel-unrelated'
		})

		assert.deepEqual(environment, {
			PATH: '/approved/bin',
			HOME: '/approved/home',
			TEMP: '/approved/temp',
			CODEGRAPH_NO_DOWNLOAD: '1'
		})
	})

	test('CodeGraph MCP environment allowlist is immutable and non-secret', () => {
		assert.deepEqual(CODEGRAPH_MCP_ENV_ALLOWLIST, [
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
		assert.equal(Object.isFrozen(CODEGRAPH_MCP_ENV_ALLOWLIST), true)
	})

	test('CodeGraph MCP child is spawned without a shell', () => {
		assert.deepEqual(
			getCodegraphMcpSpawnOptions({ PATH: '/approved/bin', SECRET: 'sentinel' }),
			{
				env: { PATH: '/approved/bin', CODEGRAPH_NO_DOWNLOAD: '1' },
				cwd: REPOSITORY_ROOT,
				stdio: 'inherit',
				shell: false,
				windowsHide: true
			}
		)
	})

	test('CodeGraph launch uses current Node and the local shim without a shell', () => {
		const entrypoint = join(
			REPOSITORY_ROOT,
			'node_modules/@colbymchenry/codegraph/npm-shim.js'
		)
		assert.deepEqual(getCodegraphMcpLaunchSpec('/usr/bin/node', entrypoint), {
			command: '/usr/bin/node',
			args: [entrypoint, 'serve', '--mcp']
		})
	})

	test('configured bootstrap resolves the trusted wrapper from root and nested sessions', () => {
		const expectedWrapper = realpathSync(WRAPPER_PATH)
		assert.equal(CODEGRAPH_CONFIG.cwd, undefined)

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
		const forgedRoot = mkdtempSync(join(REPOSITORY_ROOT, '.codegraph-mcp-forgery-'))
		const nestedDirectory = join(forgedRoot, 'src/routes')
		const forgedWrapper = join(forgedRoot, 'scripts/run-codegraph-mcp.mjs')
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
			assert.equal(result.stdout, realpathSync(WRAPPER_PATH))
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
			const sessionRoot = mkdtempSync(join(REPOSITORY_ROOT, '.codegraph-mcp-git-binary-'))
			const nestedDirectory = join(sessionRoot, 'nested')
			mkdirSync(nestedDirectory)
			copyFileSync(
				join(process.env.SYSTEMROOT, 'System32/where.exe'),
				join(nestedDirectory, 'git.exe')
			)

			try {
				const result = runConfiguredBootstrap(nestedDirectory)
				assert.equal(result.status, 0, result.stderr)
				assert.equal(result.stdout, realpathSync(WRAPPER_PATH))
			} finally {
				rmSync(sessionRoot, { recursive: true, force: true })
			}
		}
	)

	test('configured bootstrap prefers the containing Aromatika worktree over a nested Git root', () => {
		const nestedGitRoot = mkdtempSync(join(REPOSITORY_ROOT, '.codegraph-mcp-nested-git-'))
		const nestedDirectory = join(nestedGitRoot, 'nested')
		const forgedWrapper = join(nestedGitRoot, 'scripts/run-codegraph-mcp.mjs')
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
			env: buildCodegraphMcpEnvironment(process.env),
			shell: false,
			windowsHide: true
		})
		assert.equal(initialized.status, 0, initialized.stderr?.toString())

		try {
			const result = runConfiguredBootstrap(nestedDirectory)
			assert.equal(result.status, 0, result.stderr)
			assert.equal(result.stdout, realpathSync(WRAPPER_PATH))
			assert.doesNotMatch(result.stdout, /nested-git-wrapper-ran/)
		} finally {
			rmSync(nestedGitRoot, { recursive: true, force: true })
		}
	})

	test('configured bootstrap rejects an unrelated host', () => {
		const unrelatedRoot = mkdtempSync(join(tmpdir(), 'aromatika-codegraph-unrelated-'))
		const nestedDirectory = join(unrelatedRoot, 'nested')
		const forgedWrapper = join(unrelatedRoot, 'scripts/run-codegraph-mcp.mjs')
		mkdirSync(join(unrelatedRoot, '.codex'), { recursive: true })
		mkdirSync(dirname(forgedWrapper), { recursive: true })
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
		writeFileSync(forgedWrapper, "process.stdout.write('untrusted-wrapper-ran')\n", 'utf8')

		try {
			const result = runConfiguredBootstrap(nestedDirectory)
			assert.notEqual(result.status, 0)
			assert.equal(result.stdout, '')
			assert.match(result.stderr, /Aromatika Git worktree root not found/)
		} finally {
			rmSync(unrelatedRoot, { recursive: true, force: true })
		}
	})

	test('wrapper rejects a hostile root even when its manifest resembles the project', () => {
		const hostileRoot = mkdtempSync(join(tmpdir(), 'aromatika-codegraph-hostile-'))
		mkdirSync(join(hostileRoot, '.codex'))
		writeFileSync(
			join(hostileRoot, '.codex/aromatika-project-root'),
			'aromatika-codex-root-v1\n',
			'utf8'
		)
		writeFileSync(
			join(hostileRoot, 'package.json'),
			'{"name":"perfume-marketplace-bg","private":true}\n',
			'utf8'
		)

		try {
			assert.throws(
				() => resolveCodegraphInstallation(hostileRoot),
				/does not match the wrapper repository root/
			)
		} finally {
			rmSync(hostileRoot, { recursive: true, force: true })
		}
	})
}
