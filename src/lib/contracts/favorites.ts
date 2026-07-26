import { z } from 'zod';
import type { ListingCardDto } from './listings';
import { optionalPageSchema, uuidSchema, type PageDto } from './common';

export interface FavoriteDto {
	readonly listing: ListingCardDto;
	readonly createdAt: string;
}

export type FavoritePageDto = PageDto<FavoriteDto>;

export const favoriteInputSchema = z.object({ listingId: uuidSchema });
export const favoriteListInputSchema = optionalPageSchema;

export type FavoriteInput = z.infer<typeof favoriteInputSchema>;
export type FavoriteListInput = z.infer<typeof favoriteListInputSchema>;

