import { createClient } from 'npm:@supabase/supabase-js@2';

type CleanupClaim = {
	queue_id: number;
	bucket_id: string;
	storage_path: string;
	reason: string;
	attempts: number;
	claimed_at: string;
};

type ExactCleanupScope = {
	queueId: number;
	bucketId: 'report-evidence';
	storagePath: string;
};

const ALLOWED_PRIVATE_BUCKETS = new Set([
	'listing-image-quarantine',
	'listing-images',
	'report-evidence'
]);
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const MAX_REQUEST_BYTES = 1024;
const REPORT_EVIDENCE_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/u;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store'
		}
	});

function requiredEnvironment(name: string): string {
	const value = Deno.env.get(name)?.trim();
	if (!value) throw new Error(`Missing ${name}`);
	return value;
}

function cleanupSecret(): string {
	const value = requiredEnvironment('UPLOAD_CLEANUP_SECRET');
	if (new TextEncoder().encode(value).byteLength < 32) {
		throw new Error('UPLOAD_CLEANUP_SECRET must contain at least 32 bytes');
	}
	return value;
}

function batchSize(): number {
	const configured = Deno.env.get('UPLOAD_CLEANUP_BATCH_SIZE')?.trim();
	if (!configured) return DEFAULT_BATCH_SIZE;
	if (!/^\d{1,3}$/.test(configured)) {
		throw new Error('UPLOAD_CLEANUP_BATCH_SIZE is invalid');
	}
	const parsed = Number(configured);
	if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_BATCH_SIZE) {
		throw new Error('UPLOAD_CLEANUP_BATCH_SIZE is outside the allowed range');
	}
	return parsed;
}

async function secureEqual(left: string, right: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const [leftHash, rightHash] = await Promise.all([
		crypto.subtle.digest('SHA-256', encoder.encode(left)),
		crypto.subtle.digest('SHA-256', encoder.encode(right))
	]);
	const leftBytes = new Uint8Array(leftHash);
	const rightBytes = new Uint8Array(rightHash);
	let different = leftBytes.length ^ rightBytes.length;
	for (let index = 0; index < Math.max(leftBytes.length, rightBytes.length); index += 1) {
		different |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
	}
	return different === 0;
}

