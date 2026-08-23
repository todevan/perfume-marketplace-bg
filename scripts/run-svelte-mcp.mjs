import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SVELTE_MCP_ENTRYPOINT = 'node_modules/@sveltejs/mcp/dist/index.mjs'
export const SVELTE_MCP_ENV_ALLOWLIST = Object.freeze([
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

export function buildSvelteMcpEnvironment(source = process.env) {
	const environment = {}

	for (const name of SVELTE_MCP_ENV_ALLOWLIST) {
		if (typeof source[name] === 'string') {
			environment[name] = source[name]
		}
	}

	return environment
}

export function getSvelteMcpLaunchSpec(_platform = process.platform, execPath = process.execPath) {
	return {
		command: execPath,
		args: [SVELTE_MCP_ENTRYPOINT]
	}
}

export function getSvelteMcpSpawnOptions(sourceEnvironment = process.env) {
	return {
		env: buildSvelteMcpEnvironment(sourceEnvironment),
		stdio: 'inherit',
		shell: false,
		windowsHide: true
	}
}

export function launchSvelteMcp({
	sourceEnvironment = process.env,
	execPath = process.execPath,
	spawnProcess = spawn
} = {}) {
	const { command, args } = getSvelteMcpLaunchSpec(process.platform, execPath)
	const child = spawnProcess(command, args, getSvelteMcpSpawnOptions(sourceEnvironment))

	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.once(signal, () => child.kill(signal))
	}

	child.once('error', (error) => {
		console.error(`Unable to start the Svelte MCP: ${error.message}`)
		process.exitCode = 1
	})

	child.once('exit', (code) => {
		process.exitCode = code ?? 1
	})

	return child
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined

if (invokedPath === import.meta.url) {
	launchSvelteMcp()
}
