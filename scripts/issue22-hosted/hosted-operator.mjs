import { createHash, createHmac, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { seedCatalog } from '../seed-catalog.mjs';
import {
	OPERATOR_CAPACITY_BUDGET,
	assertAuthState,
	assertAuthConfiguration,
	assertCatalogCounts,
	assertCurrentCleanupReceipt,
	assertFinalStorageState,
	assertRecoveryAttribution,
	assertRunOwnedActor,
	assertSafeDisabledAuth,
	classifyExactWorkerProbe,
	clearAuthSafely,
	cleanupExactWorkerSecrets,
	fileReceipt,
	finalizeRecoveryArtifacts,
	fixedWorkerSecretCommands,
	resolveWidgetForCleanup,
	recoverCatalogForCleanup,
	runPriorityCleanup,
	selectBaselineCleanupReceipt,
	TARGET
} from './operator-lib.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '..', '..');
const privateRoot = join(root, 'private');
const recoveryPath = join(privateRoot, 'recovery-state.json');
const ledgerPath = join(privateRoot, 'run-ledger.ndjson');
const generatedConfig = join(privateRoot, 'wrangler.issue22.generated.json');
const playwrightOutput = join(privateRoot, 'playwright-output');
const cleanupReceiptPath = join(repo, '.superpowers', 'issue22-hosted-new-target', 'cleanup-receipt.json');
const baselineAdoptionReceiptPath = join(repo, '.superpowers', 'issue22-hosted-new-target', 'baseline-adoption-receipt.json');
const baseConfig = join(root, 'wrangler.issue22.jsonc');
const rollbackConfig = join(root, 'wrangler.issue22.rollback.jsonc');
const operatorManifest = JSON.parse(readFileSync(join(root, 'operator-manifest.json'), 'utf8'));
const expectedMigrationVersions = operatorManifest.migrations.map(({ file }) => file.split('_', 1)[0]);
const candidateSha = process.env.ISSUE22_CANDIDATE_SHA?.trim();
const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const origin = `https://${TARGET.workerHostname}`;
const supabaseUrl = `https://${TARGET.projectRef}.supabase.co`;
const publishableKey = 'sb_publishable_1imlAP3Eanrj-jXL1bpcTQ_rVKnHXUy';
const MAX_CLEANUP_ATTEMPTS = 3;
const MAX_SYNTHETIC_WORKER_REQUESTS = OPERATOR_CAPACITY_BUDGET.totalRequests;
const MAX_SYNTHETIC_WORKER_CPU_MS = OPERATOR_CAPACITY_BUDGET.totalCpuMs;

let ethereal = null;
let serverKey = null;
let completed = false;

function stop(message) { throw new Error(`HOSTED STOP: ${message}`); }

function assertCandidateClean() {
	if (run('git', ['rev-parse', 'HEAD'], { capture: true }).trim() !== candidateSha) stop('candidate SHA differs from HEAD');
	if (run('git', ['status', '--porcelain', '--untracked-files=no'], { capture: true }).trim() !== '') stop('tracked worktree/index differs from candidate');
}

function assertLiveCapacityNow() {
	const receipt = JSON.parse(run('node', [join(root, 'cloudflare-live-capacity.mjs')], {
		capture: true,
		env: { CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ?? '' }
	}));
	if (
		receipt.accountId !== TARGET.cloudflareAccountId ||
		receipt.executionPlan !== 'workers_free' ||
		receipt.operatorBudget?.totalRequests !== MAX_SYNTHETIC_WORKER_REQUESTS ||
		receipt.operatorBudget?.totalCpuMs !== MAX_SYNTHETIC_WORKER_CPU_MS ||
		receipt.operatorBudget?.maxCpuMsPerInvocation !== 10 ||
		receipt.operatorBudget?.maxSubrequestsPerInvocation !== 50 ||
		receipt.remainingDailyRequests < MAX_SYNTHETIC_WORKER_REQUESTS ||
		receipt.remainingMonthlyRequests < MAX_SYNTHETIC_WORKER_REQUESTS ||
		receipt.remainingMonthlyCpuMs < MAX_SYNTHETIC_WORKER_CPU_MS
	) stop('live Cloudflare capacity receipt mismatch');
}

function childEnv(extra = {}) {
	const keys = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME', 'COMSPEC'];
	const environment = { NO_COLOR: '1' };
	for (const key of keys) if (process.env[key]) environment[key] = process.env[key];
	return { ...environment, ...extra };
}

function run(command, args, { capture = false, input, env = {} } = {}) {
	const pnpmEntry = join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'pnpm.js');
	const executable = command === 'pnpm' ? process.execPath : command;
	const actualArgs = command === 'pnpm' ? [pnpmEntry, ...args] : args;
	const result = spawnSync(executable, actualArgs, {
		cwd: repo,
		encoding: 'utf8',
		input,
		env: childEnv(env),
		stdio: capture ? ['pipe', 'pipe', 'pipe'] : 'inherit'
	});
	if (result.status !== 0) stop(`${command} command failed without sensitive provider output`);
	return result.stdout ?? '';
}

