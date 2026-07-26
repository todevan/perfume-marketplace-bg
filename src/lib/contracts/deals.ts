import { z } from 'zod';
import type { ActorSummaryDto, PageDto } from './common';
import { optionalPageSchema, uuidSchema } from './common';
import type { ListingCardDto } from './listings';

export const dealStatusSchema = z.enum(['pending_confirmation', 'completed', 'disputed', 'cancelled']);

export interface DealDto {
	readonly id: string;
	readonly listing: ListingCardDto;
	readonly offeredListing: ListingCardDto | null;
	readonly partyA: ActorSummaryDto;
	readonly partyB: ActorSummaryDto;
	readonly status: z.infer<typeof dealStatusSchema>;
	readonly confirmedBy: readonly string[];
	readonly completedAt: string | null;
	readonly disputedAt: string | null;
	readonly cancelledAt: string | null;
	readonly cancellationReason: string | null;
	readonly createdAt: string;
}

export type DealPageDto = PageDto<DealDto>;

export const dealListInputSchema = optionalPageSchema.extend({ status: dealStatusSchema.optional() });
export const dealIdInputSchema = z.object({ dealId: uuidSchema });
export const cancelDealInputSchema = z.object({
	dealId: uuidSchema,
	reason: z.string().trim().min(2).max(1000)
});
export const openDealDisputeInputSchema = z.object({
	dealId: uuidSchema,
	details: z.string().trim().min(20).max(4000)
});

export interface DealDisputeDto {
	readonly dealId: string;
	readonly reportId: string;
}

export type DealListInput = z.infer<typeof dealListInputSchema>;
export type DealIdInput = z.infer<typeof dealIdInputSchema>;
export type CancelDealInput = z.infer<typeof cancelDealInputSchema>;
export type OpenDealDisputeInput = z.infer<typeof openDealDisputeInputSchema>;
