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

const FORBIDDEN_CITY_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]|\p{Cf}/u;

export const citySchema = z
	.string()
	.refine((value) => !FORBIDDEN_CITY_CHARACTERS.test(value), {
		message: 'City must not contain control or format characters.'
	})
	.transform((value) => value.replace(/\p{Zs}+/gu, ' ').replace(/^ +| +$/gu, ''))
	.refine((value) => {
		const codePointLength = Array.from(value).length;
		return codePointLength >= 2 && codePointLength <= 100;
	}, 'City must be between 2 and 100 Unicode characters.')
	.refine((value) => /[\p{L}\p{N}]/u.test(value), {
		message: 'City must contain at least one letter or number.'
	});

export const updateProfileInputSchema = z.object({
	username: z.string().trim().min(3).max(40).regex(/^[\p{L}\p{N}_.-]+$/u),
	city: citySchema,
	bio: z.string().trim().max(1000).nullable().optional(),
	avatarUrl: nullableUrlSchema.optional()
});

export type PublicProfileLookup = z.infer<typeof publicProfileLookupSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;

