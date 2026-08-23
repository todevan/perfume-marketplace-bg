import { describe, expect, it } from 'vitest';
import {
	cancelDeal as cancelDealRepository,
	completeDeal as completeDealRepository
} from '../../src/lib/server/repositories/deals';
import { cancelDeal, completeDeal } from '../../src/lib/server/services/deals';
import { actions } from '../../src/routes/deals/+page.server';
import type { MarketplaceSupabaseClient } from '../../src/lib/server/repositories';

const sellerId = '11111111-1111-4111-8111-111111111111';
const dealId = '22222222-2222-4222-8222-222222222222';

function clientWithRpcLog(calls: Array<{ name: string; args: unknown }>): MarketplaceSupabaseClient {
	return {
		auth: {
			getUser: async () => ({ data: { user: { id: sellerId } }, error: null })
		},
		rpc: async (name: string, args: unknown) => {
			calls.push({ name, args });
			return { data: null, error: null };
		}
	} as unknown as MarketplaceSupabaseClient;
}

describe('seller deal completion application boundary', () => {
	it('repository calls only the complete_deal RPC', async () => {
		const calls: Array<{ name: string; args: unknown }> = [];

		await completeDealRepository(clientWithRpcLog(calls), dealId);

		expect(calls).toEqual([
			{ name: 'complete_deal', args: { target_deal_id: dealId } }
		]);
	});

	it('service validates identity and delegates completion', async () => {
		const calls: Array<{ name: string; args: unknown }> = [];

		await expect(completeDeal(clientWithRpcLog(calls), { dealId })).resolves.toEqual({
			ok: true,
			data: undefined
		});
		expect(calls[0]?.name).toBe('complete_deal');
	});

	it('route exposes ?/complete and returns the renamed operation', async () => {
		const calls: Array<{ name: string; args: unknown }> = [];
		const request = new Request('http://localhost/deals?/complete', {
			method: 'POST',
			body: new URLSearchParams({ dealId })
		});

		const result = await actions.complete({
			request,
			locals: {
				runtime: { mode: 'standard' },
				supabase: clientWithRpcLog(calls),
				user: { id: sellerId }
			}
		} as never);

		expect(result).toEqual({ ok: true, operation: 'complete' });
		expect(calls[0]?.name).toBe('complete_deal');
	});
});

describe('participant deal cancellation application boundary', () => {
	it('repository delegates the trimmed cancellation reason to cancel_deal', async () => {
		const calls: Array<{ name: string; args: unknown }> = [];

		await cancelDealRepository(clientWithRpcLog(calls), {
			dealId,
			reason: 'Buyer cancelled the disputed deal'
		});

		expect(calls).toEqual([
			{
				name: 'cancel_deal',
				args: {
					target_deal_id: dealId,
					reason: 'Buyer cancelled the disputed deal'
				}
			}
		]);
	});

	it('service validates and delegates participant cancellation', async () => {
		const calls: Array<{ name: string; args: unknown }> = [];

		await expect(
			cancelDeal(clientWithRpcLog(calls), {
				dealId,
				reason: '  Buyer cancelled the disputed deal  '
			})
		).resolves.toEqual({ ok: true, data: undefined });
		expect(calls[0]).toEqual({
			name: 'cancel_deal',
			args: {
				target_deal_id: dealId,
				reason: 'Buyer cancelled the disputed deal'
			}
		});
	});

	it('route exposes ?/cancel and returns the cancellation operation', async () => {
		const calls: Array<{ name: string; args: unknown }> = [];
		const request = new Request('http://localhost/deals?/cancel', {
			method: 'POST',
			body: new URLSearchParams({ dealId, reason: 'Buyer cancelled the disputed deal' })
		});

		const result = await actions.cancel({
			request,
			locals: {
				runtime: { mode: 'standard' },
				supabase: clientWithRpcLog(calls),
				user: { id: sellerId }
			}
		} as never);

		expect(result).toEqual({ ok: true, operation: 'cancel' });
		expect(calls[0]?.name).toBe('cancel_deal');
	});
});
