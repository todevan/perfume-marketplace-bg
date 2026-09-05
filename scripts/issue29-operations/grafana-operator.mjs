import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { assertOwnedSource, assertPrivatePath, ensure, OperationsError, readPrivateManifest, writePrivateManifest } from './manifest.mjs';
import { readSourceReleaseBinding } from './source-binding.mjs';

/** @typedef {ReturnType<import('./grafana-adapter.mjs').createGrafanaAdapter>} GrafanaAdapter */
/** Create one configuration via individual persisted mutations in the existing private transaction.
 * Every provider identity is re-read; a pending create is readback-only, never repeated.
 * This does not prove hosted alerts and does not advance monitoring_proved.
 * @param {{manifestPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,
 * adapter:GrafanaAdapter,bindingSettings:import('./source-binding.mjs').BindingSettings,
 * fetchImpl?:typeof fetch,now?:string,clock?:()=>string}} options
 */
export async function configureGrafanaMonitoring(options) {
  const {manifestPath,repositoryRoot,candidate,adapter,bindingSettings}=options;
  const clock=options.clock??(()=>options.now??new Date().toISOString());
  await assertPrivatePath(manifestPath,repositoryRoot);
  const lockPath=`${manifestPath}.lock`;let lock;
  try {lock=await open(lockPath,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}
  catch {throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}
  try {
    const manifest=await readPrivateManifest(manifestPath,{repositoryRoot,now:clock(),candidate});
    ensure(manifest.allowedActions.includes('configure-monitoring') && manifest.humanBoundary===null && manifest.terminal===null,'ACTION_FORBIDDEN');
    ensure(['implementation_verified','monitoring_configured'].includes(manifest.state),'STATE_TRANSITION_FORBIDDEN');
    assertOwnedSource(manifest);
    adapter.assertCredentialSeparation([bindingSettings.providerToken,bindingSettings.source.serviceKey,bindingSettings.deployment.readToken]);
    const configuration=adapter.configuration();
    ensure(configuration.runId===manifest.runId && configuration.candidateSha===candidate.sha && configuration.stackAlias===manifest.grafana.stackAlias &&
      configuration.destinationAlias===manifest.grafana.destinationAlias && configuration.targetOrigin===bindingSettings.deployment.origin && configuration.runtimeEnvironment==='development',
      'MONITORING_MANIFEST_IDENTITY_MISMATCH');
    const rules=configuration.resources.filter(r=>r.kind==='rule').map(r=>r.key).sort();
    ensure(rules.length===manifest.grafana.ruleAliases.length && rules.every((key,index)=>key===[...manifest.grafana.ruleAliases].sort()[index]),'MONITORING_RULE_INVENTORY_MISMATCH');
    const previous=manifest.history.filter(h=>h.step==='configure-monitoring');
    ensure(manifest.pending===null || (manifest.pending.step==='configure-monitoring' && configuration.resources.some(r=>r.key===manifest.pending?.resourceId)),
      'PENDING_OPERATION_REQUIRES_READBACK');
    if(manifest.grafana.configSha256===undefined) {
      ensure(previous.length===0 && manifest.pending===null,'MONITORING_CONFIG_BINDING_REQUIRED');
      manifest.grafana.configSha256=configuration.configSha256;
      await writePrivateManifest(manifestPath,manifest,{repositoryRoot,now:clock(),candidate,replace:true});
    }
    ensure(manifest.grafana.configSha256===configuration.configSha256,'MONITORING_CONFIG_DRIFT');
    /** @param {string} key @param {string} id @param {string} kind */
    const owned=(key,id,kind)=>manifest.cleanup.resources.find(r=>r.provider==='grafana' && r.id===`${kind}:${id}` && r.runId===manifest.runId && r.absentAt===null &&
      manifest.history.some(h=>h.step==='configure-monitoring' && h.resourceId===key));
    for(const resource of configuration.resources) {
      const history=manifest.history.find(h=>h.step==='configure-monitoring' && h.resourceId===resource.key);
      const operation=adapter.resourceOperation(resource.key);
      if(history) {
        const proof=await operation.readback();
        ensure(proof.status==='verified' && typeof proof.resourceId==='string' && owned(resource.key,proof.resourceId,resource.kind),'MONITORING_OWNERSHIP_READBACK_MISMATCH');
        continue;
      }
      ensure(manifest.state==='implementation_verified','MONITORING_CONFIGURATION_INCOMPLETE');
      if(manifest.pending===null) {
        await readSourceReleaseBinding({manifest,settings:bindingSettings,fetchImpl:options.fetchImpl,now:clock()});
        const prior=await operation.inspect();ensure(prior.status==='absent','MONITORING_RESOURCE_FOREIGN');
        const attempt=`configure-monitoring:${resource.key}`;ensure(!manifest.attempts[attempt],'ATTEMPT_LIMIT');
        manifest.pending={step:'configure-monitoring',operationId:randomUUID(),startedAt:clock(),resourceId:resource.key,priorStateSha256:prior.evidenceSha256};
        manifest.attempts[attempt]=1;
        await writePrivateManifest(manifestPath,manifest,{repositoryRoot,now:clock(),candidate,replace:true});
        try {await operation.mutate();}catch {throw new OperationsError('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY');}
      }
      ensure(manifest.pending.resourceId===resource.key,'PENDING_OPERATION_REQUIRES_READBACK');
      const pending=manifest.pending;let proof;
      try {proof=await operation.readback();}catch {throw new OperationsError('READBACK_UNCERTAIN_NO_RETRY');}
      ensure(proof.status==='verified' && proof.key===resource.key && proof.configSha256===configuration.configSha256 && typeof proof.resourceId==='string' &&
        /^[a-zA-Z0-9:_-]{1,100}$/u.test(proof.resourceId) && Date.parse(proof.readBackAt)>=Date.parse(pending.startedAt) && Date.parse(proof.readBackAt)<=Date.parse(clock())+300000,
        'MONITORING_RESOURCE_READBACK_UNPROVEN');
      const providerId=`${resource.kind}:${proof.resourceId}`;
      ensure(!manifest.cleanup.resources.some(r=>r.id===providerId),'MONITORING_RESOURCE_ID_COLLISION');
      manifest.cleanup.resources.push({provider:'grafana',id:providerId,runId:manifest.runId,createdAt:proof.readBackAt,
        evidenceSha256:proof.evidenceSha256,disposition:'persistent',absentAt:null});
      manifest.history.push({step:'configure-monitoring',operationId:pending.operationId,completedAt:proof.readBackAt,evidenceSha256:proof.evidenceSha256,resourceId:resource.key});
      manifest.pending=null;
      await writePrivateManifest(manifestPath,manifest,{repositoryRoot,now:clock(),candidate,replace:true});
    }
    const verified=await adapter.verifyConfiguration();
    ensure(verified.status==='verified' && verified.configSha256===configuration.configSha256 && verified.candidateSha===candidate.sha,'MONITORING_CONFIGURATION_UNVERIFIED');
    if(!manifest.history.some(h=>h.step==='configure-monitoring' && h.resourceId===null))manifest.history.push({step:'configure-monitoring',operationId:randomUUID(),completedAt:clock(),evidenceSha256:verified.evidenceSha256,resourceId:null});
    manifest.state='monitoring_configured';
    await writePrivateManifest(manifestPath,manifest,{repositoryRoot,now:clock(),candidate,replace:true});
    return manifest;
  } catch(error) {
    if(error instanceof OperationsError)throw error;
    throw new OperationsError('MONITORING_OPERATION_FAILED');
  } finally {await lock.close();await unlink(lockPath).catch(()=>{});}
}
