import type { DealParticipantSet, DealStatus } from './types';

export function isDealParticipant(participants: DealParticipantSet, profileId: string): boolean {
	return profileId === participants.partyAId || profileId === participants.partyBId;
}

export function canCompleteDeal(
	status: DealStatus,
	listingSellerId: string,
	viewerId: string
): boolean {
	return status === 'pending_confirmation' && listingSellerId === viewerId;
}

export function canCancelDeal(
	status: DealStatus,
	participants: DealParticipantSet,
	viewerId: string
): boolean {
	return (
		(status === 'pending_confirmation' || status === 'disputed') &&
		isDealParticipant(participants, viewerId)
	);
}

export function canReviewDeal(status: DealStatus): boolean {
	return status === 'completed';
}

export function visibleCancellationReason(
	status: DealStatus,
	cancellationReason: string | null
): string | null {
	return status === 'cancelled' ? cancellationReason : null;
}
