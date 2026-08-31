import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  REPORT_REASON_TARGETS,
  isReportTargetSubmittable,
  reportReasonSchema,
  reportTargetTypeSchema,
  uuidSchema
} from '$lib/contracts';
import { verifyTurnstileForAction } from '$lib/server/auth/turnstile';
import {
  InvalidFormDataError,
  parseBoundedFormData,
  RequestBodyTooLargeError
} from '$lib/server/http/request-body';
import type { MarketplaceSupabaseClient } from '$lib/server/repositories';
import { submitReport } from '$lib/server/services';
import { createServiceRoleSupabaseClient } from '$lib/server/supabase';
import {
  ACCEPTED_SOURCE_MIME_TYPES,
  cloudflareImagesBinding,
  ImageProcessingError,
  sanitizeImage
} from '$lib/server/uploads/image-processor';

function clientFrom(locals: App.Locals): MarketplaceSupabaseClient {
  if (!locals.supabase) error(503, 'Сигналите не са конфигурирани.');
  return locals.supabase as MarketplaceSupabaseClient;
}
function httpStatus(code: string): 400 | 401 | 403 | 404 | 409 | 429 | 500 {
  return code === 'AUTH_REQUIRED' ? 401 : code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : code === 'RATE_LIMITED' ? 429 : code === 'DATABASE' || code === 'INTERNAL' ? 500 : 400;
}

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const MAX_REPORT_REQUEST_BYTES = 4 * MAX_EVIDENCE_BYTES + 512 * 1024;
const REPORT_FORM_LIMITS = {
  maxBytes: MAX_REPORT_REQUEST_BYTES,
  maxFileBytes: MAX_EVIDENCE_BYTES,
  maxFiles: 4,
  maxParts: 20,
  maxHeaderBytes: 8 * 1024
} as const;

interface ReportEvidenceAllocation {
  upload_id: string;
  bucket_id: 'report-evidence';
  storage_path: string;
  expires_at: string;
}

