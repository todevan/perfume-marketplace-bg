import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const edgeFunction = readFileSync(
	new URL('../../supabase/functions/notification-email/index.ts', import.meta.url),
	'utf8'
);

describe('transactional notification email contract', () => {
	it('authenticates the webhook without logging the recipient address', () => {
		expect(edgeFunction).toContain("request.headers.get('x-webhook-secret')");
		expect(edgeFunction).toContain('secureEqual(suppliedSecret, webhookSecret)');
		expect(edgeFunction).not.toMatch(/console\.(?:log|error)\([^\n]*authUser\.user\.email/u);
	});

	it('claims, finalizes and records failed delivery attempts through service-role RPCs', () => {
		expect(edgeFunction).toContain("'claim_notification_email_delivery_v2'");
		expect(edgeFunction).toContain("'mark_notification_email_sent'");
		expect(edgeFunction).toContain("'mark_notification_email_failed'");
		expect(edgeFunction).toContain("claim.status === 'sent'");
	});

	it('uses the canonical claimed notification as the provider source of truth', () => {
		expect(edgeFunction).toContain('payloadMatchesCanonical');
		expect(edgeFunction).toContain("await markFailed('payload_mismatch')");
		expect(edgeFunction).toContain('payload.record.title = claim.title');
		expect(edgeFunction).toContain("'Idempotency-Key': payload.record.id");
		expect(edgeFunction).not.toContain('Idempotency-Key\': `');
	});

	it('accepts only same-origin relative action links and escapes message HTML', () => {
		expect(edgeFunction).toContain("actionUrl?.startsWith('/')");
		expect(edgeFunction).toContain('target.origin === new URL(baseUrl).origin');
		expect(edgeFunction).toContain('htmlEscape(payload.record.title)');
		expect(edgeFunction).toContain('htmlEscape(payload.record.body)');
	});
});
