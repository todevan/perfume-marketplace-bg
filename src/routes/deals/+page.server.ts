import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { DealDto, ListingCardDto } from '$lib/contracts';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { cancelDeal, confirmDeal, getDeals, openDealDispute, submitReview } from '$lib/server/services';

const listing: ListingCardDto = {
  id: '00000000-0000-4000-8000-000000000201', slug: 'dior-sauvage-demo', kind: 'offer', dealMode: 'sale_or_swap',
  title: 'Dior · Sauvage', brandId: '00000000-0000-4000-8000-000000000501', brandName: 'Dior', brandSlug: 'dior', fragranceName: 'Sauvage', concentration: 'EDP', city: 'София',
  price: { amountMinor: 7800, currency: 'EUR' }, maxBudget: null, bottleVolumeMl: 100, remainingMl: 92, isSealed: false, status: 'reserved',
  seller: { id: '00000000-0000-4000-8000-000000000999', username: 'demo_user', avatarUrl: null, accountKind: 'private', merchantVerified: false }, primaryPhoto: null, authenticityReviewed: true, createdAt: '2026-07-20T12:00:00.000Z'
};
const demoDeal: DealDto = {
  id: '00000000-0000-4000-8000-000000000701', listing, offeredListing: null,
  partyA: listing.seller,
  partyB: { id: '00000000-0000-4000-8000-000000000301', username: 'amber_room', avatarUrl: null, accountKind: 'private', merchantVerified: false },
  conversationId: '00000000-0000-4000-8000-000000000801',
  status: 'pending_confirmation', confirmedBy: [], completedAt: null, disputedAt: null, cancelledAt: null,
  cancellationReason: null, createdAt: '2026-07-20T14:32:00.000Z'
};

function clientFrom(locals: App.Locals): MarketplaceSupabaseClient {
  if (!locals.supabase) error(503, 'Сделките не са конфигурирани.');
  return locals.supabase as MarketplaceSupabaseClient;
}
function status(code: string): 400 | 401 | 403 | 404 | 409 | 429 | 500 {
  return code === 'AUTH_REQUIRED' ? 401 : code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : code === 'RATE_LIMITED' ? 429 : code === 'DATABASE' || code === 'INTERNAL' ? 500 : 400;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.runtime.mode === 'demo') return { demoMode: true, viewerId: listing.seller.id, deals: [demoDeal], highlight: url.searchParams.get('highlight') };
  const result = await getDeals(clientFrom(locals), { limit: 50, offset: 0 });
  if (!result.ok) error(status(result.error.code), result.error.message);
  return { demoMode: false, viewerId: locals.user!.id, deals: result.data.items, highlight: url.searchParams.get('highlight') };
};

export const actions: Actions = {
  confirm: async ({ request, locals }) => {
    if (locals.runtime.mode === 'demo') return { ok: true, operation: 'confirm' };
    const formData = await request.formData();
    const result = await confirmDeal(clientFrom(locals), { dealId: formData.get('dealId') });
    if (!result.ok) return fail(status(result.error.code), { ok: false, error: result.error });
    return { ok: true, operation: 'confirm' };
  },
  cancel: async ({ request, locals }) => {
    if (locals.runtime.mode === 'demo') return { ok: true, operation: 'cancel' };
    const formData = await request.formData();
    const result = await cancelDeal(clientFrom(locals), { dealId: formData.get('dealId'), reason: formData.get('reason') });
    if (!result.ok) return fail(status(result.error.code), { ok: false, error: result.error });
    return { ok: true, operation: 'cancel' };
  },
  dispute: async ({ request, locals }) => {
    const formData = await request.formData();
    if (locals.runtime.mode === 'demo') {
      const details = formData.get('details')?.toString().trim() ?? '';
      if (details.length < 20) return fail(400, { ok: false, error: { code: 'VALIDATION', message: 'Опиши проблема с поне 20 знака.' } });
      return { ok: true, operation: 'dispute' };
    }
    const result = await openDealDispute(clientFrom(locals), {
      dealId: formData.get('dealId'),
      details: formData.get('details')
    });
    if (!result.ok) return fail(status(result.error.code), { ok: false, error: result.error });
    return { ok: true, operation: 'dispute', reportId: result.data.reportId };
  },
  review: async ({ request, locals }) => {
    if (locals.runtime.mode === 'demo') return { ok: true, operation: 'review' };
    const formData = await request.formData();
    const result = await submitReview(clientFrom(locals), {
      dealId: formData.get('dealId'), revieweeId: formData.get('revieweeId'),
      rating: formData.get('rating'), body: formData.get('body') || null
    });
    if (!result.ok) return fail(status(result.error.code), { ok: false, error: result.error });
    return { ok: true, operation: 'review' };
  }
};
