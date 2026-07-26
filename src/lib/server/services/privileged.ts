import type { MarketplaceSupabaseClient } from '../repositories';

declare const serviceRoleCapability: unique symbol;

/** Opaque capability for audited operations that are impossible through user RLS. */
export type PrivilegedMarketplaceClient = MarketplaceSupabaseClient & {
	readonly [serviceRoleCapability]: true;
};

/** Call only at the composition root immediately after constructing a service-role client. */
export function acknowledgeServiceRoleClient(
	client: MarketplaceSupabaseClient
): PrivilegedMarketplaceClient {
	return client as PrivilegedMarketplaceClient;
}

