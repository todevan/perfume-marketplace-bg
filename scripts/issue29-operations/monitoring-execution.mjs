import {constants} from 'node:fs';
import {open,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {assertPrivatePath,ensure,OperationsError,readPrivateManifest,writePrivateManifest} from './manifest.mjs';
import {canonicalJson,readRecoveryDescriptor,verifyEncryptedRecoverySet} from './recovery-set.mjs';
import {persistOperationsEvidence,persistOperationsIntent} from './operator.mjs';
import {readPrivateBytes} from './execution.mjs';
import {readSourceReleaseBinding,readTargetReleaseBinding} from './source-binding.mjs';
import {createGrafanaAdapter,createGrafanaRuleFixtureAdapter,createGrafanaHeartbeatAdapter,grafanaConfigSchema} from './grafana-adapter.mjs';
import {readProtectedMergeEvidence} from './worker-adapter.mjs';
import {configureGrafanaMonitoring} from './grafana-operator.mjs';
import {captureMonitoringPhase,verifyMonitoringProof} from './monitoring-proof.mjs';
import {createSentinelAdapter,createEmailCanaryAdapter,captureIncidentBaseline,verifyStorageIncident} from './incident-adapter.mjs';
import {CANONICAL_SYNTHETIC_JOBS,readSyntheticJobsEvidence} from './synthetic-jobs.mjs';
const hash=z.string().regex(/^[a-f0-9]{64}$/u),alias=z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/u),secret=z.string().min(16).max(4096).regex(/^[!-~]+$/u);
const binding=z.object({providerToken:secret,source:z.object({apiUrl:z.url(),serviceKey:secret}).strict(),deployment:z.object({accountId:z.string(),workerName:z.string(),versionId:z.string(),origin:z.url(),readToken:secret}).strict()}).strict();
const database=z.object({scope:z.object({mode:z.literal('hosted'),role:z.enum(['source','target']),runId:z.uuid(),projectRef:z.string(),sourceRef:z.string(),preservedRefs:z.array(z.string()),createdResourceEvidenceSha256:hash,apiUrl:z.url()}).strict(),
  connection:z.object({host:z.string(),port:z.number().int(),user:z.string(),database:z.string(),password:secret,sslmode:z.literal('verify-full'),sslRootCert:z.string().optional()}).strict(),
  toolchain:z.discriminatedUnion('mode',[z.object({mode:z.literal('container')}).strict(),z.object({mode:z.literal('native'),binDirectory:z.string()}).strict()])}).strict();
const resend=z.object({apiKey:secret,domainId:z.uuid(),webhookId:z.uuid(),from:z.email(),to:z.email(),operationId:z.uuid(),windowStart:z.iso.datetime(),webhookOrigin:z.url(),syntheticScopeEvidenceSha256:hash,requireLiveQuota:z.boolean().optional(),
  freePlanEvidence:z.object({observedAt:z.iso.datetime(),remainingDaily:z.number().int().positive(),quotedCost:z.literal(0),evidenceSha256:hash}).strict()}).strict();
export const monitoringExecutionSettingsSchema=z.object({schemaVersion:z.literal(1),operation:z.enum(['configure-monitoring','monitoring-proof','incident-drill','maintenance-silence','maintenance-unsilence']),
  action:z.enum(['configure','release-update','configure-fixture','cleanup-fixture','fixture-sample','capture-failure','capture-recovery','verify-rule-proof','maintenance-silence','maintenance-unsilence',
    'canary-send','canary-checkpoint','sentinel-readiness','sentinel-read','sentinel-create-bucket','sentinel-upload','sentinel-remove','sentinel-recover','sentinel-delete-bucket','incident-baseline','incident-verify','backup-checkpoint','source-green']),
  actionId:z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/u),grafana:grafanaConfigSchema,binding,fixture:z.object({writeOrigin:z.url(),writeToken:secret,expiresAt:z.iso.datetime()}).strict().optional(),
  sentinel:z.object({sha256:hash,bytesBase64:z.string().max(8192)}).strict().optional(),canary:z.object({database,resend}).strict().optional(),
  metricsWrite:z.object({writeOrigin:z.url(),writeToken:secret}).strict().optional(),backupDirectory:z.string().optional(),inputPath:z.string().optional(),knownMessageId:z.uuid().optional(),
  previousCandidateSha:z.string().regex(/^[a-f0-9]{40}$/u).optional(),mergeEvidenceDirectory:z.string().optional(),
  ruleKey:alias.optional(),windowStart:z.iso.datetime().optional(),sample:z.object({phase:z.enum(['failure','recovery']),sampleAt:z.iso.datetime()}).strict().optional()}).strict();
/** @typedef {z.infer<typeof monitoringExecutionSettingsSchema>} MonitoringExecutionSettings */
/** @param {unknown} value */
const digest=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
/** The first pre-merge rehearsal may close from the independently decrypted owner copy, but
 * never claim that copy is a GitHub workflow artifact or suppress another monitor failure.
 * @param {import('./manifest.mjs').OperationsManifest} manifest @param {string} manifestPath @param {string} repositoryRoot @param {string} now */
