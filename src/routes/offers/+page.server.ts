import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { ListingCardDto, OfferDto } from '$lib/contracts';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { acceptOffer, declineOffer, getOffers, withdrawOffer } from '$lib/server/services';

const demoListing: ListingCardDto = {
  id: '00000000-0000-4000-8000-000000000201', slug: 'dior-sauvage-demo', kind: 'offer',
  dealMode: 'sale_or_swap', title: 'Dior · Sauvage', brandId: '00000000-0000-4000-8000-000000000501',
  brandName: 'Dior', brandSlug: 'dior', fragranceName: 'Sauvage', concentration: 'EDP', city: 'София',
  price: { amountMinor: 7800, currency: 'EUR' }, maxBudget: null, bottleVolumeMl: 100, remainingMl: 92,
  isSealed: false, status: 'active', seller: { id: '00000000-0000-4000-8000-000000000999', username: 'demo_user', avatarUrl: null, accountKind: 'private', merchantVerified: false },
  primaryPhoto: null, authenticityReviewed: true, createdAt: '2026-07-20T12:00:00.000Z'
};

const demoOffer: OfferDto = {
  id: '00000000-0000-4000-8000-000000000601', listing: demoListing,
  offerer: { id: '00000000-0000-4000-8000-000000000301', username: 'amber_room', avatarUrl: null, accountKind: 'private', merchantVerified: false },
  kind: 'cash', cash: { amountMinor: 7000, currency: 'EUR' }, offeredListing: null,
  message: 'Мога да взема флакона тази седмица.', status: 'pending', expiresAt: null, respondedAt: null,
  createdAt: '2026-07-20T14:32:00.000Z'
};

function clientFrom(locals: App.Locals): MarketplaceSupabaseClient {
  if (!locals.supabase) error(503, 'Офертите не са конфигурирани.');
  return locals.supabase as MarketplaceSupabaseClient;
}

function httpStatus(code: string): 400 | 401 | 403 | 404 | 409 | 429 | 500 {
  return code === 'AUTH_REQUIRED' ? 401 : code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : code === 'RATE_LIMITED' ? 429 : code === 'DATABASE' || code === 'INTERNAL' ? 500 : 400;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const direction = url.searchParams.get('direction') === 'sent' ? 'sent' : 'received';
  if (locals.runtime.mode === 'demo') {
    return { demoMode: true, direction, offers: direction === 'received' ? [demoOffer] : [] };
  }
  const result = await getOffers(clientFrom(locals), { direction, limit: 50, offset: 0 });
  if (!result.ok) error(httpStatus(result.error.code), result.error.message);
  return { demoMode: false, direction, offers: result.data.items };
};

async function offerAction(
  locals: App.Locals,
  request: Request,
  operation: 'accept' | 'decline' | 'withdraw'
) {
  const formData = await request.formData();
  const offerId = formData.get('offerId');
  if (locals.runtime.mode === 'demo') return { ok: true, demo: true, operation };
  const client = clientFrom(locals);
  if (operation === 'accept') {
    const result = await acceptOffer(client, { offerId });
    if (!result.ok) return fail(httpStatus(result.error.code), { ok: false, error: result.error });
    redirect(303, `/deals?highlight=${encodeURIComponent(result.data.dealId)}`);
  }
  if (operation === 'decline') {
    const result = await declineOffer(client, { offerId });
    if (!result.ok) return fail(httpStatus(result.error.code), { ok: false, error: result.error });
    return { ok: true, operation };
  }
  const result = await withdrawOffer(client, { offerId });
  if (!result.ok) return fail(httpStatus(result.error.code), { ok: false, error: result.error });
  return { ok: true, operation };
}

export const actions: Actions = {
  accept: ({ locals, request }) => offerAction(locals, request, 'accept'),
  decline: ({ locals, request }) => offerAction(locals, request, 'decline'),
  withdraw: ({ locals, request }) => offerAction(locals, request, 'withdraw')
};
