export type AccountKind = 'private' | 'merchant';
export type PlatformRole = 'user' | 'moderator' | 'admin';
export type Audience = 'men' | 'women' | 'unisex';
export type Segment = 'niche' | 'arabic';

export type ListingKind = 'offer' | 'wanted';
export type DealMode = 'sale' | 'swap' | 'sale_or_swap';
export type ProductFormat = 'retail_bottle' | 'tester' | 'official_sample';
export type Concentration =
	| 'EDT'
	| 'EDP'
	| 'PARFUM'
	| 'EXTRAIT'
	| 'EDC'
	| 'OTHER_NOT_STATED';

export type ListingStatus =
	| 'draft'
	| 'active'
	| 'reserved'
	| 'paused'
	| 'completed'
	| 'expired'
	| 'rejected'
	| 'removed';

export type PhotoRole =
	| 'product_full'
	| 'bottle_bottom'
	| 'batch_code'
	| 'fill_level'
	| 'box_front'
	| 'box_bottom'
	| 'seal'
	| 'manufacturer_label'
	| 'manufacturer_markings'
	| 'other';

export type OfferKind = 'cash' | 'swap' | 'cash_plus_swap';
export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired';
export type DealStatus = 'pending_confirmation' | 'completed' | 'disputed' | 'cancelled';
export type ReviewStatus = 'published' | 'hidden' | 'removed';
export type AuthenticityReviewStatus =
	| 'pending'
	| 'evidence_reviewed'
	| 'insufficient_evidence'
	| 'rejected';

export interface Money {
	/** Integer euro cents. */
	amountMinor: number;
	currency: 'EUR';
}

export interface BottleAmount {
	bottleVolumeMl: number;
	remainingMl: number;
	isSealed: boolean;
}

export interface ListingPhotoInput {
	id?: string;
	role: PhotoRole;
	storagePath?: string;
}

export interface ListingInput {
	id?: string;
	sellerId: string;
	kind: ListingKind;
	dealMode: DealMode;
	productFormat?: ProductFormat;
	audience: Audience;
	segments: Segment[];
	concentration: Concentration;
	concentrationLabel?: string | null;
	fragranceName: string;
	fragranticaUrl?: string | null;
	brandId?: string | null;
	otherBrandName?: string | null;
	amount?: BottleAmount | null;
	price?: Money | null;
	estimatedValue?: Money | null;
	maxBudget?: Money | null;
	photos: ListingPhotoInput[];
	status: ListingStatus;
}

export interface ListingActivationContext {
	phoneVerified: boolean;
	activeListingCount: number;
	activeListingLimit: number;
}

export interface OfferInput {
	id?: string;
	listingId: string;
	listingSellerId: string;
	offererId: string;
	kind: OfferKind;
	cash?: Money | null;
	offeredListingId?: string | null;
	message?: string | null;
	listingStatus: ListingStatus;
	listingDealMode: DealMode;
}

export interface DealParticipantSet {
	partyAId: string;
	partyBId: string;
}

export interface DealConfirmation {
	profileId: string;
	confirmedAt: Date | string;
}

export interface ReviewInput {
	dealId: string;
	reviewerId: string;
	revieweeId: string;
	rating: number;
	body?: string | null;
}

export interface DomainIssue {
	code: string;
	field?: string;
	message: string;
}

export type ValidationResult =
	| { ok: true }
	| { ok: false; issues: DomainIssue[] };
