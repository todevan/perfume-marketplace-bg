import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedCatalog } from '../seed-catalog.mjs';
import {
	assertCatalogCounts,
	assertManifestMatches,
	assertSafeInventory,
	decideMigrationExecution,
	fixedMigrationCommands,
	runLinkedCommand,
	TARGET
} from './operator-lib.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const privateRoot = resolve(packageRoot, 'private');
const runtimeRoot = resolve(privateRoot, 'migration-runtime');
const baselineAdoptionReceiptPath = resolve(repoRoot, '.superpowers', 'issue22-hosted-new-target', 'baseline-adoption-receipt.json');
const manifest = JSON.parse(readFileSync(join(packageRoot, 'operator-manifest.json'), 'utf8'));
const expectedVersions = manifest.migrations.map(({ file }) => file.split('_', 1)[0]);
const candidateSha = process.env.ISSUE22_CANDIDATE_SHA?.trim();
const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const providedServerKey = process.env.ISSUE22_SERVER_KEY?.trim();

function stop(message) { throw new Error(`MIGRATION STOP: ${message}`); }

function childEnvironment() {
	const keys = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME', 'COMSPEC'];
	const environment = { NO_COLOR: '1', SUPABASE_ACCESS_TOKEN: accessToken };
	for (const key of keys) if (process.env[key]) environment[key] = process.env[key];
	return environment;
}

function run(command, args, options = {}) {
	const pnpmEntry = join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'pnpm.js');
	const executable = command === 'pnpm' ? process.execPath : command;
	const actualArgs = command === 'pnpm' ? [pnpmEntry, ...args] : args;
	const result = spawnSync(executable, actualArgs, {
		cwd: repoRoot,
		encoding: 'utf8',
		stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
		env: childEnvironment()
	});
	if (result.status !== 0) stop(`${command} command failed without provider output disclosure`);
	return result.stdout ?? '';
}

function gitBlob(relativePath) {
	const result = spawnSync('git', ['show', `${candidateSha}:${relativePath}`], {
		cwd: repoRoot,
		encoding: null,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: childEnvironment()
	});
	if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) stop(`candidate blob unavailable: ${relativePath}`);
	return result.stdout;
}

function receipt(bytes) {
	return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function assertTrackedCandidate() {
	if (!/^[0-9a-f]{40}$/u.test(candidateSha ?? '')) stop('exact candidate SHA is missing');
	if (run('git', ['rev-parse', 'HEAD'], { capture: true }).trim() !== candidateSha) stop('HEAD differs from candidate');
	if (run('git', ['status', '--porcelain', '--untracked-files=no'], { capture: true }).trim() !== '') stop('tracked worktree/index differs from candidate');
	run('git', ['check-ignore', '-q', privateRoot]);
	assertStaticInputs();
}

function assertStaticInputs() {
	for (const expected of manifest.migrations) {
		const actual = receipt(gitBlob(`supabase/migrations/${expected.file}`));
		if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
			stop(`candidate migration differs from tracked receipt: ${expected.file}`);
		}
	}
	for (const [relativePath, expected] of Object.entries(manifest.seed_inputs)) {
		const actual = receipt(gitBlob(relativePath));
		if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
			stop(`seed source/input differs from tracked receipt: ${relativePath}`);
		}
	}
	const fingerprintBytes = gitBlob('scripts/issue22-hosted/definition-fingerprints.sql');
	const fingerprintReceipt = receipt(fingerprintBytes);
	if (
		fingerprintReceipt.bytes !== manifest.definition_fingerprint_input.bytes ||
		fingerprintReceipt.sha256 !== manifest.definition_fingerprint_input.sha256
	) stop('definition fingerprint query differs from tracked receipt');
}

function materializeTrackedSupabase() {
	const names = run('git', ['ls-tree', '-r', '--name-only', candidateSha, '--', 'supabase'], { capture: true })
		.split(/\r?\n/u)
		.filter(Boolean);
	if (!names.includes('supabase/config.toml') || names.length === 0) stop('candidate Supabase tree is incomplete');
	for (const relativePath of names) {
		if (!relativePath.startsWith('supabase/') || relativePath.includes('..')) stop('candidate Supabase path is unsafe');
		const target = join(runtimeRoot, ...relativePath.split('/'));
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, gitBlob(relativePath));
	}
}

function assertSafeRuntimePath() {
	mkdirSync(privateRoot, { recursive: true });
	const root = realpathSync(privateRoot);
	const target = resolve(runtimeRoot);
	const child = relative(root, target);
	if (!child || child.startsWith('..') || resolve(root, child) !== target) stop('scratch path escaped private root');
}

function projectRefPath() { return join(runtimeRoot, 'supabase', '.temp', 'project-ref'); }
function assertLinkedTarget() {
	const path = projectRefPath();
	if (!existsSync(path) || readFileSync(path, 'utf8').trim() !== TARGET.projectRef) stop('scratch link target mismatch');
}

