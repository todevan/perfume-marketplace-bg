import { describe, expect, it } from 'vitest';
import {
	createOfferInputSchema,
	listingDraftInputSchema,
	merchantApplicationInputSchema,
	updateProfileInputSchema
} from '../../src/lib/contracts';

const uuid = '11111111-1111-4111-8111-111111111111';
const otherUuid = '22222222-2222-4222-8222-222222222222';

describe('production data input contracts', () => {
	it('rejects offer value shapes that do not match their kind', () => {
		expect(
			createOfferInputSchema.safeParse({ listingId: uuid, kind: 'cash' }).success
		).toBe(false);
		expect(
			createOfferInputSchema.safeParse({
				listingId: uuid,
				kind: 'cash_plus_swap',
				cashAmountMinor: 5000,
				offeredListingId: otherUuid
			}).success
		).toBe(true);
	});

	it('validates physical listing fields before a database round trip', () => {
		const base = {
			kind: 'offer',
			dealMode: 'sale',
			audience: 'unisex',
			segments: [],
			brandId: uuid,
			fragranceName: 'Example scent',
			concentration: 'EDP',
			title: 'Example listing',
			description: '',
			city: 'Sofia',
			isSealed: false,
			priceMinor: 5000
		};
		expect(listingDraftInputSchema.safeParse(base).success).toBe(false);
		expect(
			listingDraftInputSchema.safeParse({
				...base,
				productFormat: 'retail_bottle',
				bottleVolumeMl: 100,
				remainingMl: 80
			}).success
		).toBe(true);
	});

	it('requires a merchant declaration when submitting an application', () => {
		const input = {
			legalName: 'Example Ltd',
			registrationNumber: 'BG1234',
			registeredAddress: 'Sofia, Bulgaria',
			documentPaths: [],
			submit: true,
			declarationAccepted: false
		};
		expect(merchantApplicationInputSchema.safeParse(input).success).toBe(false);
		expect(
			merchantApplicationInputSchema.safeParse({ ...input, declarationAccepted: true }).success
		).toBe(true);
	});

	it('normalizes empty optional profile URLs without accepting arbitrary strings', () => {
		expect(
			updateProfileInputSchema.parse({ username: 'valid_user', city: ' Sofia ', avatarUrl: '' })
		).toMatchObject({ city: 'Sofia', avatarUrl: null });
		expect(
			updateProfileInputSchema.safeParse({
				username: 'valid_user',
				city: 'Sofia',
				avatarUrl: 'javascript:alert(1)'
			}).success
		).toBe(false);
	});

	it.each([undefined, null, '', ' ', 'S'])(
		'rejects a profile update that would remove the required city (%s)',
		(city) => {
			expect(updateProfileInputSchema.safeParse({ username: 'valid_user', city }).success).toBe(
				false
			);
		}
	);
});

