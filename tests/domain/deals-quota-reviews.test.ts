import { describe, expect, it } from 'vitest';
import {
	canCancelDeal,
	canCompleteDeal,
	isDealParticipant,
} from '../../src/lib/domain/deals';
import {
	activeListingLimit,
	BASE_ACTIVE_LISTING_LIMIT,
	remainingListingSlots
} from '../../src/lib/domain/quota';
import { validateReview } from '../../src/lib/domain/reviews';
import type { DealParticipantSet, ReviewInput, ValidationResult } from '../../src/lib/domain/types';

const participants: DealParticipantSet = { partyAId: 'seller', partyBId: 'buyer' };

function issueCodes(result: ValidationResult): string[] {
	return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe('seller-controlled deal lifecycle', () => {
	it('recognizes only the two deal participants', () => {
		expect(isDealParticipant(participants, 'seller')).toBe(true);
		expect(isDealParticipant(participants, 'buyer')).toBe(true);
		expect(isDealParticipant(participants, 'moderator')).toBe(false);
	});

	it('allows only the listing seller to complete an accepted active deal', () => {
		expect(canCompleteDeal('pending_confirmation', participants, 'seller', 'seller')).toBe(true);
		expect(canCompleteDeal('pending_confirmation', participants, 'seller', 'buyer')).toBe(false);
		expect(canCompleteDeal('pending_confirmation', participants, 'seller', 'outsider')).toBe(false);
		expect(canCompleteDeal('pending_confirmation', participants, 'buyer', 'buyer')).toBe(false);
		expect(canCompleteDeal('completed', participants, 'seller', 'seller')).toBe(false);
	});

	it('allows either participant, but not an outsider, to cancel active accepted deals', () => {
		expect(canCancelDeal('pending_confirmation', participants, 'seller')).toBe(true);
		expect(canCancelDeal('pending_confirmation', participants, 'buyer')).toBe(true);
		expect(canCancelDeal('pending_confirmation', participants, 'outsider')).toBe(false);
		expect(canCancelDeal('disputed', participants, 'seller')).toBe(true);
		expect(canCancelDeal('disputed', participants, 'buyer')).toBe(true);
		expect(canCancelDeal('completed', participants, 'seller')).toBe(false);
		expect(canCancelDeal('cancelled', participants, 'buyer')).toBe(false);
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

	it.each(['pending_confirmation', 'cancelled'] as const)(
		'rejects reviews when the deal is %s',
		(dealStatus) => {
			expect(
				issueCodes(
					validateReview(review, {
						dealStatus,
						participants,
						alreadyReviewed: false
					})
				)
			).toContain('deal_not_completed');
		}
	);

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
