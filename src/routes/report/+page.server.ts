import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { reportTargetTypeSchema, uuidSchema } from '$lib/contracts';
import { verifyTurnstileForAction } from '$lib/server/auth/turnstile';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { submitReport } from '$lib/server/services';

function clientFrom(locals: App.Locals): MarketplaceSupabaseClient {
  if (!locals.supabase) error(503, 'Сигналите не са конфигурирани.');
  return locals.supabase as MarketplaceSupabaseClient;
}
function httpStatus(code: string): 400 | 401 | 403 | 404 | 409 | 429 | 500 {
  return code === 'AUTH_REQUIRED' ? 401 : code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : code === 'RATE_LIMITED' ? 429 : code === 'DATABASE' || code === 'INTERNAL' ? 500 : 400;
}

export const load: PageServerLoad = ({ locals, url }) => {
  const targetType = reportTargetTypeSchema.safeParse(url.searchParams.get('targetType'));
  const targetId = uuidSchema.safeParse(url.searchParams.get('targetId'));
  return {
    targetType: targetType.success ? targetType.data : null,
    targetId: targetId.success ? targetId.data : null,
    turnstileSiteKey: locals.runtime.publicTurnstileSiteKey ?? null,
    demoMode: locals.runtime.mode === 'demo'
  };
};

export const actions: Actions = {
  default: async (event) => {
    const formData = await event.request.formData();
    if (event.locals.runtime.mode === 'demo') return { ok: true, demo: true };
    const challenge = await verifyTurnstileForAction(event, formData, event.locals.runtime, 'report_submit');
    if (!challenge.success) return fail(400, { ok: false, error: { message: 'Проверката срещу автоматични заявки не беше успешна.' } });
    const result = await submitReport(clientFrom(event.locals), {
      targetType: formData.get('targetType'), targetId: formData.get('targetId'),
      reasonCode: formData.get('reasonCode'), details: formData.get('details') || null, evidencePaths: []
    });
    if (!result.ok) return fail(httpStatus(result.error.code), { ok: false, error: result.error });
    return { ok: true, reportId: result.data.id };
  }
};
