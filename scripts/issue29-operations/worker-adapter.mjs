import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, readdir, realpath, unlink, cp, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { assertPrivatePath, ensure, OperationsError, validateManifest, readPrivateManifest, writePrivateManifest } from './manifest.mjs';
import { canonicalJson } from './recovery-set.mjs';
import {persistOperationsIntent,persistOperationsEvidence} from './operator.mjs';
import { attestCandidateWorktree, validateWranglerConfig as validateIssue22Config } from '../issue22-hosted/candidate.mjs';
const execFile = promisify(execFileCallback);
export const WRANGLER_VERSION = '4.120.0';
const hash = z.string().regex(/^[a-f0-9]{64}$/u), token = z.string().min(32).max(4096).regex(/^[!-~]+$/u);
const settingsSchema = z.strictObject({ accountId: z.string().regex(/^[a-f0-9]{32}$/u), subdomain: z.string().regex(/^[a-z0-9-]{1,63}$/u), purpose: z.enum(['source', 'target']), publishableKey: z.string().regex(/^sb_publishable_[a-zA-Z0-9_-]+$/u), turnstileSiteKey: z.string().regex(/^0x4[A-Za-z0-9_-]+$/u), operations: z.strictObject({ migrationSha256: hash, schemaSha256: hash, sentinelSha256: hash, canaryExpectedUtc: z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u) }) });
/** @typedef {z.infer<typeof settingsSchema>} WorkerSettings */
/** @param {unknown} value */
function digest(value) { return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalJson(value)).digest('hex'); }
/** @param {import('./manifest.mjs').OperationsManifest} manifest @param {'source'|'target'} purpose @param {boolean} [allowRetired] */
function projectFor(manifest, purpose, allowRetired = false) {
    const project = purpose === 'source' ? manifest.source : manifest.target;
    ensure(project && !manifest.preservedRefs.includes(project.ref) && project.environment === (purpose === 'source' ? 'synthetic' : 'disposable'), 'PRESERVED_PROJECT_FORBIDDEN');
    ensure(manifest.cleanup.resources.some(r => r.provider === 'supabase' && r.id === project.ref && r.runId === manifest.runId && r.disposition === (purpose === 'source' ? 'persistent' : 'disposable') && (allowRetired || r.absentAt === null)), 'WORKER_PROJECT_OWNERSHIP_REQUIRED');
    if (!allowRetired && purpose === 'source') ensure(!manifest.maintenance || manifest.maintenance.phase === 'closed', 'SOURCE_MAINTENANCE_ACTIVE');
    if (!allowRetired && purpose === 'target')
        ensure(['storage_restored', 'integrity_verified', 'incident_drill_verified'].includes(manifest.state), 'WORKER_TARGET_NOT_RESTORED');
    else if (!allowRetired)
        ensure(manifest.backupVerification?.sourceReadsComplete !== true || manifest.maintenance?.phase==='closed', 'SOURCE_READS_CLOSED');
    return project;
}
/** @param {import('./manifest.mjs').OperationsManifest} manifest @param {'source'|'target'} purpose */
export function workerNameFor(manifest, purpose) { return `issue29-${purpose === 'target' ? 'restore-' : ''}${purpose==='target'?(manifest.maintenance?.id??manifest.runId):manifest.runId}`; }
/** Derive one Issue29 config from the reviewed strict base; never change Issue22's original guard.
 * @param {{template:Record<string,any>,manifest:import('./manifest.mjs').OperationsManifest,settings:WorkerSettings,repositoryRoot:string,privateDirectory?:string,now?:string}} input */
export function createIssue29WorkerConfig(input) {
    const parsed = settingsSchema.safeParse(input.settings);
    ensure(parsed.success, 'WORKER_SETTINGS_INVALID');
    const s = parsed.data;
    const manifest = validateManifest(input.manifest, { now: input.now }), project = projectFor(manifest, s.purpose, true), name = workerNameFor(manifest, s.purpose), origin = `https://${name}.${s.subdomain}.workers.dev`;
    const config = structuredClone(input.template);
    ensure(Object.keys(config).sort().join(',') === '$schema,assets,compatibility_date,compatibility_flags,keep_vars,main,name,observability,vars,workers_dev', 'WORKER_BASE_TEMPLATE_DRIFT');
    ensure(config.main === '.svelte-kit/cloudflare/_worker.js' && config.assets?.directory === '.svelte-kit/cloudflare' && config.assets?.binding === 'ASSETS' && config.vars?.IMAGE_PROCESSOR_MODE === 'disabled' && config.vars?.PAYMENT_PROVIDER === 'disabled', 'WORKER_BASE_TEMPLATE_DRIFT');
    ensure(Object.keys(config.vars).sort().join(',') === 'APP_ENV,FEATURE_BILLING_ENABLED,FEATURE_BOOSTS_ENABLED,FEATURE_DIRECT_ADS_ENABLED,FEATURE_LISTING_FEES_ENABLED,FEATURE_MERCHANT_SUBSCRIPTIONS_ENABLED,FEATURE_MYPOS_PAYMENTS_ENABLED,FEATURE_STRIPE_FALLBACK_ENABLED,IMAGE_PROCESSOR_MODE,PAYMENT_PROVIDER,PUBLIC_APP_URL,PUBLIC_DEMO_MODE,PUBLIC_SUPABASE_PUBLISHABLE_KEY,PUBLIC_SUPABASE_URL,PUBLIC_TURNSTILE_SITE_KEY,RELEASE_COMMIT_SHA', 'WORKER_BASE_TEMPLATE_DRIFT');
    for (const [key, value] of Object.entries(config.vars))
        if (key.startsWith('FEATURE_'))
            ensure(value === 'false', 'WORKER_BILLING_FORBIDDEN');
    config.name = name;
    config.vars.RELEASE_COMMIT_SHA = manifest.candidate.sha;
    // Reuse the original strict safety validator before adding the narrowly selected Images binding.
    try {
        validateIssue22Config(config);
    }
    catch {
        throw new OperationsError('WORKER_BASE_TEMPLATE_DRIFT');
    }
    config.$schema = join(input.repositoryRoot, 'node_modules/wrangler/config-schema.json');
    config.account_id = s.accountId;
    const buildDirectory=input.privateDirectory?join(input.privateDirectory,`worker-${s.purpose}-build`):join(input.repositoryRoot,'.svelte-kit/cloudflare');
    config.main = join(buildDirectory, '_worker.js');
    config.assets.directory = buildDirectory;
    config.routes = [];
    config.triggers = { crons: [] };
    config.preview_urls = false;
    config.images = { binding: 'IMAGES' };
    Object.assign(config.vars, { PUBLIC_APP_URL: origin, PUBLIC_SUPABASE_URL: project.url, PUBLIC_SUPABASE_PUBLISHABLE_KEY: s.publishableKey, PUBLIC_TURNSTILE_SITE_KEY: s.turnstileSiteKey, TURNSTILE_EXPECTED_HOSTNAME: new URL(origin).hostname, PRIVATE_BETA_REQUIRE_STAFF_MFA: 'true', IMAGE_PROCESSOR_MODE: 'cloudflare-images', ISSUE29_RUN_ID: manifest.runId, ISSUE29_CANDIDATE_TREE: manifest.candidate.tree,
        OPERATIONS_EXPECTED_DEPLOYMENT_SHA: manifest.candidate.sha, OPERATIONS_EXPECTED_MIGRATION_DIGEST: s.operations.migrationSha256, OPERATIONS_EXPECTED_SCHEMA_DIGEST: s.operations.schemaSha256, OPERATIONS_SENTINEL_PATH: `${manifest.runId}/sentinel.bin`, OPERATIONS_SENTINEL_SHA256: s.operations.sentinelSha256, OPERATIONS_CANARY_EXPECTED_UTC: s.operations.canaryExpectedUtc, OPERATIONS_SAFETY_WARNING_HOURS: '24', OPERATIONS_SAFETY_CRITICAL_HOURS: '48' });
    ensure(!canonicalJson(config).includes('__ISSUE22_'), 'WORKER_BASE_TEMPLATE_DRIFT');
    return config;
}
/** @typedef {{manifest:import('./manifest.mjs').OperationsManifest,operationId:string}} WorkerContext */
/** @typedef {{settings:WorkerSettings,readToken:string,deployToken?:string,cleanupToken?:string,deployCapabilityId?:string,cleanupCapabilityId?:string,repositoryRoot:string,privateDirectory:string}} WorkerAdapterInput */
/** @typedef {{fetchImpl?:typeof fetch,now?:()=>string,execImpl?:typeof execFile}} WorkerDependencies */
/** Exact disposable Worker boundary. The parent persists intent in its ONE manifest; inspect
 * may run only before intent and mutations can run only after it. No automatic retries.
 * @param {WorkerAdapterInput} input @param {WorkerDependencies} [dependencies] */
