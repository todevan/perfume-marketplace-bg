import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {assertPrivatePath,ensure,OperationsError,readPrivateManifest} from './manifest.mjs';
import {readPrivateBytes} from './execution.mjs';
import {canonicalJson,readRecoveryDescriptor,withVerifiedRecoverySet} from './recovery-set.mjs';
import {readSourceSettings,readSeededSourceEvidence} from './source-execution.mjs';
import {verifySyntheticSource} from './synthetic-source.mjs';
import {readSourceReleaseBinding} from './source-binding.mjs';
import {readIssue29WorkerBinding} from './worker-adapter.mjs';
import {createSupabaseOperationsAdapter,sourceIdentitySha256} from './supabase-adapter.mjs';
import {readSyntheticJobsEvidence} from './synthetic-jobs.mjs';
import {executeMaintenanceLifecycle} from './operator.mjs';
import {verifyGitHubArtifact,verifyEncryptedArtifactDirectory} from './artifact-store.mjs';
const hash=z.string().regex(/^[a-f0-9]{64}$/u);
const settingsSchema=z.strictObject({schemaVersion:z.literal(1),operation:z.enum(['authorize-maintenance','pause-source','resume-source','verify-source-resumed']),providerToken:z.string().min(10),capabilityId:z.string(),sourceSettingsPath:z.string(),bindingSettingsPath:z.string(),monitorToken:z.string().regex(/^[A-Za-z0-9_-]{43,256}$/u),
 sourceWorker:z.strictObject({settings:z.unknown(),privateDirectory:z.string(),readToken:z.string().min(10)}),
 window:z.strictObject({id:z.string().uuid(),expiresAt:z.iso.datetime()}).optional(),
 backup:z.strictObject({directory:z.string(),descriptorSha256:hash,privateKeyPath:z.string(),artifact:z.union([z.strictObject({provider:z.literal('owner-encrypted-retention'),directory:z.string(),copyEvidenceSha256:hash}),z.strictObject({repository:z.string(),repositoryId:z.number().int().positive(),runId:z.number().int().positive(),runAttempt:z.number().int().positive(),candidateSha:z.string().regex(/^[a-f0-9]{40}$/u),artifactId:z.number().int().positive(),artifactName:z.string(),expectedArchiveSha256:hash,maxBytes:z.number().int().positive(),token:z.string().min(10)})])}).optional()});
/** @param {unknown} value */
const digest=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
/** @typedef {z.infer<typeof settingsSchema>} MaintenanceSettings */
/** Persist the exact sanitized readback preimage, never merely a claimed hash. Evidence lives
 * beside the one private transaction manifest, not in a second state machine.
 * @param {unknown} value @param {string} directory @param {string} repositoryRoot */
