import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { assertExactTarget, assertOwnedSource, assertPrivatePath, ensure, OperationsError, readPrivateManifest, writePrivateManifest, validateProviderPreflight } from './manifest.mjs';
/** @typedef {import('./manifest.mjs').OperationsManifest} Manifest */
/** @typedef {import('./manifest.mjs').ProjectReadback} ProjectReadback */
/** @typedef {import('./manifest.mjs').Capability} Capability */
/** @typedef {{project:import('./manifest.mjs').ProjectIdentity,createdAt:string,evidenceSha256:string,foreignState:boolean}} CreatedProject */
/** @typedef {{manifest:Manifest,operationId:string,purpose:'source'|'target'}} LifecycleContext */
/** @typedef {{preflight:(context:LifecycleContext)=>Promise<import('./manifest.mjs').ProviderPreflight>,create?:(context:LifecycleContext)=>Promise<void>,readCreated?:(context:LifecycleContext)=>Promise<CreatedProject>,remove?:(context:LifecycleContext)=>Promise<void>,readAbsent?:(context:LifecycleContext)=>Promise<{absent:boolean,evidenceSha256:string}>,verifySource?:(context:LifecycleContext)=>Promise<{fixtureRunId:string,fixtureManifestSha256:string,inventorySha256:string,releaseBindingSha256:string,evidenceSha256:string}>}} LifecycleAdapter */

