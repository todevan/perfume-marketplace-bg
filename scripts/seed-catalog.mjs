import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

try {
	process.loadEnvFile?.('.env');
} catch (error) {
	if (error?.code !== 'ENOENT') throw error;
}

const projectUrl = process.env.PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!projectUrl || !serviceRoleKey) {
	console.error(
		'Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before seeding. The service key must never be exposed to browser code.'
	);
	process.exit(1);
}

const parsedUrl = new URL(projectUrl);
if (
	parsedUrl.protocol !== 'https:' &&
	parsedUrl.hostname !== 'localhost' &&
	parsedUrl.hostname !== '127.0.0.1'
) {
	throw new Error('PUBLIC_SUPABASE_URL must use HTTPS outside local development.');
}

const catalog = JSON.parse(
	await readFile(new URL('../catalog/brand-categories.json', import.meta.url), 'utf8')
);
const supabase = createClient(projectUrl, serviceRoleKey, {
	auth: { autoRefreshToken: false, persistSession: false }
});

// This is intentionally the only database request. PostgreSQL validates the
// complete payload and performs every write inside the RPC transaction; any
// conflict or invalid collection rolls back the entire synchronization.
const { data: result, error } = await supabase.rpc('sync_editorial_catalog', {
	catalog_payload: catalog
});

if (error) {
	const diagnostics = [error.message, error.details, error.hint].filter(Boolean).join(' -- ');
	throw new Error(`Atomic catalogue sync failed: ${diagnostics}`);
}

if (!result || typeof result !== 'object' || typeof result.syncRunId !== 'string') {
	throw new Error('Atomic catalogue sync returned an invalid result. Check the applied migration version.');
}

console.log(
	`Catalog sync ${result.syncRunId} complete: ${result.brands} brands, ${result.aliases} aliases, ${result.memberships} editorial memberships.`
);
