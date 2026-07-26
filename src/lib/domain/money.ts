import type { Money, ValidationResult } from './types';
import { invalid, valid } from './result';

export const EUR = 'EUR' as const;

export function eurosToMoney(euros: number): Money {
	if (!Number.isFinite(euros) || euros < 0) {
		throw new RangeError('Euro amount must be a finite non-negative number.');
	}

	return { amountMinor: Math.round((euros + Number.EPSILON) * 100), currency: EUR };
}

export function moneyToEuros(money: Money): number {
	return money.amountMinor / 100;
}

export function validateMoney(
	money: Money | null | undefined,
	field: string,
	options: { required?: boolean; allowZero?: boolean } = {}
): ValidationResult {
	if (money == null) {
		return options.required
			? invalid({ code: 'money_required', field, message: 'Стойността е задължителна.' })
			: valid();
	}

	if (money.currency !== EUR) {
		return invalid({ code: 'currency_invalid', field, message: 'Поддържаната валута е EUR.' });
	}

	if (!Number.isSafeInteger(money.amountMinor)) {
		return invalid({
			code: 'money_not_integer_minor',
			field,
			message: 'Сумата трябва да бъде зададена в цели евроцентове.'
		});
	}

	if (money.amountMinor < 0 || (!options.allowZero && money.amountMinor === 0)) {
		return invalid({ code: 'money_not_positive', field, message: 'Сумата трябва да е положителна.' });
	}

	return valid();
}
