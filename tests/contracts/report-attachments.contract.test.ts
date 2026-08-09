import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const reportRoute = readFileSync(
	new URL('../../src/routes/report/+page.server.ts', import.meta.url),
	'utf8'
);
const reportPage = readFileSync(
	new URL('../../src/routes/report/+page.svelte', import.meta.url),
	'utf8'
);
const evidenceMigration = readFileSync(
	new URL(
		'../../supabase/migrations/202608020014_report_evidence_hardening.sql',
		import.meta.url
	),
	'utf8'
);

describe('report attachment sanitization contract', () => {
	it('rejects document evidence until a scanner is configured', () => {
		expect(reportRoute).not.toContain("'application/pdf'");
		expect(reportRoute).not.toContain("| 'pdf'");
		expect(reportPage).not.toContain('application/pdf');
	});

	it('decodes and re-encodes every evidence image before final storage', () => {
		expect(reportRoute).toContain('sanitizeImage(');
		expect(reportRoute).toContain('sanitized.bytes');
		expect(reportRoute).toContain('contentType: sanitized.mimeType');
		expect(reportRoute).not.toContain('evidenceStorage.upload(path, bytes');
	});

	it('uses the allocation/finalization ledger and reconciles ambiguous failures durably', () => {
		expect(reportRoute).toContain("'create_report_evidence_upload'");
		expect(reportRoute).toContain("'finalize_report_evidence_upload'");
		expect(reportRoute).toContain("'reject_unattached_report_evidence_uploads'");
		expect(reportRoute).toContain('const processReport = async () =>');
		expect(reportRoute).toContain("await rejectAllocatedUploads('report_processing_failed')");
		expect(reportRoute).not.toContain('evidenceStorage.remove(');
		expect(reportRoute).not.toContain('crypto.randomUUID()}.webp');
	});

	it('revokes authenticated object deletion and reconciles only unattached ledger rows', () => {
		expect(evidenceMigration).toContain(
			'drop policy if exists marketplace_report_evidence_delete on storage.objects'
		);
		expect(evidenceMigration).toContain(
			'create or replace function public.reject_unattached_report_evidence_uploads'
		);
		expect(evidenceMigration).not.toContain(
			'create policy marketplace_report_evidence_delete on storage.objects'
		);
	});
});
