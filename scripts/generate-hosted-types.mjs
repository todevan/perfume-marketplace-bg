import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HOSTED_TYPES_TARGET = Object.freeze({
	projectRef: 'nuhkpqjjyuygiemrxbdp',
	schema: 'public',
	language: 'typescript',
	output: 'src/lib/server/database.types.ts'
});

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const linkedProjectRefPath = resolve(workspace, 'supabase/.temp/project-ref');
const outputPath = resolve(workspace, HOSTED_TYPES_TARGET.output);
const supabaseLauncher = resolve(workspace, 'node_modules/supabase/dist/supabase.js');

const GENERATED_HEADER = `/**
 * Generated from the hosted Frankfurt staging schema
 * (\`${HOSTED_TYPES_TARGET.projectRef}\`) with Supabase CLI.
 *
 * Regenerate after every applied schema migration. Application and UI modules
 * continue to consume DTOs from \`$lib/contracts\`, not raw database rows.
 */
`;

const VIEWS_HELPER = `export type Views<
  ViewName extends keyof Database["public"]["Views"],
> = Database["public"]["Views"][ViewName]["Row"]`;

const HELP = `Generate the deterministic Frankfurt hosted database types.

Usage:
  node scripts/generate-hosted-types.mjs
  node scripts/generate-hosted-types.mjs --check

Options:
  --check      Verify the committed file without writing it.
  -h, --help   Show this help.
  --version    Show the wrapper version.

Fixed target:
  Project: ${HOSTED_TYPES_TARGET.projectRef}
  Schema:  ${HOSTED_TYPES_TARGET.schema}
  Output:  ${HOSTED_TYPES_TARGET.output}

The command refuses to run unless the repository is linked to the fixed
Frankfurt project. It never accepts a project id, schema, output path, database
password, or service-role key from command-line arguments.`;

const VERSION = '1.0.0';

const CHILD_ENVIRONMENT_KEYS = Object.freeze([
	'APPDATA',
	'CI',
	'COMSPEC',
	'HOME',
	'HTTP_PROXY',
	'HTTPS_PROXY',
	'LANG',
	'LC_ALL',
	'LOCALAPPDATA',
	'NODE_EXTRA_CA_CERTS',
	'NO_COLOR',
	'NO_PROXY',
	'PATH',
	'PATHEXT',
	'SSL_CERT_DIR',
	'SSL_CERT_FILE',
	'SUPABASE_ACCESS_TOKEN',
	'SYSTEMROOT',
	'TEMP',
	'TERM',
	'TMP',
	'USERPROFILE',
	'WINDIR',
	'XDG_CONFIG_HOME'
]);

/**
 * @typedef {{
 *   status: number | null;
 *   signal?: NodeJS.Signals | null;
 *   stdout?: string | null;
 *   stderr?: string | null;
 *   error?: Error;
 * }} SpawnResult
 *
 * @typedef {(command: string, args: string[], options: {
 *   cwd: string;
 *   encoding: 'utf8';
 *   env: NodeJS.ProcessEnv;
 *   stdio: ['ignore', 'pipe', 'pipe'];
 *   maxBuffer: number;
 * }) => SpawnResult} SpawnImplementation
 *
 * @typedef {{
 *   readLinkedProjectRef?: () => string;
 *   generateCore?: (args: readonly string[], environment: NodeJS.ProcessEnv) => string;
 *   readCurrentOutput?: () => string | null;
 *   writeOutput?: (content: string) => void;
 * }} HostedTypeDependencies
 *
 * @typedef {{
 *   check?: boolean;
 *   environment?: NodeJS.ProcessEnv;
 *   dependencies?: HostedTypeDependencies;
 *   logger?: Pick<Console, 'info'>;
 * }} HostedTypeGenerationOptions
 */

export class HostedTypeGenerationError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'HostedTypeGenerationError';
	}
}

export class HostedTypeUsageError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'HostedTypeUsageError';
	}
}

/** @param {string} value */
function normalizeNewlines(value) {
	return value.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
}

export function hostedTypeArguments() {
	return Object.freeze([
		'gen',
		'types',
		'--project-id',
		HOSTED_TYPES_TARGET.projectRef,
		'--schema',
		HOSTED_TYPES_TARGET.schema,
		'--lang',
		HOSTED_TYPES_TARGET.language,
		'--agent',
		'no'
	]);
}

/**
 * The generator needs only the CLI login credential or its native credential
 * store. Database passwords, service keys, and unrelated provider secrets are
 * deliberately excluded from the child process.
 *
 * @param {NodeJS.ProcessEnv} environment
 */
export function hostedTypeCliEnvironment(environment) {
	/** @type {NodeJS.ProcessEnv} */
	const childEnvironment = {};
	for (const key of CHILD_ENVIRONMENT_KEYS) {
		const value = environment[key];
		if (typeof value === 'string') childEnvironment[key] = value;
	}
	return childEnvironment;
}

/**
 * @param {NodeJS.ProcessEnv} environment
 * @param {SpawnImplementation} [spawn]
 */
