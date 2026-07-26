import { describe, expect, it } from 'vitest';
import {
	hasMutualConfirmation,
	isDealParticipant,
	statusAfterConfirmation
} from '../../src/lib/domain/deals';
import {
	activeListingLimit,
	BASE_ACTIVE_LISTING_LIMIT,
	remainingListingSlots
} from '../../src/lib/domain/quota';
import { validateReview } from '../../src/lib/domain/reviews';
import type {
	DealConfirmation,
	DealParticipantSet,
	ReviewInput,
	ValidationResult
} from '../../src/lib/domain/types';

const participants: DealParticipantSet = { partyAId: 'seller', partyBId: 'buyer' };
const sellerConfirmation: DealConfirmation = {
	profileId: 'seller',
	confirmedAt: '2026-07-21T10:00:00.000Z'
};
const buyerConfirmation: DealConfirmation = {
	profileId: 'buyer',
	confirmedAt: '2026-07-21T10:05:00.000Z'
};

function issueCodes(result: ValidationResult): string[] {
	return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe('double-confirmed deals', () => {
	it('does not complete after a single confirmation or duplicate confirmations by one party', () => {
		expect(hasMutualConfirmation(participants, [sellerConfirmation])).toBe(false);
		expect(hasMutualConfirmation(participants, [sellerConfirmation, sellerConfirmation])).toBe(false);
		expect(
			statusAfterConfirmation(participants, [sellerConfirmation], 'pending_confirmation')
		).toBe('pending_confirmation');
	});

	it('completes only after both distinct participants confirm', () => {
		const confirmations = [sellerConfirmation, buyerConfirmation];
		expect(hasMutualConfirmation(participants, confirmations)).toBe(true);
		expect(statusAfterConfirmation(participants, confirmations, 'pending_confirmation')).toBe(
			'completed'
		);
		expect(statusAfterConfirmation(participants, confirmations, 'disputed')).toBe('disputed');
	});

	it('recognizes only the two deal participants', () => {
		expect(isDealParticipant(participants, 'seller')).toBe(true);
		expect(isDealParticipant(participants, 'buyer')).toBe(true);
		expect(isDealParticipant(participants, 'moderator')).toBe(false);
	});
});

describe('transaction review eligibility', () => {
	const review: ReviewInput = {
		dealId: 'deal-1',
		reviewerId: 'buyer',
		revieweeId: 'seller',
		rating: 5,
		body: 'Точно описание и коректна комуникация.'
	};

	it('allows one participant to review the other after completion', () => {
		expect(
			validateReview(review, {
				dealStatus: 'completed',
				participants,
				alreadyReviewed: false
			})
		).toEqual({ ok: true });
	});

	it('rejects reviews before mutual completion', () => {
		expect(
			issueCodes(
				validateReview(review, {
					dealStatus: 'pending_confirmation',
					participants,
					alreadyReviewed: false
				})
			)
		).toContain('deal_not_completed');
	});

	it('rejects outsiders, self-reviews and duplicate reviews', () => {
		const result = validateReview(
			{ ...review, reviewerId: 'outsider', revieweeId: 'outsider' },
			{ dealStatus: 'completed', participants, alreadyReviewed: true }
		);
		expect(issueCodes(result)).toEqual(
			expect.arrayContaining(['review_not_participant', 'self_review', 'review_duplicate'])
		);
	});

	it('requires an integer rating from 1 through 5', () => {
		for (const rating of [0, 2.5, 6]) {
			const result = validateReview(
				{ ...review, rating },
				{ dealStatus: 'completed', participants, alreadyReviewed: false }
			);
			expect(issueCodes(result)).toContain('rating_invalid');
		}
	});
});

describe('active listing quota', () => {
	it('starts every account at ten free active listings', () => {
		expect(activeListingLimit([])).toBe(BASE_ACTIVE_LISTING_LIMIT);
		expect(remainingListingSlots(3, BASE_ACTIVE_LISTING_LIMIT)).toBe(7);
		expect(remainingListingSlots(10, BASE_ACTIVE_LISTING_LIMIT)).toBe(0);
	});

	it('uses the highest merchant plan and adds paid listing-slot entitlements', () => {
		expect(
			activeListingLimit([
				{ kind: 'merchant_start', active: true },
				{ kind: 'merchant_pro', active: true },
				{ kind: 'extra_listing_slot', active: true, quantity: 3 },
				{ kind: 'extra_listing_slot', active: false, quantity: 100 }
			])
		).toBe(203);
	});

	it('never returns negative remaining capacity', () => {
		expect(remainingListingSlots(12, 10)).toBe(0);
		expect(remainingListingSlots(-3, 10)).toBe(10);
	});
});
