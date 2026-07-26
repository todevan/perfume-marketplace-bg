import type { BottleAmount } from './types';
import { remainingPercent, remainingRatio } from './volume';

export type ConditionCode =
	| 'sealed'
	| 'opened_full'
	| 'opened_almost_full'
	| 'lightly_used'
	| 'partially_used'
	| 'heavily_used'
	| 'empty';

export interface ConditionLabel {
	code: ConditionCode;
	label: string;
	percent: number;
}

export function conditionLabel(amount: BottleAmount): ConditionLabel {
	const percent = remainingPercent(amount);
	const rawPercent = remainingRatio(amount) * 100;
	if (amount.isSealed) return { code: 'sealed', label: 'Запечатан', percent: 100 };
	if (amount.remainingMl === amount.bottleVolumeMl) {
		return { code: 'opened_full', label: 'Отворен, пълен', percent };
	}
	if (rawPercent >= 90) {
		return { code: 'opened_almost_full', label: 'Отворен, почти пълен', percent };
	}
	if (rawPercent >= 70) return { code: 'lightly_used', label: 'Леко използван', percent };
	if (rawPercent >= 30) return { code: 'partially_used', label: 'Частично използван', percent };
	if (amount.remainingMl > 0) {
		return { code: 'heavily_used', label: 'Силно използван', percent };
	}
	return { code: 'empty', label: 'Празен', percent: 0 };
}
