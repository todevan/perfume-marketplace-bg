import { createClient } from 'npm:@supabase/supabase-js@2';

type NotificationRecord = {
	id: string;
	profile_id: string;
	kind: string;
	title: string;
	body: string;
	action_url: string | null;
};

type InsertWebhook = {
	type: 'INSERT';
	table: 'notifications';
	schema: 'public';
	record: NotificationRecord;
	old_record: null;
};

type EmailDelivery = {
	status: 'pending' | 'processing' | 'sent' | 'failed';
	claimed_worker_request_id: string | null;
	provider_message_id: string | null;
	profile_id: string;
	kind: string;
	title: string;
	body: string;
	action_url: string | null;
};

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
	});

function requiredEnvironment(name: string): string {
	const value = Deno.env.get(name)?.trim();
	if (!value) throw new Error(`Missing ${name}`);
	return value;
}

function htmlEscape(value: string): string {
	return value.replace(/[&<>'"]/g, (character) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
	})[character] ?? character);
}

async function secureEqual(left: string, right: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const [leftHash, rightHash] = await Promise.all([
		crypto.subtle.digest('SHA-256', encoder.encode(left)),
		crypto.subtle.digest('SHA-256', encoder.encode(right))
	]);
	const leftBytes = new Uint8Array(leftHash);
	const rightBytes = new Uint8Array(rightHash);
	let different = leftBytes.length ^ rightBytes.length;
	for (let index = 0; index < Math.max(leftBytes.length, rightBytes.length); index += 1) {
		different |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
	}
	return different === 0;
}

function safeActionUrl(baseUrl: string, actionUrl: string | null): string | null {
	if (!actionUrl?.startsWith('/')) return null;
	const target = new URL(actionUrl, baseUrl);
	return target.origin === new URL(baseUrl).origin ? target.toString() : null;
}

function isPayload(value: unknown): value is InsertWebhook {
	if (!value || typeof value !== 'object') return false;
	const payload = value as Partial<InsertWebhook>;
	const record = payload.record as Partial<NotificationRecord> | undefined;
	return payload.type === 'INSERT' && payload.table === 'notifications' && payload.schema === 'public'
		&& Boolean(record && typeof record.id === 'string' && typeof record.profile_id === 'string'
			&& typeof record.kind === 'string' && typeof record.title === 'string'
			&& typeof record.body === 'string');
}

function deliveryRow(value: unknown): EmailDelivery | null {
	const candidate = Array.isArray(value) ? value[0] : value;
	if (!candidate || typeof candidate !== 'object') return null;
	const row = candidate as Partial<EmailDelivery>;
	if (!['pending', 'processing', 'sent', 'failed'].includes(row.status ?? '')) return null;
	if (
		typeof row.profile_id !== 'string' ||
		typeof row.kind !== 'string' ||
		typeof row.title !== 'string' ||
		typeof row.body !== 'string' ||
		(row.action_url !== null && typeof row.action_url !== 'string')
	) return null;
	return {
		status: row.status as EmailDelivery['status'],
		claimed_worker_request_id:
			typeof row.claimed_worker_request_id === 'string' ? row.claimed_worker_request_id : null,
		provider_message_id:
			typeof row.provider_message_id === 'string' ? row.provider_message_id : null,
		profile_id: row.profile_id,
		kind: row.kind,
		title: row.title,
		body: row.body,
		action_url: row.action_url
	};
}

function providerErrorCode(status: number): string {
	return `resend_http_${Math.max(100, Math.min(599, Math.trunc(status)))}`;
}

