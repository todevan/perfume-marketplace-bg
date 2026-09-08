import { constants } from 'node:fs';
import { open, unlink, lstat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { canonicalJson } from './recovery-set.mjs';
import { assertExactTarget, assertOwnedSource, assertPrivatePath, ensure, OperationsError, readPrivateManifest, writePrivateManifest, validateProviderPreflight, validateSourceMaintenance } from './manifest.mjs';
import { validateOwnerSourceAuthorization } from './supabase-adapter.mjs';
/** @typedef {import('./manifest.mjs').OperationsManifest} Manifest */
/** @typedef {import('./manifest.mjs').ProjectReadback} ProjectReadback */
/** @typedef {import('./manifest.mjs').Capability} Capability */
/** @typedef {{project:import('./manifest.mjs').ProjectIdentity,createdAt:string,evidenceSha256:string,evidence?:Record<string,unknown>,foreignState:boolean,ownerSourceAuthorization?:unknown}} CreatedProject */
/** @typedef {{manifest:Manifest,operationId:string,purpose:'source'|'target'}} LifecycleContext */
/** @typedef {{preflight:(context:LifecycleContext)=>Promise<import('./manifest.mjs').ProviderPreflight & {evidence?:Record<string,unknown>}>,readPaused?:(context:MaintenanceContext)=>Promise<SourceStatusReadback>,create?:(context:LifecycleContext)=>Promise<void>,readCreated?:(context:LifecycleContext)=>Promise<CreatedProject>,remove?:(context:LifecycleContext)=>Promise<void>,readAbsent?:(context:LifecycleContext)=>Promise<{absent:boolean,evidenceSha256:string}>,verifySource?:(context:LifecycleContext)=>Promise<{fixtureRunId:string,fixtureManifestSha256:string,inventorySha256:string,releaseBindingSha256:string,evidenceSha256:string,evidence?:Record<string,unknown>}>}} LifecycleAdapter */

/** Fresh source and window-scoped restore creation share the same private transaction.
 * No provider mutation can occur before persisted intent; ambiguity permits readback only.
 * @param {{manifestPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,step:string,adapter:LifecycleAdapter,now?:string,clock?:()=>string}} options
 * @returns {Promise<Manifest>}
 */
export async function executeProjectLifecycleStep(options) {
    const { manifestPath, repositoryRoot, candidate, step, adapter } = options;
    const clock = options.clock ?? (() => options.now ?? new Date().toISOString());
    await assertPrivatePath(manifestPath, repositoryRoot);
    const lockPath = `${manifestPath}.lock`;
    let lock;
    try { lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
    catch { throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING'); }
    try {
        const manifest = await readPrivateManifest(manifestPath, { repositoryRoot, now: clock(), candidate });
        ensure(step!=='retire-source','PERSISTENT_SOURCE_DELETION_FORBIDDEN');
        ensure(['preflight','create-source','verify-source','retire-source','create-target'].includes(step) && manifest.allowedActions.includes(step), 'ACTION_FORBIDDEN');
        ensure(manifest.humanBoundary === null && manifest.terminal === null, 'TRANSACTION_TERMINAL');
        ensure(manifest.pending === null || manifest.pending.step === step, 'PENDING_OPERATION_REQUIRES_READBACK');
        if (manifest.pending === null && manifest.history.some(entry => entry.step === step && (step!=='create-target'||entry.resourceId===manifest.maintenance?.id))) return manifest;
        const purpose = step === 'create-target' ? 'target' : 'source';
        const operationId = manifest.pending?.operationId ?? randomUUID();
        const context = { manifest: structuredClone(manifest), operationId, purpose: /** @type {'source'|'target'} */ (purpose) };
        /** @type {string|undefined} */let intentSha256;
        /** @param {string} evidenceSha256 */
        const complete = async evidenceSha256 => {
            ensure(/^[a-f0-9]{64}$/u.test(evidenceSha256), 'READBACK_IDENTITY_MISMATCH');
            manifest.history.push({ step, operationId, completedAt: clock(), evidenceSha256, resourceId: step==='create-target'?(manifest.maintenance?.id??null):null,...(intentSha256?{intentSha256}:{}) });
            manifest.pending = null;
            await writePrivateManifest(manifestPath, manifest, { repositoryRoot, now: clock(), candidate, replace: true });
            return manifest;
        };
        if (step === 'preflight') {
            ensure(manifest.state === 'planned' && manifest.source === null, 'STATE_TRANSITION_FORBIDDEN');
            const {evidence,...observed}=await adapter.preflight(context);
            const proof = validateProviderPreflight(observed, { ...manifest.provisioning, preservedRefs: manifest.preservedRefs, now: clock() });
            // Every pre-existing project is protected, not merely the canonical staging ref.
            ensure(proof.inventoryRefs.every(ref => manifest.preservedRefs.includes(ref)), 'PRESERVED_INVENTORY_INCOMPLETE');
            await persistOperationsEvidence(manifestPath,repositoryRoot,evidence,proof.evidenceSha256);
            manifest.providerPreflight = proof; manifest.state = 'provider_preflighted';
            return await complete(proof.evidenceSha256);
        }
        if (step === 'verify-source') {
            ensure(manifest.state === 'source_read_back' && manifest.source && manifest.sourceProvenance && adapter.verifySource, 'SOURCE_IDENTITY_REQUIRED');
            const proof = await adapter.verifySource(context);
            ensure(proof.fixtureRunId === manifest.runId && ['fixtureManifestSha256','inventorySha256','releaseBindingSha256','evidenceSha256'].every(key => /^[a-f0-9]{64}$/u.test(proof[/** @type {'fixtureManifestSha256'|'inventorySha256'|'releaseBindingSha256'|'evidenceSha256'} */ (key)])), 'SOURCE_PROVENANCE_UNPROVEN');
            await persistOperationsEvidence(manifestPath,repositoryRoot,proof.evidence,proof.evidenceSha256);
            Object.assign(manifest.sourceProvenance, { fixtureRunId: proof.fixtureRunId, fixtureManifestSha256: proof.fixtureManifestSha256, inventorySha256: proof.inventorySha256, releaseBindingSha256: proof.releaseBindingSha256, verifiedAt: clock() });
            manifest.state = 'preflighted'; return await complete(proof.evidenceSha256);
        }
        const creating = step === 'create-source' || step === 'create-target';
        if (creating) {
            const before = step === 'create-source' ? ['provider_preflighted','source_creation_pending'] : ['source_paused','target_creation_pending'];
            ensure(before.includes(manifest.state) && (purpose === 'source' ? manifest.source === null : manifest.source !== null && manifest.target === null), 'STATE_TRANSITION_FORBIDDEN');
            if (purpose === 'target') ensure(manifest.backupVerification?.sourceReadsComplete === true && manifest.maintenance?.phase==='paused' && manifest.maintenance.pauseReadbackSha256, 'SOURCE_PAUSE_PROOF_REQUIRED');
            if (manifest.pending === null) {
                if(purpose==='target'){ensure(adapter.readPaused&&manifest.maintenance,'SOURCE_PAUSE_READBACK_REQUIRED');ensure(Date.parse(clock())<Date.parse(manifest.maintenance.expiresAt),'MAINTENANCE_WINDOW_INVALID');const paused=await adapter.readPaused({...context,purpose:'source'});ensure(paused.status==='INACTIVE'&&paused.project.ref===manifest.source?.ref&&paused.identitySha256===manifest.maintenance.preservation.identitySha256&&paused.preservationSha256===preservationDigest(manifest.maintenance.preservation),'SOURCE_PAUSE_READBACK_REQUIRED');}
                const {evidence,...observed}=await adapter.preflight(context);
                const proof = validateProviderPreflight(observed, { ...manifest.provisioning, preservedRefs: manifest.preservedRefs, now: clock(), minimumAvailable:1 });
                const known = new Set([...manifest.preservedRefs, ...manifest.cleanup.resources.filter(r => r.provider === 'supabase' && r.absentAt === null).map(r => r.id)]);
                ensure(proof.inventoryRefs.every(ref => known.has(ref)), 'PRESERVED_INVENTORY_INCOMPLETE');
                ensure(!manifest.attempts[maintenanceAttemptKey(manifest,step)] && adapter.create && adapter.readCreated, 'MUTATION_CAPABILITY_REQUIRED');
                await persistOperationsEvidence(manifestPath,repositoryRoot,evidence,proof.evidenceSha256);
                manifest.providerPreflight = proof; manifest.pending = { step, operationId, startedAt: clock(), resourceId: null, priorStateSha256: null };
                manifest.attempts[maintenanceAttemptKey(manifest,step)] = 1; manifest.state = purpose === 'source' ? 'source_creation_pending' : 'target_creation_pending';
                await writePrivateManifest(manifestPath, manifest, { repositoryRoot, now: clock(), candidate, replace: true });
                intentSha256=await persistOperationsIntent(manifestPath,manifest,repositoryRoot);
                try { await adapter.create({ ...context, manifest: structuredClone(manifest) }); }
                catch { throw new OperationsError('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY'); }
            }
            ensure(adapter.readCreated && manifest.pending, 'READBACK_CAPABILITY_REQUIRED');
            intentSha256??=await persistOperationsIntent(manifestPath,manifest,repositoryRoot,{mustExist:true});
            let proof;
            try { proof = await adapter.readCreated({ ...context, manifest: structuredClone(manifest) }); }
            catch { throw new OperationsError('READBACK_UNCERTAIN_NO_RETRY'); }
            ensure(proof.project.organizationId === manifest.provisioning.organizationId && proof.project.region === manifest.provisioning.region && proof.project.environment === (purpose === 'source' ? 'synthetic' : 'disposable') && proof.foreignState === false, 'TARGET_IDENTITY_MISMATCH');
            ensure(!manifest.preservedRefs.includes(proof.project.ref) && !manifest.forbiddenRefs.includes(proof.project.ref), 'PRESERVED_PROJECT_FORBIDDEN');
            const withinCreationWindow = Number.isFinite(Date.parse(proof.createdAt)) && Date.parse(proof.createdAt) >= Date.parse(manifest.pending.startedAt) - 1000 && Date.parse(proof.createdAt) <= Date.parse(clock()) + 300000;
            if (proof.ownerSourceAuthorization)
                validateOwnerSourceAuthorization(proof.ownerSourceAuthorization, { manifest, operationId, purpose, sourceRef: proof.project.ref, sourceName: manifest.provisioning.sourceName, observedCreatedAt: proof.createdAt, now: clock() });
            ensure(withinCreationWindow || proof.ownerSourceAuthorization, 'CREATION_TIME_MISMATCH');
            await persistOperationsEvidence(manifestPath,repositoryRoot,proof.evidence,proof.evidenceSha256);
            const owned = { provider: 'supabase', id: proof.project.ref, runId: manifest.runId, createdAt: proof.createdAt, evidenceSha256: proof.evidenceSha256, disposition: /** @type {'persistent'|'disposable'} */ (purpose==='source'?'persistent':'disposable'), absentAt: null };
            if (purpose === 'source') {
                manifest.source = proof.project; manifest.forbiddenRefs.push(proof.project.ref);
                manifest.sourceProvenance = { createdAt: proof.createdAt, creationIntentId: operationId, creationReadbackSha256: proof.evidenceSha256, fixtureRunId: null, fixtureManifestSha256: null, inventorySha256: null, releaseBindingSha256: null, verifiedAt: null };
                manifest.state = 'source_read_back';
            } else { manifest.target = proof.project; manifest.state = 'target_read_back'; }
            manifest.cleanup.resources.push(owned);
            return await complete(proof.evidenceSha256);
        }
        throw new OperationsError('ACTION_FORBIDDEN');
    } catch (error) {
        if (error instanceof OperationsError) throw error;
        throw new OperationsError('PROJECT_LIFECYCLE_FAILED_SAFELY');
    } finally { await lock.close(); await unlink(lockPath); }
}
/** @typedef {{from:string,to:string,role:Capability,scope:'source'|'target',mutation?:boolean}} Transition */
/** @type {Record<string,Transition>} */
const TRANSITIONS = Object.freeze({
    preflight: { from: 'planned', to: 'preflighted', role: 'source-read', scope: 'source' },
    'implementation-verified': { from: 'preflighted', to: 'implementation_verified', role: 'source-read', scope: 'source' },
    'configure-monitoring': { from: 'implementation_verified', to: 'monitoring_configured', role: 'monitoring-config', scope: 'source', mutation: true },
    'monitoring-proof': { from: 'monitoring_configured', to: 'monitoring_proved', role: 'monitoring-config', scope: 'source', mutation: true },
    'backup-set': { from: 'monitoring_proved', to: 'backup_started', role: 'source-read', scope: 'source', mutation: true },
    'verify-backup': { from: 'backup_started', to: 'backup_verified', role: 'source-read', scope: 'source' },
    quarantine: { from: 'target_read_back', to: 'quarantine_verified', role: 'restore-write', scope: 'target', mutation: true },
    'restore-database': { from: 'quarantine_verified', to: 'database_restored', role: 'restore-write', scope: 'target', mutation: true },
    'restore-storage': { from: 'database_restored', to: 'storage_restored', role: 'restore-write', scope: 'target', mutation: true },
    'verify-restore': { from: 'storage_restored', to: 'integrity_verified', role: 'restore-write', scope: 'target' },
    'incident-drill': { from: 'integrity_verified', to: 'incident_drill_verified', role: 'restore-write', scope: 'target', mutation: true },
    'cleanup-resource': { from: '*', to: 'transient_cleanup_pending', role: 'cleanup', scope: 'target', mutation: true },
    cleanup: { from: '*', to: 'cleanup_verified', role: 'cleanup', scope: 'source' }
});
/** @typedef {{operationId:string,step:string,source:import('./manifest.mjs').ProjectIdentity,target:import('./manifest.mjs').ProjectIdentity|null,resource:import('./manifest.mjs').OwnedResource|null,candidate:import('./manifest.mjs').Candidate,runId:string}} ActionTarget */
/** @typedef {{status:string,evidenceSha256:string,evidence?:Record<string,unknown>,operationId:string,resourceId:string|null,targetRef:string,candidateSha:string,completedAt:string,project?:import('./manifest.mjs').ProjectIdentity,projectObservation?:ProjectReadback,createdResources?:import('./manifest.mjs').OwnedResource[],priorStateSha256?:string,restoredPriorStateSha256?:string}} StepReadback */
/** @typedef {ProjectReadback & {priorStateSha256?:string,creation?:{organizationId:string,region:string,plan:string,cost:number,freeCapacity:boolean,credentialId:string,cleanupAuthorized:boolean}}} StepInspection */
/**
 * Execute one named action with a separately supplied, purpose-scoped capability.
 * Provider adapters perform real probes; this module never invents their evidence.
 * @param {{manifestPath:string,repositoryRoot:string,step:string,capability:Capability,candidate:import('./manifest.mjs').Candidate,inspect:(target:ActionTarget)=>Promise<StepInspection>,mutate?:(target:ActionTarget)=>Promise<void>,readback:(target:ActionTarget)=>Promise<StepReadback>,resourceId?:string,now?:string,clock?:()=>string}} options
 * @returns {Promise<Manifest>}
 */
export async function executeOperatorStep(options) {
    const { manifestPath, repositoryRoot, step, capability, candidate, inspect, mutate, readback, resourceId = null } = options;
    ensure(step !== 'create-target', 'FRESH_PROJECT_LIFECYCLE_REQUIRED');
    const clock = options.clock ?? (() => options.now ?? new Date().toISOString());
    let now = clock();
    await assertPrivatePath(manifestPath, repositoryRoot);
    const lockPath = `${manifestPath}.lock`;
    let lock;
    try {
        lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        await lock.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: now })}\n`);
        await lock.sync();
    }
    catch {
        throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');
    }
    try {
        const manifest = await readPrivateManifest(manifestPath, { repositoryRoot, now, candidate });
        ensure(manifest.source !== null, 'SOURCE_IDENTITY_REQUIRED');
        if (step === 'backup-set') assertOwnedSource(manifest);
        const transition = TRANSITIONS[step];
        ensure(transition && manifest.allowedActions.includes(step), 'ACTION_FORBIDDEN');
        ensure(transition.role === capability, 'CREDENTIAL_ROLE_MISMATCH');
        ensure(manifest.humanBoundary === null, 'HUMAN_BOUNDARY_PENDING');
        ensure(manifest.terminal === null || step.startsWith('cleanup'), 'TRANSACTION_TERMINAL');
        const resource = resourceId === null ? null : manifest.cleanup.resources.find(item => item.id === resourceId) ?? null;
        if (step === 'cleanup-resource')
            ensure(resource && resource.id!==manifest.source.ref && resource.runId === manifest.runId && resource.disposition === 'disposable' && !manifest.forbiddenRefs.includes(resource.id), 'CLEANUP_OWNERSHIP_MISMATCH');
        else
            ensure(resourceId === null, 'UNEXPECTED_RESOURCE');
        const prior = manifest.history.find(item => item.step === step && item.resourceId === resourceId);
        if (prior && manifest.pending === null)
            return manifest;
        ensure(manifest.pending === null || (manifest.pending.step === step && manifest.pending.resourceId === resourceId), 'PENDING_OPERATION_REQUIRES_READBACK');
        ensure(transition.from === '*' || manifest.state === transition.from, 'STATE_TRANSITION_FORBIDDEN');
        if (step === 'cleanup')
            ensure((!manifest.maintenance||manifest.maintenance.phase==='closed') &&manifest.cleanup.resources.filter(item => item.disposition === 'disposable').every(item => item.absentAt !== null) && manifest.pending === null, 'CLEANUP_ABSENCE_UNPROVEN');
        const operationId = manifest.pending?.operationId ?? randomUUID();
        const exact = Object.freeze({ operationId, step, source: structuredClone(manifest.source), target: structuredClone(manifest.target), resource: structuredClone(resource), candidate: structuredClone(candidate), runId: manifest.runId });
        /** @type {string|undefined} */let intentSha256;
        if(manifest.pending)intentSha256=await persistOperationsIntent(manifestPath,manifest,repositoryRoot,{mustExist:true});
        // Readback-only resume must not require an already-deleted project to remain healthy.
        // A fresh mutation always receives current exact-identity guards first.
        if (manifest.pending === null) {
            let observed;
            if (step !== 'cleanup') {
            try {
                observed = await inspect(exact);
            }
            catch {
                throw new OperationsError('PREFLIGHT_READBACK_FAILED');
            }
            now = clock();
            assertExactTarget(manifest, observed, { role: capability, scope: transition.scope, now, requireEmpty: true });
            }
            const attemptKey = `${step}${resourceId === null ? '' : `:${resourceId}`}`;
            ensure(!manifest.attempts[attemptKey], 'ATTEMPT_LIMIT');
            if (transition.mutation)
                ensure(typeof mutate === 'function', 'MUTATION_CAPABILITY_REQUIRED');
            if (step === 'configure-monitoring')
                ensure(/^[a-f0-9]{64}$/u.test(observed?.priorStateSha256 ?? ''), 'PRIOR_STATE_REQUIRED');
            manifest.pending = { step, operationId, startedAt: now, resourceId, priorStateSha256: observed?.priorStateSha256 ?? null };
            manifest.attempts[attemptKey] = 1;
            if (step === 'cleanup-resource')
                manifest.state = 'transient_cleanup_pending';
            await writePrivateManifest(manifestPath, manifest, { repositoryRoot, now, candidate, replace: true });
            intentSha256=await persistOperationsIntent(manifestPath,manifest,repositoryRoot);
            if (transition.mutation) {
                try {
                    await /** @type {NonNullable<typeof mutate>} */ (mutate)(exact);
                }
                catch {
                    throw new OperationsError('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY');
                }
            }
        }
        let proof;
        try {
            proof = await readback(exact);
        }
        catch {
            throw new OperationsError('READBACK_UNCERTAIN_NO_RETRY');
        }
        now = clock();
        const expectedRef = transition.scope === 'source' ? manifest.source.ref : manifest.target?.ref;
        ensure(proof && proof.operationId === operationId && proof.resourceId === resourceId && proof.targetRef === expectedRef && proof.candidateSha === candidate.sha && /^[a-f0-9]{64}$/u.test(proof.evidenceSha256) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(proof.completedAt) && Date.parse(proof.completedAt) >= Date.parse(/** @type {NonNullable<Manifest['pending']>} */ (manifest.pending).startedAt) && Date.parse(proof.completedAt) <= Date.parse(now) + 300000, 'READBACK_IDENTITY_MISMATCH');
        ensure(proof.status === (step === 'cleanup-resource' ? 'absent' : 'verified'), 'READBACK_UNCERTAIN_NO_RETRY');
        await persistOperationsEvidence(manifestPath,repositoryRoot,proof.evidence,proof.evidenceSha256);
        if (proof.createdResources) {
            ensure(['configure-monitoring', 'monitoring-proof', 'backup-set', 'incident-drill'].includes(step), 'UNEXPECTED_RESOURCE');
            manifest.cleanup.resources.push(...proof.createdResources);
        }
        if (step === 'cleanup-resource' && resource) {
            if (resource.priorStateSha256)
                ensure(proof.restoredPriorStateSha256 === resource.priorStateSha256, 'PRIOR_STATE_RESTORE_UNPROVEN');
            resource.absentAt = proof.completedAt;
        }
        manifest.history.push({ step, operationId, completedAt: proof.completedAt, evidenceSha256: proof.evidenceSha256, resourceId,...(intentSha256?{intentSha256}:{}) });
        manifest.pending = null;
        manifest.state = transition.to;
        await writePrivateManifest(manifestPath, manifest, { repositoryRoot, now, candidate, replace: true });
        return manifest;
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('OPERATOR_FAILED_SAFELY');
    }
    finally {
        await lock.close();
        await unlink(lockPath).catch(() => { throw new OperationsError('TRANSACTION_LOCK_CLEANUP_FAILED'); });
    }
}

/** @param {unknown} value */
const preservationDigest=value=>createHash('sha256').update(JSON.stringify(value,Object.keys(/** @type {object} */(value)).sort())).digest('hex');
/** @typedef {{manifest:Manifest,operationId:string,purpose:'source'}} MaintenanceContext */
/** @typedef {{project:import('./manifest.mjs').ProjectIdentity,status:'INACTIVE'|'ACTIVE_HEALTHY',identitySha256:string,preservationSha256:string,configurationObserved:boolean,evidenceSha256:string,evidence?:Record<string,unknown>}} SourceStatusReadback */
/** @typedef {{prepareMaintenance?:(context:MaintenanceContext)=>Promise<import('./manifest.mjs').SourceMaintenance>,inspectActiveSource?:(context:MaintenanceContext)=>Promise<import('./manifest.mjs').SourceResumeProof>,pauseSource?:(context:MaintenanceContext)=>Promise<void>,readPaused?:(context:MaintenanceContext)=>Promise<SourceStatusReadback>,resumeSource?:(context:MaintenanceContext)=>Promise<void>,readResumed?:(context:MaintenanceContext)=>Promise<SourceStatusReadback>}} MaintenanceAdapter */
/** One maintenance window, one pause and one resume. Paused project data/config are not represented as queryable.
 * @param {{manifestPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,step:'authorize-maintenance'|'pause-source'|'resume-source'|'verify-source-resumed',adapter:MaintenanceAdapter,now?:string,clock?:()=>string}} options
 */
export async function executeMaintenanceLifecycle(options){
 const{manifestPath,repositoryRoot,candidate,step,adapter}=options;const clock=options.clock??(()=>options.now??new Date().toISOString());await assertPrivatePath(manifestPath,repositoryRoot);let lock;
 try{lock=await open(`${manifestPath}.lock`,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch{throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}
 try{
 const manifest=await readPrivateManifest(manifestPath,{repositoryRoot,candidate,now:clock()});const source=manifest.source;ensure(source&&!manifest.preservedRefs.includes(source.ref)&&manifest.cleanup.resources.some(r=>r.provider==='supabase'&&r.id===source.ref&&r.runId===manifest.runId&&r.disposition==='persistent'&&r.absentAt===null),'PERSISTENT_SOURCE_REQUIRED');ensure(manifest.allowedActions.includes(step)&&manifest.humanBoundary===null&&manifest.terminal===null,'ACTION_FORBIDDEN');ensure(!manifest.pending||manifest.pending.step===step,'PENDING_OPERATION_REQUIRES_READBACK');
 const operationId=manifest.pending?.operationId??randomUUID();const context=()=>({manifest:structuredClone(manifest),operationId,purpose:/** @type {const} */('source')});const save=()=>writePrivateManifest(manifestPath,manifest,{repositoryRoot,candidate,now:clock(),replace:true});
 /** @type {string|undefined} */let intentSha256;
 const finish=async(/** @type {string} */hash)=>{ensure(/^[a-f0-9]{64}$/u.test(hash),'READBACK_IDENTITY_MISMATCH');manifest.history.push({step,operationId,completedAt:clock(),resourceId:manifest.maintenance?`${source.ref}:${manifest.maintenance.id}`:source.ref,evidenceSha256:hash,...(intentSha256?{intentSha256}:{})});manifest.pending=null;await save();return manifest;};
 if(step==='authorize-maintenance'){
  ensure(['backup_verified','cleanup_verified'].includes(manifest.state)&&!manifest.pending&&adapter.prepareMaintenance&&manifest.backupVerification?.sourceReadsComplete===true,'MAINTENANCE_AUTHORIZATION_REQUIRED');const previous=manifest.maintenance;if(previous)ensure(previous.phase==='closed'&&previous.endedAt&&manifest.history.some(h=>h.step==='cleanup'&&Date.parse(h.completedAt)>=Date.parse(previous.endedAt??''))&&manifest.cleanup.resources.filter(r=>r.disposition==='disposable').every(r=>r.absentAt!==null)&&manifest.backupVerification.descriptorSha256!==previous.backup.descriptorSha256,'PREVIOUS_MAINTENANCE_CLEANUP_REQUIRED');
  const maintenance=validateSourceMaintenance(await adapter.prepareMaintenance(context()),manifest);ensure(maintenance.phase==='authorized'&&maintenance.monitoring===null&&maintenance.backup.descriptorSha256===manifest.backupVerification.descriptorSha256&&Date.parse(maintenance.backup.verifiedAt)>=Date.parse(manifest.backupVerification.independentlyVerifiedAt)&&Date.parse(maintenance.authorizedAt)<=Date.parse(clock())&&Date.parse(clock())<Date.parse(maintenance.expiresAt),'MAINTENANCE_BACKUP_VERIFICATION_REQUIRED');if(previous){ensure(maintenance.id!==previous.id&&Date.parse(maintenance.authorizedAt)>Date.parse(previous.endedAt??''),'MAINTENANCE_WINDOW_REUSE_FORBIDDEN');const bytes=Buffer.from(canonicalJson(previous)),hash=createHash('sha256').update(bytes).digest('hex'),path=join(dirname(manifestPath),`${hash}.json`);await assertPrivatePath(path,repositoryRoot);let file;try{file=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch(error){ensure(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST','MAINTENANCE_ARCHIVE_WRITE_FAILED');const existing=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{ensure(((await existing.stat()).mode&0o777)===0o600&&(await existing.readFile()).equals(bytes),'MAINTENANCE_ARCHIVE_MISMATCH');}finally{await existing.close();}}if(file){try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}}manifest.history.push({step,operationId:randomUUID(),completedAt:clock(),resourceId:previous.id,evidenceSha256:hash});if(manifest.target&&!manifest.forbiddenRefs.includes(manifest.target.ref))manifest.forbiddenRefs.push(manifest.target.ref);manifest.target=null;delete manifest.targetDeploymentId;delete manifest.recoveryTimings;delete manifest.monitoring.targetConfigSha256;delete manifest.monitoring.targetRuleAliases;manifest.provisioning.targetName=`issue29-restore-${maintenance.id}`;manifest.providerPreflight=null;}manifest.maintenance=maintenance;manifest.state='backup_verified';await persistOperationsEvidence(manifestPath,repositoryRoot,maintenance.preservation,preservationDigest(maintenance.preservation));return await finish(preservationDigest(maintenance.preservation));
 }
 const maintenance=manifest.maintenance;ensure(maintenance,'MAINTENANCE_AUTHORIZATION_REQUIRED');
 if(step==='verify-source-resumed'){
  ensure(manifest.state==='source_resumed'&&maintenance.phase==='resume_pending'&&!manifest.pending&&adapter.inspectActiveSource,'SOURCE_RESUME_PROOF_REQUIRED');const proof=await adapter.inspectActiveSource(context());ensure(Date.parse(clock())-Date.parse(proof.checkedAt)>=0&&Date.parse(clock())-Date.parse(proof.checkedAt)<=300000,'SOURCE_RESUME_PROOF_STALE');for(const key of /** @type {const} */(['identitySha256','configSha256','provenanceSha256','workerSha256']))ensure(proof[key]===maintenance.preservation[key],'SOURCE_PRESERVATION_MISMATCH');ensure(proof.checkpointSha256===maintenance.backup.checkpointSha256&&/^[a-f0-9]{64}$/u.test(proof.readinessSha256),'SOURCE_CHECKPOINT_MISMATCH');maintenance.resumeProof=proof;maintenance.phase='active';return await finish(proof.evidenceSha256);
 }
 const pausing=step==='pause-source';ensure(pausing||step==='resume-source','ACTION_FORBIDDEN');
 if(!manifest.pending&&manifest.history.some(h=>h.step===step&&h.resourceId===`${source.ref}:${maintenance.id}`))return manifest;
 if(pausing){ensure(['backup_verified','source_pause_pending'].includes(manifest.state)&&['monitoring_ready','pause_pending'].includes(maintenance.phase)&&Date.parse(clock())<Date.parse(maintenance.expiresAt),'MAINTENANCE_WINDOW_INVALID');}
 else{ensure(['transient_cleanup_pending','incident_drill_verified','source_paused','source_resume_pending'].includes(manifest.state)&&['paused','resume_pending'].includes(maintenance.phase),'STATE_TRANSITION_FORBIDDEN');ensure((manifest.target?manifest.cleanup.resources.some(r=>r.provider==='supabase'&&r.id===manifest.target?.ref&&r.absentAt!==null):!manifest.attempts[maintenanceAttemptKey(manifest,'create-target')])&&manifest.cleanup.resources.filter(r=>r.disposition==='disposable'&&r.provider!=='cloudflare-monitor').every(r=>r.absentAt!==null),'RESTORE_TARGET_ABSENCE_REQUIRED');}
 if(!manifest.pending){
  ensure(!manifest.attempts[maintenanceAttemptKey(manifest,step)],'ATTEMPT_LIMIT');if(pausing){ensure(adapter.inspectActiveSource,'SOURCE_PRESERVATION_REQUIRED');const proof=await adapter.inspectActiveSource(context());ensure(Date.parse(clock())-Date.parse(proof.checkedAt)>=0&&Date.parse(clock())-Date.parse(proof.checkedAt)<=300000,'SOURCE_PRESERVATION_STALE');for(const key of /** @type {const} */(['identitySha256','configSha256','provenanceSha256','workerSha256']))ensure(proof[key]===maintenance.preservation[key],'SOURCE_PRESERVATION_MISMATCH');ensure(proof.checkpointSha256===maintenance.backup.checkpointSha256,'SOURCE_CHECKPOINT_MISMATCH');}
  const mutate=pausing?adapter.pauseSource:adapter.resumeSource;ensure(mutate,'MUTATION_CAPABILITY_REQUIRED');manifest.pending={step,operationId,startedAt:clock(),resourceId:source.ref,priorStateSha256:preservationDigest(maintenance.preservation)};manifest.attempts[maintenanceAttemptKey(manifest,step)]=1;manifest.state=pausing?'source_pause_pending':'source_resume_pending';maintenance.phase=pausing?'pause_pending':'resume_pending';await save();intentSha256=await persistOperationsIntent(manifestPath,manifest,repositoryRoot);try{await mutate(context());}catch{throw new OperationsError('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY');}
 }
 intentSha256??=await persistOperationsIntent(manifestPath,manifest,repositoryRoot,{mustExist:true});
 const readback=pausing?adapter.readPaused:adapter.readResumed;ensure(readback&&manifest.pending,'READBACK_CAPABILITY_REQUIRED');let proof;try{proof=await readback(context());}catch{throw new OperationsError('READBACK_UNCERTAIN_NO_RETRY');}
 ensure(proof.project.ref===source.ref&&proof.project.organizationId===source.organizationId&&proof.project.region===source.region&&proof.project.postgresVersion===source.postgresVersion&&proof.status===(pausing?'INACTIVE':'ACTIVE_HEALTHY')&&proof.identitySha256===maintenance.preservation.identitySha256&&proof.preservationSha256===manifest.pending.priorStateSha256,'SOURCE_PAUSE_RESUME_IDENTITY_MISMATCH');
 await persistOperationsEvidence(manifestPath,repositoryRoot,proof.evidence,proof.evidenceSha256);
 if(pausing){ensure(proof.configurationObserved===false,'PAUSED_CONFIGURATION_MUST_NOT_BE_ASSUMED');maintenance.pausedAt=clock();maintenance.pauseReadbackSha256=proof.evidenceSha256;maintenance.phase='paused';manifest.state='source_paused';}
 else{maintenance.resumedAt=clock();maintenance.resumeReadbackSha256=proof.evidenceSha256;manifest.state='source_resumed';}
 return await finish(proof.evidenceSha256);
 }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('MAINTENANCE_LIFECYCLE_FAILED_SAFELY');}finally{await lock.close();await unlink(`${manifestPath}.lock`);}
}

/** Attempts for disposable rehearsal phases belong to a maintenance window, never the permanent source lifetime. @param {Manifest} manifest @param {string} step */
export function maintenanceAttemptKey(manifest,step){return manifest.maintenance&&step!=='create-source'?`${step}:${manifest.maintenance.id}`:step;}

/** Store one sanitized evidence preimage; existing bytes must match exactly. No mutable evidence index.
 * @param {string} manifestPath @param {string} repositoryRoot @param {unknown} evidence @param {string} evidenceSha256 @param {{mustExist?:boolean}} [options] */
export async function persistOperationsEvidence(manifestPath,repositoryRoot,evidence,evidenceSha256,options={}){
 ensure(evidence&&typeof evidence==='object'&&!Array.isArray(evidence),'READBACK_EVIDENCE_REQUIRED');
 const bytes=Buffer.from(canonicalJson(evidence));ensure(bytes.length<=2097152&&createHash('sha256').update(bytes).digest('hex')===evidenceSha256,'READBACK_EVIDENCE_HASH_MISMATCH');
 const path=join(dirname(manifestPath),`${evidenceSha256}.json`);await assertPrivatePath(path,repositoryRoot);
 const directory=await lstat(dirname(manifestPath));ensure(directory.isDirectory()&&!directory.isSymbolicLink()&&(directory.mode&0o777)===0o700,'PRIVATE_DIRECTORY_MODE_REQUIRED');
 let file;try{file=await open(path,(options.mustExist?constants.O_RDONLY:constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY)|constants.O_NOFOLLOW,0o600);}
 catch(error){const code=/** @type {NodeJS.ErrnoException} */(error).code;ensure(!options.mustExist||code!=='ENOENT','INTENT_EVIDENCE_REQUIRED');ensure(code==='EEXIST','EVIDENCE_PERSISTENCE_FAILED');file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await file.stat();ensure(stat.isFile()&&stat.nlink===1&&stat.size===bytes.length&&(stat.mode&0o777)===0o600&&(await file.readFile()).equals(bytes),'EVIDENCE_PREIMAGE_MISMATCH');}finally{await file.close();}return evidenceSha256;}
 try{if(options.mustExist){const stat=await file.stat();ensure(stat.isFile()&&stat.nlink===1&&stat.size===bytes.length&&(stat.mode&0o777)===0o600&&(await file.readFile()).equals(bytes),'EVIDENCE_PREIMAGE_MISMATCH');}else{await file.writeFile(bytes);await file.sync();}}finally{await file.close();}if(!options.mustExist){const parent=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await parent.sync();}finally{await parent.close();}}return evidenceSha256;
}
/** Capture only an already-persisted pending intent. Resume requires the original bytes, never retroactive creation.
 * @param {string} manifestPath @param {Manifest} manifest @param {string} repositoryRoot @param {{mustExist?:boolean}} [options] */
export async function persistOperationsIntent(manifestPath,manifest,repositoryRoot,options={}){
 ensure(manifest.pending,'PERSISTED_INTENT_REQUIRED');
 const persisted=await readPrivateManifest(manifestPath,{repositoryRoot,candidate:manifest.candidate,now:manifest.pending.startedAt});
 const envelope=(/** @type {Manifest} */m)=>({schemaVersion:1,kind:'issue29-operator-intent',runId:m.runId,candidate:m.candidate,maintenanceId:m.maintenance?.id??null,pending:m.pending,source:m.source,target:m.target,providerPreflightSha256:m.providerPreflight?.evidenceSha256??null});
 const evidence=envelope(manifest);ensure(canonicalJson(evidence)===canonicalJson(envelope(persisted)),'PERSISTED_INTENT_MISMATCH');
 return persistOperationsEvidence(manifestPath,repositoryRoot,evidence,createHash('sha256').update(canonicalJson(evidence)).digest('hex'),options);
}
