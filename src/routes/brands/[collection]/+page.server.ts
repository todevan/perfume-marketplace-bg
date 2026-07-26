import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCatalogCollection, type CatalogBrand } from '$lib/data/catalog';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { getBrandCollection } from '$lib/server/services';

export const load: PageServerLoad = async ({ params, locals }) => {
	const presentation = getCatalogCollection(params.collection);
	if (!presentation) error(404, 'Тази колекция не съществува.');
	if (locals.runtime.mode === 'demo') return { collection: presentation, demoMode: true };
	if (!locals.supabase) error(503, 'Каталогът временно не е достъпен.');

	const result = await getBrandCollection(
		locals.supabase as MarketplaceSupabaseClient,
		presentation.key
	);
	if (!result.ok) error(503, result.error.message);
	const localByName = new Map(
		presentation.brands.map((brand) => [brand.canonicalName.toLocaleLowerCase('bg-BG'), brand])
	);
	const brands = result.data.flatMap((brand) => {
		const local = localByName.get(brand.name.toLocaleLowerCase('bg-BG'));
		return local ? [local] : [];
	}) satisfies CatalogBrand[];
	if (brands.length !== presentation.expectedBrandCount) {
		error(503, 'Редакционната витрина не е синхронизирана напълно.');
	}
	return { collection: { ...presentation, brands }, demoMode: false };
};
