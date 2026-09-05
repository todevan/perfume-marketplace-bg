import {constants} from 'node:fs';
import {open,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {assertPrivatePath,ensure,OperationsError,readPrivateManifest,writePrivateManifest} from './manifest.mjs';
import {readPrivateBytes} from './execution.mjs';
import {canonicalJson,withVerifiedRecoverySet} from './recovery-set.mjs';
import {captureManagedBaseline,restoreLogicalRecovery,verifyLogicalRecovery,readFinalizedPhotos} from './logical-recovery.mjs';
import {restoreFinalizedStorage,verifyFinalizedStorage} from './storage-adapter.mjs';
import {readRestoreQuarantine} from './quarantine.mjs';
/** @param {unknown} value */
const digest=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const settingsSchema=z.strictObject({schemaVersion:z.literal(1),operation:z.literal('restore'),providerToken:z.string().min(10),targetServiceKey:z.string().min(10),backupDirectory:z.string(),descriptorSha256:z.string().regex(/^[a-f0-9]{64}$/u),privateKeyPath:z.string(),
 connection:z.strictObject({host:z.string(),port:z.literal(5432),database:z.literal('postgres'),user:z.string(),password:z.string().min(1),sslmode:z.literal('verify-full'),sslRootCert:z.literal('system').optional()}),toolchain:z.strictObject({mode:z.literal('container')})});
/** @typedef {{manifestPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,settingsPath:string,now?:string,clock?:()=>string,verifyOnly?:boolean}} RestoreOptions */
/** Coordinated real DB/Auth and Storage restore within the existing manifest. This does not claim
 * application/browser/privacy journey completion: those independent gates must still advance integrity_verified.
 * @param {RestoreOptions} options
 */
export async function executeRestore(options){
 const {manifestPath,repositoryRoot,candidate}=options;const clock=options.clock??(()=>options.now??new Date().toISOString());
 await assertPrivatePath(manifestPath,repositoryRoot);let lock;let privateKey;
 try{lock=await open(`${manifestPath}.lock`,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch{throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}
 try{
  const manifest=await readPrivateManifest(manifestPath,{repositoryRoot,candidate,now:clock()});
  const parsed=settingsSchema.safeParse(JSON.parse((await readPrivateBytes(options.settingsPath,repositoryRoot)).toString()));ensure(parsed.success,'PRIVATE_SETTINGS_INVALID');const settings=parsed.data;
  const target=manifest.target;ensure(target&&manifest.source&&target.ref!==manifest.source.ref&&!manifest.forbiddenRefs.includes(target.ref)&&!manifest.preservedRefs.includes(target.ref),'TARGET_FORBIDDEN');
  const owned=manifest.cleanup.resources.find(r=>r.provider==='supabase'&&r.id===target.ref&&r.runId===manifest.runId&&r.disposition==='disposable'&&r.absentAt===null);ensure(owned,'CLEANUP_OWNERSHIP_MISMATCH');
  ensure(manifest.backupVerification?.sourceReadsComplete===true&&manifest.backupVerification.descriptorSha256===settings.descriptorSha256,'BACKUP_VERIFICATION_REQUIRED');
  ensure(manifest.humanBoundary===null&&manifest.terminal===null&&['target_read_back','quarantine_verified','database_restored','storage_restored'].includes(manifest.state),'RESTORE_STATE_INVALID');
  for(const action of options.verifyOnly?['verify-restore']:['quarantine','restore-database','restore-storage'])ensure(manifest.allowedActions.includes(action),'ACTION_FORBIDDEN');
  ensure(!options.verifyOnly||manifest.state==='storage_restored','RESTORE_STATE_INVALID');
  const scope={mode:/** @type {const} */('hosted'),role:/** @type {const} */('target'),runId:manifest.runId,projectRef:target.ref,sourceRef:manifest.source.ref,preservedRefs:manifest.preservedRefs,createdResourceEvidenceSha256:owned.evidenceSha256,apiUrl:target.url};
  const database={scope,connection:settings.connection,toolchain:settings.toolchain};
  privateKey=await readPrivateBytes(settings.privateKeyPath,repositoryRoot,16384);
  return await withVerifiedRecoverySet({directory:settings.backupDirectory,repositoryRoot,privateKey,expectedDescriptorSha256:settings.descriptorSha256},async({descriptor,components,storageManifest})=>{
   ensure(descriptor.metadata.source.projectRef===scope.sourceRef&&descriptor.metadata.release.commitSha===candidate.sha&&descriptor.metadata.release.treeSha===candidate.tree&&descriptor.metadata.release.workerVersion===candidate.deploymentId,'BACKUP_IDENTITY_MISMATCH');
   const platform=JSON.parse(/** @type {Buffer} */(components.get('platform-inventory.json')).toString());
   const save=()=>writePrivateManifest(manifestPath,manifest,{repositoryRoot,candidate,now:clock(),replace:true});
   if(!manifest.recoveryTimings){const age=Date.parse(clock())-Date.parse(descriptor.metadata.finishedAt);ensure(age>=0&&age<=86400000,'BACKUP_RPO_EXCEEDED');manifest.recoveryTimings={startedAt:clock()};await save();}
   if(manifest.state==='target_read_back'){
    ensure(!manifest.pending,'PENDING_OPERATION_REQUIRES_READBACK');const q=await readRestoreQuarantine({manifest,providerToken:settings.providerToken,now:clock()});
    const baseline=await captureManagedBaseline(database);ensure(baseline.schemaSha256===platform.managedBaselineSha256,'MANAGED_BASE_SCHEMA_DRIFT');
    manifest.history.push({step:'quarantine',operationId:randomUUID(),completedAt:clock(),resourceId:null,evidenceSha256:digest({provider:q.evidence,baselineSha256:baseline.schemaSha256})});manifest.state='quarantine_verified';await save();
   }
   if(manifest.state==='quarantine_verified'){
    ensure(!options.verifyOnly,'RESTORE_STATE_INVALID');
    if(!manifest.pending){
     ensure(!manifest.attempts['restore-database'],'ATTEMPT_LIMIT');const q=await readRestoreQuarantine({manifest,providerToken:settings.providerToken,now:clock()});
     manifest.pending={step:'restore-database',operationId:randomUUID(),startedAt:clock(),resourceId:null,priorStateSha256:settings.descriptorSha256};manifest.attempts['restore-database']=1;await save();
     await restoreLogicalRecovery({...database,components,quarantine:q.quarantine});
    }else ensure(manifest.pending.step==='restore-database'&&manifest.pending.priorStateSha256===settings.descriptorSha256,'PENDING_OPERATION_REQUIRES_READBACK');
    const proof=await verifyLogicalRecovery({...database,expectedInventory:platform});
    manifest.history.push({step:'restore-database',operationId:manifest.pending.operationId,completedAt:clock(),resourceId:null,evidenceSha256:digest(proof)});manifest.pending=null;manifest.state='database_restored';manifest.recoveryTimings.databaseVerifiedAt=clock();await save();
   }
   const photos=await readFinalizedPhotos(database);
   const storage={scope,secretKey:settings.targetServiceKey,photos,expectedRowsetSha256:descriptor.checkpoint.finalizedRowsetSha256,storageManifest,descriptorSha256:settings.descriptorSha256,bucketInventory:platform.storageBuckets};
   if(manifest.state==='database_restored'){
    ensure(!options.verifyOnly,'RESTORE_STATE_INVALID');
    await verifyLogicalRecovery({...database,expectedInventory:platform});
    manifest.recoveryTimings.storageStartedAt??=clock();await save();
    /** @param {import('./storage-adapter.mjs').StorageIntent} intent */
    const key=intent=>digest({kind:intent.kind,resource:intent.resource});
    await restoreFinalizedStorage({...storage,components,...(manifest.history.some(h=>h.step==='restore-storage')||manifest.pending?.step==='restore-storage'?{resumeDescriptorSha256:settings.descriptorSha256}:{}),
     persistIntent:async intent=>{const resourceId=key(intent);ensure(!manifest.pending,'PENDING_UPLOAD_REQUIRES_READBACK');ensure(!manifest.attempts[`restore-storage:${resourceId}`],'ATTEMPT_LIMIT');manifest.pending={step:'restore-storage',operationId:randomUUID(),startedAt:clock(),resourceId,priorStateSha256:settings.descriptorSha256};manifest.attempts[`restore-storage:${resourceId}`]=1;await save();},
     readbackVerified:async intent=>{const resourceId=key(intent);if(manifest.history.some(h=>h.step==='restore-storage'&&h.resourceId===resourceId))return;ensure(manifest.pending?.step==='restore-storage'&&manifest.pending.resourceId===resourceId&&manifest.pending.priorStateSha256===settings.descriptorSha256,'STORAGE_READBACK_PROVENANCE_REQUIRED');manifest.history.push({step:'restore-storage',operationId:manifest.pending.operationId,completedAt:clock(),resourceId,evidenceSha256:digest(intent)});manifest.pending=null;await save();}});
    ensure(!manifest.pending,'PENDING_UPLOAD_REQUIRES_READBACK');const proof=await verifyFinalizedStorage(storage);manifest.state='storage_restored';manifest.recoveryTimings.storageVerifiedAt=clock();manifest.history.push({step:'restore-storage',operationId:randomUUID(),completedAt:clock(),resourceId:null,evidenceSha256:digest(proof)});await save();
   }
   const dbProof=await verifyLogicalRecovery({...database,expectedInventory:platform});const storageProof=await verifyFinalizedStorage(storage);
   const timing=manifest.recoveryTimings;
   return{status:'DATABASE_STORAGE_VERIFIED_APPLICATION_PROOF_PENDING',descriptorSha256:settings.descriptorSha256,targetRef:target.ref,database:dbProof,storage:storageProof,recoveryPointAgeAtStartSeconds:(Date.parse(timing.startedAt)-Date.parse(descriptor.metadata.finishedAt))/1000,databaseRecoveryElapsedSeconds:(Date.parse(timing.databaseVerifiedAt??'')-Date.parse(timing.startedAt))/1000,storageRecoveryElapsedSeconds:(Date.parse(timing.storageVerifiedAt??'')-Date.parse(timing.storageStartedAt??''))/1000,fullRecoveryElapsedSeconds:null};
  });
 }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('RESTORE_OUTCOME_REQUIRES_PRIVATE_READBACK');}
 finally{privateKey?.fill(0);await lock.close();await unlink(`${manifestPath}.lock`);}
}