export async function hasCurrentPremergeOwnerCopy(manifest,manifestPath,repositoryRoot,now){
 const maintenance=manifest.maintenance,source=manifest.source;
 const githubArtifact=manifest.cleanup.resources.some(resource=>resource.provider==='github'&&resource.disposition==='persistent'&&resource.absentAt===null);
 if(manifest.releaseUpdate||githubArtifact)return false;
 if(!maintenance||!source||!manifest.backupVerification)return false;
 ensure(manifest.backupVerification.descriptorSha256===maintenance.backup.descriptorSha256,'PREMERGE_OWNER_COPY_PROOF_INVALID');
 const owner=manifest.cleanup.resources.find(resource=>resource.provider==='owner-copy'&&resource.id===`owner-copy:${maintenance.backup.descriptorSha256}`&&resource.runId===manifest.runId&&resource.disposition==='persistent'&&resource.absentAt===null);
 if(!owner)return false;
 let copy,artifact;try{
  const copyBytes=await readPrivateBytes(join(dirname(manifestPath),`${owner.evidenceSha256}.json`),repositoryRoot);
  ensure(createHash('sha256').update(copyBytes).digest('hex')===owner.evidenceSha256,'PREMERGE_OWNER_COPY_PROOF_INVALID');copy=JSON.parse(copyBytes.toString());
  const artifactBytes=await readPrivateBytes(join(dirname(manifestPath),`${maintenance.backup.artifactSha256}.json`),repositoryRoot);
  ensure(createHash('sha256').update(artifactBytes).digest('hex')===maintenance.backup.artifactSha256,'PREMERGE_OWNER_COPY_PROOF_INVALID');artifact=JSON.parse(artifactBytes.toString());
 }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('PREMERGE_OWNER_COPY_PROOF_INVALID');}
 const exact=value=>value&&typeof value==='object'&&value.provider==='owner-encrypted-retention'&&value.runId===manifest.runId&&value.sourceRef===source.ref&&value.descriptorSha256===maintenance.backup.descriptorSha256&&value.destinationAlias==='owner-secondary'&&value.retentionDays===35&&value.encryptedOnly===true&&value.workflowProof===false&&typeof value.expiresAt==='string'&&Date.parse(value.expiresAt)>Date.parse(now);
 ensure(exact(copy)&&exact(artifact)&&artifact.verifiedAt===maintenance.backup.retentionVerifiedAt&&artifact.recovery?.descriptorSha256===maintenance.backup.descriptorSha256,'PREMERGE_OWNER_COPY_PROOF_INVALID');
 return true;
}
/** A source may be unsilenced only after its current maintenance window has restored and
 * proved the exact two owned jobs. The receipt is manifest-owned and follows the exact
 * source resume entry, so an earlier pre-maintenance proof cannot close this window.
 * @param {import('./manifest.mjs').OperationsManifest} manifest @param {string} manifestPath @param {string} repositoryRoot */
async function requireCurrentSourceJobProof(manifest,manifestPath,repositoryRoot){
 const maintenance=manifest.maintenance,source=manifest.source;
 ensure(maintenance?.resumedAt&&source,'SOURCE_JOBS_RESUME_PROOF_REQUIRED');
 const resumeIndex=manifest.history.map((entry,index)=>({entry,index})).filter(({entry})=>entry.step==='resume-source'&&entry.resourceId===`${source.ref}:${maintenance.id}`).at(-1)?.index;
 let jobs;try{jobs=await readSyntheticJobsEvidence({manifest,manifestPath,repositoryRoot,role:'source'});}catch{throw new OperationsError('SOURCE_JOBS_RESUME_PROOF_REQUIRED');}
 const jobIndex=manifest.history.findLastIndex(entry=>entry.step==='synthetic-jobs'&&entry.resourceId==='source-jobs');
 ensure(resumeIndex!==undefined&&jobIndex>resumeIndex&&jobs.mode==='proved'&&Date.parse(jobs.checkedAt)>=Date.parse(maintenance.resumedAt),'SOURCE_JOBS_RESUME_PROOF_REQUIRED');
 ensure(Array.isArray(jobs.state)&&jobs.state.length===CANONICAL_SYNTHETIC_JOBS.length&&jobs.state.every(job=>{
  const expected=CANONICAL_SYNTHETIC_JOBS.find(candidate=>candidate.jobname===job.jobname);
  return expected&&job.active===true&&job.schedule===expected.schedule&&job.command===expected.command&&job.nodename==='localhost'&&job.nodeport===5432&&job.database==='postgres'&&job.username==='postgres';
 }), 'SOURCE_JOBS_RESUME_PROOF_REQUIRED');
 ensure(Array.isArray(jobs.proof)&&jobs.proof.length===CANONICAL_SYNTHETIC_JOBS.length&&jobs.proof.every(proof=>CANONICAL_SYNTHETIC_JOBS.some(job=>job.jobname===proof.jobname)&&proof.status==='succeeded'&&['1 row','SELECT 1'].includes(proof.returnMessage)&&Date.parse(proof.startTime)>=Date.parse(maintenance.resumedAt)&&Date.parse(proof.endTime)>=Date.parse(proof.startTime)),'SOURCE_JOBS_RESUME_PROOF_REQUIRED');
}
/** One existing private manifest, one exact once-only mutation per pending intent. Evidence JSON
 * beside the manifest is output, not a competing state machine; history binds every accepted hash.
 * @param {{manifestPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,settings:unknown,fetchImpl?:typeof fetch,ledgerReader?:typeof import('./incident-adapter.mjs').readCanaryLedger,clock?:()=>string,now?:string}} options */
