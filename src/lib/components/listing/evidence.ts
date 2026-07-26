import type { EvidenceRole, ListingKind, ProductFormat } from './types';

export function getEvidenceRoles(
	productFormat: ProductFormat,
	sealed: boolean,
	listingKind: ListingKind
): EvidenceRole[] {
	if (listingKind === 'wanted') {
		return [
			{
				key: 'other',
				title: 'Твоя ориентировъчна снимка',
				helper: 'Незадължително. Качи само снимка, която притежаваш и имаш право да използваш.'
			}
		];
	}

	if (productFormat === 'official_sample') {
		return [
			{
				key: 'product_full',
				title: 'Предна страна и етикет',
				helper: 'Името на аромата и марката трябва да се четат ясно.'
			},
			{
				key: 'manufacturer_label',
				title: 'Гръб или втори етикет',
				helper: 'Покажи текста, състава или данните на производителя, ако са налични.'
			},
			{
				key: 'manufacturer_markings',
				title: 'Фабрични означения',
				helper: 'Batch code не е задължителен за мостра; снимай всички налични фабрични знаци.'
			},
			sealed
				? {
						key: 'seal',
						title: 'Пломба или фабрично затваряне',
						helper: 'Покажи, че мострата не е отваряна.'
					}
				: {
						key: 'fill_level',
						title: 'Ниво на течността',
						helper: 'Снимай срещу равномерна светлина, без да обработваш изображението.'
					}
		];
	}

	if (sealed) {
		return [
			{
				key: 'box_front',
				title: 'Лице на кутията',
				helper: 'Цялата предна страна да е във фокус.'
			},
			{
				key: 'box_bottom',
				title: 'Дъно на кутията',
				helper: 'Покажи баркод, производител и всички налични надписи.'
			},
			{
				key: 'batch_code',
				title: 'Batch code',
				helper: 'Кодът трябва да е четим и да не е закрит от отражение.'
			},
			{
				key: 'seal',
				title: 'Пломби и целофан',
				helper: 'Покажи ръбовете и фабричното запечатване отблизо.'
			}
		];
	}

	return [
		{
			key: 'product_full',
			title: 'Цял продукт',
			helper: productFormat === 'tester' ? 'Покажи флакона и тестерната кутия, ако я имаш.' : 'Покажи флакона и кутията, ако я имаш.'
		},
		{
			key: 'bottle_bottom',
			title: 'Дъно на флакона',
			helper: 'Етикетът, гравирането и надписите трябва да се виждат ясно.'
		},
		{
			key: 'batch_code',
			title: 'Batch code',
			helper: 'Снимай кода отблизо и без силно отражение.'
		},
		{
			key: 'fill_level',
			title: 'Ниво на течността',
			helper: 'Снимай флакона срещу равномерна светлина, за да се вижда остатъкът.'
		}
	];
}

export function uniqueSelectedEvidenceCount(roles: EvidenceRole[], photos: Record<string, File | null>): number {
	const signatures = new Set<string>();
	for (const role of roles) {
		const file = photos[role.key];
		if (file) signatures.add(`${file.name}:${file.size}:${file.lastModified}`);
	}
	return signatures.size;
}
