import { ensure, OperationsError } from './manifest.mjs';
/** @param {import('./manifest.mjs').OperationsManifest} manifest @param {'source'|'target'} role */
function ownedProject(manifest, role) { const project = role === 'source' ? manifest.source : manifest.target; ensure(project && !manifest.preservedRefs.includes(project.ref), 'PRESERVED_PROJECT_FORBIDDEN'); ensure(manifest.cleanup.resources.some(r => r.provider === 'supabase' && r.id === project.ref && r.runId === manifest.runId && r.disposition === (role === 'source' ? 'persistent' : 'disposable') && r.absentAt === null), 'JOBS_PROJECT_OWNERSHIP_REQUIRED'); return project; }
/** @typedef {import('./logical-recovery.mjs').DatabaseOptions & {manifest:import('./manifest.mjs').OperationsManifest,role:'source'|'target',mode:'quiesce'|'prove'|'resume',repositoryRoot:string,plan:JobPlan,persistIntent:(intent:JobIntent)=>Promise<void>,readbackVerified:(intent:JobIntent)=>Promise<void>,clock?:()=>string,wait?:(ms:number)=>Promise<void>,resumingRestore?:boolean}} JobsOptions */
/** @param {Omit<JobsOptions,'scope'>} options @param {JobsAdapter} adapter */
export async function controlSyntheticJobs(options, adapter) {
    const project = ownedProject(options.manifest, options.role);
    ensure(adapter, 'JOBS_ADAPTER_REQUIRED');
    ensure(options.manifest.allowedActions.includes('synthetic-jobs') && options.manifest.terminal === null && options.manifest.humanBoundary === null, 'JOBS_ACTION_FORBIDDEN');
    const prior = validateJobs(options.plan.priorState);
    const clock = options.clock ?? (() => new Date().toISOString());
    const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    await adapter.verifySafety();
    /** @param {string} phase @param {Job[]} before @param {Job[]} after */
    async function transition(phase, before, after) { const intent = { phase, before, after }; const observed = await adapter.readState(); if (canonicalJson(observed) !== canonicalJson(after)) {
        ensure(canonicalJson(observed) === canonicalJson(before), 'JOBS_PRIOR_STATE_DRIFT');
        if (phase === 'proof-start')
            ensure(Date.parse(clock()) >= Date.parse(options.plan.startedAt) && Date.parse(clock()) < Date.parse(options.plan.expiresAt), 'JOBS_PROOF_WINDOW_EXPIRED');
        await options.persistIntent(intent);
        try {
            await adapter.applyState(after, before);
        }
        catch {
            throw new OperationsError('JOBS_MUTATION_UNCERTAIN_READBACK_ONLY');
        }
        ensure(canonicalJson(await adapter.readState()) === canonicalJson(after), 'JOBS_READBACK_REQUIRED');
    } await options.readbackVerified(intent); }
    let finalState;
    /** @type {Awaited<ReturnType<JobsAdapter['readProof']>>} */
    let proof = [];
    if (options.mode === 'quiesce') {
        finalState = prior.map(j => ({ ...j, active: false }));
        await transition('quiesce', prior, finalState);
    }
    else if (options.mode === 'resume') {
        finalState = prior;
        await transition('resume', prior.map(j => ({ ...j, active: false })), finalState);
    }
    else {
        ensure(options.mode === 'prove', 'JOBS_MODE_INVALID');
        ensure(Number.isFinite(Date.parse(options.plan.startedAt)) && new Date(options.plan.startedAt).toISOString() === options.plan.startedAt && Number.isFinite(Date.parse(options.plan.expiresAt)) && new Date(options.plan.expiresAt).toISOString() === options.plan.expiresAt && Date.parse(options.plan.expiresAt) - Date.parse(options.plan.startedAt) === 60000, 'JOBS_PROOF_WINDOW_INVALID');
        finalState = canonicalJobs(prior);
        ensure(finalState.every(j => j.active), 'JOBS_PROOF_REQUIRES_ACTIVE_FINAL_STATE');
        const temporary = finalState.map(j => ({ ...j, schedule: '5 seconds', command: `${j.command} where statement_timestamp() < '${options.plan.expiresAt}'::timestamptz` }));
        if (!options.resumingRestore)
            await transition('proof-start', prior, temporary);
        try {
            for (let attempt = 0; attempt < 15; attempt++) {
                proof = await adapter.readProof(options.plan);
                if (proof.length === 2 && new Set(proof.map(p => p.jobname)).size === 2 && CANONICAL_SYNTHETIC_JOBS.every(j => proof.some(p => p.jobname === j.jobname)) && proof.every(p => p.status === 'succeeded' && ['1 row', 'SELECT 1'].includes(p.returnMessage) && Date.parse(p.startTime) >= Date.parse(options.plan.startedAt) && Date.parse(p.endTime) < Date.parse(options.plan.expiresAt)))
                    break;
                ensure(Date.parse(clock()) < Date.parse(options.plan.expiresAt), 'JOBS_PROOF_WINDOW_EXPIRED');
                await wait(5000);
            }
        }
        finally {
            await transition('proof-restore', temporary, finalState);
        }
        ensure(proof.length === 2 && new Set(proof.map(p => p.jobname)).size === 2 && CANONICAL_SYNTHETIC_JOBS.every(j => proof.some(p => p.jobname === j.jobname)) && proof.every(p => p.status === 'succeeded' && ['1 row', 'SELECT 1'].includes(p.returnMessage) && Date.parse(p.startTime) >= Date.parse(options.plan.startedAt) && Date.parse(p.endTime) < Date.parse(options.plan.expiresAt)), 'JOBS_SUCCESS_HISTORY_REQUIRED');
    }
    for (let i = 0; i < 15 && await adapter.readRunning() > 0; i++) {
        await wait(1000);
    }
    ensure(await adapter.readRunning() === 0, 'JOBS_RUNNING_READBACK_REQUIRED');
    return { schemaVersion: 1, runId: options.manifest.runId, projectRef: project.ref, role: options.role, mode: options.mode === 'quiesce' ? 'quiesced' : options.mode === 'prove' ? 'proved' : 'resumed', checkedAt: clock(), priorState: prior, state: finalState, proof };
}
export const CANONICAL_SYNTHETIC_JOBS = Object.freeze([
    { jobname: 'perfume-beta-maintenance', schedule: '*/5 * * * *', command: 'select private.run_beta_maintenance(500)' },
    { jobname: 'perfume-beta-expiry-notifications', schedule: '15 8 * * *', command: 'select private.queue_listing_expiry_notifications(500)' }
].sort((a, b) => a.jobname.localeCompare(b.jobname)));
/** @typedef {{jobname:string,schedule:string,command:string,nodename:string,nodeport:number,database:string,username:string,active:boolean}} Job */
/** @typedef {{priorState:Job[],startedAt:string,expiresAt:string}} JobPlan */
/** @typedef {{phase:string,before:Job[],after:Job[]}} JobIntent */
/** @typedef {{verifySafety:()=>Promise<void>,readState:()=>Promise<Job[]>,applyState:(after:Job[],before:Job[])=>Promise<void>,readRunning:()=>Promise<number>,readProof:(plan:JobPlan)=>Promise<Array<{jobname:string,startTime:string,endTime:string,status:string,returnMessage:string}>>}} JobsAdapter */
/** @param {unknown} input @param {boolean} [canonical] @returns {Job[]} */
function validateJobs(input, canonical = true) { ensure(Array.isArray(input) && input.length <= 2, 'FOREIGN_JOBS_FORBIDDEN'); const names = new Set(); for (const j of input) {
    ensure(j && Object.keys(j).length === 8 && typeof j.active === 'boolean' && j.nodename === 'localhost' && j.nodeport === 5432 && j.database === 'postgres' && j.username === 'postgres', 'UNSAFE_JOB_CONFIGURATION');
    const expected = CANONICAL_SYNTHETIC_JOBS.find(e => e.jobname === j.jobname);
    ensure(expected && !names.has(j.jobname), 'FOREIGN_JOBS_FORBIDDEN');
    names.add(j.jobname);
    if (canonical)
        ensure(j.command === expected.command && j.schedule === expected.schedule, 'UNSAFE_JOB_CONFIGURATION');
} return input; }
/** @param {Job[]} prior */
function canonicalJobs(prior) { return CANONICAL_SYNTHETIC_JOBS.map(j => ({ ...j, nodename: 'localhost', nodeport: 5432, database: 'postgres', username: 'postgres', active: prior.find(p => p.jobname === j.jobname)?.active ?? true })); }
import { createPostgresToolchain } from './logical-recovery.mjs';
import { readRecoveryMigrations } from './synthetic-source.mjs';
import { canonicalJson } from './recovery-set.mjs';
import { sha256 } from '../storage-backup-crypto.mjs';
/** @param {string} value */
const literal = value => `'${value.replaceAll("'", "''")}'`;
const JOB_ROWS = "select jobname,schedule,command,nodename,nodeport,database,username,active from cron.job order by jobname";
/** Exact source-controlled DB-only function closure. No scheduled HTTP, unknown trigger body, hook, or subscription is accepted. @param {import('./logical-recovery.mjs').DatabaseOptions & {repositoryRoot:string}} options @returns {JobsAdapter & {close:()=>Promise<void>}} */
export function createSyntheticJobsAdapter(options) {
    const tools = createPostgresToolchain(options), session = tools.session();
    /** @param {string} query */
    async function json(query) { try {
        return JSON.parse(await session.query(query));
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('JOBS_READ_FAILED');
    } }
    async function readState() { return /** @type {Job[]} */ (await json(`select coalesce(json_agg(j),'[]'::json) from (${JOB_ROWS}) j;`)); }
    async function verifySafety() {
        await tools.verifyVersions();
        ensure((await session.query(`select count(*)>0 and bool_and(coalesce(raw_app_meta_data->>'issue29_run_id'=${literal(options.scope.runId)},false)) from auth.users;`)) === 't', 'JOBS_FOREIGN_AUTH_FORBIDDEN');
        const migrations = await readRecoveryMigrations(options.repositoryRoot);
        const expected = new Map();
        for (const migration of migrations) {
            for (const match of migration.sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+((?:public|private)\.[a-z_0-9]+)\s*\([^;]*?\bas\s+(\$[a-z_0-9]*\$)([\s\S]*?)\2\s*;/giu)) {
                expected.set(match[1].toLowerCase(), match[3].trim());
            }
        }
        const funcs = await json("select coalesce(json_agg(json_build_object('name',n.nspname||'.'||p.proname,'body',p.prosrc,'language',l.lanname)),'[]'::json) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname in('public','private') and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e');");
        ensure(Array.isArray(funcs) && funcs.length > 0, 'JOBS_FUNCTION_INVENTORY_REQUIRED');
        const triggers = await json("select coalesce(json_agg(json_build_object('table',n.nspname||'.'||c.relname,'function',pn.nspname||'.'||p.proname)),'[]'::json) from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and t.tgenabled<>'D' and n.nspname in('public','private');");
        const pending = ['private.run_beta_maintenance', 'private.queue_listing_expiry_notifications'], visited = new Set();
        while (pending.length) {
            const name = pending.pop();
            if (visited.has(name))
                continue;
            visited.add(name);
            const matches = funcs.filter(f => f.name === name);
            ensure(matches.length === 1, 'JOBS_FUNCTION_INVENTORY_REQUIRED');
            const fn = matches[0];
            ensure(['plpgsql', 'sql'].includes(fn.language) && expected.get(fn.name) === fn.body.trim() && !/\b(?:net\s*\.|http_(?:get|post)|dblink|pg_notify|notify\s|execute\s)/iu.test(fn.body), 'JOBS_UNSAFE_FUNCTION_CLOSURE');
            for (const call of fn.body.matchAll(/\b((?:public|private)\.[a-z_0-9]+)\s*\(/giu))
                if (funcs.some(f => f.name === call[1]))
                    pending.push(call[1]);
            for (const mutation of fn.body.matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+((?:public|private)\.[a-z_0-9]+)/giu))
                for (const trigger of triggers)
                    if (trigger.table === mutation[1])
                        pending.push(trigger.function);
        }
        const effects = await json("select json_build_object('hooks',(select count(*) from supabase_functions.hooks),'requests',(select count(*) from net.http_request_queue),'subscriptions',(select count(*) from pg_subscription),'foreignTriggers',(select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and t.tgenabled<>'D' and n.nspname in('public','private') and pn.nspname not in('public','private')));");
        ensure(Object.values(effects).every(v => v === 0), 'JOBS_OUTBOUND_EFFECTS_FORBIDDEN');
    }
    /** All config updates are one transaction with an exact prior-state comparison. @param {Job[]} after @param {Job[]} before */
    async function applyState(after, before) {
        validateJobs(before, false);
        validateJobs(after, false);
        ensure(after.length >= before.length, 'JOBS_DELETE_FORBIDDEN');
        const changes = after.map(j => `select cron.schedule(${literal(j.jobname)},${literal(j.schedule)},${literal(j.command)});select cron.alter_job((select jobid from cron.job where jobname=${literal(j.jobname)}),active:=${j.active});`).join('\n');
        await session.query(`BEGIN; SET LOCAL statement_timeout='15s'; SELECT pg_advisory_xact_lock(29,29); DO $i29$ BEGIN IF (select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) from (${JOB_ROWS}) j) <> ${literal(canonicalJson(before))}::jsonb THEN RAISE EXCEPTION 'job state mismatch'; END IF; END $i29$; ${changes} COMMIT;`);
    }
    async function readRunning() { return Number(await session.query("select count(*) from cron.job_run_details d join cron.job j using(jobid) where d.status in('starting','running','connecting','sending') and j.jobname in('perfume-beta-maintenance','perfume-beta-expiry-notifications');")); }
    /** @param {JobPlan} plan */
    async function readProof(plan) { return json(`select coalesce(json_agg(p),'[]'::json) from (select j.jobname,r.start_time as "startTime",r.end_time as "endTime",r.status,r.return_message as "returnMessage" from cron.job j cross join lateral(select * from cron.job_run_details d where d.jobid=j.jobid and d.start_time>=${literal(plan.startedAt)}::timestamptz and d.end_time<${literal(plan.expiresAt)}::timestamptz and d.command=(case j.jobname when 'perfume-beta-maintenance' then 'select private.run_beta_maintenance(500)' else 'select private.queue_listing_expiry_notifications(500)' end)||${literal(" where statement_timestamp() < '" + plan.expiresAt + "'::timestamptz")} order by d.end_time desc limit 1)r order by j.jobname)p;`); }
    return { verifySafety, readState, applyState, readRunning, readProof, close: () => session.close() };
}
import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertPrivatePath, readPrivateManifest, writePrivateManifest } from './manifest.mjs';
import { readPrivateBytes } from './execution.mjs';
const settingsSchema = z.strictObject({ schemaVersion: z.literal(1), operation: z.literal('synthetic-jobs'), mode: z.enum(['quiesce', 'prove', 'resume']), role: z.enum(['source', 'target']), connection: z.strictObject({ host: z.string(), port: z.literal(5432), database: z.literal('postgres'), user: z.string(), password: z.string().min(1).max(1024), sslmode: z.literal('verify-full'), sslRootCert: z.enum(['system','supabase-prod-2021']).optional() }), toolchain: z.strictObject({ mode: z.literal('container') }), priorStatePath: z.string().optional() });
/** @param {unknown} value @param {string} directory @param {string} root */
async function storeEvidence(value, directory, root) { const bytes = Buffer.from(canonicalJson(value)), hash = sha256(bytes), path = join(directory, `${hash}.json`); await assertPrivatePath(path, root); let handle; try {
    handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
}
catch (error) {
    ensure(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST', 'JOBS_EVIDENCE_WRITE_FAILED');
    ensure((await readPrivateBytes(path, root)).equals(bytes), 'JOBS_EVIDENCE_HASH_MISMATCH');
    return { path, hash };
} try {
    await handle.writeFile(bytes);
    await handle.sync();
}
finally {
    await handle.close();
} return { path, hash }; }
/** @param {string} hash @param {string} directory @param {string} root */
async function readEvidence(hash, directory, root) { ensure(/^[a-f0-9]{64}$/u.test(hash), 'JOBS_EVIDENCE_HASH_MISMATCH'); const bytes = await readPrivateBytes(join(directory, `${hash}.json`), root); ensure(sha256(bytes) === hash, 'JOBS_EVIDENCE_HASH_MISMATCH'); try {
    return JSON.parse(bytes.toString());
}
catch {
    throw new OperationsError('JOBS_EVIDENCE_INVALID');
} }
/** Actual last completed job receipt, not a generic healthy flag. @param {{manifest:import('./manifest.mjs').OperationsManifest,manifestPath:string,repositoryRoot:string,role:'source'|'target'}} options */
export async function readSyntheticJobsEvidence(options) { const entry = options.manifest.history.filter(h => h.step === 'synthetic-jobs' && h.resourceId?.startsWith(`${options.role}-jobs`)).at(-1); ensure(entry && entry.resourceId === `${options.role}-jobs` && !options.manifest.pending, 'JOBS_EVIDENCE_REQUIRED'); const receipt = await readEvidence(entry.evidenceSha256, dirname(options.manifestPath), options.repositoryRoot); ensure(receipt.runId === options.manifest.runId && receipt.projectRef === (options.role === 'source' ? options.manifest.source?.ref : options.manifest.target?.ref) && receipt.role === options.role, 'JOBS_EVIDENCE_IDENTITY_MISMATCH'); return { ...receipt, evidenceSha256: entry.evidenceSha256 }; }
/** Same-manifest coordinator. Content-addressed private plans survive uncertain SQL outcomes; no alternate state file or untracked retry. @param {{manifestPath:string,settingsPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,operation:'synthetic-jobs',clock?:()=>string}} options @param {{createAdapter?:typeof createSyntheticJobsAdapter,wait?:(ms:number)=>Promise<void>}} [dependencies] */
export async function executeSyntheticJobsCommand(options, dependencies = {}) {
    const root = options.repositoryRoot, directory = dirname(options.manifestPath), clock = options.clock ?? (() => new Date().toISOString());
    await assertPrivatePath(options.manifestPath, root);
    let lock;
    try {
        lock = await open(`${options.manifestPath}.lock`, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    }
    catch {
        throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');
    }
    let adapter;
    try {
        const manifest = await readPrivateManifest(options.manifestPath, { repositoryRoot: root, candidate: options.candidate, now: clock() });
        ensure(manifest.allowedActions.includes('synthetic-jobs') && !manifest.terminal && !manifest.humanBoundary, 'JOBS_ACTION_FORBIDDEN');
        const parsed = settingsSchema.safeParse(JSON.parse((await readPrivateBytes(options.settingsPath, root)).toString()));
        ensure(parsed.success, 'PRIVATE_SETTINGS_INVALID');
        const settings = parsed.data, project = ownedProject(manifest, settings.role);
        ensure(!manifest.pending || manifest.pending.step === 'synthetic-jobs', 'PENDING_MUTATION_REQUIRES_READBACK');
        if (settings.role === 'source')
            ensure(manifest.sourceProvenance?.fixtureRunId === manifest.runId && manifest.sourceProvenance.verifiedAt && !['pause_pending', 'paused'].includes(manifest.maintenance?.phase ?? ''), 'JOBS_SOURCE_PROVENANCE_REQUIRED');
        else
            ensure(['storage_restored', 'integrity_verified', 'incident_drill_verified'].includes(manifest.state) && manifest.history.some(h=>h.step==='restore-database'&&h.resourceId===project.ref) && manifest.history.some(h=>h.step==='restore-storage'&&h.resourceId===project.ref), 'JOBS_TARGET_INTEGRITY_REQUIRED');
        const owned = manifest.cleanup.resources.find(r => r.provider === 'supabase' && r.id === project.ref && r.runId === manifest.runId);
        ensure(owned && manifest.source, 'JOBS_PROJECT_OWNERSHIP_REQUIRED');
        adapter = (dependencies.createAdapter ?? createSyntheticJobsAdapter)({ scope: { mode: 'hosted', role: settings.role, runId: manifest.runId, projectRef: project.ref, sourceRef: manifest.source.ref, preservedRefs: manifest.preservedRefs, createdResourceEvidenceSha256: owned.evidenceSha256, apiUrl: project.url }, connection: settings.connection, toolchain: settings.toolchain, repositoryRoot: root });
        await adapter.verifySafety();
        const resource = `${settings.role}-jobs`;
        const recent = manifest.history.filter(h => h.step === 'synthetic-jobs' && h.resourceId?.startsWith(resource)).at(-1);
        let planHash = manifest.pending?.priorStateSha256;
        if (!planHash && recent && recent.resourceId !== resource) {
            const phase = await readEvidence(recent.evidenceSha256, directory, root);
            planHash = phase.planSha256;
        }
        /** @type {{schemaVersion:number,runId:string,role:'source'|'target',mode:'quiesce'|'prove'|'resume',projectRef:string,candidate:import('./manifest.mjs').Candidate,plan:JobPlan}} */ let transaction;
        if (planHash) {
            transaction = await readEvidence(planHash, directory, root);
            ensure(transaction.runId === manifest.runId && transaction.role === settings.role && transaction.mode === settings.mode && transaction.projectRef === project.ref && canonicalJson(transaction.candidate) === canonicalJson(manifest.candidate), 'JOBS_PLAN_IDENTITY_MISMATCH');
        }
        else {
            let priorState = validateJobs(await adapter.readState());
            if (settings.mode === 'resume') {
                ensure(settings.priorStatePath, 'JOBS_PRIOR_STATE_REQUIRED');
                const bytes = await readPrivateBytes(settings.priorStatePath, root);
                const hash = sha256(bytes);
                ensure(manifest.history.some(h => h.step === 'synthetic-jobs' && h.resourceId === resource && h.evidenceSha256 === hash), 'JOBS_PRIOR_STATE_UNOWNED');
                const previous = JSON.parse(bytes.toString());
                ensure(previous.mode === 'quiesced' && previous.projectRef === project.ref && previous.runId === manifest.runId, 'JOBS_PRIOR_STATE_UNOWNED');
                priorState = validateJobs(previous.priorState);
            }
            const startedAt = clock();
            transaction = { schemaVersion: 1, runId: manifest.runId, role: settings.role, mode: settings.mode, projectRef: project.ref, candidate: manifest.candidate, plan: { priorState, startedAt, expiresAt: new Date(Date.parse(startedAt) + 60000).toISOString() } };
            planHash = (await storeEvidence(transaction, directory, root)).hash;
        }
        const save = () => writePrivateManifest(options.manifestPath, manifest, { repositoryRoot: root, candidate: options.candidate, now: clock(), replace: true });
        /** @param {JobIntent} intent */
        async function persistIntent(intent) { ensure(!manifest.pending, 'JOBS_MUTATION_UNCERTAIN_READBACK_ONLY'); manifest.pending = { step: 'synthetic-jobs', operationId: randomUUID(), startedAt: clock(), resourceId: `${resource}-${intent.phase}`, priorStateSha256: planHash ?? null }; await save(); }
        /** @param {JobIntent} intent */
        async function readbackVerified(intent) { const id = `${resource}-${intent.phase}`; if (manifest.pending) {
            ensure(manifest.pending.step === 'synthetic-jobs' && manifest.pending.resourceId === id && manifest.pending.priorStateSha256 === planHash, 'JOBS_PENDING_PHASE_MISMATCH');
        }
        else if (manifest.history.some(h => h.step === 'synthetic-jobs' && h.resourceId === id && h.completedAt >= transaction.plan.startedAt))
            return; const stored = await storeEvidence({ schemaVersion: 1, runId: manifest.runId, projectRef: project.ref, planSha256: planHash, phase: intent.phase, state: intent.after, checkedAt: clock() }, directory, root); manifest.history.push({ step: 'synthetic-jobs', operationId: manifest.pending?.operationId ?? randomUUID(), completedAt: clock(), resourceId: id, evidenceSha256: stored.hash }); manifest.pending = null; await save(); }
        const resumingRestore = Boolean(manifest.pending?.resourceId === `${resource}-proof-restore` || recent?.resourceId === `${resource}-proof-restore`);
        const result = await controlSyntheticJobs({ manifest, role: settings.role, mode: settings.mode, plan: transaction.plan, repositoryRoot: root, connection: settings.connection, toolchain: settings.toolchain, persistIntent, readbackVerified, clock, wait: dependencies.wait, resumingRestore }, adapter);
        const receipt = { ...result, planSha256: planHash, candidate: manifest.candidate };
        const stored = await storeEvidence(receipt, directory, root);
        manifest.history.push({ step: 'synthetic-jobs', operationId: randomUUID(), completedAt: clock(), resourceId: resource, evidenceSha256: stored.hash });
        await save();
        return { ...result, evidenceSha256: stored.hash, privateReceiptPath: stored.path };
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('JOBS_COMMAND_FAILED');
    }
    finally {
        await adapter?.close();
        await lock.close();
        await unlink(`${options.manifestPath}.lock`);
    }
}
