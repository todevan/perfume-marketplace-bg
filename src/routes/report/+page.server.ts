import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  REPORT_REASON_TARGETS,
  reportReasonSchema,
  reportTargetTypeSchema,
  uuidSchema
} from '$lib/contracts';
import { verifyTurnstileForAction } from '$lib/server/auth/turnstile';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { submitReport } from '$lib/server/services';
import { createServiceRoleSupabaseClient } from '$lib/server/supabase';

function clientFrom(locals: App.Locals): MarketplaceSupabaseClient {
  if (!locals.supabase) error(503, 'Сигналите не са конфигурирани.');
  return locals.supabase as MarketplaceSupabaseClient;
}
function httpStatus(code: string): 400 | 401 | 403 | 404 | 409 | 429 | 500 {
  return code === 'AUTH_REQUIRED' ? 401 : code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : code === 'RATE_LIMITED' ? 429 : code === 'DATABASE' || code === 'INTERNAL' ? 500 : 400;
}

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

function evidenceExtension(bytes: Uint8Array, declaredType: string): 'jpg' | 'png' | 'webp' | 'pdf' | null {
	if (
		declaredType === 'image/jpeg' &&
		bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
	) return 'jpg';
	if (
		declaredType === 'image/png' &&
		bytes.slice(0, 8).every((value, index) =>
			value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]
		)
	) return 'png';
	if (
		declaredType === 'image/webp' &&
		new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
		new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
	) return 'webp';
	if (
		declaredType === 'application/pdf' &&
		new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
	) return 'pdf';
	return null;
}

export const load: PageServerLoad = ({ locals, url }) => {
  const targetType = reportTargetTypeSchema.safeParse(url.searchParams.get('targetType'));
  const targetId = uuidSchema.safeParse(url.searchParams.get('targetId'));
  const acceptedTarget = targetType.success ? targetType.data : null;
  return {
    targetType: acceptedTarget,
    targetId: targetId.success ? targetId.data : null,
    reasonCodes: acceptedTarget
      ? reportReasonSchema.options.filter((reason) =>
          REPORT_REASON_TARGETS[reason].includes(acceptedTarget)
        )
      : [],
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
    const client = clientFrom(event.locals);
    if (
      !event.locals.user ||
      !event.locals.runtime.publicSupabaseUrl ||
      !event.locals.runtime.supabaseSecretKey
    ) {
      return fail(503, { ok: false, error: { message: 'Качването на доказателства не е конфигурирано.' } });
    }
    const evidenceStorage = createServiceRoleSupabaseClient({
      PUBLIC_SUPABASE_URL: event.locals.runtime.publicSupabaseUrl,
      SUPABASE_SECRET_KEY: event.locals.runtime.supabaseSecretKey
    }).storage.from('report-evidence');
    const uploadedPaths: string[] = [];
    const evidenceFiles = formData.getAll('evidence').filter(
      (entry): entry is File => typeof entry !== 'string' && entry.size > 0
    );
    if (evidenceFiles.length > 4) {
      return fail(400, { ok: false, error: { message: 'Добави най-много четири файла.' } });
    }
    for (const file of evidenceFiles) {
      if (file.size > MAX_EVIDENCE_BYTES) {
        if (uploadedPaths.length) await evidenceStorage.remove(uploadedPaths);
        return fail(400, { ok: false, error: { message: 'Всеки файл трябва да е до 10 MB.' } });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const extension = evidenceExtension(bytes, file.type);
      if (!extension) {
        if (uploadedPaths.length) await evidenceStorage.remove(uploadedPaths);
        return fail(400, { ok: false, error: { message: 'Невалиден JPEG, PNG, WebP или PDF файл.' } });
      }
      const path = `${event.locals.user!.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await evidenceStorage.upload(path, bytes, {
        contentType: file.type,
        upsert: false
      });
      if (uploadError) {
        if (uploadedPaths.length) await evidenceStorage.remove(uploadedPaths);
        return fail(503, { ok: false, error: { message: 'Доказателството не можа да бъде качено.' } });
      }
      uploadedPaths.push(path);
    }

    let result: Awaited<ReturnType<typeof submitReport>>;
    try {
      result = await submitReport(client, {
        targetType: formData.get('targetType'), targetId: formData.get('targetId'),
        reasonCode: formData.get('reasonCode'), details: formData.get('details') || null,
        evidencePaths: uploadedPaths
      });
    } catch (cause) {
      if (uploadedPaths.length) await evidenceStorage.remove(uploadedPaths);
      throw cause;
    }
    if (!result.ok) {
      if (uploadedPaths.length) await evidenceStorage.remove(uploadedPaths);
      return fail(httpStatus(result.error.code), { ok: false, error: result.error });
    }
    return { ok: true, reportId: result.data.id };
  }
};