interface ReportEvidenceRpcClient {
  rpc(
    name:
      | 'create_report_evidence_upload'
      | 'finalize_report_evidence_upload'
      | 'reject_unattached_report_evidence_uploads',
    parameters: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
}

export const load: PageServerLoad = ({ locals, url }) => {
  const targetType = reportTargetTypeSchema.safeParse(url.searchParams.get('targetType'));
  const targetId = uuidSchema.safeParse(url.searchParams.get('targetId'));
  const acceptedTarget = targetType.success && isReportTargetSubmittable(targetType.data)
    ? targetType.data
    : null;
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
    if (event.locals.runtime.mode === 'demo') return { ok: true, demo: true };
    if (!event.locals.user) {
      return fail(401, { ok: false, error: { message: 'Влез в профила си, за да подадеш сигнал.' } });
    }
    if (
      !event.locals.runtime.publicSupabaseUrl ||
      !event.locals.runtime.supabaseSecretKey
    ) {
      return fail(503, { ok: false, error: { message: 'Качването на доказателства не е конфигурирано.' } });
    }

    let formData: FormData;
    try {
      formData = await parseBoundedFormData(event.request, REPORT_FORM_LIMITS);
    } catch (cause) {
      if (cause instanceof RequestBodyTooLargeError) {
        return fail(413, {
          ok: false,
          error: { message: 'Общият размер на заявката е твърде голям.' }
        });
      }
      if (cause instanceof InvalidFormDataError) {
        return fail(400, {
          ok: false,
          error: { message: 'Заявката за сигнал е невалидна.' }
        });
      }
      throw cause;
    }
    const challenge = await verifyTurnstileForAction(event, formData, event.locals.runtime, 'report_submit');
    if (!challenge.success) return fail(400, { ok: false, error: { message: 'Проверката срещу автоматични заявки не беше успешна.' } });
    const client = clientFrom(event.locals);
    const serviceClient = createServiceRoleSupabaseClient({
      PUBLIC_SUPABASE_URL: event.locals.runtime.publicSupabaseUrl,
      SUPABASE_SECRET_KEY: event.locals.runtime.supabaseSecretKey
    });
    const evidenceStorage = serviceClient.storage.from('report-evidence');
    const allocationClient = client as unknown as ReportEvidenceRpcClient;
    const privilegedEvidenceClient = serviceClient as unknown as ReportEvidenceRpcClient;
    const uploadedPaths: string[] = [];
    const allocatedUploads: ReportEvidenceAllocation[] = [];
    const rejectAllocatedUploads = async (rejectionCode: string) => {
      if (allocatedUploads.length === 0) return;
      try {
        const { error: reconciliationError } = await privilegedEvidenceClient.rpc(
          'reject_unattached_report_evidence_uploads',
          {
            target_upload_ids: allocatedUploads.map((allocation) => allocation.upload_id),
            rejection_code: rejectionCode
          }
        );
        if (!reconciliationError) return;
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'report_evidence_reconciliation_failed',
            requestId: event.locals.requestId,
            code: rejectionCode
          })
        );
      } catch {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'report_evidence_reconciliation_transport_failed',
            requestId: event.locals.requestId,
            code: rejectionCode
          })
        );
      }
    };
    const evidenceFiles = formData.getAll('evidence').filter(
      (entry): entry is File => typeof entry !== 'string' && entry.size > 0
    );
    if (evidenceFiles.length > 4) {
      return fail(400, { ok: false, error: { message: 'Добави най-много четири файла.' } });
    }
    if (
      evidenceFiles.length > 0 &&
      event.locals.runtime.imageProcessorMode !== 'cloudflare-images'
    ) {
      return fail(503, {
        ok: false,
        error: { message: 'Обработката на изображения временно не е налична. Изпрати сигнала без файл.' }
      });
    }
    const processReport = async () => {
    for (const file of evidenceFiles) {
      if (
        file.size > MAX_EVIDENCE_BYTES ||
        !ACCEPTED_SOURCE_MIME_TYPES.includes(
          file.type as (typeof ACCEPTED_SOURCE_MIME_TYPES)[number]
        )
      ) {
        await rejectAllocatedUploads('invalid_source_file');
        return fail(400, {
          ok: false,
          error: { message: 'Добави JPEG, PNG, WebP или AVIF изображение до 10 MB.' }
        });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      let sanitized: Awaited<ReturnType<typeof sanitizeImage>>;
      try {
        sanitized = await sanitizeImage(
          cloudflareImagesBinding(event.platform),
          bytes,
          file.type
        );
      } catch (cause) {
        await rejectAllocatedUploads('image_sanitization_failed');
        if (cause instanceof ImageProcessingError) {
          return fail(cause.code === 'processor_unavailable' ? 503 : 400, {
            ok: false,
            error: {
              message:
                cause.code === 'processor_unavailable'
                  ? 'Обработката на изображения временно не е налична. Изпрати сигнала без файл.'
                  : 'Изображението не можа да бъде проверено и безопасно обработено.'
            }
          });
        }
        throw cause;
      }
      const { data: rawAllocation, error: allocationError } = await allocationClient.rpc(
        'create_report_evidence_upload',
        {
          source_mime_type: file.type,
          source_byte_size: file.size
        }
      );
      const allocation = (
        Array.isArray(rawAllocation) ? rawAllocation[0] : rawAllocation
      ) as ReportEvidenceAllocation | null;
      if (
        allocationError ||
        !allocation ||
        allocation.bucket_id !== 'report-evidence' ||
        !allocation.storage_path
      ) {
        await rejectAllocatedUploads('allocation_failed');
        return fail(503, { ok: false, error: { message: 'Доказателството не можа да бъде подготвено.' } });
      }
      allocatedUploads.push(allocation);
      const path = allocation.storage_path;
      const { error: uploadError } = await evidenceStorage.upload(path, sanitized.bytes, {
        contentType: sanitized.mimeType,
        upsert: false
      });
      if (uploadError) {
        await rejectAllocatedUploads('storage_upload_failed');
        return fail(503, { ok: false, error: { message: 'Доказателството не можа да бъде качено.' } });
      }
      uploadedPaths.push(path);
      const { error: finalizeError } = await privilegedEvidenceClient.rpc(
        'finalize_report_evidence_upload',
        {
          target_upload_id: allocation.upload_id,
          actual_content_hash: sanitized.contentHash,
          actual_byte_size: sanitized.bytes.byteLength,
          actual_width_px: sanitized.width,
          actual_height_px: sanitized.height
        }
      );
      if (finalizeError) {
        await rejectAllocatedUploads('finalization_failed');
        return fail(503, { ok: false, error: { message: 'Доказателството не можа да бъде финализирано.' } });
      }
    }

    const result = await submitReport(client, {
      targetType: formData.get('targetType'), targetId: formData.get('targetId'),
      reasonCode: formData.get('reasonCode'), details: formData.get('details') || null,
      evidencePaths: uploadedPaths
    });
    if (!result.ok) {
      await rejectAllocatedUploads('report_submission_rejected');
      return fail(httpStatus(result.error.code), { ok: false, error: result.error });
    }
    return { ok: true, reportId: result.data.id };
    };
    try {
      return await processReport();
    } catch (cause) {
      await rejectAllocatedUploads('report_processing_failed');
      throw cause;
    }
  }
};
