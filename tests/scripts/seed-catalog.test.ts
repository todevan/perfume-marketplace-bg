import { describe, expect, it, vi } from 'vitest';
import {
	CatalogSeedError,
	resolveLocalSeedConfiguration,
	seedCatalog
} from '../../scripts/seed-catalog.mjs';

const localUrl = 'http://127.0.0.1:54321';
const testServiceRoleKey = 'local-service-role-key';
const syncRunId = '11111111-1111-4111-8111-111111111111';

describe('local catalogue seed boundary', () => {
	it('allows the raw seed command only for a loopback Supabase origin', () => {
		expect(
			resolveLocalSeedConfiguration({
				PUBLIC_SUPABASE_URL: `${localUrl}/`,
				SUPABASE_SERVICE_ROLE_KEY: testServiceRoleKey
			})
		).toEqual({
			projectUrl: localUrl,
			serviceRoleKey: testServiceRoleKey
		});
	});

	it('rejects a hosted URL without reflecting the service-role key', () => {
		let caught: unknown;
		try {
			resolveLocalSeedConfiguration({
				PUBLIC_SUPABASE_URL: 'https://nuhkpqjjyuygiemrxbdp.supabase.co',
				SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-must-not-be-logged'
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(CatalogSeedError);
		expect(String(caught)).toContain('local-only');
		expect(String(caught)).not.toContain('service-role-key-must-not-be-logged');
	});
});

describe('atomic catalogue seed function', () => {
	it('receives explicit credentials and returns only a validated sync summary', async () => {
		const rpc = vi.fn(async () => ({
			data: {
				syncRunId,
				brands: 196,
				aliases: 48,
				memberships: 335
			},
			error: null
		}));
		const createClientImpl = vi.fn(() => ({ rpc }));
		const logger = { log: vi.fn() };

		await expect(
			seedCatalog({
				projectUrl: 'https://nuhkpqjjyuygiemrxbdp.supabase.co',
				serviceRoleKey: testServiceRoleKey,
				createClientImpl: createClientImpl as never,
				logger
			})
		).resolves.toEqual({
			syncRunId,
			brands: 196,
			aliases: 48,
			memberships: 335
		});
		expect(createClientImpl).toHaveBeenCalledWith(
			'https://nuhkpqjjyuygiemrxbdp.supabase.co',
			testServiceRoleKey,
			{ auth: { autoRefreshToken: false, persistSession: false } }
		);
		expect(rpc).toHaveBeenCalledWith(
			'sync_editorial_catalog',
			expect.objectContaining({ catalog_payload: expect.any(Object) })
		);
		expect(logger.log).not.toHaveBeenCalledWith(
			expect.stringContaining(testServiceRoleKey)
		);
	});

	it('replaces provider diagnostics with a credential-safe error', async () => {
		const rawSecret = 'raw-token-must-not-appear';
		const createClientImpl = vi.fn(() => ({
			rpc: vi.fn(async () => ({
				data: null,
				error: {
					message: `authorization failed for ${rawSecret}`,
					details: rawSecret
				}
			}))
		}));
		let caught: unknown;
		try {
			await seedCatalog({
				projectUrl: localUrl,
				serviceRoleKey: rawSecret,
				createClientImpl: createClientImpl as never,
				logger: { log: vi.fn() }
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(CatalogSeedError);
		expect(String(caught)).not.toContain(rawSecret);
	});
});
