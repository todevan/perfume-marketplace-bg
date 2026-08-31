// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { DealDto, ListingCardDto } from '../../src/lib/contracts';
import DealsPage from '../../src/routes/deals/+page.svelte';

const seller = {
	id: 'seller-1',
	username: 'seller',
	avatarUrl: null,
	accountKind: 'private' as const,
	merchantVerified: false
};
const buyer = { ...seller, id: 'buyer-1', username: 'buyer' };
const listing: ListingCardDto = {
	id: 'listing-1',
	slug: 'disputed-deal',
	kind: 'offer',
	dealMode: 'sale',
	title: 'Disputed deal',
	brandId: 'brand-1',
	brandName: 'Brand',
	brandSlug: 'brand',
	fragranceName: 'Fragrance',
	concentration: 'EDP',
	city: 'Sofia',
	price: { amountMinor: 10000, currency: 'EUR' },
	maxBudget: null,
	bottleVolumeMl: 100,
	remainingMl: 90,
	isSealed: false,
	status: 'reserved',
	seller,
	primaryPhoto: null,
	authenticityReviewed: false,
	createdAt: '2026-08-31T12:00:00.000Z'
};
const disputed: DealDto = {
	id: 'deal-1',
	listing,
	offeredListing: null,
	partyA: seller,
	partyB: buyer,
	conversationId: 'conversation-1',
	status: 'disputed',
	completedAt: null,
	disputedAt: '2026-08-31T13:00:00.000Z',
	cancelledAt: null,
	cancellationReason: null,
	createdAt: '2026-08-31T12:30:00.000Z'
};

afterEach(() => cleanup());

describe('disputed deal actions', () => {
	for (const [role, viewerId] of [
		['seller', seller.id],
		['buyer', buyer.id]
	] as const) {
		it(`lets the ${role} cancel without exposing completion, review, or another dispute`, () => {
			const { container } = render(DealsPage, {
				data: {
					auth: { user: null, profile: null, betaAccess: null, currentAal: null },
					requestId: 'issue25-disputed-actions',
					authConfigured: true,
					turnstileSiteKey: null,
					demoMode: false,
					viewerId,
					deals: [disputed],
					highlight: null
				},
				form: null
			});

			expect(screen.getByText('Отказ')).toBeTruthy();
			expect(container.querySelector('form[action="?/cancel"]')).not.toBeNull();
			expect(container.querySelector('form[action="?/complete"]')).toBeNull();
			expect(container.querySelector('form[action="?/review"]')).toBeNull();
			expect(container.querySelector('form[action="?/dispute"]')).toBeNull();
		});
	}
});
