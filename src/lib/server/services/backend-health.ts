import { createClient } from '@supabase/supabase-js';
import type { Database } from '$lib/server/database.types';

const SUCCESS_CACHE_TTL_MS = 30_000;
const FAILURE_CACHE_TTL_MS = 2_000;
const PROBE_TIMEOUT_MS = 4_000;

export const STAGING_BACKEND_BASELINE = Object.freeze({
	origin: 'https://nuhkpqjjyuygiemrxbdp.supabase.co',
	counts: Object.freeze({
		brands: 196,
		brand_aliases: 48,
		brand_collection_memberships: 335
	})
});

type BaselineTable = keyof typeof STAGING_BACKEND_BASELINE.counts;
type BaselineCountColumn = 'id' | 'brand_id';
type AttestationFailureReason =
	| 'invalid_target'
	| 'missing_secret'
	| 'probe_failed'
	| 'count_mismatch';

interface CountResult {
	count: number | null;
	error: unknown | null;
}

const BASELINE_COUNT_COLUMNS: Readonly<Record<BaselineTable, BaselineCountColumn>> =
	Object.freeze({
		brands: 'id',
		brand_aliases: 'id',
		brand_collection_memberships: 'brand_id'
	});

export interface BackendHealthClient {
	from(table: BaselineTable): {
		select(
			columns: BaselineCountColumn,
			options: { count: 'exact'; head: true }
		): PromiseLike<CountResult>;
	};
}

export interface BackendAttestationInput {
	publicSupabaseUrl: string;
	supabaseSecretKey?: string;
}

export interface BackendAttestorDependencies {
	createClient?: (url: string, secretKey: string) => BackendHealthClient;
	now?: () => number;
	successCacheTtlMs?: number;
	failureCacheTtlMs?: number;
	probeTimeoutMs?: number;
}

interface CachedAttestation {
	key: string;
	status: 'healthy' | 'unhealthy';
	expiresAt: number;
}

interface InFlightAttestation {
	key: string;
	promise: Promise<void>;
}

export class BackendAttestationError extends Error {
	readonly code = 'backend_attestation_failed';

	constructor(readonly reason: AttestationFailureReason) {
		super('Hosted backend attestation failed.');
		this.name = 'BackendAttestationError';
	}
}

function normalizeExpectedOrigin(value: string): string {
	try {
		const url = new URL(value);
		if (
			url.origin !== STAGING_BACKEND_BASELINE.origin ||
			url.pathname !== '/' ||
			url.search ||
			url.hash ||
			url.username ||
			url.password
		) {
			throw new BackendAttestationError('invalid_target');
		}
		return url.origin;
	} catch (cause) {
		if (cause instanceof BackendAttestationError) throw cause;
		throw new BackendAttestationError('invalid_target');
	}
}

async function secretFingerprint(secretKey: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secretKey));
	return Array.from(new Uint8Array(digest).slice(0, 12), (byte) =>
		byte.toString(16).padStart(2, '0')
	).join('');
}

function defaultClientFactory(url: string, secretKey: string): BackendHealthClient {
	return createClient<Database>(url, secretKey, {
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false
		},
		global: {
			headers: {
				'X-Client-Info': 'perfume-marketplace-backend-attestation'
			}
		}
	}) as unknown as BackendHealthClient;
}

function withTimeout(probe: Promise<void>, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new BackendAttestationError('probe_failed')),
			timeoutMs
		);

		probe.then(resolve, reject).finally(() => clearTimeout(timeout));
	});
}

async function probeBaseline(client: BackendHealthClient): Promise<void> {
	const entries = Object.entries(STAGING_BACKEND_BASELINE.counts) as [
		BaselineTable,
		number
	][];
	const results = await Promise.all(
		entries.map(async ([table, expectedCount]) => {
			const result = await client.from(table).select(BASELINE_COUNT_COLUMNS[table], {
				count: 'exact',
				head: true
			});
			return { expectedCount, result };
		})
	);

	for (const { expectedCount, result } of results) {
		if (result.error || result.count === null) {
			throw new BackendAttestationError('probe_failed');
		}
		if (result.count !== expectedCount) {
			throw new BackendAttestationError('count_mismatch');
		}
	}
}

/**
 * Creates an isolate-local attestor. It never returns query data and collapses
 * provider errors into a non-sensitive failure contract.
 */
export function createBackendAttestor(
	dependencies: BackendAttestorDependencies = {}
): (input: BackendAttestationInput) => Promise<void> {
	const createHealthClient = dependencies.createClient ?? defaultClientFactory;
	const now = dependencies.now ?? Date.now;
	const successCacheTtlMs = dependencies.successCacheTtlMs ?? SUCCESS_CACHE_TTL_MS;
	const failureCacheTtlMs = dependencies.failureCacheTtlMs ?? FAILURE_CACHE_TTL_MS;
	const probeTimeoutMs = dependencies.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
	let cache: CachedAttestation | null = null;
	let inFlight: InFlightAttestation | null = null;

	return async (input: BackendAttestationInput): Promise<void> => {
		const origin = normalizeExpectedOrigin(input.publicSupabaseUrl);
		const secretKey = input.supabaseSecretKey?.trim();
		if (!secretKey) throw new BackendAttestationError('missing_secret');

		let fingerprint: string;
		try {
			fingerprint = await secretFingerprint(secretKey);
		} catch {
			throw new BackendAttestationError('probe_failed');
		}
		const cacheKey = `${origin}|${fingerprint}`;
		const checkedAt = now();

		if (cache?.key === cacheKey && cache.expiresAt > checkedAt) {
			if (cache.status === 'healthy') return;
			throw new BackendAttestationError('probe_failed');
		}

		if (inFlight?.key === cacheKey) return inFlight.promise;

		const promise = withTimeout(
			Promise.resolve()
				.then(() => createHealthClient(origin, secretKey))
				.then((client) => probeBaseline(client)),
			probeTimeoutMs
		)
			.then(() => {
				cache = {
					key: cacheKey,
					status: 'healthy',
					expiresAt: now() + successCacheTtlMs
				};
			})
			.catch((cause: unknown) => {
				cache = {
					key: cacheKey,
					status: 'unhealthy',
					expiresAt: now() + failureCacheTtlMs
				};
				if (cause instanceof BackendAttestationError) throw cause;
				throw new BackendAttestationError('probe_failed');
			});

		inFlight = { key: cacheKey, promise };
		try {
			await promise;
		} finally {
			if (inFlight?.promise === promise) inFlight = null;
		}
	};
}

export const attestHostedBackendBaseline = createBackendAttestor();