export function createIssue29WorkerAdapter(input, dependencies = {}) {
    const parsed = settingsSchema.safeParse(input.settings);
    ensure(parsed.success, 'WORKER_SETTINGS_INVALID');
    const s = parsed.data;
    ensure(token.safeParse(input.readToken).success, 'WORKER_READ_CAPABILITY_INVALID');
    if (input.deployToken !== undefined || input.cleanupToken !== undefined) ensure([input.readToken, input.deployToken, input.cleanupToken].every(t => token.safeParse(t).success) && new Set([input.readToken, input.deployToken, input.cleanupToken]).size === 3, 'WORKER_CAPABILITIES_NOT_DISTINCT');
    const now = dependencies.now ?? (() => new Date().toISOString()), fetchImpl = dependencies.fetchImpl ?? fetch;
    const api = 'https://api.cloudflare.com/client/v4', root = `${api}/accounts/${s.accountId}`;
    let updatePreviousDirectory = '', inspectedAt = '', inspectedRun = '', mutationAttempted = false, cleanupInspectedAt = '', cleanupAttempted = false;
    /** @param {WorkerContext} context @param {boolean} [cleanup] */
    function bound(context, cleanup = false) { const manifest = validateManifest(context.manifest, { now: now() }); projectFor(manifest, s.purpose, cleanup); ensure(manifest.humanBoundary === null && manifest.terminal === null, 'TRANSACTION_TERMINAL'); return manifest; }
    /** @param {string} url @param {{method?:string,allowMissing?:boolean,cleanup?:boolean}} [options] @returns {Promise<Record<string,any>>} */
    async function request(url, options = {}) {
        try {
            const response = await fetchImpl(url, { method: options.method ?? 'GET', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${options.cleanup ? input.cleanupToken : input.readToken}` } });
            ensure(response.body, 'WORKER_PROVIDER_READBACK_INVALID');
            const reader = response.body.getReader();
            let size = 0;
            const chunks = [];
            try {
                for (;;) {
                    const result = await reader.read();
                    if (result.done)
                        break;
                    size += result.value.byteLength;
                    ensure(size <= 2097152, 'WORKER_PROVIDER_RESPONSE_LIMIT');
                    chunks.push(Buffer.from(result.value));
                }
            }
            finally {
                await reader.cancel();
                reader.releaseLock();
            }
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (options.allowMissing && response.status === 404 && Array.isArray(value.errors) && value.errors.some((/** @type {any} */ e) => e.code === 10007))
                return { absent: true };
            ensure(response.ok && value.success === true, 'WORKER_PROVIDER_READBACK_FAILED');
            return value;
        }
        catch (error) {
            if (error instanceof OperationsError)
                throw error;
            throw new OperationsError(options.method === 'DELETE' ? 'WORKER_MUTATION_UNCERTAIN_READBACK_ONLY' : 'WORKER_PROVIDER_READBACK_FAILED');
        }
    }
    /** @param {string} url @returns {Promise<Array<Record<string,any>>>} */
    async function completeList(url) {
        const values = [];
        for (let page = 1; page <= 100; page++) {
            const result = await request(`${url}${url.includes('?') ? '&' : '?'}per_page=50&page=${page}`);
            ensure(Array.isArray(result.result), 'WORKER_INVENTORY_INVALID');
            values.push(...result.result);
            const info = result.result_info;
            if (!info) {
                ensure(result.result.length < 50, 'WORKER_INVENTORY_TRUNCATED');
                return values;
            }
            ensure(typeof info === 'object' && !Array.isArray(info) && info.page === page && result.result.length <= 50, 'WORKER_INVENTORY_TRUNCATED');
            ensure(info.count === undefined || (Number.isSafeInteger(info.count) && info.count === result.result.length), 'WORKER_INVENTORY_TRUNCATED');
            ensure(info.per_page === undefined || info.per_page === 50, 'WORKER_INVENTORY_TRUNCATED');
            ensure(info.total_count === undefined || (Number.isSafeInteger(info.total_count) && info.total_count >= 0 && info.total_count <= 5000), 'WORKER_INVENTORY_TRUNCATED');
            // Cloudflare may omit total_pages while supplying the complete count/page contract.
            const totalPages = info.total_pages === undefined ? (info.per_page === 50 && info.total_count !== undefined ? Math.ceil(info.total_count / 50) : NaN) : info.total_pages;
            ensure(Number.isSafeInteger(totalPages) && totalPages >= 0 && totalPages <= 100, 'WORKER_INVENTORY_TRUNCATED');
            if (info.total_count !== undefined && info.per_page === 50)
                ensure(totalPages === Math.ceil(info.total_count / 50) || (info.total_count === 0 && totalPages === 1), 'WORKER_INVENTORY_TRUNCATED');
            ensure(page >= totalPages || result.result.length === 50, 'WORKER_INVENTORY_TRUNCATED');
            if (page >= totalPages) {
                ensure(info.total_count === undefined || info.total_count === values.length, 'WORKER_INVENTORY_TRUNCATED');
                return values;
            }
        }
        throw new OperationsError('WORKER_INVENTORY_TRUNCATED');
    }
    async function freeAccount() {
        const account = await request(root);
        ensure(account.result?.id === s.accountId, 'WORKER_ACCOUNT_MISMATCH');
        const subscriptions = await request(`${root}/subscriptions`);
        // Both products default to Free, and Images Free hard-fails rather than billing overage.
        // An empty authenticated account subscription inventory proves no paid product was selected.
        ensure(Array.isArray(subscriptions.result) && subscriptions.result.length === 0 && !subscriptions.result_info?.total_pages, 'WORKER_ZERO_COST_UNPROVEN');
        const subdomain = await request(`${root}/workers/subdomain`);
        ensure(subdomain.result?.subdomain === s.subdomain, 'WORKER_ACCOUNT_SUBDOMAIN_MISMATCH');
    }
    /** @param {string} workerName */
    async function noRoutes(workerName) {
        const domains = await completeList(`${root}/workers/domains`);
        ensure(domains.every(d => d.service !== workerName), 'WORKER_CUSTOM_DOMAIN_FORBIDDEN');
        const zones = await completeList(`${api}/zones?account.id=${s.accountId}`);
        for (const zone of zones) {
            ensure(/^[a-f0-9]{32}$/u.test(zone.id) && zone.account?.id === s.accountId, 'WORKER_ZONE_INVENTORY_INVALID');
            const routes = await completeList(`${api}/zones/${zone.id}/workers/routes`);
            ensure(routes.every(r => r.script !== workerName), 'WORKER_ROUTE_FORBIDDEN');
        }
    }
    /** @param {WorkerContext} context */
    async function inspect(context) {
        const manifest = bound(context);
        ensure(manifest.pending === null, 'PENDING_OPERATION_REQUIRES_READBACK');
        const name = workerNameFor(manifest, s.purpose);
        await freeAccount();
        await noRoutes(name);
        const scripts = await completeList(`${root}/workers/scripts`);
        ensure(scripts.every(w => w.id !== name), 'WORKER_ALREADY_EXISTS');
        ensure(!manifest.cleanup.resources.some(r => r.provider === 'cloudflare' && r.id === name && r.absentAt === null), 'WORKER_OWNERSHIP_COLLISION');
        inspectedAt = now();
        inspectedRun = manifest.runId;
        return { status: 'absent', workerName: name, purpose: s.purpose, checkedAt: inspectedAt, evidenceSha256: digest({ accountId: s.accountId, workerName: name, checkedAt: inspectedAt, subscriptions: [], routes: [] }) };
    }
    /** @param {WorkerContext} context */
    async function readback(context) {
        const manifest = bound(context, true), name = workerNameFor(manifest, s.purpose), script = `${root}/workers/scripts/${name}`;
        const deployments = await request(`${script}/deployments`), active = deployments.result?.deployments?.[0];
        ensure(active && Array.isArray(active.versions) && active.versions.length === 1 && active.versions[0].percentage === 100, 'WORKER_DEPLOYMENT_UNPROVEN');
        const versionId = active.versions[0].version_id;
        ensure(typeof versionId === 'string' && /^[a-f0-9-]{36}$/u.test(versionId), 'WORKER_VERSION_UNPROVEN');
        const version = (await request(`${script}/versions/${versionId}`)).result;
        const config = await readBoundConfig(manifest, s, input.repositoryRoot, input.privateDirectory, now());
        await freeAccount();
        const scriptSettings = (await request(`${script}/settings`)).result;
        ensure(scriptSettings?.observability?.enabled === false, 'WORKER_LOGGING_BOUNDARY_MISMATCH');
        ensure(version?.resources?.script?.compatibility_date === config.compatibility_date && canonicalJson(version.resources.script.compatibility_flags) === canonicalJson(config.compatibility_flags), 'WORKER_RUNTIME_CONFIG_MISMATCH');
        const bindings = version?.resources?.bindings;
        ensure(version?.id === versionId && Array.isArray(bindings), 'WORKER_VERSION_UNPROVEN');
        const actualPlain = Object.fromEntries(bindings.filter((/** @type {any} */ b) => b.type === 'plain_text').map((/** @type {any} */ b) => [b.name, b.text]));
        ensure(bindings.filter((/** @type {any} */ b) => b.type === 'plain_text').length === Object.keys(config.vars).length && canonicalJson(actualPlain) === canonicalJson(config.vars), 'WORKER_BINDING_MISMATCH');
        const secretNames = Object.keys(await readPrivateJson(join(input.privateDirectory, `worker-${s.purpose}.secrets.json`), input.repositoryRoot)).sort();
        ensure(canonicalJson(bindings.filter((/** @type {any} */ b) => b.type === 'secret_text').map((/** @type {any} */ b) => b.name).sort()) === canonicalJson(secretNames) && bindings.filter((/** @type {any} */ b) => b.type === 'images' && b.name === 'IMAGES').length === 1 && bindings.filter((/** @type {any} */ b) => b.type === 'assets' && b.name === 'ASSETS').length === 1 && bindings.every((/** @type {any} */ b) => ['plain_text', 'secret_text', 'images', 'assets'].includes(b.type)), 'WORKER_BINDING_MISMATCH');
        const createdAt = version.metadata?.created_on, earliest = ['deploy-worker','update-worker'].includes(manifest.pending?.step??'') ? manifest.pending?.startedAt : manifest.cleanup.resources.find(r => r.provider === 'cloudflare' && r.id === name)?.createdAt;
        ensure(typeof createdAt === 'string' && earliest && Date.parse(createdAt) >= Date.parse(earliest) - 1000 && Date.parse(createdAt) <= Date.parse(now()) + 300000, 'WORKER_CREATION_WINDOW_MISMATCH');
        const schedules = await request(`${script}/schedules`);
        ensure(Array.isArray(schedules.result?.schedules) && schedules.result.schedules.length === 0, 'WORKER_CRON_FORBIDDEN');
        await noRoutes(name);
        const enabled = await request(`${script}/subdomain`);
        ensure(enabled.result?.enabled === true && enabled.result?.previews_enabled === false, 'WORKER_PUBLIC_ORIGIN_MISMATCH');
        const proof = { evidenceMode: dependencies.fetchImpl ? 'deterministic-http-fixture' : 'provider-readback', workerName: name, accountId: s.accountId, purpose: s.purpose, versionId, candidateSha: manifest.candidate.sha, candidateTree: manifest.candidate.tree, projectRef: projectFor(manifest, s.purpose, true).ref, createdAt, configSha256: digest(config), origin: config.vars.PUBLIC_APP_URL };
        return { ...proof, status: 'verified', checkedAt: now(), evidenceSha256: digest(proof) };
    }
    /** @param {WorkerContext} context */
    async function mutate(context) {
        ensure(input.deployToken && input.deployCapabilityId, 'WORKER_DEPLOY_CAPABILITY_REQUIRED');
        const manifest = bound(context), name = workerNameFor(manifest, s.purpose);
        const action=manifest.pending?.step;ensure((action==='deploy-worker'||(action==='update-worker'&&updatePreviousDirectory))&&manifest.allowedActions.includes(action) && manifest.pending?.step === action && manifest.pending.operationId === context.operationId && manifest.pending.resourceId === name && manifest.capabilityIds['monitoring-config'] === input.deployCapabilityId, 'WORKER_DEPLOY_INTENT_REQUIRED');
        ensure(inspectedRun === manifest.runId && inspectedAt && Date.parse(now()) - Date.parse(inspectedAt) <= 60000 && Date.parse(manifest.pending.startedAt) >= Date.parse(inspectedAt) - 1000 && !mutationAttempted, 'WORKER_PRE_MUTATION_INSPECTION_REQUIRED');
        if(action==='update-worker'){
            ensure(manifest.releaseUpdate,'MERGE_ADOPTION_REQUIRED');
            const previous=structuredClone(manifest);previous.candidate=manifest.releaseUpdate.fromCandidate;delete previous.releaseUpdate;previous.pending=null;
            const observed=await readIssue29WorkerBinding({...input,manifest:previous,settings:s,privateDirectory:updatePreviousDirectory},{...dependencies});
            const owned=manifest.cleanup.resources.find(r=>r.provider==='cloudflare'&&r.id===name);ensure(owned?.evidenceSha256===observed.evidenceSha256,'WORKER_UPDATE_PRIOR_DRIFT');
        }
        await readBoundConfig(manifest, s, input.repositoryRoot, input.privateDirectory, now());
        await attestCandidateWorktree(input.repositoryRoot, manifest.candidate.sha);
        const version = JSON.parse(await readFile(join(input.repositoryRoot, 'node_modules/wrangler/package.json'), 'utf8'));
        ensure(version.version === WRANGLER_VERSION, 'PINNED_WRANGLER_REQUIRED');
        const childEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: input.privateDirectory, LANG: 'C.UTF-8', CI: 'true', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_ACCOUNT_ID: s.accountId, CLOUDFLARE_API_TOKEN: input.deployToken };
        mutationAttempted = true;
        try {
            await (dependencies.execImpl ?? execFile)(join(input.repositoryRoot, 'node_modules/.bin/wrangler'), ['deploy', '--config', join(input.privateDirectory, `worker-${s.purpose}.json`), '--secrets-file', join(input.privateDirectory, `worker-${s.purpose}.secrets.json`), '--env', '', '--strict', '--autoconfig=false', '--tag', manifest.candidate.sha, '--message', `issue29-${manifest.runId}-${s.purpose}`], { cwd: input.privateDirectory, env: childEnv, encoding: 'utf8', maxBuffer: 8388608, timeout: 600000 });
        }
        catch {
            throw new OperationsError('WORKER_MUTATION_UNCERTAIN_READBACK_ONLY');
        }
    }
    /** @param {WorkerContext} context */
    async function inspectCleanup(context) {
        ensure(s.purpose === 'target', 'PERSISTENT_WORKER_CLEANUP_FORBIDDEN');
        const manifest = bound(context, true), name = workerNameFor(manifest, s.purpose);
        ensure(manifest.pending === null && manifest.cleanup.authorized && manifest.capabilityIds.cleanup === input.cleanupCapabilityId, 'WORKER_CLEANUP_AUTHORITY_REQUIRED');
        const owned = manifest.cleanup.resources.find(r => r.provider === 'cloudflare' && r.id === name && r.runId === manifest.runId && r.disposition === 'disposable' && r.absentAt === null);
        ensure(owned, 'WORKER_CLEANUP_OWNERSHIP_MISMATCH');
        const proof = await readback(context);
        ensure(proof.evidenceSha256 === owned.evidenceSha256, 'WORKER_CLEANUP_VERSION_MISMATCH');
        cleanupInspectedAt = now();
        return proof;
    }
    /** @param {WorkerContext} context */
    async function remove(context) {
        ensure(input.cleanupToken && input.cleanupCapabilityId, 'WORKER_CLEANUP_CAPABILITY_REQUIRED');
        ensure(s.purpose === 'target', 'PERSISTENT_WORKER_CLEANUP_FORBIDDEN');
        const manifest = bound(context, true), name = workerNameFor(manifest, s.purpose);
        ensure(manifest.allowedActions.includes('cleanup-resource') && manifest.pending?.step === 'cleanup-resource' && manifest.pending.resourceId === name && manifest.pending.operationId === context.operationId && manifest.capabilityIds.cleanup === input.cleanupCapabilityId && cleanupInspectedAt && Date.parse(now()) - Date.parse(cleanupInspectedAt) <= 60000 && !cleanupAttempted, 'WORKER_CLEANUP_INTENT_REQUIRED');
        const owned = manifest.cleanup.resources.find(r => r.provider === 'cloudflare' && r.id === name && r.disposition === 'disposable' && r.absentAt === null);
        ensure(owned && (await readback(context)).evidenceSha256 === owned.evidenceSha256, 'WORKER_CLEANUP_OWNERSHIP_MISMATCH');
        cleanupAttempted = true;
        await request(`${root}/workers/scripts/${name}`, { method: 'DELETE', cleanup: true });
    }
    /** @param {WorkerContext} context */
    async function readAbsent(context) {
        ensure(s.purpose === 'target', 'PERSISTENT_WORKER_CLEANUP_FORBIDDEN');
        const manifest = validateManifest(context.manifest, { now: now() }), name = workerNameFor(manifest, s.purpose);
        const owned = manifest.cleanup.resources.find(r => r.provider === 'cloudflare' && r.id === name && r.runId === manifest.runId && r.disposition === 'disposable');
        ensure(owned, 'WORKER_CLEANUP_OWNERSHIP_MISMATCH');
        const result = await request(`${root}/workers/scripts/${name}/settings`, { allowMissing: true });
        ensure(result.absent === true, 'WORKER_CLEANUP_ABSENCE_UNPROVEN');
        const scripts = await completeList(`${root}/workers/scripts`);
        ensure(scripts.every(w => w.id !== name), 'WORKER_CLEANUP_ABSENCE_UNPROVEN');
        await noRoutes(name);
        return { workerName: name, absent: true, checkedAt: now(), evidenceSha256: digest({ workerName: name, accountId: s.accountId, absent: true }) };
    }
    /** @param {WorkerContext} context @param {string} previousDirectory */
    async function inspectUpdate(context,previousDirectory){
        const manifest=bound(context);ensure(s.purpose==='source'&&manifest.pending===null&&resolve(previousDirectory)!==resolve(input.privateDirectory),'WORKER_UPDATE_BOUNDARY_INVALID');
        await readProtectedMergeEvidence(manifest,previousDirectory,input.repositoryRoot,{allowFixture:Boolean(dependencies.fetchImpl)});ensure(manifest.releaseUpdate,'MERGE_ADOPTION_REQUIRED');
        const previous=structuredClone(manifest);previous.candidate=manifest.releaseUpdate.fromCandidate;delete previous.releaseUpdate;
        const proof=await readIssue29WorkerBinding({...input,manifest:previous,settings:s,privateDirectory:previousDirectory},dependencies);
        const owned=manifest.cleanup.resources.find(r=>r.provider==='cloudflare'&&r.id===proof.workerName&&r.disposition==='persistent'&&r.absentAt===null);ensure(owned?.evidenceSha256===proof.evidenceSha256,'WORKER_UPDATE_PRIOR_DRIFT');
        const before=await readBoundConfig(previous,s,input.repositoryRoot,previousDirectory,now()),after=await readBoundConfig(manifest,s,input.repositoryRoot,input.privateDirectory,now());
        const normalized=structuredClone(after);normalized.main=before.main;normalized.assets.directory=before.assets.directory;normalized.vars.RELEASE_COMMIT_SHA=before.vars.RELEASE_COMMIT_SHA;normalized.vars.OPERATIONS_EXPECTED_DEPLOYMENT_SHA=before.vars.OPERATIONS_EXPECTED_DEPLOYMENT_SHA;
        ensure(canonicalJson(normalized)===canonicalJson(before)&&canonicalJson(await readPrivateJson(join(previousDirectory,'worker-source.secrets.json'),input.repositoryRoot))===canonicalJson(await readPrivateJson(join(input.privateDirectory,'worker-source.secrets.json'),input.repositoryRoot)),'WORKER_UPDATE_CONFIG_DRIFT');
        updatePreviousDirectory=previousDirectory;inspectedAt=now();inspectedRun=manifest.runId;
        return proof;
    }
    return { inspect, inspectUpdate, mutate, readback, inspectCleanup, remove, readAbsent };
}
const secretsSchema = z.strictObject({ SUPABASE_SECRET_KEY: z.string().min(32).max(4096).regex(/^[!-~]+$/u), TURNSTILE_SECRET_KEY: z.string().min(32).max(4096).regex(/^0x4[A-Za-z0-9_-]+$/u), OPERATIONS_MONITOR_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u), RESEND_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9+/=]+$/u).optional() });
/** @typedef {z.infer<typeof secretsSchema>} WorkerSecrets */
/** Build the exact clean candidate without credentials; only then materialize private config/secrets.
 * The original Issue22 template and validator are unchanged.
 * @param {{manifest:import('./manifest.mjs').OperationsManifest,settings:WorkerSettings,secrets:WorkerSecrets,repositoryRoot:string,privateDirectory:string,now?:string}} input */
export async function prepareIssue29Worker(input) {
    const parsed = secretsSchema.safeParse(input.secrets);
    ensure(parsed.success, 'WORKER_SECRETS_INVALID');
    ensure(resolve(input.repositoryRoot) === await realpath(input.repositoryRoot), 'WORKER_REPOSITORY_BOUNDARY_INVALID');
    await assertPrivatePath(join(input.privateDirectory, 'boundary'), input.repositoryRoot);
    const template = JSON.parse(await readFile(join(input.repositoryRoot, 'scripts/issue22-hosted/wrangler.issue22.template.json'), 'utf8'));
    projectFor(validateManifest(input.manifest, { now: input.now }), input.settings.purpose);
    const config = createIssue29WorkerConfig({ ...input, template });
    await attestCandidateWorktree(input.repositoryRoot, input.manifest.candidate.sha);
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: input.privateDirectory, LANG: 'C.UTF-8', CI: 'true', WRANGLER_SEND_METRICS: 'false' };
    try {
        await execFile('pnpm', ['build'], { cwd: input.repositoryRoot, env, encoding: 'utf8', maxBuffer: 8388608, timeout: 600000 });
    }
    catch {
        throw new OperationsError('WORKER_CANDIDATE_BUILD_FAILED');
    }
    await attestCandidateWorktree(input.repositoryRoot, input.manifest.candidate.sha);
    const tree = (await execFile('git', ['rev-parse', 'HEAD^{tree}'], { cwd: input.repositoryRoot, env, encoding: 'utf8' })).stdout.trim();
    ensure(tree === input.manifest.candidate.tree, 'CANDIDATE_TREE_MISMATCH');
    const buildSha256 = await hashIssue29WorkerBuild(join(input.repositoryRoot, '.svelte-kit/cloudflare'));
    const buildDirectory=join(input.privateDirectory,`worker-${input.settings.purpose}-build`);
    ensure(!(await lstat(buildDirectory).catch(error=>{if(error.code==='ENOENT')return null;throw error;})),'WORKER_PRIVATE_BUILD_EXISTS');
    await cp(join(input.repositoryRoot,'.svelte-kit/cloudflare'),buildDirectory,{recursive:true,errorOnExist:true,force:false});
    ensure(await hashIssue29WorkerBuild(buildDirectory)===buildSha256,'WORKER_BUILD_PROVENANCE_MISMATCH');
    const purpose = input.settings.purpose, configPath = join(input.privateDirectory, `worker-${purpose}.json`), secretsPath = join(input.privateDirectory, `worker-${purpose}.secrets.json`);
    await writePrivate(configPath, canonicalJson(config));
    await writePrivate(secretsPath, canonicalJson(parsed.data));
    const proof = { schemaVersion: 1, runId: input.manifest.runId, purpose, candidateSha: input.manifest.candidate.sha, candidateTree: tree, buildSha256, configSha256: digest(config), secretNames: Object.keys(parsed.data).sort(), secretValuesSha256: digest(parsed.data) };
    await writePrivate(join(input.privateDirectory, `worker-${purpose}.build.json`), canonicalJson(proof));
    return { configPath, secretsPath, workerName: config.name, origin: config.vars.PUBLIC_APP_URL, buildSha256, configSha256: proof.configSha256 };
}
/** @param {string} path @param {string} value */
async function writePrivate(path, value) { const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); try {
    await file.writeFile(value);
    await file.sync();
}
finally {
    await file.close();
} }
/** @param {string} path @param {string} repositoryRoot @param {string} [expectedSha256] @returns {Promise<Record<string,any>>} */
async function readPrivateJson(path, repositoryRoot, expectedSha256) { await assertPrivatePath(path, repositoryRoot); const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try {
    const info = await file.stat();
    ensure(info.isFile() && info.nlink === 1 && (info.mode & 0o777) === 0o600 && info.size <= 65536, 'WORKER_PRIVATE_FILE_UNSAFE');
    const bytes=await file.readFile();if(expectedSha256)ensure(digest(bytes)===expectedSha256,'WORKER_PRIVATE_EVIDENCE_HASH_MISMATCH');return JSON.parse(bytes.toString('utf8'));
}
catch (error) {
    if (error instanceof OperationsError)
        throw error;
    throw new OperationsError('WORKER_PRIVATE_FILE_INVALID');
}
finally {
    await file.close();
} }
/** @param {string} directory */
export async function hashIssue29WorkerBuild(directory) {
    const root=await lstat(directory);ensure(root.isDirectory()&&!root.isSymbolicLink()&&await realpath(directory)===resolve(directory),'WORKER_BUILD_SYMLINK_FORBIDDEN');
    /** @type {Array<[string, string]>} */
    const entries = [];
    let count = 0, total = 0;
    /** @param {string} parent @param {string} prefix */
    async function walk(parent, prefix) { for (const entry of await readdir(parent, { withFileTypes: true })) {
        const path = join(parent, entry.name), name = `${prefix}${entry.name}`;
        ensure(!entry.isSymbolicLink(), 'WORKER_BUILD_SYMLINK_FORBIDDEN');
        if (entry.isDirectory()) {
            await walk(path, `${name}/`);
            continue;
        }
        ensure(entry.isFile(), 'WORKER_BUILD_FILE_INVALID');
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const info = await handle.stat();
            total += info.size;
            count++;
            ensure(info.nlink === 1 && info.size <= 33554432 && total <= 268435456 && count <= 10000, 'WORKER_BUILD_SIZE_LIMIT');
            entries.push([name, digest(await handle.readFile())]);
        }
        finally {
            await handle.close();
        }
    } }
    await walk(directory, '');
    ensure(entries.some(e => e[0] === '_worker.js') && entries.length > 1, 'WORKER_BUILD_INCOMPLETE');
    return digest(entries.sort((a, b) => a[0].localeCompare(b[0])));
}
/** @param {import('./manifest.mjs').OperationsManifest} manifest @param {WorkerSettings} settings @param {string} repositoryRoot @param {string} privateDirectory @param {string} now */
async function readBoundConfig(manifest, settings, repositoryRoot, privateDirectory, now) {
    const template = JSON.parse(await readFile(join(repositoryRoot, 'scripts/issue22-hosted/wrangler.issue22.template.json'), 'utf8'));
    const expected = createIssue29WorkerConfig({ template, manifest, settings, repositoryRoot, privateDirectory, now });
    const config = await readPrivateJson(join(privateDirectory, `worker-${settings.purpose}.json`), repositoryRoot);
    ensure(canonicalJson(config) === canonicalJson(expected), 'WORKER_PRIVATE_CONFIG_MISMATCH');
    const proof = await readPrivateJson(join(privateDirectory, `worker-${settings.purpose}.build.json`), repositoryRoot);
    const secrets = await readPrivateJson(join(privateDirectory, `worker-${settings.purpose}.secrets.json`), repositoryRoot);
    ensure(secretsSchema.safeParse(secrets).success, 'WORKER_SECRETS_INVALID');
    ensure(proof.schemaVersion === 1 && proof.runId === manifest.runId && proof.purpose === settings.purpose && proof.candidateSha === manifest.candidate.sha && proof.candidateTree === manifest.candidate.tree && proof.configSha256 === digest(config) && proof.secretValuesSha256 === digest(secrets) && canonicalJson(proof.secretNames) === canonicalJson(Object.keys(secrets).sort()) && proof.buildSha256 === await hashIssue29WorkerBuild(join(privateDirectory,`worker-${settings.purpose}-build`)), 'WORKER_BUILD_PROVENANCE_MISMATCH');
    return config;
}

/** Read the exact current binding without requiring deploy or cleanup credentials.
 * @param {{manifest:import('./manifest.mjs').OperationsManifest,settings:unknown,readToken:string,repositoryRoot:string,privateDirectory:string}} input
 * @param {WorkerDependencies} [dependencies]
 */
export async function readIssue29WorkerBinding(input, dependencies = {}) {
    const parsed=settingsSchema.safeParse(input.settings);ensure(parsed.success,'WORKER_SETTINGS_INVALID');
    const adapter=createIssue29WorkerAdapter({...input,settings:parsed.data},dependencies);
    const proof=await adapter.readback({manifest:input.manifest,operationId:input.manifest.runId});
    const expected=parsed.data.purpose==='source'?input.manifest.candidate.deploymentId:input.manifest.targetDeploymentId;
    ensure(expected===proof.versionId,'WORKER_EXPECTED_VERSION_MISMATCH');
    return proof;
}
/** @typedef {WorkerAdapterInput & {manifestPath:string}} WorkerCoordinatorOptions */
/** @template T @param {WorkerCoordinatorOptions} input @param {WorkerDependencies} dependencies @param {(manifest:import('./manifest.mjs').OperationsManifest,save:()=>Promise<void>)=>Promise<T>} operation */
async function withWorkerTransaction(input, dependencies, operation) {
    const now=dependencies.now??(()=>new Date().toISOString());
    await assertPrivatePath(input.manifestPath,input.repositoryRoot);
    let lock;
    try {lock=await open(`${input.manifestPath}.lock`,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}
    catch {throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}
    try {
        const manifest=await readPrivateManifest(input.manifestPath,{repositoryRoot:input.repositoryRoot,now:now()});
        ensure(manifest.humanBoundary===null&&manifest.terminal===null,'TRANSACTION_TERMINAL');
        return await operation(manifest,()=>writePrivateManifest(input.manifestPath,manifest,{repositoryRoot:input.repositoryRoot,now:now(),replace:true}));
    } finally {await lock.close();await unlink(`${input.manifestPath}.lock`);}
}
/** Deploy only an already prepared, hash-bound private candidate. Pending intent resumes by readback,
 * never by deploying a second time. Source ownership is persistent; target ownership is disposable.
 * @param {WorkerCoordinatorOptions} input @param {WorkerDependencies} [dependencies]
 */
export async function executeDeployWorker(input,dependencies={}) {
    return withWorkerTransaction(input,dependencies,async(manifest,save)=>{
        const now=dependencies.now??(()=>new Date().toISOString()),name=workerNameFor(manifest,input.settings.purpose);
        ensure(manifest.allowedActions.includes('deploy-worker'),'ACTION_FORBIDDEN');
        const adapter=createIssue29WorkerAdapter(input,dependencies);
        const owned=manifest.cleanup.resources.find(r=>r.provider==='cloudflare'&&r.id===name);
        if(owned){
            ensure(manifest.pending===null&&owned.absentAt===null&&owned.disposition===(input.settings.purpose==='source'?'persistent':'disposable'),'WORKER_OWNERSHIP_COLLISION');
            const proof=await adapter.readback({manifest,operationId:manifest.runId});
            ensure(proof.evidenceSha256===owned.evidenceSha256,'WORKER_CLEANUP_VERSION_MISMATCH');
            return proof;
        }
        if(manifest.pending===null){
            const attemptKey=`deploy-worker:${input.settings.purpose==='target'?name:'source'}`;
            ensure(!manifest.attempts[attemptKey],'ATTEMPT_LIMIT');
            await readBoundConfig(manifest,input.settings,input.repositoryRoot,input.privateDirectory,now());
            const inspection=await adapter.inspect({manifest,operationId:manifest.runId});
            manifest.pending={step:'deploy-worker',operationId:randomUUID(),startedAt:now(),resourceId:name,priorStateSha256:inspection.evidenceSha256};
            manifest.attempts[attemptKey]=1;await save();
            await persistOperationsIntent(input.manifestPath,manifest,input.repositoryRoot);
            await adapter.mutate({manifest,operationId:manifest.pending.operationId});
        }
        const pending=manifest.pending;
        ensure(pending?.step==='deploy-worker'&&pending.resourceId===name,'PENDING_OPERATION_REQUIRES_READBACK');
        const intentSha256=await persistOperationsIntent(input.manifestPath,manifest,input.repositoryRoot,{mustExist:true});
        const proof=await adapter.readback({manifest,operationId:pending.operationId});
        await persistWorkerReadback(input,proof);
        manifest.cleanup.resources.push({provider:'cloudflare',id:name,runId:manifest.runId,createdAt:proof.createdAt,evidenceSha256:proof.evidenceSha256,disposition:input.settings.purpose==='source'?'persistent':'disposable',absentAt:null});
        if(input.settings.purpose==='source')manifest.candidate.deploymentId=proof.versionId;
        else manifest.targetDeploymentId=proof.versionId;
        manifest.history.push({step:'deploy-worker',operationId:pending.operationId,completedAt:proof.checkedAt,resourceId:name,evidenceSha256:proof.evidenceSha256,intentSha256});
        manifest.pending=null;await save();return proof;
    });
}
/** Only the exact disposable target Worker can be removed. Pause/resume never calls this boundary.
 * @param {WorkerCoordinatorOptions} input @param {WorkerDependencies} [dependencies]
 */
export async function executeCleanupWorker(input,dependencies={}) {
    ensure(input.settings.purpose==='target','PERSISTENT_WORKER_CLEANUP_FORBIDDEN');
    return withWorkerTransaction(input,dependencies,async(manifest,save)=>{
        const now=dependencies.now??(()=>new Date().toISOString()),name=workerNameFor(manifest,'target');
        ensure(manifest.allowedActions.includes('cleanup-resource'),'ACTION_FORBIDDEN');
        const owned=manifest.cleanup.resources.find(r=>r.provider==='cloudflare'&&r.id===name&&r.runId===manifest.runId);
        ensure(owned?.disposition==='disposable','WORKER_CLEANUP_OWNERSHIP_MISMATCH');
        const adapter=createIssue29WorkerAdapter(input,dependencies);
        if(owned.absentAt!==null){ensure(manifest.pending===null,'PENDING_OPERATION_REQUIRES_READBACK');return adapter.readAbsent({manifest,operationId:manifest.runId});}
        if(manifest.pending===null){
            const attemptKey=`cleanup-resource:${name}`;ensure(!manifest.attempts[attemptKey],'ATTEMPT_LIMIT');
            const inspection=await adapter.inspectCleanup({manifest,operationId:manifest.runId});
            manifest.pending={step:'cleanup-resource',operationId:randomUUID(),startedAt:now(),resourceId:name,priorStateSha256:inspection.evidenceSha256};
            manifest.attempts[attemptKey]=1;await save();await persistOperationsIntent(input.manifestPath,manifest,input.repositoryRoot);await adapter.remove({manifest,operationId:manifest.pending.operationId});
        }
        const pending=manifest.pending;ensure(pending?.step==='cleanup-resource'&&pending.resourceId===name,'PENDING_OPERATION_REQUIRES_READBACK');
        const intentSha256=await persistOperationsIntent(input.manifestPath,manifest,input.repositoryRoot,{mustExist:true});
        const proof=await adapter.readAbsent({manifest,operationId:pending.operationId});
        await persistOperationsEvidence(input.manifestPath,input.repositoryRoot,{workerName:proof.workerName,accountId:input.settings.accountId,absent:true},proof.evidenceSha256);
        await persistOperationsEvidence(input.manifestPath,input.repositoryRoot,proof,digest(proof));
        owned.absentAt=proof.checkedAt;manifest.history.push({step:'cleanup-resource',operationId:pending.operationId,completedAt:proof.checkedAt,resourceId:name,evidenceSha256:proof.evidenceSha256,intentSha256});
        manifest.pending=null;await save();return proof;
    });
}

const candidateSchema=z.strictObject({sha:z.string().regex(/^[a-f0-9]{40}$/u),tree:z.string().regex(/^[a-f0-9]{40}$/u),deploymentId:z.string().regex(/^[a-zA-Z0-9-]{1,128}$/u)});
const mergeSettingsSchema=z.strictObject({repository:z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9][A-Za-z0-9_.-]*$/u),repositoryId:z.number().int().positive(),pullRequestNumber:z.number().int().positive(),mergeSha:candidateSchema.shape.sha,treeSha:candidateSchema.shape.tree,readToken:token});
export const protectedMergeProofSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('issue29-protected-merge'),evidenceMode:z.enum(['provider-readback','deterministic-http-fixture']),repository:mergeSettingsSchema.shape.repository,repositoryId:z.number().int().positive(),pullRequestNumber:z.number().int().positive(),fromCandidate:candidateSchema,mergeSha:candidateSchema.shape.sha,treeSha:candidateSchema.shape.tree,verifiedAt:z.iso.datetime(),mergedAt:z.iso.datetime(),protectionSha256:hash,checkRunsSha256:hash});
/** Actual REST readback, not a caller-asserted merge/CI boolean. Unknown pagination fails closed.
 * @param {{settings:z.infer<typeof mergeSettingsSchema>,fromCandidate:import('./manifest.mjs').Candidate,now?:string,fetchImpl?:typeof fetch}} input */
export async function verifyProtectedMerge(input){
 const parsed=mergeSettingsSchema.safeParse(input.settings);ensure(parsed.success&&candidateSchema.safeParse(input.fromCandidate).success,'MERGE_SETTINGS_INVALID');const s=parsed.data,now=input.now??new Date().toISOString();
 ensure(s.treeSha===input.fromCandidate.tree&&s.mergeSha!==input.fromCandidate.sha,'MERGE_TREE_MISMATCH');
 const root=`https://api.github.com/repos/${s.repository}`;
 /** @param {string} path @returns {Promise<Record<string,any>>} */
 async function get(path){try{const response=await(input.fetchImpl??fetch)(root+path,{redirect:'error',signal:AbortSignal.timeout(30000),headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${s.readToken}`,'X-GitHub-Api-Version':'2026-03-10'}});ensure(response.ok&&!response.headers.get('link')?.includes('rel="next"'),'MERGE_READBACK_UNAVAILABLE');ensure(response.body,'MERGE_READBACK_UNAVAILABLE');let size=0;const chunks=[];const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;ensure(size<=2097152,'MERGE_READBACK_LIMIT');chunks.push(Buffer.from(value));}}finally{await reader.cancel();reader.releaseLock();}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('MERGE_READBACK_UNAVAILABLE');}}
 const repo=await get('');ensure(repo.id===s.repositoryId&&repo.full_name===s.repository&&repo.default_branch==='main','MERGE_REPOSITORY_MISMATCH');
 const pr=await get(`/pulls/${s.pullRequestNumber}`);ensure(pr.number===s.pullRequestNumber&&pr.state==='closed'&&pr.merged===true&&pr.merge_commit_sha===s.mergeSha&&pr.head?.sha===input.fromCandidate.sha&&pr.head?.repo?.id===s.repositoryId&&pr.base?.repo?.id===s.repositoryId&&pr.base?.ref==='main','MERGED_PR_MISMATCH');
 ensure(typeof pr.merged_at==='string'&&Date.parse(pr.merged_at)<=Date.parse(now)&&Number.isFinite(Date.parse(pr.merged_at)),'MERGED_PR_MISMATCH');
 const branch=await get('/branches/main');ensure(branch.name==='main'&&branch.protected===true&&branch.commit?.sha===s.mergeSha,'PROTECTED_MAIN_MISMATCH');
 const protection=await get('/branches/main/protection');const required=protection.required_status_checks?.checks;ensure(Array.isArray(required)&&required.length>0&&required.length<=100&&required.every(r=>typeof r.context==='string'&&Number.isSafeInteger(r.app_id)&&r.app_id>0),'MERGE_PROTECTION_UNPROVEN');
 const observed=[];
 for(const sha of [input.fromCandidate.sha,s.mergeSha]){
  const commit=await get(`/git/commits/${sha}`);ensure(commit.sha===sha&&commit.tree?.sha===s.treeSha,'MERGE_TREE_MISMATCH');
  const checks=await get(`/commits/${sha}/check-runs?per_page=100&filter=latest`);ensure(Array.isArray(checks.check_runs)&&checks.total_count===checks.check_runs.length&&checks.check_runs.length>0&&checks.check_runs.length<=100,'MERGE_CHECKS_UNPROVEN');
  for(const rule of required){const matches=checks.check_runs.filter((/** @type {any} */c)=>c.name===rule.context&&c.app?.id===rule.app_id);ensure(matches.length===1&&matches[0].head_sha===sha&&matches[0].status==='completed'&&matches[0].conclusion==='success','MERGE_CHECKS_NOT_GREEN');}
  ensure(checks.check_runs.every((/** @type {any} */c)=>c.head_sha===sha&&c.status==='completed'&&['success','neutral','skipped'].includes(c.conclusion)),'MERGE_CHECKS_NOT_GREEN');
  observed.push({sha,checks:checks.check_runs.map((/** @type {any} */c)=>({id:c.id,name:c.name,appId:c.app?.id,status:c.status,conclusion:c.conclusion}))});
 }
 return protectedMergeProofSchema.parse({schemaVersion:1,kind:'issue29-protected-merge',evidenceMode:input.fetchImpl?'deterministic-http-fixture':'provider-readback',repository:s.repository,repositoryId:s.repositoryId,pullRequestNumber:s.pullRequestNumber,fromCandidate:input.fromCandidate,mergeSha:s.mergeSha,treeSha:s.treeSha,verifiedAt:now,mergedAt:new Date(pr.merged_at).toISOString(),protectionSha256:digest(protection),checkRunsSha256:digest(observed)});
}
/** @param {import('./manifest.mjs').OperationsManifest} manifest @param {string} directory @param {string} repositoryRoot @param {{allowFixture?:boolean}} [options] */
export async function readProtectedMergeEvidence(manifest,directory,repositoryRoot,options={}){
 const u=manifest.releaseUpdate;ensure(u,'MERGE_ADOPTION_REQUIRED');const proof=protectedMergeProofSchema.safeParse(await readPrivateJson(join(directory,`${u.evidenceSha256}.json`),repositoryRoot,u.evidenceSha256));ensure(proof.success&&digest(proof.data)===u.evidenceSha256,'MERGE_EVIDENCE_INVALID');
 const p=proof.data;ensure(p.evidenceMode==='provider-readback'||options.allowFixture===true,'HOSTED_MERGE_EVIDENCE_REQUIRED');
 for(const key of /** @type {const} */(['repository','repositoryId','pullRequestNumber','mergeSha','treeSha','verifiedAt']))ensure(p[key]===u[key],'MERGE_EVIDENCE_INVALID');
 ensure(canonicalJson(p.fromCandidate)===canonicalJson(u.fromCandidate)&&u.mergeSha===manifest.candidate.sha&&u.treeSha===manifest.candidate.tree&&u.treeSha===u.fromCandidate.tree&&manifest.history.some(h=>h.step==='adopt-merged-release'&&h.resourceId===u.mergeSha&&h.evidenceSha256===u.evidenceSha256),'MERGE_ADOPTION_REQUIRED');return p;
}
/** Adopt only an actual protected merge from the exact clean merged checkout. This read-only
 * GitHub operation changes no provider resource; creation provenance and old receipts remain intact.
 * @param {{manifestPath:string,repositoryRoot:string,settings:z.infer<typeof mergeSettingsSchema>,evidenceDirectory:string}} input
 * @param {WorkerDependencies} [dependencies] */
export async function executeAdoptMergedRelease(input,dependencies={}){
 const now=dependencies.now??(()=>new Date().toISOString());await assertPrivatePath(input.manifestPath,input.repositoryRoot);await assertPrivatePath(join(input.evidenceDirectory,'boundary'),input.repositoryRoot);
 let lock;try{lock=await open(`${input.manifestPath}.lock`,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch{throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}
 try{
  const manifest=await readPrivateManifest(input.manifestPath,{repositoryRoot:input.repositoryRoot,now:now()});ensure(!manifest.pending&&!manifest.terminal&&!manifest.humanBoundary&&manifest.allowedActions.includes('adopt-merged-release'),'MERGE_ADOPTION_FORBIDDEN');projectFor(manifest,'source');
  ensure(manifest.cleanup.resources.filter(r=>r.disposition==='disposable').every(r=>r.absentAt!==null),'MERGE_DISPOSABLE_CLEANUP_REQUIRED');
  const prior=manifest.releaseUpdate?.fromCandidate??manifest.candidate;
  await attestCandidateWorktree(input.repositoryRoot,input.settings.mergeSha);const tree=(await execFile('git',['rev-parse','HEAD^{tree}'],{cwd:input.repositoryRoot,env:{PATH:process.env.PATH??'/usr/bin:/bin',LANG:'C.UTF-8'},encoding:'utf8'})).stdout.trim();ensure(tree===input.settings.treeSha,'MERGE_TREE_MISMATCH');
  const proof=await verifyProtectedMerge({settings:input.settings,fromCandidate:prior,now:now(),fetchImpl:dependencies.fetchImpl});
  if(manifest.releaseUpdate){ensure(manifest.candidate.sha===proof.mergeSha,'MERGE_ADOPTION_COLLISION');return readProtectedMergeEvidence(manifest,input.evidenceDirectory,input.repositoryRoot,{allowFixture:Boolean(dependencies.fetchImpl)});}
  const evidenceSha256=digest(proof);await writePrivate(join(input.evidenceDirectory,`${evidenceSha256}.json`),canonicalJson(proof));
  manifest.releaseUpdate={fromCandidate:prior,mergeSha:proof.mergeSha,treeSha:proof.treeSha,pullRequestNumber:proof.pullRequestNumber,verifiedAt:proof.verifiedAt,evidenceSha256,repository:proof.repository,repositoryId:proof.repositoryId};
  manifest.candidate={sha:proof.mergeSha,tree:proof.treeSha,deploymentId:prior.deploymentId};manifest.history.push({step:'adopt-merged-release',operationId:randomUUID(),completedAt:proof.verifiedAt,evidenceSha256,resourceId:proof.mergeSha});
  await writePrivateManifest(input.manifestPath,manifest,{repositoryRoot:input.repositoryRoot,now:now(),replace:true});return proof;
 }finally{await lock.close();await unlink(`${input.manifestPath}.lock`);}
}

/** Replace only the existing persistent source's release after protected merge adoption. Old config,
 * secrets and build are preserved privately; a resumed uncertain update performs readback only.
 * @param {WorkerCoordinatorOptions & {previousPrivateDirectory:string}} input @param {WorkerDependencies} [dependencies] */
export async function executeUpdateSourceWorker(input,dependencies={}){
 ensure(input.settings.purpose==='source','WORKER_UPDATE_BOUNDARY_INVALID');
 return withWorkerTransaction(input,dependencies,async(manifest,save)=>{
  const now=dependencies.now??(()=>new Date().toISOString()),name=workerNameFor(manifest,'source');
  ensure(manifest.allowedActions.includes('update-worker'),'ACTION_FORBIDDEN');await readProtectedMergeEvidence(manifest,input.previousPrivateDirectory,input.repositoryRoot,{allowFixture:Boolean(dependencies.fetchImpl)});ensure(manifest.releaseUpdate,'MERGE_ADOPTION_REQUIRED');
  const owned=manifest.cleanup.resources.find(r=>r.provider==='cloudflare'&&r.id===name&&r.disposition==='persistent'&&r.absentAt===null);ensure(owned,'WORKER_UPDATE_OWNERSHIP_REQUIRED');
  const adapter=createIssue29WorkerAdapter(input,dependencies),key=`update-worker:${manifest.candidate.sha}`;
  const done=manifest.history.find(h=>h.step==='update-worker'&&h.resourceId===name&&h.evidenceSha256===owned.evidenceSha256);
  if(done&&!manifest.pending){const proof=await adapter.readback({manifest,operationId:done.operationId});ensure(proof.evidenceSha256===owned.evidenceSha256&&proof.versionId===manifest.candidate.deploymentId,'WORKER_UPDATE_READBACK_MISMATCH');return proof;}
  if(!manifest.pending){
   ensure(!manifest.attempts[key],'ATTEMPT_LIMIT');const prior=await adapter.inspectUpdate({manifest,operationId:manifest.runId},input.previousPrivateDirectory);
   const snapshot={schemaVersion:1,kind:'issue29-worker-update-prior',worker:prior,config:await readBoundConfig({...manifest,candidate:manifest.releaseUpdate.fromCandidate,releaseUpdate:undefined},input.settings,input.repositoryRoot,input.previousPrivateDirectory,now()),build:await readPrivateJson(join(input.previousPrivateDirectory,'worker-source.build.json'),input.repositoryRoot)};
   const snapshotSha256=digest(snapshot);await writePrivate(join(input.previousPrivateDirectory,`${snapshotSha256}.json`),canonicalJson(snapshot));
   manifest.pending={step:'update-worker',operationId:randomUUID(),startedAt:now(),resourceId:name,priorStateSha256:snapshotSha256};manifest.attempts[key]=1;await save();await persistOperationsIntent(input.manifestPath,manifest,input.repositoryRoot);await adapter.mutate({manifest,operationId:manifest.pending.operationId});
  }
  const intentSha256=await persistOperationsIntent(input.manifestPath,manifest,input.repositoryRoot,{mustExist:true});
  const pending=manifest.pending;ensure(pending?.step==='update-worker'&&pending.resourceId===name&&pending.priorStateSha256,'PENDING_OPERATION_REQUIRES_READBACK');
  const snapshot=await readPrivateJson(join(input.previousPrivateDirectory,`${pending.priorStateSha256}.json`),input.repositoryRoot,pending.priorStateSha256);ensure(digest(snapshot)===pending.priorStateSha256&&snapshot.worker?.versionId===manifest.releaseUpdate.fromCandidate.deploymentId&&snapshot.worker?.evidenceSha256===owned.evidenceSha256,'WORKER_UPDATE_PRIOR_DRIFT');
  const proof=await adapter.readback({manifest,operationId:pending.operationId});ensure(proof.versionId!==manifest.releaseUpdate.fromCandidate.deploymentId,'WORKER_UPDATE_NOT_OBSERVED');
  await writePrivate(join(input.privateDirectory,`${digest(proof)}.json`),canonicalJson(proof)).catch(async error=>{if(error.code!=='EEXIST')throw error;ensure((await readPrivateJson(join(input.privateDirectory,`${digest(proof)}.json`),input.repositoryRoot)).evidenceSha256===proof.evidenceSha256,'WORKER_UPDATE_READBACK_MISMATCH');});
  owned.priorStateSha256=pending.priorStateSha256;owned.evidenceSha256=proof.evidenceSha256;manifest.candidate.deploymentId=proof.versionId;
  await persistWorkerReadback(input,proof);
  manifest.history.push({step:'update-worker',operationId:pending.operationId,completedAt:proof.checkedAt,resourceId:name,evidenceSha256:proof.evidenceSha256,intentSha256});manifest.pending=null;await save();return proof;
 });
}

export {settingsSchema as issue29WorkerSettingsSchema};

/** Preserve the exact stable ownership hash AND the timestamped full readback preimage.
 * @param {WorkerCoordinatorOptions} input @param {Awaited<ReturnType<ReturnType<typeof createIssue29WorkerAdapter>['readback']>>} proof */
async function persistWorkerReadback(input,proof){const {status:_status,checkedAt:_time,evidenceSha256,...body}=proof;await persistOperationsEvidence(input.manifestPath,input.repositoryRoot,body,evidenceSha256);await persistOperationsEvidence(input.manifestPath,input.repositoryRoot,proof,digest(proof));}
