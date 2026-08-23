import type { DealParticipantSet, DealStatus } from './types';

export function isDealParticipant(participants: DealParticipantSet, profileId: string): boolean {
	return profileId === participants.partyAId || profileId === participants.partyBId;
}

export function canCompleteDeal(
	status: DealStatus,
	participants: DealParticipantSet,
	listingSellerId: string,
	profileId: string
): boolean {
	return (
		status === 'pending_confirmation' &&
		listingSellerId === participants.partyAId &&
		profileId === listingSellerId
	);
}

export function canCancelDeal(
	status: DealStatus,
	participants: DealParticipantSet,
	profileId: string
): boolean {
	return (
		(status === 'pending_confirmation' || status === 'disputed') &&
		isDealParticipant(participants, profileId)
	);
}
