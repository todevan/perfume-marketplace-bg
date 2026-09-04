import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

function fail(message) {
	failures.push(message)
}

function read(path) {
	return readFileSync(join(ROOT, path), 'utf8')
}

function filesUnder(start, predicate = () => true) {
	const output = []
	const excluded = new Set([
		'.git',
		'.codegraph',
		'.svelte-kit',
		'node_modules',
		'playwright-report',
		'test-results'
	])

	function visit(absolute) {
		for (const entry of readdirSync(absolute, { withFileTypes: true })) {
			if (excluded.has(entry.name)) continue
			const candidate = join(absolute, entry.name)
			if (entry.isDirectory()) visit(candidate)
			else if (entry.isFile() && predicate(candidate)) output.push(candidate)
		}
	}

	visit(join(ROOT, start))
	return output
}

const requiredPaths = [
	'AGENTS.md',
	'docs/agents/CONTEXT.md',
	...['01-orient', '02-shape', '03-implement', '04-verify', '05-hosted-proof', '06-complete'].map(
		(stage) => `docs/agents/${stage}/CONTEXT.md`
	),
	...[
		'AUTHORITY',
		'ISSUE-CONTRACT',
		'SKILLS',
		'MEMORY',
		'WORKTREES',
		'MODELS-AND-TOOLS',
		'HOSTED-PROOF'
	].map((name) => `docs/agents/reference/${name}.md`),
	...['CHECKPOINT', 'HOSTED-TRANSACTION', 'POSTMORTEM'].map(
		(name) => `docs/agents/templates/${name}.md`
	),
	'docs/agents/postmortems/2026-09-04-issue-22.md',
	'docs/archive/README.md'
]

for (const path of requiredPaths) {
	if (!existsSync(join(ROOT, path))) fail(`missing required path: ${path}`)
}

const rootAgents = read('AGENTS.md')
const rootLineCount = rootAgents.split(/\r?\n/u).length - (rootAgents.endsWith('\n') ? 1 : 0)
if (rootLineCount > 100) fail(`root AGENTS.md has ${rootLineCount} lines; maximum is 100`)

