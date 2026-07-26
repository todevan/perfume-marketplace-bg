import type { ListingCardDto, ListingDetailDto } from '$lib/contracts';

export function cashAmountMinor(value: FormDataEntryValue | null): number | null {
	if (typeof value !== 'string' || !value.trim()) return null;
	const parsed = Number(value.trim().replace(',', '.'));
	return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
}

export function offerKindAllowed(
	listing: Pick<ListingDetailDto, 'dealMode'>,
	kind: string
): boolean {
	if (listing.dealMode === 'sale') return kind === 'cash';
	if (listing.dealMode === 'swap') return kind === 'swap';
	return kind === 'cash' || kind === 'swap' || kind === 'cash_plus_swap';
}

export function offeredListingEligible(
	listing: Pick<ListingCardDto, 'kind' | 'status' | 'dealMode' | 'remainingMl'>
): boolean {
	return (
		listing.kind === 'offer' &&
		listing.status === 'active' &&
		(listing.dealMode === 'swap' || listing.dealMode === 'sale_or_swap') &&
		listing.remainingMl != null &&
		listing.remainingMl > 0
	);
}
