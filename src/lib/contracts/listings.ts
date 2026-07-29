import { z } from 'zod';
import { audienceSchema, concentrationSchema, segmentSchema } from './catalog';
import type { ActorSummaryDto, MoneyDto, PageDto } from './common';
import { nullableUrlSchema, optionalPageSchema, uuidSchema } from './common';

export const listingKindSchema = z.enum(['offer', 'wanted']);
export const dealModeSchema = z.enum(['sale', 'swap', 'sale_or_swap']);
export const productFormatSchema = z.enum(['retail_bottle', 'tester', 'official_sample']);
export const listingStatusSchema = z.enum([
	'draft',
	'active',
	'reserved',
	'paused',
	'completed',
	'expired',
	'rejected',
	'removed'
]);
export const photoRoleSchema = z.enum([
	'product_full',
	'bottle_bottom',
	'batch_code',
	'fill_level',
	'box_front',
	'box_bottom',
	'seal',
	'manufacturer_label',
	'manufacturer_markings',
	'other'
]);

export interface ListingPhotoDto {
	readonly id: string;
	readonly imageUrl: string;
	readonly role: z.infer<typeof photoRoleSchema>;
	readonly sortOrder: number;
}

export const listingUploadStatusSchema = z.enum([
	'pending',
	'processing',
	'finalized',
	'rejected',
	'expired'
]);

export interface ListingUploadIntentDto {
	readonly uploadId: string;
	readonly bucketId: 'listing-image-quarantine';
	readonly storagePath: string;
	readonly expiresAt: string;
}

export interface ListingUploadDto {
	readonly id: string;
	readonly listingId: string;
	readonly role: z.infer<typeof photoRoleSchema>;
	readonly status: z.infer<typeof listingUploadStatusSchema>;
	readonly rejectionCode: string | null;
	readonly expiresAt: string;
	readonly finalizedAt: string | null;
	readonly createdAt: string;
}

export interface ListingCardDto {
	readonly id: string;
	readonly slug: string;
	readonly kind: z.infer<typeof listingKindSchema>;
	readonly dealMode: z.infer<typeof dealModeSchema>;
	readonly title: string;
	readonly brandId: string;
	readonly brandName: string;
	readonly brandSlug: string;
	readonly fragranceName: string;
	readonly concentration: z.infer<typeof concentrationSchema>;
	readonly city: string;
	readonly price: MoneyDto | null;
	readonly maxBudget: MoneyDto | null;
	readonly bottleVolumeMl: number | null;
	readonly remainingMl: number | null;
	readonly isSealed: boolean;
	readonly status: z.infer<typeof listingStatusSchema>;
	readonly seller: ActorSummaryDto;
	readonly primaryPhoto: ListingPhotoDto | null;
	readonly authenticityReviewed: boolean;
	readonly isFavorite?: boolean;
	readonly createdAt: string;
}

export interface ListingDetailDto extends ListingCardDto {
	readonly productFormat: z.infer<typeof productFormatSchema> | null;
	readonly audience: z.infer<typeof audienceSchema>;
	readonly segments: readonly z.infer<typeof segmentSchema>[];
	readonly fragranceId: string | null;
	readonly concentrationLabel: string | null;
	readonly description: string;
	readonly estimatedValue: MoneyDto | null;
	readonly referenceUrl: string | null;
	readonly photos: readonly ListingPhotoDto[];
	readonly authenticityNote: string | null;
	readonly activatedAt: string | null;
	readonly expiresAt: string | null;
	readonly updatedAt: string;
}

export interface ListingCursorDto {
	readonly sort: 'newest' | 'price_asc' | 'price_desc';
	readonly activatedAt: string | null;
	readonly priceMinor: number | null;
	readonly id: string;
}

export interface ListingPageDto extends PageDto<ListingCardDto> {
	readonly nextCursor: ListingCursorDto | null;
	readonly totalIsExact: boolean;
}

export const listingSearchInputSchema = optionalPageSchema.extend({
	query: z.string().trim().max(120).default(''),
	kind: listingKindSchema.optional(),
	dealMode: dealModeSchema.optional(),
	audience: audienceSchema.optional(),
	segments: z.array(segmentSchema).max(2).default([]),
	productFormat: productFormatSchema.optional(),
	city: z.string().trim().max(100).optional(),
	brandId: uuidSchema.optional(),
	fragranceId: uuidSchema.optional(),
	minPriceMinor: z.coerce.number().int().positive().optional(),
	maxPriceMinor: z.coerce.number().int().positive().optional(),
	cursorActivatedAt: z.string().datetime({ offset: true }).optional(),
	cursorPriceMinor: z.coerce.number().int().min(-1).max(2_147_483_647).optional(),
	cursorId: uuidSchema.optional(),
	sort: z.enum(['newest', 'price_asc', 'price_desc']).default('newest')
}).superRefine((value, context) => {
	if (
		value.minPriceMinor !== undefined &&
		value.maxPriceMinor !== undefined &&
		value.minPriceMinor > value.maxPriceMinor
	) {
		context.addIssue({
			code: 'custom',
			path: ['maxPriceMinor'],
			message: 'Maximum price must be greater than or equal to minimum price.'
		});
	}
	const hasNewestCursor = value.cursorActivatedAt !== undefined;
	const hasPriceCursor = value.cursorPriceMinor !== undefined;
	const hasId = value.cursorId !== undefined;
	const invalidNewestCursor =
		value.sort === 'newest' && (hasPriceCursor || hasNewestCursor !== hasId);
	const invalidPriceCursor =
		value.sort !== 'newest' && (hasNewestCursor || hasPriceCursor !== hasId);
	if (invalidNewestCursor || invalidPriceCursor) {
		context.addIssue({
			code: 'custom',
			path: ['cursorId'],
			message: 'Cursor fields must match the selected sort order.'
		});
	}
});

