import { constants } from 'node:fs';
import { open, unlink, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertOwnedSource, assertPrivatePath, ensure, OperationsError, readPrivateManifest, writePrivateManifest } from './manifest.mjs';
import { canonicalJson, createRecoverySet, readRecoveryDescriptor, verifyEncryptedRecoverySet } from './recovery-set.mjs';
import { exportLogicalRecovery, validateManagedBaseline, SUPABASE_CLI_VERSION, POSTGRES_VERSION } from './logical-recovery.mjs';
import { exportFinalizedStorage } from './storage-adapter.mjs';
import { readSyntheticJobsEvidence } from './synthetic-jobs.mjs';
import { readSourceReleaseBinding } from './source-binding.mjs';
/** @param {Buffer|string} bytes */
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Open once, refuse symlinks/hard links, and read only private bounded files outside Git.
 * @param {string} path @param {string} repositoryRoot @param {number} [maximum]
 */
export async function readPrivateBytes(path,repositoryRoot,maximum=1048576){
 await assertPrivatePath(path,repositoryRoot);const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await handle.stat();ensure(stat.isFile()&&(stat.mode&0o777)===0o600&&stat.nlink===1&&stat.size<=maximum,'PRIVATE_FILE_MODE_REQUIRED');return await handle.readFile();}finally{await handle.close();}
}
/** Store a generated sanitized proof before recording its commitment in transaction history.
 * @param {unknown} value @param {string} manifestPath @param {string} repositoryRoot */
async function storeBackupProof(value,manifestPath,repositoryRoot){
 const bytes=Buffer.from(canonicalJson(value));ensure(bytes.length<=1048576,'BACKUP_EVIDENCE_LIMIT');const evidenceSha256=digest(bytes),path=join(dirname(manifestPath),evidenceSha256+'.json');
 await assertPrivatePath(path,repositoryRoot);let handle;
 try{handle=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}
 catch(error){ensure(/** @type {NodeJS.ErrnoException} */(error).code==='EEXIST','BACKUP_EVIDENCE_WRITE_FAILED');ensure((await readPrivateBytes(path,repositoryRoot)).equals(bytes),'BACKUP_EVIDENCE_COLLISION');return evidenceSha256;}
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}return evidenceSha256;
}
const settingsSchema=z.strictObject({schemaVersion:z.literal(1),operation:z.literal('backup-set'),executionId:z.string().uuid().optional(),providerToken:z.string().min(10).max(4096),
 source:z.strictObject({apiUrl:z.string().url(),serviceKey:z.string().min(10).max(4096)}),
 deployment:z.strictObject({accountId:z.string(),workerName:z.string(),versionId:z.string(),origin:z.string().url(),readToken:z.string().min(10).max(4096)}),
 connection:z.strictObject({host:z.string(),port:z.literal(5432),database:z.literal('postgres'),user:z.string(),password:z.string().min(1).max(1024),sslmode:z.literal('verify-full'),sslRootCert:z.string().optional()}),
 toolchain:z.strictObject({mode:z.literal('container')}),managedBaseline:z.strictObject({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/u)}),ownerPublicKeyPath:z.string(),outputDirectory:z.string(),privateDirectory:z.string()});
/** @param {string} path @param {string} root */
export async function readBackupSettings(path,root){try{const parsed=settingsSchema.safeParse(JSON.parse((await readPrivateBytes(path,root)).toString('utf8')));ensure(parsed.success,'PRIVATE_SETTINGS_INVALID');return parsed.data;}catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('PRIVATE_SETTINGS_INVALID');}}
/** @typedef {{manifestPath:string,settingsPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,now?:string,clock?:()=>string,executionId?:string}} BackupOptions */
/** @typedef {{binding?:(options:Parameters<typeof readSourceReleaseBinding>[0])=>Promise<unknown>,exportDatabase?:typeof exportLogicalRecovery,exportStorage?:typeof exportFinalizedStorage}} BackupDependencies */
/** One backup command in the existing transaction; only completed encrypted output can be resumed.
 * Plaintext components exist in bounded memory, not output files. Pending ambiguity never repeats an export.
 * @param {BackupOptions} options @param {BackupDependencies} [dependencies]
 */
