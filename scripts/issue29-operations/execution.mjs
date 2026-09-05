import { constants } from 'node:fs';
import { open, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertOwnedSource, assertPrivatePath, ensure, OperationsError, readPrivateManifest, writePrivateManifest } from './manifest.mjs';
import { createRecoverySet, readRecoveryDescriptor, verifyEncryptedRecoverySet } from './recovery-set.mjs';
import { exportLogicalRecovery, validateManagedBaseline, SUPABASE_CLI_VERSION, POSTGRES_VERSION } from './logical-recovery.mjs';
import { exportFinalizedStorage } from './storage-adapter.mjs';
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
const settingsSchema=z.strictObject({schemaVersion:z.literal(1),operation:z.literal('backup-set'),providerToken:z.string().min(10).max(4096),
 source:z.strictObject({apiUrl:z.string().url(),serviceKey:z.string().min(10).max(4096)}),
 deployment:z.strictObject({accountId:z.string(),workerName:z.string(),versionId:z.string(),origin:z.string().url(),readToken:z.string().min(10).max(4096)}),
 connection:z.strictObject({host:z.string(),port:z.literal(5432),database:z.literal('postgres'),user:z.string(),password:z.string().min(1).max(1024),sslmode:z.literal('verify-full'),sslRootCert:z.string().optional()}),
 toolchain:z.strictObject({mode:z.literal('container')}),managedBaseline:z.strictObject({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/u)}),ownerPublicKeyPath:z.string(),outputDirectory:z.string(),privateDirectory:z.string()});
/** @param {string} path @param {string} root */
export async function readBackupSettings(path,root){try{const parsed=settingsSchema.safeParse(JSON.parse((await readPrivateBytes(path,root)).toString('utf8')));ensure(parsed.success,'PRIVATE_SETTINGS_INVALID');return parsed.data;}catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('PRIVATE_SETTINGS_INVALID');}}
/** @typedef {{manifestPath:string,settingsPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,now?:string,clock?:()=>string}} BackupOptions */
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
  const prior=manifest.history.find(h=>h.step==='backup-set');
  if(prior){const verified=await verifyEncryptedRecoverySet({directory:settings.outputDirectory,repositoryRoot,expectedDescriptorSha256:prior.evidenceSha256});ensure(verified.descriptor.metadata.source.projectRef===source.ref,'BACKUP_IDENTITY_MISMATCH');return{status:'ENCRYPTED_BACKUP_VERIFIED',backupSetId:verified.descriptor.metadata.backupSetId,descriptorSha256:prior.evidenceSha256};}
  if(manifest.pending){
   ensure(manifest.pending.step==='backup-set'&&manifest.state==='monitoring_proved','BACKUP_PUBLICATION_READBACK_REQUIRED');
   let descriptorSha256;
   try{descriptorSha256=digest(await readPrivateBytes(join(settings.outputDirectory,'backup-set.json'),repositoryRoot));}catch{throw new OperationsError('BACKUP_PUBLICATION_READBACK_REQUIRED');}
   const descriptor=await readRecoveryDescriptor({directory:settings.outputDirectory,repositoryRoot,expectedDescriptorSha256:descriptorSha256});
   ensure(descriptor.metadata.backupSetId===manifest.pending.operationId&&descriptor.metadata.source.projectRef===source.ref&&descriptor.metadata.release.commitSha===candidate.sha&&descriptor.metadata.release.treeSha===candidate.tree&&descriptor.metadata.release.workerVersion===candidate.deploymentId&&descriptor.encryption.keyId===manifest.backup.publicKeyId&&descriptor.metadata.startedAt===manifest.pending.startedAt,'BACKUP_IDENTITY_MISMATCH');
   await verifyEncryptedRecoverySet({directory:settings.outputDirectory,repositoryRoot,expectedDescriptorSha256:descriptorSha256});
   manifest.history.push({step:'backup-set',operationId:manifest.pending.operationId,completedAt:clock(),resourceId:null,evidenceSha256:descriptorSha256});manifest.pending=null;manifest.state='backup_started';
   await writePrivateManifest(manifestPath,manifest,{repositoryRoot,candidate,now:clock(),replace:true});
   return{status:'ENCRYPTED_BACKUP_VERIFIED',backupSetId:descriptor.metadata.backupSetId,descriptorSha256};
  }
  ensure(manifest.state==='monitoring_proved'&&!manifest.attempts['backup-set'],'STATE_TRANSITION_FORBIDDEN');
  // No export before exact current release/project/key readback. This transport is read-only.
  await (dependencies.binding??readSourceReleaseBinding)({manifest,settings,now:clock()});
  const operationId=randomUUID();const startedAt=clock();manifest.pending={step:'backup-set',operationId,startedAt,resourceId:null,priorStateSha256:null};manifest.attempts['backup-set']=1;
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
  manifest.history.push({step:'backup-set',operationId,completedAt:clock(),resourceId:null,evidenceSha256:result.descriptorSha256});manifest.pending=null;manifest.state='backup_started';
  await writePrivateManifest(manifestPath,manifest,{repositoryRoot,candidate,now:clock(),replace:true});
  return{status:'ENCRYPTED_BACKUP_VERIFIED',backupSetId:result.backupSetId,descriptorSha256:result.descriptorSha256};
 }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('BACKUP_EXPORT_FAILED_INSPECT_PRIVATE_STATE');}
 finally{for(const bytes of plaintext.values())bytes.fill(0);await lock.close();await unlink(`${manifestPath}.lock`);}
}

