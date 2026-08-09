import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { ActionError, ActionResult, OfferDto } from '$lib/contracts';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { verifyTurnstileForAction } from '$lib/server/auth/turnstile';
import {
	browseListings,
	favoriteListing,
	getFavoriteState,
	getListingBySlug,
	getOwnListings,
	submitOffer as submitOfferService,
	unfavoriteListing
} from '$lib/server/services';
import {
	browseDemoListings,
	demoOwnListings,
	getDemoListingBySlug
} from '../../listings/demo.server';
import { cashAmountMinor, offeredListingEligible, offerKindAllowed } from './offer-form';

function serviceStatus(actionError: ActionError): number {
	if (actionError.code === 'VALIDATION') return 400;
	if (actionError.code === 'AUTH_REQUIRED') return 401;
	if (actionError.code === 'FORBIDDEN') return 403;
	if (actionError.code === 'NOT_FOUND') return 404;
	if (actionError.code === 'CONFLICT') return 409;
	if (actionError.code === 'RATE_LIMITED') return 429;
	return 503;
}

function invalidOffer(message: string, field = '_form'): ActionResult<OfferDto> {
	return {
		ok: false,
		error: { code: 'VALIDATION', message, fieldErrors: { [field]: [message] } }
	};
}

export const load: PageServerLoad = async ({ locals, params }) => {
	if (locals.runtime.mode === 'demo') {
		const listing = getDemoListingBySlug(params.slug);
		if (!listing) error(404, 'Обявата не е намерена.');
		const similar = browseDemoListings({
			query: '', segments: [], sort: 'newest', limit: 5, offset: 0
		}).items.filter((item) => item.id !== listing.id).slice(0, 4);
		return {
			listing,
			similar,
			offeredListings: demoOwnListings().items.filter(
				(item) => item.id !== listing.id && offeredListingEligible(item)
			),
			favorite: false,
			turnstileSiteKey: null,
			demoMode: true
		};
	}

	if (!locals.supabase) error(503, 'Обявата временно не е достъпна.');
	const client = locals.supabase as MarketplaceSupabaseClient;
	const listingResult = await getListingBySlug(client, { slug: params.slug });
	if (!listingResult.ok) error(serviceStatus(listingResult.error), listingResult.error.message);
	if (!listingResult.data) error(404, 'Обявата не е намерена.');
	const listing = listingResult.data;

	const [similarResult, ownResult, favoriteResult] = await Promise.all([
		browseListings(client, {
			query: '',
			brandId: listing.brandId,
			segments: [],
			sort: 'newest',
			limit: 5,
			offset: 0
		}),
		getOwnListings(client, { limit: 100, offset: 0 }),
		getFavoriteState(client, { listingId: listing.id })
	]);

	return {
		listing,
		similar: similarResult.ok
			? similarResult.data.items.filter((item) => item.id !== listing.id).slice(0, 4)
			: [],
		offeredListings: ownResult.ok
			? ownResult.data.items.filter(
				(item) => item.id !== listing.id && offeredListingEligible(item)
			)
			: [],
		favorite: favoriteResult.ok ? favoriteResult.data : false,
		turnstileSiteKey: locals.runtime.publicTurnstileSiteKey ?? null,
		demoMode: false
	};
};

export const actions: Actions = {
	favorite: async ({ locals, request }) => {
		const formData = await request.formData();
		if (locals.runtime.mode === 'demo') return { favoriteState: true };
		if (!locals.supabase) return fail(503, { favoriteState: false, favoriteError: 'Услугата временно не е достъпна.' });
		const result = await favoriteListing(locals.supabase as MarketplaceSupabaseClient, { listingId: formData.get('listingId') });
		if (!result.ok) return fail(serviceStatus(result.error), { favoriteState: false, favoriteError: result.error.message });
		return { favoriteState: true };
	},
	unfavorite: async ({ locals, request }) => {
		const formData = await request.formData();
		if (locals.runtime.mode === 'demo') return { favoriteState: false };
		if (!locals.supabase) return fail(503, { favoriteState: true, favoriteError: 'Услугата временно не е достъпна.' });
		const result = await unfavoriteListing(locals.supabase as MarketplaceSupabaseClient, { listingId: formData.get('listingId') });
		if (!result.ok) return fail(serviceStatus(result.error), { favoriteState: true, favoriteError: result.error.message });
		return { favoriteState: false };
	},
	submitOffer: async (event) => {
		const { locals, params, request } = event;
		const formData = await request.formData();
		const kind = formData.get('kind')?.toString() ?? '';
		const listingId = formData.get('listingId')?.toString() ?? '';
		const offeredListingId = formData.get('offeredListingId')?.toString().trim() || null;
		const amountMinor = cashAmountMinor(formData.get('cashAmount'));
		const message = formData.get('message')?.toString().trim().slice(0, 1000) || null;

		const listing = locals.runtime.mode === 'demo'
			? getDemoListingBySlug(params.slug)
			: locals.supabase
				? await getListingBySlug(locals.supabase as MarketplaceSupabaseClient, { slug: params.slug })
					.then((result) => result.ok ? result.data : null)
				: null;
		if (!listing || listing.id !== listingId) return fail(404, { offerResult: invalidOffer('Обявата вече не е достъпна.') });
		if (!offerKindAllowed(listing, kind)) return fail(400, { offerResult: invalidOffer('Този вид предложение не е позволен за обявата.', 'kind') });

		const usesCash = kind === 'cash' || kind === 'cash_plus_swap';
		const usesListing = kind === 'swap' || kind === 'cash_plus_swap';
		if (usesCash && amountMinor == null) return fail(400, { offerResult: invalidOffer('Въведи сума над €0.', 'cashAmount') });
		if (usesListing && !offeredListingId) return fail(400, { offerResult: invalidOffer('Избери своя активна обява.', 'offeredListingId') });

		if (locals.runtime.mode === 'demo') {
			return { offerResult: { ok: true, data: null } as unknown as ActionResult<OfferDto>, demoSubmission: true };
		}
		if (!locals.profile) return fail(401, { offerResult: invalidOffer('Необходим е активен профил.') });
		if (!locals.supabase) return fail(503, { offerResult: invalidOffer('Услугата временно не е достъпна.') });
		if (listing.seller.id === locals.profile.id) return fail(400, { offerResult: invalidOffer('Не можеш да изпратиш оферта към собствена обява.') });
		const challenge = await verifyTurnstileForAction(event, formData, locals.runtime, 'offer_submit');
		if (!challenge.success) {
			const unavailable = challenge.reason === 'not_configured' || challenge.reason === 'network_error';
			return fail(unavailable ? 503 : 400, {
				offerResult: invalidOffer(unavailable
					? 'Проверката срещу злоупотреба временно не е достъпна.'
					: 'Потвърди, че не си автоматизиран клиент.')
			});
		}

		if (usesListing) {
			const own = await getOwnListings(locals.supabase as MarketplaceSupabaseClient, { limit: 100, offset: 0 });
			if (
				!own.ok ||
				!own.data.items.some(
					(item) => item.id === offeredListingId && offeredListingEligible(item)
				)
			) {
				return fail(400, { offerResult: invalidOffer('Избери своя активна обява.', 'offeredListingId') });
			}
		}

		const offerResult = await submitOfferService(locals.supabase as MarketplaceSupabaseClient, {
			listingId,
			kind,
			cashAmountMinor: usesCash ? amountMinor : null,
			offeredListingId: usesListing ? offeredListingId : null,
			message,
			expiresAt: null
		});
		if (!offerResult.ok) return fail(serviceStatus(offerResult.error), { offerResult });
		return { offerResult };
	}
};
