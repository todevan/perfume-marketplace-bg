import { z } from 'zod';
import type { ActorSummaryDto, PageDto } from './common';
import { optionalPageSchema, uuidSchema } from './common';

export interface ReviewDto {
	readonly id: string;
	readonly dealId: string;
	readonly reviewer: ActorSummaryDto;
	readonly revieweeId: string;
	readonly rating: number;
	readonly body: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export type ReviewPageDto = PageDto<ReviewDto>;

export const reviewListInputSchema = optionalPageSchema.extend({ profileId: uuidSchema });
export const createReviewInputSchema = z.object({
	dealId: uuidSchema,
	revieweeId: uuidSchema,
	rating: z.number().int().min(1).max(5),
	body: z.string().trim().max(2000).nullable().optional()
});
export const updateReviewInputSchema = z.object({
	reviewId: uuidSchema,
	rating: z.number().int().min(1).max(5),
	body: z.string().trim().max(2000).nullable().optional()
});

export type ReviewListInput = z.infer<typeof reviewListInputSchema>;
export type CreateReviewInput = z.infer<typeof createReviewInputSchema>;
export type UpdateReviewInput = z.infer<typeof updateReviewInputSchema>;

