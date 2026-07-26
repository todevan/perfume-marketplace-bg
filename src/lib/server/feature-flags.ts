export const FEATURE_FLAG_NAMES = [
	'billing',
	'listingFees',
	'merchantSubscriptions',
	'boosts',
	'directAds',
	'smsVerification',
	'myposPayments',
	'stripeFallback'
] as const;

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number];
export type FeatureFlags = Readonly<Record<FeatureFlagName, boolean>>;

export interface MonetisationReadiness {
	consecutiveQualifiedMonths: number;
	qualityActiveListings: number;
	activeSellers: number;
	qualifiedInquiryRate: number;
	marketplacePageviews: number;
	monthlyActiveUsers: number;
	interestedAdvertisingPartners: number;
}

export const BILLING_LAUNCH_GATE = Object.freeze({
	consecutiveQualifiedMonths: 3,
	qualityActiveListings: 500,
	activeSellers: 150,
	qualifiedInquiryRate: 0.35
});

export const DIRECT_ADS_LAUNCH_GATE = Object.freeze({
	marketplacePageviews: 25_000,
	monthlyActiveUsers: 3_000,
	interestedAdvertisingPartners: 3
});

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = Object.freeze({
	billing: false,
	listingFees: false,
	merchantSubscriptions: false,
	boosts: false,
	directAds: false,
	smsVerification: false,
	myposPayments: false,
	stripeFallback: false
});

const envKeys: Record<FeatureFlagName, string> = {
	billing: 'FEATURE_BILLING_ENABLED',
	listingFees: 'FEATURE_LISTING_FEES_ENABLED',
	merchantSubscriptions: 'FEATURE_MERCHANT_SUBSCRIPTIONS_ENABLED',
	boosts: 'FEATURE_BOOSTS_ENABLED',
	directAds: 'FEATURE_DIRECT_ADS_ENABLED',
	smsVerification: 'FEATURE_SMS_VERIFICATION_ENABLED',
	myposPayments: 'FEATURE_MYPOS_PAYMENTS_ENABLED',
	stripeFallback: 'FEATURE_STRIPE_FALLBACK_ENABLED'
};

export function parseBooleanFlag(value: string | undefined, fallback = false): boolean {
	if (value == null || value.trim() === '') return fallback;
	const normalized = value.trim().toLowerCase();
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	return fallback;
}

export function resolveFeatureFlags(
	environment: Readonly<Record<string, string | undefined>>,
	overrides: Partial<Record<FeatureFlagName, boolean>> = {}
): FeatureFlags {
	const resolved = { ...DEFAULT_FEATURE_FLAGS };
	for (const name of FEATURE_FLAG_NAMES) {
		resolved[name] = parseBooleanFlag(environment[envKeys[name]], DEFAULT_FEATURE_FLAGS[name]);
	}

	return Object.freeze({ ...resolved, ...overrides });
}

export function isFeatureEnabled(flags: FeatureFlags, name: FeatureFlagName): boolean {
	return flags[name];
}

/** Paid features always require the global billing gate in addition to their own flag. */
export function isPaidFeatureEnabled(
	flags: FeatureFlags,
	name: 'listingFees' | 'merchantSubscriptions' | 'boosts'
): boolean {
	return flags.billing && flags[name];
}

export function meetsBillingLaunchGate(metrics: MonetisationReadiness): boolean {
	return (
		metrics.consecutiveQualifiedMonths >= BILLING_LAUNCH_GATE.consecutiveQualifiedMonths &&
		metrics.qualityActiveListings >= BILLING_LAUNCH_GATE.qualityActiveListings &&
		metrics.activeSellers >= BILLING_LAUNCH_GATE.activeSellers &&
		metrics.qualifiedInquiryRate >= BILLING_LAUNCH_GATE.qualifiedInquiryRate
	);
}

export function meetsDirectAdsLaunchGate(metrics: MonetisationReadiness): boolean {
	return (
		metrics.marketplacePageviews >= DIRECT_ADS_LAUNCH_GATE.marketplacePageviews &&
		metrics.monthlyActiveUsers >= DIRECT_ADS_LAUNCH_GATE.monthlyActiveUsers &&
		metrics.interestedAdvertisingPartners >=
			DIRECT_ADS_LAUNCH_GATE.interestedAdvertisingPartners
	);
}

export function canActivatePaidMarketplaceFeatures(
	flags: FeatureFlags,
	metrics: MonetisationReadiness
): boolean {
	return flags.billing && meetsBillingLaunchGate(metrics);
}

export function assertFeatureEnabled(flags: FeatureFlags, name: FeatureFlagName): void {
	if (!flags[name]) throw new Error(`Feature flag is disabled: ${name}`);
}