async function api(path, init = {}) {
	if (!/^sbp_/u.test(accessToken ?? '')) stop('Supabase access token unavailable');
	const response = await fetch(`https://api.supabase.com${path}`, {
		...init,
		headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...init.headers }
	});
	if (!response.ok) stop(`Management API ${path} returned HTTP ${response.status}`);
	return response.json();
}

async function patchAuth(body) {
	return api(`/v1/projects/${TARGET.projectRef}/config/auth`, { method: 'PATCH', body: JSON.stringify(body) });
}

async function authUpdateSchema() {
	const response = await fetch('https://api.supabase.com/api/v1-json');
	if (!response.ok) stop(`Supabase OpenAPI returned HTTP ${response.status}`);
	return response.json();
}

async function exactWorkerState() {
	const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
	if (!token || token.length < 20) stop('Cloudflare bearer unavailable for Worker probe');
	const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${TARGET.cloudflareAccountId}/workers/scripts/${TARGET.workerName}`, {
		headers: { authorization: `Bearer ${token}` }
	});
	return classifyExactWorkerProbe({
		accountId: TARGET.cloudflareAccountId,
		workerName: TARGET.workerName,
		status: response.status
	});
}

async function fetchServerKey() {
	const keys = await api(`/v1/projects/${TARGET.projectRef}/api-keys?reveal=true`);
	const key = keys.find((item) => item.type === 'secret' && item.name === 'default') ?? keys.find((item) => item.name === 'service_role');
	if (!key?.api_key) stop('exact-target server key unavailable');
	return key.api_key;
}

function readRecovery() {
	return existsSync(recoveryPath) ? JSON.parse(readFileSync(recoveryPath, 'utf8')) : null;
}

function writeRecovery(value) {
	mkdirSync(privateRoot, { recursive: true });
	const temporary = `${recoveryPath}.tmp`;
	writeFileSync(temporary, JSON.stringify(value, null, 2));
	renameSync(temporary, recoveryPath);
}

function updateRecovery(patch) {
	const current = readRecovery();
	if (!current) stop('recovery state is missing');
	writeRecovery({ ...current, ...patch, updatedAt: new Date().toISOString() });
}

function authenticated(domain, core) {
	if (!/^sbp_/u.test(accessToken ?? '') || accessToken.length < 24) stop('receipt authentication key is unavailable');
	return { ...core, payloadMac: createHmac('sha256', accessToken).update(`${domain}\0${JSON.stringify(core)}`).digest('hex') };
}

function writeJsonAtomic(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp`;
	writeFileSync(temporary, JSON.stringify(value, null, 2));
	renameSync(temporary, path);
}

function predecessorEvidence() {
	return {
		predecessorSha: operatorManifest.known_failed_recovery.predecessor_sha,
		recoverySha256: operatorManifest.known_failed_recovery.recovery_sha256,
		generatedConfigSha256: operatorManifest.known_failed_recovery.generated_config_sha256,
		runId: operatorManifest.known_failed_recovery.run_id,
		ledgerSha256: null
	};
}

function beginRecovery() {
	if (existsSync(recoveryPath) || existsSync(ledgerPath) || existsSync(generatedConfig)) {
		stop('prior recovery state exists; run hosted-cleanup before a new execution');
	}
	const runId = randomUUID();
	const widgetIntent = {
		name: `aromatika-issue22-${runId.slice(0, 12)}`,
		domain: TARGET.workerHostname
	};
	writeRecovery({
		version: 1,
		candidateSha,
		projectRef: TARGET.projectRef,
		cloudflareAccountId: TARGET.cloudflareAccountId,
		workerName: TARGET.workerName,
		runId,
		widgetIntent,
		createdAt: new Date().toISOString()
	});
	return widgetIntent;
}

