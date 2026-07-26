import { z } from 'zod';
import {
	notificationListInputSchema,
	updateNotificationInputSchema,
	type ActionResult,
	type NotificationPageDto
} from '../../contracts';
import {
	countUnreadNotifications,
	listNotifications as repoListNotifications,
	markAllNotificationsRead,
	updateNotification as repoUpdateNotification,
	type MarketplaceSupabaseClient
} from '../repositories';
import { runAuthenticatedAction } from './action';

export function getNotifications(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<NotificationPageDto>> {
	return runAuthenticatedAction(client, notificationListInputSchema, rawInput, (profileId, input) =>
		repoListNotifications(client, profileId, input)
	);
}

export function getUnreadNotificationCount(
	client: MarketplaceSupabaseClient
): Promise<ActionResult<number>> {
	return runAuthenticatedAction(client, z.object({}), {}, (profileId) =>
		countUnreadNotifications(client, profileId)
	);
}

export function setNotificationStatus(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<void>> {
	return runAuthenticatedAction(
		client,
		updateNotificationInputSchema,
		rawInput,
		(profileId, input) => repoUpdateNotification(client, profileId, input)
	);
}

export function markNotificationsRead(
	client: MarketplaceSupabaseClient
): Promise<ActionResult<void>> {
	return runAuthenticatedAction(client, z.object({}), {}, (profileId) =>
		markAllNotificationsRead(client, profileId)
	);
}
