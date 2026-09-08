import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { handleResendWebhook } from '$lib/server/operations/resend-webhook';

export const POST: RequestHandler = ({ request, locals, platform }) => {
	const runtime = locals.runtime;
	return handleResendWebhook(request, {
		secret: platform?.env?.RESEND_WEBHOOK_SECRET ?? env.RESEND_WEBHOOK_SECRET,
		append: async (event) => {
			if (runtime.mode !== 'production' || !runtime.supabaseSecretKey) throw new Error('webhook_unavailable');
			const response = await fetch(`${runtime.publicSupabaseUrl}/rest/v1/rpc/append_resend_delivery_event`, {
				method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3_000),
				headers: { apikey: runtime.supabaseSecretKey, authorization: `Bearer ${runtime.supabaseSecretKey}`,
					'content-type': 'application/json' },
				body: JSON.stringify({ p_provider_event_id: event.providerEventId,
					p_provider_message_id: event.providerMessageId, p_event_type: event.eventType, p_occurred_at: event.occurredAt })
			});
			await response.body?.cancel();
			if (!response.ok) throw new Error('webhook_unavailable');
		}
	});
};
