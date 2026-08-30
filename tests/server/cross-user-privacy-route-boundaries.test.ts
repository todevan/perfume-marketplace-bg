import { describe, expect, it, vi } from 'vitest';
import type { MarketplaceSupabaseClient } from '../../src/lib/server/repositories';
import {
	actions as messageActions,
	load as loadMessages
} from '../../src/routes/messages/+page.server';
import { actions as offerActions } from '../../src/routes/offers/+page.server';

const outsiderId = '23333333-3333-4333-8333-333333333333';
const privateConversationId = '23777777-7777-4777-8777-777777777777';
const privateOfferId = '23666666-6666-4666-8666-666666666666';

interface QueryResult {
	data: unknown;
	error: { code?: string; message: string; details?: string } | null;
	count?: number | null;
}

function query(result: QueryResult): Record<string, unknown> {
	const chain: Record<string, unknown> = {};
	for (const method of ['select', 'eq', 'in', 'order', 'range', 'insert']) {
		chain[method] = vi.fn(() => chain);
	}
	chain.single = vi.fn(async () => result);
	chain.maybeSingle = vi.fn(async () => result);
	chain.then = (
		resolve: (value: QueryResult) => unknown,
		reject?: (reason: unknown) => unknown
	) => Promise.resolve(result).then(resolve, reject);
	return chain;
}

function productionLocals(client: MarketplaceSupabaseClient): App.Locals {
	return {
		runtime: { mode: 'production' },
		supabase: client,
		user: { id: outsiderId }
	} as unknown as App.Locals;
}

function authenticatedClient(overrides: Record<string, unknown>): MarketplaceSupabaseClient {
	return {
		auth: {
			getUser: vi.fn(async () => ({ data: { user: { id: outsiderId } }, error: null }))
		},
		...overrides
	} as unknown as MarketplaceSupabaseClient;
}

function formRequest(path: string, values: Readonly<Record<string, string>>): Request {
	const formData = new FormData();
	for (const [name, value] of Object.entries(values)) formData.set(name, value);
	return new Request(`https://market.example${path}`, { method: 'POST', body: formData });
}

describe('cross-user route privacy boundaries', () => {
	it('does not follow a requested private conversation ID that RLS omitted', async () => {
		const from = vi.fn((table: string) => {
			if (table !== 'conversations') throw new Error(`unexpected private lookup: ${table}`);
			return query({ data: [], error: null, count: 0 });
		});
		const client = authenticatedClient({ from });

		const result = await loadMessages({
			locals: productionLocals(client),
			url: new URL(`https://market.example/messages?conversation=${privateConversationId}`)
		} as never);

		expect(result).toMatchObject({
			demoMode: false,
			viewerId: outsiderId,
			conversations: [],
			activeConversationId: null,
			messages: []
		});
		expect(from).toHaveBeenCalledTimes(1);
		expect(from).toHaveBeenCalledWith('conversations');
		expect(JSON.stringify(result)).not.toContain(privateConversationId);
	});

	it('maps a foreign-offer RPC denial to a generic non-enumerating route response', async () => {
		const rpc = vi.fn(async () => ({
			data: null,
			error: {
				code: 'P0002',
				message: `private pending offer ${privateOfferId} belongs to another seller`,
				details: 'buyer note: secret offer terms'
			}
		}));
		const client = authenticatedClient({ rpc });

		const result = await offerActions.accept!({
			locals: productionLocals(client),
			request: formRequest('/offers?/accept', { offerId: privateOfferId })
		} as never);

		expect(result).toMatchObject({
			status: 404,
			data: {
				ok: false,
				error: { code: 'NOT_FOUND', message: 'The requested record was not found.' }
			}
		});
		expect(JSON.stringify(result)).not.toMatch(/private pending offer|secret offer terms/u);
		expect(rpc).toHaveBeenCalledWith('accept_offer', { target_offer_id: privateOfferId });
	});

	it('maps a foreign-conversation write denial without returning database details', async () => {
		const from = vi.fn((table: string) => {
			if (table !== 'messages') throw new Error(`unexpected private lookup: ${table}`);
			return query({
				data: null,
				error: {
					code: '42501',
					message: `conversation ${privateConversationId} belongs to other users`,
					details: 'private message body: do not disclose'
				}
			});
		});
		const client = authenticatedClient({ from });

		const result = await messageActions.send!({
			locals: productionLocals(client),
			request: formRequest('/messages?/send', {
				conversationId: privateConversationId,
				body: 'hostile outsider write'
			})
		} as never);

		expect(result).toMatchObject({
			status: 403,
			data: {
				ok: false,
				error: { code: 'FORBIDDEN', message: 'You are not allowed to perform this action.' }
			}
		});
		expect(JSON.stringify(result)).not.toMatch(/belongs to other users|private message body/u);
	});
});
