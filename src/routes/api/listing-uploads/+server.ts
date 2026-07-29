import { json, type RequestHandler } from '@sveltejs/kit';
import { verifyTurnstileForAction } from '$lib/server/auth/turnstile';
import {
  acknowledgeServiceRoleClient,
  claimListingUpload,
  finalizeListingUpload,
  rejectListingUpload
} from '$lib/server/services';
import { createServiceRoleSupabaseClient } from '$lib/server/supabase';
import {
  ACCEPTED_SOURCE_MIME_TYPES,
  ImageProcessingError,
  sanitizeListingImage,
  type CloudflareImagesBinding
} from '$lib/server/uploads/image-processor';

const PHOTO_ROLES = new Set([
  'product_full',
  'bottle_bottom',
  'batch_code',
  'fill_level',
  'box_front',
  'box_bottom',
  'seal',
  'manufacturer_label',
  'manufacturer_markings',
  'other'
]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

interface UploadAllocation {
  upload_id: string;
  bucket_id: string;
  storage_path: string;
}

function imagesBinding(platform: App.Platform | undefined): CloudflareImagesBinding | undefined {
  return (platform?.env as unknown as { IMAGES?: CloudflareImagesBinding } | undefined)?.IMAGES;
}

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export const POST: RequestHandler = async (event) => {
  const { locals } = event;
  if (
    locals.runtime.mode !== 'production' ||
    !locals.supabase ||
    !locals.user ||
    !locals.profile ||
    !locals.betaAccess?.isActive
  ) {
    return json({ ok: false, code: 'upload_unavailable' }, { status: 503 });
  }
  if (!locals.profile.phoneVerifiedAt) {
    return json({ ok: false, code: 'phone_verification_required' }, { status: 403 });
  }
  if (locals.runtime.imageProcessorMode !== 'cloudflare-images' || !locals.runtime.supabaseSecretKey) {
    return json({ ok: false, code: 'upload_processor_not_configured' }, { status: 503 });
  }

  const formData = await event.request.formData();
  const turnstile = await verifyTurnstileForAction(
    event,
    formData,
    locals.runtime,
    'listing_upload'
  );
  if (!turnstile.success) {
    return json({ ok: false, code: 'captcha_failed' }, { status: 400 });
  }

  const file = formData.get('file');
  const listingId = stringField(formData, 'listingId');
  const role = stringField(formData, 'role');
  if (!(file instanceof File) || !listingId || !PHOTO_ROLES.has(role)) {
    return json({ ok: false, code: 'invalid_upload_request' }, { status: 400 });
  }
  if (
    file.size < 1 ||
    file.size > MAX_UPLOAD_BYTES ||
    !ACCEPTED_SOURCE_MIME_TYPES.includes(
      file.type as (typeof ACCEPTED_SOURCE_MIME_TYPES)[number]
    )
  ) {
    return json({ ok: false, code: 'unsupported_upload' }, { status: 415 });
  }

  const { data: allocationData, error: allocationError } = await locals.supabase
    .rpc('create_listing_upload', {
      target_listing_id: listingId,
      requested_role: role,
      declared_mime_type: file.type,
      declared_byte_size: file.size
    })
    .single();
  if (allocationError || !allocationData) {
    return json({ ok: false, code: 'upload_allocation_failed' }, { status: 400 });
  }
  const allocation = allocationData as unknown as UploadAllocation;

  const serviceClient = createServiceRoleSupabaseClient({
    PUBLIC_SUPABASE_URL: locals.runtime.publicSupabaseUrl,
    SUPABASE_SECRET_KEY: locals.runtime.supabaseSecretKey
  });
  const privilegedClient = acknowledgeServiceRoleClient(serviceClient);
  let finalPath: string | null = null;
  let finalized = false;

  try {
    const { error: sourceUploadError } = await locals.supabase.storage
      .from(allocation.bucket_id)
      .upload(allocation.storage_path, file, {
        contentType: file.type,
        upsert: false
      });
    if (sourceUploadError) throw new Error('quarantine_upload_failed', { cause: sourceUploadError });

    const claimResult = await claimListingUpload(privilegedClient, {
      uploadId: allocation.upload_id,
      processorRequestId: locals.requestId
    });
    if (!claimResult.ok) throw new Error('upload_claim_failed');
    const claim = claimResult.data;

    const { data: sourceBlob, error: downloadError } = await serviceClient.storage
      .from(allocation.bucket_id)
      .download(claim.quarantinePath);
    if (downloadError || !sourceBlob) {
      throw new Error('quarantine_download_failed', { cause: downloadError });
    }
    const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer());
    if (sourceBytes.byteLength !== file.size) throw new Error('stored_size_mismatch');

    const sanitized = await sanitizeListingImage(
      imagesBinding(event.platform),
      sourceBytes,
      file.type
    );
    finalPath = `${claim.uploaderId}/${claim.listingId}/${claim.id}.webp`;

    const { error: finalUploadError } = await serviceClient.storage
      .from('listing-images')
      .upload(finalPath, sanitized.bytes, {
        contentType: sanitized.mimeType,
        upsert: false
      });
    if (finalUploadError) throw new Error('sanitized_upload_failed', { cause: finalUploadError });

    const finalizeResult = await finalizeListingUpload(privilegedClient, {
      uploadId: allocation.upload_id,
      finalStoragePath: finalPath,
      contentHash: sanitized.contentHash,
      mimeType: sanitized.mimeType,
      byteSize: sanitized.bytes.byteLength,
      widthPx: sanitized.width,
      heightPx: sanitized.height
    });
    if (!finalizeResult.ok) throw new Error('upload_finalize_failed');
    finalized = true;

    return json({
      ok: true,
      photo: {
        id: finalizeResult.data.id,
        role,
        mimeType: sanitized.mimeType,
        width: sanitized.width,
        height: sanitized.height
      }
    });
  } catch (cause) {
    const rejectionCode =
      cause instanceof ImageProcessingError ? cause.code : 'processing_failed';
    if (!finalized) {
      try {
        const rejectionResult = await rejectListingUpload(privilegedClient, {
          uploadId: allocation.upload_id,
          rejectionCode
        });
        if (!rejectionResult.ok) {
          console.error(
            JSON.stringify({
              event: 'listing_upload_rejection_ledger_failed',
              requestId: locals.requestId,
              uploadId: allocation.upload_id,
              code: rejectionResult.error.code
            })
          );
        }
      } catch (rejectionCause) {
        console.error(
          JSON.stringify({
            event: 'listing_upload_rejection_ledger_failed',
            requestId: locals.requestId,
            uploadId: allocation.upload_id,
            code: 'unexpected_failure',
            errorType:
              rejectionCause instanceof Error ? rejectionCause.name : typeof rejectionCause
          })
        );
      }
    }
    if (finalPath && !finalized) await serviceClient.storage.from('listing-images').remove([finalPath]);
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'listing_upload_failed',
        requestId: locals.requestId,
        uploadId: allocation.upload_id,
        code: rejectionCode
      })
    );
    const status = cause instanceof ImageProcessingError ? 422 : 500;
    return json({ ok: false, code: rejectionCode, requestId: locals.requestId }, { status });
  } finally {
    await serviceClient.storage
      .from(allocation.bucket_id)
      .remove([allocation.storage_path]);
  }
};
