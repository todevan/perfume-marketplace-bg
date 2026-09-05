import { describe, expect, it } from 'vitest';
import { createSentinelAdapter } from '../../scripts/issue29-operations/incident-adapter.mjs';
import { manifestFixture } from '../fixtures/issue29-operations';
import { createHash } from 'node:crypto';
const now='2026-09-05T12:00:00.000Z';
const bytes=Buffer.from('Issue 29 private synthetic sentinel\n');
const sha256=createHash('sha256').update(bytes).digest('hex');
function settings() {const m=manifestFixture();return{manifest:m,projectRef:m.source!.ref,providerToken:'private-provider-token',serviceKey:'private-service-key',
  sentinel:{path:`${m.runId}/sentinel.bin`,sha256,bytes},readinessOrigin:`https://issue29-${m.runId}.owner.workers.dev`,monitorToken:'dedicated-monitor-token-12345678901234'};}
describe('Issue29 exact sentinel transaction',()=>{
  it('rejects preserved project and wrong path before any Storage or provider action',()=>{
    const s=settings();s.manifest.preservedRefs.push(s.projectRef);let calls=0;
    expect(()=>createSentinelAdapter(s,{now:()=>now,fetchImpl:async()=>{calls++;return new Response();}})).toThrow('PRESERVED_PROJECT_FORBIDDEN');
    expect(calls).toBe(0);
  });
});
function ownedSettings(){const s=settings();s.manifest.target=null;s.manifest.cleanup.resources.push({provider:'supabase',id:s.projectRef,runId:s.manifest.runId,createdAt:now,evidenceSha256:'e'.repeat(64),disposition:'disposable',absentAt:null});return s;}
function storageFixture(s:ReturnType<typeof ownedSettings>){
  let bucket:Record<string,unknown>|null=null,object:Uint8Array|null=null,foreign=false,failDelete=false;
  const mutations:{method:string;path:string;body:unknown;headers:Headers}[]=[];
  const fetchImpl:typeof fetch=async(url,init)=>{const u=new URL(String(url)),method=init?.method??'GET';
    if(u.hostname==='api.supabase.com'){
      if(u.pathname.includes('/organizations/'))return Response.json({id:'owned-org',plan:'free'});
      if(u.pathname.endsWith('/api-keys'))return Response.json([{name:'service_role',api_key:s.serviceKey}]);
      return Response.json({ref:s.projectRef,organization_slug:'owned-org',region:'eu-central-1',status:'ACTIVE_HEALTHY',database:{version:'17.6.1'}});
    }
    const body=typeof init?.body==='string'?JSON.parse(init.body):init?.body;
    if(method!=='GET')mutations.push({method,path:u.pathname,body,headers:new Headers(init?.headers)});
    if(u.pathname==='/storage/v1/bucket'&&method==='POST'){bucket={id:'operations-sentinels',name:'operations-sentinels',public:false};return Response.json({name:'operations-sentinels'});}
    if(u.pathname==='/storage/v1/bucket/operations-sentinels'){
      if(method==='DELETE'){bucket=null;return Response.json({message:'deleted'});}
      return bucket?Response.json(bucket):Response.json({message:'not found',statusCode:'404',error:'Not Found'},{status:404});
    }
    if(u.pathname.includes('/object/list/'))return Response.json(foreign?[{name:'foreign',id:'unknown'}]:object?[{name:s.manifest.runId,id:null}]:[]);
    if(u.pathname==='/storage/v1/object/operations-sentinels'&&method==='DELETE'){object=null;if(failDelete){failDelete=false;throw new Error('provider private error');}return Response.json([]);}
    if(method==='POST'&&u.pathname.startsWith('/storage/v1/object/')){object=new Uint8Array(init?.body as Uint8Array);return Response.json({Key:'private-object',Id:'private-object-id'});}
    if(u.pathname.startsWith('/storage/v1/object/'))return object?new Response(Uint8Array.from(object)):Response.json({message:'not found',statusCode:'404',error:'Not Found'},{status:404});
    return new Response(null,{status:404});
  };
  return {fetchImpl,mutations,setForeign:()=>{foreign=true;},failDelete:()=>{failDelete=true;},setCorrupt:()=>{object=Buffer.from('bad');}};
}
function own(s:ReturnType<typeof ownedSettings>,id:string){s.manifest.cleanup.resources.push({provider:'supabase-storage',id,runId:s.manifest.runId,createdAt:now,evidenceSha256:'f'.repeat(64),disposition:'disposable',absentAt:null});}

