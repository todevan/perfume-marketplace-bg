import { z } from 'zod';
import { photoRoleSchema, type ActionResult, type ListingPhotoDto } from '../../contracts';
import type { Tables } from '../database.types';
import { requireData, signedListingImageUrls, throwIfError } from '../repositories';
import { runAction } from './action';
import type { PrivilegedMarketplaceClient } from './privileged';

export const claimListingUploadInputSchema = z.object({
	uploadId: z.string().uuid(),
	processorRequestId: z.string().trim().min(8).max(200)
});

export const finalizeListingUploadInputSchema = z.object({
	uploadId: z.string().uuid(),
	finalStoragePath: z.string().trim().min(1).max(500),
	contentHash: z.string().regex(/^[a-f0-9]{64}$/),
	mimeType: z.enum(['image/jpeg', 'image/webp', 'image/avif']),
	byteSize: z.number().int().min(1).max(10 * 1024 * 1024),
	widthPx: z.number().int().min(1).max(10_000),
	heightPx: z.number().int().min(1).max(10_000)
});

export const rejectListingUploadInputSchema = z.object({
	uploadId: z.string().uuid(),
	rejectionCode: z.string().trim().min(2).max(80).regex(/^[a-z0-9_:-]+$/i)
});

export interface ClaimedListingUpload {
	readonly id: string;
	readonly uploaderId: string;
	readonly listingId: string;
	readonly role: z.infer<typeof photoRoleSchema>;
	readonly quarantinePath: string;
	readonly declaredMimeType: string;
	readonly declaredByteSize: number;
	readonly expiresAt: string;
}

/** Service-role-only claim after the processor has verified the quarantine object exists. */
export async function claimListingUpload(
	client: PrivilegedMarketplaceClient,
	rawInput: unknown
): Promise<ActionResult<ClaimedListingUpload>> {
	return runAction(claimListingUploadInputSchema, rawInput, async (input) => {
		const { data, error } = await client.rpc('claim_listing_upload', {
			target_upload_id: input.uploadId,
			processor_request_id: input.processorRequestId
		});
		throwIfError('uploads.claim', error);
		const row = requireData('uploads.claim', data);
		return {
			id: row.id,
			uploaderId: row.uploader_id,
			listingId: row.listing_id,
			role: row.requested_role,
			quarantinePath: row.quarantine_path,
			declaredMimeType: row.declared_mime_type,
			declaredByteSize: row.declared_byte_size,
			expiresAt: row.expires_at
		};
	});
}

/** Service-role-only metadata commit after sanitization and final-object upload. */
export async function finalizeListingUpload(
	client: PrivilegedMarketplaceClient,
	rawInput: unknown
): Promise<ActionResult<ListingPhotoDto>> {
	return runAction(finalizeListingUploadInputSchema, rawInput, async (input) => {
		const { data, error } = await client.rpc('finalize_listing_upload', {
			target_upload_id: input.uploadId,
			final_storage_path: input.finalStoragePath,
			actual_content_hash: input.contentHash,
			actual_mime_type: input.mimeType,
			actual_byte_size: input.byteSize,
			actual_width_px: input.widthPx,
			actual_height_px: input.heightPx
		});
		throwIfError('uploads.finalize', error);
		const row = requireData('uploads.finalize', data) as Tables<'listing_photos'>;
		const imageUrls = await signedListingImageUrls(client, [row.storage_path]);
		return {
			id: row.id,
			imageUrl: requireData('uploads.finalize.sign', imageUrls.get(row.storage_path) ?? null),
			role: row.role,
			sortOrder: row.sort_order
		};
	});
}

/** Service-role-only terminal rejection for failed validation/sanitization. */
export async function rejectListingUpload(
	client: PrivilegedMarketplaceClient,
	rawInput: unknown
): Promise<ActionResult<void>> {
	return runAction(rejectListingUploadInputSchema, rawInput, async (input) => {
		const { error } = await client.rpc('reject_listing_upload', {
			target_upload_id: input.uploadId,
			rejection_code: input.rejectionCode
		});
		throwIfError('uploads.reject', error);
	});
}
