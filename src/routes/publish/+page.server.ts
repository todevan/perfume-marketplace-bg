import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	actionFailure,
	actionSuccess,
	listingDraftInputSchema,
	listingIdInputSchema,
	pendingBrandInputSchema,
	type ActionError,
	type ActionResult,
	type BrandSummaryDto,
	type ListingDetailDto
} from '$lib/contracts';
import { catalogBrands as demoCatalogBrands } from '$lib/data/catalog';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import {
	editListingDraft,
	publishListing,
	saveListingDraft,
	searchCatalog,
	submitPendingBrand
} from '$lib/server/services';

const DEMO_DRAFT_ID = '00000000-0000-4000-8000-000000009999';

function serviceStatus(actionError: ActionError): number {
	if (actionError.code === 'VALIDATION') return 400;
	if (actionError.code === 'AUTH_REQUIRED') return 401;
	if (actionError.code === 'FORBIDDEN') return 403;
	if (actionError.code === 'NOT_FOUND') return 404;
	if (actionError.code === 'CONFLICT') return 409;
	if (actionError.code === 'RATE_LIMITED') return 429;
	return 503;
}

function phoneFailure(): ActionResult<never> {
	return actionFailure({
		code: 'FORBIDDEN',
		message: 'Потвърди телефона си, преди да запишеш първата обява.'
	});
}

function jsonPayload(formData: FormData): unknown {
	const raw = formData.get('payload');
	if (typeof raw !== 'string') return null;
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
}

function demoBrands(): readonly BrandSummaryDto[] {
	return demoCatalogBrands.map((brand, index) => ({
		id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
		name: brand.canonicalName,
		slug: brand.id,
		parentBrandId: null
	}));
}

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.runtime.mode === 'demo') {
		return {
			catalogBrands: demoBrands(),
			phoneVerified: true,
			initialCity: '',
			turnstileSiteKey: null,
			demoMode: true
		};
	}
	if (!locals.supabase || !locals.profile) error(503, 'Формата за публикуване временно не е достъпна.');
	const client = locals.supabase as MarketplaceSupabaseClient;
	const [first, second] = await Promise.all([
		searchCatalog(client, { query: '', limit: 100, offset: 0 }),
		searchCatalog(client, { query: '', limit: 100, offset: 100 })
	]);
	if (!first.ok) error(serviceStatus(first.error), first.error.message);
	if (!second.ok) error(serviceStatus(second.error), second.error.message);
	const brands = new Map<string, BrandSummaryDto>();
	for (const brand of [...first.data.brands, ...second.data.brands]) brands.set(brand.id, brand);
	return {
		catalogBrands: [...brands.values()].sort((left, right) => left.name.localeCompare(right.name, 'bg-BG')),
		phoneVerified: Boolean(locals.profile.phoneVerifiedAt),
		initialCity: locals.profile.city ?? '',
		turnstileSiteKey: locals.runtime.publicTurnstileSiteKey ?? null,
		demoMode: false
	};
};

export const actions: Actions = {
	pendingBrand: async ({ locals, request }) => {
		const formData = await request.formData();
		const input = { displayName: formData.get('displayName')?.toString() ?? '', suggestedBrandId: null };
		if (locals.runtime.mode === 'demo') {
			const parsed = pendingBrandInputSchema.safeParse(input);
			if (!parsed.success) return fail(400, { result: actionFailure({ code: 'VALIDATION', message: 'Провери името на марката.' }) });
			return { result: actionSuccess({ id: DEMO_DRAFT_ID, name: parsed.data.displayName, slug: `pending-${DEMO_DRAFT_ID}`, parentBrandId: null }) };
		}
		if (!locals.profile?.phoneVerifiedAt) return fail(403, { result: phoneFailure(), phoneVerificationRequired: true });
		if (!locals.supabase) return fail(503, { result: actionFailure({ code: 'INTERNAL', message: 'Услугата временно не е достъпна.' }) });
		const result = await submitPendingBrand(locals.supabase as MarketplaceSupabaseClient, input);
		if (!result.ok) return fail(serviceStatus(result.error), { result });
		return { result };
	},

	autosave: async ({ locals, request }) => {
		const formData = await request.formData();
		const payload = jsonPayload(formData);
		const listingId = formData.get('listingId')?.toString().trim() || null;
		if (locals.runtime.mode === 'demo') {
			const parsed = listingDraftInputSchema.safeParse(payload);
			if (!parsed.success) return fail(400, { result: actionFailure({ code: 'VALIDATION', message: 'Провери полетата на обявата.' }) });
			return { result: actionSuccess({ id: DEMO_DRAFT_ID, slug: 'demo-preview', status: 'draft' }) };
		}
		if (!locals.profile?.phoneVerifiedAt) return fail(403, { result: phoneFailure(), phoneVerificationRequired: true });
		if (!locals.supabase) return fail(503, { result: actionFailure({ code: 'INTERNAL', message: 'Услугата временно не е достъпна.' }) });
		const client = locals.supabase as MarketplaceSupabaseClient;
		const result = listingId
			? await editListingDraft(client, { listingId, patch: payload })
			: await saveListingDraft(client, payload);
		if (!result.ok) return fail(serviceStatus(result.error), { result });
		return { result };
	},

	publish: async ({ locals, request }) => {
		const formData = await request.formData();
		const input = { listingId: formData.get('listingId')?.toString() ?? '' };
		const parsed = listingIdInputSchema.safeParse(input);
		if (!parsed.success) return fail(400, { result: actionFailure({ code: 'VALIDATION', message: 'Черновата е невалидна.' }) });
		if (locals.runtime.mode === 'demo') {
			return { result: actionSuccess({ id: parsed.data.listingId, slug: 'demo-preview', status: 'active' }) };
		}
		if (!locals.profile?.phoneVerifiedAt) return fail(403, { result: phoneFailure(), phoneVerificationRequired: true });
		if (!locals.supabase) return fail(503, { result: actionFailure({ code: 'INTERNAL', message: 'Услугата временно не е достъпна.' }) });
		const result = await publishListing(locals.supabase as MarketplaceSupabaseClient, parsed.data);
		if (!result.ok) return fail(serviceStatus(result.error), { result });
		return { result };
	}
};
