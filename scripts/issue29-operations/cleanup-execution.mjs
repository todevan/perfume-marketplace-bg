import {constants} from 'node:fs';
import {open,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {assertPrivatePath,ensure,OperationsError,readPrivateManifest,writePrivateManifest} from './manifest.mjs';
import {readPrivateBytes} from './execution.mjs';
import {persistOperationsEvidence,persistOperationsIntent} from './operator.mjs';
import {createSupabaseOperationsAdapter} from './supabase-adapter.mjs';
const schema=z.strictObject({schemaVersion:z.literal(1),operation:z.literal('cleanup'),action:z.literal('delete-restore-project'),providerToken:z.string().min(10),capabilityId:z.string()});
/** Delete only the current transaction's disposable restore project. The persistent source and its
 * Worker cannot be selected. A previous uncertain DELETE can only be resumed through absence reads.
 * @param {{manifestPath:string,settingsPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,now?:string,clock?:()=>string}} options
 * @param {{adapterFactory?:typeof createSupabaseOperationsAdapter}} [dependencies]
 */
export async function executeProjectCleanup(options,dependencies={}){
 const {manifestPath,repositoryRoot,candidate}=options;const clock=options.clock??(()=>options.now??new Date().toISOString());
 let parsed;try{parsed=schema.safeParse(JSON.parse((await readPrivateBytes(options.settingsPath,repositoryRoot)).toString()));}catch{throw new OperationsError('PRIVATE_SETTINGS_INVALID');}ensure(parsed.success,'PRIVATE_SETTINGS_INVALID');const settings=parsed.data;
 await assertPrivatePath(manifestPath,repositoryRoot);let lock;
 try{lock=await open(`${manifestPath}.lock`,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch{throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}
 try{
  const manifest=await readPrivateManifest(manifestPath,{repositoryRoot,candidate,now:clock()});const target=manifest.target;
  ensure(settings.capabilityId===manifest.capabilityIds.cleanup&&manifest.allowedActions.includes('cleanup-resource')&&manifest.cleanup.authorized&&manifest.humanBoundary===null,'CLEANUP_AUTHORITY_REQUIRED');
  ensure(target&&manifest.source&&target.ref!==manifest.source.ref&&!manifest.forbiddenRefs.includes(target.ref)&&!manifest.preservedRefs.includes(target.ref),'TARGET_FORBIDDEN');
  const owned=manifest.cleanup.resources.find(r=>r.provider==='supabase'&&r.id===target.ref&&r.runId===manifest.runId&&r.disposition==='disposable');ensure(owned,'CLEANUP_OWNERSHIP_MISMATCH');
  ensure(manifest.cleanup.resources.filter(r=>r.provider==='cloudflare'&&r.disposition==='disposable').every(r=>r.absentAt!==null),'RESTORE_WORKER_ABSENCE_REQUIRED');
  ensure(!manifest.pending||(manifest.pending.step==='cleanup-resource'&&manifest.pending.resourceId===target.ref),'PENDING_OPERATION_REQUIRES_READBACK');
  const adapter=(dependencies.adapterFactory??createSupabaseOperationsAdapter)({token:settings.providerToken,clock});
  const operationId=manifest.pending?.operationId??randomUUID();const context=()=>({manifest:structuredClone(manifest),operationId,purpose:/** @type {const} */('target')});
  const save=()=>writePrivateManifest(manifestPath,manifest,{repositoryRoot,candidate,now:clock(),replace:true});
  let intentSha256;
  if(!manifest.pending&&owned.absentAt===null){
   ensure(!manifest.attempts[`cleanup-resource:${target.ref}`],'ATTEMPT_LIMIT');
   manifest.pending={step:'cleanup-resource',operationId,startedAt:clock(),resourceId:target.ref,priorStateSha256:owned.evidenceSha256};manifest.attempts[`cleanup-resource:${target.ref}`]=1;manifest.state='transient_cleanup_pending';await save();intentSha256=await persistOperationsIntent(manifestPath,manifest,repositoryRoot);
   try{await adapter.remove(context());}catch{throw new OperationsError('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY');}
  }
  if(manifest.pending)intentSha256??=await persistOperationsIntent(manifestPath,manifest,repositoryRoot,{mustExist:true});
  let proof;try{proof=await adapter.readAbsent(context());}catch{throw new OperationsError('READBACK_UNCERTAIN_NO_RETRY');}
  ensure(proof.absent===true&&/^[a-f0-9]{64}$/u.test(proof.evidenceSha256),'CLEANUP_ABSENCE_UNPROVEN');
  await persistOperationsEvidence(manifestPath,repositoryRoot,proof.evidence,proof.evidenceSha256);
  if(owned.absentAt===null){owned.absentAt=clock();for(const r of manifest.cleanup.resources)if(r.provider==='supabase-storage'&&r.id.split(':')[1]===target.ref)r.absentAt=owned.absentAt;manifest.history.push({step:'cleanup-resource',operationId,completedAt:clock(),resourceId:target.ref,evidenceSha256:proof.evidenceSha256,intentSha256});manifest.pending=null;await save();}
  return{status:'DISPOSABLE_RESTORE_PROJECT_ABSENT',runId:manifest.runId,state:manifest.state,evidenceSha256:proof.evidenceSha256,persistentSourceRetained:true};
 }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('CLEANUP_OUTCOME_REQUIRES_READBACK');}
 finally{await lock.close();await unlink(`${manifestPath}.lock`);}
}
