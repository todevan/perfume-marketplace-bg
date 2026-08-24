// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ListingDetailDto } from '../../src/lib/contracts';
import ListingPage from '../../src/routes/listing/[slug]/+page.svelte';

const listing: ListingDetailDto = {
	id: '11111111-1111-4111-8111-111111111111',
	slug: 'turnstile-offer-test',
	kind: 'offer',
	dealMode: 'sale',
	title: 'Turnstile offer test',
	brandId: '22222222-2222-4222-8222-222222222222',
	brandName: 'Test Brand',
	brandSlug: 'test-brand',
	fragranceId: null,
	fragranceName: 'Test Fragrance',
	concentration: 'EDP',
	concentrationLabel: 'Eau de parfum',
	productFormat: 'retail_bottle',
	audience: 'unisex',
	segments: [],
	city: 'Sofia',
	price: { amountMinor: 4000, currency: 'EUR' },
	maxBudget: null,
	bottleVolumeMl: 100,
	remainingMl: 90,
	isSealed: false,
	status: 'active',
	description: 'Focused offer Turnstile lifecycle fixture.',
	estimatedValue: null,
	referenceUrl: null,
	photos: [],
	authenticityReviewed: false,
	authenticityNote: null,
	activatedAt: '2026-08-24T00:00:00.000Z',
	expiresAt: '2026-09-23T00:00:00.000Z',
	createdAt: '2026-08-24T00:00:00.000Z',
	updatedAt: '2026-08-24T00:00:00.000Z',
	primaryPhoto: null,
	seller: {
		id: '33333333-3333-4333-8333-333333333333',
		username: 'seller',
		avatarUrl: null,
		accountKind: 'private',
		merchantVerified: false
	}
};

const data = {
	auth: { user: null, profile: null, betaAccess: null, currentAal: null },
	requestId: 'listing-offer-turnstile-test',
	authConfigured: true,
	listing,
	similar: [],
	offeredListings: [],
	favorite: false,
	turnstileSiteKey: 'turnstile-site-key',
	demoMode: false
};

afterEach(() => {
	cleanup();
	delete (window as Window & { turnstile?: unknown }).turnstile;
});

describe('listing offer Turnstile lifecycle', () => {
	it('renders after the modal exists, resets on failure, and removes each widget exactly once', async () => {
		let widgetNumber = 0;
		const renderWidget = vi.fn(() => `offer-widget-${++widgetNumber}`);
		const resetWidget = vi.fn();
		const removeWidget = vi.fn();
		(window as Window & {
			turnstile?: {
				render: typeof renderWidget;
				reset: typeof resetWidget;
				remove: typeof removeWidget;
			};
		}).turnstile = { render: renderWidget, reset: resetWidget, remove: removeWidget };

		const view = render(ListingPage, { data, form: null });
		await fireEvent.click(screen.getByRole('button', { name: /Изпрати оферта/u }));
		const dialog = screen.getByRole('dialog', { name: 'Твоята оферта' });

		await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));
		expect(renderWidget).toHaveBeenLastCalledWith(
			dialog.querySelector('.cf-turnstile'),
			expect.objectContaining({ action: 'offer_submit', sitekey: 'turnstile-site-key' })
		);

		await view.rerender({
			data,
			form: {
				offerResult: {
					ok: false,
					error: { code: 'VALIDATION', message: 'Try again.', fieldErrors: {} }
				}
			}
		});
		await waitFor(() => expect(resetWidget).toHaveBeenCalledTimes(1));
		const failedSubmissionWidget = renderWidget.mock.results.at(-1)?.value;
		expect(resetWidget).toHaveBeenCalledWith(failedSubmissionWidget);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Затвори' }));
		await waitFor(() => expect(removeWidget).toHaveBeenCalledWith(failedSubmissionWidget));

		const renderCountBeforeReopen = renderWidget.mock.calls.length;
		await fireEvent.click(screen.getByRole('button', { name: /Изпрати оферта/u }));
		await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(renderCountBeforeReopen + 1));
		expect(document.querySelectorAll('.offer-panel .cf-turnstile')).toHaveLength(1);
		const reopenedWidget = renderWidget.mock.results.at(-1)?.value;

		await view.rerender({
			data,
			form: {
				offerResult: {
					ok: true,
					data: {
						id: '44444444-4444-4444-8444-444444444444',
						listing,
						offerer: {
							id: '55555555-5555-4555-8555-555555555555',
							username: 'buyer',
							avatarUrl: null,
							accountKind: 'private',
							merchantVerified: false
						},
						kind: 'cash',
						cash: { amountMinor: 4000, currency: 'EUR' },
						offeredListing: null,
						message: null,
						status: 'pending',
						expiresAt: null,
						respondedAt: null,
						createdAt: '2026-08-24T01:00:00.000Z'
					}
				}
			}
		});
		await waitFor(() => expect(removeWidget).toHaveBeenCalledWith(reopenedWidget));
		for (const result of renderWidget.mock.results) {
			expect(removeWidget.mock.calls.filter(([widgetId]) => widgetId === result.value)).toHaveLength(1);
		}

		view.unmount();
		expect(removeWidget).toHaveBeenCalledTimes(renderWidget.mock.calls.length);
	});
});
