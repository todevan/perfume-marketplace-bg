import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

/**
 * @typedef {{
 *   projectUrl: string;
 *   serviceRoleKey: string;
 * }} CatalogSeedConfiguration
 *
 * @typedef {{
 *   syncRunId: string;
 *   brands: number;
 *   aliases: number;
 *   memberships: number;
 * }} CatalogSeedResult
 *
 * @typedef {{
 *   projectUrl: string;
 *   serviceRoleKey: string;
 *   createClientImpl?: typeof createClient;
 *   logger?: Pick<Console, 'log'>;
 * }} CatalogSeedOptions
 */

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class CatalogSeedError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'CatalogSeedError';
	}
}

/**
 * @param {string} rawUrl
 * @returns {URL}
 */
function parseSupabaseUrl(rawUrl) {
	let parsed;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new CatalogSeedError('PUBLIC_SUPABASE_URL must be a valid Supabase origin.');
	}
	if (
		parsed.username ||
		parsed.password ||
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash
	) {
		throw new CatalogSeedError(
			'PUBLIC_SUPABASE_URL must be a credential-free Supabase origin.'
		);
	}
	return parsed;
}

/**
 * The raw package command is intentionally local-only. Hosted catalogue writes
 * must enter through staging-db-operator.mjs, which verifies the exact project
 * and service-role key before calling seedCatalog directly.
 *
 * @param {NodeJS.ProcessEnv} environment
 * @returns {CatalogSeedConfiguration}
 */
export function resolveLocalSeedConfiguration(environment) {
	const projectUrl = environment.PUBLIC_SUPABASE_URL?.trim();
	const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
	if (!projectUrl || !serviceRoleKey) {
		throw new CatalogSeedError(
			'Set the local Supabase URL and service-role key before seeding.'
		);
	}

	const parsed = parseSupabaseUrl(projectUrl);
	if (!LOCAL_HOSTS.has(parsed.hostname) || !['http:', 'https:'].includes(parsed.protocol)) {
		throw new CatalogSeedError(
			'seed:catalog is local-only. Use the guarded seed:staging command for hosted data.'
		);
	}

	return Object.freeze({ projectUrl: parsed.origin, serviceRoleKey });
}

/**
 * Executes the single atomic catalogue RPC. This function deliberately accepts
 * explicit values instead of reading process.env, so the staging operator can
 * pass only the two already-verified credentials without spawning a child.
 *
 * @param {CatalogSeedOptions} options
 * @returns {Promise<CatalogSeedResult>}
 */
export async function seedCatalog({
	projectUrl,
	serviceRoleKey,
	createClientImpl = createClient,
	logger = console
}) {
	if (!projectUrl?.trim() || !serviceRoleKey?.trim()) {
		throw new CatalogSeedError('Catalogue seed configuration is incomplete.');
	}

	const parsed = parseSupabaseUrl(projectUrl);
	const isLocal = LOCAL_HOSTS.has(parsed.hostname);
	if (
		(!isLocal && parsed.protocol !== 'https:') ||
		(isLocal && !['http:', 'https:'].includes(parsed.protocol))
	) {
		throw new CatalogSeedError('Catalogue seed target uses an unsupported protocol.');
	}

	const catalog = JSON.parse(
		await readFile(new URL('../catalog/brand-categories.json', import.meta.url), 'utf8')
	);

	let response;
	try {
		const supabase = createClientImpl(parsed.origin, serviceRoleKey, {
			auth: { autoRefreshToken: false, persistSession: false }
		});
		// PostgreSQL validates the complete payload and performs every write in
		// one transaction; any invalid collection rolls the synchronization back.
		response = await supabase.rpc('sync_editorial_catalog', {
			catalog_payload: catalog
		});
	} catch {
		throw new CatalogSeedError(
			'Atomic catalogue sync failed. Inspect the trusted database logs.'
		);
	}

	if (response.error) {
		// Provider diagnostics are intentionally not propagated: an upstream
		// client error must never reflect credentials or raw authorization data.
		throw new CatalogSeedError(
			'Atomic catalogue sync failed. Inspect the trusted database logs.'
		);
	}

	const result = response.data;
	if (
		!result ||
		typeof result !== 'object' ||
		!('syncRunId' in result) ||
		typeof result.syncRunId !== 'string' ||
		!UUID_PATTERN.test(result.syncRunId) ||
		!('brands' in result) ||
		!Number.isInteger(result.brands) ||
		!('aliases' in result) ||
		!Number.isInteger(result.aliases) ||
		!('memberships' in result) ||
		!Number.isInteger(result.memberships)
	) {
		throw new CatalogSeedError(
			'Atomic catalogue sync returned an invalid result. Check the applied migration version.'
		);
	}

	const summary = /** @type {CatalogSeedResult} */ ({
		syncRunId: result.syncRunId,
		brands: result.brands,
		aliases: result.aliases,
		memberships: result.memberships
	});
	logger.log(
		`Catalog sync ${summary.syncRunId} complete: ${summary.brands} brands, ${summary.aliases} aliases, ${summary.memberships} editorial memberships.`
	);
	return summary;
}

async function main() {
	try {
		process.loadEnvFile?.('.env');
	} catch (error) {
		if (
			!(
				typeof error === 'object' &&
				error !== null &&
				'code' in error &&
				error.code === 'ENOENT'
			)
		) {
			throw error;
		}
	}

	await seedCatalog(resolveLocalSeedConfiguration(process.env));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === resolve(fileURLToPath(import.meta.url))) {
	main().catch((error) => {
		const message =
			error instanceof CatalogSeedError
				? error.message
				: 'Catalogue seed failed closed. Inspect trusted operator logs.';
		console.error(message);
		process.exitCode = 1;
	});
}
