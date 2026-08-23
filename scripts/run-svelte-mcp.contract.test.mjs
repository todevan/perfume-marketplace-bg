import assert from 'node:assert/strict'
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
	assert.equal(SVELTE_MCP_ENTRYPOINT, 'node_modules/@sveltejs/mcp/dist/index.mjs')
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
	assert.deepEqual(getSvelteMcpLaunchSpec('win32', 'C:\\Program Files\\nodejs\\node.exe'), {
		command: 'C:\\Program Files\\nodejs\\node.exe',
		args: ['node_modules/@sveltejs/mcp/dist/index.mjs']
	})
})

test('POSIX launch uses the current Node executable without a command shell', () => {
	assert.deepEqual(getSvelteMcpLaunchSpec('linux', '/usr/bin/node'), {
		command: '/usr/bin/node',
		args: ['node_modules/@sveltejs/mcp/dist/index.mjs']
	})
})
