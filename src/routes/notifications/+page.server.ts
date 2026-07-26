import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { NotificationDto } from '$lib/contracts';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import {
	getNotifications,
	markNotificationsRead,
	setNotificationStatus
} from '$lib/server/services';

const demoNotifications: readonly NotificationDto[] = [];

function clientFrom(locals: App.Locals): MarketplaceSupabaseClient {
	if (!locals.supabase) error(503, 'Известията временно не са достъпни.');
	return locals.supabase as MarketplaceSupabaseClient;
}

function statusFor(code: string): 400 | 401 | 403 | 404 | 409 | 500 {
	if (code === 'AUTH_REQUIRED') return 401;
	if (code === 'FORBIDDEN') return 403;
	if (code === 'NOT_FOUND') return 404;
	if (code === 'CONFLICT') return 409;
	if (code === 'DATABASE' || code === 'INTERNAL') return 500;
	return 400;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const rawStatus = url.searchParams.get('status');
	const selectedStatus = rawStatus === 'unread' || rawStatus === 'read' || rawStatus === 'archived' ? rawStatus : undefined;
	if (locals.runtime.mode === 'demo') {
		return { notifications: demoNotifications, total: 0, selectedStatus: selectedStatus ?? 'all', demoMode: true };
	}
	const result = await getNotifications(clientFrom(locals), { status: selectedStatus, limit: 100, offset: 0 });
	if (!result.ok) error(statusFor(result.error.code), result.error.message);
	return { notifications: result.data.items, total: result.data.total, selectedStatus: selectedStatus ?? 'all', demoMode: false };
};

export const actions: Actions = {
	markAllRead: async ({ locals }) => {
		if (locals.runtime.mode === 'demo') return { ok: true };
		const result = await markNotificationsRead(clientFrom(locals));
		if (!result.ok) return fail(statusFor(result.error.code), { ok: false, error: result.error });
		return { ok: true };
	},
	update: async ({ request, locals }) => {
		if (locals.runtime.mode === 'demo') return { ok: true };
		const form = await request.formData();
		const result = await setNotificationStatus(clientFrom(locals), {
			notificationId: form.get('notificationId'),
			status: form.get('status')
		});
		if (!result.ok) return fail(statusFor(result.error.code), { ok: false, error: result.error });
		return { ok: true };
	}
};
