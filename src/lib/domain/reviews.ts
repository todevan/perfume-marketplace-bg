import { issuesResult } from './result';
import type {
	DealParticipantSet,
	DealStatus,
	DomainIssue,
	ReviewInput,
	ValidationResult
} from './types';
import { isDealParticipant } from './deals';

export interface ReviewEligibilityContext {
	dealStatus: DealStatus;
	participants: DealParticipantSet;
	alreadyReviewed: boolean;
}

export function validateReview(
	review: ReviewInput,
	context: ReviewEligibilityContext
): ValidationResult {
	const issues: DomainIssue[] = [];
	if (context.dealStatus !== 'completed') {
		issues.push({ code: 'deal_not_completed', message: 'Отзив се оставя само след приключена сделка.' });
	}
	if (
		!isDealParticipant(context.participants, review.reviewerId) ||
		!isDealParticipant(context.participants, review.revieweeId)
	) {
		issues.push({ code: 'review_not_participant', message: 'Отзив могат да оставят само страните по сделката.' });
	}
	if (review.reviewerId === review.revieweeId) {
		issues.push({ code: 'self_review', message: 'Не можете да оцените себе си.' });
	}
	if (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) {
		issues.push({ code: 'rating_invalid', field: 'rating', message: 'Оценката трябва да е от 1 до 5.' });
	}
	if ((review.body?.trim().length ?? 0) > 2000) {
		issues.push({ code: 'review_too_long', field: 'body', message: 'Отзивът може да бъде до 2000 знака.' });
	}
	if (context.alreadyReviewed) {
		issues.push({ code: 'review_duplicate', message: 'Вече сте оставили отзив за тази сделка.' });
	}

	return issuesResult(issues);
}