export function invokeHostedTypeGenerator(
	environment,
	spawn = /** @type {SpawnImplementation} */ (spawnSync)
) {
	const result = spawn(process.execPath, [supabaseLauncher, ...hostedTypeArguments()], {
		cwd: workspace,
		encoding: 'utf8',
		env: hostedTypeCliEnvironment(environment),
		stdio: ['ignore', 'pipe', 'pipe'],
		maxBuffer: 16 * 1024 * 1024
	});

	if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
		throw new HostedTypeGenerationError(
			'Hosted type generation failed. Provider output was suppressed because it may contain credentials.'
		);
	}
	return result.stdout;
}

/** @param {string} generatedCore */
export function composeHostedTypes(generatedCore) {
	const core = normalizeNewlines(generatedCore).trim();
	if (
		!core.startsWith('export type Json =') ||
		!core.includes('export type Database = {') ||
		!core.includes('  public: {') ||
		!core.includes('    Views: {')
	) {
		throw new HostedTypeGenerationError(
			'Supabase returned an unexpected TypeScript shape. The existing type file was not changed.'
		);
	}
	if (/^export type Views</mu.test(core)) {
		throw new HostedTypeGenerationError(
			'Supabase now emits the reserved Views helper. Update the wrapper before regenerating.'
		);
	}
	if (core.includes('\0')) {
		throw new HostedTypeGenerationError(
			'Supabase returned invalid TypeScript content. The existing type file was not changed.'
		);
	}
	return `${GENERATED_HEADER}${core}\n\n${VIEWS_HELPER}\n`;
}

function readLinkedProjectRef() {
	try {
		return readFileSync(linkedProjectRefPath, 'utf8').trim();
	} catch {
		throw new HostedTypeGenerationError(
			'No Supabase project link is available. Link the fixed Frankfurt staging project first.'
		);
	}
}

/** @param {() => string} readRef */
export function assertHostedTypeTarget(readRef) {
	const linkedRef = readRef().trim();
	if (linkedRef !== HOSTED_TYPES_TARGET.projectRef) {
		throw new HostedTypeGenerationError(
			'Refusing to generate hosted types because the repository is linked to an unexpected project.'
		);
	}
	return linkedRef;
}

function readCurrentOutput() {
	try {
		return readFileSync(outputPath, 'utf8');
	} catch (error) {
		if (
			typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			error.code === 'ENOENT'
		) {
			return null;
		}
		throw error;
	}
}

/** @param {string} content */
function writeOutput(content) {
	writeFileSync(outputPath, content, { encoding: 'utf8' });
}

/**
 * @param {HostedTypeGenerationOptions} [options]
 */
export function runHostedTypeGeneration({
	check = false,
	environment = process.env,
	dependencies = {},
	logger = console
} = {}) {
	const readRef = dependencies.readLinkedProjectRef ?? readLinkedProjectRef;
	const generateCore =
		dependencies.generateCore ??
		((_args, childEnvironment) => invokeHostedTypeGenerator(childEnvironment));
	const readOutput = dependencies.readCurrentOutput ?? readCurrentOutput;
	const persistOutput = dependencies.writeOutput ?? writeOutput;

	assertHostedTypeTarget(readRef);
	const argumentsList = hostedTypeArguments();
	const candidate = composeHostedTypes(generateCore(argumentsList, environment));
	const current = readOutput();
	const isCurrent =
		typeof current === 'string' && normalizeNewlines(current) === normalizeNewlines(candidate);

	if (isCurrent) {
		logger.info(
			`Hosted database types are current for ${HOSTED_TYPES_TARGET.projectRef} (${HOSTED_TYPES_TARGET.schema}).`
		);
		return Object.freeze({ changed: false, checked: check });
	}

	if (check) {
		throw new HostedTypeGenerationError(
			`Hosted database types are out of date. Run node scripts/${relative(
				resolve(workspace, 'scripts'),
				fileURLToPath(import.meta.url)
			).replaceAll('\\', '/')} to regenerate them.`
		);
	}

	persistOutput(candidate);
	logger.info(
		`Generated ${HOSTED_TYPES_TARGET.output} from ${HOSTED_TYPES_TARGET.projectRef} (${HOSTED_TYPES_TARGET.schema}).`
	);
	return Object.freeze({ changed: true, checked: false });
}

/** @param {string[]} argumentsList */
export function parseHostedTypeArguments(argumentsList) {
	if (argumentsList.includes('--help') || argumentsList.includes('-h')) {
		return Object.freeze({ help: true, version: false, check: false });
	}
	if (argumentsList.includes('--version')) {
		return Object.freeze({ help: false, version: true, check: false });
	}

	let check = false;
	for (const argument of argumentsList) {
		if (argument === '--check' && !check) {
			check = true;
			continue;
		}
		throw new HostedTypeUsageError(`Unexpected argument: ${argument}`);
	}
	return Object.freeze({ help: false, version: false, check });
}

async function main() {
	const cli = parseHostedTypeArguments(process.argv.slice(2));
	if (cli.help) {
		console.log(HELP);
		return;
	}
	if (cli.version) {
		console.log(VERSION);
		return;
	}
	runHostedTypeGeneration({ check: cli.check });
}

const isCli =
	Boolean(process.argv[1]) &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCli) {
	main().catch((cause) => {
		if (cause instanceof HostedTypeUsageError) {
			console.error(`${cause.message}\nUse --help for usage.`);
			process.exitCode = 2;
			return;
		}
		const message =
			cause instanceof HostedTypeGenerationError
				? cause.message
				: 'Hosted type generation failed closed.';
		console.error(message);
		process.exitCode = 1;
	});
}
