import type {
	Audience,
	Concentration,
	DealMode,
	ListingKind,
	PhotoRole,
	ProductFormat
} from '$domain/types';

export type {
	AccountKind,
	Audience,
	Concentration,
	DealMode,
	ListingKind,
	PhotoRole,
	ProductFormat,
	Segment
} from '$domain/types';

export interface ListingDraft {
	brandId: string;
	brand: string;
	customBrand: string;
	fragranceName: string;
	audience: Audience;
	niche: boolean;
	arabic: boolean;
	listingKind: ListingKind;
	dealMode: DealMode;
	productFormat: ProductFormat;
	concentration: Concentration;
	bottleVolumeMl: number;
	remainingMl: number;
	sealed: boolean;
	price: string;
	estimatedValue: string;
	maxBudget: string;
	city: string;
	description: string;
	fragranticaUrl: string;
}

export type PhotoMap = Record<string, File | null>;

export interface EvidenceRole {
	key: PhotoRole;
	title: string;
	helper: string;
}
