import { z } from 'zod';
import type { ActorSummaryDto, MoneyDto, PageDto } from './common';
import { optionalPageSchema, uuidSchema } from './common';
import type { ListingCardDto } from './listings';

export const offerKindSchema = z.enum(['cash', 'swap', 'cash_plus_swap']);
export const offerStatusSchema = z.enum(['pending', 'accepted', 'declined', 'withdrawn', 'expired']);

export interface OfferDto {
	readonly id: string;
	readonly listing: ListingCardDto;
	readonly offerer: ActorSummaryDto;
	readonly kind: z.infer<typeof offerKindSchema>;
	readonly cash: MoneyDto | null;
	readonly offeredListing: ListingCardDto | null;
	readonly message: string | null;
	readonly status: z.infer<typeof offerStatusSchema>;
	readonly expiresAt: string | null;
	readonly respondedAt: string | null;
	readonly createdAt: string;
}

export type OfferPageDto = PageDto<OfferDto>;

export const createOfferInputSchema = z
	.object({
		listingId: uuidSchema,
		kind: offerKindSchema,
		cashAmountMinor: z.number().int().positive().nullable().optional(),
		offeredListingId: uuidSchema.nullable().optional(),
		message: z.string().trim().max(1000).nullable().optional(),
		expiresAt: z.string().datetime({ offset: true }).nullable().optional()
	})
	.superRefine((value, context) => {
		const hasCash = value.cashAmountMinor != null;
		const hasListing = value.offeredListingId != null;
		if (
			(value.kind === 'cash' && (!hasCash || hasListing)) ||
			(value.kind === 'swap' && (hasCash || !hasListing)) ||
			(value.kind === 'cash_plus_swap' && (!hasCash || !hasListing))
		) {
			context.addIssue({ code: 'custom', message: 'Offer value does not match its kind.' });
		}
	});

export const offerListInputSchema = optionalPageSchema.extend({
	direction: z.enum(['received', 'sent']).default('received'),
	status: offerStatusSchema.optional()
});
export const offerIdInputSchema = z.object({ offerId: uuidSchema });

export type CreateOfferInput = z.infer<typeof createOfferInputSchema>;
export type OfferListInput = z.infer<typeof offerListInputSchema>;
export type OfferIdInput = z.infer<typeof offerIdInputSchema>;