const nullablePositiveMinorSchema = z.number().int().positive().nullable().optional();
const nullablePositiveVolumeSchema = z.number().positive().max(500).refine(
	(value) => Number.isInteger(value * 10),
	'Volume must use 0.1 ml precision.'
).nullable().optional();
const nullableRemainingVolumeSchema = z.number().min(0).max(500).refine(
	(value) => Number.isInteger(value * 10),
	'Volume must use 0.1 ml precision.'
).nullable().optional();

export const listingDraftInputSchema = z
	.object({
		kind: listingKindSchema,
		dealMode: dealModeSchema,
		productFormat: productFormatSchema.nullable().optional(),
		audience: audienceSchema,
		segments: z.array(segmentSchema).max(2).default([]).refine(
			(segments) => new Set(segments).size === segments.length,
			'Segments must be unique.'
		),
		brandId: uuidSchema,
		fragranceId: uuidSchema.nullable().optional(),
		fragranceName: z.string().trim().min(2).max(160),
		concentration: concentrationSchema,
		concentrationLabel: z.string().trim().max(80).nullable().optional(),
		referenceUrl: nullableUrlSchema
			.refine(
				(value) => value === null || value.startsWith('https://www.fragrantica.com/perfume/'),
				'Use a direct Fragrantica perfume URL.'
			)
			.optional(),
		title: z.string().trim().min(4).max(180),
		description: z.string().trim().max(5000).default(''),
		city: z.string().trim().min(2).max(100),
		bottleVolumeMl: nullablePositiveVolumeSchema,
		remainingMl: nullableRemainingVolumeSchema,
		isSealed: z.boolean().default(false),
		priceMinor: nullablePositiveMinorSchema,
		estimatedValueMinor: nullablePositiveMinorSchema,
		maxBudgetMinor: nullablePositiveMinorSchema
	})
	.superRefine((value, context) => {
		if (value.kind === 'offer') {
			if (!value.productFormat) {
				context.addIssue({ code: 'custom', path: ['productFormat'], message: 'Product format is required.' });
			}
			if (value.bottleVolumeMl == null || value.remainingMl == null) {
				context.addIssue({ code: 'custom', path: ['remainingMl'], message: 'Bottle amounts are required.' });
			}
			if (value.remainingMl != null && value.bottleVolumeMl != null && value.remainingMl > value.bottleVolumeMl) {
				context.addIssue({ code: 'custom', path: ['remainingMl'], message: 'Remaining amount exceeds bottle volume.' });
			}
			if (value.isSealed && value.remainingMl !== value.bottleVolumeMl) {
				context.addIssue({ code: 'custom', path: ['remainingMl'], message: 'A sealed bottle must be full.' });
			}
			if (value.dealMode !== 'swap' && value.priceMinor == null) {
				context.addIssue({ code: 'custom', path: ['priceMinor'], message: 'A sale price is required.' });
			}
			if (value.dealMode === 'swap' && value.priceMinor != null) {
				context.addIssue({ code: 'custom', path: ['priceMinor'], message: 'A swap-only listing cannot have a sale price.' });
			}
			if (value.maxBudgetMinor != null) {
				context.addIssue({ code: 'custom', path: ['maxBudgetMinor'], message: 'Offer listings cannot have a buyer budget.' });
			}
		} else {
			if (value.priceMinor != null || value.estimatedValueMinor != null) {
				context.addIssue({ code: 'custom', path: ['priceMinor'], message: 'Wanted listings use only a maximum budget.' });
			}
			if (
				value.productFormat != null ||
				value.bottleVolumeMl != null ||
				value.remainingMl != null ||
				value.isSealed
			) {
				context.addIssue({
					code: 'custom',
					path: ['productFormat'],
					message: 'Wanted listings cannot describe a physical item.'
				});
			}
		}
	});

export const updateListingDraftInputSchema = z.object({
	listingId: uuidSchema,
	patch: listingDraftInputSchema
});

export const listingIdInputSchema = z.object({ listingId: uuidSchema });
export const createListingUploadInputSchema = z.object({
	listingId: uuidSchema,
	role: photoRoleSchema,
	mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
	byteSize: z.number().int().min(1).max(10 * 1024 * 1024)
});
export const cancelListingUploadInputSchema = z.object({ uploadId: uuidSchema });
export const listingUploadsInputSchema = z.object({ listingId: uuidSchema });

export type ListingSearchInput = z.infer<typeof listingSearchInputSchema>;
export type ListingDraftInput = z.infer<typeof listingDraftInputSchema>;
export type UpdateListingDraftInput = z.infer<typeof updateListingDraftInputSchema>;
export type ListingIdInput = z.infer<typeof listingIdInputSchema>;
export type CreateListingUploadInput = z.infer<typeof createListingUploadInputSchema>;
export type CancelListingUploadInput = z.infer<typeof cancelListingUploadInputSchema>;
export type ListingUploadsInput = z.infer<typeof listingUploadsInputSchema>;
