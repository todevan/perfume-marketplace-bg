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
import {createMonitorAdapter,monitorConfigSchema} from './monitor-adapter.mjs';
import {readProtectedMergeEvidence} from './worker-adapter.mjs';
import {configureMonitor} from './monitor-operator.mjs';
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
const maintenanceTarget=z.object({origin:z.url(),readinessUrl:z.url(),readinessToken:secret,runtimeEnvironment:z.enum(['development','staging']),release:z.string().regex(/^[a-f0-9]{40}$/u)}).strict();
const resendWebhook=z.object({id:z.uuid(),apiKey:secret,signingSecret:z.string().regex(/^whsec_[A-Za-z0-9+/]{20,128}={0,2}$/u)}).strict();
export const monitoringExecutionSettingsSchema=z.object({schemaVersion:z.literal(1),operation:z.enum(['configure-monitoring','monitoring-proof','incident-drill','maintenance-silence','maintenance-unsilence']),
 action:z.enum(['configure','release-update','attach-target','remove-target','capture-failure','capture-recovery','verify-rule-proof','maintenance-silence','maintenance-unsilence','canary-send','canary-checkpoint','sentinel-readiness','sentinel-read','sentinel-create-bucket','sentinel-upload','sentinel-remove','sentinel-recover','sentinel-delete-bucket','incident-baseline','incident-verify','backup-checkpoint','source-green']),
 actionId:z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/u),monitor:monitorConfigSchema,binding,readinessToken:secret.optional(),maintenanceTarget:maintenanceTarget.optional(),resendWebhook:resendWebhook.optional(),
 sentinel:z.object({sha256:hash,bytesBase64:z.string().max(8192)}).strict().optional(),canary:z.object({database,resend}).strict().optional(),
 backupDirectory:z.string().optional(),inputPath:z.string().optional(),knownMessageId:z.uuid().optional(),previousCandidateSha:z.string().regex(/^[a-f0-9]{40}$/u).optional(),mergeEvidenceDirectory:z.string().optional(),
 ruleKey:z.string().regex(/^[a-z_]{1,32}$/u).optional(),windowStart:z.iso.datetime().optional()}).strict().superRefine((value,context)=>{if(value.action==='configure'&&!value.resendWebhook)context.addIssue({code:'custom',message:'resendWebhook required for configure'});});
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
 /** @param {Record<string, any>} value */
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
 const resumedAt=maintenance.resumedAt;
 const resumeIndex=manifest.history.map((entry,index)=>({entry,index})).filter(({entry})=>entry.step==='resume-source'&&entry.resourceId===`${source.ref}:${maintenance.id}`).at(-1)?.index;
 let jobs;try{jobs=await readSyntheticJobsEvidence({manifest,manifestPath,repositoryRoot,role:'source'});}catch{throw new OperationsError('SOURCE_JOBS_RESUME_PROOF_REQUIRED');}
 const jobIndex=manifest.history.findLastIndex(entry=>entry.step==='synthetic-jobs'&&entry.resourceId==='source-jobs');
 ensure(resumeIndex!==undefined&&jobIndex>resumeIndex&&jobs.mode==='proved'&&Date.parse(jobs.checkedAt)>=Date.parse(maintenance.resumedAt),'SOURCE_JOBS_RESUME_PROOF_REQUIRED');
 ensure(Array.isArray(jobs.state)&&jobs.state.length===CANONICAL_SYNTHETIC_JOBS.length&&jobs.state.every(/** @param {Record<string, any>} job */ job=>{
  const expected=CANONICAL_SYNTHETIC_JOBS.find(candidate=>candidate.jobname===job.jobname);
  return expected&&job.active===true&&job.schedule===expected.schedule&&job.command===expected.command&&job.nodename==='localhost'&&job.nodeport===5432&&job.database==='postgres'&&job.username==='postgres';
 }), 'SOURCE_JOBS_RESUME_PROOF_REQUIRED');
 ensure(Array.isArray(jobs.proof)&&jobs.proof.length===CANONICAL_SYNTHETIC_JOBS.length&&jobs.proof.every(/** @param {Record<string, any>} proof */ proof=>CANONICAL_SYNTHETIC_JOBS.some(job=>job.jobname===proof.jobname)&&proof.status==='succeeded'&&['1 row','SELECT 1'].includes(proof.returnMessage)&&Date.parse(proof.startTime)>=Date.parse(resumedAt)&&Date.parse(proof.endTime)>=Date.parse(proof.startTime)),'SOURCE_JOBS_RESUME_PROOF_REQUIRED');
}
/** One existing private manifest, one exact once-only mutation per pending intent. Evidence JSON
 * beside the manifest is output, not a competing state machine; history binds every accepted hash.
 * @param {{manifestPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,settings:unknown,fetchImpl?:typeof fetch,ledgerReader?:typeof import('./incident-adapter.mjs').readCanaryLedger,clock?:()=>string,now?:string}} options */
