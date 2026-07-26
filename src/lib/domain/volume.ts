import type { BottleAmount, ValidationResult } from './types';
import { issuesResult } from './result';

export const MIN_BOTTLE_VOLUME_ML = 0.1;
export const MAX_BOTTLE_VOLUME_ML = 500;

export function roundMl(value: number): number {
	return Math.round((value + Number.EPSILON) * 10) / 10;
}

export function clampMl(value: number, min = 0, max = MAX_BOTTLE_VOLUME_ML): number {
	return roundMl(Math.min(max, Math.max(min, value)));
}

export function remainingRatio(amount: Pick<BottleAmount, 'bottleVolumeMl' | 'remainingMl'>): number {
	if (amount.bottleVolumeMl <= 0) return 0;
	return Math.min(1, Math.max(0, amount.remainingMl / amount.bottleVolumeMl));
}

export function remainingPercent(
	amount: Pick<BottleAmount, 'bottleVolumeMl' | 'remainingMl'>,
	precision = 0
): number {
	const factor = 10 ** Math.max(0, precision);
	return Math.round(remainingRatio(amount) * 100 * factor) / factor;
}

/** Changes bottle capacity while preserving the current fill ratio. */
export function resizeBottle(amount: BottleAmount, nextBottleVolumeMl: number): BottleAmount {
	const bottleVolumeMl = clampMl(
		nextBottleVolumeMl,
		MIN_BOTTLE_VOLUME_ML,
		MAX_BOTTLE_VOLUME_ML
	);
	const ratio = amount.isSealed ? 1 : remainingRatio(amount);

	return {
		bottleVolumeMl,
		remainingMl: roundMl(bottleVolumeMl * ratio),
		isSealed: amount.isSealed
	};
}

/** Changes the slider percentage while preserving bottle capacity. */
export function setRemainingPercent(amount: BottleAmount, percent: number): BottleAmount {
	const normalizedPercent = Math.min(100, Math.max(0, percent));
	return {
		...amount,
		remainingMl: amount.isSealed
			? amount.bottleVolumeMl
			: roundMl((amount.bottleVolumeMl * normalizedPercent) / 100)
	};
}

/** Exact ml is authoritative; the UI derives the percentage from this value. */
export function setRemainingMl(amount: BottleAmount, nextRemainingMl: number): BottleAmount {
	return {
		...amount,
		remainingMl: amount.isSealed
			? amount.bottleVolumeMl
			: clampMl(nextRemainingMl, 0, amount.bottleVolumeMl)
	};
}

export function setSealed(amount: BottleAmount, isSealed: boolean): BottleAmount {
	return {
		...amount,
		isSealed,
		remainingMl: isSealed ? amount.bottleVolumeMl : amount.remainingMl
	};
}

export function validateBottleAmount(amount: BottleAmount, requireRemaining = false): ValidationResult {
	const issues = [];
	if (
		!Number.isFinite(amount.bottleVolumeMl) ||
		amount.bottleVolumeMl < MIN_BOTTLE_VOLUME_ML ||
		amount.bottleVolumeMl > MAX_BOTTLE_VOLUME_ML ||
		roundMl(amount.bottleVolumeMl) !== amount.bottleVolumeMl
	) {
		issues.push({
			code: 'bottle_volume_invalid',
			field: 'amount.bottleVolumeMl',
			message: 'Обемът трябва да е между 0,1 и 500 ml с точност 0,1 ml.'
		});
	}

	if (
		!Number.isFinite(amount.remainingMl) ||
		amount.remainingMl < 0 ||
		amount.remainingMl > amount.bottleVolumeMl ||
		roundMl(amount.remainingMl) !== amount.remainingMl
	) {
		issues.push({
			code: 'remaining_volume_invalid',
			field: 'amount.remainingMl',
			message: 'Остатъкът трябва да е между 0 и обема на флакона, с точност 0,1 ml.'
		});
	}

	if (amount.isSealed && amount.remainingMl !== amount.bottleVolumeMl) {
		issues.push({
			code: 'sealed_not_full',
			field: 'amount.remainingMl',
			message: 'Запечатаният продукт трябва да е 100% пълен.'
		});
	}

	if (requireRemaining && amount.remainingMl === 0) {
		issues.push({
			code: 'empty_listing_not_allowed',
			field: 'amount.remainingMl',
			message: 'Празен продукт не може да бъде публикуван.'
		});
	}

	return issuesResult(issues);
}