export async function executeMonitoringAction(options){
  const parsed=monitoringExecutionSettingsSchema.safeParse(options.settings);ensure(parsed.success,'MONITORING_SETTINGS_INVALID');const s=parsed.data;
  const {manifestPath,repositoryRoot,candidate}=options,clock=options.clock??(()=>options.now??new Date().toISOString());
  const g=createGrafanaAdapter(s.grafana,{fetchImpl:options.fetchImpl,now:clock});
  if(s.action==='configure'){ensure(s.operation==='configure-monitoring','MONITORING_ACTION_MISMATCH');return configureGrafanaMonitoring({...options,adapter:g,bindingSettings:s.binding,clock});}
  const step=s.action.startsWith('maintenance-')?s.action:s.operation;
  ensure((s.action==='release-update'&&s.operation==='configure-monitoring')||(s.action.startsWith('maintenance-')&&s.operation===s.action)||
    (['canary-send','canary-checkpoint','backup-checkpoint','source-green','configure-fixture','cleanup-fixture','fixture-sample','capture-failure','capture-recovery','verify-rule-proof'].includes(s.action)&&s.operation==='monitoring-proof')||
    ((s.action.startsWith('sentinel-')||s.action.startsWith('incident-'))&&s.operation==='incident-drill'),'MONITORING_ACTION_MISMATCH');
  await assertPrivatePath(manifestPath,repositoryRoot);let lock;
  try{lock=await open(manifestPath+'.lock',constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch{throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}
  try{
    const m=await readPrivateManifest(manifestPath,{repositoryRoot,candidate,now:clock()}),role=s.grafana.targetRole??'source';
    ensure(m.allowedActions.includes(step)&&!m.terminal&&!m.humanBoundary,'ACTION_FORBIDDEN');
    const selected=role==='source'?m.source:m.target;ensure(selected&&!m.preservedRefs.includes(selected.ref),'MONITORING_TARGET_UNPROVEN');
    if(role==='target')ensure(g.configuration().targetCycleId===(m.maintenance?.id??m.runId),'MONITORING_TARGET_CYCLE_MISMATCH');
    const release=s.action==='release-update';
    if(release)ensure(role==='source'&&m.releaseUpdate&&s.previousCandidateSha===m.releaseUpdate.fromCandidate.sha,'MONITORING_RELEASE_PRIOR_MISMATCH');
    const previousConfiguration=release?createGrafanaAdapter({...s.grafana,candidateSha:s.previousCandidateSha??''}).configuration():null;
    const config=g.configuration(),configured=role==='source'?m.grafana.configSha256:m.grafana.targetConfigSha256;
    ensure(config.runId===m.runId&&config.candidateSha===candidate.sha&&config.stackAlias===m.grafana.stackAlias&&(config.configSha256===configured||(release&&previousConfiguration?.configSha256===configured))&&
      config.targetOrigin===s.binding.deployment.origin&&config.runtimeEnvironment==='development'&&s.binding.source.apiUrl===selected.url,'MONITORING_MANIFEST_IDENTITY_MISMATCH');
    const selectedOwned=m.cleanup.resources.find(r=>r.provider==='supabase'&&r.id===selected.ref&&r.runId===m.runId&&r.absentAt===null);
    ensure(selectedOwned?.disposition===(role==='source'?'persistent':'disposable'),'MONITORING_TARGET_OWNERSHIP_MISMATCH');
    g.assertCredentialSeparation([s.binding.providerToken,s.binding.source.serviceKey,s.binding.deployment.readToken]);
    const save=()=>writePrivateManifest(manifestPath,m,{repositoryRoot,candidate,now:clock(),replace:true});
    const scope=role==='target'?`target-${digest({cycleId:m.maintenance?.id??m.runId,action:s.action,actionId:s.actionId}).slice(0,32)}`:s.fixture?`source-${s.action}-${digest({actionId:s.actionId,fixtureConfig:createGrafanaRuleFixtureAdapter(s.grafana,s.fixture).configuration().configSha256}).slice(0,16)}`:`${role}-${s.action}-${s.actionId}`;
    /** @param {string} key */const path=key=>/^[a-f0-9]{64}$/u.test(key)?join(dirname(manifestPath),`${key}.json`):`${manifestPath}.${key}.json`;
    /** @param {string} key @param {unknown} proof */
    async function writeEvidence(key,proof){await persistOperationsEvidence(manifestPath,repositoryRoot,proof,digest(proof));const file=path(key);await assertPrivatePath(file,repositoryRoot);
      try{const h=await open(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{await h.writeFile(canonicalJson(proof));await h.sync();}finally{await h.close();}}
      catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='EEXIST')throw error;ensure(digest(JSON.parse((await readPrivateBytes(file,repositoryRoot)).toString()))===digest(proof),'MONITORING_EVIDENCE_COLLISION');}}
    /** @param {string} key */const readEvidence=async key=>JSON.parse((await readPrivateBytes(path(key),repositoryRoot)).toString());
    const bind=()=>role==='target'?readTargetReleaseBinding({manifest:m,settings:s.binding,fetchImpl:options.fetchImpl,now:clock()}):readSourceReleaseBinding({manifest:m,settings:s.binding,fetchImpl:options.fetchImpl,now:clock()});
    const evidenceMode=config.evidenceMode;
    /** @param {string} key @param {()=>Promise<Record<string,any>>} read */
    async function capture(key,read){ensure(!m.pending,'PENDING_OPERATION_REQUIRES_READBACK');const previous=m.history.find(h=>h.step===step&&h.resourceId===key);
      if(previous){const receipt=await readEvidence(key);ensure(digest(receipt)===previous.evidenceSha256,'MONITORING_EVIDENCE_HASH_MISMATCH');return receipt;}
      await bind();const receipt=await read();await writeEvidence(key,receipt);m.history.push({step,operationId:randomUUID(),resourceId:key,completedAt:clock(),evidenceSha256:digest(receipt)});await save();return receipt;}
    /** @param {string} key @param {{inspect:()=>Promise<any>,mutate:()=>Promise<any>,readback:()=>Promise<any>}} operation
     * @param {{provider:string,disposition:'persistent'|'disposable',remove?:boolean,id?:(proof:any)=>string}} [ownership] */
    async function mutate(key,operation,ownership){
      const prior=m.history.find(h=>h.step===step&&h.resourceId===key);
      if(prior){const proof=await readEvidence(key);ensure(digest(proof)===prior.evidenceSha256,'MONITORING_EVIDENCE_HASH_MISMATCH');return operation.readback();}
      ensure(!m.pending||(m.pending.step===step&&m.pending.resourceId===key),'PENDING_OPERATION_REQUIRES_READBACK');
      let intentSha256;
      if(!m.pending){await bind();const before=await operation.inspect(),attempt=`${step}:${key}`;ensure(!m.attempts[attempt],'ATTEMPT_LIMIT');
        if(ownership)await writeEvidence(digest(before),before);
        m.pending={step,operationId:randomUUID(),resourceId:key,startedAt:clock(),priorStateSha256:ownership?digest(before):before.evidenceSha256??digest(before)};m.attempts[attempt]=1;await save();
        if(ownership)intentSha256=await persistOperationsIntent(manifestPath,m,repositoryRoot);
        try{const submission=await operation.mutate();if(submission!==undefined)await writeEvidence(key+'-submission',submission);}catch{throw new OperationsError('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY');}}
      if(ownership)intentSha256??=await persistOperationsIntent(manifestPath,m,repositoryRoot,{mustExist:true});
      const pending=m.pending;let proof;try{proof=await operation.readback();}catch{throw new OperationsError('READBACK_UNCERTAIN_NO_RETRY');}
      ensure(proof&&['verified','absent','active','expired'].includes(proof.status??(proof.eventType==='email.delivered'?'verified':'')),'MONITORING_READBACK_INVALID');
      if(ownership){const id=ownership.id?ownership.id(proof):proof.resourceId;ensure(typeof id==='string','MONITORING_OWNED_ID_MISSING');
        const owned=m.cleanup.resources.find(r=>r.provider===ownership.provider&&r.id===id&&r.runId===m.runId);
        if(ownership.remove){ensure(owned&&owned.disposition==='disposable','MONITORING_CLEANUP_NOT_OWNED');owned.absentAt=clock();}
        else if(!owned)m.cleanup.resources.push({provider:ownership.provider,id,runId:m.runId,createdAt:clock(),evidenceSha256:digest(proof),disposition:ownership.disposition,absentAt:null});
        else ensure(owned.absentAt===null&&owned.disposition===ownership.disposition,'MONITORING_RESOURCE_OWNERSHIP_MISMATCH');}
      await writeEvidence(key,proof);m.history.push({step,operationId:pending.operationId,resourceId:key,completedAt:clock(),evidenceSha256:digest(proof),...(intentSha256?{intentSha256}:{})});m.pending=null;await save();return proof;
    }
    const sentinel=()=>{ensure(s.sentinel,'SENTINEL_SETTINGS_REQUIRED');return createSentinelAdapter({manifest:m,projectRef:selected.ref,providerToken:s.binding.providerToken,serviceKey:s.binding.source.serviceKey,
      sentinel:{path:`${m.runId}/sentinel.bin`,sha256:s.sentinel.sha256,bytes:Buffer.from(s.sentinel.bytesBase64,'base64')},readinessOrigin:s.binding.deployment.origin,monitorToken:s.grafana.monitorToken},{fetchImpl:options.fetchImpl,now:clock});};
    const input=async()=>{ensure(s.inputPath,'PRIVATE_EVIDENCE_INPUT_REQUIRED');return JSON.parse((await readPrivateBytes(s.inputPath,repositoryRoot)).toString());};
    if(release){
      ensure(previousConfiguration&&m.releaseUpdate&&s.previousCandidateSha,'MONITORING_RELEASE_PRIOR_MISMATCH');
      ensure(!m.maintenance||m.maintenance.phase==='closed','SOURCE_MAINTENANCE_ACTIVE');
      const merge=await readProtectedMergeEvidence(m,s.mergeEvidenceDirectory??dirname(manifestPath),repositoryRoot,{allowFixture:Boolean(options.fetchImpl)});
      ensure(m.candidate.deploymentId!==m.releaseUpdate.fromCandidate.deploymentId&&m.history.some(h=>h.step==='update-worker'&&h.resourceId===s.binding.deployment.workerName&&Date.parse(h.completedAt)>=Date.parse(merge.verifiedAt)),'MONITORING_RELEASE_WORKER_UNPROVEN');
      await bind();
      const finished=m.history.find(h=>h.step===step&&h.resourceId===scope);
      if(finished){ensure(!m.pending,'PENDING_OPERATION_REQUIRES_READBACK');const receipt=await readEvidence(finished.evidenceSha256);
        ensure(digest(receipt)===finished.evidenceSha256&&receipt.previousConfigSha256===previousConfiguration.configSha256&&receipt.configSha256===config.configSha256,'MONITORING_RELEASE_PRIOR_MISMATCH');await g.verifyConfiguration();return receipt;}
      ensure(configured===previousConfiguration.configSha256,'MONITORING_RELEASE_PRIOR_MISMATCH');
      const receipts=[];
      for(const resource of config.resources){
        const creation=m.history.find(h=>h.step==='configure-monitoring'&&h.resourceId===resource.key);
        const owned=m.cleanup.resources.find(r=>r.provider==='grafana'&&r.id.startsWith(resource.kind+':')&&r.evidenceSha256===creation?.evidenceSha256&&r.runId===m.runId&&r.disposition==='persistent'&&r.absentAt===null);
        ensure(creation&&owned,'MONITORING_RELEASE_RESOURCE_NOT_OWNED');const resourceId=owned.id.slice(resource.kind.length+1);
        if(!['check','rule'].includes(resource.kind)){ensure((await g.readResource(resource.key,resourceId)).status==='verified','MONITORING_RELEASE_RESOURCE_UNPROVEN');continue;}
        const key=`${scope}-${resource.key}`,completed=m.history.find(h=>h.step===step&&h.resourceId===key);
        const priorSha=m.pending?.resourceId===key?m.pending.priorStateSha256:completed?(await readEvidence(key)).priorStateSha256:null;
        const priorState=priorSha?await readEvidence(priorSha):undefined;if(priorSha)ensure(digest(priorState)===priorSha,'MONITORING_EVIDENCE_HASH_MISMATCH');
        const op=g.releaseUpdateOperation(resource.key,s.previousCandidateSha,{resourceId,priorState,...(priorSha?{expectedPriorSha256:priorSha}:{}),capturePrior:async prior=>writeEvidence(digest(prior),prior)});
        receipts.push(await mutate(key,op));
      }
      ensure(receipts.length===13,'MONITORING_RELEASE_INVENTORY_INVALID');const configuration=await g.verifyConfiguration();
      const receipt={schemaVersion:1,kind:'issue29-grafana-release-update',evidenceMode,runId:m.runId,previousCandidateSha:s.previousCandidateSha,candidateSha:candidate.sha,
        previousConfigSha256:previousConfiguration.configSha256,configSha256:config.configSha256,environmentAlias:config.environmentAlias,origin:config.targetOrigin,
        verifiedAt:clock(),protectedMergeEvidenceSha256:m.releaseUpdate.evidenceSha256,resources:receipts,configuration};
      const evidenceSha256=digest(receipt);await writeEvidence(evidenceSha256,receipt);m.grafana.configSha256=config.configSha256;
      m.history.push({step,operationId:randomUUID(),resourceId:scope,completedAt:clock(),evidenceSha256});await save();return receipt;
    }
    if(s.action.startsWith('maintenance-')){
      const maintenance=m.maintenance;ensure(role==='source'&&maintenance&&maintenance.sourceRef===selected.ref,'MAINTENANCE_SOURCE_MISMATCH');
      const ending=s.action==='maintenance-unsilence';ensure(ending?['active','closed'].includes(maintenance.phase):['authorized','monitoring_ready'].includes(maintenance.phase),'MAINTENANCE_PHASE_INVALID');
      if(ending)ensure(maintenance.resumeProof&&maintenance.monitoring,'SOURCE_RESUME_PROOF_REQUIRED');
      if(ending)await requireCurrentSourceJobProof(m,manifestPath,repositoryRoot);
      const deferBackupFreshness=ending&&await hasCurrentPremergeOwnerCopy(m,manifestPath,repositoryRoot,clock());
      const keys=config.resources.filter(r=>r.kind==='rule'&&!r.key.includes('backup-freshness')&&!r.key.endsWith('monitor-heartbeat')).map(r=>r.key);ensure(keys.length===8,'MAINTENANCE_RULE_INVENTORY_INVALID');
      const receipts=[];
      for(const key of keys){const existing=maintenance.monitoring?.silences.find(r=>r.ruleKey===key);
        const op=g.maintenanceSilenceOperation({maintenance:{id:maintenance.id,authorizedAt:maintenance.authorizedAt,expiresAt:maintenance.expiresAt,sourceConfigSha256:config.configSha256},ruleKey:key,action:ending?'expire':'create',...(ending?{resourceId:existing?.id}:{})});
        receipts.push(await mutate(`${scope}-${key}`,op,{provider:'grafana',disposition:'disposable',remove:ending,id:p=>`silence:${p.resourceId}`}));}
      const heartbeatKey=config.resources.find(r=>r.key.endsWith('monitor-heartbeat'))?.key;ensure(heartbeatKey,'MONITOR_HEARTBEAT_RULE_REQUIRED');
      const heartbeat=await g.readRuleScore(heartbeatKey),evaluation=await g.readEvaluation(heartbeatKey);ensure(heartbeat.score===0&&evaluation.state==='inactive','MONITOR_HEARTBEAT_NOT_HEALTHY');
      if(ending){ensure(maintenance.monitoring,'MAINTENANCE_MONITORING_REQUIRED');for(const key of config.resources.filter(r=>r.kind==='rule').map(r=>r.key)){if(deferBackupFreshness&&key.includes('backup-freshness'))continue;const score=await g.readRuleScore(key),state=await g.readEvaluation(key);ensure(score.score===0&&state.state==='inactive','SOURCE_MONITOR_RECOVERY_UNPROVEN');}
        const aggregate={receipts,heartbeat,evaluation,resumeProof:maintenance.resumeProof,deferredBackupFreshness:deferBackupFreshness};const endingProof=digest(aggregate);await writeEvidence(endingProof,aggregate);maintenance.monitoring.endedAt=clock();maintenance.monitoring.endEvidenceSha256=endingProof;maintenance.endedAt=clock();maintenance.phase='closed';}
      else{const aggregate={receipts,heartbeat,evaluation},evidenceSha256=digest(aggregate);await writeEvidence(evidenceSha256,aggregate);maintenance.monitoring={beganAt:maintenance.monitoring?.beganAt??receipts.map(p=>p.startsAt).sort()[0],sourceConfigSha256:config.configSha256,silences:receipts.map(p=>({ruleKey:p.ruleKey,id:p.resourceId,evidenceSha256:digest(p)})),evidenceSha256};maintenance.phase='monitoring_ready';}
      await save();return {status:evidenceMode==='provider-readback'?'verified':'deterministic-only',maintenanceId:maintenance.id,phase:maintenance.phase,heartbeat,notificationClaim:'none-maintenance-suppresses-notifications'};
    }
    if(s.action==='sentinel-readiness')return capture(scope,()=>sentinel().readiness());
    if(s.action==='sentinel-read')return capture(scope,()=>sentinel().read());
    if(s.action.startsWith('sentinel-')){const a=sentinel(),action=/** @type {'create-bucket'|'upload'|'remove'|'recover'|'delete-bucket'} */(s.action.slice(9));
      const proof=await mutate(scope,a.operation(action),{provider:'supabase-storage',disposition:role==='source'?'persistent':'disposable',remove:action==='delete-bucket',id:p=>p.resourceId});
      if(action==='delete-bucket'){const absent=await a.read();ensure(absent.status==='absent','SENTINEL_CLEANUP_INCOMPLETE');const child=m.cleanup.resources.find(r=>r.provider==='supabase-storage'&&r.id===a.resourceIds.object&&r.disposition==='disposable');if(child){child.absentAt=clock();await save();}}
      return proof;}
    if(s.action==='canary-send'||s.action==='canary-checkpoint'){
      ensure(s.canary,'CANARY_SETTINGS_REQUIRED');const a=createEmailCanaryAdapter({manifest:m,projectRef:selected.ref,providerToken:s.binding.providerToken,serviceKey:s.binding.source.serviceKey,...s.canary},{fetchImpl:options.fetchImpl,now:clock,ledgerReader:options.ledgerReader});
      if(s.action==='canary-checkpoint'){const delivered=await input();ensure(m.history.some(h=>h.step==='monitoring-proof'&&h.evidenceSha256===digest(delivered)),'CANARY_PROOF_PROVENANCE_MISSING');return mutate(scope,a.checkpointOperation(delivered));}
      const op=a.sendOperation();return mutate(scope,{inspect:op.inspect,mutate:op.mutate,readback:async()=>{
        let messageId=s.knownMessageId;if(!messageId){try{messageId=(await readEvidence(scope+'-submission')).providerMessageId;}catch{throw new OperationsError('CANARY_MESSAGE_ID_REQUIRED_READBACK_ONLY');}}
        return a.readback(messageId??'');}});
    }
    if(s.action==='backup-checkpoint'){
      ensure(s.metricsWrite,'METRICS_WRITE_REQUIRED');const h=await input();ensure(h.descriptorSha256===m.backupVerification?.descriptorSha256&&m.cleanup.resources.some(r=>r.provider==='github'&&r.id===String(h.artifactId)&&r.disposition==='persistent'&&r.absentAt===null),'BACKUP_ARTIFACT_OWNERSHIP_UNPROVEN');
      ensure(s.backupDirectory,'ENCRYPTED_BACKUP_DIRECTORY_REQUIRED');
      const descriptor=await readRecoveryDescriptor({directory:s.backupDirectory,repositoryRoot,expectedDescriptorSha256:h.descriptorSha256});
      await verifyEncryptedRecoverySet({directory:s.backupDirectory,repositoryRoot,expectedDescriptorSha256:h.descriptorSha256});
      ensure(h.checkpointAt===descriptor.metadata.startedAt&&descriptor.metadata.release.commitSha===candidate.sha&&descriptor.metadata.source.projectRef===m.source?.ref,'BACKUP_CHECKPOINT_IDENTITY_MISMATCH');
      const a=createGrafanaHeartbeatAdapter({...s.metricsWrite,queryOrigin:s.grafana.metricsQueryOrigin,queryBasePath:s.grafana.metricsQueryBasePath,metricsInstanceId:s.grafana.metricsInstanceId,readToken:s.grafana.metricsReadToken,
        environmentAlias:s.grafana.environmentAlias,candidateSha:candidate.sha,configSha256:config.configSha256},{fetchImpl:options.fetchImpl,now:clock});
      return mutate(scope,{inspect:async()=>({status:'verified',evidenceSha256:digest(h)}),mutate:()=>a.publishBackupHeartbeat(h),readback:()=>a.verifyBackupHeartbeat(h)});
    }
    if(s.action==='incident-baseline')return capture(scope,()=>captureIncidentBaseline(g,sentinel(),{now:clock()}));
    if(s.action==='incident-verify'){const supplied=await input();ensure([supplied.baseline,supplied.removed,supplied.recovered,supplied.failureSignal,supplied.recoverySignal,...(supplied.phases??[])].every(proof=>m.history.some(h=>['incident-drill','monitoring-proof'].includes(h.step)&&h.evidenceSha256===digest(proof))),'INCIDENT_PROOF_PROVENANCE_MISSING');const receipt=await capture(scope,()=>verifyStorageIncident(g,sentinel(),{...supplied,now:clock()}));if(receipt.status==='verified'){m.state='incident_drill_verified';await save();}return receipt;}
    if(s.action==='source-green')return capture(scope,async()=>{const configuration=await g.verifyConfiguration(),checks=[];for(const r of config.resources.filter(r=>r.kind==='rule')){const score=await g.readRuleScore(r.key),state=await g.readEvaluation(r.key);ensure(score.score===0&&state.state==='inactive','SOURCE_MONITOR_RECOVERY_UNPROVEN');checks.push({score,state});}const heartbeat=await g.readMonitorHeartbeat();return {status:evidenceMode==='provider-readback'?'verified':'deterministic-only',configuration,checks,heartbeat,heartbeatAt:heartbeat.heartbeatAt,checkedAt:clock()};});
    const proofAdapter=s.fixture?createGrafanaRuleFixtureAdapter(s.grafana,s.fixture,{fetchImpl:options.fetchImpl,now:clock}):g;
    if(s.action==='configure-fixture'||s.action==='cleanup-fixture'){
      ensure(s.fixture,'GRAFANA_FIXTURE_REQUIRED');const receipts=[];
      for(const r of proofAdapter.configuration().resources){const id=`rule:${r.key}`;
        if(s.action==='cleanup-fixture')ensure(m.cleanup.resources.some(x=>x.provider==='grafana'&&x.id===id&&x.disposition==='disposable'&&x.runId===m.runId),'MONITORING_CLEANUP_NOT_OWNED');
        receipts.push(await mutate(`${scope}-${r.key}`,s.action==='configure-fixture'?proofAdapter.resourceOperation(r.key):proofAdapter.cleanupOperation(r.key,r.key),{provider:'grafana',disposition:'disposable',remove:s.action==='cleanup-fixture',id:()=>id}));}
      return {status:'verified',configSha256:proofAdapter.configuration().configSha256,resources:receipts};
    }
    if(s.action==='fixture-sample'){ensure(s.fixture&&s.sample,'GRAFANA_FIXTURE_REQUIRED');return mutate(scope,proofAdapter.fixtureSampleOperation(s.sample));}
    if(s.action==='capture-failure'||s.action==='capture-recovery'){ensure(s.ruleKey&&s.windowStart,'MONITORING_PHASE_INPUT_REQUIRED');const ruleKey=s.ruleKey,windowStart=s.windowStart;return capture(scope,()=>captureMonitoringPhase(proofAdapter,{ruleKey,phase:s.action==='capture-failure'?'failure':'recovery',windowStart,now:clock()}));}
    if(s.action==='verify-rule-proof'){const supplied=await input();ensure(Array.isArray(supplied.phases)&&supplied.phases.every(/** @param {unknown} phase */phase=>m.history.some(h=>h.step==='monitoring-proof'&&h.evidenceSha256===digest(phase))),'MONITORING_PHASE_PROVENANCE_MISSING');
      const proof=await capture(scope,()=>verifyMonitoringProof(proofAdapter,{...supplied,now:clock()}));if(proof.status==='verified'){m.state='monitoring_proved';await save();}return proof;}
    throw new OperationsError('MONITORING_ACTION_MISMATCH');
  }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('MONITORING_EXECUTION_FAILED');}
  finally{await lock.close();await unlink(manifestPath+'.lock').catch(()=>{});}
}

