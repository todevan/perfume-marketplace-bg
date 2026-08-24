import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../migrations/', import.meta.url);
const migrationNames = readdirSync(migrationsUrl).filter((filename) =>
	filename.endsWith('_activate_provisional_legal_versions.sql')
);

test('provisional legal-version migration fails closed and preserves consent evidence', () => {
	assert.equal(migrationNames.length, 1, 'expected one provisional legal-version migration');

	const sql = readFileSync(new URL(migrationNames[0], migrationsUrl), 'utf8')
		.replace(/\r\n/g, '\n')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();

	for (const fragment of [
		'lock table public.beta_legal_documents in share row exclusive mode',
		"document_version = '2026-07-22'",
		"effective_at = timestamptz '2026-07-22 00:00:00+03'",
		"raise exception 'expected current legal document versions are missing or drifted'",
		"retired_at = timestamptz '2026-08-24 00:00:00+03'",
		"get diagnostics retired_count = row_count",
		"if retired_count <> 2 then",
		"('beta_terms', '2026-08-24-provisional.1', true, timestamptz '2026-08-24 00:00:00+03')",
		"('marketplace_rules', '2026-08-24-provisional.1', true, timestamptz '2026-08-24 00:00:00+03')"
	]) {
		assert.ok(sql.includes(fragment), `missing fail-closed SQL contract: ${fragment}`);
	}

	assert.ok(!sql.includes('delete from public.beta_legal_documents'));
	assert.ok(!sql.includes('delete from public.beta_consent_events'));
	assert.ok(!sql.includes('update public.beta_consent_events'));
});
