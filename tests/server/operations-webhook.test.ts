import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleResendWebhook } from '../../src/lib/server/operations/resend-webhook';

const now = Date.parse('2026-09-05T12:00:00Z');
const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;
const messageId = '56761188-7520-42d8-8898-ff6fc54ce618';
function request(body: string, timestamp = String(now / 1000), id = 'msg_test12345678') {
	const signature = createHmac('sha256', Buffer.alloc(32, 7))
		.update(`${id}.${timestamp}.${body}`).digest('base64');
	return new Request('https://example.test/api/webhooks/resend', {
		method: 'POST', body,
		headers: { 'content-type': 'application/json', 'svix-id': id,
			'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` }
	});
}
const payload = JSON.stringify({ type: 'email.delivered', created_at: new Date(now).toISOString(),
	data: { email_id: messageId, to: ['private@example.test'], subject: 'private content' } });

describe('Resend downstream webhook boundary', () => {
	it('verifies the exact raw payload and persists only delivery metadata', async () => {
		const events: unknown[] = [];
		const response = await handleResendWebhook(request(payload), { secret, now: () => now,
			append: async (event) => { events.push(event); } });
		expect(response.status).toBe(200);
		expect(events).toEqual([{ providerEventId: 'msg_test12345678', providerMessageId: messageId,
			eventType: 'email.delivered', occurredAt: '2026-09-05T12:00:00.000Z' }]);
		expect(await response.text()).toBe('{"ok":true}');
	});
	it.each(['email.sent', 'email.delivery_delayed', 'email.failed', 'email.bounced', 'email.complained'])
	('keeps %s distinct from delivered and internal provider acceptance', async (eventType) => {
		const events: unknown[] = [];
		const body = payload.replace('email.delivered', eventType);
		const response = await handleResendWebhook(request(body), { secret, now: () => now,
			append: async (event) => { events.push(event); } });
		expect(response.status).toBe(200);
		expect(events[0]).toMatchObject({ eventType });
	});
	it.each([-301, 301])('rejects timestamp outside the replay window (%s seconds)', async (offset) => {
		let appended = false;
		const response = await handleResendWebhook(request(payload, String(now / 1000 + offset)), {
			secret, now: () => now, append: async () => { appended = true; }
		});
		expect(response.status).toBe(400);
		expect(appended).toBe(false);
	});
	it.each(['unsigned', 'tampered', 'wrong-key', 'malformed', 'oversize', 'unknown-event'])
	('rejects %s input without ledger mutation or private error output', async (scenario) => {
		const body = scenario === 'malformed' ? '{' : scenario === 'oversize' ? ' '.repeat(65537) :
			scenario === 'unknown-event' ? payload.replace('email.delivered', 'email.received') : payload;
		let input = request(body);
		if (scenario === 'unsigned') input.headers.delete('svix-signature');
		if (scenario === 'tampered') input = new Request(input.url, { method: 'POST', headers: input.headers, body: `${body} ` });
		let appended = false;
		const response = await handleResendWebhook(input, {
			secret: scenario === 'wrong-key' ? `whsec_${Buffer.alloc(32, 8).toString('base64')}` : secret,
			now: () => now, append: async () => { appended = true; }
		});
		expect(response.status).toBe(400);
		expect(appended).toBe(false);
		expect(await response.text()).toBe('{"ok":false,"code":"invalid_webhook"}');
	});
	it('accepts a valid rotating v1 signature while ignoring unsupported signatures', async () => {
		const input = request(payload);
		input.headers.set('svix-signature', `v2,ignored v1,${Buffer.alloc(32).toString('base64')} ${input.headers.get('svix-signature')}`);
		expect((await handleResendWebhook(input, { secret, now: () => now, append: async () => {} })).status).toBe(200);
	});
	it('fails closed on database failure without returning provider errors', async () => {
		const response = await handleResendWebhook(request(payload), { secret, now: () => now,
			append: async () => { throw new Error('token-secret private@example.test provider body'); } });
		expect(response.status).toBe(503);
		expect(await response.text()).toBe('{"ok":false,"code":"webhook_unavailable"}');
	});
});
