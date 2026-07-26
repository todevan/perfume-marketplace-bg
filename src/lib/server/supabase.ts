import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseServerEnvironment {
	PUBLIC_SUPABASE_URL?: string;
	PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
	PUBLIC_SUPABASE_ANON_KEY?: string;
	SUPABASE_SECRET_KEY?: string;
	SUPABASE_SERVICE_ROLE_KEY?: string;
}

export class SupabaseConfigurationError extends Error {
	readonly code = 'supabase_configuration_error';

	constructor(readonly missingVariables: readonly string[], message?: string) {
		super(message ?? `Missing required Supabase environment: ${missingVariables.join(', ')}`);
		this.name = 'SupabaseConfigurationError';
	}
}

function requireEnvironment(
	environment: SupabaseServerEnvironment,
	key: keyof SupabaseServerEnvironment
): string {
	const value = environment[key]?.trim();
	if (!value) throw new SupabaseConfigurationError([key]);
	return value;
}

function requireFirstEnvironment(
	environment: SupabaseServerEnvironment,
	keys: readonly (keyof SupabaseServerEnvironment)[]
): string {
	for (const key of keys) {
		const value = environment[key]?.trim();
		if (value) return value;
	}
	throw new SupabaseConfigurationError(keys, `Missing required Supabase environment: ${keys.join(' or ')}`);
}

function requireProjectUrl(environment: SupabaseServerEnvironment): string {
	const rawUrl = requireEnvironment(environment, 'PUBLIC_SUPABASE_URL');
	try {
		const url = new URL(rawUrl);
		if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
			throw new Error('Supabase URL must use HTTPS outside local development.');
		}
		return url.toString().replace(/\/$/, '');
	} catch (error) {
		throw new SupabaseConfigurationError(
			['PUBLIC_SUPABASE_URL'],
			error instanceof Error ? `Invalid PUBLIC_SUPABASE_URL: ${error.message}` : 'Invalid PUBLIC_SUPABASE_URL.'
		);
	}
}

function buildServerClient(url: string, key: string): SupabaseClient {
	return createClient(url, key, {
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false
		},
		global: { headers: { 'X-Client-Info': 'perfume-marketplace-server' } }
	});
}

/**
 * Privileged client for trusted server jobs and payment/moderation workflows only.
 * Never return this client, its key, or query results containing private columns to browser code.
 */
export function createServiceRoleSupabaseClient(
	environment: SupabaseServerEnvironment
): SupabaseClient {
	return buildServerClient(
		requireProjectUrl(environment),
		requireFirstEnvironment(environment, ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
	);
}

/**
 * Stateless anon client for public server-side reads. User-scoped SSR requests should instead
 * use a cookie-aware client at the route boundary so the caller's JWT and RLS identity are kept.
 */
export function createAnonSupabaseClient(environment: SupabaseServerEnvironment): SupabaseClient {
	return buildServerClient(
		requireProjectUrl(environment),
		requireFirstEnvironment(environment, [
			'PUBLIC_SUPABASE_PUBLISHABLE_KEY',
			'PUBLIC_SUPABASE_ANON_KEY'
		])
	);
}
