import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../migrations/', import.meta.url);
const migrationNames = readdirSync(migrationsUrl).filter((filename) =>
	filename.endsWith('_activate_provisional_legal_versions.sql')
);
const compact = (source) => source.replace(/\r\n/g, '\n').toLowerCase().replace(/\s+/g, ' ').trim();

test('provisional legal-version migration fails closed and preserves consent evidence', () => {
	assert.equal(migrationNames.length, 1, 'expected one provisional legal-version migration');

	const sql = compact(readFileSync(new URL(migrationNames[0], migrationsUrl), 'utf8'));

	for (const fragment of [
		'activation_timestamp timestamptz;',
		'lock table public.beta_legal_documents in share row exclusive mode',
		'activation_timestamp := clock_timestamp()',
		"document_version = '2026-07-22'",
		"effective_at = timestamptz '2026-07-22 00:00:00+03'",
		"raise exception 'expected current legal document versions are missing or drifted'",
		'retired_at = activation_timestamp',
		"get diagnostics retired_count = row_count",
		"if retired_count <> 2 then",
		"('beta_terms', '2026-08-24-provisional.1', true, activation_timestamp)",
		"('marketplace_rules', '2026-08-24-provisional.1', true, activation_timestamp)"
	]) {
		assert.ok(sql.includes(fragment), `missing fail-closed SQL contract: ${fragment}`);
	}

	assert.ok(!sql.includes('delete from public.beta_legal_documents'));
	assert.ok(!sql.includes('delete from public.beta_consent_events'));
	assert.ok(!sql.includes('update public.beta_consent_events'));
	assert.ok(!sql.includes("retired_at = timestamptz '2026-08-24 00:00:00+03'"));
	assert.ok(
		!sql.includes('activation_timestamp := statement_timestamp()'),
		'statement-start time must never become the activation boundary'
	);
	assert.equal(
		(sql.match(/\bclock_timestamp\(\)/g) ?? []).length,
		1,
		'the shared activation boundary must be captured exactly once'
	);

	const lockIndex = sql.indexOf('lock table public.beta_legal_documents');
	const timestampIndex = sql.indexOf('activation_timestamp := clock_timestamp()');
	const collisionIndex = sql.indexOf("and d.document_version = '2026-08-24-provisional.1'");
	const driftGuardIndex = sql.indexOf("raise exception 'expected current legal document versions are missing or drifted'");
	const retirementIndex = sql.indexOf('update public.beta_legal_documents');
	const insertionIndex = sql.indexOf('insert into public.beta_legal_documents');
	assert.ok(lockIndex < collisionIndex, 'the table lock must precede fail-closed validation');
	assert.ok(collisionIndex < driftGuardIndex, 'replacement-version collisions must fail before mutation');
	assert.ok(driftGuardIndex < timestampIndex, 'activation time must be captured after validation');
	assert.equal(
		sql.slice(timestampIndex, retirementIndex),
		'activation_timestamp := clock_timestamp(); ',
		'activation time must be captured immediately before the first mutation'
	);
	assert.ok(retirementIndex < insertionIndex, 'known versions must retire before replacements insert');

	const concurrencySql = compact(
		readFileSync(new URL('legal_consent_activation_concurrency.pgtap.sql', import.meta.url), 'utf8')
	);
	const helperIndex = concurrencySql.indexOf(
		'create function private.issue25_activate_provisional_legal_versions_for_test()'
	);
	const helperLockIndex = concurrencySql.indexOf(
		'lock table public.beta_legal_documents in share row exclusive mode',
		helperIndex
	);
	const activationEnd =
		"('marketplace_rules', '2026-08-24-provisional.1', true, activation_timestamp);";
	const migrationCore = sql.slice(lockIndex, sql.indexOf(activationEnd, lockIndex) + activationEnd.length);
	const helperCore = concurrencySql.slice(
		helperLockIndex,
		concurrencySql.indexOf(activationEnd, helperLockIndex) + activationEnd.length
	);
	assert.equal(
		helperCore,
		migrationCore,
		'the two-session test must execute the exact migration activation behavior'
	);
});
