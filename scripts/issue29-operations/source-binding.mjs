import { createHash, timingSafeEqual } from 'node:crypto';
import { ensure, OperationsError } from './manifest.mjs';
import { canonicalJson } from './recovery-set.mjs';
/** @typedef {{providerToken:string,source:{apiUrl:string,serviceKey:string},deployment:{accountId:string,workerName:string,versionId:string,origin:string,readToken:string}}} BindingSettings */
/** Exact read-only source and release readback. No provider response or credential is returned.
 * @param {{manifest:import('./manifest.mjs').OperationsManifest,settings:BindingSettings,fetchImpl?:typeof fetch,now?:string}} options
 */
export async function readSourceReleaseBinding({manifest,settings,fetchImpl=fetch,now=new Date().toISOString()}) {
 const source=manifest.source;
 ensure(source && !manifest.preservedRefs.includes(source.ref),'PRESERVED_PROJECT_FORBIDDEN');
 const {deployment}=settings;
 ensure(source.url===settings.source.apiUrl && /^[a-f0-9]{32}$/u.test(deployment.accountId) && /^issue29-[a-z0-9-]{1,55}$/u.test(deployment.workerName) && deployment.workerName.includes(manifest.runId) && deployment.versionId===manifest.candidate.deploymentId && /^[a-zA-Z0-9-]{1,128}$/u.test(deployment.versionId),'SOURCE_BINDING_IDENTITY_MISMATCH');
 const origin=new URL(deployment.origin);
 ensure(origin.origin===deployment.origin && origin.protocol==='https:' && origin.hostname.startsWith(`${deployment.workerName}.`) && /^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/u.test(origin.hostname),'ISSUE_WORKER_ORIGIN_REQUIRED');
 for(const value of [settings.providerToken,settings.source.serviceKey,deployment.readToken])ensure(typeof value==='string' && value.length>0 && !/[\r\n]/u.test(value),'PROVIDER_CREDENTIAL_REQUIRED');
 /** @param {string} url @param {string} token */
 async function get(url,token) {
  try{
   const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${token}`}});
   ensure(response.ok && response.body,'SOURCE_BINDING_READ_FAILED');
   const reader=response.body.getReader();let size=0;const chunks=[];
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;ensure(size<=2097152,'SOURCE_BINDING_RESPONSE_LIMIT');chunks.push(Buffer.from(part.value));}}finally{await reader.cancel();}
   return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('SOURCE_BINDING_READ_FAILED');}
 }
 const org=await get(`https://api.supabase.com/v1/organizations/${source.organizationId}`,settings.providerToken);
 ensure(org.id===source.organizationId && org.plan==='free','ZERO_COST_REQUIRED');
 const project=await get(`https://api.supabase.com/v1/projects/${source.ref}`,settings.providerToken);
 ensure(project.ref===source.ref && project.organization_slug===source.organizationId && project.region===source.region && project.status==='ACTIVE_HEALTHY' && String(project.database?.version).startsWith(`${source.postgresVersion}.`),'SOURCE_BINDING_IDENTITY_MISMATCH');
 const keys=await get(`https://api.supabase.com/v1/projects/${source.ref}/api-keys?reveal=true`,settings.providerToken);
 const fingerprint=/** @param {string} value */value=>createHash('sha256').update(value).digest();
 ensure(Array.isArray(keys) && keys.some(key=>key.name==='service_role' && typeof key.api_key==='string' && timingSafeEqual(fingerprint(key.api_key),fingerprint(settings.source.serviceKey))),'SOURCE_STORAGE_CREDENTIAL_MISMATCH');
 const root=`https://api.cloudflare.com/client/v4/accounts/${deployment.accountId}/workers/scripts/${deployment.workerName}`;
 const versionResponse=await get(`${root}/versions/${deployment.versionId}`,deployment.readToken);
 const version=versionResponse.result;
 ensure(versionResponse.success===true && version?.id===deployment.versionId && Array.isArray(version.resources?.bindings),'WORKER_VERSION_UNPROVEN');
 const bindings=version.resources.bindings;
 /** @param {string} name @param {string} value */
 const exact=(name,value)=>bindings.filter(/** @param {any} b */ b=>b.type==='plain_text'&&b.name===name&&b.text===value).length===1;
 ensure(exact('RELEASE_COMMIT_SHA',manifest.candidate.sha) && exact('PUBLIC_SUPABASE_URL',source.url) && exact('APP_ENV','development') && exact('ISSUE29_CANDIDATE_TREE',manifest.candidate.tree) && exact('ISSUE29_RUN_ID',manifest.runId),'WORKER_SOURCE_BINDING_MISMATCH');
 ensure(Number.isFinite(Date.parse(version.metadata?.created_on)) && Date.parse(version.metadata.created_on)>=Date.parse(manifest.sourceProvenance?.createdAt??'') && Date.parse(version.metadata.created_on)<=Date.parse(now),'WORKER_TRANSACTION_WINDOW_MISMATCH');
 const active=await get(`${root}/deployments`,deployment.readToken);
 const versions=active.result?.deployments?.[0]?.versions;
 ensure(active.success===true && Array.isArray(versions) && versions.length===1 && versions[0].version_id===deployment.versionId && versions[0].percentage===100,'WORKER_DEPLOYMENT_MISMATCH');
 try{const health=await fetchImpl(`${origin.origin}/`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});await health.body?.cancel();ensure(health.status===200 && health.headers.get('x-deployed-git-sha')===manifest.candidate.sha,'WORKER_HEALTH_IDENTITY_MISMATCH');}catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('SOURCE_BINDING_READ_FAILED');}
 const proof={sourceRef:source.ref,organizationId:source.organizationId,region:source.region,candidate:manifest.candidate,workerName:deployment.workerName,runId:manifest.runId,checkedAt:now};
 return {...proof,evidenceSha256:createHash('sha256').update(canonicalJson(proof)).digest('hex')};
}
