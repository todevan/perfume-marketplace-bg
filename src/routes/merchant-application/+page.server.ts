import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { createMerchantApplication, getOwnMerchantApplication, updateMerchantApplication, withdrawMerchantApplication } from '$lib/server/services';

function clientFrom(locals: App.Locals): MarketplaceSupabaseClient {
  if (!locals.supabase) error(503, 'Кандидатстването не е конфигурирано.');
  return locals.supabase as MarketplaceSupabaseClient;
}
function status(code: string): 400 | 401 | 403 | 404 | 409 | 429 | 500 {
  return code === 'AUTH_REQUIRED' ? 401 : code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : code === 'RATE_LIMITED' ? 429 : code === 'DATABASE' || code === 'INTERNAL' ? 500 : 400;
}

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.runtime.mode === 'demo') return { demoMode: true, application: null };
  const result = await getOwnMerchantApplication(clientFrom(locals));
  if (!result.ok) error(status(result.error.code), result.error.message);
  return { demoMode: false, application: result.data };
};

async function saveApplication(locals: App.Locals, request: Request, submit: boolean) {
  const formData = await request.formData();
  if (locals.runtime.mode === 'demo') return { ok: true, demo: true, submitted: submit };
  const declarationAccepted = ['authorityDeclaration', 'rulesDeclaration', 'verificationDeclaration', 'privacyAcknowledgement']
    .every((name) => formData.get(name) === 'on');
  const input = {
    legalName: formData.get('legalName'), registrationNumber: formData.get('registrationNumber'),
    registeredAddress: formData.get('registeredAddress'), websiteUrl: formData.get('websiteUrl') || null,
    documentPaths: [], declarationAccepted, submit
  };
  const existingId = formData.get('applicationId')?.toString();
  const result = existingId
    ? await updateMerchantApplication(clientFrom(locals), { ...input, applicationId: existingId })
    : await createMerchantApplication(clientFrom(locals), input);
  if (!result.ok) return fail(status(result.error.code), { ok: false, error: result.error, values: input });
  return { ok: true, submitted: submit, application: result.data };
}

export const actions: Actions = {
  draft: ({ locals, request }) => saveApplication(locals, request, false),
  submit: ({ locals, request }) => saveApplication(locals, request, true),
  withdraw: async ({ locals, request }) => {
    if (locals.runtime.mode === 'demo') return { ok: true, demo: true };
    const formData = await request.formData();
    const result = await withdrawMerchantApplication(clientFrom(locals), { applicationId: formData.get('applicationId') });
    if (!result.ok) return fail(status(result.error.code), { ok: false, error: result.error });
    return { ok: true, withdrawn: true };
  }
};
