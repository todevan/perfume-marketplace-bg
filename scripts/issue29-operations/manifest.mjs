import { constants } from 'node:fs';
import { link, lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
/** @typedef {{sha:string, tree:string, deploymentId:string}} Candidate */
/** @typedef {{organizationId:string, ref:string, region:string, environment:string, url:string, postgresVersion:string, classification:string}} ProjectIdentity */
/** @typedef {{provider:string,id:string,runId:string,createdAt:string,evidenceSha256:string,disposition:'disposable'|'persistent',absentAt:string|null,priorStateSha256?:string}} OwnedResource */
/** @typedef {{step:string,operationId:string,startedAt:string,resourceId:string|null,priorStateSha256:string|null}} PendingIntent */
/** @typedef {{step:string,operationId:string,completedAt:string,evidenceSha256:string,resourceId:string|null}} HistoryEntry */
/** @typedef {{schemaVersion:number,issue:number,runId:string,expiresAt:string,state:string,candidate:Candidate,source:ProjectIdentity,target:ProjectIdentity|null,forbiddenRefs:string[],allowedActions:string[],capabilityIds:Record<string,string>,maximumCost:number,grafana:{stackAlias:string,destinationAlias:string,ruleAliases:string[]},backup:{destinationAlias:string,retentionDays:number,publicKeyId:string},fixture:{alias:string,classification:string},humanBoundary:string|null,cleanup:{authorized:boolean,resources:OwnedResource[]},pending:PendingIntent|null,attempts:Record<string,number>,history:HistoryEntry[],terminal:string|null}} OperationsManifest */
/** @typedef {{now?:string,candidate?:Candidate}} ValidationOptions */
/** @typedef {ValidationOptions & {repositoryRoot:string,replace?:boolean}} PrivateFileOptions */
const SHA = /^[a-f0-9]{40}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const REF = /^[a-z]{20}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ALIAS = /^[a-z0-9][a-z0-9-]{0,62}$/u;
export const STATES = Object.freeze(['planned', 'preflighted', 'implementation_verified', 'monitoring_configured', 'monitoring_proved', 'backup_started', 'backup_verified', 'target_creation_pending', 'target_read_back', 'quarantine_verified', 'database_restored', 'storage_restored', 'integrity_verified', 'incident_drill_verified', 'transient_cleanup_pending', 'cleanup_verified']);
export const ACTIONS = Object.freeze(['preflight', 'implementation-verified', 'configure-monitoring', 'monitoring-proof', 'backup-set', 'verify-backup', 'create-target', 'quarantine', 'restore-database', 'restore-storage', 'verify-restore', 'incident-drill', 'cleanup-resource', 'cleanup']);
export class OperationsError extends Error {
    /** @param {string} code */
    constructor(code) { super(`Issue #29: ${code}`); this.name = 'OperationsError'; }
}
/** @param {unknown} condition @param {string} code @returns {asserts condition} */
export function ensure(condition, code) { if (!condition)
    throw new OperationsError(code); }
/** @param {unknown} value @param {string[]} keys @returns {asserts value is Record<string, unknown>} */
function record(value, keys) { ensure(value !== null && typeof value === 'object' && !Array.isArray(value), 'MANIFEST_INVALID'); ensure(Object.keys(value).every(k => keys.includes(k)), 'MANIFEST_INVALID'); }
/** @param {unknown} value @param {RegExp} [pattern] @returns {asserts value is string} */
function textValue(value, pattern) { ensure(typeof value === 'string' && value.length > 0 && value.length <= 256 && (!pattern || pattern.test(value)), 'MANIFEST_INVALID'); }
/** @param {unknown} value @returns {asserts value is string} */
function timestamp(value) { ensure(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)), 'MANIFEST_INVALID'); }
/** @param {unknown} value @param {RegExp} pattern @returns {asserts value is string[]} */
function list(value, pattern) { ensure(Array.isArray(value) && value.length <= 1000 && new Set(value).size === value.length, 'MANIFEST_INVALID'); value.forEach(item => textValue(item, pattern)); }
/** @param {unknown} value @returns {asserts value is ProjectIdentity} */
function identity(value) { record(value, ['organizationId', 'ref', 'region', 'environment', 'url', 'postgresVersion', 'classification']); textValue(value.organizationId, ALIAS); textValue(value.ref, REF); textValue(value.region, ALIAS); textValue(value.postgresVersion, /^\d+\.\d+(?:\.\d+)?$/u); ensure(value.classification === 'synthetic-owner-controlled', 'SOURCE_CLASSIFICATION_UNPROVEN'); ensure(value.url === `https://${value.ref}.supabase.co`, 'PROJECT_URL_MISMATCH'); ensure(['staging', 'disposable', 'synthetic'].includes(String(value.environment)), 'PRODUCTION_FORBIDDEN'); }
/** Validate a private manifest; no provider payload or credential fields are accepted. @param {unknown} input @param {ValidationOptions} [options] @returns {OperationsManifest} */
export function validateManifest(input, { now = new Date().toISOString(), candidate } = {}) {
    record(input, ['schemaVersion', 'issue', 'runId', 'expiresAt', 'state', 'candidate', 'source', 'target', 'forbiddenRefs', 'allowedActions', 'capabilityIds', 'maximumCost', 'grafana', 'backup', 'fixture', 'humanBoundary', 'cleanup', 'pending', 'attempts', 'history', 'terminal']);
    ensure(input.schemaVersion === 1 && input.issue === 29, 'MANIFEST_INVALID');
    textValue(input.runId, UUID);
    timestamp(input.expiresAt);
    timestamp(now);
    ensure(Date.parse(input.expiresAt) > Date.parse(now), 'MANIFEST_EXPIRED');
    ensure(STATES.includes(String(input.state)), 'MANIFEST_INVALID');
    ensure(input.terminal === null || ['blocked', 'failed'].includes(String(input.terminal)), 'MANIFEST_INVALID');
    record(input.candidate, ['sha', 'tree', 'deploymentId']);
    textValue(input.candidate.sha, SHA);
    textValue(input.candidate.tree, SHA);
    textValue(input.candidate.deploymentId, /^[a-zA-Z0-9-]{1,128}$/u);
    if (candidate)
        ensure(candidate.sha === input.candidate.sha && candidate.tree === input.candidate.tree && candidate.deploymentId === input.candidate.deploymentId, 'CANDIDATE_MISMATCH');
    identity(input.source);
    list(input.forbiddenRefs, REF);
    ensure(input.forbiddenRefs.includes(input.source.ref), 'SOURCE_NOT_FORBIDDEN');
    if (input.target !== null) {
        identity(input.target);
        ensure(input.target.environment === 'disposable' && input.target.ref !== input.source.ref && !input.forbiddenRefs.includes(input.target.ref), 'TARGET_FORBIDDEN');
    }
    list(input.allowedActions, ALIAS);
    ensure(input.allowedActions.length > 0 && input.allowedActions.every(action => ACTIONS.includes(action)), 'MANIFEST_INVALID');
    ensure(input.maximumCost === 0, 'ZERO_COST_REQUIRED');
    record(input.capabilityIds, ['source-read', 'restore-write', 'monitoring-config', 'artifact-upload', 'cleanup']);
    for (const role of ['source-read', 'restore-write', 'monitoring-config', 'artifact-upload', 'cleanup'])
        textValue(input.capabilityIds[role], /^[a-zA-Z0-9:_-]{1,128}$/u);
    record(input.grafana, ['stackAlias', 'destinationAlias', 'ruleAliases']);
    textValue(input.grafana.stackAlias, ALIAS);
    ensure(input.grafana.destinationAlias === 'owner-primary', 'MANIFEST_INVALID');
    list(input.grafana.ruleAliases, ALIAS);
    record(input.backup, ['destinationAlias', 'retentionDays', 'publicKeyId']);
    textValue(input.backup.destinationAlias, ALIAS);
    ensure(input.backup.retentionDays === 35, 'RETENTION_INVALID');
    textValue(input.backup.publicKeyId, HASH);
    record(input.fixture, ['alias', 'classification']);
    textValue(input.fixture.alias, ALIAS);
    ensure(input.fixture.classification === 'synthetic-owner-controlled', 'SOURCE_CLASSIFICATION_UNPROVEN');
    ensure(input.humanBoundary === null || (typeof input.humanBoundary === 'string' && ALIAS.test(input.humanBoundary)), 'MANIFEST_INVALID');
    record(input.cleanup, ['authorized', 'resources']);
    ensure(input.cleanup.authorized === true && Array.isArray(input.cleanup.resources), 'CLEANUP_AUTHORITY_REQUIRED');
    const ids = new Set();
    for (const resource of input.cleanup.resources) {
        record(resource, ['provider', 'id', 'runId', 'createdAt', 'evidenceSha256', 'disposition', 'absentAt', 'priorStateSha256']);
        ensure(['supabase', 'cloudflare', 'grafana', 'github'].includes(String(resource.provider)), 'MANIFEST_INVALID');
        textValue(resource.id, /^[a-zA-Z0-9:_-]{1,128}$/u);
        ensure(resource.runId === input.runId, 'CLEANUP_OWNERSHIP_MISMATCH');
        ensure(!ids.has(resource.id), 'MANIFEST_INVALID');
        ids.add(resource.id);
        timestamp(resource.createdAt);
        textValue(resource.evidenceSha256, HASH);
        ensure(['disposable', 'persistent'].includes(String(resource.disposition)), 'MANIFEST_INVALID');
        if (resource.absentAt !== null)
            timestamp(resource.absentAt);
        if (resource.priorStateSha256 !== undefined)
            textValue(resource.priorStateSha256, HASH);
        if (resource.provider === 'supabase')
            ensure(!input.forbiddenRefs.includes(resource.id) && input.target !== null && resource.id === input.target.ref, 'TARGET_FORBIDDEN');
    }
    if (input.pending !== null) {
        record(input.pending, ['step', 'operationId', 'startedAt', 'resourceId', 'priorStateSha256']);
        ensure(input.allowedActions.includes(String(input.pending.step)), 'MANIFEST_INVALID');
        textValue(input.pending.operationId, UUID);
        timestamp(input.pending.startedAt);
        if (input.pending.resourceId !== null)
            textValue(input.pending.resourceId, /^[a-zA-Z0-9:_-]{1,128}$/u);
        if (input.pending.priorStateSha256 !== null)
            textValue(input.pending.priorStateSha256, HASH);
    }
    ensure(input.attempts !== null && typeof input.attempts === 'object' && !Array.isArray(input.attempts), 'MANIFEST_INVALID');
    for (const [key, value] of Object.entries(input.attempts))
        ensure(/^[a-zA-Z0-9:_-]{1,200}$/u.test(key) && value === 1, 'ATTEMPT_LIMIT');
    ensure(Array.isArray(input.history), 'MANIFEST_INVALID');
    for (const entry of input.history) {
        record(entry, ['step', 'operationId', 'completedAt', 'evidenceSha256', 'resourceId']);
        ensure(input.allowedActions.includes(String(entry.step)), 'MANIFEST_INVALID');
        textValue(entry.operationId, UUID);
        timestamp(entry.completedAt);
        textValue(entry.evidenceSha256, HASH);
        if (entry.resourceId !== null)
            textValue(entry.resourceId, /^[a-zA-Z0-9:_-]{1,128}$/u);
    }
    return /** @type {OperationsManifest} */ ( /** @type {unknown} */(input));
}
/** Resolve a private file path without accepting symlinks or a repository boundary escape. @param {string} path @param {string} repositoryRoot */
export async function assertPrivatePath(path, repositoryRoot) {
    try {
        ensure(isAbsolute(path), 'PRIVATE_PATH_REQUIRED');
        const root = await realpath(repositoryRoot);
        const parent = await realpath(dirname(path));
        ensure(parent === resolve(dirname(path)), 'PRIVATE_SYMLINK_FORBIDDEN');
        const rel = relative(root, parent);
        ensure(rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel), 'PRIVATE_PATH_IN_REPOSITORY');
        const stat = await lstat(parent);
        ensure(stat.isDirectory() && (stat.mode & 0o777) === 0o700 && (process.getuid === undefined || stat.uid === process.getuid()), 'PRIVATE_DIRECTORY_MODE_REQUIRED');
        try {
            const current = await lstat(path);
            ensure(current.isFile() && !current.isSymbolicLink() && current.nlink === 1 && (current.mode & 0o777) === 0o600 && (process.getuid === undefined || current.uid === process.getuid()), 'PRIVATE_FILE_MODE_REQUIRED');
        }
        catch (error) {
            if ( /** @type {NodeJS.ErrnoException} */(error).code !== 'ENOENT')
                throw error;
        }
        return resolve(path);
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('PRIVATE_PATH_INVALID');
    }
}
/** @param {string} path @param {PrivateFileOptions} options @returns {Promise<OperationsManifest>} */
export async function readPrivateManifest(path, options) {
    await assertPrivatePath(path, options.repositoryRoot);
    try {
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const stat = await handle.stat();
            ensure((stat.mode & 0o777) === 0o600 && stat.nlink === 1 && stat.size <= 1048576, 'PRIVATE_FILE_MODE_REQUIRED');
            return validateManifest(JSON.parse(await handle.readFile('utf8')), options);
        }
        finally {
            await handle.close();
        }
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('PRIVATE_MANIFEST_UNREADABLE');
    }
}
/** Atomic writes; creation never overwrites an existing manifest. Caller must hold the transaction lock for replacement. @param {string} path @param {unknown} value @param {PrivateFileOptions} options */
export async function writePrivateManifest(path, value, options) {
    const validated = validateManifest(value, options);
    await assertPrivatePath(path, options.repositoryRoot);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try {
            await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`);
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        if (options.replace)
            await rename(temporary, path);
        else
            await link(temporary, path);
        const directory = await open(dirname(path), constants.O_RDONLY);
        try {
            await directory.sync();
        }
        finally {
            await directory.close();
        }
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('PRIVATE_MANIFEST_WRITE_FAILED');
    }
    finally {
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT')
            throw new OperationsError('PRIVATE_TEMP_CLEANUP_FAILED'); });
    }
}
/** @typedef {'source-read'|'restore-write'|'monitoring-config'|'artifact-upload'|'cleanup'} Capability */
/** @typedef {ProjectIdentity & {status:string,plan:string,cost:number,owned:boolean,freeCapacity:boolean,credential:{id:string,role:string,projectRef:string,organizationId:string},candidate:Candidate,isolation:{productionRoutes:boolean,stagingRoutes:boolean,foreignSecrets:boolean,foreignUsers:boolean,foreignData:boolean,foreignObjects:boolean,outboundEffects:boolean}}} ProjectReadback */
/** Read-only guard shared by operator actions; readback is normalized at the provider adapter boundary. @param {unknown} input @param {ProjectReadback} observed @param {{role:Capability,now?:string,requireEmpty?:boolean,scope?:'source'|'target'}} options @returns {ProjectIdentity} */
export function assertExactTarget(input, observed, { role, now, requireEmpty = true, scope = role === 'source-read' ? 'source' : 'target' }) {
    const manifest = validateManifest(input, { now });
    const expected = scope === 'source' ? manifest.source : manifest.target;
    ensure(expected, 'TARGET_IDENTITY_REQUIRED');
    ensure(observed && Object.entries(expected).every(([key, value]) => observed[ /** @type {keyof ProjectIdentity} */(key)] === value), 'TARGET_IDENTITY_MISMATCH');
    ensure(observed.status === 'ACTIVE_HEALTHY', 'TARGET_STATUS_MISMATCH');
    ensure(observed.plan === 'free' && observed.cost === 0 && observed.freeCapacity === true, 'ZERO_COST_REQUIRED');
    ensure(observed.owned === true, 'PROJECT_OWNERSHIP_UNPROVEN');
    ensure(observed.credential?.role === role && observed.credential.id === manifest.capabilityIds[role] && observed.credential.projectRef === expected.ref && observed.credential.organizationId === expected.organizationId, 'CREDENTIAL_ROLE_MISMATCH');
    ensure(observed.candidate?.sha === manifest.candidate.sha && observed.candidate.tree === manifest.candidate.tree && observed.candidate.deploymentId === manifest.candidate.deploymentId, 'CANDIDATE_MISMATCH');
    if (scope === 'target') {
        ensure(observed.isolation?.productionRoutes === false && observed.isolation.stagingRoutes === false && observed.isolation.foreignSecrets === false && observed.isolation.outboundEffects === false, 'QUARANTINE_UNPROVEN');
        if (requireEmpty)
            ensure(observed.isolation.foreignUsers === false && observed.isolation.foreignData === false && observed.isolation.foreignObjects === false, 'TARGET_FOREIGN_STATE');
    }
    return { ...expected };
}
/** A child cannot inherit arbitrary machine credentials, runtime hooks, or config paths. @param {Record<string,string|undefined>} environment @param {Capability} capability @returns {Record<string,string>} */
export function buildChildEnvironment(environment, capability) {
    const common = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR'];
    const roles = { 'source-read': ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'PGSSLROOTCERT'], 'restore-write': ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'PGSSLROOTCERT'], 'monitoring-config': ['GRAFANA_TOKEN'], 'artifact-upload': ['GH_TOKEN'], cleanup: ['ISSUE29_CLEANUP_TOKEN'] };
    ensure(Object.hasOwn(roles, capability), 'CREDENTIAL_ROLE_MISMATCH');
    return Object.fromEntries([...common, ...roles[capability]].flatMap(name => typeof environment[name] === 'string' ? [[name, /** @type {string} */ (environment[name])]] : []));
}
