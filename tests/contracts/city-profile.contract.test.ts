import { describe, expect, it } from 'vitest';
import { citySchema, updateProfileInputSchema } from '../../src/lib/contracts';
import {
	ACCEPTED_CITY_FIXTURES,
	C0_C1_CONTROL_CODE_POINTS,
	REJECTED_CITY_FIXTURES,
	UNICODE_FORMAT_CHARACTER_FIXTURES
} from '../fixtures/city-validation';

describe('profile city contract', () => {
	it.each(ACCEPTED_CITY_FIXTURES)('accepts and normalizes $name', ({ input, normalized }) => {
		expect(citySchema.safeParse(input)).toMatchObject({ success: true, data: normalized });
	});

	it.each(REJECTED_CITY_FIXTURES)('rejects $name', ({ input }) => {
		expect(citySchema.safeParse(input).success).toBe(false);
	});

	it.each(C0_C1_CONTROL_CODE_POINTS)(
		'rejects control code point U+%s anywhere in a city',
		(codePoint) => {
			expect(citySchema.safeParse(`Со${String.fromCodePoint(codePoint)}фия`).success).toBe(false);
		}
	);

	it.each(UNICODE_FORMAT_CHARACTER_FIXTURES)(
		'rejects Unicode format character $name anywhere in a city',
		({ value }) => {
			expect(citySchema.safeParse(`Со${value}фия`).success).toBe(false);
		}
	);

	it('uses the required shared city contract for profile updates', () => {
		expect(updateProfileInputSchema.safeParse({ username: 'valid_user', city: '' }).success).toBe(false);
		expect(updateProfileInputSchema.safeParse({ username: 'valid_user', city: null }).success).toBe(false);
		expect(updateProfileInputSchema.safeParse({ username: 'valid_user' }).success).toBe(false);
		expect(
			updateProfileInputSchema.parse({ username: 'valid_user', city: '  Стара\u00a0Загора  ' }).city
		).toBe('Стара Загора');
	});
});
