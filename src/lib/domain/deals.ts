import type { DealConfirmation, DealParticipantSet, DealStatus } from './types';

export function isDealParticipant(participants: DealParticipantSet, profileId: string): boolean {
	return profileId === participants.partyAId || profileId === participants.partyBId;
}

export function hasMutualConfirmation(
	participants: DealParticipantSet,
	confirmations: readonly DealConfirmation[]
): boolean {
	const confirmed = new Set(confirmations.map((confirmation) => confirmation.profileId));
	return confirmed.has(participants.partyAId) && confirmed.has(participants.partyBId);
}

export function statusAfterConfirmation(
	participants: DealParticipantSet,
	confirmations: readonly DealConfirmation[],
	currentStatus: DealStatus
): DealStatus {
	if (currentStatus !== 'pending_confirmation') return currentStatus;
	return hasMutualConfirmation(participants, confirmations) ? 'completed' : currentStatus;
}
