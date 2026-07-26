import { z } from 'zod';
import { listingSearchInputSchema, type ListingSearchInput } from './listings';
import { optionalPageSchema, uuidSchema, type PageDto } from './common';

export interface SavedSearchDto {
	readonly id: string;
	readonly name: string;
	readonly filters: ListingSearchInput;
	readonly notificationsEnabled: boolean;
	readonly lastNotifiedAt: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export type SavedSearchPageDto = PageDto<SavedSearchDto>;

export const savedSearchListInputSchema = optionalPageSchema;
export const saveSearchInputSchema = z.object({
	name: z.string().trim().min(1).max(80),
	filters: listingSearchInputSchema,
	notificationsEnabled: z.boolean().default(false)
});
export const updateSavedSearchInputSchema = saveSearchInputSchema.extend({ savedSearchId: uuidSchema });
export const savedSearchIdInputSchema = z.object({ savedSearchId: uuidSchema });

export type SavedSearchListInput = z.infer<typeof savedSearchListInputSchema>;
export type SaveSearchInput = z.infer<typeof saveSearchInputSchema>;
export type UpdateSavedSearchInput = z.infer<typeof updateSavedSearchInputSchema>;

