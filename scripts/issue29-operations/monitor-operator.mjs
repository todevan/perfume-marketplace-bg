import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from './recovery-set.mjs';
import { assertOwnedSource, assertPrivatePath, ensure, OperationsError, readPrivateManifest, writePrivateManifest } from './manifest.mjs';
import { persistOperationsEvidence } from './operator.mjs';
import { readSourceReleaseBinding, readTargetReleaseBinding } from './source-binding.mjs';

/** @param {unknown} value */
const digest=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
/** Configure no external monitoring resource. The already-deployed exact Worker owns the one
 * monitor implementation; this transaction only records authenticated configuration readback. */
/** @param {{manifestPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,adapter:ReturnType<import('./monitor-adapter.mjs').createMonitorAdapter>,bindingSettings:import('./source-binding.mjs').BindingSettings,fetchImpl?:typeof fetch,clock?:()=>string,now?:string}} options */
export async function configureMonitor(options) {
  const {manifestPath,repositoryRoot,candidate,adapter,bindingSettings}=options,clock=options.clock??(()=>options.now??new Date().toISOString());
  await assertPrivatePath(manifestPath,repositoryRoot);const lockPath=manifestPath+'.lock';let lock;
  try {lock=await open(lockPath,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch{throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}
  try {const m=await readPrivateManifest(manifestPath,{repositoryRoot,candidate,now:clock()}),config=adapter.configuration(),target=config.targetRole==='target';
    ensure(m.allowedActions.includes('configure-monitoring')&&!m.terminal&&!m.humanBoundary,'ACTION_FORBIDDEN');
    ensure(target?['storage_restored','integrity_verified'].includes(m.state):['implementation_verified','monitoring_configured'].includes(m.state),'STATE_TRANSITION_FORBIDDEN');
    if(target) ensure(m.target&&!m.preservedRefs.includes(m.target.ref),'MONITOR_TARGET_UNPROVEN'); else assertOwnedSource(m);
    ensure(config.runId===m.runId&&config.candidateSha===candidate.sha&&config.environmentAlias===m.fixture.alias&&(!target?config.targetOrigin===bindingSettings.deployment.origin:config.targetProbeOrigin===bindingSettings.deployment.origin)&&config.workerAlias===m.monitoring.workerAlias&&config.destinationAlias===m.monitoring.destinationAlias,'MONITOR_MANIFEST_IDENTITY_MISMATCH');
    ensure(m.cleanup.resources.some(r=>r.provider==='cloudflare-monitor'&&r.id===`worker:${config.workerAlias}`&&r.runId===m.runId&&r.disposition==='persistent'&&r.absentAt===null&&m.history.some(h=>h.step==='deploy-monitor'&&h.resourceId===r.id&&h.evidenceSha256===r.evidenceSha256)),'MONITOR_DEPLOYMENT_OWNERSHIP_UNPROVEN');
    const bind=target?()=>readTargetReleaseBinding({manifest:m,settings:bindingSettings,fetchImpl:options.fetchImpl,now:clock()}):()=>readSourceReleaseBinding({manifest:m,settings:bindingSettings,fetchImpl:options.fetchImpl,now:clock()});
    await bind();const verified=await adapter.verifyConfiguration();ensure(verified.status==='verified'&&verified.candidateSha===candidate.sha,'MONITOR_CONFIGURATION_UNVERIFIED');
    const expected=[...config.signals].sort(),aliases=target?m.monitoring.targetRuleAliases:m.monitoring.ruleAliases;ensure(aliases&&JSON.stringify([...aliases].sort())===JSON.stringify(expected),'MONITOR_RULE_INVENTORY_MISMATCH');
    const verifiedHash=digest(verified);await persistOperationsEvidence(manifestPath,repositoryRoot,verified,verifiedHash);
    const configKey=target?'targetConfigSha256':'configSha256';ensure(!m.monitoring[configKey]||m.monitoring[configKey]===verified.configSha256,'MONITOR_CONFIG_DRIFT');m.monitoring[configKey]=verified.configSha256;
    const id=`worker:${config.workerAlias}`,owned=m.cleanup.resources.find(r=>r.provider==='cloudflare-monitor'&&r.id===id&&r.runId===m.runId);
    ensure(owned?.disposition==='persistent'&&owned.absentAt===null,'MONITOR_RESOURCE_OWNERSHIP_MISMATCH');
    if(!m.history.some(h=>h.step==='configure-monitoring'&&h.resourceId===id))m.history.push({step:'configure-monitoring',operationId:randomUUID(),completedAt:clock(),resourceId:id,evidenceSha256:verifiedHash});
    if(!target)m.state='monitoring_configured';await writePrivateManifest(manifestPath,m,{repositoryRoot,candidate,now:clock(),replace:true});return m;
  }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('MONITOR_OPERATION_FAILED');}finally{await lock.close();await unlink(lockPath).catch(()=>{});}
}