async function api(path, init = {}) {
	if (!accessToken || !/^sbp_/u.test(accessToken)) stop('Supabase access token is unavailable');
	const response = await fetch(`https://api.supabase.com${path}`, {
		...init,
		headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...init.headers }
	});
	if (!response.ok) stop(`Management API ${path} returned HTTP ${response.status}`);
	return response.json();
}

const EMPTY_INVENTORY_SQL = `
select
  (select count(*) from auth.users)::int as auth_users,
  (select count(*) from storage.buckets)::int as buckets,
  (select count(*) from storage.objects)::int as objects,
	coalesce((select json_agg(json_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) order by id) from storage.buckets),'[]'::json) as bucket_definitions,
  coalesce((select json_agg(format('%I.%I',n.nspname,c.relname) order by n.nspname,c.relname) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','f')),'[]'::json) as public_relations,
  coalesce((select json_agg(p.proname order by p.proname) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),'[]'::json) as public_functions,
  coalesce((select json_agg(format('%I.%I:%s',schemaname,tablename,policyname) order by schemaname,tablename,policyname) from pg_catalog.pg_policies where schemaname='public'),'[]'::json) as public_policies,
  exists(select 1 from pg_catalog.pg_namespace where nspname='private') as private_schema_exists,
  coalesce((select json_agg(nspname order by nspname) from pg_catalog.pg_namespace where nspname not like 'pg_%' and nspname not in ('information_schema','auth','storage','realtime','extensions','graphql','graphql_public','vault','net','supabase_functions','supabase_migrations','public','cron','pgmq')),'[]'::json) as unexpected_schemas,
  coalesce((select json_agg(format('%I.%I:%s',n.nspname,c.relname,t.tgname) order by n.nspname,c.relname,t.tgname) from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','private')),'[]'::json) as user_triggers,
  coalesce((select json_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename) from pg_catalog.pg_publication_tables where pubname='supabase_realtime'),'[]'::json) as realtime_publication_tables`;

async function inventory() {
	const [project, organization, addons, migrations, auth, rows] = await Promise.all([
		api(`/v1/projects/${TARGET.projectRef}`),
		api(`/v1/organizations/${TARGET.organizationId}`),
		api(`/v1/projects/${TARGET.projectRef}/billing/addons`),
		api(`/v1/projects/${TARGET.projectRef}/database/migrations`),
		api(`/v1/projects/${TARGET.projectRef}/config/auth`),
		api(`/v1/projects/${TARGET.projectRef}/database/query/read-only`, { method: 'POST', body: JSON.stringify({ query: EMPTY_INVENTORY_SQL }) })
	]);
	const counts = rows[0];
	let applicationRows = { profiles: 0, memberships: 0, consents: 0 };
	let catalog = { brands: 0, aliases: 0, memberships: 0 };
	let definitionFingerprints = null;
	let applicationTableCounts = null;
	if (migrations.length > 0) {
		const migrated = await api(`/v1/projects/${TARGET.projectRef}/database/query/read-only`, {
			method: 'POST',
			body: JSON.stringify({ query: 'select (select count(*) from public.profiles)::int profiles,(select count(*) from public.beta_memberships)::int memberships,(select count(*) from public.beta_consent_events)::int consents,(select count(*) from public.brands)::int brands,(select count(*) from public.brand_aliases)::int aliases,(select count(*) from public.brand_collection_memberships)::int catalog_memberships' })
		});
		applicationRows = { profiles: migrated[0].profiles, memberships: migrated[0].memberships, consents: migrated[0].consents };
		catalog = { brands: migrated[0].brands, aliases: migrated[0].aliases, memberships: migrated[0].catalog_memberships };
		const fingerprintRows = await api(`/v1/projects/${TARGET.projectRef}/database/query/read-only`, {
			method: 'POST',
			body: JSON.stringify({ query: readFileSync(join(packageRoot, 'definition-fingerprints.sql'), 'utf8') })
		});
		const fingerprint = fingerprintRows[0];
		definitionFingerprints = {
			relationsSha256: fingerprint.relations_sha256,
			typesSha256: fingerprint.types_sha256,
			functionsSha256: fingerprint.functions_sha256,
			policiesSha256: fingerprint.policies_sha256,
			triggersSha256: fingerprint.triggers_sha256,
			catalogSha256: fingerprint.catalog_sha256
		};
		applicationTableCounts = fingerprint.application_table_counts.map((entry) => ({ table: entry.table, rows: Number(entry.rows) }));
	}
	const value = {
		projectRef: project.ref,
		organizationId: project.organization_id,
		region: project.region,
		status: project.status,
		organizationPlan: organization.plan,
		selectedAddons: addons.selected_addons,
		authUsers: counts.auth_users,
		buckets: counts.buckets,
		bucketDefinitions: counts.bucket_definitions,
		objects: counts.objects,
		hostedMigrations: migrations,
		publicRelations: counts.public_relations,
		publicFunctions: counts.public_functions,
		publicPolicies: counts.public_policies,
		privateSchemaExists: counts.private_schema_exists,
		unexpectedSchemas: counts.unexpected_schemas,
		userTriggers: counts.user_triggers,
		realtimePublicationTables: counts.realtime_publication_tables,
		applicationRows,
		catalog,
		definitionFingerprints,
		applicationTableCounts,
		signupDisabled: auth.disable_signup === true
	};
	return { ...value, ...assertSafeInventory(value, expectedVersions, manifest.migrated_inventory) };
}

