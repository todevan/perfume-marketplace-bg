import { z } from 'zod';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { assertPrivatePath, assertOwnedSource, ensure, OperationsError, readPrivateManifest, validateManifest, writePrivateManifest } from './manifest.mjs';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { captureManagedBaseline, POSTGRES_IMAGE, SUPABASE_CLI_VERSION } from './logical-recovery.mjs';
import { verifyEncryptedArtifactDirectory, verifyGitHubArtifact } from './artifact-store.mjs';
import { createMonitorHeartbeatAdapter } from './monitor-heartbeat.mjs';
import { canonicalJson } from './recovery-set.mjs';
const execFile = promisify(execFileCallback);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const contextSchema = z.strictObject({ repository: z.literal('todevan/perfume-marketplace-bg'), repositoryId: z.number().int().positive(), eventName: z.enum(['schedule', 'workflow_dispatch']), ref: z.literal('refs/heads/main'), refProtected: z.literal(true), workflowRef: z.literal('todevan/perfume-marketplace-bg/.github/workflows/operations-backup.yml@refs/heads/main'), sha: z.string().regex(/^[a-f0-9]{40}$/u), workflowSha: z.string(), runId: z.number().int().positive(), runAttempt: z.literal(1) });
/** @typedef {z.infer<typeof contextSchema>} AutomationContext */
/** @param {unknown} value @returns {AutomationContext} */
export function validateAutomationContext(value) {
    const parsed = contextSchema.safeParse(value);
    ensure(parsed.success && parsed.data.sha === parsed.data.workflowSha, 'UNTRUSTED_AUTOMATION_CONTEXT');
    return parsed.data;
}
const settingsSchema = z.strictObject({ deployment: z.strictObject({ accountId: z.string().regex(/^[a-f0-9]{32}$/u), workerName: z.string().regex(/^issue29-[a-z0-9-]+$/u), versionId: z.string().uuid(), origin: z.string().url(), readToken: z.string().min(10).max(4096) }), schemaVersion: z.literal(1), operation: z.literal('backup-set'), providerToken: z.string().min(10).max(1024),
    connection: z.strictObject({ host: z.string().min(1).max(256), port: z.literal(5432), database: z.literal('postgres'), user: z.string().min(1).max(128), password: z.string().min(1).max(1024), sslmode: z.literal('verify-full'), sslRootCert: z.enum(['system','supabase-prod-2021']).optional() }),
    toolchain: z.strictObject({ mode: z.literal('container') }), source: z.strictObject({ apiUrl: z.string().url(), serviceKey: z.string().min(10).max(4096) }),
    managedBaseline: z.strictObject({ path: z.string(), sha256: hash }), ownerPublicKeyPath: z.string(), outputDirectory: z.string(), privateDirectory: z.string() });
const costSchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('github-personal-budget-ui-readback'), account: z.literal('todevan'), product: z.literal('actions'), budgetUsd: z.literal(0), stopUsage: z.literal(true), capturedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), capturedEvidenceSha256: hash, attestedBy: z.literal('owner') });
const authorizationSchema = z.strictObject({ costAuthorization: costSchema, manifest: z.unknown(), settings: settingsSchema, maxArtifactBytes: z.number().int().positive().max(1100000000) });
/** @typedef {z.infer<typeof settingsSchema>} AutomationSettings */
/** Create only private runner-local files from owner-provisioned CURRENT lifecycle authorization.
 * This is not a source provisioner: no expiry, ownership or source state is manufactured.
 * @param {{authorizationJson:string,publicKeyPem:string,context:unknown,runnerTemp:string,repositoryRoot:string,now?:string}} options
 */
