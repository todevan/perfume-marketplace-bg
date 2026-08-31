import { describe, expect, it, vi } from 'vitest';

import { notificationKindSchema } from '../../src/lib/contracts';
import { completeDeal } from '../../src/lib/server/repositories/deals';
import type { MarketplaceSupabaseClient } from '../../src/lib/server/repositories/shared';
import { actions } from '../../src/routes/deals/+page.server';

const dealId = '11111111-1111-4111-8111-111111111111';

describe('seller deal lifecycle server boundary', () => {
	it('accepts deal cancellation notifications at the TypeScript contract boundary', () => {
		expect(notificationKindSchema.parse('deal_cancelled')).toBe('deal_cancelled');
	});

	it('delegates completion to the seller-only complete_deal RPC', async () => {
		const rpc = vi.fn(async () => ({ data: null, error: null }));

		await completeDeal({ rpc } as unknown as MarketplaceSupabaseClient, dealId);

		expect(rpc).toHaveBeenCalledOnce();
		expect(rpc).toHaveBeenCalledWith('complete_deal', { target_deal_id: dealId });
	});

	it('exposes the complete route action and completion operation name', async () => {
		const complete = actions.complete as (event: unknown) => Promise<unknown>;
		const result = await complete({
			request: new Request('https://example.test/deals?/complete', {
				method: 'POST',
				body: new URLSearchParams({ dealId })
			}),
			locals: { runtime: { mode: 'demo' } }
		});

		expect(result).toEqual({ ok: true, operation: 'complete' });
	});
});
