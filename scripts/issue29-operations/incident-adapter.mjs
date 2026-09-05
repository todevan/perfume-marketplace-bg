import { createClient } from '@supabase/supabase-js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ensure, OperationsError, validateManifest } from './manifest.mjs';
import { createPostgresToolchain, assertRecoveryScope } from './logical-recovery.mjs';
import { canonicalJson } from './recovery-set.mjs';
import { verifyMonitoringRuleJourney } from './monitoring-proof.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const HASH=/^[a-f0-9]{64}$/u;
const BUCKET='operations-sentinels';
/** @param {string|Uint8Array} value */
function sha256(value){return createHash('sha256').update(value).digest('hex');}
/** @param {unknown} value */
function evidence(value){return sha256(canonicalJson(value));}
/** @typedef {{fetchImpl?:typeof fetch,now?:()=>string}} Options */
/** @typedef {{manifest:import('./manifest.mjs').OperationsManifest,projectRef:string,providerToken:string,serviceKey:string}} ProjectSettings */
/** @param {ProjectSettings} s @param {string} now */
function project(s,now){
  ensure(!s.manifest.preservedRefs.includes(s.projectRef),'PRESERVED_PROJECT_FORBIDDEN');
  const m=validateManifest(s.manifest,{now});
  const selected=s.projectRef===m.source?.ref?m.source:s.projectRef===m.target?.ref?m.target:null;
  ensure(selected && ['synthetic','disposable'].includes(selected.environment),'INCIDENT_PROJECT_IDENTITY_INVALID');
  const owned=m.cleanup.resources.find(r=>r.provider==='supabase'&&r.id===s.projectRef&&r.runId===m.runId&&r.disposition==='disposable'&&r.absentAt===null);
  ensure(owned && m.sourceProvenance?.fixtureRunId===m.runId && m.sourceProvenance.verifiedAt,'INCIDENT_PROJECT_OWNERSHIP_UNPROVEN');
  ensure(m.humanBoundary===null && m.terminal===null,'TRANSACTION_TERMINAL');
  for(const key of [s.providerToken,s.serviceKey])ensure(typeof key==='string'&&key.length>=16&&!/[\r\n]/u.test(key),'INCIDENT_CREDENTIAL_INVALID');
  ensure(s.providerToken!==s.serviceKey,'INCIDENT_CAPABILITIES_NOT_DISTINCT');
  return selected;
}
/** @param {typeof fetch} fetchImpl @param {string} url @param {RequestInit} [init] @param {boolean} [mutation] */
async function jsonRequest(fetchImpl,url,init={},mutation=false){
  try {
    const response=await fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});
    ensure(response.ok && response.body,mutation?'INCIDENT_MUTATION_UNCERTAIN_READBACK_ONLY':'INCIDENT_READBACK_FAILED');
    const reader=response.body.getReader();const chunks=[];let size=0;
    try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;ensure(size<=65536,'INCIDENT_RESPONSE_LIMIT');chunks.push(item.value);}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch(error){if(mutation)throw new OperationsError('INCIDENT_MUTATION_UNCERTAIN_READBACK_ONLY');if(error instanceof OperationsError)throw error;throw new OperationsError('INCIDENT_READBACK_FAILED');}
}
/** @param {ProjectSettings} s @param {Options} options */
function exactProject(s,options){
  const now=options.now??(()=>new Date().toISOString()),fetchImpl=options.fetchImpl??fetch;
  const selected=project(s,now());
  async function preflight(){
    project(s,now());
    const headers={Authorization:`Bearer ${s.providerToken}`};
    const organization=await jsonRequest(fetchImpl,`https://api.supabase.com/v1/organizations/${selected.organizationId}`,{headers});
    const live=await jsonRequest(fetchImpl,`https://api.supabase.com/v1/projects/${selected.ref}`,{headers});
    ensure(organization.id===selected.organizationId && organization.plan==='free' && live.ref===selected.ref && live.organization_slug===selected.organizationId &&
      live.region===selected.region && live.status==='ACTIVE_HEALTHY' && String(live.database?.version).startsWith(selected.postgresVersion+'.'),'INCIDENT_PROJECT_READBACK_MISMATCH');
    const keys=await jsonRequest(fetchImpl,`https://api.supabase.com/v1/projects/${selected.ref}/api-keys?reveal=true`,{headers});
    const fingerprint=/** @param {string} key */key=>createHash('sha256').update(key).digest();
    ensure(Array.isArray(keys)&&keys.some(k=>k.name==='service_role'&&typeof k.api_key==='string'&&timingSafeEqual(fingerprint(k.api_key),fingerprint(s.serviceKey))),'INCIDENT_CREDENTIAL_IDENTITY_MISMATCH');
    return {projectRef:selected.ref,runId:s.manifest.runId,candidateSha:s.manifest.candidate.sha,checkedAt:now(),evidenceSha256:evidence({projectRef:selected.ref,run:s.manifest.runId,sha:s.manifest.candidate.sha,at:now()})};
  }
  return {selected,preflight,now,fetchImpl};
}
/** @typedef {ProjectSettings & {sentinel:{path:string,sha256:string,bytes:Uint8Array},readinessOrigin:string,monitorToken:string}} SentinelSettings */
/** Sentinel is an explicitly excluded synthetic fixture, never a user finalized-photo path.
 * Supabase Storage SDK is reused with no upsert and a bounded exact-origin fetch boundary.
 * @param {SentinelSettings} settings @param {Options} options */