export async function prepareBackupAutomation(options) {
    const context = validateAutomationContext(options.context);
    const now = options.now ?? new Date().toISOString();
    ensure(options.authorizationJson.length <= 60000 && options.publicKeyPem.length <= 8192 && /^-----BEGIN PUBLIC KEY-----\n/u.test(options.publicKeyPem) && !options.publicKeyPem.includes('PRIVATE'), 'AUTOMATION_AUTHORIZATION_INVALID');
    let value;
    try {
        value = JSON.parse(options.authorizationJson);
    }
    catch {
        throw new OperationsError('AUTOMATION_AUTHORIZATION_INVALID');
    }
    const parsed = authorizationSchema.safeParse(value);
    ensure(parsed.success, 'AUTOMATION_AUTHORIZATION_INVALID');
    const cost = validateCostAuthorization(parsed.data.costAuthorization, now);
    const manifest = validateManifest(parsed.data.manifest, { now });
    const source = assertOwnedSource(manifest);
    ensure(manifest.candidate.sha === context.sha && manifest.pending === null && manifest.terminal === null && manifest.humanBoundary === null && ['monitoring_proved','backup_verified','cleanup_verified'].includes(manifest.state) && (manifest.target === null || manifest.cleanup.resources.some(r=>r.provider==='supabase'&&r.id===manifest.target?.ref&&r.disposition==='disposable'&&r.absentAt!==null)), 'AUTOMATION_MANIFEST_NOT_READY');
    ensure(['backup-set', 'artifact-upload', 'backup-heartbeat'].every(action => manifest.allowedActions.includes(action)), 'AUTOMATION_ACTIONS_REQUIRED');
    const authorizationSha256=digest(options.authorizationJson),contextSha256=digest(canonicalJson(context));
    const executionId=backupExecutionId(authorizationSha256,context);
    ensure(!manifest.history.some(entry=>entry.operationId===executionId)&&!manifest.attempts[`backup-set:${executionId}`], 'AUTOMATION_ALREADY_ATTEMPTED');
    const settings = parsed.data.settings;
    ensure(settings.deployment.workerName===`issue29-${manifest.runId}`&&settings.deployment.versionId===manifest.candidate.deploymentId,'AUTOMATION_DEPLOYMENT_MISMATCH');
    ensure(settings.source.apiUrl === source.url && (settings.connection.host === `db.${source.ref}.supabase.co` && settings.connection.user === 'postgres' || /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/u.test(settings.connection.host) && settings.connection.user === `postgres.${source.ref}`), 'AUTOMATION_SOURCE_MISMATCH');
    let key;
    try {
        key = createPublicKey(options.publicKeyPem);
    }
    catch {
        throw new OperationsError('OWNER_PUBLIC_KEY_UNSUPPORTED');
    }
    ensure(key.asymmetricKeyType === 'rsa' && Number(key.asymmetricKeyDetails?.modulusLength) >= 3072 && digest(key.export({ type: 'spki', format: 'der' })) === manifest.backup.publicKeyId, 'OWNER_PUBLIC_KEY_MISMATCH');
    ensure(isAbsolute(options.runnerTemp) && await realpath(options.runnerTemp) === resolve(options.runnerTemp), 'RUNNER_DIRECTORY_INVALID');
    const directory = await mkdtemp(join(options.runnerTemp, `issue29-backup-${context.runId}-`));
    await chmod(directory, 0o700);
    await assertPrivatePath(join(directory, 'manifest.json'), options.repositoryRoot);
    const result = { directory, manifestPath: join(directory, 'manifest.json'), settingsPath: join(directory, 'settings.json'), ownerPublicKeyPath: join(directory, 'owner-public.pem'), outputDirectory: join(directory, 'published'), privateDirectory: join(directory, 'private'), downloadDirectory: join(directory, 'downloaded'), baselineDirectory: join(directory, 'baseline'), maxArtifactBytes: parsed.data.maxArtifactBytes };
    try {
        for (const path of [result.privateDirectory, result.downloadDirectory, result.baselineDirectory])
            await mkdir(path, { mode: 0o700 });
        await writePrivateManifest(result.manifestPath, manifest, { repositoryRoot: options.repositoryRoot, now });
        await writePrivate(result.ownerPublicKeyPath, options.publicKeyPem);
        await writePrivate(join(directory, 'cost-readback.json'), canonicalJson(cost));
        await writePrivate(join(directory,'authorization.json'),options.authorizationJson);
        await writePrivate(result.settingsPath, canonicalJson({ ...settings, executionId, ownerPublicKeyPath: result.ownerPublicKeyPath, outputDirectory: result.outputDirectory, privateDirectory: result.privateDirectory, managedBaseline: { ...settings.managedBaseline, path: join(directory, 'baseline.json') } }));
        await writePrivate(join(directory, 'runner-lease.json'), canonicalJson({ schemaVersion: 1, authorizationSha256, contextSha256, executionId, preparedAt:now, authorizationExpiresAt:manifest.expiresAt, runId: context.runId, runAttempt: context.runAttempt, manifestRunId: manifest.runId, directory, repositoryRoot: await realpath(options.repositoryRoot), maxArtifactBytes: result.maxArtifactBytes }));
        return result;
    }
    catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
    }
}
/** Execution identity is stable only for this exact trusted run and immutable owner authorization.
 * Source run/provenance is never relabeled to this ID. @param {string} authorizationSha256 @param {AutomationContext} context */
function backupExecutionId(authorizationSha256,context){const hex=digest(canonicalJson({authorizationSha256,context})).split('');hex[12]='4';hex[16]=(8+(parseInt(hex[16],16)&3)).toString(16);const h=hex.join('').slice(0,32);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
/** @param {string|Buffer} value */
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
/** @param {string} path @param {string} value */
async function writePrivate(path, value) { const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); try {
    await file.writeFile(value);
    await file.sync();
}
finally {
    await file.close();
} }
/** Reconcile a crash after writing a private readback but before advancing the manifest. Only the
 * observation time may differ; an actual fresh provider read has already matched every other field.
 * @template {Record<string,any>} T @param {string} path @param {T} value @param {string} repositoryRoot @param {number} maximumAge @returns {Promise<T>} */
async function persistReadback(path,value,repositoryRoot,maximumAge){
 try{await writePrivate(path,canonicalJson(value));return value;}catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='EEXIST')throw error;}
 const existing=await readPrivateJson(path,repositoryRoot),before=structuredClone(existing),after=structuredClone(value);
 const oldTime=before.artifact?.verifiedAt??before.verifiedAt,newTime=after.artifact?.verifiedAt??after.verifiedAt;
 ensure(typeof oldTime==='string'&&typeof newTime==='string'&&Date.parse(newTime)>=Date.parse(oldTime)&&Date.parse(newTime)-Date.parse(oldTime)<=maximumAge,'READBACK_RESUME_MISMATCH');
 if(before.artifact){delete before.artifact.verifiedAt;delete after.artifact.verifiedAt;}else{delete before.verifiedAt;delete after.verifiedAt;}
 ensure(canonicalJson(before)===canonicalJson(after),'READBACK_RESUME_MISMATCH');return /** @type {T} */(existing);
}
/** @param {string} path @param {string} repositoryRoot @param {number} [limit] */
async function readPrivateJson(path, repositoryRoot, limit = 60000) {
    await assertPrivatePath(path, repositoryRoot);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const info = await file.stat();
        ensure(info.isFile() && info.nlink === 1 && (info.mode & 0o777) === 0o600 && info.size <= limit, 'AUTOMATION_FILE_UNSAFE');
        return JSON.parse(await file.readFile('utf8'));
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('AUTOMATION_FILE_INVALID');
    }
    finally {
        await file.close();
    }
}
/** Runner-local bootstrap; only the pinned local fixture can reconstruct the managed baseline.
 * A matching Postgres major is NOT evidence that hosted Auth/Storage base schemas match.
 * @param {{directory:string,repositoryRoot:string,context:unknown,now?:string}} options
 */
