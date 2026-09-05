import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { assertExactTarget, assertPrivatePath, ensure, OperationsError, readPrivateManifest, writePrivateManifest } from './manifest.mjs';
/** @typedef {import('./manifest.mjs').OperationsManifest} Manifest */
/** @typedef {import('./manifest.mjs').ProjectReadback} ProjectReadback */
/** @typedef {import('./manifest.mjs').Capability} Capability */
/** @typedef {{from:string,to:string,role:Capability,scope:'source'|'target',mutation?:boolean}} Transition */
/** @type {Record<string,Transition>} */
const TRANSITIONS = Object.freeze({
    preflight: { from: 'planned', to: 'preflighted', role: 'source-read', scope: 'source' },
    'implementation-verified': { from: 'preflighted', to: 'implementation_verified', role: 'source-read', scope: 'source' },
    'configure-monitoring': { from: 'implementation_verified', to: 'monitoring_configured', role: 'monitoring-config', scope: 'source', mutation: true },
    'monitoring-proof': { from: 'monitoring_configured', to: 'monitoring_proved', role: 'monitoring-config', scope: 'source', mutation: true },
    'backup-set': { from: 'monitoring_proved', to: 'backup_started', role: 'source-read', scope: 'source', mutation: true },
    'verify-backup': { from: 'backup_started', to: 'backup_verified', role: 'source-read', scope: 'source' },
    'create-target': { from: 'backup_verified', to: 'target_read_back', role: 'restore-write', scope: 'source', mutation: true },
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
        ensure(transition.from === '*' || manifest.state === transition.from || (step === 'create-target' && manifest.state === 'target_creation_pending' && manifest.pending?.step === step), 'STATE_TRANSITION_FORBIDDEN');
        if (step === 'cleanup')
            ensure(manifest.cleanup.resources.filter(item => item.disposition === 'disposable').every(item => item.absentAt !== null) && manifest.pending === null, 'CLEANUP_ABSENCE_UNPROVEN');
        const operationId = manifest.pending?.operationId ?? randomUUID();
        const exact = Object.freeze({ operationId, step, source: structuredClone(manifest.source), target: structuredClone(manifest.target), resource: structuredClone(resource), candidate: structuredClone(candidate), runId: manifest.runId });
        // Readback-only resume must not require an already-deleted project to remain healthy.
        // A fresh mutation always receives current exact-identity guards first.
        if (manifest.pending === null) {
            let observed;
            try {
                observed = await inspect(exact);
            }
            catch {
                throw new OperationsError('PREFLIGHT_READBACK_FAILED');
            }
            now = clock();
            assertExactTarget(manifest, observed, { role: step === 'create-target' ? 'source-read' : capability, scope: transition.scope, now, requireEmpty: true });
            if (step === 'create-target') {
                const proposed = observed.creation;
                ensure(manifest.target === null && proposed?.organizationId === manifest.source.organizationId && proposed.region === manifest.source.region && proposed.plan === 'free' && proposed.cost === 0 && proposed.freeCapacity === true && proposed.credentialId === manifest.capabilityIds['restore-write'] && proposed.cleanupAuthorized === true, 'TARGET_CREATION_PREFLIGHT_FAILED');
            }
            const attemptKey = `${step}${resourceId === null ? '' : `:${resourceId}`}`;
            ensure(!manifest.attempts[attemptKey], 'ATTEMPT_LIMIT');
            if (transition.mutation)
                ensure(typeof mutate === 'function', 'MUTATION_CAPABILITY_REQUIRED');
            if (step === 'configure-monitoring')
                ensure(/^[a-f0-9]{64}$/u.test(observed.priorStateSha256 ?? ''), 'PRIOR_STATE_REQUIRED');
            manifest.pending = { step, operationId, startedAt: now, resourceId, priorStateSha256: observed.priorStateSha256 ?? null };
            manifest.attempts[attemptKey] = 1;
            if (step === 'create-target')
                manifest.state = 'target_creation_pending';
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
        if (step === 'create-target') {
            ensure(proof.project && proof.project.organizationId === manifest.source.organizationId && proof.project.region === manifest.source.region && proof.project.postgresVersion === manifest.source.postgresVersion && proof.projectObservation && proof.createdResources?.some(item => item.provider === 'supabase' && item.id === proof.project?.ref && item.runId === manifest.runId && item.disposition === 'disposable'), 'TARGET_CREATION_READBACK_UNPROVEN');
            assertExactTarget({ ...manifest, target: proof.project }, proof.projectObservation, { role: 'restore-write', scope: 'target', now });
            manifest.target = proof.project;
        }
        if (proof.createdResources) {
            ensure(['create-target', 'configure-monitoring', 'monitoring-proof', 'backup-set', 'incident-drill'].includes(step), 'UNEXPECTED_RESOURCE');
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
