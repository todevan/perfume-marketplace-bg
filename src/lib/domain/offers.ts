import { validateMoney } from './money';
import { issuesResult } from './result';
import type { DomainIssue, OfferInput, OfferStatus, ValidationResult } from './types';

const offerTransitions: Record<OfferStatus, ReadonlySet<OfferStatus>> = {
	pending: new Set(['accepted', 'declined', 'withdrawn', 'expired']),
	accepted: new Set(),
	declined: new Set(),
	withdrawn: new Set(),
	expired: new Set()
};

export function canTransitionOffer(from: OfferStatus, to: OfferStatus): boolean {
	return from === to || offerTransitions[from].has(to);
}

export function validateOffer(offer: OfferInput): ValidationResult {
	const issues: DomainIssue[] = [];
	if (offer.offererId === offer.listingSellerId) {
		issues.push({ code: 'self_offer', message: 'Не можете да изпратите оферта към себе си.' });
	}
	if (offer.listingStatus !== 'active') {
		issues.push({ code: 'listing_not_active', message: 'Офертата изисква активна обява.' });
	}

	const allowsCash = offer.listingDealMode !== 'swap';
	const allowsSwap = offer.listingDealMode !== 'sale';
	if ((offer.kind === 'cash' || offer.kind === 'cash_plus_swap') && !allowsCash) {
		issues.push({ code: 'cash_not_allowed', field: 'kind', message: 'Обявата не приема парични оферти.' });
	}
	if ((offer.kind === 'swap' || offer.kind === 'cash_plus_swap') && !allowsSwap) {
		issues.push({ code: 'swap_not_allowed', field: 'kind', message: 'Обявата не приема размяна.' });
	}

	const cashRequired = offer.kind === 'cash' || offer.kind === 'cash_plus_swap';
	const cashResult = validateMoney(offer.cash, 'cash', { required: cashRequired });
	if (!cashResult.ok) issues.push(...cashResult.issues);
	if (!cashRequired && offer.cash != null) {
		issues.push({ code: 'unexpected_cash', field: 'cash', message: 'Тази оферта не включва пари.' });
	}

	const listingRequired = offer.kind === 'swap' || offer.kind === 'cash_plus_swap';
	if (listingRequired && !offer.offeredListingId) {
		issues.push({
			code: 'offered_listing_required',
			field: 'offeredListingId',
			message: 'Изберете ваша активна обява за размяната.'
		});
	}
	if (!listingRequired && offer.offeredListingId) {
		issues.push({
			code: 'unexpected_offered_listing',
			field: 'offeredListingId',
			message: 'Паричната оферта не включва продукт за размяна.'
		});
	}

	if ((offer.message?.trim().length ?? 0) > 1000) {
		issues.push({
			code: 'offer_message_too_long',
			field: 'message',
			message: 'Съобщението може да бъде до 1000 знака.'
		});
	}

	return issuesResult(issues);
}