export async function reconstructRunnerBaseline(options) {
    const context = validateAutomationContext(options.context), now = options.now ?? new Date().toISOString();
    const directory = await validatedRunnerDirectory(options.directory, options.repositoryRoot, context);
    const manifest = await readPrivateManifest(join(directory, 'manifest.json'), { repositoryRoot: options.repositoryRoot, now });
    assertOwnedSource(manifest);
    const settings = settingsSchema.parse(await readPrivateJson(join(directory, 'settings.json'), options.repositoryRoot));
    const baselineDirectory = join(directory, 'baseline'), cli = join(options.repositoryRoot, 'node_modules/.bin/supabase');
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: baselineDirectory, LANG: 'C.UTF-8', SUPABASE_TELEMETRY_DISABLED: 'true' };
    const version = await privateCommand(cli, ['--version'], env);
    ensure(version.trim() === SUPABASE_CLI_VERSION, 'PINNED_TOOLCHAIN_REQUIRED');
    const projectId = `issue29-recovery-runner-${context.runId}`;
    await privateCommand(cli, ['init', '--workdir', baselineDirectory, '--yes'], env);
    const configPath = join(baselineDirectory, 'supabase/config.toml');
    let config = await readFile(configPath, 'utf8');
    ensure(/^project_id = /mu.test(config) && /^major_version = 17$/mu.test(config), 'LOCAL_BASELINE_CONFIG_UNSUPPORTED');
    config = config.replace(/^project_id = .*$/mu, `project_id = "${projectId}"`);
    await writeFile(configPath, config, { mode: 0o600 });
    // Unique workdir/project ID is captured before start; always-cleanup stops exactly this fixture.
    await writePrivate(join(directory, 'baseline-intent.json'), canonicalJson({ projectId, workdir: baselineDirectory }));
    await privateCommand(cli, ['start', '--workdir', baselineDirectory, '--yes'], env);
    const imageId = (await privateCommand('docker', ['inspect', `supabase_db_${projectId}`, '--format', '{{.Image}}'], env)).trim();
    ensure(/^sha256:[a-f0-9]{64}$/u.test(imageId), 'LOCAL_BASELINE_IMAGE_UNPROVEN');
    const digests = JSON.parse(await privateCommand('docker', ['image', 'inspect', imageId, '--format', '{{json .RepoDigests}}'], env));
    ensure(Array.isArray(digests) && digests.includes(POSTGRES_IMAGE), 'PINNED_TOOLCHAIN_REQUIRED');
    const scope = { mode: /** @type {const} */ ('local'), role: /** @type {const} */ ('source'), runId: manifest.runId, projectRef: 'l'.repeat(20), sourceRef: 'l'.repeat(20), preservedRefs: manifest.preservedRefs, createdResourceEvidenceSha256: digest(canonicalJson({ projectId, imageId })), apiUrl: 'http://127.0.0.1:54321' };
    const baseline = await captureManagedBaseline({ scope, connection: { host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres', sslmode: 'disable' }, toolchain: { mode: 'container' } });
    ensure(baseline.schemaSha256 === settings.managedBaseline.sha256, 'MANAGED_BASE_SCHEMA_DRIFT');
    await writePrivate(settings.managedBaseline.path, canonicalJson(baseline));
    return { schemaSha256: baseline.schemaSha256, postgresVersion: baseline.postgresVersion };
}
/** @param {string} file @param {string[]} args @param {Record<string,string>} env */
async function privateCommand(file, args, env) {
    try {
        const result = await execFile(file, args, { env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 600000 });
        return result.stdout;
    }
    catch {
        throw new OperationsError('RUNNER_PRIVATE_COMMAND_FAILED');
    }
}
/** @param {string} directory @param {string} repositoryRoot @param {AutomationContext} context */
async function validatedRunnerDirectory(directory, repositoryRoot, context) {
    await assertPrivatePath(join(directory, 'runner-lease.json'), repositoryRoot);
    const lease = await readPrivateJson(join(directory, 'runner-lease.json'), repositoryRoot);
    ensure(lease.schemaVersion === 1 && lease.directory === directory && lease.repositoryRoot === await realpath(repositoryRoot) && lease.runId === context.runId && lease.runAttempt === context.runAttempt && new RegExp(`^issue29-backup-${context.runId}-[A-Za-z0-9]+$`, 'u').test(basename(directory)), 'RUNNER_CLEANUP_OWNERSHIP_MISMATCH');
    await assertPrivatePath(join(directory,'authorization.json'),repositoryRoot);
    const authFile=await open(join(directory,'authorization.json'),constants.O_RDONLY|constants.O_NOFOLLOW);let bytes;try{const info=await authFile.stat();ensure(info.isFile()&&info.nlink===1&&(info.mode&0o777)===0o600&&info.size<=60000,'AUTOMATION_FILE_UNSAFE');bytes=await authFile.readFile();}finally{await authFile.close();}
    ensure(digest(bytes)===lease.authorizationSha256&&lease.contextSha256===digest(canonicalJson(context))&&lease.executionId===backupExecutionId(lease.authorizationSha256,context),'RUNNER_AUTHORIZATION_BINDING_MISMATCH');
    return directory;
}
/** Remove only this run's private ephemeral directory and local fixture; never provider artifacts.
 * @param {{directory:string,repositoryRoot:string,context:unknown}} options
 */
export async function cleanupBackupAutomation(options) {
    const context = validateAutomationContext(options.context);
    const directory = await validatedRunnerDirectory(options.directory, options.repositoryRoot, context);
    let localCleanupFailed = false;
    try {
        const intentPath = join(directory, 'baseline-intent.json');
        if (await lstat(intentPath).catch(error => { if (error.code === 'ENOENT')
            return null; throw error; })) {
            const intent = await readPrivateJson(intentPath, options.repositoryRoot);
            ensure(intent.projectId === `issue29-recovery-runner-${context.runId}` && intent.workdir === join(directory, 'baseline'), 'RUNNER_CLEANUP_OWNERSHIP_MISMATCH');
            await privateCommand(join(options.repositoryRoot, 'node_modules/.bin/supabase'), ['stop', '--workdir', intent.workdir, '--no-backup'], { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: intent.workdir, LANG: 'C.UTF-8', SUPABASE_TELEMETRY_DISABLED: 'true' });
            const remaining = await privateCommand('docker', ['ps', '-a', '--filter', `label=com.supabase.cli.project=${intent.projectId}`, '--format', '{{.ID}}'], { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' });
            ensure(remaining.trim() === '', 'RUNNER_LOCAL_CLEANUP_UNPROVEN');
            const volumes = await privateCommand('docker', ['volume', 'ls', '--filter', `label=com.supabase.cli.project=${intent.projectId}`, '--format', '{{.Name}}'], { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' });
            ensure(volumes.trim() === '', 'RUNNER_LOCAL_CLEANUP_UNPROVEN');
        }
    }
    catch {
        localCleanupFailed = true;
    }
    finally {
        await rm(directory, { recursive: true, force: false });
    }
    ensure(!localCleanupFailed, 'RUNNER_LOCAL_CLEANUP_UNPROVEN');
    return { privateFilesRemoved: true };
}
/** @typedef {{manifestPath:string,repositoryRoot:string,context:unknown,directory:string,outputDirectory:string,downloadDirectory:string,maxArtifactBytes:number,expectedDescriptorSha256:string,executionId:string,now?:string}} PublicationOptions */
/** Persist intent before handing exact verified encrypted inputs to upload-artifact. A pending upload
 * is readback-only; a rerun may not allocate another artifact or reset the transaction.
 * @param {PublicationOptions} options
 */
export async function preparePublication(options) {
    return withManifest(options, async (manifest, context, save) => {
        ensure(manifest.pending === null, 'PENDING_OPERATION_REQUIRES_READBACK');
        ensure(manifest.state === 'backup_started' && !manifest.attempts[`artifact-upload:${options.executionId}`] && manifest.allowedActions.includes('artifact-upload'), 'STATE_TRANSITION_FORBIDDEN');
        let verified;
        try{verified=await boundRecovery(options,manifest);}catch(error){
            if(error instanceof OperationsError&&['DESCRIPTOR_HASH_MISMATCH','ARTIFACT_COMPONENT_INVENTORY_MISMATCH','ARTIFACT_COMPONENT_INTEGRITY_MISMATCH'].some(code=>error.message===`Issue #29: ${code}`)){await writePrivate(join(options.directory,'backup-failure.json'),canonicalJson({schemaVersion:1,executionId:options.executionId,candidateSha:manifest.candidate.sha,descriptorSha256:options.expectedDescriptorSha256,detectedAt:options.now??new Date().toISOString(),reasonCode:'backup_integrity_failed'}));}
            throw error;
        }
        const cost = validateCostAuthorization(await readPrivateJson(join(options.directory, 'cost-readback.json'), options.repositoryRoot), options.now ?? new Date().toISOString());
        const artifactName = `issue29-recovery-${context.runId}-${context.runAttempt}`;
        const receipt = { schemaVersion: 1, kind: 'issue29-publication-intent', manifestRunId: manifest.runId, context, artifactName, costEvidenceSha256: digest(canonicalJson(cost)), descriptorSha256: verified.descriptorSha256, componentInventorySha256: verified.componentInventorySha256, maxArtifactBytes: options.maxArtifactBytes };
        await writePrivate(join(options.directory, 'publication.json'), canonicalJson(receipt));
        manifest.state = 'artifact_upload_pending';
        manifest.attempts[`artifact-upload:${options.executionId}`] = 1;
        manifest.pending = { step: 'artifact-upload', operationId: randomUUID(), startedAt: options.now ?? new Date().toISOString(), resourceId: artifactName, priorStateSha256: digest(canonicalJson(receipt)) };
        await save();
        return { artifactName, descriptorSha256: verified.descriptorSha256, fileNames: verified.fileNames };
    });
}
/** @param {PublicationOptions} options @param {import('./manifest.mjs').OperationsManifest} manifest */
async function boundRecovery(options, manifest) {
    const source = assertOwnedSource(manifest);
    ensure(manifest.history.some(entry => entry.step === 'backup-set' && entry.operationId===options.executionId && entry.evidenceSha256 === options.expectedDescriptorSha256), 'BACKUP_CREATION_PROVENANCE_REQUIRED');
    const result = await verifyEncryptedArtifactDirectory({ directory: options.outputDirectory, repositoryRoot: options.repositoryRoot, expectedDescriptorSha256: options.expectedDescriptorSha256, maxBytes: options.maxArtifactBytes });
    ensure(result.descriptor.metadata.backupSetId===options.executionId,'BACKUP_EXECUTION_MISMATCH');
    const d = result.descriptor, age = Date.parse(options.now ?? new Date().toISOString()) - Date.parse(d.metadata.startedAt);
    ensure(d.metadata.source.projectRef === source.ref && d.metadata.source.organizationId === source.organizationId && d.metadata.source.region === source.region && d.metadata.release.commitSha === manifest.candidate.sha && d.metadata.release.treeSha === manifest.candidate.tree && d.metadata.release.workerVersion === manifest.candidate.deploymentId && d.encryption.keyId === manifest.backup.publicKeyId && d.metadata.destinationAlias === manifest.backup.destinationAlias && age >= -300000 && age <= 86400000, 'BACKUP_PUBLICATION_BINDING_MISMATCH');
    return result;
}
/** @template T @param {PublicationOptions} options @param {(manifest:import('./manifest.mjs').OperationsManifest,context:AutomationContext,save:()=>Promise<void>)=>Promise<T>} work */
async function withManifest(options, work) {
    const context = validateAutomationContext(options.context), now = () => options.now ?? new Date().toISOString();
    const directory = await validatedRunnerDirectory(options.directory, options.repositoryRoot, context);
    ensure(options.manifestPath === join(directory, 'manifest.json') && options.outputDirectory === join(directory, 'published') && options.downloadDirectory === join(directory, 'downloaded'), 'RUNNER_PATH_MISMATCH');
    const lease = await readPrivateJson(join(directory, 'runner-lease.json'), options.repositoryRoot);
    ensure(options.executionId===lease.executionId,'BACKUP_EXECUTION_MISMATCH');
    ensure(options.maxArtifactBytes === lease.maxArtifactBytes, 'ARTIFACT_SIZE_AUTHORIZATION_MISMATCH');
    const lockPath = `${options.manifestPath}.lock`;
    let lock;
    try {
        lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    }
    catch {
        throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');
    }
    try {
        const manifest = await readPrivateManifest(options.manifestPath, { repositoryRoot: options.repositoryRoot, now: now() });
        ensure(manifest.candidate.sha === context.sha && manifest.runId === lease.manifestRunId && manifest.terminal === null && manifest.humanBoundary === null, 'AUTOMATION_MANIFEST_NOT_READY');
        ensure(Date.parse(lease.preparedAt)<=Date.parse(now())&&Date.parse(now())<Date.parse(lease.authorizationExpiresAt),'AUTOMATION_AUTHORIZATION_EXPIRED');
        const original=await readPrivateJson(join(directory,'authorization.json'),options.repositoryRoot);
        ensure(canonicalJson(manifest.source)===canonicalJson(original.manifest.source)&&canonicalJson(manifest.sourceProvenance)===canonicalJson(original.manifest.sourceProvenance)&&canonicalJson(manifest.candidate)===canonicalJson(original.manifest.candidate),'RUNNER_AUTHORIZATION_BINDING_MISMATCH');
        const save = () => writePrivateManifest(options.manifestPath, manifest, { repositoryRoot: options.repositoryRoot, now: now(), replace: true });
        return await work(manifest, context, save);
    }
    finally {
        await lock.close();
        await unlink(lockPath);
    }
}
/** Readback only: this function never uploads, overwrites or deletes an artifact.
 * @param {PublicationOptions & {artifactId:number,archiveSha256:string,token:string,fetchImpl?:typeof fetch}} options
 */
export async function finalizeArtifact(options) {
    return withManifest(options, async (manifest, context, save) => {
        ensure(manifest.state === 'artifact_upload_pending' && manifest.pending?.step === 'artifact-upload', 'PENDING_UPLOAD_REQUIRED');
        const pending = manifest.pending;
        const publication = await readPrivateJson(join(options.directory, 'publication.json'), options.repositoryRoot);
        ensure(digest(canonicalJson(publication)) === pending.priorStateSha256 && publication.descriptorSha256 === options.expectedDescriptorSha256 && publication.artifactName === pending.resourceId, 'PUBLICATION_PROVENANCE_MISMATCH');
        const verified = await boundRecovery(options, manifest);
        const roundtrip = await verifyEncryptedArtifactDirectory({ directory: options.downloadDirectory, repositoryRoot: options.repositoryRoot, expectedDescriptorSha256: options.expectedDescriptorSha256, maxBytes: options.maxArtifactBytes, downloaded: true });
        ensure(roundtrip.componentInventorySha256 === verified.componentInventorySha256, 'ARTIFACT_COMPONENT_INTEGRITY_MISMATCH');
        const artifact = await verifyGitHubArtifact({ repository: context.repository, repositoryId: context.repositoryId, runId: context.runId, runAttempt: context.runAttempt, candidateSha: context.sha, artifactId: options.artifactId, artifactName: publication.artifactName, expectedArchiveSha256: options.archiveSha256, maxBytes: options.maxArtifactBytes, token: options.token, now: options.now, fetchImpl: options.fetchImpl });
        ensure(Date.parse(artifact.createdAt) >= Date.parse(pending.startedAt) - 1000, 'ARTIFACT_CREATION_PROVENANCE_MISMATCH');
        const observedReceipt = { schemaVersion: 1, kind: 'issue29-artifact-publication', manifestRunId: manifest.runId, descriptorSha256: verified.descriptorSha256, componentInventorySha256: verified.componentInventorySha256, artifact };
        const receipt=await persistReadback(join(options.directory,'artifact-readback.json'),observedReceipt,options.repositoryRoot,86400000);
        const evidenceSha256 = digest(canonicalJson(receipt));
        manifest.history.push({ step: 'artifact-upload', operationId: pending.operationId, completedAt: receipt.artifact.verifiedAt, evidenceSha256, resourceId: String(artifact.artifactId) });
        manifest.cleanup.resources.push({ provider: 'github', id: String(artifact.artifactId), runId: manifest.runId, createdAt: artifact.createdAt, evidenceSha256, disposition: 'persistent', absentAt: null });
        manifest.pending = null;
        manifest.state = 'artifact_verified';
        await save();
        return receipt;
    });
}
/** Exactly-once heartbeat submission; repeated calls with an existing pending intent do NOT POST.
 * @param {PublicationOptions & {heartbeatConfig:import('./monitor-heartbeat.mjs').HeartbeatConfig,fetchImpl?:typeof fetch}} options
 */
export async function beginHeartbeat(options) {
    return withManifest(options, async (manifest, _context, save) => {
        ensure(manifest.allowedActions.includes('backup-heartbeat'), 'ACTION_FORBIDDEN');
        const data = await heartbeatInputs(options, manifest);
        if (manifest.pending !== null) {
            ensure(manifest.state === 'backup_heartbeat_pending' && manifest.pending.step === 'backup-heartbeat' && manifest.pending.priorStateSha256 === digest(canonicalJson(data.heartbeat)), 'PENDING_OPERATION_REQUIRES_READBACK');
            return { status: 'readback-only' };
        }
        ensure(manifest.state === 'artifact_verified' && !manifest.attempts[`backup-heartbeat:${options.executionId}`], 'STATE_TRANSITION_FORBIDDEN');
        manifest.pending = { step: 'backup-heartbeat', operationId: randomUUID(), startedAt: options.now ?? new Date().toISOString(), resourceId: data.heartbeat.artifactId, priorStateSha256: digest(canonicalJson(data.heartbeat)) };
        manifest.attempts[`backup-heartbeat:${options.executionId}`] = 1;
        manifest.state = 'backup_heartbeat_pending';
        await save();
        // Provider timeout leaves the persisted intent intact. A later invocation may only query.
        return data.adapter.publishBackupHeartbeat(data.heartbeat);
    });
}
/** @param {PublicationOptions & {heartbeatConfig:import('./monitor-heartbeat.mjs').HeartbeatConfig,fetchImpl?:typeof fetch}} options */
export async function finalizeHeartbeat(options) {
    return withManifest(options, async (manifest, _context, save) => {
        ensure(manifest.state === 'backup_heartbeat_pending' && manifest.pending?.step === 'backup-heartbeat', 'PENDING_HEARTBEAT_REQUIRED');
        const data = await heartbeatInputs(options, manifest), pending = manifest.pending;
        ensure(pending.resourceId === data.heartbeat.artifactId && pending.priorStateSha256 === digest(canonicalJson(data.heartbeat)), 'HEARTBEAT_PROVENANCE_MISMATCH');
        const observed=await data.adapter.verifyBackupHeartbeat(data.heartbeat);
        const verified=await persistReadback(join(options.directory,'heartbeat-readback.json'),observed,options.repositoryRoot,300000);
        manifest.history.push({ step: 'backup-heartbeat', operationId: pending.operationId, completedAt: verified.verifiedAt, evidenceSha256: digest(canonicalJson(verified)), resourceId: verified.artifactId });
        manifest.pending = null;
        manifest.state = 'backup_verified';
        await save();
        return verified;
    });
}
/** @param {PublicationOptions & {heartbeatConfig:import('./monitor-heartbeat.mjs').HeartbeatConfig,fetchImpl?:typeof fetch}} options @param {import('./manifest.mjs').OperationsManifest} manifest */
async function heartbeatInputs(options, manifest) {
    const artifact = await readPrivateJson(join(options.directory, 'artifact-readback.json'), options.repositoryRoot);
    ensure(artifact.descriptorSha256 === options.expectedDescriptorSha256 && manifest.history.some(entry => entry.step === 'artifact-upload' && entry.evidenceSha256 === digest(canonicalJson(artifact)) && entry.resourceId === String(artifact.artifact.artifactId)), 'ARTIFACT_READBACK_PROVENANCE_REQUIRED');
    const verified = await boundRecovery(options, manifest);
    ensure(options.heartbeatConfig.configSha256===manifest.monitoring.configSha256,'HEARTBEAT_CONFIG_MISMATCH');
    ensure(options.heartbeatConfig.candidateSha === manifest.candidate.sha && options.heartbeatConfig.environmentAlias === verified.descriptor.metadata.source.environmentAlias, 'HEARTBEAT_TARGET_MISMATCH');
    const heartbeat = { checkpointAt: verified.descriptor.metadata.startedAt, candidateSha: manifest.candidate.sha, descriptorSha256: verified.descriptorSha256, configSha256: options.heartbeatConfig.configSha256, artifactId: String(artifact.artifact.artifactId), artifactSha256: digest(canonicalJson(artifact)) };
    const adapter = createMonitorHeartbeatAdapter(options.heartbeatConfig, { fetchImpl: options.fetchImpl, now: () => options.now ?? new Date().toISOString() });
    return { heartbeat, adapter };
}
/** A personal-account budget has no supported REST readback. This is explicitly current
 * owner UI evidence, never represented as an API result or automatically renewed.
 * @param {unknown} value @param {string} now */
export function validateCostAuthorization(value, now) {
    const parsed = costSchema.safeParse(value);
    ensure(parsed.success, 'GITHUB_ZERO_COST_READBACK_REQUIRED');
    const cost = parsed.data;
    ensure(Date.parse(cost.capturedAt) <= Date.parse(now) && Date.parse(cost.expiresAt) > Date.parse(now) && Date.parse(cost.expiresAt) - Date.parse(cost.capturedAt) <= 86400000, 'GITHUB_ZERO_COST_READBACK_REQUIRED');
    return cost;
}
/** Only GitHub-provided values, not workflow_dispatch inputs, establish execution context.
 * @param {Record<string,string|undefined>} env */
export function automationContextFromEnvironment(env) {
    return validateAutomationContext({ repository: env.GITHUB_REPOSITORY, repositoryId: Number(env.GITHUB_REPOSITORY_ID), eventName: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, refProtected: env.GITHUB_REF_PROTECTED === 'true', workflowRef: env.GITHUB_WORKFLOW_REF, sha: env.GITHUB_SHA, workflowSha: env.GITHUB_WORKFLOW_SHA, runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT) });
}
/** @param {{directory:string,repositoryRoot:string,context:unknown,now?:string}} input @returns {Promise<PublicationOptions>} */
export async function runnerPublicationOptions(input) {
    const context = validateAutomationContext(input.context), directory = await validatedRunnerDirectory(input.directory, input.repositoryRoot, context);
    const lease = await readPrivateJson(join(directory, 'runner-lease.json'), input.repositoryRoot);
    const manifest = await readPrivateManifest(join(directory, 'manifest.json'), { repositoryRoot: input.repositoryRoot, now: input.now });
    const entries = manifest.history.filter(entry => entry.step === 'backup-set'&&entry.operationId===lease.executionId);
    ensure(entries.length === 1, 'BACKUP_CREATION_PROVENANCE_REQUIRED');
    return { ...input, context, manifestPath: join(directory, 'manifest.json'), outputDirectory: join(directory, 'published'), downloadDirectory: join(directory, 'downloaded'), maxArtifactBytes: lease.maxArtifactBytes, expectedDescriptorSha256: entries[0].evidenceSha256,executionId:lease.executionId };
}
/** @param {unknown} error */
export function automationErrorMessage(error) { return error instanceof OperationsError ? error.message : 'Issue #29: AUTOMATION_FAILED_PRIVATE_DETAILS_WITHHELD'; }
/** Preserve sanitized reconciliation coordinates in workflow logs before ephemeral files disappear.
 * This is neither a second state machine nor a hosted PASS receipt.
 * @param {{directory:string,repositoryRoot:string,context:unknown,now?:string}} options */
export async function backupTransactionSummary(options) {
    const context = validateAutomationContext(options.context);
    const directory = await validatedRunnerDirectory(options.directory, options.repositoryRoot, context);
    // Expired manifests remain evidence, never renewed authorization. Use the last instant before
    // expiry only for schema inspection; no stateful operation is invoked by this read-only summary.
    const raw = await readPrivateJson(join(directory, 'manifest.json'), options.repositoryRoot);
    const manifest = validateManifest(raw, { now: new Date(Math.min(Date.parse(options.now ?? new Date().toISOString()), Date.parse(raw.expiresAt) - 1)).toISOString() });
    ensure(manifest.candidate.sha === context.sha, 'CANDIDATE_MISMATCH');
    return { schemaVersion: 1, kind: 'issue29-backup-transaction-summary', runId: manifest.runId, githubRunId: context.runId, candidateSha: manifest.candidate.sha, state: manifest.state, authorizationExpired: Date.parse(manifest.expiresAt) <= Date.parse(options.now ?? new Date().toISOString()),
        pending: manifest.pending ? { step: manifest.pending.step, operationId: manifest.pending.operationId, startedAt: manifest.pending.startedAt, resourceId: ['artifact-upload', 'backup-heartbeat'].includes(manifest.pending.step) ? manifest.pending.resourceId : null } : null,
        evidence: manifest.history.filter(e => ['backup-set', 'artifact-upload', 'backup-heartbeat'].includes(e.step)).map(e => ({ step: e.step, evidenceSha256: e.evidenceSha256, completedAt: e.completedAt })),
        retainedArtifactIds: manifest.cleanup.resources.filter(r => r.provider === 'github' && r.disposition === 'persistent').map(r => r.id),
        independentOwnerDecryptionVerified: manifest.backupVerification !== null };
}

/** @typedef {PublicationOptions & {heartbeatConfig:import('./monitor-heartbeat.mjs').HeartbeatConfig,fetchImpl?:typeof fetch}} FailureHeartbeatOptions */
/** @param {FailureHeartbeatOptions} options @param {import('./manifest.mjs').OperationsManifest} manifest */
async function failureInputs(options,manifest){
    const failure=await readPrivateJson(join(options.directory,'backup-failure.json'),options.repositoryRoot);
    const parsed=z.strictObject({schemaVersion:z.literal(1),executionId:z.string().uuid(),candidateSha:z.string(),descriptorSha256:hash,detectedAt:z.iso.datetime(),reasonCode:z.literal('backup_integrity_failed')}).safeParse(failure);
    ensure(parsed.success&&failure.executionId===options.executionId&&failure.candidateSha===manifest.candidate.sha&&failure.descriptorSha256===options.expectedDescriptorSha256,'FAILURE_PROVENANCE_REQUIRED');
    const age=Date.parse(options.now??new Date().toISOString())-Date.parse(failure.detectedAt);ensure(age>=0&&age<=300000,'FAILURE_PROVENANCE_STALE');
    ensure(options.heartbeatConfig.candidateSha===manifest.candidate.sha&&options.heartbeatConfig.configSha256===manifest.monitoring.configSha256&&options.heartbeatConfig.environmentAlias===manifest.fixture.alias,'HEARTBEAT_TARGET_MISMATCH');
    const value={candidateSha:manifest.candidate.sha,configSha256:options.heartbeatConfig.configSha256,evidenceSha256:digest(canonicalJson(failure))};
    return{value,adapter:createMonitorHeartbeatAdapter(options.heartbeatConfig,{fetchImpl:options.fetchImpl,now:()=>options.now??new Date().toISOString()})};
}
/** Signal only a locally observed definite encrypted-component failure. Never displace an ambiguous
 * export/upload intent; those cases remain readback-only and the independent freshness alarm applies.
 * @param {FailureHeartbeatOptions} options */
export async function beginFailureHeartbeat(options){
 return withManifest(options,async(manifest,_context,save)=>{
    ensure(manifest.allowedActions.includes('backup-heartbeat'),'ACTION_FORBIDDEN');
    const data=await failureInputs(options,manifest);
    if(manifest.pending){ensure(manifest.pending.step==='backup-heartbeat'&&manifest.pending.resourceId==='failure'&&manifest.pending.priorStateSha256===data.value.evidenceSha256,'PENDING_OPERATION_REQUIRES_READBACK');return{status:'readback-only'};}
    const key=`backup-failure:${options.executionId}`;ensure(manifest.state==='backup_started'&&!manifest.attempts[key],'FAILURE_HEARTBEAT_STATE_INVALID');
    manifest.attempts[key]=1;manifest.pending={step:'backup-heartbeat',operationId:randomUUID(),startedAt:options.now??new Date().toISOString(),resourceId:'failure',priorStateSha256:data.value.evidenceSha256};await save();
    return data.adapter.publishBackupFailure(data.value);
 });
}
/** Read back the exact failure event and unusable status without submitting another POST.
 * @param {FailureHeartbeatOptions} options */
export async function finalizeFailureHeartbeat(options){
 return withManifest(options,async(manifest,_context,save)=>{
    const data=await failureInputs(options,manifest),pending=manifest.pending;
    ensure(pending?.step==='backup-heartbeat'&&pending.resourceId==='failure'&&pending.priorStateSha256===data.value.evidenceSha256,'PENDING_FAILURE_HEARTBEAT_REQUIRED');
    const result=await data.adapter.verifyBackupFailure(data.value);
    manifest.history.push({step:'backup-heartbeat',operationId:pending.operationId,completedAt:options.now??new Date().toISOString(),resourceId:'failure',evidenceSha256:data.value.evidenceSha256});manifest.pending=null;
    // Failure delivery does not turn a corrupt backup into backup_verified.
    await save();return result;
 });
}

/** Daily canary shares the current private source manifest and exact trusted GitHub execution lease.
 * Resend credentials stay in private runner memory, never monitor configuration or public output.
 * @param {{directory:string,repositoryRoot:string,context:unknown,settingsJson:string,now?:string}} options
 */
export async function executeAutomationCanary(options){
 const context=validateAutomationContext(options.context),directory=await validatedRunnerDirectory(options.directory,options.repositoryRoot,context);
 ensure(options.settingsJson.length>0&&options.settingsJson.length<=60000,'DAILY_CANARY_SETTINGS_REQUIRED');
 const lease=await readPrivateJson(join(directory,'runner-lease.json'),options.repositoryRoot),now=options.now??new Date().toISOString();
 ensure(Date.parse(lease.preparedAt)<=Date.parse(now)&&Date.parse(now)<Date.parse(lease.authorizationExpiresAt),'AUTOMATION_AUTHORIZATION_EXPIRED');
 const manifest=await readPrivateManifest(join(directory,'manifest.json'),{repositoryRoot:options.repositoryRoot,now});const source=assertOwnedSource(manifest);
 ensure(manifest.candidate.sha===context.sha&&manifest.runId===lease.manifestRunId,'AUTOMATION_MANIFEST_NOT_READY');
 let raw;try{raw=JSON.parse(options.settingsJson);}catch{throw new OperationsError('DAILY_CANARY_SETTINGS_REQUIRED');}
 const {executeDailyCanary,monitoringExecutionSettingsSchema}=await import('./monitoring-execution.mjs');
 const parsed=monitoringExecutionSettingsSchema.safeParse(raw);ensure(parsed.success,'DAILY_CANARY_SETTINGS_REQUIRED');
 ensure(parsed.data.binding.source.apiUrl===source.url&&(parsed.data.monitor.targetRole??'source')==='source','DAILY_CANARY_SOURCE_MISMATCH');
 await executeDailyCanary({manifestPath:join(directory,'manifest.json'),repositoryRoot:options.repositoryRoot,candidate:manifest.candidate,settings:parsed.data,executionId:lease.executionId,preparedAt:lease.preparedAt});
 return{status:'CANARY_DELIVERY_CHECKPOINT_VERIFIED',executionId:lease.executionId};
}

/** Quiesce the exact persistent source's two approved DB-only jobs around export, then restore
 * only the captured state. An unresolved backup mutation is never displaced by cleanup.
 * @param {{directory:string,repositoryRoot:string,context:unknown,mode:'quiesce'|'resume',now?:string}} options
 */
export async function executeAutomationJobs(options){
 const context=validateAutomationContext(options.context),directory=await validatedRunnerDirectory(options.directory,options.repositoryRoot,context),manifestPath=join(directory,'manifest.json');
 const lease=await readPrivateJson(join(directory,'runner-lease.json'),options.repositoryRoot),now=options.now??new Date().toISOString();
 ensure(Date.parse(lease.preparedAt)<=Date.parse(now)&&Date.parse(now)<Date.parse(lease.authorizationExpiresAt),'AUTOMATION_AUTHORIZATION_EXPIRED');
 const manifest=await readPrivateManifest(manifestPath,{repositoryRoot:options.repositoryRoot,now});assertOwnedSource(manifest);
 ensure(manifest.candidate.sha===context.sha&&manifest.runId===lease.manifestRunId,'AUTOMATION_MANIFEST_NOT_READY');
 ensure(!manifest.pending,'PENDING_MUTATION_REQUIRES_READBACK');
 const backup=await readPrivateJson(join(directory,'settings.json'),options.repositoryRoot);
 const {executeSyntheticJobsCommand,readSyntheticJobsEvidence}=await import('./synthetic-jobs.mjs');
 const latest=manifest.history.filter(h=>h.step==='synthetic-jobs'&&h.resourceId==='source-jobs'&&h.completedAt>=lease.preparedAt).at(-1);
 let priorStatePath;
 if(options.mode==='resume'){
  if(!latest)return{status:'NO_CURRENT_JOBS_QUIESCE'};
  const prior=await readSyntheticJobsEvidence({manifest,manifestPath,repositoryRoot:options.repositoryRoot,role:'source'});
  if(prior.mode==='resumed')return{status:'JOBS_ALREADY_RESUMED'};
  ensure(prior.mode==='quiesced'&&prior.candidate?.sha===context.sha,'JOBS_PRIOR_STATE_UNOWNED');
  priorStatePath=join(directory,`${latest.evidenceSha256}.json`);
 } else ensure(!latest,'JOBS_CURRENT_EXECUTION_ALREADY_STARTED');
 const settings={schemaVersion:1,operation:'synthetic-jobs',mode:options.mode,role:'source',connection:backup.connection,toolchain:backup.toolchain,...(priorStatePath?{priorStatePath}:{})};
 const settingsPath=join(directory,`jobs-${options.mode}.json`);
 try{await writePrivate(settingsPath,canonicalJson(settings));}catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='EEXIST')throw error;ensure(canonicalJson(await readPrivateJson(settingsPath,options.repositoryRoot))===canonicalJson(settings),'JOBS_SETTINGS_DRIFT');}
 const result=await executeSyntheticJobsCommand({manifestPath,settingsPath,repositoryRoot:options.repositoryRoot,candidate:manifest.candidate,operation:'synthetic-jobs',clock:()=>options.now??new Date().toISOString()});
 return{status:result.mode==='quiesced'?'JOBS_QUIESCED':'JOBS_RESUMED',evidenceSha256:result.evidenceSha256};
}
