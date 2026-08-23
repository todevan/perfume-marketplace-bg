import { z } from 'zod';
import { nullableUrlSchema } from './common';

export interface PublicProfileDto {
	readonly id: string;
	readonly username: string;
	readonly city: string | null;
	readonly bio: string | null;
	readonly avatarUrl: string | null;
	readonly accountKind: 'private' | 'merchant';
	readonly merchantVerified: boolean;
	readonly ratingAverage: number;
	readonly ratingCount: number;
	readonly completedDealsCount: number;
	readonly memberSince: string;
}

export const publicProfileLookupSchema = z.object({
	username: z.string().trim().min(3).max(40)
});

export const cityInputSchema = z
	.string()
	.transform((value) => value.replace(/^ +| +$/gu, ''))
	.pipe(
		z
			.string()
			.min(2, 'City must be at least 2 characters')
			.max(100, 'City must be at most 100 characters')
			.refine(
				(value) => /[\p{L}\p{N}]/u.test(value) && /^[-\p{L}\p{N} ']+$/u.test(value),
				'Enter a valid city or location'
			)
	);

export const updateProfileInputSchema = z.object({
	username: z.string().trim().min(3).max(40).regex(/^[\p{L}\p{N}_.-]+$/u),
	city: cityInputSchema,
	bio: z.string().trim().max(1000).nullable().optional(),
	avatarUrl: nullableUrlSchema.optional()
});

export type PublicProfileLookup = z.infer<typeof publicProfileLookupSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;