function isSafeStoragePath(value: string): boolean {
	if (value.length < 1 || value.length > 1024) return false;
	if (value.startsWith('/') || value.endsWith('/') || value.includes('\\')) return false;
	if (/[\u0000-\u001f\u007f]/u.test(value)) return false;
	const segments = value.split('/');
	return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function isClaim(value: unknown): value is CleanupClaim {
	if (!value || typeof value !== 'object') return false;
	const claim = value as Partial<CleanupClaim>;
	return Number.isSafeInteger(claim.queue_id)
		&& Number(claim.queue_id) > 0
		&& typeof claim.bucket_id === 'string'
		&& typeof claim.storage_path === 'string'
		&& typeof claim.reason === 'string'
		&& claim.reason.length >= 2
		&& claim.reason.length <= 80
		&& Number.isSafeInteger(claim.attempts)
		&& Number(claim.attempts) > 0
		&& Number(claim.attempts) <= 8
		&& typeof claim.claimed_at === 'string'
		&& Number.isFinite(Date.parse(claim.claimed_at));
}

function parseClaims(value: unknown, limit: number): CleanupClaim[] | null {
	if (!Array.isArray(value) || value.length > limit) return null;
	if (!value.every(isClaim)) return null;
	return new Set(value.map((claim) => claim.queue_id)).size === value.length ? value : null;
}

function databaseCode(error: { code?: string } | null): string {
	return error?.code?.replace(/[^A-Z0-9_]/gi, '').slice(0, 32) || 'unknown';
}

Deno.serve(async (request) => {
	const requestId = crypto.randomUUID();
	if (request.method !== 'POST') return json({ error: 'method_not_allowed', requestId }, 405);
	if (Number(request.headers.get('content-length') ?? '0') > MAX_REQUEST_BYTES) {
		return json({ error: 'payload_too_large', requestId }, 413);
	}

	try {
		const expectedSecret = cleanupSecret();
		const suppliedSecret = request.headers.get('x-upload-cleanup-secret') ?? '';
		if (!suppliedSecret || !(await secureEqual(suppliedSecret, expectedSecret))) {
			return json({ error: 'unauthorized', requestId }, 401);
		}

		const encodedBody = new Uint8Array(await request.arrayBuffer());
		if (encodedBody.byteLength > MAX_REQUEST_BYTES) {
			return json({ error: 'payload_too_large', requestId }, 413);
		}

		let exactScope: ExactCleanupScope | null = null;
		if (encodedBody.byteLength > 0) {
			let decodedBody: unknown;
			try {
				decodedBody = JSON.parse(new TextDecoder().decode(encodedBody));
			} catch {
				return json({ error: 'invalid_request', requestId }, 400);
			}
			if (!decodedBody || typeof decodedBody !== 'object' || Array.isArray(decodedBody)) {
				return json({ error: 'invalid_request', requestId }, 400);
			}
			const scope = decodedBody as Record<string, unknown>;
			const bodyKeys = Object.keys(scope).sort();
			if (
				bodyKeys.length !== 3 ||
				bodyKeys[0] !== 'bucketId' ||
				bodyKeys[1] !== 'queueId' ||
				bodyKeys[2] !== 'storagePath' ||
				!Number.isSafeInteger(scope.queueId) ||
				Number(scope.queueId) < 1 ||
				scope.bucketId !== 'report-evidence' ||
				typeof scope.storagePath !== 'string' ||
				!REPORT_EVIDENCE_PATH.test(scope.storagePath)
			) {
				return json({ error: 'invalid_request', requestId }, 400);
			}
			exactScope = {
				queueId: Number(scope.queueId),
				bucketId: 'report-evidence',
				storagePath: scope.storagePath
			};
		}

		const supabaseUrl = requiredEnvironment('SUPABASE_URL');
		const serviceKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
		const limit = exactScope ? 1 : batchSize();
		const supabase = createClient(supabaseUrl, serviceKey, {
			auth: { autoRefreshToken: false, persistSession: false }
		});
		let claimedData: unknown;
		let claimError: { code?: string } | null;
		if (!exactScope) {
			const { error: expiryError } = await supabase.rpc(
				'expire_report_evidence_uploads',
				{ target_limit: limit }
			);
			if (expiryError) {
				console.error(JSON.stringify({
					event: 'report_evidence_expiry_failed',
					code: databaseCode(expiryError),
					requestId
				}));
				return json({ error: 'expiry_failed', requestId }, 503);
			}

			const claimResult = await supabase.rpc(
				'claim_upload_cleanup',
				{ target_limit: limit, worker_request_id: requestId }
			);
			claimedData = claimResult.data;
			claimError = claimResult.error;
		} else {
			const claimResult = await supabase.rpc(
				'claim_exact_upload_cleanup',
				{
					target_queue_id: exactScope.queueId,
					target_bucket_id: exactScope.bucketId,
					target_storage_path: exactScope.storagePath,
					worker_request_id: requestId
				}
			);
			claimedData = claimResult.data;
			claimError = claimResult.error;
		}
		if (claimError) {
			console.error(JSON.stringify({
				event: 'upload_cleanup_claim_failed',
				code: databaseCode(claimError),
				requestId
			}));
			return json({ error: 'claim_failed', requestId }, 503);
		}

		const claims = parseClaims(claimedData, limit);
		if (!claims) {
			console.error(JSON.stringify({ event: 'upload_cleanup_claim_invalid', requestId }));
			return json({ error: 'invalid_claim_response', requestId }, 503);
		}
		if (
			exactScope &&
			claims.some((claim) =>
				claim.queue_id !== exactScope.queueId ||
				claim.bucket_id !== exactScope.bucketId ||
				claim.storage_path !== exactScope.storagePath
			)
		) {
			console.error(JSON.stringify({ event: 'upload_cleanup_claim_mismatch', requestId }));
			return json({ error: 'invalid_claim_response', requestId }, 503);
		}

		let completed = 0;
		let failed = 0;
		let transitionFailures = 0;

		for (const claim of claims) {
			if (!ALLOWED_PRIVATE_BUCKETS.has(claim.bucket_id) || !isSafeStoragePath(claim.storage_path)) {
				const { error } = await supabase.rpc('fail_upload_cleanup', {
					target_queue_id: claim.queue_id,
					worker_request_id: requestId,
					error_code: 'unsafe_storage_coordinates'
				});
				failed += 1;
				transitionFailures += error ? 1 : 0;
				console.error(JSON.stringify({
					event: 'upload_cleanup_coordinates_rejected',
					queueId: claim.queue_id,
					requestId
				}));
				continue;
			}

			const { error: deleteError } = await supabase.storage
				.from(claim.bucket_id)
				.remove([claim.storage_path]);
			if (deleteError) {
				const { error: failureError } = await supabase.rpc('fail_upload_cleanup', {
					target_queue_id: claim.queue_id,
					worker_request_id: requestId,
					error_code: 'storage_delete_failed'
				});
				failed += 1;
				transitionFailures += failureError ? 1 : 0;
				console.error(JSON.stringify({
					event: 'upload_cleanup_delete_failed',
					queueId: claim.queue_id,
					requestId
				}));
				continue;
			}

			const { error: completeError } = await supabase.rpc('complete_upload_cleanup', {
				target_queue_id: claim.queue_id,
				worker_request_id: requestId
			});
			if (completeError) {
				transitionFailures += 1;
				console.error(JSON.stringify({
					event: 'upload_cleanup_commit_failed',
					queueId: claim.queue_id,
					code: databaseCode(completeError),
					requestId
				}));
				continue;
			}
			completed += 1;
		}

		const status = transitionFailures > 0 ? 503 : 202;
		console.log(JSON.stringify({
			event: 'upload_cleanup_batch_finished',
			claimed: claims.length,
			completed,
			failed,
			transitionFailures,
			requestId
		}));
		const receipt = { claimed: claims.length, completed, failed, requestId };
		return json(exactScope ? { ...receipt, scope: 'exact' } : receipt, status);
	} catch (cause) {
		console.error(JSON.stringify({
			event: 'upload_cleanup_internal_error',
			requestId,
			code: cause instanceof Error && cause.message.startsWith('Missing ')
				? 'missing_configuration'
				: 'internal_error'
		}));
		return json({ error: 'internal_error', requestId }, 500);
	}
});
