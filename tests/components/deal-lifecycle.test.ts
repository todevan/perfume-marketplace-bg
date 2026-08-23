// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import DealPage from '../../src/routes/deals/+page.svelte';
import type { DealDto, ListingCardDto } from '../../src/lib/contracts';

afterEach(cleanup);

const sellerId = '11111111-1111-4111-8111-111111111111';
const buyerId = '22222222-2222-4222-8222-222222222222';

const listing: ListingCardDto = {
	id: '33333333-3333-4333-8333-333333333333',
	slug: 'seller-completion-test',
	kind: 'offer',
	dealMode: 'sale',
	title: 'Seller completion test',
	brandId: '66666666-6666-4666-8666-666666666666',
	brandName: 'Test Brand',
	brandSlug: 'test-brand',
	fragranceName: 'Seller completion test',
	concentration: 'EDP',
	city: 'Sofia',
	price: { amountMinor: 4000, currency: 'EUR' },
	maxBudget: null,
	bottleVolumeMl: 100,
	remainingMl: 90,
	isSealed: false,
	status: 'reserved',
	seller: {
		id: sellerId,
		username: 'seller',
		avatarUrl: null,
		accountKind: 'private',
		merchantVerified: false
	},
	primaryPhoto: null,
	authenticityReviewed: false,
	createdAt: '2026-08-24T00:00:00.000Z'
};

function deal(status: DealDto['status'], cancellationReason: string | null = null): DealDto {
	return {
		id: '44444444-4444-4444-8444-444444444444',
		listing,
		offeredListing: null,
		partyA: listing.seller,
		partyB: {
			id: buyerId,
			username: 'buyer',
			avatarUrl: null,
			accountKind: 'private',
			merchantVerified: false
		},
		conversationId: '55555555-5555-4555-8555-555555555555',
		status,
		completedAt: status === 'completed' ? '2026-08-24T01:00:00.000Z' : null,
		disputedAt: null,
		cancelledAt: status === 'cancelled' ? '2026-08-24T01:00:00.000Z' : null,
		cancellationReason,
		createdAt: '2026-08-24T00:00:00.000Z'
	};
}

function renderDeal(viewerId: string, item: DealDto): HTMLElement {
	const { container } = render(DealPage, {
		data: {
			auth: { user: { id: viewerId }, profile: null, betaAccess: null, currentAal: 'aal1' },
			requestId: 'deal-lifecycle-test',
			authConfigured: true,
			turnstileSiteKey: null,
			demoMode: false,
			viewerId,
			deals: [item],
			highlight: null
		},
		form: null
	});
	return container.querySelector('article.deal-card') as HTMLElement;
}

describe('role-specific deal lifecycle controls', () => {
	it('shows seller completion and participant cancellation controls to the seller', () => {
		const card = renderDeal(sellerId, deal('pending_confirmation'));
		expect(within(card).getByRole('button', { name: 'Отбележи като приключена' })).toBeTruthy();
		expect(within(card).getByText('Откажи сделката')).toBeTruthy();
		expect(card.querySelector('form[action="?/complete"]')).not.toBeNull();
		expect(card.querySelector('textarea[name="reason"]')?.hasAttribute('required')).toBe(true);
	});

	it('guides the buyer without exposing a completion action', () => {
		const card = renderDeal(buyerId, deal('pending_confirmation'));
		expect(within(card).queryByRole('button', { name: 'Отбележи като приключена' })).toBeNull();
		expect(within(card).getByText('Продавачът отбелязва сделката като приключена.')).toBeTruthy();
		expect(within(card).getByText('Откажи сделката')).toBeTruthy();
	});

	it('lets the buyer cancel a disputed deal without rendering completion or review actions', () => {
		const card = renderDeal(buyerId, deal('disputed'));
		expect(within(card).getByText('Откажи сделката')).toBeTruthy();
		expect(card.querySelector('form[action="?/cancel"]')).not.toBeNull();
		expect(card.querySelector('textarea[name="reason"]')?.hasAttribute('required')).toBe(true);
		expect(card.querySelector('form[action="?/complete"]')).toBeNull();
		expect(within(card).queryByRole('button', { name: 'Публикувай отзив' })).toBeNull();
	});

	it('renders reviews only for completed deals', () => {
		const completed = renderDeal(buyerId, deal('completed'));
		expect(within(completed).getByRole('button', { name: 'Публикувай отзив' })).toBeTruthy();
		cleanup();
		const cancelled = renderDeal(buyerId, deal('cancelled', 'Няма уговорена доставка'));
		expect(within(cancelled).queryByRole('button', { name: 'Публикувай отзив' })).toBeNull();
		expect(within(cancelled).getByText('Няма уговорена доставка')).toBeTruthy();
	});
});