/** Fresh source creation and sequential source retirement share the same private transaction.
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
        ensure(['preflight','create-source','verify-source','retire-source','create-target'].includes(step) && manifest.allowedActions.includes(step), 'ACTION_FORBIDDEN');
        ensure(manifest.humanBoundary === null && manifest.terminal === null, 'TRANSACTION_TERMINAL');
        ensure(manifest.pending === null || manifest.pending.step === step, 'PENDING_OPERATION_REQUIRES_READBACK');
        if (manifest.pending === null && manifest.history.some(entry => entry.step === step)) return manifest;
        const purpose = step === 'create-target' ? 'target' : 'source';
        const operationId = manifest.pending?.operationId ?? randomUUID();
        const context = { manifest: structuredClone(manifest), operationId, purpose: /** @type {'source'|'target'} */ (purpose) };
        /** @param {string} evidenceSha256 */
        const complete = async evidenceSha256 => {
            ensure(/^[a-f0-9]{64}$/u.test(evidenceSha256), 'READBACK_IDENTITY_MISMATCH');
            manifest.history.push({ step, operationId, completedAt: clock(), evidenceSha256, resourceId: null });
            manifest.pending = null;
            await writePrivateManifest(manifestPath, manifest, { repositoryRoot, now: clock(), candidate, replace: true });
            return manifest;
        };
        if (step === 'preflight') {
            ensure(manifest.state === 'planned' && manifest.source === null, 'STATE_TRANSITION_FORBIDDEN');
            const proof = validateProviderPreflight(await adapter.preflight(context), { ...manifest.provisioning, preservedRefs: manifest.preservedRefs, now: clock() });
            // Every pre-existing project is protected, not merely the canonical staging ref.
            ensure(proof.inventoryRefs.every(ref => manifest.preservedRefs.includes(ref)), 'PRESERVED_INVENTORY_INCOMPLETE');
            manifest.providerPreflight = proof; manifest.state = 'provider_preflighted';
            return await complete(proof.evidenceSha256);
        }
        if (step === 'verify-source') {
            ensure(manifest.state === 'source_read_back' && manifest.source && manifest.sourceProvenance && adapter.verifySource, 'SOURCE_IDENTITY_REQUIRED');
            const proof = await adapter.verifySource(context);
            ensure(proof.fixtureRunId === manifest.runId && ['fixtureManifestSha256','inventorySha256','releaseBindingSha256','evidenceSha256'].every(key => /^[a-f0-9]{64}$/u.test(proof[/** @type {keyof typeof proof} */ (key)])), 'SOURCE_PROVENANCE_UNPROVEN');
            Object.assign(manifest.sourceProvenance, { fixtureRunId: proof.fixtureRunId, fixtureManifestSha256: proof.fixtureManifestSha256, inventorySha256: proof.inventorySha256, releaseBindingSha256: proof.releaseBindingSha256, verifiedAt: clock() });
            manifest.state = 'preflighted'; return await complete(proof.evidenceSha256);
        }
        const creating = step === 'create-source' || step === 'create-target';
        if (creating) {
            const before = step === 'create-source' ? ['provider_preflighted','source_creation_pending'] : ['backup_verified','source_absence_verified','target_creation_pending'];
            ensure(before.includes(manifest.state) && (purpose === 'source' ? manifest.source === null : manifest.source !== null && manifest.target === null), 'STATE_TRANSITION_FORBIDDEN');
            if (purpose === 'target') ensure(manifest.backupVerification?.sourceReadsComplete === true, 'BACKUP_VERIFICATION_REQUIRED');
            if (manifest.pending === null) {
                const proof = validateProviderPreflight(await adapter.preflight(context), { ...manifest.provisioning, preservedRefs: manifest.preservedRefs, now: clock() });
                const known = new Set([...manifest.preservedRefs, ...manifest.cleanup.resources.filter(r => r.provider === 'supabase' && r.absentAt === null).map(r => r.id)]);
                ensure(proof.inventoryRefs.every(ref => known.has(ref)), 'PRESERVED_INVENTORY_INCOMPLETE');
                ensure(!manifest.attempts[step] && adapter.create && adapter.readCreated, 'MUTATION_CAPABILITY_REQUIRED');
                manifest.providerPreflight = proof; manifest.pending = { step, operationId, startedAt: clock(), resourceId: null, priorStateSha256: null };
                manifest.attempts[step] = 1; manifest.state = purpose === 'source' ? 'source_creation_pending' : 'target_creation_pending';
                await writePrivateManifest(manifestPath, manifest, { repositoryRoot, now: clock(), candidate, replace: true });
                try { await adapter.create({ ...context, manifest: structuredClone(manifest) }); }
                catch { throw new OperationsError('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY'); }
            }
            ensure(adapter.readCreated && manifest.pending, 'READBACK_CAPABILITY_REQUIRED');
            let proof;
            try { proof = await adapter.readCreated({ ...context, manifest: structuredClone(manifest) }); }
            catch { throw new OperationsError('READBACK_UNCERTAIN_NO_RETRY'); }
            ensure(proof.project.organizationId === manifest.provisioning.organizationId && proof.project.region === manifest.provisioning.region && proof.project.environment === (purpose === 'source' ? 'synthetic' : 'disposable') && proof.foreignState === false, 'TARGET_IDENTITY_MISMATCH');
            ensure(!manifest.preservedRefs.includes(proof.project.ref) && !manifest.forbiddenRefs.includes(proof.project.ref), 'PRESERVED_PROJECT_FORBIDDEN');
            ensure(Number.isFinite(Date.parse(proof.createdAt)) && Date.parse(proof.createdAt) >= Date.parse(manifest.pending.startedAt) - 1000 && Date.parse(proof.createdAt) <= Date.parse(clock()) + 300000, 'CREATION_TIME_MISMATCH');
            const owned = { provider: 'supabase', id: proof.project.ref, runId: manifest.runId, createdAt: proof.createdAt, evidenceSha256: proof.evidenceSha256, disposition: /** @type {const} */ ('disposable'), absentAt: null };
            if (purpose === 'source') {
                manifest.source = proof.project; manifest.forbiddenRefs.push(proof.project.ref);
                manifest.sourceProvenance = { createdAt: proof.createdAt, creationIntentId: operationId, creationReadbackSha256: proof.evidenceSha256, fixtureRunId: null, fixtureManifestSha256: null, inventorySha256: null, releaseBindingSha256: null, verifiedAt: null };
                manifest.state = 'source_read_back';
            } else { manifest.target = proof.project; manifest.state = 'target_read_back'; }
            manifest.cleanup.resources.push(owned);
            return await complete(proof.evidenceSha256);
        }
        ensure(step === 'retire-source' && ['backup_verified','source_retirement_pending'].includes(manifest.state) && manifest.source, 'STATE_TRANSITION_FORBIDDEN');
        ensure(manifest.backupVerification?.sourceReadsComplete === true && Date.parse(manifest.backupVerification.independentlyVerifiedAt) <= Date.parse(clock()) && /^[a-f0-9]{64}$/u.test(manifest.backupVerification.descriptorSha256), 'BACKUP_VERIFICATION_REQUIRED');
        const source = manifest.source;
        const owned = manifest.cleanup.resources.find(r => r.provider === 'supabase' && r.id === source.ref && r.runId === manifest.runId && r.disposition === 'disposable');
        ensure(owned && !manifest.preservedRefs.includes(source.ref) && manifest.sourceProvenance?.verifiedAt && adapter.remove && adapter.readAbsent, 'CLEANUP_OWNERSHIP_MISMATCH');
        if (manifest.pending === null) {
            ensure(owned.absentAt === null && !manifest.attempts[step], 'ATTEMPT_LIMIT');
            manifest.pending = { step, operationId, startedAt: clock(), resourceId: source.ref, priorStateSha256: null }; manifest.attempts[step] = 1; manifest.state = 'source_retirement_pending';
            await writePrivateManifest(manifestPath, manifest, { repositoryRoot, now: clock(), candidate, replace: true });
            try { await adapter.remove({ ...context, manifest: structuredClone(manifest) }); }
            catch { throw new OperationsError('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY'); }
        }
        let absent;
        try { absent = await adapter.readAbsent({ ...context, manifest: structuredClone(manifest) }); }
        catch { throw new OperationsError('READBACK_UNCERTAIN_NO_RETRY'); }
        ensure(absent.absent === true, 'CLEANUP_ABSENCE_UNPROVEN');
        owned.absentAt = clock();
        // Provider project absence also proves absence of its exact manifest-owned Storage children.
        for (const resource of manifest.cleanup.resources) {
            if (resource.provider === 'supabase-storage' && resource.runId === manifest.runId && resource.id.split(':')[1] === source.ref) resource.absentAt = owned.absentAt;
        }
        manifest.state = 'source_absence_verified';
        return await complete(absent.evidenceSha256);
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
/** @typedef {{status:string,evidenceSha256:string,operationId:string,resourceId:string|null,targetRef:string,candidateSha:string,completedAt:string,project?:import('./manifest.mjs').ProjectIdentity,projectObservation?:ProjectReadback,createdResources?:import('./manifest.mjs').OwnedResource[],priorStateSha256?:string,restoredPriorStateSha256?:string}} StepReadback */
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
            ensure(resource && resource.runId === manifest.runId && resource.disposition === 'disposable' && !manifest.forbiddenRefs.includes(resource.id), 'CLEANUP_OWNERSHIP_MISMATCH');
        else
            ensure(resourceId === null, 'UNEXPECTED_RESOURCE');
        const prior = manifest.history.find(item => item.step === step && item.resourceId === resourceId);
        if (prior && manifest.pending === null)
            return manifest;
        ensure(manifest.pending === null || (manifest.pending.step === step && manifest.pending.resourceId === resourceId), 'PENDING_OPERATION_REQUIRES_READBACK');
        ensure(transition.from === '*' || manifest.state === transition.from, 'STATE_TRANSITION_FORBIDDEN');
        if (step === 'cleanup')
            ensure(manifest.cleanup.resources.filter(item => item.disposition === 'disposable').every(item => item.absentAt !== null) && manifest.pending === null, 'CLEANUP_ABSENCE_UNPROVEN');
        const operationId = manifest.pending?.operationId ?? randomUUID();
        const exact = Object.freeze({ operationId, step, source: structuredClone(manifest.source), target: structuredClone(manifest.target), resource: structuredClone(resource), candidate: structuredClone(candidate), runId: manifest.runId });
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
        if (proof.createdResources) {
            ensure(['configure-monitoring', 'monitoring-proof', 'backup-set', 'incident-drill'].includes(step), 'UNEXPECTED_RESOURCE');
            manifest.cleanup.resources.push(...proof.createdResources);
        }
        if (step === 'cleanup-resource' && resource) {
            if (resource.priorStateSha256)
                ensure(proof.restoredPriorStateSha256 === resource.priorStateSha256, 'PRIOR_STATE_RESTORE_UNPROVEN');
            resource.absentAt = proof.completedAt;
        }
        manifest.history.push({ step, operationId, completedAt: proof.completedAt, evidenceSha256: proof.evidenceSha256, resourceId });
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