it('creates one private owned bucket/sentinel, removes exactly that path, recovers without upsert and proves absence',async()=>{
  const s=ownedSettings(),fixture=storageFixture(s),adapter=createSentinelAdapter(s,{now:()=>now,fetchImpl:fixture.fetchImpl});
  const bucket=adapter.operation('create-bucket');await bucket.inspect();await bucket.mutate();expect(await bucket.readback()).toMatchObject({status:'verified'});own(s,adapter.resourceIds.bucket);
  const upload=adapter.operation('upload');await upload.inspect();await upload.mutate();expect(await upload.readback()).toMatchObject({status:'verified',sha256});own(s,adapter.resourceIds.object);
  const remove=adapter.operation('remove');await remove.inspect();await remove.mutate();expect(await remove.readback()).toMatchObject({status:'absent'});
  const deletion=fixture.mutations.find(x=>x.method==='DELETE');expect(deletion?.body).toEqual({prefixes:[`${s.manifest.runId}/sentinel.bin`]});
  const recover=adapter.operation('recover');await recover.inspect();await recover.mutate();expect(await recover.readback()).toMatchObject({status:'verified',sha256});
  expect(fixture.mutations.filter(x=>x.path.includes('/object/')&&x.method==='POST'&&!x.path.includes('/list/')).every(x=>x.headers.get('x-upsert')==='false')).toBe(true);
  const cleanupObject=adapter.operation('remove');await cleanupObject.inspect();await cleanupObject.mutate();await cleanupObject.readback();
  const cleanupBucket=adapter.operation('delete-bucket');await cleanupBucket.inspect();await cleanupBucket.mutate();expect(await cleanupBucket.readback()).toMatchObject({status:'absent'});
});
it('does not retry an ambiguous sentinel deletion and refuses unknown bucket content or a corrupt fixture',async()=>{
  const s=ownedSettings(),fixture=storageFixture(s),a=createSentinelAdapter(s,{now:()=>now,fetchImpl:fixture.fetchImpl});
  const bucket=a.operation('create-bucket');await bucket.inspect();await bucket.mutate();await bucket.readback();own(s,a.resourceIds.bucket);
  const upload=a.operation('upload');await upload.inspect();await upload.mutate();await upload.readback();own(s,a.resourceIds.object);
  const remove=a.operation('remove');await remove.inspect();fixture.failDelete();await expect(remove.mutate()).rejects.toThrow('SENTINEL_MUTATION_UNCERTAIN_READBACK_ONLY');
  expect(await a.operation('remove').readback()).toMatchObject({status:'absent'});
  await expect(remove.mutate()).rejects.toThrow('SENTINEL_INSPECTION_REQUIRED');
  fixture.setForeign();await expect(a.operation('delete-bucket').inspect()).rejects.toThrow('SENTINEL_BUCKET_NOT_EMPTY');
  fixture.setCorrupt();await expect(a.read()).rejects.toThrow('SENTINEL_INTEGRITY_MISMATCH');
  expect(()=>createSentinelAdapter({...s,sentinel:{...s.sentinel,path:'foreign/sentinel.bin'}},{now:()=>now})).toThrow('SENTINEL_FIXTURE_INVALID');
});