/** Trusted daily executor: lease-derived operation ID and original preparation time, one send,
 * bounded readback-only delivery polling, then one separate checkpoint intent. No blind resend.
 * @param {Parameters<typeof executeMonitoringAction>[0] & {executionId:string,preparedAt:string,sleep?:(milliseconds:number)=>Promise<void>}} options */
export async function executeDailyCanary(options){
  ensure(z.uuid().safeParse(options.executionId).success&&z.iso.datetime().safeParse(options.preparedAt).success,'DAILY_CANARY_LEASE_INVALID');
  const parsed=monitoringExecutionSettingsSchema.safeParse(options.settings);ensure(parsed.success&&parsed.data.canary,'DAILY_CANARY_SETTINGS_INVALID');
  const clock=options.clock??(()=>options.now??new Date().toISOString()),s=parsed.data,id=options.executionId.replaceAll('-','');
  ensure((s.grafana.targetRole??'source')==='source','DAILY_CANARY_SOURCE_REQUIRED');
  const m=await readPrivateManifest(options.manifestPath,{repositoryRoot:options.repositoryRoot,candidate:options.candidate,now:clock()});
  ensure(!m.maintenance||m.maintenance.phase==='closed','SOURCE_MAINTENANCE_ACTIVE');
  const sendKey=`source-canary-send-${id}`,checkpointKey=`source-canary-checkpoint-${id}`;
  ensure(!m.pending||(m.pending.step==='monitoring-proof'&&[sendKey,checkpointKey].includes(m.pending.resourceId??'')),'PENDING_OPERATION_REQUIRES_READBACK');
  ensure(s.canary,'DAILY_CANARY_SETTINGS_INVALID');
  const canary={...s.canary,resend:{...s.canary.resend,operationId:options.executionId,windowStart:options.preparedAt,requireLiveQuota:true}};
  const settings={...s,schemaVersion:1,operation:'monitoring-proof',actionId:id,canary};
  const pause=options.sleep??(milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds)));
  let sent=m.history.some(h=>h.step==='monitoring-proof'&&h.resourceId===sendKey);
  for(let attempt=0;!sent&&attempt<31;attempt++){
    ensure(Date.parse(clock())>=Date.parse(options.preparedAt)&&Date.parse(clock())-Date.parse(options.preparedAt)<=900000,'DAILY_CANARY_DELIVERY_TIMEOUT');
    try{await executeMonitoringAction({...options,settings:{...settings,action:'canary-send'},clock});sent=true;}
    catch(error){
      const current=await readPrivateManifest(options.manifestPath,{repositoryRoot:options.repositoryRoot,candidate:options.candidate,now:clock()});
      if(current.pending?.step!=='monitoring-proof'||current.pending.resourceId!==sendKey)throw error;
      // An unknown result ID cannot be resolved by listing unrelated messages or issuing another send.
      let submission;try{submission=JSON.parse((await readPrivateBytes(`${options.manifestPath}.${sendKey}-submission.json`,options.repositoryRoot)).toString());}catch{throw new OperationsError('CANARY_MESSAGE_ID_REQUIRED_READBACK_ONLY');}
      ensure(z.uuid().safeParse(submission.providerMessageId).success,'CANARY_MESSAGE_ID_REQUIRED_READBACK_ONLY');
      if(attempt===30)throw new OperationsError('DAILY_CANARY_DELIVERY_TIMEOUT');await pause(30000);
    }
  }
  ensure(sent,'DAILY_CANARY_DELIVERY_TIMEOUT');
  const proof=await executeMonitoringAction({...options,settings:{...settings,action:'canary-checkpoint',inputPath:`${options.manifestPath}.${sendKey}.json`},clock});
  return {status:options.fetchImpl||options.ledgerReader?'deterministic-only':'verified',kind:'daily-synthetic-canary',executionId:options.executionId,checkpointAt:proof.checkpointAt,evidenceSha256:proof.evidenceSha256};
}