Deno.serve(async (request) => {
	const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
	const workerRequestId = crypto.randomUUID();
	if (request.method !== 'POST') return json({ error: 'method_not_allowed', requestId }, 405);
	const contentLength = Number(request.headers.get('content-length') ?? '0');
	if (contentLength > 64 * 1024) return json({ error: 'payload_too_large', requestId }, 413);

	try {
		const webhookSecret = requiredEnvironment('NOTIFICATION_WEBHOOK_SECRET');
		const suppliedSecret = request.headers.get('x-webhook-secret') ?? '';
		if (!suppliedSecret || !(await secureEqual(suppliedSecret, webhookSecret))) {
			return json({ error: 'unauthorized', requestId }, 401);
		}

		const payload: unknown = await request.json();
		if (!isPayload(payload)) return json({ error: 'invalid_payload', requestId }, 400);

		const supabaseUrl = requiredEnvironment('SUPABASE_URL');
		const serviceKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
		const resendKey = requiredEnvironment('RESEND_API_KEY');
		const sender = requiredEnvironment('RESEND_FROM_EMAIL');
		const appUrl = requiredEnvironment('PUBLIC_APP_URL');
		const supabase = createClient(supabaseUrl, serviceKey, {
			auth: { autoRefreshToken: false, persistSession: false }
		});
		const { data: claimData, error: claimError } = await supabase.rpc(
			'claim_notification_email_delivery_v2',
			{
				target_notification_id: payload.record.id,
				worker_request_id: workerRequestId
			}
		);
		if (claimError) {
			console.error(JSON.stringify({
				event: 'notification_email_claim_failed',
				notificationId: payload.record.id,
				code: claimError.code ?? 'unknown',
				requestId
			}));
			return json(
				{ error: claimError.code === '55P03' ? 'delivery_already_claimed' : 'delivery_claim_failed', requestId },
				claimError.code === '55P03' ? 409 : 503
			);
		}
		const claim = deliveryRow(claimData);
		if (!claim) return json({ error: 'invalid_delivery_claim', requestId }, 503);
		const markFailed = async (errorCode: string) => {
			const { error } = await supabase.rpc('mark_notification_email_failed', {
				target_notification_id: payload.record.id,
				worker_request_id: workerRequestId,
				error_code: errorCode
			});
			if (error) {
				console.error(JSON.stringify({
					event: 'notification_email_failure_ledger_failed',
					notificationId: payload.record.id,
					code: error.code ?? 'unknown',
					requestId
				}));
			}
		};
		const payloadMatchesCanonical =
			payload.record.profile_id === claim.profile_id &&
			payload.record.kind === claim.kind &&
			payload.record.title === claim.title &&
			payload.record.body === claim.body &&
			(payload.record.action_url ?? null) === claim.action_url;
		if (!payloadMatchesCanonical) {
			if (claim.status === 'processing' && claim.claimed_worker_request_id === workerRequestId) {
				await markFailed('payload_mismatch');
			}
			console.error(JSON.stringify({
				event: 'notification_email_payload_mismatch',
				notificationId: payload.record.id,
				requestId
			}));
			return json({ error: 'payload_mismatch', requestId }, 409);
		}
		if (claim.status === 'sent') {
			return json({ ok: true, duplicate: true, notificationId: payload.record.id, requestId }, 200);
		}
		if (claim.status !== 'processing' || claim.claimed_worker_request_id !== workerRequestId) {
			return json({ error: 'delivery_claim_mismatch', requestId }, 409);
		}

		// The comparison above protects the webhook boundary; all downstream
		// work is explicitly rebound to the canonical database values.
		payload.record.profile_id = claim.profile_id;
		payload.record.kind = claim.kind;
		payload.record.title = claim.title;
		payload.record.body = claim.body;
		payload.record.action_url = claim.action_url;
		const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(claim.profile_id);
		if (authError || !authUser.user?.email) {
			await markFailed('recipient_unavailable');
			console.error(JSON.stringify({ event: 'notification_email_recipient_unavailable', notificationId: payload.record.id, requestId }));
			return json({ error: 'recipient_unavailable', requestId }, 422);
		}

		const actionUrl = safeActionUrl(appUrl, payload.record.action_url);
		const actionHtml = actionUrl
			? `<p><a href="${htmlEscape(actionUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#4A3126;color:#fff;text-decoration:none;font-weight:700">Отвори в beta</a></p>`
			: '';
		const response = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${resendKey}`,
				'Content-Type': 'application/json',
				'Idempotency-Key': payload.record.id
			},
			body: JSON.stringify({
				from: sender,
				to: [authUser.user.email],
				subject: payload.record.title.slice(0, 160),
				text: `${payload.record.title}\n\n${payload.record.body}${actionUrl ? `\n\n${actionUrl}` : ''}`,
				html: `<main style="font-family:Arial,sans-serif;color:#241C16;background:#F4ECE1;padding:28px"><h1 style="font-style:italic">${htmlEscape(payload.record.title)}</h1><p>${htmlEscape(payload.record.body)}</p>${actionHtml}<p style="font-size:12px;color:#6b5d52">Автоматично известие от затворената beta.</p></main>`,
				tags: [{ name: 'notification_kind', value: payload.record.kind.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 256) }]
			})
		});
		if (!response.ok) {
			await markFailed(providerErrorCode(response.status));
			console.error(JSON.stringify({ event: 'notification_email_provider_failed', notificationId: payload.record.id, providerStatus: response.status, requestId }));
			return json({ error: 'provider_failed', requestId }, 502);
		}
		const providerResult = await response.json() as { id?: string };
		if (!providerResult.id) {
			await markFailed('resend_missing_message_id');
			return json({ error: 'provider_response_invalid', requestId }, 502);
		}
		const { error: sentError } = await supabase.rpc('mark_notification_email_sent', {
			target_notification_id: payload.record.id,
			worker_request_id: workerRequestId,
			provider_message_id: providerResult.id
		});
		if (sentError) {
			console.error(JSON.stringify({
				event: 'notification_email_sent_ledger_failed',
				notificationId: payload.record.id,
				providerMessageId: providerResult.id,
				code: sentError.code ?? 'unknown',
				requestId
			}));
			return json({ error: 'delivery_commit_failed', requestId }, 503);
		}
		console.log(JSON.stringify({ event: 'notification_email_sent', notificationId: payload.record.id, providerMessageId: providerResult.id ?? null, requestId }));
		return json({ ok: true, notificationId: payload.record.id, requestId }, 202);
	} catch (cause) {
		console.error(JSON.stringify({ event: 'notification_email_internal_error', requestId, message: cause instanceof Error ? cause.message : 'unknown' }));
		return json({ error: 'internal_error', requestId }, 500);
	}
});