const compatibilityPaths = [
	'docs/agents/AUTONOMY.md',
	'docs/agents/EXECUTION-LOOP.md',
	'docs/agents/HUMAN-GATES.md',
	'docs/agents/SKILL-ROUTER.md',
	'docs/agents/domain.md',
	'docs/agents/issue-tracker.md'
]
for (const path of compatibilityPaths) {
	const body = read(path)
	const lines = body.trimEnd().split(/\r?\n/u).length
	if (lines > 12) fail(`${path} duplicates policy instead of remaining a concise pointer`)
	if (!/non-authoritative/iu.test(body)) fail(`${path} lacks a non-authoritative boundary`)
	if (!/\]\([^)]*\.md(?:#[^)]*)?\)/u.test(body)) fail(`${path} does not point to a canonical Markdown contract`)
}

const markdownFiles = filesUnder('.', (path) => extname(path).toLowerCase() === '.md')
const touchedMarkdown = markdownFiles.filter((absolute) => {
	const path = relative(ROOT, absolute).split(sep).join('/')
	return (
		path === 'AGENTS.md' ||
		path === 'docs/reviews/README.md' ||
		path.startsWith('docs/agents/') ||
		path.startsWith('docs/archive/')
	)
})
for (const absolute of touchedMarkdown) {
	if (!readFileSync(absolute).toString('utf8').endsWith('\n')) {
		fail(`${relative(ROOT, absolute)} lacks a final newline`)
	}
}

for (const absolute of markdownFiles) {
	const body = readFileSync(absolute, 'utf8')
	const source = relative(ROOT, absolute).split(sep).join('/')
	const links = body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)
	for (const match of links) {
		let target = match[1].trim()
		if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
		target = target.split(/\s+["']/u)[0]
		if (
			!target ||
			target.startsWith('#') ||
			/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(target) ||
			/[{}*]/u.test(target)
		) {
			continue
		}
		const pathPart = decodeURIComponent(target.split('#')[0].split('?')[0])
		if (!pathPart || (pathPart.startsWith('/') && extname(pathPart) === '')) continue
		const resolved = pathPart.startsWith('/')
			? join(ROOT, pathPart.slice(1))
			: resolve(dirname(absolute), pathPart)
		if (!resolved.startsWith(`${ROOT}${sep}`) && resolved !== ROOT) {
			fail(`${source} links outside the repository: ${target}`)
			continue
		}
		if (!existsSync(resolved)) fail(`${source} has broken relative link: ${target}`)
	}
}

const archiveMarkdown = filesUnder('docs/archive', (path) => extname(path).toLowerCase() === '.md')
for (const absolute of archiveMarkdown) {
	const prefix = readFileSync(absolute, 'utf8').slice(0, 1200)
	if (!/Historical archive — non-authoritative\./u.test(prefix)) {
		fail(`${relative(ROOT, absolute)} lacks the archive authority banner`)
	}
}

const activeAgentPaths = [
	join(ROOT, 'AGENTS.md'),
	...filesUnder('docs/agents', (path) => {
		const rel = relative(ROOT, path).split(sep).join('/')
		return extname(path) === '.md' && !rel.startsWith('docs/agents/postmortems/')
	})
]
const activePolicyPaths = [
	...activeAgentPaths,
	...[
		'docs/AROMATIKA-LAUNCH-READINESS-DESIGN.md',
		'docs/INCIDENT-RESPONSE.md',
		'docs/PRODUCTION-SETUP.md'
	].map((path) => join(ROOT, path))
]
const activePolicyText = activePolicyPaths
	.map((path) => `${relative(ROOT, path)}\n${readFileSync(path, 'utf8')}`)
	.join('\n')
if (/(?:Issue\s*#22.{0,40}(?:is|remains)\s+(?:active|pending)|active\s+Issue\s*#22)/isu.test(activePolicyText)) {
	fail('active agent authority claims Issue #22 is active or pending')
}
if (
	/Superpowers[^\n]{0,40}(?:primary|global|sole)[^\n]{0,30}(?:process|lifecycle)|Superpowers\s+governs\s+engineering\s+process/iu.test(
		activePolicyText
	)
) {
	fail('active agent authority claims Superpowers owns the global process')
}
if (
	/local-first\s+authority\s+model|cheap\s+worker\s*->|select[^\n]{0,80}next[^\n]{0,40}issue[^\n]{0,80}continue|WORKFLOW\.md[^\n]{0,80}detailed\s+engineering\s+lifecycle/iu.test(
		activePolicyText
	)
) {
	fail('active policy document contains a retired authority or lifecycle route')
}
if (/Exactly\s+one\s+product\s+issue\s+carries\s+`agent:active`/iu.test(activePolicyText)) {
	fail('active policy forbids the valid zero-active-issue state')
}
if (!rootAgents.includes('At most one product issue carries `agent:active`')) {
	fail('root router does not define the at-most-one active product issue invariant')
}
if (!rootAgents.includes('cannot\nclassify away changed-surface risk')) {
	fail('root router lacks the mandatory issue-risk non-waiver rule')
}
if (/\/home\/(?!<user>\/)[A-Za-z0-9._-]+\/|[A-Z]:\\Users\\[^\\]+\\/u.test(activePolicyText)) {
	fail('active repository agent documentation contains a hardcoded user home path')
}

const canonicalHeadingHomes = new Map([
	['## Blocker classes', 'docs/agents/reference/ISSUE-CONTRACT.md'],
	['## Manifest state machine', 'docs/agents/reference/HOSTED-PROOF.md'],
	['## Allowed classes', 'docs/agents/reference/MEMORY.md'],
	['## Removal gate', 'docs/agents/reference/WORKTREES.md'],
	['## Mandatory R2 gate', 'docs/agents/SECURITY.md']
])
for (const [heading, expected] of canonicalHeadingHomes) {
	const homes = activeAgentPaths
		.filter((path) => readFileSync(path, 'utf8').split(/\r?\n/u).includes(heading))
		.map((path) => relative(ROOT, path).split(sep).join('/'))
	if (homes.length !== 1 || homes[0] !== expected) {
		fail(`${heading} must have one active home at ${expected}; found ${homes.join(', ') || 'none'}`)
	}
}

const allowedInstructionPaths = new Set([
	'AGENTS.md',
	'scripts/AGENTS.md',
	'src/AGENTS.md',
	'supabase/AGENTS.md',
	'tests/AGENTS.md'
])
const instructionShadows = filesUnder('.', (path) =>
	['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md'].includes(path.split(sep).at(-1))
)
	.map((path) => relative(ROOT, path).split(sep).join('/'))
	.filter((path) => !allowedInstructionPaths.has(path))
if (instructionShadows.length > 0) {
	fail(`unexpected instruction shadows: ${instructionShadows.join(', ')}`)
}

const skills = read('docs/agents/reference/SKILLS.md')
for (const name of ['grill-with-docs', 'Superpowers', 'ICM Architect', 'Impeccable', 'Engram']) {
	if (!skills.includes(name)) fail(`skill manifest is missing ${name}`)
}

const config = read('.codex/config.toml')
for (const table of config.split(/(?=^\[mcp_servers\.)/mu)) {
	if (!table.startsWith('[mcp_servers.')) continue
	const enabled = !/^enabled\s*=\s*false\s*$/mu.test(table)
	if (enabled && /@latest\b/u.test(table)) {
		fail(`enabled project MCP uses unpinned @latest: ${table.split(/\r?\n/u)[0]}`)
	}
}
const configResult = spawnSync('python', ['scripts/validate-codex-config.py'], {
	cwd: ROOT,
	encoding: 'utf8',
	env: process.env,
	windowsHide: true
})
if (configResult.error || configResult.status !== 0) {
	fail(`project Codex configuration is invalid: ${(configResult.error?.message ?? configResult.stderr).trim()}`)
}

const playwrightCli = join(ROOT, 'node_modules/@playwright/test/cli.js')
if (!existsSync(playwrightCli)) {
	fail('locked dependencies are missing; cannot verify hosted Playwright discovery')
} else {
	const discovery = spawnSync(
		process.execPath,
		[
			playwrightCli,
			'test',
			'--config',
			join(ROOT, 'scripts/issue22-hosted/playwright.config.mjs'),
			'--list'
		],
		{
			cwd: ROOT,
			encoding: 'utf8',
			env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
			windowsHide: true
		}
	)
	if (discovery.error || discovery.status !== 0) {
		fail(`hosted Playwright discovery failed: ${(discovery.error?.message ?? discovery.stderr).trim()}`)
	} else if (!/Total:\s+[1-9][0-9]*\s+tests?\s+in\s+[1-9][0-9]*\s+files?/u.test(discovery.stdout)) {
		fail('hosted Playwright configuration discovers zero tests')
	} else if (!discovery.stdout.includes('issue22-hosted-proof.e2e.mjs')) {
		fail('hosted Playwright configuration does not discover the proven Issue #22 proof')
	}
}

const sensitivePaths = [
	'docs/agents/postmortems/2026-09-04-issue-22.md',
	'docs/agents/templates/CHECKPOINT.md',
	'docs/agents/templates/HOSTED-TRANSACTION.md',
	'docs/agents/templates/POSTMORTEM.md'
]
const secretPatterns = [
	{ name: 'email address', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu },
	{ name: 'JWT-like value', pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u },
	{ name: 'private local path', pattern: /(?:\/home\/[A-Za-z0-9._-]+\/|\/tmp\/)[^\s`)]+/u },
	{ name: 'credential URL parameter', pattern: /[?&](?:access_token|refresh_token|token_hash|code)=[^\s&)]+/iu },
	{ name: 'provider project hostname', pattern: /https:\/\/[a-z]{20}\.supabase\.co/iu }
]
for (const path of sensitivePaths) {
	const body = read(path)
	for (const { name, pattern } of secretPatterns) {
		if (pattern.test(body)) fail(`${path} contains a ${name}`)
	}
}

JSON.parse(read('package.json'))
const projectStatus = read('docs/PROJECT-STATUS.md')
for (const pattern of [
	/agent:active/iu,
	/\bPR\s*#\d+/u,
	/\bCandidate:\s*[0-9a-f]{7,40}/iu,
	/\bNext (?:issue|task)\b/iu,
	/^##\s+\d{4}-\d{2}-\d{2}/mu
]) {
	if (pattern.test(projectStatus)) {
		fail('docs/PROJECT-STATUS.md is being used as an issue or activity ledger')
		break
	}
}

if (failures.length > 0) {
	for (const message of failures) console.error(`Agent system validation failed: ${message}`)
	process.exitCode = 1
} else {
	console.log(
		`Agent system validation passed (${requiredPaths.length} required paths, ${markdownFiles.length} Markdown files, nonzero hosted proof discovery)`
	)
}