export function createSentinelAdapter(settings,options={}){
  const context=exactProject(settings,options),{selected,preflight,now,fetchImpl}=context,m=settings.manifest;
  ensure(settings.sentinel.path===`${m.runId}/sentinel.bin`&&HASH.test(settings.sentinel.sha256)&&settings.sentinel.bytes instanceof Uint8Array&&
    settings.sentinel.bytes.byteLength>0&&settings.sentinel.bytes.byteLength<=4096&&sha256(settings.sentinel.bytes)===settings.sentinel.sha256,'SENTINEL_FIXTURE_INVALID');
  ensure(/^https:\/\/issue29-[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/u.test(settings.readinessOrigin)&&settings.readinessOrigin.includes(m.runId)&&
    typeof settings.monitorToken==='string'&&settings.monitorToken.length>=32&&settings.monitorToken!==settings.serviceKey,'SENTINEL_MONITOR_BOUNDARY_INVALID');
  const evidenceMode=options.fetchImpl&&options.fetchImpl!==fetch?'deterministic-http-fixture':'provider-readback';
  /** @template {Record<string,unknown>} T @param {T} fields */
  function receipt(fields){const body={schemaVersion:1,evidenceMode,runId:m.runId,candidateSha:m.candidate.sha,projectRef:selected.ref,checkedAt:now(),...fields};return {...body,evidenceSha256:evidence(body)};}
  function identity(){project(settings,now());return {runId:m.runId,candidateSha:m.candidate.sha,projectRef:selected.ref,restoreTarget:selected.ref===m.target?.ref,state:m.state,evidenceMode,
    targetOrigin:settings.readinessOrigin,sha256:settings.sentinel.sha256,bytes:settings.sentinel.bytes.byteLength};}
  const bucketResourceId=`storage-bucket:${selected.ref}:${BUCKET}`,objectResourceId=`storage-object:${selected.ref}:${m.runId}:sentinel`;
  const client=createClient(selected.url,settings.serviceKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(url,init)=>{
    const u=new URL(String(url));ensure(u.origin===selected.url&&u.pathname.startsWith('/storage/v1/'),'SENTINEL_REQUEST_TARGET_INVALID');
    const response=await fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});
    const reader=response.body?.getReader();if(!reader)return response;const chunks=[];let length=0;
    try{for(;;){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;ensure(length<=16384,'SENTINEL_RESPONSE_LIMIT');chunks.push(item.value);}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers});
  }}});
  /** @param {string} id */
  function owned(id){ensure(m.cleanup.resources.some(r=>r.provider==='supabase-storage'&&r.id===id&&r.runId===m.runId&&r.disposition==='disposable'&&r.absentAt===null),'SENTINEL_RESOURCE_NOT_OWNED');}
  async function bucket(){const r=await client.storage.getBucket(BUCKET);if(r.error){ensure(r.error.status===404,'SENTINEL_BUCKET_READ_FAILED');return null;}
    ensure(r.data?.id===BUCKET&&r.data.name===BUCKET&&r.data.public===false,'SENTINEL_BUCKET_PRIVACY_MISMATCH');return r.data;}
  async function read(){
    const r=await client.storage.from(BUCKET).download(settings.sentinel.path);
    if(r.error){ensure(r.error.status===404,'SENTINEL_READBACK_FAILED');return receipt({status:'absent',resourceId:objectResourceId});}
    ensure(r.data,'SENTINEL_READBACK_FAILED');const bytes=new Uint8Array(await r.data.arrayBuffer());
    ensure(bytes.byteLength===settings.sentinel.bytes.byteLength&&sha256(bytes)===settings.sentinel.sha256,'SENTINEL_INTEGRITY_MISMATCH');
    return receipt({status:'verified',resourceId:objectResourceId,sha256:settings.sentinel.sha256,bytes:bytes.byteLength});
  }
  /** @param {'create-bucket'|'upload'|'remove'|'recover'|'delete-bucket'} action */
  function operation(action){
    ensure(['create-bucket','upload','remove','recover','delete-bucket'].includes(action),'SENTINEL_ACTION_INVALID');let inspectedAt=0,attempted=false;
    return {
      async inspect(){await preflight();const b=await bucket();
        if(action==='create-bucket')ensure(b===null,'SENTINEL_BUCKET_FOREIGN');
        else {ensure(b,'SENTINEL_BUCKET_MISSING');owned(bucketResourceId);
          if(action==='delete-bucket'){const list=await client.storage.from(BUCKET).list('',{limit:2});ensure(!list.error&&list.data?.length===0,'SENTINEL_BUCKET_NOT_EMPTY');}
          else {const current=await read();ensure(current.status===(action==='remove'?'verified':'absent'),'SENTINEL_PRECONDITION_MISMATCH');if(action!=='upload')owned(objectResourceId);}}
        inspectedAt=Date.parse(now());return{status:'verified',action,resourceId:action.includes('bucket')?bucketResourceId:objectResourceId,evidenceSha256:evidence({action,projectRef:selected.ref,at:now(),sha256:settings.sentinel.sha256})};},
      async mutate(){ensure(inspectedAt>0&&Date.parse(now())-inspectedAt>=0&&Date.parse(now())-inspectedAt<=60000&&!attempted,'SENTINEL_INSPECTION_REQUIRED');attempted=true;
        try{let result;
          if(action==='create-bucket')result=await client.storage.createBucket(BUCKET,{public:false,fileSizeLimit:4096,allowedMimeTypes:['application/octet-stream']});
          else if(action==='delete-bucket')result=await client.storage.deleteBucket(BUCKET);
          else if(action==='remove')result=await client.storage.from(BUCKET).remove([settings.sentinel.path]);
          else result=await client.storage.from(BUCKET).upload(settings.sentinel.path,settings.sentinel.bytes,{upsert:false,contentType:'application/octet-stream'});
          ensure(!result.error,'SENTINEL_MUTATION_UNCERTAIN_READBACK_ONLY');
        }catch{throw new OperationsError('SENTINEL_MUTATION_UNCERTAIN_READBACK_ONLY');}},
      async readback(){if(action.includes('bucket')){const b=await bucket();ensure(action==='create-bucket'?b!==null:b===null,'SENTINEL_BUCKET_READBACK_MISMATCH');return receipt({status:b?'verified':'absent',resourceId:bucketResourceId});}
        const proof=await read();ensure(proof.status===(action==='remove'?'absent':'verified'),'SENTINEL_READBACK_MISMATCH');return proof;}
    };
  }
  async function readiness(){const body=await jsonRequest(fetchImpl,settings.readinessOrigin+'/api/operations/readiness',{headers:{Authorization:`Bearer ${settings.monitorToken}`}});
    ensure(body.schemaVersion===1&&Array.isArray(body.signals)&&body.signals.length===9,'SENTINEL_SIGNAL_UNAVAILABLE');
    const rows=body.signals.filter(/** @param {Record<string,any>} s */s=>s.signal==='storage');ensure(rows.length===1,'SENTINEL_SIGNAL_UNAVAILABLE');const s=rows[0];
    ensure(s.deploymentIdentity===m.candidate.sha&&s.environment==='development'&&typeof s.ok==='boolean'&&Math.abs(Date.parse(now())-Date.parse(s.checkedAt))<=120000&&
      (s.ok?s.severity==='none'&&s.reasonCode==='healthy':s.severity==='critical'&&s.reasonCode!=='healthy')&&UUID.test(s.correlationId)&&
      s.runbookAnchor==='docs/INCIDENT-RESPONSE.md#storage'&&['healthy','sentinel_unavailable','storage_integrity_mismatch','storage_processing_unhealthy'].includes(s.reasonCode),'SENTINEL_SIGNAL_IDENTITY_MISMATCH');
    const proof={signal:'storage',ok:s.ok,severity:s.severity,reasonCode:s.reasonCode,checkedAt:s.checkedAt,correlationId:s.correlationId,candidateSha:m.candidate.sha};
    return receipt(proof);
  }
  async function cleanupReadback(){await preflight();ensure(await bucket()===null,'SENTINEL_CLEANUP_INCOMPLETE');
    const object=await read();ensure(object.status==='absent','SENTINEL_CLEANUP_INCOMPLETE');
    return receipt({status:'absent',resourceIds:[bucketResourceId,objectResourceId]});}
  return {preflight,operation,read,readiness,identity,cleanupReadback,resourceIds:{bucket:bucketResourceId,object:objectResourceId}};
}

