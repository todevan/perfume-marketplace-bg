import { describe, expect, it } from 'vitest';
import {
	isAllowedFragranticaUrl,
	listingExpiresAt,
	requiredPhotoRoles,
	validateListing
} from '../../src/lib/domain/listing';
import type {
	ListingActivationContext,
	ListingInput,
	ListingPhotoInput,
	ValidationResult
} from '../../src/lib/domain/types';

const openedPhotos: ListingPhotoInput[] = [
	{ role: 'product_full', storagePath: 'listing/full.jpg' },
	{ role: 'bottle_bottom', storagePath: 'listing/bottom.jpg' },
	{ role: 'batch_code', storagePath: 'listing/code.jpg' },
	{ role: 'fill_level', storagePath: 'listing/level.jpg' }
];

const activation: ListingActivationContext = {
	activeListingCount: 3,
	activeListingLimit: 10
};

function makeListing(overrides: Partial<ListingInput> = {}): ListingInput {
	return {
		sellerId: 'profile-seller',
		kind: 'offer',
		dealMode: 'sale_or_swap',
		productFormat: 'retail_bottle',
		audience: 'unisex',
		segments: ['niche'],
		concentration: 'EDP',
		fragranceName: 'Gris Charnel Extrait',
		brandId: 'brand-bdk-parfums',
		amount: { bottleVolumeMl: 100, remainingMl: 82, isSealed: false },
		price: { amountMinor: 12_500, currency: 'EUR' },
		photos: openedPhotos,
		status: 'draft',
		...overrides
	};
}

function issueCodes(result: ValidationResult): string[] {
	return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe('listing price and activation rules', () => {
	it('accepts a publishable sale-or-swap listing within quota', () => {
		expect(validateListing(makeListing({ status: 'active' }), activation)).toEqual({ ok: true });
	});

	it('requires a positive EUR sale price', () => {
		expect(issueCodes(validateListing(makeListing({ dealMode: 'sale', price: undefined })))).toContain(
			'money_required'
		);
		expect(
			issueCodes(
				validateListing(
					makeListing({ dealMode: 'sale', price: { amountMinor: 0, currency: 'EUR' } })
				)
			)
		).toContain('money_not_positive');
	});

	it('allows an optional estimated value for swaps but no sale price', () => {
		const validSwap = makeListing({
			dealMode: 'swap',
			price: undefined,
			estimatedValue: { amountMinor: 8_000, currency: 'EUR' }
		});
		expect(validateListing(validSwap)).toEqual({ ok: true });
		expect(issueCodes(validateListing({ ...validSwap, price: validSwap.estimatedValue }))).toContain(
			'swap_price_invalid'
		);
	});

	it('keeps wanted listings on the max-budget field only', () => {
		const wanted = makeListing({
			kind: 'wanted',
			productFormat: undefined,
			amount: undefined,
			photos: [],
			price: undefined,
			estimatedValue: undefined,
			maxBudget: { amountMinor: 15_000, currency: 'EUR' }
		});

		expect(validateListing(wanted)).toEqual({ ok: true });
		expect(issueCodes(validateListing({ ...wanted, price: wanted.maxBudget }))).toContain(
			'wanted_price_fields_invalid'
		);
	});

	it('requires a free slot before activation without a phone gate', () => {
		const listing = makeListing({ status: 'active' });
		const result = validateListing(listing, {
			activeListingCount: 10,
			activeListingLimit: 10
		});

		expect(issueCodes(result)).toEqual(['active_listing_quota_reached']);
	});

	it('rejects a zero-remaining active offer', () => {
		const result = validateListing(
			makeListing({
				status: 'active',
				amount: { bottleVolumeMl: 100, remainingMl: 0, isSealed: false }
			}),
			activation
		);
		expect(issueCodes(result)).toContain('empty_listing_not_allowed');
	});

	it('expires listings after exactly 60 UTC calendar days', () => {
		expect(listingExpiresAt(new Date('2026-07-21T22:30:00.000Z')).toISOString()).toBe(
			'2026-09-19T22:30:00.000Z'
		);
	});
});

describe('photo evidence contracts', () => {
	it('selects evidence roles for opened, sealed and official-sample products', () => {
		expect([...requiredPhotoRoles(makeListing())]).toEqual([
			'product_full',
			'bottle_bottom',
			'batch_code',
			'fill_level'
		]);
		expect([
			...requiredPhotoRoles(
				makeListing({ amount: { bottleVolumeMl: 100, remainingMl: 100, isSealed: true } })
			)
		]).toEqual(['box_front', 'box_bottom', 'batch_code', 'seal']);
		expect([...requiredPhotoRoles(makeListing({ productFormat: 'official_sample' }))]).toEqual([
			'product_full',
			'manufacturer_label',
			'manufacturer_markings',
			'seal'
		]);
	});

	it('requires at least four photos and every product-specific role for active offers', () => {
		const result = validateListing(
			makeListing({
				status: 'active',
				photos: [
					{ role: 'product_full' },
					{ role: 'bottle_bottom' },
					{ role: 'batch_code' }
				]
			}),
			activation
		);

		expect(issueCodes(result)).toEqual(
			expect.arrayContaining(['photos_too_few', 'photo_role_missing'])
		);
	});
});

describe('Fragrantica external-link allowlist', () => {
	it.each([
		'https://www.fragrantica.com/perfume/Dior/Sauvage-Eau-de-Parfum-48100.html',
		'https://www.fragrantica.com/perfume/BDK-Parfums/Gris-Charnel-57038.html?source=listing'
	])('accepts a direct HTTPS perfume URL: %s', (url) => {
		expect(isAllowedFragranticaUrl(url)).toBe(true);
	});

	it.each([
		'http://www.fragrantica.com/perfume/Dior/Sauvage-31861.html',
		'https://fragrantica.com/perfume/Dior/Sauvage-31861.html',
		'https://www.fragrantica.com/designers/Dior.html',
		'https://www.fragrantica.com.evil.example/perfume/Dior/Sauvage-31861.html',
		'https://www.fragrantica.com@evil.example/perfume/Dior/Sauvage-31861.html',
		'not-a-url'
	])('rejects non-allowlisted or deceptive URL: %s', (url) => {
		expect(isAllowedFragranticaUrl(url)).toBe(false);
	});
});
