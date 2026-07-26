import type { SupabaseClient } from '@supabase/supabase-js';
import type { PageDto } from '../../contracts';
import type { Database, Json } from '../database.types';

export type MarketplaceSupabaseClient = SupabaseClient<Database>;

export interface SupabaseErrorLike {
	readonly code?: string;
	readonly message: string;
	readonly details?: string;
	readonly hint?: string;
}

export class RepositoryError extends Error {
	constructor(
		readonly operation: string,
		readonly databaseCode: string | undefined,
		message: string,
		readonly details?: string,
		readonly hint?: string
	) {
		super(message);
		this.name = 'RepositoryError';
	}

	static from(operation: string, error: SupabaseErrorLike): RepositoryError {
		return new RepositoryError(operation, error.code, error.message, error.details, error.hint);
	}
}

export function throwIfError(
	operation: string,
	error: SupabaseErrorLike | null | undefined
): asserts error is null | undefined {
	if (error) throw RepositoryError.from(operation, error);
}

export function requireData<T>(operation: string, data: T | null): T {
	if (data === null) {
		throw new RepositoryError(operation, 'PGRST116', 'The requested record was not found.');
	}
	return data;
}

export function pageDto<T>(
	items: readonly T[],
	count: number | null,
	limit: number,
	offset: number
): PageDto<T> {
	const total = count ?? items.length;
	return { items, total, limit, offset, hasMore: offset + items.length < total };
}

export function oneRelation<T>(value: T | readonly T[] | null | undefined): T | null {
	if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
	return (value as T | null | undefined) ?? null;
}

export function jsonObject(value: Json): Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Readonly<Record<string, unknown>>)
		: {};
}

export function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function signedListingImageUrls(
	client: MarketplaceSupabaseClient,
	paths: readonly string[],
	expiresInSeconds = 3600
): Promise<ReadonlyMap<string, string>> {
	const uniquePaths = [...new Set(paths.filter(Boolean))];
	if (uniquePaths.length === 0) return new Map();

	const { data, error } = await client.storage
		.from('listing-images')
		.createSignedUrls(uniquePaths, expiresInSeconds);
	throwIfError('listing_photos.sign', error);

	const result = new Map<string, string>();
	for (const entry of data ?? []) {
		if (entry.path && entry.signedUrl) result.set(entry.path, entry.signedUrl);
	}
	return result;
}

