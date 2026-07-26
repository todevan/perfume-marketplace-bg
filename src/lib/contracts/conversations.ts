import { z } from 'zod';
import type { ActorSummaryDto, PageDto } from './common';
import { optionalPageSchema, uuidSchema } from './common';

export const conversationStatusSchema = z.enum(['open', 'archived', 'blocked']);

export interface ConversationSummaryDto {
	readonly id: string;
	readonly listingId: string;
	readonly listingTitle: string;
	readonly counterpart: ActorSummaryDto;
	readonly status: z.infer<typeof conversationStatusSchema>;
	readonly lastReadAt: string | null;
	readonly muted: boolean;
	readonly blocked: boolean;
	readonly lastMessage: MessageDto | null;
	readonly updatedAt: string;
}

export interface MessageDto {
	readonly id: string;
	readonly conversationId: string;
	readonly sender: ActorSummaryDto;
	readonly body: string | null;
	readonly replyToId: string | null;
	readonly createdAt: string;
	readonly editedAt: string | null;
	readonly deletedAt: string | null;
}

export type ConversationPageDto = PageDto<ConversationSummaryDto>;
export type MessagePageDto = PageDto<MessageDto>;

export const conversationListInputSchema = optionalPageSchema;
export const messageListInputSchema = optionalPageSchema.extend({ conversationId: uuidSchema });
export const sendMessageInputSchema = z.object({
	conversationId: uuidSchema,
	body: z.string().trim().min(1).max(4000),
	replyToId: uuidSchema.nullable().optional()
});
export const updateConversationStateInputSchema = z.object({
	conversationId: uuidSchema,
	lastReadAt: z.string().datetime({ offset: true }).nullable().optional(),
	muted: z.boolean().optional(),
	blocked: z.boolean().optional()
});
export const editMessageInputSchema = z.object({
	messageId: uuidSchema,
	body: z.string().trim().min(1).max(4000).nullable()
});

export type ConversationListInput = z.infer<typeof conversationListInputSchema>;
export type MessageListInput = z.infer<typeof messageListInputSchema>;
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;
export type UpdateConversationStateInput = z.infer<typeof updateConversationStateInputSchema>;
export type EditMessageInput = z.infer<typeof editMessageInputSchema>;

