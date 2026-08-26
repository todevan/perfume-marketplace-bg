import { describe, expect, it, vi } from 'vitest';
import {
	BackendAttestationError,
	createBackendAttestor,
	STAGING_BACKEND_BASELINE,
	VERIFICATION_BACKEND_BASELINE,
	type BackendHealthClient
} from '../../src/lib/server/services/backend-health';

type BaselineTable = keyof typeof STAGING_BACKEND_BASELINE.counts;

function mockClient(
	counts: Partial<Record<BaselineTable, number | null>>,
	errorTable?: BaselineTable,
	selections: Array<{
		table: BaselineTable;
		columns: 'id' | 'brand_id';
		options: { count: 'exact'; head: true };
	}> = []
): BackendHealthClient {
	return {
		from: vi.fn((table: BaselineTable) => ({
			select: vi.fn(
				async (
					columns: 'id' | 'brand_id',
					options: { count: 'exact'; head: true }
				) => {
					selections.push({ table, columns, options });
					return {
						count: counts[table] ?? null,
						error:
							table === errorTable
								? { code: 'provider-error', secret: 'must-not-leak' }
								: null
					};
				}
			)
		}))
	};
}

describe('hosted backend baseline attestation', () => {
	it('uses only exact head counts and caches a healthy result briefly', async () => {
		let currentTime = 1_000;
		const selections: Parameters<typeof mockClient>[2] = [];
		const client = mockClient(STAGING_BACKEND_BASELINE.counts, undefined, selections);
		const createClient = vi.fn(() => client);
		const attest = createBackendAttestor({
			createClient,
			now: () => currentTime,
			successCacheTtlMs: 30_000
		});
		const input = {
			appEnvironment: 'staging' as const,
			publicSupabaseUrl: STAGING_BACKEND_BASELINE.origin,
			supabaseSecretKey: 'server-secret-value'
		};

		await attest(input);
		await attest(input);

		expect(createClient).toHaveBeenCalledOnce();
		expect(createClient).toHaveBeenCalledWith(
			STAGING_BACKEND_BASELINE.origin,
			'server-secret-value'
		);
		expect(client.from).toHaveBeenCalledTimes(3);
		for (const table of Object.keys(STAGING_BACKEND_BASELINE.counts) as BaselineTable[]) {
			expect(client.from).toHaveBeenCalledWith(table);
		}
		expect(selections).toEqual(
			expect.arrayContaining([
				{
					table: 'brands',
					columns: 'id',
					options: { count: 'exact', head: true }
				},
				{
					table: 'brand_aliases',
					columns: 'id',
					options: { count: 'exact', head: true }
				},
				{
					table: 'brand_collection_memberships',
					columns: 'brand_id',
					options: { count: 'exact', head: true }
				}
			])
		);

		currentTime += 30_001;
		await attest(input);
		expect(createClient).toHaveBeenCalledTimes(2);
	});

	it('accepts only the exact disposable verification target for verification deployments', async () => {
		const createClient = vi.fn(() => mockClient(VERIFICATION_BACKEND_BASELINE.counts));
		const attest = createBackendAttestor({ createClient });

		await expect(
			attest({
				appEnvironment: 'verification',
				publicSupabaseUrl: VERIFICATION_BACKEND_BASELINE.origin,
				supabaseSecretKey: 'proof-secret'
			})
		).resolves.toBeUndefined();
		await expect(
			attest({
				appEnvironment: 'verification',
				publicSupabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
				supabaseSecretKey: 'proof-secret'
			})
		).rejects.toMatchObject({ reason: 'invalid_target' });
	});

	it('rejects any non-Frankfurt target or missing server secret before creating a client', async () => {
		const createClient = vi.fn(() => mockClient(STAGING_BACKEND_BASELINE.counts));
		const attest = createBackendAttestor({ createClient });

		await expect(
			attest({
				appEnvironment: 'staging',
				publicSupabaseUrl: 'https://zllqwlekadiuyejgbuxc.supabase.co',
				supabaseSecretKey: 'stockholm-secret'
			})
		).rejects.toMatchObject({
			code: 'backend_attestation_failed',
			reason: 'invalid_target'
		});
		await expect(
			attest({
				appEnvironment: 'staging',
				publicSupabaseUrl: STAGING_BACKEND_BASELINE.origin,
				supabaseSecretKey: ''
			})
		).rejects.toMatchObject({
			reason: 'missing_secret'
		});
		expect(createClient).not.toHaveBeenCalled();
	});

	it('fails closed on count drift, then retries after the short failure cache expires', async () => {
		let currentTime = 10_000;
		const wrongCounts = {
			...STAGING_BACKEND_BASELINE.counts,
			brands: STAGING_BACKEND_BASELINE.counts.brands + 1
		};
		const createClient = vi
			.fn()
			.mockReturnValueOnce(mockClient(wrongCounts))
			.mockReturnValue(mockClient(STAGING_BACKEND_BASELINE.counts));
		const attest = createBackendAttestor({
			createClient,
			now: () => currentTime,
			failureCacheTtlMs: 2_000
		});
		const input = {
			appEnvironment: 'staging' as const,
			publicSupabaseUrl: STAGING_BACKEND_BASELINE.origin,
			supabaseSecretKey: 'rotatable-server-secret'
		};

		await expect(attest(input)).rejects.toMatchObject({
			reason: 'count_mismatch'
		});
		await expect(attest(input)).rejects.toMatchObject({
			reason: 'probe_failed'
		});
		expect(createClient).toHaveBeenCalledOnce();

		currentTime += 2_001;
		await expect(attest(input)).resolves.toBeUndefined();
		expect(createClient).toHaveBeenCalledTimes(2);
	});

	it('collapses provider failures without leaking the server key or provider payload', async () => {
		const secret = 'never-log-this-secret';
		const attest = createBackendAttestor({
			createClient: () =>
				mockClient(STAGING_BACKEND_BASELINE.counts, 'brand_aliases')
		});

		let failure: unknown;
		try {
			await attest({
				appEnvironment: 'staging',
				publicSupabaseUrl: STAGING_BACKEND_BASELINE.origin,
				supabaseSecretKey: secret
			});
		} catch (cause) {
			failure = cause;
		}

		expect(failure).toBeInstanceOf(BackendAttestationError);
		expect(String(failure)).not.toContain(secret);
		expect(String(failure)).not.toContain('must-not-leak');
		expect(failure).toMatchObject({ reason: 'probe_failed' });
	});
});
