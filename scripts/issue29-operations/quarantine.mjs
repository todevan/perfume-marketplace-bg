import {createHash} from 'node:crypto';
import {ensure,OperationsError} from './manifest.mjs';
import {canonicalJson} from './recovery-set.mjs';
/** Read-only provider quarantine for a newly manifest-created target. Database trigger/job/network
 * and empty-state checks remain independently mandatory in the logical importer before writes.
 * @param {{manifest:import('./manifest.mjs').OperationsManifest,providerToken:string,fetchImpl?:typeof fetch,now?:string,repositoryRoot?:string,sourceWorker?:{settings:unknown,privateDirectory:string,readToken:string}}} options
 * @param {{readWorkerBinding?:(input:any)=>Promise<any>}} [dependencies]
 */
export async function readRestoreQuarantine({manifest,providerToken,fetchImpl=fetch,now=new Date().toISOString(),repositoryRoot,sourceWorker},dependencies={}){
 const target=manifest.target;
 ensure(target&&manifest.source&&target.ref!==manifest.source.ref&&!manifest.forbiddenRefs.includes(target.ref)&&!manifest.preservedRefs.includes(target.ref),'TARGET_FORBIDDEN');
 const owned=manifest.cleanup.resources.find(r=>r.provider==='supabase'&&r.id===target.ref&&r.runId===manifest.runId&&r.disposition==='disposable'&&r.absentAt===null);
 ensure(owned,'CLEANUP_OWNERSHIP_MISMATCH');
 const liveWorkers=manifest.cleanup.resources.filter(r=>r.provider==='cloudflare'&&r.absentAt===null);
 let sourceWorkerIsolationSha256=null;
 if(liveWorkers.length){
  const expectedName=`issue29-${manifest.runId}`;
  ensure(liveWorkers.length===1&&liveWorkers[0].id===expectedName&&liveWorkers[0].runId===manifest.runId&&liveWorkers[0].disposition==='persistent'&&sourceWorker,'RESTORE_WORKER_QUARANTINE_UNPROVEN');
  ensure(manifest.cleanup.resources.some(r=>r.provider==='supabase'&&r.id===manifest.source?.ref&&r.runId===manifest.runId&&r.disposition==='persistent'&&r.absentAt===null),'RESTORE_WORKER_QUARANTINE_UNPROVEN');
  // The standing source is allowed to remain deployed while its database is paused.
  // Read only Cloudflare identity/config: never require source liveness or reuse a source credential on target.
  ensure(typeof repositoryRoot==='string','RESTORE_WORKER_QUARANTINE_UNPROVEN');
  const readWorkerBinding=dependencies.readWorkerBinding??(await import('./worker-adapter.mjs')).readIssue29WorkerBinding;
  const proof=await readWorkerBinding({manifest,...sourceWorker,repositoryRoot});
  ensure(proof.status==='verified'&&proof.workerName===expectedName&&proof.purpose==='source'&&proof.projectRef===manifest.source.ref&&proof.candidateSha===manifest.candidate.sha&&proof.candidateTree===manifest.candidate.tree&&proof.versionId===manifest.candidate.deploymentId&&Date.parse(proof.checkedAt)<=Date.parse(now)+300000&&Date.parse(now)-Date.parse(proof.checkedAt)<=300000&&/^[a-f0-9]{64}$/u.test(proof.evidenceSha256),'RESTORE_WORKER_QUARANTINE_UNPROVEN');
  sourceWorkerIsolationSha256=proof.evidenceSha256;
 }
 ensure(typeof providerToken==='string'&&providerToken.length>0&&!/[\r\n]/u.test(providerToken),'PROVIDER_CREDENTIAL_REQUIRED');
 /** @param {string} path */
 async function get(path){try{const response=await fetchImpl(`https://api.supabase.com/v1${path}`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${providerToken}`}});ensure(response.ok&&response.body,'QUARANTINE_READBACK_UNAVAILABLE');const reader=response.body.getReader();let length=0;const chunks=[];try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;ensure(length<=1048576,'QUARANTINE_RESPONSE_LIMIT');chunks.push(Buffer.from(part.value));}}finally{await reader.cancel();}return JSON.parse(Buffer.concat(chunks).toString());}catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('QUARANTINE_READBACK_UNAVAILABLE');}}
 const org=await get(`/organizations/${target.organizationId}`);ensure(org.id===target.organizationId&&org.plan==='free','ZERO_COST_REQUIRED');
 const project=await get(`/projects/${target.ref}`);ensure(project.ref===target.ref&&project.organization_slug===target.organizationId&&project.region===target.region&&project.status==='ACTIVE_HEALTHY'&&String(project.database?.version).startsWith(`${target.postgresVersion}.`)&&Date.parse(project.created_at)===Date.parse(owned.createdAt),'TARGET_IDENTITY_MISMATCH');
 const functions=await get(`/projects/${target.ref}/functions`);ensure(Array.isArray(functions)&&functions.length===0,'OUTBOUND_FUNCTIONS_FORBIDDEN');
 const auth=await get(`/projects/${target.ref}/config/auth`);
 const hookNames=['custom_access_token','mfa_verification_attempt','password_verification_attempt','send_sms','send_email','before_user_created','after_user_created'];
 ensure(hookNames.every(name=>auth[`hook_${name}_enabled`]===false)&&Object.entries(auth).filter(([k])=>/^hook_.*_enabled$/u.test(k)).every(([,value])=>value===false),'OUTBOUND_AUTH_HOOKS_FORBIDDEN');
 ensure(!auth.smtp_host&&!auth.smtp_user&&!auth.smtp_pass,'FOREIGN_EMAIL_CONFIGURATION');
 // SQL Auth import does not invoke GoTrue email dispatch. No Worker/functions/jobs are enabled.
 const evidence={runId:manifest.runId,projectRef:target.ref,organizationId:target.organizationId,region:target.region,createdAt:owned.createdAt,checkedAt:now,edgeFunctionCount:0,enabledAuthHookCount:0,customSmtp:false,targetWorkerResourcesAbsent:true,sourceWorkerIsolationSha256};
 const evidenceSha256=createHash('sha256').update(canonicalJson(evidence)).digest('hex');
 return{evidence,quarantine:{runId:manifest.runId,projectRef:target.ref,evidenceSha256,checkedAt:now,noRuntimeRoutes:/** @type {const} */(true),noOutboundIntegrations:/** @type {const} */(true),noRuntimeSecrets:/** @type {const} */(true)}};
}
