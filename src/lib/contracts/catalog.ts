import { z } from 'zod';
import { optionalPageSchema, uuidSchema } from './common';

export const brandCollectionSchema = z.enum(['men', 'women', 'unisex', 'niche', 'arabic']);
export const audienceSchema = z.enum(['men', 'women', 'unisex']);
export const segmentSchema = z.enum(['niche', 'arabic']);
export const concentrationSchema = z.enum([
	'EDT',
	'EDP',
	'PARFUM',
	'EXTRAIT',
	'EDC',
	'OTHER_NOT_STATED'
]);

export interface BrandSummaryDto {
	readonly id: string;
	readonly name: string;
	readonly slug: string;
	readonly parentBrandId: string | null;
}

export interface BrandCollectionItemDto extends BrandSummaryDto {
	readonly collection: z.infer<typeof brandCollectionSchema>;
	readonly displayOrder: number;
}

export interface FragranceSummaryDto {
	readonly id: string;
	readonly slug: string;
	readonly brand: BrandSummaryDto;
	readonly name: string;
	readonly audience: z.infer<typeof audienceSchema>;
	readonly segments: readonly z.infer<typeof segmentSchema>[];
	readonly concentration: z.infer<typeof concentrationSchema> | null;
	readonly concentrationLabel: string | null;
	readonly referenceUrl: string | null;
}

export interface CatalogSearchDto {
	readonly brands: readonly BrandSummaryDto[];
	readonly fragrances: readonly FragranceSummaryDto[];
}

export const catalogSearchInputSchema = optionalPageSchema.extend({
	query: z.string().trim().max(100).default(''),
	collection: brandCollectionSchema.optional()
});

export const fragranceLookupInputSchema = optionalPageSchema.extend({
	brandId: uuidSchema,
	query: z.string().trim().max(100).default('')
});
export const fragranceSlugInputSchema = z.object({
	slug: z.string().trim().min(3).max(220).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
});

export const pendingBrandInputSchema = z.object({
	displayName: z
		.string()
		.trim()
		.min(2)
		.max(80)
		.refine((value) => !/(https?:\/\/|www\.|@)/i.test(value), 'Brand names cannot contain contact details.'),
	suggestedBrandId: uuidSchema.nullable().optional()
});

export type CatalogSearchInput = z.infer<typeof catalogSearchInputSchema>;
export type FragranceLookupInput = z.infer<typeof fragranceLookupInputSchema>;
export type FragranceSlugInput = z.infer<typeof fragranceSlugInputSchema>;
export type PendingBrandInput = z.infer<typeof pendingBrandInputSchema>;