export async function executeBackupSet(options,dependencies={}){
 const {manifestPath,settingsPath,repositoryRoot,candidate}=options;const clock=options.clock??(()=>options.now??new Date().toISOString());
 await assertPrivatePath(manifestPath,repositoryRoot);let lock;
 try{lock=await open(`${manifestPath}.lock`,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch{throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}
 /** @type {Map<string,Buffer>} */const plaintext=new Map();
 try{
  const manifest=await readPrivateManifest(manifestPath,{repositoryRoot,candidate,now:clock()});const source=assertOwnedSource(manifest);
  ensure(manifest.allowedActions.includes('backup-set')&&manifest.humanBoundary===null&&manifest.terminal===null,'ACTION_FORBIDDEN');
  const settings=await readBackupSettings(settingsPath,repositoryRoot);
  const executionId=options.executionId??settings.executionId;
  ensure(!options.executionId||!settings.executionId||options.executionId===settings.executionId,'BACKUP_EXECUTION_MISMATCH');
  ensure(executionId===undefined||/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(executionId),'BACKUP_EXECUTION_MISMATCH');
  const attemptKey=executionId?`backup-set:${executionId}`:'backup-set';
  const allowedStates=executionId?['monitoring_proved','cleanup_verified','backup_verified']:['monitoring_proved'];
  if(executionId)ensure(manifest.cleanup.resources.some(r=>r.provider==='supabase'&&r.id===source.ref&&r.disposition==='persistent'&&r.absentAt===null)&&(!manifest.maintenance||manifest.maintenance.phase==='closed'),'SOURCE_MAINTENANCE_ACTIVE');
  ensure(settings.source.apiUrl===source.url && source.postgresVersion===POSTGRES_VERSION,'SOURCE_IDENTITY_MISMATCH');
  await assertPrivatePath(join(settings.privateDirectory,'boundary'),repositoryRoot);const privateStat=await lstat(settings.privateDirectory);ensure(privateStat.isDirectory()&&!privateStat.isSymbolicLink()&&(privateStat.mode&0o777)===0o700,'PRIVATE_DIRECTORY_REQUIRED');
  let outputExists=false;
  try{const stat=await lstat(settings.outputDirectory);ensure(stat.isDirectory()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o700,'PRIVATE_DIRECTORY_REQUIRED');outputExists=true;}catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='ENOENT')throw error;}
  await assertPrivatePath(outputExists?join(settings.outputDirectory,'backup-set.json'):settings.outputDirectory,repositoryRoot);
  const publicBytes=await readPrivateBytes(settings.ownerPublicKeyPath,repositoryRoot,16384);
  ensure(!publicBytes.toString('utf8').includes('PRIVATE KEY'),'OWNER_PUBLIC_KEY_REQUIRED');const publicKey=createPublicKey(publicBytes);
  ensure(publicKey.asymmetricKeyType==='rsa'&&Number(publicKey.asymmetricKeyDetails?.modulusLength)>=3072&&digest(publicKey.export({type:'spki',format:'der'}))===manifest.backup.publicKeyId,'OWNER_PUBLIC_KEY_MISMATCH');
  const baseline=validateManagedBaseline(JSON.parse((await readPrivateBytes(settings.managedBaseline.path,repositoryRoot,8388608)).toString('utf8')));
  ensure(baseline.schemaSha256===settings.managedBaseline.sha256,'MANAGED_BASE_SCHEMA_DRIFT');
  const prior=manifest.history.find(h=>h.step==='backup-set'&&(!executionId||h.operationId===executionId));
  if(prior){const verified=await verifyEncryptedRecoverySet({directory:settings.outputDirectory,repositoryRoot,expectedDescriptorSha256:prior.evidenceSha256});ensure(verified.descriptor.metadata.source.projectRef===source.ref,'BACKUP_IDENTITY_MISMATCH');return{status:'ENCRYPTED_BACKUP_VERIFIED',backupSetId:verified.descriptor.metadata.backupSetId,descriptorSha256:prior.evidenceSha256};}
  if(manifest.pending){
   ensure(manifest.pending.step==='backup-set'&&allowedStates.includes(manifest.state)&&(!executionId||manifest.pending.operationId===executionId),'BACKUP_PUBLICATION_READBACK_REQUIRED');
   let descriptorSha256;
   try{descriptorSha256=digest(await readPrivateBytes(join(settings.outputDirectory,'backup-set.json'),repositoryRoot));}catch{throw new OperationsError('BACKUP_PUBLICATION_READBACK_REQUIRED');}
   const descriptor=await readRecoveryDescriptor({directory:settings.outputDirectory,repositoryRoot,expectedDescriptorSha256:descriptorSha256});
   ensure(descriptor.metadata.backupSetId===manifest.pending.operationId&&descriptor.metadata.source.projectRef===source.ref&&descriptor.metadata.release.commitSha===candidate.sha&&descriptor.metadata.release.treeSha===candidate.tree&&descriptor.metadata.release.workerVersion===candidate.deploymentId&&descriptor.encryption.keyId===manifest.backup.publicKeyId&&descriptor.metadata.startedAt===manifest.pending.startedAt,'BACKUP_IDENTITY_MISMATCH');
   await verifyEncryptedRecoverySet({directory:settings.outputDirectory,repositoryRoot,expectedDescriptorSha256:descriptorSha256});
   manifest.history.push({step:'backup-set',operationId:manifest.pending.operationId,completedAt:clock(),resourceId:null,evidenceSha256:descriptorSha256});manifest.pending=null;manifest.state='backup_started';manifest.backupVerification=null;
   await writePrivateManifest(manifestPath,manifest,{repositoryRoot,candidate,now:clock(),replace:true});
   return{status:'ENCRYPTED_BACKUP_VERIFIED',backupSetId:descriptor.metadata.backupSetId,descriptorSha256};
  }
  ensure(allowedStates.includes(manifest.state)&&!manifest.attempts[attemptKey],'STATE_TRANSITION_FORBIDDEN');
  const jobs=await readSyntheticJobsEvidence({manifest,manifestPath,repositoryRoot,role:'source'});
  ensure(jobs.mode==='quiesced'&&Array.isArray(jobs.state)&&jobs.state.every((/** @type {any} */j)=>j.active===false),'SOURCE_JOBS_QUIESCENCE_REQUIRED');
  // No export before exact current release/project/key readback. This transport is read-only.
  await (dependencies.binding??readSourceReleaseBinding)({manifest,settings,now:clock()});
  const operationId=executionId??randomUUID();const startedAt=clock();manifest.pending={step:'backup-set',operationId,startedAt,resourceId:null,priorStateSha256:null};manifest.attempts[attemptKey]=1;
  await writePrivateManifest(manifestPath,manifest,{repositoryRoot,candidate,now:clock(),replace:true});
  const scope={mode:/** @type {const} */('hosted'),role:/** @type {const} */('source'),runId:manifest.runId,projectRef:source.ref,sourceRef:source.ref,preservedRefs:manifest.preservedRefs,createdResourceEvidenceSha256:/** @type {NonNullable<typeof manifest.sourceProvenance>} */(manifest.sourceProvenance).creationReadbackSha256,apiUrl:source.url};
  const exported=await (dependencies.exportDatabase??exportLogicalRecovery)({scope,connection:settings.connection,toolchain:settings.toolchain,managedBaseline:baseline,onSnapshot:async({photos,checkpoint})=>{
   const storage=await(dependencies.exportStorage??exportFinalizedStorage)({scope,secretKey:settings.source.serviceKey,photos,expectedRowsetSha256:checkpoint.finalizedRowsetSha256,...(manifest.fixture.sentinel?{sentinel:{path:`${manifest.runId}/sentinel.bin`,...manifest.fixture.sentinel}}:{})});
   for(const[name,bytes]of storage.components)plaintext.set(name,bytes);return storage;
  }});
  for(const[name,bytes]of exported.components){ensure(!plaintext.has(name),'COMPONENT_INVENTORY_MISMATCH');plaintext.set(name,bytes);}
  const storage=/** @type {Awaited<ReturnType<typeof exportFinalizedStorage>>|null} */(exported.storage);ensure(storage,'STORAGE_COMPONENTS_REQUIRED');
  const finishedAt=clock();
  const result=await createRecoverySet({destination:settings.outputDirectory,repositoryRoot,publicKey,components:plaintext,storageManifest:storage.storageManifest,checkpointBefore:exported.checkpointBefore,checkpointAfter:exported.checkpointAfter,
   metadata:{backupSetId:operationId,source:{environmentAlias:manifest.fixture.alias,organizationId:source.organizationId,projectRef:source.ref,region:source.region,classification:source.classification},release:{commitSha:candidate.sha,treeSha:candidate.tree,workerVersion:candidate.deploymentId},startedAt,finishedAt,tools:{supabaseCli:SUPABASE_CLI_VERSION,postgres:POSTGRES_VERSION,operator:'issue29-v2'},migration:exported.migration,destinationAlias:manifest.backup.destinationAlias,exclusions:exported.inventory.exclusions,manualReconstruction:['auth-provider-settings','runtime-secrets','edge-functions','dns-worker-routes','external-provider-integrations','safe-cron-schedules','target-signing-identity']}});
  await verifyEncryptedRecoverySet({directory:settings.outputDirectory,repositoryRoot,expectedDescriptorSha256:result.descriptorSha256});
  manifest.history.push({step:'backup-set',operationId,completedAt:clock(),resourceId:null,evidenceSha256:result.descriptorSha256});manifest.pending=null;manifest.state='backup_started';manifest.backupVerification=null;
  await writePrivateManifest(manifestPath,manifest,{repositoryRoot,candidate,now:clock(),replace:true});
  return{status:'ENCRYPTED_BACKUP_VERIFIED',backupSetId:result.backupSetId,descriptorSha256:result.descriptorSha256};
 }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('BACKUP_EXPORT_FAILED_INSPECT_PRIVATE_STATE');}
 finally{for(const bytes of plaintext.values())bytes.fill(0);await lock.close();await unlink(`${manifestPath}.lock`);}
}

