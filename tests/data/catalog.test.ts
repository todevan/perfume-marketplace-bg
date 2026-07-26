import { describe, expect, it } from 'vitest';
import {
	catalogBrands,
	otherBrandOption,
	resolveCatalogBrand,
	searchCatalogBrands
} from '../../src/lib/data/catalog';

describe('canonical brand registry', () => {
	it('exposes the full deduplicated registry independently from editorial collections', () => {
		expect(catalogBrands).toHaveLength(196);
		expect(new Set(catalogBrands.map((brand) => brand.id)).size).toBe(196);
		expect(new Set(catalogBrands.map((brand) => brand.canonicalName)).size).toBe(196);
	});

	it('never returns more than eight searchable canonical brands', () => {
		expect(searchCatalogBrands('')).toHaveLength(8);
		expect(searchCatalogBrands('a', 100)).toHaveLength(8);
		expect(searchCatalogBrands('a', 3)).toHaveLength(3);
	});

	it.each([
		['Armani', 'brand-giorgio-armani', 'Giorgio Armani'],
		['Afnan', 'brand-afnan-perfumes', 'Afnan Perfumes']
	])('resolves exact alias %s to its canonical identity', (alias, id, canonicalName) => {
		const result = resolveCatalogBrand(alias);
		expect(result).toMatchObject({
			matchedBy: 'alias',
			brand: { id, canonicalName },
			matchedAlias: { value: alias }
		});
	});

	it('keeps unknown brands publishable through the pending canonicalization state', () => {
		expect(otherBrandOption).toEqual({
			label: 'Други',
			moderationState: 'pending_canonicalization'
		});
		expect(resolveCatalogBrand('Неинтегрирана тестова марка')).toBeNull();
	});
});
