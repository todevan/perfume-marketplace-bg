import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const edgeFunction = readFileSync(
	new URL('../../supabase/functions/upload-cleanup/index.ts', import.meta.url),
	'utf8'
);
const functionConfig = readFileSync(
	new URL('../../supabase/config.toml', import.meta.url),
	'utf8'
);
const jobsMigration = readFileSync(
	new URL('../../supabase/migrations/202607220007_search_realtime_jobs.sql', import.meta.url),
	'utf8'
);
const structuredLogFields = Array.from(
	edgeFunction.matchAll(/console\.(?:log|error)\(JSON\.stringify\(\{([\s\S]*?)\}\)\);/gu),
	(match) => match[1]
).join('\n');

describe('private upload cleanup worker contract', () => {
	it('authenticates a dedicated scheduler secret in constant time and fails closed', () => {
		expect(edgeFunction).toContain("requiredEnvironment('UPLOAD_CLEANUP_SECRET')");
		expect(edgeFunction).toContain("request.headers.get('x-upload-cleanup-secret')");
		expect(edgeFunction).toContain('secureEqual(suppliedSecret, expectedSecret)');
		expect(edgeFunction).toContain('byteLength < 32');
		expect(edgeFunction).toContain("request.method !== 'POST'");
	});

	it('claims a bounded lease and transitions every item with the matching worker token', () => {
		expect(edgeFunction).toContain('const MAX_BATCH_SIZE = 100');
		expect(edgeFunction).toContain("'expire_report_evidence_uploads'");
		expect(edgeFunction).toContain("'claim_upload_cleanup'");
		expect(edgeFunction).toContain("'complete_upload_cleanup'");
		expect(edgeFunction).toContain("'fail_upload_cleanup'");
		expect(edgeFunction).toMatch(/worker_request_id:\s*requestId/g);
		expect(jobsMigration).toContain('create or replace function public.claim_upload_cleanup(');
		expect(jobsMigration).toContain('create or replace function public.complete_upload_cleanup(');
		expect(jobsMigration).toContain('create or replace function public.fail_upload_cleanup(');
		expect(jobsMigration).toContain('for update skip locked');
	});

	it('accepts only an encoded, exact report-evidence coordinate request', () => {
		expect(edgeFunction).toContain('const MAX_REQUEST_BYTES = 1024');
		expect(edgeFunction).toContain('await request.arrayBuffer()');
		expect(edgeFunction).toContain('encodedBody.byteLength > MAX_REQUEST_BYTES');
		expect(edgeFunction).toContain("bodyKeys.length !== 3");
		expect(edgeFunction).toContain("bodyKeys[0] !== 'bucketId'");
		expect(edgeFunction).toContain("bodyKeys[1] !== 'queueId'");
		expect(edgeFunction).toContain("bodyKeys[2] !== 'storagePath'");
		expect(edgeFunction).toContain("scope.bucketId !== 'report-evidence'");
		expect(edgeFunction).toContain('REPORT_EVIDENCE_PATH.test(scope.storagePath)');
		expect(edgeFunction).toContain("return json({ error: 'invalid_request', requestId }, 400)");
	});

	it('isolates exact cleanup from expiry and global batch claiming', () => {
		expect(edgeFunction).toContain("'claim_exact_upload_cleanup'");
		expect(edgeFunction).toContain('target_queue_id: exactScope.queueId');
		expect(edgeFunction).toContain('target_bucket_id: exactScope.bucketId');
		expect(edgeFunction).toContain('target_storage_path: exactScope.storagePath');
		expect(edgeFunction).toContain('const limit = exactScope ? 1 : batchSize()');
		expect(edgeFunction).toMatch(/if \(!exactScope\) \{[\s\S]*?'expire_report_evidence_uploads'[\s\S]*?'claim_upload_cleanup'/u);
	});

	it('rejects a mismatched exact claim before touching Storage and scopes the receipt', () => {
		const mismatchCheck = edgeFunction.indexOf('claim.queue_id !== exactScope.queueId');
		const storageDelete = edgeFunction.indexOf(
			'const { error: deleteError } = await supabase.storage'
		);
		expect(mismatchCheck).toBeGreaterThan(-1);
		expect(storageDelete).toBeGreaterThan(mismatchCheck);
		expect(edgeFunction).toContain("scope: 'exact'");
		expect(edgeFunction).toContain('.remove([claim.storage_path])');
		expect(edgeFunction).toContain('target_queue_id: claim.queue_id');
		expect(edgeFunction).toMatch(/worker_request_id:\s*requestId/g);
	});

	it('deletes one exact object only from the approved private upload buckets', () => {
		expect(edgeFunction).toContain("'listing-image-quarantine'");
		expect(edgeFunction).toContain("'listing-images'");
		expect(edgeFunction).toContain("'report-evidence'");
		expect(edgeFunction).toContain('ALLOWED_PRIVATE_BUCKETS.has(claim.bucket_id)');
		expect(edgeFunction).toContain('isSafeStoragePath(claim.storage_path)');
		expect(edgeFunction).toContain('.remove([claim.storage_path])');
		expect(edgeFunction).not.toMatch(/\.remove\([^\[]/u);
	});

	it('never writes object paths or provider error messages to logs', () => {
		expect(structuredLogFields).not.toContain('storage_path');
		expect(structuredLogFields).not.toContain('deleteError');
		expect(structuredLogFields).not.toContain('failureError');
		expect(structuredLogFields).not.toMatch(/message\s*:/u);
	});

	it('is configured for explicit secret authentication instead of a browser JWT', () => {
		expect(functionConfig).toMatch(/\[functions\.upload-cleanup\]\s+verify_jwt\s*=\s*false/u);
	});
});