async function storeEvidence(value,directory,repositoryRoot){
 const bytes=Buffer.from(canonicalJson(value));ensure(bytes.length<=1048576,'MAINTENANCE_EVIDENCE_LIMIT');
 const sha256=digest(value),path=join(directory,`${sha256}.json`);await assertPrivatePath(path,repositoryRoot);
 const stat=await lstat(directory);ensure(stat.isDirectory()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o700,'PRIVATE_FILE_MODE_REQUIRED');
 let handle;try{handle=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}
 catch(error){ensure(/** @type {NodeJS.ErrnoException} */(error).code==='EEXIST','MAINTENANCE_EVIDENCE_WRITE_FAILED');ensure((await readPrivateBytes(path,repositoryRoot)).equals(bytes),'MAINTENANCE_EVIDENCE_COLLISION');return sha256;}
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}return sha256;
}
/** @param {string} url @param {string} token @param {typeof fetch} request */
async function readJson(url,token,request){
 try{const response=await request(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${token}`}});ensure(response.ok&&response.body,'MAINTENANCE_READBACK_UNAVAILABLE');const reader=response.body.getReader();let size=0;const chunks=[];try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;ensure(size<=1048576,'MAINTENANCE_RESPONSE_LIMIT');chunks.push(Buffer.from(part.value));}}finally{await reader.cancel();}return JSON.parse(Buffer.concat(chunks).toString());}
 catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('MAINTENANCE_READBACK_UNAVAILABLE');}
}
/** Stable fingerprints exclude exported-snapshot IDs, probe clocks and transient Auth sessions.
 * Paused providers are never represented as directly queryable; this runs only while active.
 * @param {{manifest:import('./manifest.mjs').OperationsManifest,settings:MaintenanceSettings,repositoryRoot:string,manifestPath:string,now?:string,fetchImpl?:typeof fetch}} options
 */
export async function inspectMaintenanceSource({manifest,settings,repositoryRoot,manifestPath,now=new Date().toISOString(),fetchImpl=fetch}){
 const source=manifest.source;ensure(source&&manifest.sourceProvenance,'SOURCE_IDENTITY_REQUIRED');
 const jobs=await readSyntheticJobsEvidence({manifest,manifestPath,repositoryRoot,role:'source'});ensure(jobs.mode==='quiesced'&&jobs.state.every((/** @type {any} */j)=>j.active===false),'SOURCE_JOBS_QUIESCENCE_REQUIRED');
 ensure(settings.backup,'MAINTENANCE_BACKUP_VERIFICATION_REQUIRED');const descriptor=await readRecoveryDescriptor({...settings.backup,expectedDescriptorSha256:settings.backup.descriptorSha256,repositoryRoot});
 ensure(descriptor.metadata.source.projectRef===source.ref&&manifest.backupVerification?.descriptorSha256===settings.backup.descriptorSha256,'BACKUP_IDENTITY_MISMATCH');
 const owned=manifest.cleanup.resources.find(r=>r.provider==='supabase'&&r.id===source.ref&&r.runId===manifest.runId&&r.disposition==='persistent'&&r.absentAt===null);ensure(owned&&!manifest.preservedRefs.includes(source.ref),'PERSISTENT_SOURCE_REQUIRED');
 const seed=await readSourceSettings(settings.sourceSettingsPath,repositoryRoot);ensure(seed.source.apiUrl===source.url,'SOURCE_IDENTITY_MISMATCH');
 const seeded=await readSeededSourceEvidence({manifest,privateDirectory:seed.privateDirectory,repositoryRoot});
 const binding=JSON.parse((await readPrivateBytes(settings.bindingSettingsPath,repositoryRoot)).toString());
 const release=await readSourceReleaseBinding({manifest,settings:binding,fetchImpl,now});
 const worker=await readIssue29WorkerBinding({manifest,...settings.sourceWorker,repositoryRoot});
 const auth=await readJson(`https://api.supabase.com/v1/projects/${source.ref}/config/auth`,settings.providerToken,fetchImpl);
 ensure(auth.disable_signup===true&&!auth.smtp_host&&!auth.smtp_user&&!auth.smtp_pass,'SOURCE_OUTBOUND_CONFIGURATION_UNPROVEN');
 const hookNames=['custom_access_token','mfa_verification_attempt','password_verification_attempt','send_sms','send_email','before_user_created','after_user_created'];
 ensure(hookNames.every(name=>auth[`hook_${name}_enabled`]===false)&&Object.entries(auth).filter(([name])=>/^hook_.*_enabled$/u.test(name)).every(([,value])=>value===false),'SOURCE_OUTBOUND_CONFIGURATION_UNPROVEN');
 const functions=await readJson(`https://api.supabase.com/v1/projects/${source.ref}/functions`,settings.providerToken,fetchImpl);ensure(Array.isArray(functions)&&functions.length===0,'SOURCE_OUTBOUND_CONFIGURATION_UNPROVEN');
 const config={signupDisabled:true,customSmtp:false,enabledAuthHooks:[],edgeFunctions:[],workerConfigSha256:worker.configSha256};
 const provenance=await verifySyntheticSource({scope:{mode:'hosted',role:'source',runId:manifest.runId,projectRef:source.ref,sourceRef:source.ref,preservedRefs:manifest.preservedRefs,createdResourceEvidenceSha256:owned.evidenceSha256,apiUrl:source.url},connection:seed.connection,toolchain:seed.toolchain,managedBaseline:seeded.managedBaseline,secretKey:seed.source.serviceKey,...(manifest.fixture.sentinel?{sentinel:{path:`${manifest.runId}/sentinel.bin`,...manifest.fixture.sentinel}}:{}),fetchImpl});
 const readiness=await readJson(`${binding.deployment.origin}/api/operations/readiness`,settings.monitorToken,fetchImpl);
 ensure(readiness.schemaVersion===1&&Array.isArray(readiness.signals)&&readiness.signals.length===9&&new Set(readiness.signals.map((/** @type {any} */r)=>r.signal)).size===9&&readiness.signals.every((/** @type {any} */r)=>typeof r.ok==='boolean'&&r.deploymentIdentity===manifest.candidate.sha&&Date.parse(r.checkedAt)<=Date.parse(now)+300000&&Date.parse(now)-Date.parse(r.checkedAt)<=300000),'SOURCE_READINESS_UNPROVEN');
 // Quiesced jobs can be intentionally unavailable here. Final maintenance closure independently
 // requires genuine post-resume all-green monitor evaluations after restoring those exact jobs.
 const store=(/** @type {unknown} */value)=>storeEvidence(value,dirname(manifestPath),repositoryRoot);
 const identity={organizationId:source.organizationId,ref:source.ref,region:source.region,url:source.url,postgresVersion:source.postgresVersion};
 const identitySha256=await store(identity);ensure(identitySha256===sourceIdentitySha256(source),'SOURCE_IDENTITY_MISMATCH');
 const proof={checkedAt:now,identitySha256,configSha256:await store(config),provenanceSha256:await store(provenance),workerSha256:await store({candidate:release.candidate,workerName:release.workerName,sourceRef:release.sourceRef}),checkpointSha256:await store(descriptor.checkpoint),readinessSha256:await store(readiness)};
 return{...proof,evidenceSha256:await store(proof)};
}
/** @param {{manifestPath:string,settingsPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,operation:string,now?:string,clock?:()=>string}} options
 * @param {{providerFactory?:typeof createSupabaseOperationsAdapter,inspectSource?:typeof inspectMaintenanceSource,verifyArtifact?:typeof verifyGitHubArtifact}} [dependencies] */
export async function executeMaintenanceCommand(options,dependencies={}){
 const {repositoryRoot,manifestPath,candidate}=options;const clock=options.clock??(()=>options.now??new Date().toISOString());
 let parsed;try{parsed=settingsSchema.safeParse(JSON.parse((await readPrivateBytes(options.settingsPath,repositoryRoot)).toString()));}catch{throw new OperationsError('PRIVATE_SETTINGS_INVALID');}ensure(parsed.success,'PRIVATE_SETTINGS_INVALID');const settings=parsed.data;
 ensure(settings.operation===options.operation,'SETTINGS_OPERATION_MISMATCH');const manifest=await readPrivateManifest(manifestPath,{repositoryRoot,candidate,now:clock()});ensure(settings.capabilityId===manifest.capabilityIds['restore-write'],'CREDENTIAL_ROLE_MISMATCH');
 const provider=(dependencies.providerFactory??createSupabaseOperationsAdapter)({token:settings.providerToken,clock});
 const inspectSource=dependencies.inspectSource??inspectMaintenanceSource;
 const store=(/** @type {unknown} */value)=>storeEvidence(value,dirname(manifestPath),repositoryRoot);
 /** @param {import('./operator.mjs').SourceStatusReadback} proof */
 async function persistStatus(proof){ensure(proof.evidence&&digest(proof.evidence)===proof.evidenceSha256,'MAINTENANCE_READBACK_HASH_MISMATCH');await store(proof.evidence);return proof;}
 const result=await executeMaintenanceLifecycle({manifestPath,repositoryRoot,candidate,step:settings.operation,clock,adapter:{...provider,
  readPaused:async context=>persistStatus(await provider.readPaused(context)),
  readResumed:async context=>persistStatus(await provider.readResumed(context)),
  inspectActiveSource:({manifest:current})=>inspectSource({manifest:current,settings,repositoryRoot,manifestPath,now:clock()}),
  prepareMaintenance:async({manifest:current})=>{
   ensure(settings.window&&settings.backup&&current.source&&current.backupVerification?.descriptorSha256===settings.backup.descriptorSha256,'MAINTENANCE_BACKUP_VERIFICATION_REQUIRED');
   if(current.maintenance){ensure(current.maintenance.phase==='closed','MAINTENANCE_WINDOW_ACTIVE');await store(current.maintenance);}
   const backup=settings.backup;
   /** @type {Buffer|undefined} */
   let key;
   try{
    key=await readPrivateBytes(backup.privateKeyPath,repositoryRoot,16384);
    return await withVerifiedRecoverySet({directory:backup.directory,repositoryRoot,privateKey:key,expectedDescriptorSha256:backup.descriptorSha256},async({descriptor,components})=>{
     ensure(descriptor.metadata.source.projectRef===current.source?.ref&&descriptor.metadata.release.commitSha===candidate.sha&&descriptor.metadata.release.treeSha===candidate.tree&&descriptor.metadata.release.workerVersion===candidate.deploymentId&&descriptor.encryption.keyId===current.backup.publicKeyId,'BACKUP_IDENTITY_MISMATCH');
     const age=Date.parse(clock())-Date.parse(descriptor.metadata.startedAt);ensure(age>=0&&age<=86400000,'BACKUP_RPO_EXCEEDED');
     let artifact;
     if('provider' in backup.artifact){
      // This explicit first-rehearsal path cannot satisfy the final GitHub automation gate.
      ensure(!current.releaseUpdate,'TRUSTED_WORKFLOW_ARTIFACT_REQUIRED');
      const copied=backup.artifact,owned=current.cleanup.resources.find(r=>r.provider==='owner-copy'&&r.id===`owner-copy:${backup.descriptorSha256}`&&r.disposition==='persistent'&&r.absentAt===null&&r.evidenceSha256===copied.copyEvidenceSha256);
      ensure(owned,'BACKUP_COPY_PROVENANCE_REQUIRED');
      const bytes=await readPrivateBytes(join(dirname(manifestPath),copied.copyEvidenceSha256+'.json'),repositoryRoot);ensure(createHash('sha256').update(bytes).digest('hex')===copied.copyEvidenceSha256,'BACKUP_COPY_EVIDENCE_MISMATCH');
      const copy=JSON.parse(bytes.toString());ensure(copy.provider==='owner-encrypted-retention'&&copy.runId===current.runId&&copy.sourceRef===current.source?.ref&&copy.destinationAlias==='owner-secondary'&&copy.destinationSha256===createHash('sha256').update(resolve(copied.directory)).digest('hex')&&copy.descriptorSha256===backup.descriptorSha256&&copy.retentionDays===35&&copy.expiresAt===descriptor.retention.expiresAt&&Date.parse(copy.expiresAt)>Date.parse(clock())&&copy.encryptedOnly===true&&copy.workflowProof===false,'BACKUP_COPY_EVIDENCE_MISMATCH');
      ensure(resolve(copied.directory)!==resolve(backup.directory),'BACKUP_COPY_DESTINATION_COLLISION');
      for(const directory of [copied.directory,backup.directory]){const path=relative(resolve(directory),resolve(backup.privateKeyPath));ensure(path.startsWith('..')||isAbsolute(path),'PRIVATE_KEY_COLOCATED_WITH_ARTIFACT');}
      await withVerifiedRecoverySet({directory:copied.directory,repositoryRoot,privateKey:/** @type {Buffer} */(key),expectedDescriptorSha256:backup.descriptorSha256},async()=>undefined);
      artifact={...copy,verifiedAt:clock(),recovery:{descriptorSha256:backup.descriptorSha256},retentionProof:'owner-authorized-35-day-private-retention',workflowProof:false};
     }else{
      ensure(backup.artifact.candidateSha===candidate.sha,'ARTIFACT_IDENTITY_MISMATCH');
      artifact=await (dependencies.verifyArtifact??verifyGitHubArtifact)({...backup.artifact,expectedDescriptorSha256:backup.descriptorSha256,now:clock()});
      ensure(artifact.recovery?.descriptorSha256===backup.descriptorSha256,'ARTIFACT_INTEGRITY_MISMATCH');
      await verifyEncryptedArtifactDirectory({directory:backup.directory,repositoryRoot,expectedDescriptorSha256:backup.descriptorSha256,maxBytes:backup.artifact.maxBytes});
     }
     const currentProof=await inspectSource({manifest:current,settings,repositoryRoot,manifestPath,now:clock()});
     const platform=JSON.parse(/** @type {Buffer} */(components.get('platform-inventory.json')).toString());
     // Compare the backed-up stable DB/Auth/Storage inventory to the now-quiesced source,
     // not two different pg_export_snapshot identifiers.
     const source=current.source;ensure(source&&current.sourceProvenance,'SOURCE_IDENTITY_REQUIRED');
     const checkpoint={runId:current.runId,projectRef:source.ref,createdResourceEvidenceSha256:current.sourceProvenance.creationReadbackSha256,classification:'synthetic-owner-controlled',authUsers:platform.auth.users,authIdentities:platform.auth.identities,authInventorySha256:platform.auth.sha256,applicationInventorySha256:digest(platform.tables),applicationTableCount:platform.tables.length,migration:descriptor.metadata.migration,managedBaselineSha256:platform.managedBaselineSha256,finalizedRowsetSha256:descriptor.checkpoint.finalizedRowsetSha256,storageObjectCount:descriptor.storage.objectCount,storagePathTreeSha256:descriptor.storage.pathTreeSha256,storageBytes:descriptor.storage.totalBytes};
     ensure(digest(checkpoint)===currentProof.provenanceSha256&&digest(descriptor.checkpoint)===currentProof.checkpointSha256,'SOURCE_CHECKPOINT_MISMATCH');
     const artifactSha256=await store(artifact);
     return{schemaVersion:1,id:/** @type {NonNullable<MaintenanceSettings['window']>} */(settings.window).id,sourceRef:source.ref,authorizedAt:clock(),expiresAt:/** @type {NonNullable<MaintenanceSettings['window']>} */(settings.window).expiresAt,backup:{descriptorSha256:backup.descriptorSha256,artifactSha256,checkpointSha256:currentProof.checkpointSha256,verifiedAt:clock(),retentionVerifiedAt:artifact.verifiedAt},preservation:{identitySha256:currentProof.identitySha256,configSha256:currentProof.configSha256,provenanceSha256:currentProof.provenanceSha256,workerSha256:currentProof.workerSha256},monitoring:null,phase:'authorized',pausedAt:null,pauseReadbackSha256:null,resumedAt:null,resumeReadbackSha256:null,resumeProof:null,endedAt:null};
    });
   }finally{key?.fill(0);}
  }} });
 return{status:'MAINTENANCE_READBACK_VERIFIED',state:result.state,phase:result.maintenance?.phase,runId:result.runId,evidenceSha256:result.history.at(-1)?.evidenceSha256};
}
