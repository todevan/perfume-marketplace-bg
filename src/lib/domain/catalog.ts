export type BrandStatus = 'canonical' | 'pending_canonicalization' | 'merged' | 'rejected';
export type BrandAliasKind =
	| 'alternate'
	| 'common_misspelling'
	| 'transliteration'
	| 'previous_name'
	| 'product_line'
	| 'acronym'
	| 'other';

export interface BrandRecord {
	id: string;
	canonicalName: string;
	slug: string;
	status: BrandStatus;
	parentBrandId?: string | null;
	mergedIntoBrandId?: string | null;
	submittedDisplayName?: string | null;
	normalizedKey: string;
	provenance: Record<string, unknown>;
}

export interface BrandAlias {
	id: string;
	brandId: string;
	kind: BrandAliasKind;
	value: string;
	normalizedValue: string;
}

export function normalizeCatalogKey(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase('bg-BG')
		.replace(/&/g, ' and ')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}
