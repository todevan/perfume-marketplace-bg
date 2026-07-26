import { createClient } from 'npm:@supabase/supabase-js@2';

type CleanupClaim = {
	queue_id: number;
	bucket_id: string;
	storage_path: string;
	reason: string;
	attempts: number;
	claimed_at: string;
};

const ALLOWED_PRIVATE_BUCKETS = new Set([
	'listing-image-quarantine',
	'listing-images'
]);
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;

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
	if (Number(request.headers.get('content-length') ?? '0') > 1024) {
		return json({ error: 'payload_too_large', requestId }, 413);
	}

	try {
		const expectedSecret = cleanupSecret();
		const suppliedSecret = request.headers.get('x-upload-cleanup-secret') ?? '';
		if (!suppliedSecret || !(await secureEqual(suppliedSecret, expectedSecret))) {
			return json({ error: 'unauthorized', requestId }, 401);
		}

		const supabaseUrl = requiredEnvironment('SUPABASE_URL');
		const serviceKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
		const limit = batchSize();
		const supabase = createClient(supabaseUrl, serviceKey, {
			auth: { autoRefreshToken: false, persistSession: false }
		});

		const { data: claimedData, error: claimError } = await supabase.rpc(
			'claim_upload_cleanup',
			{ target_limit: limit, worker_request_id: requestId }
		);
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
		return json({ claimed: claims.length, completed, failed, requestId }, status);
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