async function assertPostMigrationList() {
	const migrations = await api(`/v1/projects/${TARGET.projectRef}/database/migrations`);
	const versions = migrations.map((entry) => String(entry.version));
	if (JSON.stringify(versions) !== JSON.stringify(expectedVersions)) stop('post-push hosted migration list differs from exact reviewed chain');
}

async function seedAndAttestCatalog() {
	assertStaticInputs();
	if (!providedServerKey || providedServerKey.length < 20) stop('exact-target server key unavailable for catalogue seed');
	let serverKey = providedServerKey;
	try {
		const result = await seedCatalog({
			projectUrl: `https://${TARGET.projectRef}.supabase.co`,
			serviceRoleKey: serverKey,
			logger: { log() {} }
		});
		assertCatalogCounts({ brands: result.brands, aliases: result.aliases, memberships: result.memberships });
		const rows = await api(`/v1/projects/${TARGET.projectRef}/database/query/read-only`, {
			method: 'POST',
			body: JSON.stringify({ query: 'select (select count(*) from public.brands)::int brands,(select count(*) from public.brand_aliases)::int aliases,(select count(*) from public.brand_collection_memberships)::int memberships' })
		});
		assertCatalogCounts(rows[0]);
	} finally {
		serverKey = null;
	}
}

async function attestExistingCatalog() {
	const rows = await api(`/v1/projects/${TARGET.projectRef}/database/query/read-only`, {
		method: 'POST',
		body: JSON.stringify({ query: 'select (select count(*) from public.brands)::int brands,(select count(*) from public.brand_aliases)::int aliases,(select count(*) from public.brand_collection_memberships)::int memberships' })
	});
	assertCatalogCounts(rows[0]);
}

if (process.argv[2] === '--self-test') {
	assertTrackedCandidate();
	assertSafeRuntimePath();
	console.log(JSON.stringify({ status: 'LOCAL_READY', projectRef: TARGET.projectRef, migrations: manifest.migrations.length, catalog: manifest.catalog_baseline }));
} else if (process.argv[2] === '--execute') {
	assertTrackedCandidate();
	assertSafeRuntimePath();
	const baseline = await inventory();
	const cleanupReceipt = existsSync(baselineAdoptionReceiptPath) ? JSON.parse(readFileSync(baselineAdoptionReceiptPath, 'utf8')) : null;
	const execution = decideMigrationExecution(baseline, cleanupReceipt, candidateSha, accessToken);
	if (execution === 'reuse') {
		await assertPostMigrationList();
		await attestExistingCatalog();
		console.log(JSON.stringify({ status: 'MIGRATED_BASELINE_REUSED', projectRef: TARGET.projectRef, versions: expectedVersions, catalog: manifest.catalog_baseline }));
	} else {
		if (existsSync(runtimeRoot)) rmSync(runtimeRoot, { recursive: true, force: false });
		mkdirSync(runtimeRoot, { recursive: true });
		materializeTrackedSupabase();
		assertManifestMatches(join(runtimeRoot, 'supabase', 'migrations'), manifest.migrations);
		const commands = fixedMigrationCommands(runtimeRoot);
		if (existsSync(projectRefPath())) stop('scratch link unexpectedly pre-exists');
		run('pnpm', commands[0]);
		assertLinkedTarget();
		assertManifestMatches(join(runtimeRoot, 'supabase', 'migrations'), manifest.migrations);
		await inventory();
		runLinkedCommand(commands[1], assertLinkedTarget, (args) => run('pnpm', args));
		assertManifestMatches(join(runtimeRoot, 'supabase', 'migrations'), manifest.migrations);
		await inventory();
		runLinkedCommand(commands[2], assertLinkedTarget, (args) => run('pnpm', args));
		runLinkedCommand(commands[3], assertLinkedTarget, (args) => run('pnpm', args));
		await assertPostMigrationList();
		await seedAndAttestCatalog();
		console.log(JSON.stringify({ status: 'MIGRATED_AND_SEEDED', projectRef: TARGET.projectRef, versions: expectedVersions, catalog: manifest.catalog_baseline }));
	}
} else {
	stop('use --self-test or --execute');
}