/** Owner-custodied decryption proof closes future source reads before sequential retirement.
 * @param {{manifestPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,directory:string,privateKeyPath:string,expectedDescriptorSha256:string,now?:string}} options
 */
export async function executeBackupVerification(options){
 const {manifestPath,repositoryRoot,candidate,directory,expectedDescriptorSha256}=options;const now=options.now??new Date().toISOString();
 await assertPrivatePath(manifestPath,repositoryRoot);let lock;let privateKey;
 try{lock=await open(`${manifestPath}.lock`,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch{throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}
 try{
  const manifest=await readPrivateManifest(manifestPath,{repositoryRoot,candidate,now});
  ensure(manifest.source&&manifest.allowedActions.includes('verify-backup')&&manifest.humanBoundary===null&&manifest.terminal===null&&manifest.pending===null&&['backup_started','backup_verified','artifact_verified'].includes(manifest.state),'BACKUP_VERIFICATION_STATE_INVALID');
  const exported=manifest.history.find(h=>h.step==='backup-set');ensure(exported?.evidenceSha256===expectedDescriptorSha256,'BACKUP_EXPORT_PROVENANCE_REQUIRED');
  const descriptor=await readRecoveryDescriptor({directory,repositoryRoot,expectedDescriptorSha256});
  const source=manifest.source;
  ensure(descriptor.metadata.source.projectRef===source.ref&&descriptor.metadata.source.organizationId===source.organizationId&&descriptor.metadata.source.region===source.region&&descriptor.metadata.release.commitSha===candidate.sha&&descriptor.metadata.release.treeSha===candidate.tree&&descriptor.metadata.release.workerVersion===candidate.deploymentId&&descriptor.encryption.keyId===manifest.backup.publicKeyId,'BACKUP_IDENTITY_MISMATCH');
  const age=Date.parse(now)-Date.parse(descriptor.metadata.finishedAt);ensure(age>=0&&age<=86400000,'BACKUP_RPO_EXCEEDED');
  privateKey=await readPrivateBytes(options.privateKeyPath,repositoryRoot,16384);
  const {verifyRecoverySet}=await import('./recovery-set.mjs');const verified=await verifyRecoverySet({directory,repositoryRoot,expectedDescriptorSha256,privateKey});
  const result={status:'OWNER_KEY_RECOVERY_VERIFIED',...verified,independentlyVerifiedAt:now,recoveryPointAgeSeconds:age/1000};
  manifest.backupVerification={descriptorSha256:expectedDescriptorSha256,independentlyVerifiedAt:now,sourceReadsComplete:true};manifest.state='backup_verified';
  if(!manifest.history.some(h=>h.step==='verify-backup'))manifest.history.push({step:'verify-backup',operationId:randomUUID(),completedAt:now,resourceId:null,evidenceSha256:digest(JSON.stringify(result))});
  await writePrivateManifest(manifestPath,manifest,{repositoryRoot,candidate,now,replace:true});return result;
 }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('BACKUP_DECRYPTION_VERIFICATION_FAILED');}
 finally{privateKey?.fill(0);await lock.close();await unlink(`${manifestPath}.lock`);}
}
