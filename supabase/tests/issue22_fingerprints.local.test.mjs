import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repo = resolve(import.meta.dirname, '..', '..');
const fingerprintSql = readFileSync(
	resolve(repo, 'scripts', 'issue22-hosted', 'definition-fingerprints.sql'),
	'utf8'
);
const catalogPayload = readFileSync(resolve(repo, 'catalog', 'brand-categories.json'), 'utf8');
const containers = execFileSync(
	'docker',
	['ps', '--filter', 'name=supabase_db_perfume-marketplace-bg', '--format', '{{.Names}}'],
	{ cwd: repo, encoding: 'utf8' }
).trim().split(/\r?\n/u);
const compatibleContainers = containers.filter((name) => {
	try {
		return execFileSync('docker', [
			'exec', name, 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
			'-c', "select count(*) = 18 and to_regclass('public.report_evidence_uploads') is not null from supabase_migrations.schema_migrations"
		], { cwd: repo, encoding: 'utf8' }).trim() === 't';
	} catch {
		return false;
	}
});
const [container] = compatibleContainers;

assert.equal(compatibleContainers.length, 1, 'one exact 18-migration local Supabase database must be running');

function fingerprintRows(setupSql = '', repeatedSql = '') {
	const output = execFileSync(
		'docker',
		['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'],
		{
			cwd: repo,
			encoding: 'utf8',
			input: `begin;\n${setupSql}\n${fingerprintSql}\n${repeatedSql}\nrollback;\n`
		}
	);
	return output.trim().split(/\r?\n/u).filter((line) => /^(?:[0-9a-f]{64}\|){6}[0-9a-f]{64}\|/u.test(line));
}

function hashes(row) {
	const [relations, storageAuthorization, types, functions, policies, triggers, catalog] = row.split('|');
	return { relations, storageAuthorization, types, functions, policies, triggers, catalog };
}

function storageAdminSql(sql) {
	execFileSync('docker', [
		'exec', '-i', container, 'sh', '-c',
		'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -Xq -v ON_ERROR_STOP=1 -U supabase_storage_admin -d postgres'
	], { cwd: repo, encoding: 'utf8', input: sql });
}

test('storage.objects authorization drift changes executable fingerprints', () => {
	const baseline = hashes(fingerprintRows()[0]);
	let unexpectedPolicy;
	storageAdminSql('drop policy if exists issue22_unexpected_permissive_policy on storage.objects;');
	try {
		storageAdminSql('create policy issue22_unexpected_permissive_policy on storage.objects as permissive for select to public using (true);');
		unexpectedPolicy = hashes(fingerprintRows()[0]);
	} finally {
		storageAdminSql('drop policy if exists issue22_unexpected_permissive_policy on storage.objects;');
	}
	let rlsDisabled;
	try {
		storageAdminSql('alter table storage.objects disable row level security;');
		rlsDisabled = hashes(fingerprintRows()[0]);
	} finally {
		storageAdminSql('alter table storage.objects enable row level security;');
	}

	assert.notEqual(unexpectedPolicy.policies, baseline.policies);
	assert.notEqual(rlsDisabled.storageAuthorization, baseline.storageAuthorization);
});

test('catalog fingerprint is stable across reseeds and detects sync-run semantic drift', () => {
	const seed = `
set local request.jwt.claims = '{"role":"service_role"}';
select public.sync_editorial_catalog($issue22$${catalogPayload}$issue22$::jsonb);
`;
	const reseeded = fingerprintRows(seed, `${seed}\n${fingerprintSql}`);
	assert.equal(reseeded.length, 2);
	assert.equal(hashes(reseeded[0]).catalog, hashes(reseeded[1]).catalog);

	const baseline = hashes(fingerprintRows()[0]);
	const semanticDrift = hashes(fingerprintRows(`
insert into public.catalog_sync_runs (
  catalog_id, schema_version, source_catalog_version, payload_sha256, payload,
  actor_id, actor_role, brand_count, alias_count, membership_count
)
select catalog_id, schema_version, source_catalog_version + 1, payload_sha256, payload,
       actor_id, actor_role, brand_count, alias_count, membership_count
from public.catalog_sync_runs
order by completed_at desc
limit 1;
`)[0]);
	assert.notEqual(semanticDrift.catalog, baseline.catalog);
});