const ledgerQuerySchema=z.object({messageId:z.string().regex(UUID),from:z.iso.datetime(),to:z.iso.datetime()}).strict();
/** @typedef {z.infer<typeof ledgerQuerySchema>} LedgerQuery */
/** Real read-only SQL path for the existing private ledger. No Data API grant or schema widening.
 * @param {import('./logical-recovery.mjs').DatabaseOptions} options @param {LedgerQuery} input */
export async function readCanaryLedger(options,input){
  const parsed=ledgerQuerySchema.safeParse(input);ensure(parsed.success,'CANARY_LEDGER_QUERY_INVALID');const q=parsed.data;
  ensure(Date.parse(q.to)>=Date.parse(q.from)&&Date.parse(q.to)-Date.parse(q.from)<=900000,'CANARY_LEDGER_WINDOW_INVALID');
  assertRecoveryScope(options.scope);const tools=createPostgresToolchain(options);await tools.verifyVersions();const session=tools.session();
  try {
    await session.query("BEGIN READ ONLY; SET LOCAL statement_timeout = '5s';");
    // Validated UUID and RFC3339 strings cannot introduce SQL syntax. Query exact current canary only.
    const raw=await session.query(`select coalesce(json_agg(json_build_object('providerEventId',provider_event_id,'providerMessageId',provider_message_id,'eventType',event_type,'occurredAt',occurred_at,'receivedAt',received_at) order by occurred_at),'[]'::json) from private.resend_delivery_events where provider_message_id='${q.messageId}'::uuid and occurred_at>='${q.from}'::timestamptz and occurred_at<='${q.to}'::timestamptz;`);
    ensure(raw.length<=65536,'CANARY_LEDGER_RESPONSE_LIMIT');const rows=JSON.parse(raw);
    ensure(Array.isArray(rows)&&rows.length<=20,'CANARY_LEDGER_RESPONSE_INVALID');return rows;
  } catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('CANARY_LEDGER_READ_FAILED');}
  finally{await session.close();}
}
/** @typedef {ProjectSettings & {database:import('./logical-recovery.mjs').DatabaseOptions,resend:{apiKey:string,domainId:string,webhookId:string,from:string,to:string,operationId:string,windowStart:string,webhookOrigin:string,syntheticScopeEvidenceSha256:string,freePlanEvidence:{observedAt:string,remainingDaily:number,quotedCost:0,evidenceSha256:string}}}} CanarySettings */
/** @typedef {Options & {ledgerReader?:typeof readCanaryLedger}} CanaryOptions */
/** Controlled one-email journey. Success is provider delivered AND a signed-ingestion ledger event,
 * never internal sent/provider API acceptance. Unknown message ID after timeout remains readback-only.
 * @param {CanarySettings} settings @param {CanaryOptions} options */