export async function executeMonitoringAction(options){
  const parsed=monitoringExecutionSettingsSchema.safeParse(options.settings);ensure(parsed.success,'MONITORING_SETTINGS_INVALID');const s=parsed.data;
  const {manifestPath,repositoryRoot,candidate}=options,clock=options.clock??(()=>options.now??new Date().toISOString());
  const g=createMonitorAdapter(s.monitor,{fetchImpl:options.fetchImpl,now:clock});
  if(s.action==='configure'){ensure(s.operation==='configure-monitoring'&&s.resendWebhook,'MONITORING_ACTION_MISMATCH');return configureMonitor({...options,adapter:g,bindingSettings:s.binding,resendWebhook:s.resendWebhook,clock});}
  const step=s.action.startsWith('maintenance-')?s.action:s.operation;
  ensure((['release-update','attach-target','remove-target'].includes(s.action)&&s.operation==='configure-monitoring')||(s.action.startsWith('maintenance-')&&s.operation===s.action)||
    (['canary-send','canary-checkpoint','backup-checkpoint','source-green','capture-failure','capture-recovery','verify-rule-proof'].includes(s.action)&&s.operation==='monitoring-proof')||
    ((s.action.startsWith('sentinel-')||s.action.startsWith('incident-'))&&s.operation==='incident-drill'),'MONITORING_ACTION_MISMATCH');
  await assertPrivatePath(manifestPath,repositoryRoot);let lock;
  try{lock=await open(manifestPath+'.lock',constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch{throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}
  try{
    const m=await readPrivateManifest(manifestPath,{repositoryRoot,candidate,now:clock()}),role=s.monitor.targetRole??'source';
    ensure(m.allowedActions.includes(step)&&!m.terminal&&!m.humanBoundary,'ACTION_FORBIDDEN');
    const selected=role==='source'?m.source:m.target;ensure(selected&&!m.preservedRefs.includes(selected.ref),'MONITORING_TARGET_UNPROVEN');
    if(role==='target')ensure(g.configuration().targetCycleId===(m.maintenance?.id??m.runId),'MONITORING_TARGET_CYCLE_MISMATCH');
    const release=s.action==='release-update';
    if(release)ensure(role==='source'&&m.releaseUpdate&&s.previousCandidateSha===m.releaseUpdate.fromCandidate.sha,'MONITORING_RELEASE_PRIOR_MISMATCH');
    const config=await g.verifyConfiguration(),configured=m.monitoring.configSha256;
    ensure(config.environmentAlias===m.fixture.alias&&config.runId===m.runId&&config.candidateSha===candidate.sha&&config.workerAlias===m.monitoring.workerAlias&&(release||config.configSha256===configured)&&
      (role==='target'?s.monitor.targetProbeOrigin:s.monitor.targetOrigin)===s.binding.deployment.origin&&s.monitor.runtimeEnvironment==='development'&&s.binding.source.apiUrl===selected.url,'MONITORING_MANIFEST_IDENTITY_MISMATCH');
    const selectedOwned=m.cleanup.resources.find(r=>r.provider==='supabase'&&r.id===selected.ref&&r.runId===m.runId&&r.absentAt===null);
    ensure(selectedOwned?.disposition===(role==='source'?'persistent':'disposable'),'MONITORING_TARGET_OWNERSHIP_MISMATCH');
    const monitorTokens=[s.monitor.evidenceReadToken,s.monitor.watchdogToken,s.monitor.backupCheckpointToken,s.monitor.maintenanceToken,s.monitor.releaseAdoptionToken];
    ensure(![s.binding.providerToken,s.binding.source.serviceKey,s.binding.deployment.readToken].some(t=>monitorTokens.includes(t)),'MONITOR_CROSS_PROVIDER_CREDENTIAL_FORBIDDEN');
    const save=()=>writePrivateManifest(manifestPath,m,{repositoryRoot,candidate,now:clock(),replace:true});
    const scope=role==='target'?`target-${digest({cycleId:m.maintenance?.id??m.runId,action:s.action,actionId:s.actionId}).slice(0,32)}`:`${role}-${s.action}-${s.actionId}`;
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
    const sentinel=()=>{ensure(s.sentinel&&s.readinessToken,'SENTINEL_SETTINGS_REQUIRED');return createSentinelAdapter({manifest:m,projectRef:selected.ref,providerToken:s.binding.providerToken,serviceKey:s.binding.source.serviceKey,
      sentinel:{path:`${m.runId}/sentinel.bin`,sha256:s.sentinel.sha256,bytes:Buffer.from(s.sentinel.bytesBase64,'base64')},readinessOrigin:s.binding.deployment.origin,monitorToken:s.readinessToken},{fetchImpl:options.fetchImpl,now:clock});};
    const input=async()=>{ensure(s.inputPath,'PRIVATE_EVIDENCE_INPUT_REQUIRED');return JSON.parse((await readPrivateBytes(s.inputPath,repositoryRoot)).toString());};
    if(release){
      ensure(m.releaseUpdate&&s.previousCandidateSha,'MONITORING_RELEASE_PRIOR_MISMATCH');
      const merge=await readProtectedMergeEvidence(m,s.mergeEvidenceDirectory??dirname(manifestPath),repositoryRoot,{allowFixture:Boolean(options.fetchImpl)});
      ensure(m.candidate.deploymentId!==m.releaseUpdate.fromCandidate.deploymentId&&m.history.some(h=>h.step==='update-worker'&&h.resourceId===s.binding.deployment.workerName&&Date.parse(h.completedAt)>=Date.parse(merge.verifiedAt)),'MONITORING_RELEASE_WORKER_UNPROVEN');
      const update=m.history.findLast(h=>h.step==='deploy-monitor'&&h.resourceId===`worker:${m.monitoring.workerAlias}`&&Date.parse(h.completedAt)>=Date.parse(merge.verifiedAt));
      ensure(update,'MONITORING_RELEASE_DEPLOYMENT_REQUIRED');const deployment=await readEvidence(update.evidenceSha256);
      ensure(deployment.candidateSha===candidate.sha&&deployment.previousCandidateSha===s.previousCandidateSha&&deployment.previousConfigSha256===configured,'MONITORING_RELEASE_PRIOR_MISMATCH');
      await mutate(`${scope}-adoption`,g.releaseAdoptionOperation({environment:s.monitor.environmentAlias,previousRelease:s.previousCandidateSha,release:candidate.sha,previousConfigSha256:configured,protectedMergeEvidenceSha256:m.releaseUpdate.evidenceSha256}));
      const receipt={schemaVersion:1,kind:'issue29-monitor-release-update',evidenceMode,runId:m.runId,previousCandidateSha:s.previousCandidateSha,candidateSha:candidate.sha,previousConfigSha256:configured,configSha256:config.configSha256,environmentAlias:config.environmentAlias,origin:config.targetOrigin,verifiedAt:clock(),protectedMergeEvidenceSha256:m.releaseUpdate.evidenceSha256,resource:{provider:'cloudflare-monitor',resourceId:`worker:${m.monitoring.workerAlias}`,previousCandidateSha:s.previousCandidateSha,candidateSha:candidate.sha,priorStateSha256:update.evidenceSha256},configuration:config};
      const proof=await capture(scope,async()=>receipt);m.monitoring.configSha256=config.configSha256;await save();return proof;
    }
    if(s.action==='maintenance-silence'){
      const maintenance=m.maintenance;ensure(role==='source'&&maintenance&&maintenance.sourceRef===selected.ref&&['authorized','monitoring_ready'].includes(maintenance.phase),'MAINTENANCE_SOURCE_MISMATCH');
      const proof=await mutate(scope,g.maintenanceOperation({action:'start',startsAt:maintenance.authorizedAt,endsAt:maintenance.expiresAt,incidentId:maintenance.id}));
      const heartbeat=await g.readMonitorHeartbeat();ensure(Date.parse(clock())-Date.parse(heartbeat.heartbeatAt)<=20*60*1000,'MONITOR_HEARTBEAT_NOT_HEALTHY');
      const evidenceSha256=digest({proof,heartbeat});await writeEvidence(evidenceSha256,{proof,heartbeat});
      maintenance.monitoring={beganAt:maintenance.monitoring?.beganAt??clock(),sourceConfigSha256:config.configSha256,silences:['health','auth','database','storage','email','deals','safety'].map(ruleKey=>({ruleKey,id:maintenance.id,evidenceSha256})),evidenceSha256};maintenance.phase='monitoring_ready';await save();return{status:'verified',maintenanceId:maintenance.id,phase:maintenance.phase,heartbeat};
    }
    if(s.action==='attach-target'||s.action==='remove-target'){
      const maintenance=m.maintenance;ensure(role==='target'&&maintenance&&['paused','active'].includes(maintenance.phase)&&m.target&&s.monitor.targetCycleId===maintenance.id,'MAINTENANCE_TARGET_REQUIRED');
      if(s.action==='attach-target'){
        ensure(['storage_restored','integrity_verified'].includes(m.state)&&s.maintenanceTarget&&s.maintenanceTarget.origin===s.binding.deployment.origin&&s.maintenanceTarget.readinessUrl===`${s.binding.deployment.origin}/api/operations/readiness`&&s.maintenanceTarget.release===candidate.sha&&s.maintenanceTarget.runtimeEnvironment==='development','MAINTENANCE_TARGET_MISMATCH');
        return mutate(scope,g.maintenanceOperation({action:'attach-target',incidentId:maintenance.id,target:s.maintenanceTarget}));
      }
      ensure(m.state==='incident_drill_verified','INCIDENT_PROOF_REQUIRED');return mutate(scope,g.maintenanceOperation({action:'remove-target',incidentId:maintenance.id}));
    }
    if(s.action==='maintenance-unsilence'){
      const maintenance=m.maintenance;ensure(role==='source'&&maintenance?.monitoring&&maintenance.resumeProof&&['active','closed'].includes(maintenance.phase),'SOURCE_RESUME_PROOF_REQUIRED');
      await requireCurrentSourceJobProof(m,manifestPath,repositoryRoot);
      const proof=await mutate(scope,g.maintenanceOperation({action:'end',incidentId:maintenance.id}));
      const state=await g.readSourceGreenState(),heartbeat=await g.readMonitorHeartbeat();ensure(state.signals.every(c=>c.ok===true)&&Date.parse(clock())-Date.parse(heartbeat.heartbeatAt)<=20*60*1000,'SOURCE_MONITOR_RECOVERY_UNPROVEN');
      const evidenceSha256=digest({proof,heartbeat,resumeProof:maintenance.resumeProof});await writeEvidence(evidenceSha256,{proof,heartbeat,resumeProof:maintenance.resumeProof});maintenance.monitoring.endedAt=clock();maintenance.monitoring.endEvidenceSha256=evidenceSha256;maintenance.endedAt=clock();maintenance.phase='closed';await save();return{status:'verified',maintenanceId:maintenance.id,phase:maintenance.phase,heartbeat};
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
      const h=await input();const artifact=m.cleanup.resources.find(r=>r.provider==='github'&&r.id===String(h.artifactId)&&r.disposition==='persistent'&&r.absentAt===null);
      const ownerCopy=m.cleanup.resources.find(r=>r.provider==='owner-copy'&&r.id===`owner-copy:${h.descriptorSha256}`&&r.disposition==='persistent'&&r.absentAt===null);
      const retained=artifact??ownerCopy;
      ensure(h.descriptorSha256===m.backupVerification?.descriptorSha256&&retained&&h.artifactSha256===retained.evidenceSha256,'BACKUP_ARTIFACT_OWNERSHIP_UNPROVEN');
      if(!artifact)ensure(await hasCurrentPremergeOwnerCopy(m,manifestPath,repositoryRoot,clock()),'PREMERGE_OWNER_COPY_PROOF_INVALID');
      const artifactProof=await readEvidence(h.artifactSha256);ensure(digest(artifactProof)===h.artifactSha256,'BACKUP_ARTIFACT_OWNERSHIP_UNPROVEN');
      ensure(s.backupDirectory,'ENCRYPTED_BACKUP_DIRECTORY_REQUIRED');const descriptor=await readRecoveryDescriptor({directory:s.backupDirectory,repositoryRoot,expectedDescriptorSha256:h.descriptorSha256});
      await verifyEncryptedRecoverySet({directory:s.backupDirectory,repositoryRoot,expectedDescriptorSha256:h.descriptorSha256});
      ensure(h.checkpointAt===descriptor.metadata.startedAt&&descriptor.metadata.release.commitSha===candidate.sha&&descriptor.metadata.source.projectRef===m.source?.ref,'BACKUP_CHECKPOINT_IDENTITY_MISMATCH');
      return mutate(scope,g.backupCheckpointOperation({checkpointAt:h.checkpointAt,descriptorSha256:h.descriptorSha256,artifactSha256:h.artifactSha256}));
    }
    if(s.action==='incident-baseline')return capture(scope,()=>captureIncidentBaseline(g,sentinel(),{now:clock()}));
    if(s.action==='incident-verify'){const supplied=await input();ensure([supplied.baseline,supplied.removed,supplied.recovered,supplied.failureSignal,supplied.recoverySignal,...(supplied.phases??[])].every(proof=>m.history.some(h=>['incident-drill','monitoring-proof'].includes(h.step)&&h.evidenceSha256===digest(proof))),'INCIDENT_PROOF_PROVENANCE_MISSING');if(supplied.baseline?.deferredBackupFreshness===true)ensure(await hasCurrentPremergeOwnerCopy(m,manifestPath,repositoryRoot,clock()),'PREMERGE_OWNER_COPY_PROOF_INVALID');const receipt=await capture(scope,()=>verifyStorageIncident(g,sentinel(),{...supplied,now:clock()}));if(receipt.status==='verified'){m.state='incident_drill_verified';await save();}return receipt;}
    if(s.action==='source-green')return capture(scope,async()=>{const configuration=await g.verifyConfiguration(),state=await g.readSourceGreenState();ensure(state.signals.every(c=>c.ok),'SOURCE_MONITOR_RECOVERY_UNPROVEN');const heartbeat=await g.readMonitorHeartbeat();return{status:evidenceMode==='provider-readback'?'verified':'deterministic-only',evidenceMode,configuration,checks:state.signals,heartbeat,heartbeatAt:heartbeat.heartbeatAt,checkedAt:clock()};});
    if(s.action==='capture-failure'||s.action==='capture-recovery'){ensure(s.ruleKey&&s.windowStart,'MONITORING_PHASE_INPUT_REQUIRED');const ruleKey=s.ruleKey,windowStart=s.windowStart;return capture(scope,()=>captureMonitoringPhase(g,{ruleKey,phase:s.action==='capture-failure'?'failure':'recovery',windowStart,now:clock()}));}
    if(s.action==='verify-rule-proof'){const supplied=await input();ensure(Array.isArray(supplied.phases)&&supplied.phases.every(/** @param {unknown} phase */phase=>m.history.some(h=>h.step==='monitoring-proof'&&h.evidenceSha256===digest(phase))),'MONITORING_PHASE_PROVENANCE_MISSING');
      const proof=await capture(scope,()=>verifyMonitoringProof(g,{...supplied,now:clock()}));if(proof.status==='verified'){m.state='monitoring_proved';await save();}return proof;}
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
  ensure((s.monitor.targetRole??'source')==='source','DAILY_CANARY_SOURCE_REQUIRED');
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
