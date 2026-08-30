// @vitest-environment jsdom

import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ListingPage from '../../src/routes/listing/[slug]/+page.svelte';

afterEach(() => {
	cleanup();
	delete (window as Window & { turnstile?: unknown }).turnstile;
});

describe('offer Turnstile challenge', () => {
	it('explicitly renders the challenge when the offer dialog mounts and removes it on close', async () => {
		const renderWidget = vi.fn(() => 'offer-widget');
		const removeWidget = vi.fn();
		(window as Window & { turnstile?: { render: typeof renderWidget; remove: typeof removeWidget } }).turnstile = {
			render: renderWidget,
			remove: removeWidget
		};

		const { container, getByRole } = render(ListingPage, {
			data: {
				auth: { betaAccess: null, currentAal: null, profile: null, user: null },
				authConfigured: true,
				demoMode: false,
				favorite: false,
				listing: {
					id: '11111111-1111-4111-8111-111111111111',
					slug: 'offer-turnstile-test',
					kind: 'offer',
					dealMode: 'sale',
					title: 'Offer Turnstile test',
					brandId: '22222222-2222-4222-8222-222222222222',
					brandName: 'Test Brand',
					brandSlug: 'test-brand',
					fragranceId: null,
					fragranceName: 'Test Fragrance',
					concentration: 'EDP',
					concentrationLabel: null,
					city: 'Sofia',
					price: { amountMinor: 4200, currency: 'EUR' },
					estimatedValue: null,
					maxBudget: null,
					bottleVolumeMl: 50,
					remainingMl: 45,
					isSealed: false,
					status: 'active',
					productFormat: 'retail_bottle',
					audience: 'unisex',
					segments: [],
					description: 'A hosted offer Turnstile fixture.',
					referenceUrl: null,
					photos: [],
					primaryPhoto: null,
					authenticityReviewed: false,
					authenticityNote: null,
					seller: {
						id: '33333333-3333-4333-8333-333333333333',
						username: 'seller_fixture',
						avatarUrl: null,
						accountKind: 'private',
						merchantVerified: false
					},
					activatedAt: '2026-08-30T12:00:00.000Z',
					expiresAt: null,
					createdAt: '2026-08-30T12:00:00.000Z',
					updatedAt: '2026-08-30T12:00:00.000Z'
				},
				offeredListings: [],
				requestId: 'test-offer-turnstile',
				similar: [],
				turnstileSiteKey: 'turnstile-site-key'
			},
			form: null
		});
		await tick();

		expect(renderWidget).not.toHaveBeenCalled();
		await fireEvent.click(getByRole('button', { name: /Изпрати оферта/u }));
		await tick();

		const dialog = getByRole('dialog', { name: 'Твоята оферта' });
		expect(container.querySelectorAll('.cf-turnstile')).toHaveLength(1);
		expect(renderWidget).toHaveBeenCalledTimes(1);
		expect(renderWidget).toHaveBeenLastCalledWith(
			expect.any(HTMLElement),
			expect.objectContaining({ action: 'offer_submit', sitekey: 'turnstile-site-key' })
		);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Затвори' }));
		await tick();
		expect(removeWidget).toHaveBeenCalledWith('offer-widget');
	});
});