function listWidgets() {
	return JSON.parse(run('pnpm', ['exec', 'wrangler', 'turnstile', 'widget', 'list', '--json', '--config', baseConfig], { capture: true }));
}

function createWidget(intent) {
	const output = run('pnpm', [
		'exec', 'wrangler', 'turnstile', 'widget', 'create', intent.name,
		'--domain', intent.domain,
		'--mode', 'managed',
		'--clearance-level', 'no_clearance',
		'--region', 'world',
		'--json',
		'--config', baseConfig
	], { capture: true });
	const value = JSON.parse(output);
	if (
		value.name !== intent.name ||
		value.mode !== 'managed' ||
		value.clearance_level !== 'no_clearance' ||
		value.region !== 'world' ||
		!value.domains?.includes(intent.domain) ||
		!value.sitekey ||
		!value.secret
	) stop('created Turnstile widget attestation mismatch');
	updateRecovery({ widgetSitekey: value.sitekey });
	return value;
}

async function publicSettings() {
	const response = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: publishableKey } });
	if (!response.ok) stop(`public Auth settings returned HTTP ${response.status}`);
	return response.json();
}

async function quiesceAuthBoundary() {
	const state = await patchAuth({ disable_signup: true });
	if (state.disable_signup !== true) stop('Auth signup did not quiesce');
	for (let attempt = 1; attempt <= 10; attempt += 1) {
		if ((await publicSettings()).disable_signup === true) {
			updateRecovery({ authQuiescedAt: new Date().toISOString() });
			return;
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
	}
	stop('public Auth signup did not quiesce');
}

async function attestOpenProvider(widget, expectedAuthConfig) {
	const [auth, settings] = await Promise.all([
		api(`/v1/projects/${TARGET.projectRef}/config/auth`),
		publicSettings()
	]);
	assertAuthState(auth, settings, { open: true, captcha: true });
	assertAuthConfiguration(auth, expectedAuthConfig);
	const details = JSON.parse(run('pnpm', ['exec', 'wrangler', 'turnstile', 'widget', 'get', widget.sitekey, '--json', '--config', baseConfig], { capture: true }));
	if (
		details.name !== widget.name ||
		details.mode !== 'managed' ||
		details.clearance_level !== 'no_clearance' ||
		details.region !== 'world' ||
		!details.domains?.includes(TARGET.workerHostname)
	) stop('live Turnstile widget drift');
}

async function cleanupUsers() {
	if (!existsSync(ledgerPath)) return;
	if (!serverKey) serverKey = await fetchServerKey();
	const admin = createClient(supabaseUrl, serverKey, { auth: { persistSession: false, autoRefreshToken: false } });
	const events = readFileSync(ledgerPath, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
	const intents = events.filter((event) => event.event === 'create_intent');
	const bound = events.filter((event) => event.event === 'actor_bound');
	const migrationCount = (await api(`/v1/projects/${TARGET.projectRef}/database/migrations`)).length;
	for (const intent of intents) {
		let record = bound.find((event) => event.label === intent.label);
		if (!record) {
			const page = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
			if (page.error) stop('cleanup user inventory failed');
			const matches = (page.data?.users ?? []).filter((user) => user.email === intent.email && user.user_metadata?.username === intent.username);
			if (matches.length === 0) continue;
			if (matches.length !== 1) stop('ambiguous cleanup actor');
			record = { ...intent, userId: matches[0].id };
		}
		const found = await admin.auth.admin.getUserById(record.userId);
		if (found.error || !found.data.user) {
			const absent = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
			if (!absent.error && !(absent.data?.users ?? []).some((user) => user.id === record.userId)) continue;
			stop('cleanup actor lookup failed');
		}
		assertRunOwnedActor(record, found.data.user);
		const deleted = await admin.auth.admin.deleteUser(record.userId);
		if (deleted.error) stop('exact run-owned Auth deletion failed');
		if (migrationCount === expectedMigrationVersions.length) {
			for (const table of ['profiles', 'beta_memberships', 'beta_consent_events']) {
				const column = table === 'profiles' ? 'id' : 'profile_id';
				const remaining = await admin.from(table).select(column, { count: 'exact', head: true }).eq(column, record.userId);
				if (remaining.error || remaining.count !== 0) stop('run-owned cascade cleanup was not proven');
			}
		}
	}
}

async function readCatalogCounts() {
	const rows = await api(`/v1/projects/${TARGET.projectRef}/database/query/read-only`, {
		method: 'POST',
		body: JSON.stringify({ query: 'select (select count(*) from public.brands)::int brands,(select count(*) from public.brand_aliases)::int aliases,(select count(*) from public.brand_collection_memberships)::int memberships' })
	});
	return rows[0];
}

async function recoverCanonicalCatalog() {
	const migrations = await api(`/v1/projects/${TARGET.projectRef}/database/migrations`);
	const actualVersions = migrations.map((entry) => String(entry.version));
	if (actualVersions.length === 0) return;
	const currentCounts = await readCatalogCounts();
	await recoverCatalogForCleanup({
		actualVersions,
		expectedVersions: expectedMigrationVersions,
		currentCounts,
		seed: async () => {
			if (!serverKey) serverKey = await fetchServerKey();
			return seedCatalog({ projectUrl: supabaseUrl, serviceRoleKey: serverKey, logger: { log() {} } });
		},
		attest: readCatalogCounts
	});
}

async function disableAuth() {
	await clearAuthSafely({
		patch: patchAuth,
		publicSettings,
		getSchema: authUpdateSchema,
		getAuth: () => api(`/v1/projects/${TARGET.projectRef}/config/auth`)
	});
}

function deployRollbackArtifact() {
	run('pnpm', ['exec', 'wrangler', 'deploy', '--config', rollbackConfig, '--var', `ROLLBACK_SOURCE_GIT_SHA:${candidateSha}`]);
}

function smokeRollback() {
	run('node', [join(root, 'smoke.mjs'), 'rollback'], { env: { ISSUE22_CANDIDATE_SHA: candidateSha } });
}

function deployRollback() {
	deployRollbackArtifact();
	smokeRollback();
}

async function cleanupSecrets() {
	const config = existsSync(generatedConfig) ? generatedConfig : baseConfig;
	const commands = fixedWorkerSecretCommands(config);
	await cleanupExactWorkerSecrets({
		probe: exactWorkerState,
		list: async () => JSON.parse(run('pnpm', commands.list, { capture: true })),
		remove: async (name) => run('pnpm', commands.delete(name), { capture: true, input: 'y\n' })
	});
}

function cleanupWidget() {
	const recovery = readRecovery();
	if (!recovery?.widgetIntent) return;
	const widgets = listWidgets();
	const bySitekey = recovery.widgetSitekey ? widgets.find((item) => item.sitekey === recovery.widgetSitekey) : null;
	const widget = bySitekey ?? resolveWidgetForCleanup(recovery.widgetIntent, widgets);
	if (widget) run('pnpm', ['exec', 'wrangler', 'turnstile', 'widget', 'delete', widget.sitekey, '--skip-confirmation', '--json', '--config', baseConfig], { capture: true });
	if (resolveWidgetForCleanup(recovery.widgetIntent, listWidgets())) stop('Turnstile widget remains after cleanup');
}

async function attestFinalState() {
	const [auth, settings, migrations, rows] = await Promise.all([
		api(`/v1/projects/${TARGET.projectRef}/config/auth`),
		publicSettings(),
		api(`/v1/projects/${TARGET.projectRef}/database/migrations`),
		api(`/v1/projects/${TARGET.projectRef}/database/query/read-only`, {
			method: 'POST',
			body: JSON.stringify({ query: "select (select count(*) from auth.users)::int auth_users,(select count(*) from storage.objects)::int objects,coalesce((select json_agg(json_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) order by id) from storage.buckets),'[]'::json) buckets" })
		})
	]);
	assertSafeDisabledAuth(auth, settings);
	if (rows[0].auth_users !== 0) stop('final Auth user inventory is not empty');
	if (migrations.length === 0) {
		if (rows[0].buckets.length !== 0 || rows[0].objects !== 0) stop('unmigrated target Storage inventory is not empty');
	} else {
		assertFinalStorageState(rows[0].buckets, rows[0].objects);
	}
	const actualVersions = migrations.map((entry) => String(entry.version));
	if (actualVersions.length !== 0 && JSON.stringify(actualVersions) !== JSON.stringify(expectedMigrationVersions)) stop('partial migration chain requires recovery');
	if (migrations.length === expectedMigrationVersions.length) {
		const application = await api(`/v1/projects/${TARGET.projectRef}/database/query/read-only`, {
			method: 'POST',
			body: JSON.stringify({ query: 'select (select count(*) from public.profiles)::int profiles,(select count(*) from public.beta_memberships)::int memberships,(select count(*) from public.beta_consent_events)::int consents,(select count(*) from public.brands)::int brands,(select count(*) from public.brand_aliases)::int aliases,(select count(*) from public.brand_collection_memberships)::int catalog_memberships' })
		});
		if (application[0].profiles !== 0 || application[0].memberships !== 0 || application[0].consents !== 0) stop('final run-owned application rows remain');
		assertCatalogCounts({ brands: application[0].brands, aliases: application[0].aliases, memberships: application[0].catalog_memberships });
		const fingerprintRows = await api(`/v1/projects/${TARGET.projectRef}/database/query/read-only`, {
			method: 'POST',
			body: JSON.stringify({ query: readFileSync(join(root, 'definition-fingerprints.sql'), 'utf8') })
		});
		const fingerprint = fingerprintRows[0];
		const actualFingerprints = {
			relationsSha256: fingerprint.relations_sha256,
			typesSha256: fingerprint.types_sha256,
			functionsSha256: fingerprint.functions_sha256,
			policiesSha256: fingerprint.policies_sha256,
			triggersSha256: fingerprint.triggers_sha256,
			catalogSha256: fingerprint.catalog_sha256
		};
		if (JSON.stringify(actualFingerprints) !== JSON.stringify(operatorManifest.migrated_inventory.definition_fingerprints)) {
			stop('final database definition/content fingerprint mismatch');
		}
		const applicationTableCounts = fingerprint.application_table_counts.map((entry) => ({ table: entry.table, rows: Number(entry.rows) }));
		if (
			JSON.stringify(applicationTableCounts) !== JSON.stringify(operatorManifest.migrated_inventory.application_table_counts) ||
			applicationTableCounts.some((entry) => entry.rows !== 0)
		) stop('final application-table inventory differs or contains rows');
	}
	if (await exactWorkerState() === 'present') {
		const commands = fixedWorkerSecretCommands(existsSync(generatedConfig) ? generatedConfig : baseConfig);
		if (JSON.parse(run('pnpm', commands.list, { capture: true })).length !== 0) stop('Worker secret list is not empty');
	}
	const recovery = readRecovery();
	if (recovery?.widgetIntent && resolveWidgetForCleanup(recovery.widgetIntent, listWidgets())) stop('Turnstile widget remains after final cleanup');
}

async function deleteRecovery(attribution) {
	const recovery = readRecovery();
	if (!recovery) stop('recovery state disappeared before local cleanup');
	const retainedLedger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : recovery.retainedLedger ?? null;
	const retainedGeneratedConfig = existsSync(generatedConfig) ? readFileSync(generatedConfig, 'utf8') : recovery.retainedGeneratedConfig ?? null;
	const ledgerHash = retainedLedger ? createHash('sha256').update(retainedLedger).digest('hex') : null;
	if (attribution.adopted && ledgerHash !== null) stop('adopted predecessor ledger is unexpectedly nonempty');
	const cleanupProvenAt = new Date().toISOString();
	const existingBaselineReceipt = existsSync(baselineAdoptionReceiptPath) ? JSON.parse(readFileSync(baselineAdoptionReceiptPath, 'utf8')) : null;
	const predecessorEvidenceMac = attribution.adopted
		? authenticated('issue22:recovery-adoption:v1', predecessorEvidence()).payloadMac
		: null;
	ethereal = null;
	serverKey = null;
	await finalizeRecoveryArtifacts({
		sealRecovery: async () => updateRecovery({
			candidateSha,
			adoptedPredecessorSha: attribution.adopted ? attribution.predecessorSha : null,
			adoptedRecoverySha256: attribution.adopted ? attribution.recoverySha256 : null,
			adoptedGeneratedConfigSha256: attribution.adopted ? attribution.generatedConfigSha256 : null,
			sealedFinalState: true,
			predecessorEvidenceMac,
			cleanupFinalStateProvenAt: cleanupProvenAt,
			retainedLedger,
			retainedGeneratedConfig
		}),
		writeReceipt: async () => {
			const finalState = {
				etherealCredentialPersisted: false,
				maxSyntheticWorkerRequests: MAX_SYNTHETIC_WORKER_REQUESTS,
				maxSyntheticWorkerCpuMs: MAX_SYNTHETIC_WORKER_CPU_MS,
				finalAuthDisabled: true,
				finalAuthUsers: 0,
				finalApplicationRows: 0,
				finalStorageBuckets: 4,
				finalStorageObjects: 0,
				finalWorkerSecrets: 0,
				finalWidgetAbsent: true,
				finalMigrationCount: 18,
				finalCatalog: operatorManifest.catalog_baseline
			};
			const authenticatedAdoption = attribution.adopted ? authenticated('issue22:baseline-adoption:v1', {
				receiptVersion: 2,
				receiptKind: 'baseline-adoption',
				at: cleanupProvenAt,
				candidateSha,
				projectRef: TARGET.projectRef,
				cloudflareAccountId: TARGET.cloudflareAccountId,
				worker: TARGET.workerName,
				runId: recovery.runId,
				ledgerHash,
				finalStateProven: true,
				adoptedPredecessorSha: attribution.predecessorSha,
				adoptedRecoverySha256: attribution.recoverySha256,
				adoptedGeneratedConfigSha256: attribution.generatedConfigSha256,
				predecessorEvidenceMac,
				...finalState
			}) : null;
			const baselineReceipt = selectBaselineCleanupReceipt({
				existing: existingBaselineReceipt,
				authenticatedAdoption,
				attribution,
				candidateSha,
				authenticationKey: accessToken
			});
			if (attribution.adopted && !existingBaselineReceipt) {
				writeJsonAtomic(baselineAdoptionReceiptPath, baselineReceipt);
			}
			const currentReceipt = authenticated('issue22:current-run-cleanup:v1', {
				receiptVersion: 2,
				receiptKind: 'current-run-cleanup',
				at: cleanupProvenAt,
				candidateSha,
				projectRef: TARGET.projectRef,
				cloudflareAccountId: TARGET.cloudflareAccountId,
				worker: TARGET.workerName,
				runId: recovery.runId,
				ledgerHash,
				finalStateProven: true,
				...finalState
			});
			writeJsonAtomic(cleanupReceiptPath, currentReceipt);
			assertCurrentCleanupReceipt(JSON.parse(readFileSync(cleanupReceiptPath, 'utf8')), candidateSha, recovery.runId, accessToken);
		},
		deleteArtifacts: async () => {
			if (existsSync(playwrightOutput)) rmSync(playwrightOutput, { recursive: true, force: true });
			if (existsSync(generatedConfig)) rmSync(generatedConfig, { force: true });
			if (existsSync(ledgerPath)) rmSync(ledgerPath, { force: true });
		},
		deleteRecovery: async () => rmSync(recoveryPath, { force: true })
	});
}

async function finalCleanup() {
	assertCandidateClean();
	const recovery = readRecovery();
	const retainedGeneratedConfigHash = typeof recovery?.retainedGeneratedConfig === 'string'
		? createHash('sha256').update(recovery.retainedGeneratedConfig).digest('hex')
		: null;
	const attribution = assertRecoveryAttribution(recovery, candidateSha, {
		recoverySha256: fileReceipt(recoveryPath).sha256,
		generatedConfigSha256: existsSync(generatedConfig) ? fileReceipt(generatedConfig).sha256 : retainedGeneratedConfigHash,
		authenticationKey: accessToken
	});
	const result = await runPriorityCleanup({
		disable: disableAuth,
		rollbackDeploy: async () => deployRollbackArtifact(),
		capacity: async () => assertLiveCapacityNow(),
		rollbackSmoke: async () => smokeRollback(),
		recoverCatalog: recoverCanonicalCatalog,
		cleanupData: cleanupUsers,
		cleanupSecrets: async () => cleanupSecrets(),
		cleanupWidget: async () => cleanupWidget(),
		attestFinal: attestFinalState,
		deleteRecovery: async () => deleteRecovery(attribution)
	}, MAX_CLEANUP_ATTEMPTS);
	ethereal = null;
	serverKey = null;
	if (result.failures.length > 0) stop(`cleanup incomplete; recovery state retained: ${result.failures.join(',')}`);
}

async function execute() {
	if (!/^[0-9a-f]{40}$/u.test(candidateSha ?? '')) stop('candidate SHA missing');
	assertCandidateClean();
	assertLiveCapacityNow();
	const widgetIntent = beginRecovery();
	await quiesceAuthBoundary();
	run('pnpm', ['install', '--dir', join(root, 'mailbox-runtime'), '--frozen-lockfile', '--ignore-scripts', '--ignore-workspace']);
	const nodemailer = await import(pathToFileURL(join(root, 'mailbox-runtime', 'node_modules', 'nodemailer', 'lib', 'nodemailer.js')).href);
	ethereal = await nodemailer.createTestAccount();
	if (!ethereal?.user || !ethereal?.pass) stop('Ethereal account creation failed');
	const widget = createWidget(widgetIntent);
	const base = readFileSync(baseConfig, 'utf8');
	if (!base.includes('__ISSUE22_TURNSTILE_SITE_KEY__')) stop('unmaterialized config marker missing');
	writeFileSync(generatedConfig, base.replace('__ISSUE22_TURNSTILE_SITE_KEY__', widget.sitekey));
	const authTemplate = JSON.parse(readFileSync(join(root, 'auth-config.template.json'), 'utf8'));
	authTemplate.security_captcha_secret = widget.secret;
	authTemplate.smtp_admin_email = ethereal.user;
	authTemplate.smtp_user = ethereal.user;
	authTemplate.smtp_pass = ethereal.pass;
	const configuredAuth = await patchAuth(authTemplate);
	assertAuthConfiguration(configuredAuth, authTemplate);
	assertAuthState(configuredAuth, await publicSettings(), { open: false, captcha: true });
	serverKey = await fetchServerKey();
	run('node', [join(root, 'migration-runner.mjs'), '--execute'], { env: { SUPABASE_ACCESS_TOKEN: accessToken, ISSUE22_CANDIDATE_SHA: candidateSha, ISSUE22_SERVER_KEY: serverKey } });
	assertCandidateClean();
	run('pnpm', ['exec', 'vite', 'build']);
	deployRollback();
	run('pnpm', ['exec', 'wrangler', 'secret', 'put', 'SUPABASE_SECRET_KEY', '--name', TARGET.workerName, '--config', generatedConfig], { capture: true, input: `${serverKey}\n` });
	run('pnpm', ['exec', 'wrangler', 'secret', 'put', 'TURNSTILE_SECRET_KEY', '--name', TARGET.workerName, '--config', generatedConfig], { capture: true, input: `${widget.secret}\n` });
	run('pnpm', ['exec', 'wrangler', 'deploy', '--config', generatedConfig]);
	run('node', [join(root, 'smoke.mjs'), 'candidate'], { env: { ISSUE22_CANDIDATE_SHA: candidateSha } });
	await patchAuth({ disable_signup: false });
	await attestOpenProvider(widget, authTemplate);
	run('pnpm', ['exec', 'playwright', 'test', '--config', join(root, 'playwright.hosted.config.ts')], {
		env: { ISSUE22_LEDGER_PATH: ledgerPath, ETHEREAL_USER: ethereal.user, ETHEREAL_PASS: ethereal.pass }
	});
	completed = true;
}

if (process.argv[2] === '--self-test') {
	run('pnpm', ['exec', 'vitest', 'run', 'tests/scripts/issue22-hosted-operator.test.ts']);
	run('pnpm', ['exec', 'playwright', 'test', '--config', join(root, 'playwright.hosted.config.ts'), '--list'], {
		env: { ISSUE22_LEDGER_PATH: join(privateRoot, 'list-only'), ETHEREAL_USER: 'list-only', ETHEREAL_PASS: 'list-only' }
	});
	console.log(JSON.stringify({ status: 'HOSTED_LOCAL_READY', target: TARGET.projectRef, account: TARGET.cloudflareAccountId, maxSyntheticWorkerRequests: MAX_SYNTHETIC_WORKER_REQUESTS, maxSyntheticWorkerCpuMs: MAX_SYNTHETIC_WORKER_CPU_MS }));
} else if (process.argv[2] === '--execute') {
	try {
		await execute();
	} finally {
		if (readRecovery()) await finalCleanup();
	}
	if (!completed) stop('hosted journey did not complete');
	console.log(JSON.stringify({ status: 'HOSTED_VERIFIED_AND_CLEANED', projectRef: TARGET.projectRef, candidateSha }));
} else if (process.argv[2] === '--cleanup') {
	if (!readRecovery()) stop('no retained recovery state exists');
	await finalCleanup();
	console.log(JSON.stringify({ status: 'HOSTED_CLEANED', projectRef: TARGET.projectRef, candidateSha }));
} else {
	stop('use --self-test, --execute, or --cleanup');
}
