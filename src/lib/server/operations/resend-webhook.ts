import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_BODY_BYTES = 64 * 1024;
const TOLERANCE_SECONDS = 300;
const EVENTS = new Set(['email.delivered', 'email.delivery_delayed', 'email.failed',
	'email.bounced', 'email.complained', 'email.sent']);

export interface ResendDeliveryEvent {
	providerEventId: string;
	providerMessageId: string;
	eventType: string;
	occurredAt: string;
}

export interface ResendWebhookDependencies {
	secret?: string;
	now?: () => number;
	/** The database RPC appends once per providerEventId and never overwrites. */
	append: (event: ResendDeliveryEvent) => Promise<void>;
}

function reply(status: number, code?: string): Response {
	return Response.json(code ? { ok: false, code } : { ok: true }, {
		status, headers: { 'cache-control': 'private, no-store' }
	});
}

/** No JSON parsing or Unicode normalization before authenticating the raw bytes. */
async function rawBody(request: Request): Promise<Uint8Array> {
	const declared = request.headers.get('content-length');
	if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
		throw new Error('body_limit');
	}
	if (!request.body) throw new Error('body_missing');
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const deadline = new Promise<never>((_, reject) => {
			timer = setTimeout(() => { void reader.cancel().catch(() => undefined); reject(new Error('body_timeout')); }, 5_000);
		});
		while (true) {
			const result = await Promise.race([reader.read(), deadline]);
			if (result.done) break;
			size += result.value.byteLength;
			if (size > MAX_BODY_BYTES) {
				void reader.cancel().catch(() => undefined);
				throw new Error('body_limit');
			}
			chunks.push(result.value);
		}
	} finally {
		clearTimeout(timer);
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return bytes;
}

/** Svix HMAC contract: https://docs.svix.com/receiving/verifying-payloads/how-manual */
export async function handleResendWebhook(request: Request, dependencies: ResendWebhookDependencies): Promise<Response> {
	const secret = dependencies.secret;
	if (!secret || !/^whsec_[A-Za-z0-9+/]{20,128}={0,2}$/.test(secret)) return reply(503, 'webhook_unavailable');
	if (request.method !== 'POST') return reply(405, 'method_not_allowed');
	if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply(400, 'invalid_webhook');
	const id = request.headers.get('svix-id') ?? '';
	const timestamp = request.headers.get('svix-timestamp') ?? '';
	const signatures = request.headers.get('svix-signature') ?? '';
	const now = (dependencies.now ?? Date.now)();
	if (!/^msg_[A-Za-z0-9_-]{8,196}$/.test(id) || !/^\d{10}$/.test(timestamp) ||
		Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS || signatures.length > 1024) {
		return reply(400, 'invalid_webhook');
	}
	let event: ResendDeliveryEvent;
	try {
		const bytes = await rawBody(request);
		const expected = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
			.update(`${id}.${timestamp}.`).update(bytes).digest();
		let verified = false;
		for (const signature of signatures.split(' ')) {
			if (!/^v1,[A-Za-z0-9+/]{43}=$/.test(signature)) continue;
			const actual = Buffer.from(signature.slice(3), 'base64');
			if (actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)) verified = true;
		}
		if (!verified) return reply(400, 'invalid_webhook');
		const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string' ||
			!EVENTS.has(payload.type) || typeof payload.data?.email_id !== 'string' ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.data.email_id) ||
			typeof payload.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(payload.created_at) ||
			!Number.isFinite(Date.parse(payload.created_at)) || Date.parse(payload.created_at) > now + 300_000) {
			return reply(400, 'invalid_webhook');
		}
		event = { providerEventId: id, providerMessageId: payload.data.email_id,
			eventType: payload.type, occurredAt: new Date(payload.created_at).toISOString() };
	} catch {
		return reply(400, 'invalid_webhook');
	}
	try { await dependencies.append(event); }
	catch { return reply(503, 'webhook_unavailable'); }
	return reply(200);
}
