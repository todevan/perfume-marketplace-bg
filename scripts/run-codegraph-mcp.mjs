import { spawn } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const EXPECTED_CODEGRAPH_VERSION = '1.5.0'
export const CODEGRAPH_MCP_ENV_ALLOWLIST = Object.freeze([
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

const WRAPPER_REPOSITORY_ROOT = realpathSync(
	resolve(dirname(fileURLToPath(import.meta.url)), '..')
)

function assertPathInsideRoot(root, candidate, description) {
	const candidateRelative = relative(root, candidate)
	if (
		candidateRelative === '' ||
		candidateRelative === '..' ||
		candidateRelative.startsWith(`..${sep}`) ||
		isAbsolute(candidateRelative)
	) {
		throw new Error(`${description} is outside the project root`)
	}
}

export function resolveCodegraphInstallation(repositoryRoot = WRAPPER_REPOSITORY_ROOT) {
	const root = realpathSync(repositoryRoot)
	if (root !== WRAPPER_REPOSITORY_ROOT) {
		throw new Error('CodeGraph launch root does not match the wrapper repository root')
	}

	const marker = readFileSync(join(root, '.codex/aromatika-project-root'), 'utf8')
	const projectPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
	if (
		marker !== 'aromatika-codex-root-v1\n' ||
		projectPackage.name !== 'perfume-marketplace-bg' ||
		projectPackage.private !== true
	) {
		throw new Error('CodeGraph launch root failed the Aromatika project identity check')
	}
	if (
		projectPackage.devDependencies?.['@colbymchenry/codegraph'] !==
		EXPECTED_CODEGRAPH_VERSION
	) {
		throw new Error('CodeGraph must be an exact project development dependency')
	}

	const packageDirectory = realpathSync(
		join(root, 'node_modules/@colbymchenry/codegraph')
	)
	const packagePath = realpathSync(join(packageDirectory, 'package.json'))
	const entrypoint = realpathSync(join(packageDirectory, 'npm-shim.js'))
	const platformPackagePath = realpathSync(
		join(
			dirname(packageDirectory),
			`codegraph-${process.platform}-${process.arch}`,
			'package.json'
		)
	)
	assertPathInsideRoot(root, packagePath, 'CodeGraph package manifest')
	assertPathInsideRoot(root, entrypoint, 'CodeGraph entrypoint')
	assertPathInsideRoot(root, platformPackagePath, 'CodeGraph platform package manifest')
	if (
		!statSync(packagePath).isFile() ||
		!statSync(entrypoint).isFile() ||
		!statSync(platformPackagePath).isFile()
	) {
		throw new Error('CodeGraph package manifests and entrypoint must be files')
	}

	const codegraphPackage = JSON.parse(readFileSync(packagePath, 'utf8'))
	const platformPackage = JSON.parse(readFileSync(platformPackagePath, 'utf8'))
	if (
		codegraphPackage.name !== '@colbymchenry/codegraph' ||
		codegraphPackage.version !== EXPECTED_CODEGRAPH_VERSION ||
		codegraphPackage.bin?.codegraph !== 'npm-shim.js' ||
		platformPackage.name !==
			`@colbymchenry/codegraph-${process.platform}-${process.arch}` ||
		platformPackage.version !== EXPECTED_CODEGRAPH_VERSION
	) {
		throw new Error('Installed CodeGraph package identity or version is not approved')
	}

	return Object.freeze({
		root,
		entrypoint,
		version: codegraphPackage.version,
		platformPackagePath,
		platformPackageVersion: platformPackage.version
	})
}

export function buildCodegraphMcpEnvironment(source = process.env) {
	const environment = {}
	for (const name of CODEGRAPH_MCP_ENV_ALLOWLIST) {
		if (typeof source[name] === 'string') {
			environment[name] = source[name]
		}
	}

	return { ...environment, CODEGRAPH_NO_DOWNLOAD: '1' }
}

export function getCodegraphMcpLaunchSpec(
	execPath = process.execPath,
	entrypoint = resolveCodegraphInstallation().entrypoint
) {
	return {
		command: execPath,
		args: [entrypoint, 'serve', '--mcp']
	}
}

export function getCodegraphMcpSpawnOptions(sourceEnvironment = process.env) {
	return {
		env: buildCodegraphMcpEnvironment(sourceEnvironment),
		cwd: WRAPPER_REPOSITORY_ROOT,
		stdio: 'inherit',
		shell: false,
		windowsHide: true
	}
}

export function launchCodegraphMcp({
	repositoryRoot = WRAPPER_REPOSITORY_ROOT,
	sourceEnvironment = process.env,
	execPath = process.execPath,
	spawnProcess = spawn
} = {}) {
	const installation = resolveCodegraphInstallation(repositoryRoot)
	const { command, args } = getCodegraphMcpLaunchSpec(execPath, installation.entrypoint)
	const child = spawnProcess(command, args, getCodegraphMcpSpawnOptions(sourceEnvironment))

	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.once(signal, () => child.kill(signal))
	}
	child.once('error', (error) => {
		console.error(`Unable to start the CodeGraph MCP: ${error.message}`)
		process.exitCode = 1
	})
	child.once('exit', (code) => {
		process.exitCode = code ?? 1
	})

	return child
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined

if (invokedPath === import.meta.url) {
	launchCodegraphMcp()
}
