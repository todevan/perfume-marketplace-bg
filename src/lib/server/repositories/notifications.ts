import type {
	NotificationDto,
	NotificationListInput,
	NotificationPageDto,
	UpdateNotificationInput
} from '../../contracts';
import type { Tables } from '../database.types';
import { jsonObject, pageDto, requireData, throwIfError, type MarketplaceSupabaseClient } from './shared';

type NotificationRow = Tables<'notifications'>;

export function toNotificationDto(row: NotificationRow): NotificationDto {
	return {
		id: row.id,
		kind: row.kind,
		status: row.status,
		title: row.title,
		body: row.body,
		actionUrl: row.action_url,
		data: jsonObject(row.data),
		readAt: row.read_at,
		createdAt: row.created_at
	};
}

export async function listNotifications(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: NotificationListInput
): Promise<NotificationPageDto> {
	let query = client
		.from('notifications')
		.select('*', { count: 'exact' })
		.eq('profile_id', profileId)
		.order('created_at', { ascending: false })
		.range(input.offset, input.offset + input.limit - 1);
	if (input.status) query = query.eq('status', input.status);
	const { data, error, count } = await query;
	throwIfError('notifications.list', error);
	return pageDto(
		(data ?? []).map((row) => toNotificationDto(row as NotificationRow)),
		count,
		input.limit,
		input.offset
	);
}

export async function countUnreadNotifications(
	client: MarketplaceSupabaseClient,
	profileId: string
): Promise<number> {
	const { count, error } = await client
		.from('notifications')
		.select('id', { count: 'exact', head: true })
		.eq('profile_id', profileId)
		.eq('status', 'unread');
	throwIfError('notifications.countUnread', error);
	return count ?? 0;
}

export async function updateNotification(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: UpdateNotificationInput
): Promise<void> {
	const { data, error } = await client
		.from('notifications')
		.update({ status: input.status })
		.eq('id', input.notificationId)
		.eq('profile_id', profileId)
		.select('id')
		.maybeSingle();
	throwIfError('notifications.update', error);
	requireData('notifications.update', data);
}

export async function markAllNotificationsRead(
	client: MarketplaceSupabaseClient,
	profileId: string
): Promise<void> {
	const { error } = await client
		.from('notifications')
		.update({ status: 'read' })
		.eq('profile_id', profileId)
		.eq('status', 'unread');
	throwIfError('notifications.markAllRead', error);
}
