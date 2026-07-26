export type MerchantPlan = 'basic' | 'start' | 'pro';
export type QuotaEntitlement =
	| { kind: 'merchant_start'; active: boolean }
	| { kind: 'merchant_pro'; active: boolean }
	| { kind: 'extra_listing_slot'; active: boolean; quantity?: number };

export const BASE_ACTIVE_LISTING_LIMIT = 10;
export const MERCHANT_START_LIMIT = 50;
export const MERCHANT_PRO_LIMIT = 200;

export function activeListingLimit(entitlements: readonly QuotaEntitlement[]): number {
	let planLimit = BASE_ACTIVE_LISTING_LIMIT;
	let extraSlots = 0;

	for (const entitlement of entitlements) {
		if (!entitlement.active) continue;
		if (entitlement.kind === 'merchant_pro') planLimit = Math.max(planLimit, MERCHANT_PRO_LIMIT);
		if (entitlement.kind === 'merchant_start') {
			planLimit = Math.max(planLimit, MERCHANT_START_LIMIT);
		}
		if (entitlement.kind === 'extra_listing_slot') {
			extraSlots += Math.max(1, Math.floor(entitlement.quantity ?? 1));
		}
	}

	return planLimit + extraSlots;
}

export function remainingListingSlots(activeCount: number, limit: number): number {
	return Math.max(0, limit - Math.max(0, activeCount));
}
