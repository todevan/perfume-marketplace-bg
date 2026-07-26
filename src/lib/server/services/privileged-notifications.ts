import { z } from 'zod';
import {
	notificationKindSchema,
	type ActionResult,
	type NotificationDto
} from '../../contracts';
import type { Json, Tables } from '../database.types';
import { requireData, throwIfError } from '../repositories';
import { toNotificationDto } from '../repositories/notifications';
import { runAction } from './action';
import type { PrivilegedMarketplaceClient } from './privileged';

export const systemNotificationInputSchema = z.object({
	profileId: z.string().uuid(),
	kind: notificationKindSchema,
	title: z.string().trim().min(1).max(160),
	body: z.string().trim().max(1000).default(''),
	actionUrl: z.string().trim().max(500).nullable().optional(),
	data: z.record(z.string(), z.unknown()).default({})
});

/** Narrow service-role operation for trusted jobs; ordinary request handlers must not call it. */
export function createSystemNotification(
	client: PrivilegedMarketplaceClient,
	rawInput: unknown
): Promise<ActionResult<NotificationDto>> {
	return runAction(systemNotificationInputSchema, rawInput, async (input) => {
		const { data, error } = await client
			.from('notifications')
			.insert({
				profile_id: input.profileId,
				kind: input.kind,
				title: input.title,
				body: input.body,
				action_url: input.actionUrl ?? null,
				data: input.data as Json
			})
			.select('*')
			.single();
		throwIfError('notifications.createSystem', error);
		return toNotificationDto(requireData('notifications.createSystem', data) as Tables<'notifications'>);
	});
}