import { createEmailCanaryAdapter } from '../../scripts/issue29-operations/incident-adapter.mjs';
import { handleResendWebhook } from '../../src/lib/server/operations/resend-webhook';
import { createHmac } from 'node:crypto';
it('requires an actual signed downstream delivered event, not provider acceptance or a sent event',async()=>{
  const s=ownedSettings(),sourceFixture=storageFixture(s),time='2026-09-05T12:01:00.000Z',messageId='4ef9a417-02e9-4d39-ad75-9611e0fcc33c';
  const resend={apiKey:'re_privatefixtureapikey123456789',domainId:'d91cd9bd-1176-453e-8fc1-35364d380206',webhookId:'4dd369bc-aa82-4ff3-97de-514ae3000ee0',
    from:'canary@example.test',to:'private-canary@example.test',operationId:'21212121-2121-4212-8212-212121212121',windowStart:now,
    webhookOrigin:s.readinessOrigin,syntheticScopeEvidenceSha256:'a'.repeat(64),freePlanEvidence:{observedAt:now,remainingDaily:5,quotedCost:0 as const,evidenceSha256:'b'.repeat(64)}};
  const database={scope:{mode:'hosted' as const,role:'source' as const,runId:s.manifest.runId,projectRef:s.projectRef,sourceRef:s.projectRef,preservedRefs:s.manifest.preservedRefs,createdResourceEvidenceSha256:'e'.repeat(64),apiUrl:s.manifest.source!.url},
    connection:{host:`db.${s.projectRef}.supabase.co`,port:5432,user:'postgres',database:'postgres',password:'private-db-secret',sslmode:'verify-full' as const},toolchain:{mode:'container' as const}};
  let sends=0,lastEvent='sent';const rows:Record<string,string>[]=[];let checkpoint:Record<string,unknown>|null=null;
  const fetchImpl:typeof fetch=async(url,init)=>{
    const u=new URL(String(url));
    if(u.hostname==='api.resend.com'){
      if(u.pathname.startsWith('/domains/'))return Response.json({id:resend.domainId,name:'example.test',status:'verified',capabilities:{sending:'enabled'}});
      if(u.pathname.startsWith('/webhooks/'))return Response.json({id:resend.webhookId,endpoint:s.readinessOrigin+'/api/webhooks/resend',status:'enabled',events:['email.delivered'],signing_secret:'private-signing-key'});
      if(u.pathname==='/emails'){sends++;expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(`issue29/${s.manifest.runId}/${resend.operationId}`);return Response.json({id:messageId});}
      return Response.json({id:messageId,from:resend.from,to:[resend.to],subject:`Aromatika synthetic canary ${s.manifest.runId} ${resend.operationId}`,created_at:now,last_event:lastEvent,html:'must not escape'});
    }
    if(u.pathname.endsWith('/record_operations_checkpoint')){const b=JSON.parse(String(init?.body));checkpoint={deploymentIdentity:b.p_deployment_identity,checkpointAt:b.p_checkpoint_at,ok:b.p_ok,evidenceSha256:b.p_evidence_sha256};return Response.json(null);}
    if(u.pathname.endsWith('/get_operations_snapshot'))return Response.json({checkpoints:{email_canary:checkpoint}});
    return sourceFixture.fetchImpl(url,init);
  };
  const a=createEmailCanaryAdapter({...s,resend,database},{now:()=>time,fetchImpl,ledgerReader:async()=>rows}),op=a.sendOperation();
  await op.inspect();expect(await op.mutate()).toMatchObject({status:'accepted',providerMessageId:messageId});
  await expect(op.readback()).rejects.toThrow('CANARY_DOWNSTREAM_DELIVERY_UNPROVEN');lastEvent='delivered';
  await expect(op.readback()).rejects.toThrow('CANARY_SIGNED_DELIVERY_UNPROVEN');
  const secret='whsec_'+Buffer.from('private-signing-material-123456789').toString('base64'),providerEventId='msg_signedcanaryevent1234',timestamp=String(Date.parse(time)/1000);
  const body=JSON.stringify({type:'email.delivered',created_at:'2026-09-05T12:00:30.000Z',data:{email_id:messageId,to:[resend.to],subject:'must not persist'}});
  const signature=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${providerEventId}.${timestamp}.${body}`).digest('base64');
  const response=await handleResendWebhook(new Request(s.readinessOrigin+'/api/webhooks/resend',{method:'POST',headers:{'content-type':'application/json','svix-id':providerEventId,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature},body}),
    {secret,now:()=>Date.parse(time),append:async(event)=>{rows.push({...event,receivedAt:time});}});
  expect(response.status).toBe(200);const delivered=await op.readback();expect(delivered).toMatchObject({providerMessageId:messageId,providerEventId,eventType:'email.delivered',count:1});
  expect(JSON.stringify(delivered)).not.toMatch(/private-canary|must not|example.test|private-signing/);
  const cp=a.checkpointOperation(delivered);await cp.inspect();await cp.mutate();expect(await cp.readback()).toMatchObject({status:'verified',checkpointAt:'2026-09-05T12:00:30.000Z'});
  await expect(op.mutate()).rejects.toThrow('CANARY_INSPECTION_REQUIRED');expect(sends).toBe(1);
  await expect(a.readback('')).rejects.toThrow('CANARY_MESSAGE_ID_REQUIRED_READBACK_ONLY');
});

import { captureIncidentBaseline, verifyStorageIncident } from '../../scripts/issue29-operations/incident-adapter.mjs';
import { createGrafanaAdapter } from '../../scripts/issue29-operations/grafana-adapter.mjs';
import { captureMonitoringPhase } from '../../scripts/issue29-operations/monitoring-proof.mjs';
import { monitoringConfig, providerFixture } from '../fixtures/issue29-grafana';
it('requires a restored target and re-reads exact delivered/recovered notifications and sentinel absence for the drill',async()=>{
  const s=settings();s.projectRef=s.manifest.target!.ref;s.manifest.state='integrity_verified';
  s.manifest.cleanup.resources.push({provider:'supabase',id:s.projectRef,runId:s.manifest.runId,createdAt:now,evidenceSha256:'e'.repeat(64),disposition:'disposable',absentAt:null});
  const storage=storageFixture(s),config={...monitoringConfig,runId:s.manifest.runId,targetOrigin:s.readinessOrigin,runtimeEnvironment:'development' as const};
  const grafana=providerFixture({},config);let current=now,phase='green',healthy=true;
  const fetchImpl:typeof fetch=async(url,init)=>{const u=new URL(String(url));
    if(u.pathname==='/api/prometheus/grafana/api/v1/rules')return Response.json({status:'success',data:{groups:[{rules:[...grafana.stored.values()].filter(r=>r.ruleGroup).map(r=>({
      uid:r.uid,folderUid:config.folderUid,health:'ok',isPaused:false,state:phase==='failure'?'firing':'inactive',lastEvaluation:current,
      activeAt:phase==='failure'?'2026-09-05T12:20:00.000Z':null,labels:r.labels}))}]}});
    if(u.pathname==='/api/prom/api/v1/query')return Response.json({status:'success',data:{resultType:'vector',result:[{metric:{},value:[Date.parse(current)/1000,phase==='failure'?'2':'0']}]}});
    if(u.hostname.endsWith('.grafana.net')||u.hostname==='grafana.com')return grafana.fetchImpl(url,init);
    if(u.hostname.endsWith('.workers.dev'))return Response.json({schemaVersion:1,signals:['health','auth','database','storage','email','deals','safety','backup_freshness','monitor_heartbeat'].map(signal=>({
      signal,ok:signal!=='storage'||healthy,severity:signal==='storage'&&!healthy?'critical':'none',reasonCode:signal==='storage'&&!healthy?'sentinel_unavailable':'healthy',checkedAt:current,
      deploymentIdentity:s.manifest.candidate.sha,environment:'development',correlationId:'45454545-4545-4454-8454-454545454545',runbookAnchor:`docs/INCIDENT-RESPONSE.md#${signal.replaceAll('_','-')}`}))});
    return storage.fetchImpl(url,init);
  };
  const g=createGrafanaAdapter(config,{now:()=>current,fetchImpl}),a=createSentinelAdapter(s,{now:()=>current,fetchImpl});
  for(const r of g.configuration().resources){const op=g.resourceOperation(r.key);await op.inspect();await op.mutate();}
  const bucket=a.operation('create-bucket');await bucket.inspect();await bucket.mutate();await bucket.readback();own(s,a.resourceIds.bucket);
  const upload=a.operation('upload');await upload.inspect();await upload.mutate();await upload.readback();own(s,a.resourceIds.object);
  const baseline=await captureIncidentBaseline(g,a,{now:current});
  expect(baseline).toMatchObject({status:'deterministic-only',projectRef:s.projectRef});
  current='2026-09-05T12:01:00.000Z';const remove=a.operation('remove');await remove.inspect();await remove.mutate();const removed=await remove.readback();healthy=false;
  current='2026-09-05T12:02:00.000Z';const failureSignal=await a.readiness();
  const rule=[...grafana.stored.values()].find(r=>r.uid?.endsWith('-storage'))!;
  grafana.setEvents(['firing','resolved'].map(status=>({uuid:`incident-${status}`,timestamp:status==='firing'?'2026-09-05T12:20:10.000Z':'2026-09-05T12:42:10.000Z',receiver:rule.notification_settings.receiver,
    integration:'email',integrationIndex:0,status,outcome:'success',ruleUIDs:[rule.uid],groupLabels:rule.labels})));
  current='2026-09-05T12:21:00.000Z';phase='failure';const failure=await captureMonitoringPhase(g,{ruleKey:rule.uid,phase:'failure',windowStart:removed.checkedAt,now:current});
  current='2026-09-05T12:22:00.000Z';const recover=a.operation('recover');await recover.inspect();await recover.mutate();const recovered=await recover.readback();healthy=true;const recoverySignal=await a.readiness();
  current='2026-09-05T12:43:00.000Z';phase='recovery';const recovery=await captureMonitoringPhase(g,{ruleKey:rule.uid,phase:'recovery',windowStart:recovered.checkedAt,now:current});
  current='2026-09-05T12:44:00.000Z';const clean=a.operation('remove');await clean.inspect();await clean.mutate();await clean.readback();
  const cleanBucket=a.operation('delete-bucket');await cleanBucket.inspect();await cleanBucket.mutate();await cleanBucket.readback();
  const input={baseline,removed,recovered,failureSignal,recoverySignal,phases:[failure,recovery] as Parameters<typeof verifyStorageIncident>[2]['phases'],
    acknowledgement:{ruleKey:rule.uid,failureEventId:'incident-firing',acknowledgedAt:'2026-09-05T12:21:10.000Z',roleAlias:'owner' as const,inboxEvidenceSha256:'e'.repeat(64)},
    containedAt:'2026-09-05T12:21:20.000Z',diagnosedAt:'2026-09-05T12:21:30.000Z',rollbackDecision:{decision:'fixture-restore-only' as const,decidedAt:'2026-09-05T12:21:35.000Z',evidenceSha256:'c'.repeat(64)},
    runbookSha256:'b'.repeat(64),closedAt:current,now:current};
  const proof=await verifyStorageIncident(g,a,input);
  expect(proof).toMatchObject({status:'deterministic-only',recoveredAt:'2026-09-05T12:22:00.000Z',recoveryDeliveredAt:'2026-09-05T12:42:10.000Z',cleanup:{status:'absent'}});
  expect(JSON.stringify(proof)).not.toMatch(/sentinel.bin|private-owner|private-token/);
  await expect(verifyStorageIncident(g,a,{...input,recovered:{...recovered,sha256:'f'.repeat(64)}})).rejects.toThrow('INCIDENT_RECEIPT_INVALID');
  await expect(verifyStorageIncident(g,a,{...input,acknowledgement:{...input.acknowledgement,failureEventId:'unrelated'}})).rejects.toThrow('MONITORING_ACKNOWLEDGEMENT_INVALID');
  s.manifest.state='database_restored';await expect(captureIncidentBaseline(g,a,{now:current})).rejects.toThrow('INCIDENT_RESTORED_INTEGRITY_REQUIRED');
});
