import { z } from 'zod';
import type { PageDto } from './common';
import { optionalPageSchema, uuidSchema } from './common';

export const notificationKindSchema = z.enum([
	'offer_received',
	'offer_accepted',
	'offer_declined',
	'message_received',
	'deal_confirmation_needed',
	'deal_completed',
	'deal_cancelled',
	'review_received',
	'listing_expiring',
	'listing_expired',
	'report_updated',
	'merchant_application_updated',
	'payment_updated'
]);
export const notificationStatusSchema = z.enum(['unread', 'read', 'archived']);

export interface NotificationDto {
	readonly id: string;
	readonly kind: z.infer<typeof notificationKindSchema>;
	readonly status: z.infer<typeof notificationStatusSchema>;
	readonly title: string;
	readonly body: string;
	readonly actionUrl: string | null;
	readonly data: Readonly<Record<string, unknown>>;
	readonly readAt: string | null;
	readonly createdAt: string;
}

export type NotificationPageDto = PageDto<NotificationDto>;

export const notificationListInputSchema = optionalPageSchema.extend({
	status: notificationStatusSchema.optional()
});
export const updateNotificationInputSchema = z.object({
	notificationId: uuidSchema,
	status: notificationStatusSchema
});

export type NotificationListInput = z.infer<typeof notificationListInputSchema>;
export type UpdateNotificationInput = z.infer<typeof updateNotificationInputSchema>;
