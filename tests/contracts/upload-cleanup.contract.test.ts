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
		expect(edgeFunction).toContain("'claim_upload_cleanup'");
		expect(edgeFunction).toContain("'complete_upload_cleanup'");
		expect(edgeFunction).toContain("'fail_upload_cleanup'");
		expect(edgeFunction).toMatch(/worker_request_id:\s*requestId/g);
		expect(jobsMigration).toContain('create or replace function public.claim_upload_cleanup(');
		expect(jobsMigration).toContain('create or replace function public.complete_upload_cleanup(');
		expect(jobsMigration).toContain('create or replace function public.fail_upload_cleanup(');
		expect(jobsMigration).toContain('for update skip locked');
	});

	it('deletes one exact object only from the two private upload buckets', () => {
		expect(edgeFunction).toContain("'listing-image-quarantine'");
		expect(edgeFunction).toContain("'listing-images'");
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
