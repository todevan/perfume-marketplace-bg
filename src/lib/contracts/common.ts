import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const optionalPageSchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(24),
	offset: z.coerce.number().int().min(0).max(10_000).default(0)
});

export type PageInput = z.infer<typeof optionalPageSchema>;

export interface PageDto<T> {
	readonly items: readonly T[];
	readonly total: number;
	readonly limit: number;
	readonly offset: number;
	readonly hasMore: boolean;
}

export interface MoneyDto {
	readonly amountMinor: number;
	readonly currency: 'EUR';
}

export interface ActorSummaryDto {
	readonly id: string;
	readonly username: string;
	readonly avatarUrl: string | null;
	readonly accountKind: 'private' | 'merchant';
	readonly merchantVerified: boolean;
}

export const nullableUrlSchema = z
	.union([
		z
			.string()
			.trim()
			.url()
			.max(500)
			.refine((value) => /^https?:\/\//i.test(value), 'Only HTTP(S) URLs are accepted.'),
		z.literal(''),
		z.null()
	])
	.transform((value) => (value === '' ? null : value));