export function createEmailCanaryAdapter(settings,options={}){
  const {selected,preflight,now,fetchImpl}=exactProject(settings,options),m=settings.manifest,c=settings.resend;
  ensure([c.domainId,c.webhookId,c.operationId].every(v=>UUID.test(v))&&z.email().safeParse(c.from).success&&z.email().safeParse(c.to).success&&
    /^re_[A-Za-z0-9_-]{16,256}$/u.test(c.apiKey)&&HASH.test(c.syntheticScopeEvidenceSha256)&&
    /^https:\/\/issue29-[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/u.test(c.webhookOrigin)&&c.webhookOrigin.includes(m.runId),'CANARY_PRIVATE_CONFIG_INVALID');
  ensure(settings.database.scope.projectRef===selected.ref&&settings.database.scope.runId===m.runId&&m.preservedRefs.every(ref=>settings.database.scope.preservedRefs.includes(ref)),'CANARY_DATABASE_SCOPE_MISMATCH');
  assertRecoveryScope(settings.database.scope);
  const headers={Authorization:`Bearer ${c.apiKey}`,'Content-Type':'application/json'},subject=`Aromatika synthetic canary ${m.runId} ${c.operationId}`;
  const ledgerReader=options.ledgerReader??readCanaryLedger;
  /** @param {string} path @param {RequestInit} [init] @param {boolean} [mutation] */
  const resend=(path,init={},mutation=false)=>jsonRequest(fetchImpl,'https://api.resend.com'+path,{...init,headers:{...headers,...init.headers}},mutation);
  /** @param {string} name @param {Record<string,unknown>} body */
  const rpc=(name,body)=>jsonRequest(fetchImpl,selected.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:settings.serviceKey,Authorization:`Bearer ${settings.serviceKey}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  async function inspect(){
    await preflight();const age=Date.parse(now())-Date.parse(c.windowStart),free=c.freePlanEvidence;
    ensure(age>=0&&age<=900000&&free.quotedCost===0&&Number.isSafeInteger(free.remainingDaily)&&free.remainingDaily>=1&&HASH.test(free.evidenceSha256)&&
      Date.parse(now())-Date.parse(free.observedAt)>=0&&Date.parse(now())-Date.parse(free.observedAt)<=3600000,'CANARY_FREE_WINDOW_UNPROVEN');
    const domain=await resend('/domains/'+c.domainId);ensure(domain.id===c.domainId&&domain.name===c.from.split('@')[1]&&domain.status==='verified'&&domain.capabilities?.sending==='enabled','CANARY_SENDER_UNVERIFIED');
    const webhook=await resend('/webhooks/'+c.webhookId);ensure(webhook.id===c.webhookId&&webhook.endpoint===c.webhookOrigin+'/api/webhooks/resend'&&webhook.status==='enabled'&&
      Array.isArray(webhook.events)&&webhook.events.includes('email.delivered'),'CANARY_WEBHOOK_SCOPE_UNPROVEN');
    return {status:'verified',projectRef:selected.ref,operationId:c.operationId,evidenceSha256:evidence({runId:m.runId,operationId:c.operationId,source:selected.ref,scope:c.syntheticScopeEvidenceSha256,at:now()})};
  }
  /** @param {string} messageId */
  async function readback(messageId){
    ensure(typeof messageId==='string'&&UUID.test(messageId),'CANARY_MESSAGE_ID_REQUIRED_READBACK_ONLY');
    const sent=await resend('/emails/'+messageId),end=now();
    ensure(Date.parse(end)-Date.parse(c.windowStart)>=0&&Date.parse(end)-Date.parse(c.windowStart)<=900000,'CANARY_DELIVERY_WINDOW_EXCEEDED');
    ensure(sent.id===messageId&&sent.from===c.from&&Array.isArray(sent.to)&&sent.to.length===1&&sent.to[0]===c.to&&sent.subject===subject&&
      Date.parse(sent.created_at)>=Date.parse(c.windowStart)&&Date.parse(sent.created_at)<=Date.parse(end)&&sent.last_event==='delivered','CANARY_DOWNSTREAM_DELIVERY_UNPROVEN');
    const rows=await ledgerReader(settings.database,{messageId,from:c.windowStart,to:end});
    ensure(rows.every(r=>r.providerMessageId===messageId&&/^msg_[A-Za-z0-9_-]{8,196}$/u.test(r.providerEventId)&&
      Date.parse(r.occurredAt)>=Date.parse(c.windowStart)&&Date.parse(r.occurredAt)<=Date.parse(end)&&Date.parse(r.receivedAt)>=Date.parse(c.windowStart)&&Date.parse(r.receivedAt)<=Date.parse(end)+300000),'CANARY_LEDGER_IDENTITY_MISMATCH');
    const delivered=rows.filter(r=>r.eventType==='email.delivered');
    ensure(delivered.length===1&&!rows.some(r=>['email.failed','email.bounced','email.complained','email.delivery_delayed'].includes(r.eventType)&&Date.parse(r.occurredAt)>=Date.parse(delivered[0]?.occurredAt)), 'CANARY_SIGNED_DELIVERY_UNPROVEN');
    const event=delivered[0];const proof={schemaVersion:1,projectRef:selected.ref,runId:m.runId,candidateSha:m.candidate.sha,operationId:c.operationId,
      providerMessageId:messageId,providerEventId:event.providerEventId,eventType:'email.delivered',deliveredAt:new Date(event.occurredAt).toISOString(),
      receivedAt:new Date(event.receivedAt).toISOString(),count:1,destinationAlias:'email-canary',verifiedAt:end};
    return {...proof,evidenceSha256:evidence(proof)};
  }
  function sendOperation(){let inspectedAt=0,attempted=false;
    /** @type {string|null} */
    let messageId=null;
    return {
      async inspect(){const proof=await inspect();inspectedAt=Date.parse(now());return proof;},
      async mutate(){ensure(inspectedAt>0&&Date.parse(now())-inspectedAt>=0&&Date.parse(now())-inspectedAt<=60000&&!attempted,'CANARY_INSPECTION_REQUIRED');attempted=true;
        const response=await resend('/emails',{method:'POST',headers:{'Idempotency-Key':`issue29/${m.runId}/${c.operationId}`},body:JSON.stringify({from:c.from,to:[c.to],subject,text:'Synthetic operational delivery proof only. No account, authentication, or recovery links.',tags:[{name:'issue29_run',value:m.runId},{name:'issue29_operation',value:c.operationId}]})},true);
        ensure(UUID.test(response.id),'CANARY_MESSAGE_ID_REQUIRED_READBACK_ONLY');messageId=response.id;
        return {status:'accepted',providerMessageId:messageId,operationId:c.operationId};},
      /** @param {string} [knownMessageId] */
      readback:(knownMessageId)=>readback(knownMessageId??messageId??'')
    };
  }
  /** Separate mutation so a mail-send ambiguity cannot overwrite a checkpoint intent.
   * @param {Awaited<ReturnType<typeof readback>>} delivered */
  function checkpointOperation(delivered){let inspectedAt=0,attempted=false;
    return {
      async inspect(){await preflight();const current=await readback(delivered.providerMessageId);ensure(current.providerEventId===delivered.providerEventId&&current.deliveredAt===delivered.deliveredAt,'CANARY_CHECKPOINT_EVIDENCE_MISMATCH');inspectedAt=Date.parse(now());return current;},
      async mutate(){ensure(inspectedAt>0&&Date.parse(now())-inspectedAt>=0&&Date.parse(now())-inspectedAt<=60000&&!attempted,'CANARY_INSPECTION_REQUIRED');attempted=true;
        try{await rpc('record_operations_checkpoint',{p_kind:'email_canary',p_deployment_identity:m.candidate.sha,p_checkpoint_at:delivered.deliveredAt,p_ok:true,p_evidence_sha256:delivered.evidenceSha256});}
        catch{throw new OperationsError('CANARY_CHECKPOINT_UNCERTAIN_READBACK_ONLY');}},
      async readback(){const snapshot=await rpc('get_operations_snapshot',{}),cp=snapshot?.checkpoints?.email_canary;
        ensure(cp?.deploymentIdentity===m.candidate.sha&&Date.parse(cp.checkpointAt)===Date.parse(delivered.deliveredAt)&&cp.ok===true&&cp.evidenceSha256===delivered.evidenceSha256,'CANARY_CHECKPOINT_READBACK_MISMATCH');
        return {status:'verified',projectRef:selected.ref,checkpointAt:delivered.deliveredAt,evidenceSha256:delivered.evidenceSha256};}
    };
  }
  return {inspect,sendOperation,readback,checkpointOperation};
}

/** @typedef {ReturnType<typeof createSentinelAdapter>} SentinelAdapter */
/** @typedef {import('./monitoring-proof.mjs').GrafanaAdapter} GrafanaAdapter */
/** @param {GrafanaAdapter} grafana @param {SentinelAdapter} sentinel */
function incidentIdentity(grafana,sentinel){
  const id=sentinel.identity(),config=grafana.configuration();
  ensure(id.restoreTarget && ['integrity_verified','incident_drill_verified'].includes(id.state),'INCIDENT_RESTORED_INTEGRITY_REQUIRED');
  ensure(id.runId===config.runId&&id.candidateSha===config.candidateSha&&id.targetOrigin===config.targetOrigin&&
    id.evidenceMode===config.evidenceMode&&config.runtimeEnvironment==='development','INCIDENT_MONITOR_TARGET_MISMATCH');
  return {id,config};
}
/** Captures an actual all-green baseline before the separately persisted sentinel deletion.
 * @param {GrafanaAdapter} grafana @param {SentinelAdapter} sentinel @param {{now?:string}} [options] */
export async function captureIncidentBaseline(grafana,sentinel,options={}){
  const {id,config}=incidentIdentity(grafana,sentinel),checkedAt=options.now??new Date().toISOString();
  await sentinel.preflight();const configuration=await grafana.verifyConfiguration(),object=await sentinel.read(),signal=await sentinel.readiness();
  ensure(object.status==='verified'&&signal.ok===true,'INCIDENT_BASELINE_UNHEALTHY');
  const rules=[];
  for(const rule of config.resources.filter(r=>r.kind==='rule')){
    const evaluation=await grafana.readEvaluation(rule.key),score=await grafana.readRuleScore(rule.key);
    ensure(evaluation.state==='inactive'&&score.score===0,'INCIDENT_BASELINE_UNHEALTHY');
    rules.push({ruleKey:rule.key,evaluation,score});
  }
  const body={schemaVersion:1,status:config.evidenceMode==='provider-readback'?'verified':'deterministic-only',evidenceMode:config.evidenceMode,
    runId:id.runId,candidateSha:id.candidateSha,projectRef:id.projectRef,configSha256:config.configSha256,checkedAt,
    configurationEvidenceSha256:configuration.evidenceSha256,object,signal,rules};
  return {...body,evidenceSha256:evidence(body)};
}
/** @typedef {{[key:string]:any,evidenceSha256:string,checkedAt:string}} IncidentReceipt */
/** @param {IncidentReceipt} receipt @param {ReturnType<SentinelAdapter['identity']>} identity @param {string} now */
function validateIncidentReceipt(receipt,identity,now){
  const {evidenceSha256,...body}=receipt;
  ensure(HASH.test(evidenceSha256)&&evidence(body)===evidenceSha256&&body.schemaVersion===1&&body.runId===identity.runId&&
    body.candidateSha===identity.candidateSha&&body.projectRef===identity.projectRef&&body.evidenceMode===identity.evidenceMode&&
    Date.parse(now)>=Date.parse(body.checkedAt)&&Date.parse(now)-Date.parse(body.checkedAt)<=7200000,'INCIDENT_RECEIPT_INVALID');
}
/** Mutation-free final drill verification: real notification identities are independently re-read,
 * and only the exact owned sentinel bucket/object may be reported absent. Human diagnostic and
 * private inbox evidence are explicit attestations, never inferred from provider acceptance.
 * @param {GrafanaAdapter} grafana @param {SentinelAdapter} sentinel
 * @param {{baseline:Awaited<ReturnType<typeof captureIncidentBaseline>>,removed:IncidentReceipt,recovered:IncidentReceipt,
 * failureSignal:IncidentReceipt,recoverySignal:IncidentReceipt,phases:import('./monitoring-proof.mjs').MonitoringPhase[],
 * acknowledgement:import('./monitoring-proof.mjs').Acknowledgement,containedAt:string,diagnosedAt:string,
 * rollbackDecision:{decision:'fixture-restore-only',decidedAt:string,evidenceSha256:string},runbookSha256:string,closedAt:string,now?:string}} input */
export async function verifyStorageIncident(grafana,sentinel,input){
  const {id,config}=incidentIdentity(grafana,sentinel),now=input.now??new Date().toISOString();
  for(const receipt of [input.baseline,input.removed,input.recovered,input.failureSignal,input.recoverySignal])validateIncidentReceipt(receipt,id,now);
  const b=input.baseline,keys=config.resources.filter(r=>r.kind==='rule').map(r=>r.key);
  ensure(b.configSha256===config.configSha256&&b.rules.length===keys.length&&new Set(b.rules.map(r=>r.ruleKey)).size===keys.length&&
    b.rules.every(r=>keys.includes(r.ruleKey)&&r.evaluation.ruleKey===r.ruleKey&&r.score.ruleKey===r.ruleKey&&
      r.evaluation.candidateSha===id.candidateSha&&r.score.candidateSha===id.candidateSha&&
      r.evaluation.configSha256===config.configSha256&&r.score.configSha256===config.configSha256&&
      r.evaluation.state==='inactive'&&r.score.score===0),'INCIDENT_BASELINE_INVALID');
  validateIncidentReceipt(b.object,id,now);validateIncidentReceipt(b.signal,id,now);
  ensure(b.object.status==='verified'&&'sha256' in b.object&&'bytes' in b.object&&b.object.sha256===id.sha256&&b.object.bytes===id.bytes&&b.signal.ok===true&&
    input.removed.resourceId===sentinel.resourceIds.object&&input.removed.status==='absent'&&
    input.recovered.resourceId===sentinel.resourceIds.object&&input.recovered.status==='verified'&&input.recovered.sha256===id.sha256&&input.recovered.bytes===id.bytes&&
    input.failureSignal.signal==='storage'&&input.failureSignal.ok===false&&['sentinel_unavailable','storage_integrity_mismatch'].includes(input.failureSignal.reasonCode)&&
    input.recoverySignal.signal==='storage'&&input.recoverySignal.ok===true&&input.recoverySignal.reasonCode==='healthy','INCIDENT_SENTINEL_SEQUENCE_INVALID');
  const ruleKey=keys.find(k=>k.endsWith('-storage'));ensure(ruleKey,'INCIDENT_STORAGE_RULE_MISSING');
  ensure(input.phases.length===2&&input.phases.every(p=>p.ruleKey===ruleKey),'INCIDENT_STORAGE_RULE_MISSING');
  await grafana.verifyConfiguration();
  const timeline=await verifyMonitoringRuleJourney(grafana,{ruleKey,phases:input.phases,acknowledgements:[input.acknowledgement],now});
  const failure=input.phases.find(p=>p.phase==='failure'),recovery=input.phases.find(p=>p.phase==='recovery');
  ensure(failure&&recovery&&Date.parse(failure.windowStart)>=Date.parse(input.removed.checkedAt)&&
    Date.parse(recovery.windowStart)>=Date.parse(input.recovered.checkedAt),'INCIDENT_PHASE_PRECEDES_MUTATION');
  const times=[b.checkedAt,input.removed.checkedAt,input.failureSignal.checkedAt,timeline.firedAt,timeline.deliveredAt,timeline.acknowledgedAt,
    input.containedAt,input.diagnosedAt,input.rollbackDecision.decidedAt,input.recovered.checkedAt,input.recoverySignal.checkedAt,timeline.recoveryDeliveredAt,input.closedAt,now];
  ensure(times.every((time,index)=>typeof time==='string'&&Number.isFinite(Date.parse(time))&&(index===0||Date.parse(time)>=Date.parse(/** @type {string} */(times[index-1]))))&&
    input.rollbackDecision.decision==='fixture-restore-only'&&HASH.test(input.rollbackDecision.evidenceSha256)&&HASH.test(input.runbookSha256),'INCIDENT_TIMELINE_INVALID');
  const cleanup=await sentinel.cleanupReadback();
  const body={schemaVersion:1,status:config.evidenceMode==='provider-readback'?'verified':'deterministic-only',evidenceMode:config.evidenceMode,runId:id.runId,
    candidateSha:id.candidateSha,projectRef:id.projectRef,configSha256:config.configSha256,
    startedAt:b.checkedAt,mutationReadBackAt:input.removed.checkedAt,detectedAt:input.failureSignal.checkedAt,...timeline,
    containedAt:input.containedAt,diagnosedAt:input.diagnosedAt,rollbackDecision:input.rollbackDecision,recoveredAt:input.recovered.checkedAt,
    closedAt:input.closedAt,verifiedAt:now,runbookSha256:input.runbookSha256,cleanup,
    evidenceHashes:[b,input.removed,input.failureSignal,input.recovered,input.recoverySignal,...input.phases].map(r=>r.evidenceSha256)};
  return {...body,evidenceSha256:evidence(body)};
}
