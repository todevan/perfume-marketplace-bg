import type { AuthenticityReviewStatus } from './types';

export interface AuthenticityPresentation {
	label: string;
	tone: 'neutral' | 'success' | 'warning' | 'danger';
	disclaimer: string;
}

const DISCLAIMER =
	'Прегледът е на предоставените доказателства и не представлява гаранция за оригиналност.';

export function authenticityPresentation(
	status: AuthenticityReviewStatus
): AuthenticityPresentation {
	switch (status) {
		case 'evidence_reviewed':
			return { label: 'Доказателствата са прегледани', tone: 'success', disclaimer: DISCLAIMER };
		case 'insufficient_evidence':
			return { label: 'Недостатъчни доказателства', tone: 'warning', disclaimer: DISCLAIMER };
		case 'rejected':
			return { label: 'Доказателствата са отхвърлени', tone: 'danger', disclaimer: DISCLAIMER };
		case 'pending':
			return { label: 'Предстои преглед', tone: 'neutral', disclaimer: DISCLAIMER };
	}
}
