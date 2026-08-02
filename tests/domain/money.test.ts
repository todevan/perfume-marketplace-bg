import { describe, expect, it } from 'vitest';
import { eurosToMoney } from '../../src/lib/domain/money';

describe('euro conversion safety', () => {
	it('rounds ordinary euro inputs to safe integer cents', () => {
		expect(eurosToMoney(12.345)).toEqual({ amountMinor: 1235, currency: 'EUR' });
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01])(
		'rejects invalid euro input %s',
		(value) => {
			expect(() => eurosToMoney(value)).toThrow(RangeError);
		}
	);

	it('rejects values whose cent representation exceeds safe integers', () => {
		expect(() => eurosToMoney(Number.MAX_SAFE_INTEGER)).toThrow(
			'Euro amount exceeds the safe cent range.'
		);
	});
});
