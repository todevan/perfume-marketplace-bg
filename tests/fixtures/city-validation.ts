export const UNICODE_SPACE_SEPARATORS = [
	'\u0020',
	'\u00a0',
	'\u1680',
	'\u2000',
	'\u2001',
	'\u2002',
	'\u2003',
	'\u2004',
	'\u2005',
	'\u2006',
	'\u2007',
	'\u2008',
	'\u2009',
	'\u200a',
	'\u202f',
	'\u205f',
	'\u3000'
] as const;

export const C0_C1_CONTROL_CODE_POINTS = [
	...Array.from({ length: 0x20 }, (_, index) => index),
	...Array.from({ length: 0x21 }, (_, index) => 0x7f + index)
] as const;

export const UNICODE_FORMAT_CODE_POINT_RANGES = [
	[0x00ad, 0x00ad],
	[0x0600, 0x0605],
	[0x061c, 0x061c],
	[0x06dd, 0x06dd],
	[0x070f, 0x070f],
	[0x0890, 0x0891],
	[0x08e2, 0x08e2],
	[0x180e, 0x180e],
	[0x200b, 0x200f],
	[0x202a, 0x202e],
	[0x2060, 0x2064],
	[0x2066, 0x206f],
	[0xfeff, 0xfeff],
	[0xfff9, 0xfffb],
	[0x110bd, 0x110bd],
	[0x110cd, 0x110cd],
	[0x13430, 0x1343f],
	[0x1bca0, 0x1bca3],
	[0x1d173, 0x1d17a],
	[0xe0001, 0xe0001],
	[0xe0020, 0xe007f]
] as const;

export const UNICODE_FORMAT_CHARACTER_FIXTURES = UNICODE_FORMAT_CODE_POINT_RANGES.flatMap(
	([first, last]) =>
		Array.from({ length: last - first + 1 }, (_, offset) => {
			const codePoint = first + offset;
			return {
				name: `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`,
				codePoint,
				value: String.fromCodePoint(codePoint)
			};
		})
);

const ASTRAL_LETTER = '\u{10400}';

export const ACCEPTED_CITY_FIXTURES = [
	{ name: 'single Cyrillic name', input: 'София', normalized: 'София' },
	{ name: 'multi-word Cyrillic name', input: 'Стара Загора', normalized: 'Стара Загора' },
	{ name: 'natural punctuation', input: 'Св. Влас', normalized: 'Св. Влас' },
	{ name: 'number-only city identifier', input: '42', normalized: '42' },
	{
		name: 'every Unicode Space_Separator collapsed to one ASCII space',
		input: `Стара${UNICODE_SPACE_SEPARATORS.join('')}Загора`,
		normalized: 'Стара Загора'
	},
	{
		name: 'leading and trailing Unicode spaces trimmed',
		input: '\u3000София\u00a0',
		normalized: 'София'
	},
	{
		name: 'two astral Unicode letters',
		input: ASTRAL_LETTER.repeat(2),
		normalized: ASTRAL_LETTER.repeat(2)
	},
	{
		name: 'one hundred astral Unicode letters',
		input: ASTRAL_LETTER.repeat(100),
		normalized: ASTRAL_LETTER.repeat(100)
	}
] as const;

export const REJECTED_CITY_FIXTURES = [
	{ name: 'empty', input: '' },
	{ name: 'ASCII whitespace only', input: '   ' },
	{ name: 'NBSP only', input: '\u00a0\u00a0' },
	{ name: 'zero-width format only', input: '\u200b' },
	{ name: 'embedded zero-width format', input: 'Со\u200bфия' },
	{ name: 'embedded C0 control', input: 'Со\u0000фия' },
	{ name: 'embedded C1 control', input: 'Со\u0085фия' },
	{ name: 'punctuation only', input: '---' },
	{ name: 'one Unicode code point', input: ASTRAL_LETTER },
	{ name: 'one hundred and one Unicode code points', input: ASTRAL_LETTER.repeat(101) }
] as const;

