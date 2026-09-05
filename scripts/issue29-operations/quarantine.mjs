import {createHash} from 'node:crypto';
import {ensure,OperationsError} from './manifest.mjs';
import {canonicalJson} from './recovery-set.mjs';
/** Read-only provider quarantine for a newly manifest-created target. Database trigger/job/network
 * and empty-state checks remain independently mandatory in the logical importer before writes.
 * @param {{manifest:import('./manifest.mjs').OperationsManifest,providerToken:string,fetchImpl?:typeof fetch,now?:string}} options
 */
export async function readRestoreQuarantine({manifest,providerToken,fetchImpl=fetch,now=new Date().toISOString()}){
 const target=manifest.target;
 ensure(target&&manifest.source&&target.ref!==manifest.source.ref&&!manifest.forbiddenRefs.includes(target.ref)&&!manifest.preservedRefs.includes(target.ref),'TARGET_FORBIDDEN');
 const owned=manifest.cleanup.resources.find(r=>r.provider==='supabase'&&r.id===target.ref&&r.runId===manifest.runId&&r.disposition==='disposable'&&r.absentAt===null);
 ensure(owned,'CLEANUP_OWNERSHIP_MISMATCH');
 ensure(manifest.cleanup.resources.filter(r=>r.provider==='cloudflare').every(r=>r.absentAt!==null),'RESTORE_WORKER_QUARANTINE_UNPROVEN');
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
 const evidence={runId:manifest.runId,projectRef:target.ref,organizationId:target.organizationId,region:target.region,createdAt:owned.createdAt,checkedAt:now,edgeFunctionCount:0,enabledAuthHookCount:0,customSmtp:false,workerResourcesAbsent:true};
 const evidenceSha256=createHash('sha256').update(canonicalJson(evidence)).digest('hex');
 return{evidence,quarantine:{runId:manifest.runId,projectRef:target.ref,evidenceSha256,checkedAt:now,noRuntimeRoutes:/** @type {const} */(true),noOutboundIntegrations:/** @type {const} */(true),noRuntimeSecrets:/** @type {const} */(true)}};
}
