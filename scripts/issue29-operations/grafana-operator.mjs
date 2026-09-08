import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { randomUUID,createHash } from 'node:crypto';
import {canonicalJson} from './recovery-set.mjs';
import {persistOperationsEvidence,persistOperationsIntent} from './operator.mjs';
/** @param {unknown} value */
const digest=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
import { assertOwnedSource, assertPrivatePath, ensure, OperationsError, readPrivateManifest, writePrivateManifest } from './manifest.mjs';
import { readSourceReleaseBinding, readTargetReleaseBinding } from './source-binding.mjs';

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
    const role=adapter.configuration().targetRole;ensure(['source','target'].includes(role),'MONITORING_TARGET_ROLE_INVALID');
    const target=role==='target';
    ensure(target?['storage_restored','integrity_verified'].includes(manifest.state):['implementation_verified','monitoring_configured'].includes(manifest.state),'STATE_TRANSITION_FORBIDDEN');
    if(!target)assertOwnedSource(manifest);
    else ensure(manifest.target&&manifest.cleanup.resources.some(r=>r.provider==='supabase'&&r.id===manifest.target?.ref&&r.disposition==='disposable'&&r.absentAt===null),'TARGET_OWNERSHIP_UNPROVEN');
    adapter.assertCredentialSeparation([bindingSettings.providerToken,bindingSettings.source.serviceKey,bindingSettings.deployment.readToken]);
    const configuration=adapter.configuration();
    if(target)ensure(configuration.targetCycleId===(manifest.maintenance?.id??manifest.runId),'MONITORING_TARGET_CYCLE_MISMATCH');
    if(target)ensure(manifest.cleanup.resources.some(r=>r.provider==='grafana'&&r.id===`folder:${configuration.folderUid}`&&r.disposition==='persistent'&&r.runId===manifest.runId&&r.absentAt===null),'MONITORING_TARGET_FOLDER_NOT_OWNED');
    ensure(configuration.runId===manifest.runId && configuration.candidateSha===candidate.sha && configuration.stackAlias===manifest.grafana.stackAlias &&
      configuration.destinationAlias===manifest.grafana.destinationAlias && configuration.targetOrigin===bindingSettings.deployment.origin && configuration.runtimeEnvironment==='development',
      'MONITORING_MANIFEST_IDENTITY_MISMATCH');
    if(target&&manifest.grafana.targetRuleAliases===undefined){
      ensure(manifest.grafana.targetConfigSha256===undefined&&!manifest.pending&&!manifest.history.some(h=>h.step==='configure-monitoring'&&configuration.resources.some(r=>r.key===h.resourceId)),'MONITORING_CONFIG_BINDING_REQUIRED');
      manifest.grafana.targetRuleAliases=configuration.resources.filter(r=>r.kind==='rule').map(r=>r.key);
    }
    const aliases=target?manifest.grafana.targetRuleAliases:manifest.grafana.ruleAliases;ensure(aliases,'MONITORING_RULE_INVENTORY_MISMATCH');
    const configKey=target?'targetConfigSha256':'configSha256';
    const bind=()=>target?readTargetReleaseBinding({manifest,settings:bindingSettings,fetchImpl:options.fetchImpl,now:clock()}):readSourceReleaseBinding({manifest,settings:bindingSettings,fetchImpl:options.fetchImpl,now:clock()});
    const rules=configuration.resources.filter(r=>r.kind==='rule').map(r=>r.key).sort();
    ensure(rules.length===aliases.length && rules.every((key,index)=>key===[...aliases].sort()[index]),'MONITORING_RULE_INVENTORY_MISMATCH');
    const previous=manifest.history.filter(h=>h.step==='configure-monitoring'&&configuration.resources.some(r=>r.key===h.resourceId));
    ensure(manifest.pending===null || (manifest.pending.step==='configure-monitoring' && configuration.resources.some(r=>r.key===manifest.pending?.resourceId)),
      'PENDING_OPERATION_REQUIRES_READBACK');
    if(manifest.grafana[configKey]===undefined) {
      ensure(previous.length===0 && manifest.pending===null,'MONITORING_CONFIG_BINDING_REQUIRED');
      manifest.grafana[configKey]=configuration.configSha256;
      await writePrivateManifest(manifestPath,manifest,{repositoryRoot,now:clock(),candidate,replace:true});
    }
    ensure(manifest.grafana[configKey]===configuration.configSha256,'MONITORING_CONFIG_DRIFT');
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
      ensure(target?['storage_restored','integrity_verified'].includes(manifest.state):manifest.state==='implementation_verified','MONITORING_CONFIGURATION_INCOMPLETE');
      let intentSha256;
      if(manifest.pending===null) {
        await bind();
        const prior=await operation.inspect();ensure(prior.status==='absent','MONITORING_RESOURCE_FOREIGN');
        await persistOperationsEvidence(manifestPath,repositoryRoot,prior,digest(prior));
        const attempt=`configure-monitoring:${resource.key}`;ensure(!manifest.attempts[attempt],'ATTEMPT_LIMIT');
        manifest.pending={step:'configure-monitoring',operationId:randomUUID(),startedAt:clock(),resourceId:resource.key,priorStateSha256:digest(prior)};
        manifest.attempts[attempt]=1;
        await writePrivateManifest(manifestPath,manifest,{repositoryRoot,now:clock(),candidate,replace:true});
        intentSha256=await persistOperationsIntent(manifestPath,manifest,repositoryRoot);
        try {await operation.mutate();}catch {throw new OperationsError('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY');}
      }
      ensure(manifest.pending.resourceId===resource.key,'PENDING_OPERATION_REQUIRES_READBACK');
      intentSha256??=await persistOperationsIntent(manifestPath,manifest,repositoryRoot,{mustExist:true});
      const pending=manifest.pending;let proof;
      try {proof=await operation.readback();}catch {throw new OperationsError('READBACK_UNCERTAIN_NO_RETRY');}
      ensure(proof.status==='verified' && proof.key===resource.key && proof.configSha256===configuration.configSha256 && typeof proof.resourceId==='string' &&
        /^[a-zA-Z0-9:_-]{1,100}$/u.test(proof.resourceId) && Date.parse(proof.readBackAt)>=Date.parse(pending.startedAt) && Date.parse(proof.readBackAt)<=Date.parse(clock())+300000,
        'MONITORING_RESOURCE_READBACK_UNPROVEN');
      const evidenceSha256=digest(proof);await persistOperationsEvidence(manifestPath,repositoryRoot,proof,evidenceSha256);
      const providerId=`${resource.kind}:${proof.resourceId}`;
      ensure(!manifest.cleanup.resources.some(r=>r.id===providerId),'MONITORING_RESOURCE_ID_COLLISION');
      manifest.cleanup.resources.push({provider:'grafana',id:providerId,runId:manifest.runId,createdAt:proof.readBackAt,
        evidenceSha256,disposition:target?'disposable':'persistent',absentAt:null});
      manifest.history.push({step:'configure-monitoring',operationId:pending.operationId,completedAt:proof.readBackAt,evidenceSha256,intentSha256,resourceId:resource.key});
      manifest.pending=null;
      await writePrivateManifest(manifestPath,manifest,{repositoryRoot,now:clock(),candidate,replace:true});
    }
    const verified=await adapter.verifyConfiguration();
    ensure(verified.status==='verified' && verified.configSha256===configuration.configSha256 && verified.candidateSha===candidate.sha,'MONITORING_CONFIGURATION_UNVERIFIED');
    const verifiedHash=digest(verified);await persistOperationsEvidence(manifestPath,repositoryRoot,verified,verifiedHash);
    if(!manifest.history.some(h=>h.step==='configure-monitoring' && h.resourceId===null))manifest.history.push({step:'configure-monitoring',operationId:randomUUID(),completedAt:clock(),evidenceSha256:verifiedHash,resourceId:null});
    if(!target)manifest.state='monitoring_configured';
    await writePrivateManifest(manifestPath,manifest,{repositoryRoot,now:clock(),candidate,replace:true});
    return manifest;
  } catch(error) {
    if(error instanceof OperationsError)throw error;
    throw new OperationsError('MONITORING_OPERATION_FAILED');
  } finally {await lock.close();await unlink(lockPath).catch(()=>{});}
}