/** Owner-custodied decryption proof establishes an independently usable recovery set before source maintenance.
 * @param {{manifestPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,directory:string,privateKeyPath:string,expectedDescriptorSha256:string,now?:string}} options
 */
export async function executeBackupVerification(options){
 const {manifestPath,repositoryRoot,candidate,directory,expectedDescriptorSha256}=options;const now=options.now??new Date().toISOString();
 await assertPrivatePath(manifestPath,repositoryRoot);let lock;let privateKey;
 try{lock=await open(`${manifestPath}.lock`,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch{throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}
 try{
  const manifest=await readPrivateManifest(manifestPath,{repositoryRoot,candidate,now});
  ensure(manifest.source&&manifest.allowedActions.includes('verify-backup')&&manifest.humanBoundary===null&&manifest.terminal===null&&manifest.pending===null&&['backup_started','backup_verified','artifact_verified'].includes(manifest.state),'BACKUP_VERIFICATION_STATE_INVALID');
  const exported=manifest.history.find(h=>h.step==='backup-set'&&h.evidenceSha256===expectedDescriptorSha256);ensure(exported?.evidenceSha256===expectedDescriptorSha256,'BACKUP_EXPORT_PROVENANCE_REQUIRED');
  const descriptor=await readRecoveryDescriptor({directory,repositoryRoot,expectedDescriptorSha256});
  const source=manifest.source;
  ensure(descriptor.metadata.source.projectRef===source.ref&&descriptor.metadata.source.organizationId===source.organizationId&&descriptor.metadata.source.region===source.region&&descriptor.metadata.release.commitSha===candidate.sha&&descriptor.metadata.release.treeSha===candidate.tree&&descriptor.metadata.release.workerVersion===candidate.deploymentId&&descriptor.encryption.keyId===manifest.backup.publicKeyId,'BACKUP_IDENTITY_MISMATCH');
  const age=Date.parse(now)-Date.parse(descriptor.metadata.startedAt);ensure(age>=0&&age<=86400000,'BACKUP_RPO_EXCEEDED');
  privateKey=await readPrivateBytes(options.privateKeyPath,repositoryRoot,16384);
  const {verifyRecoverySet}=await import('./recovery-set.mjs');const verified=await verifyRecoverySet({directory,repositoryRoot,expectedDescriptorSha256,privateKey});
  const result={status:'OWNER_KEY_RECOVERY_VERIFIED',...verified,independentlyVerifiedAt:now,recoveryPointAgeSeconds:age/1000};
  manifest.backupVerification={descriptorSha256:expectedDescriptorSha256,independentlyVerifiedAt:now,sourceReadsComplete:true};manifest.state='backup_verified';
  const evidenceSha256=await storeBackupProof(result,manifestPath,repositoryRoot);
  if(!manifest.history.some(h=>h.step==='verify-backup'&&h.evidenceSha256===evidenceSha256))manifest.history.push({step:'verify-backup',operationId:randomUUID(),completedAt:now,resourceId:expectedDescriptorSha256,evidenceSha256});
  await writePrivateManifest(manifestPath,manifest,{repositoryRoot,candidate,now,replace:true});return result;
 }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('BACKUP_DECRYPTION_VERIFICATION_FAILED');}
 finally{privateKey?.fill(0);await lock.close();await unlink(`${manifestPath}.lock`);}
}

const copySettingsSchema=z.strictObject({schemaVersion:z.literal(1),operation:z.literal('copy-backup'),directory:z.string(),destination:z.string(),descriptorSha256:z.string().regex(/^[a-f0-9]{64}$/u),destinationAlias:z.literal('owner-secondary'),retentionDays:z.literal(35),capabilityId:z.string()});
/** Before first protected merge the new default-branch workflow cannot run. Retain a complete
 * independent owner-encrypted copy for that rehearsal; this is NOT GitHub workflow proof.
 * @param {{manifestPath:string,settingsPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,now?:string,clock?:()=>string}} options */
export async function executeBackupCopy(options){
 const {manifestPath,repositoryRoot,candidate}=options,clock=options.clock??(()=>options.now??new Date().toISOString());
 const parsed=copySettingsSchema.safeParse(JSON.parse((await readPrivateBytes(options.settingsPath,repositoryRoot)).toString()));ensure(parsed.success,'PRIVATE_SETTINGS_INVALID');const settings=parsed.data;
 await assertPrivatePath(manifestPath,repositoryRoot);let lock;try{lock=await open(manifestPath+'.lock',constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch{throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}
 try{
  const m=await readPrivateManifest(manifestPath,{repositoryRoot,candidate,now:clock()});ensure(m.source&&m.backupVerification?.descriptorSha256===settings.descriptorSha256&&m.backupVerification.sourceReadsComplete&&m.allowedActions.includes('artifact-upload')&&settings.capabilityId===m.capabilityIds['artifact-upload']&&!m.terminal&&!m.humanBoundary,'BACKUP_COPY_AUTHORITY_REQUIRED');
  const {canonicalJson,copyEncryptedRecoverySet}=await import('./recovery-set.mjs');const {resolve,dirname}=await import('node:path');
  ensure(resolve(settings.directory)!==resolve(settings.destination),'BACKUP_COPY_DESTINATION_COLLISION');
  const descriptor=await readRecoveryDescriptor({directory:settings.directory,repositoryRoot,expectedDescriptorSha256:settings.descriptorSha256});ensure(descriptor.metadata.source.projectRef===m.source.ref&&descriptor.metadata.release.commitSha===candidate.sha&&descriptor.encryption.keyId===m.backup.publicKeyId,'BACKUP_IDENTITY_MISMATCH');
  const resourceId=`owner-copy:${settings.descriptorSha256}`,destinationSha256=digest(resolve(settings.destination)),step='artifact-upload';
  ensure(!m.pending||(m.pending.step===step&&m.pending.resourceId===resourceId&&m.pending.priorStateSha256===destinationSha256),'PENDING_OPERATION_REQUIRES_READBACK');
  const save=()=>writePrivateManifest(manifestPath,m,{repositoryRoot,candidate,now:clock(),replace:true});
  const owned=m.cleanup.resources.find(r=>r.provider==='owner-copy'&&r.id===resourceId&&r.runId===m.runId);
  if(!owned&&!m.pending){ensure(!m.attempts[resourceId],'ATTEMPT_LIMIT');await assertPrivatePath(settings.destination,repositoryRoot);try{await lstat(settings.destination);throw new OperationsError('BACKUP_COPY_DESTINATION_COLLISION');}catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='ENOENT')throw error;}
   m.pending={step,operationId:randomUUID(),resourceId,startedAt:clock(),priorStateSha256:destinationSha256};m.attempts[resourceId]=1;await save();
   await copyEncryptedRecoverySet({directory:settings.directory,destination:settings.destination,repositoryRoot,expectedDescriptorSha256:settings.descriptorSha256});
  }
  await verifyEncryptedRecoverySet({directory:settings.destination,repositoryRoot,expectedDescriptorSha256:settings.descriptorSha256});
  if(owned){const priorBytes=await readPrivateBytes(join(dirname(manifestPath),owned.evidenceSha256+'.json'),repositoryRoot);ensure(digest(priorBytes)===owned.evidenceSha256,'BACKUP_COPY_EVIDENCE_MISMATCH');const prior=JSON.parse(priorBytes.toString());ensure(prior.destinationSha256===destinationSha256&&prior.descriptorSha256===settings.descriptorSha256,'BACKUP_COPY_DESTINATION_COLLISION');return{status:'OWNER_ENCRYPTED_COPY_VERIFIED',runId:m.runId,descriptorSha256:settings.descriptorSha256,evidenceSha256:owned.evidenceSha256,workflowProof:false};}
  const receipt={schemaVersion:1,provider:'owner-encrypted-retention',runId:m.runId,sourceRef:m.source.ref,destinationAlias:settings.destinationAlias,destinationSha256,descriptorSha256:settings.descriptorSha256,retentionDays:35,expiresAt:descriptor.retention.expiresAt,verifiedAt:clock(),componentInventorySha256:digest(canonicalJson([...descriptor.components,descriptor.manifest])),encryptedOnly:true,workflowProof:false};
  const evidenceSha256=await storeBackupProof(receipt,manifestPath,repositoryRoot);
  if(!owned)m.cleanup.resources.push({provider:'owner-copy',id:resourceId,runId:m.runId,createdAt:clock(),evidenceSha256,disposition:'persistent',absentAt:null});
  m.history.push({step,operationId:m.pending?.operationId??randomUUID(),resourceId,completedAt:clock(),evidenceSha256});m.pending=null;await save();
  return{status:'OWNER_ENCRYPTED_COPY_VERIFIED',runId:m.runId,descriptorSha256:settings.descriptorSha256,evidenceSha256,workflowProof:false};
 }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('BACKUP_COPY_READBACK_REQUIRED');}finally{await lock.close();await unlink(manifestPath+'.lock');}
}
