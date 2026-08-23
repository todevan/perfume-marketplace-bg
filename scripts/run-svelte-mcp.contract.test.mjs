import assert from 'node:assert/strict'
import { isAbsolute, resolve } from 'node:path'
import test from 'node:test'

import {
	SVELTE_MCP_ENTRYPOINT,
	SVELTE_MCP_ENV_ALLOWLIST,
	buildSvelteMcpEnvironment,
	getSvelteMcpLaunchSpec,
	getSvelteMcpSpawnOptions
} from './run-svelte-mcp.mjs'

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
