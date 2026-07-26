import { describe, expect, it } from 'vitest';
import { conditionLabel } from '../../src/lib/domain/condition';
import type { BottleAmount } from '../../src/lib/domain/types';
import {
	remainingPercent,
	resizeBottle,
	setRemainingMl,
	setRemainingPercent,
	setSealed,
	validateBottleAmount
} from '../../src/lib/domain/volume';

describe('linked bottle amount', () => {
	it('preserves the fill ratio when bottle capacity changes', () => {
		const initial: BottleAmount = { bottleVolumeMl: 65, remainingMl: 29.9, isSealed: false };

		expect(remainingPercent(initial)).toBe(46);
		expect(resizeBottle(initial, 100)).toEqual({
			bottleVolumeMl: 100,
			remainingMl: 46,
			isSealed: false
		});
	});

	it('keeps exact 0.1 ml input authoritative even when the rounded percentage is tiny', () => {
		const amount = setRemainingMl(
			{ bottleVolumeMl: 500, remainingMl: 250, isSealed: false },
			1
		);

		expect(amount.remainingMl).toBe(1);
		expect(remainingPercent(amount)).toBe(0);
		expect(remainingPercent(amount, 1)).toBe(0.2);
		expect(validateBottleAmount(amount, true)).toEqual({ ok: true });
	});

	it('rounds slider-derived amounts to 0.1 ml and clamps exact ml to capacity', () => {
		const initial: BottleAmount = { bottleVolumeMl: 65, remainingMl: 30, isSealed: false };

		expect(setRemainingPercent(initial, 46).remainingMl).toBe(29.9);
		expect(setRemainingMl(initial, 80).remainingMl).toBe(65);
		expect(setRemainingMl(initial, -2).remainingMl).toBe(0);
	});

	it('forces sealed products to 100% and rejects empty active listings', () => {
		const sealed = setSealed(
			{ bottleVolumeMl: 50, remainingMl: 12.5, isSealed: false },
			true
		);

		expect(sealed).toEqual({ bottleVolumeMl: 50, remainingMl: 50, isSealed: true });
		expect(setRemainingPercent(sealed, 10).remainingMl).toBe(50);

		const emptyResult = validateBottleAmount(
			{ bottleVolumeMl: 50, remainingMl: 0, isSealed: false },
			true
		);
		expect(emptyResult.ok).toBe(false);
		if (!emptyResult.ok) {
			expect(emptyResult.issues.map((issue) => issue.code)).toContain(
				'empty_listing_not_allowed'
			);
		}
	});

	it('rejects values that are not representable with 0.1 ml precision', () => {
		const result = validateBottleAmount({
			bottleVolumeMl: 65.05,
			remainingMl: 29.95,
			isSealed: false
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining(['bottle_volume_invalid', 'remaining_volume_invalid'])
		);
		}
	});
});

describe('automatic condition labels', () => {
	it.each([
		[false, 100, 'opened_full'],
		[false, 99, 'opened_almost_full'],
		[false, 90, 'opened_almost_full'],
		[false, 89, 'lightly_used'],
		[false, 70, 'lightly_used'],
		[false, 69, 'partially_used'],
		[false, 30, 'partially_used'],
		[false, 29, 'heavily_used'],
		[false, 1, 'heavily_used'],
		[false, 0, 'empty'],
		[true, 100, 'sealed']
	] as const)('maps sealed=%s and %s%% to %s', (isSealed, remainingMl, expectedCode) => {
		expect(
			conditionLabel({ bottleVolumeMl: 100, remainingMl, isSealed }).code
		).toBe(expectedCode);
	});
});
