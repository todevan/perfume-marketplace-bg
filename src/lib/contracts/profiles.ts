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

export const updateProfileInputSchema = z.object({
	username: z.string().trim().min(3).max(40).regex(/^[\p{L}\p{N}_.-]+$/u),
	city: z.string().trim().min(2).max(100),
	bio: z.string().trim().max(1000).nullable().optional(),
	avatarUrl: nullableUrlSchema.optional()
});

export type PublicProfileLookup = z.infer<typeof publicProfileLookupSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;

