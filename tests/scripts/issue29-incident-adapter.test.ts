import { describe, expect, it } from 'vitest';
import { createSentinelAdapter } from '../../scripts/issue29-operations/incident-adapter.mjs';
import { manifestFixture, target } from '../fixtures/issue29-operations';
import { createHash } from 'node:crypto';
const now='2026-09-05T12:00:00.000Z';
const bytes=Buffer.from('Issue 29 private synthetic sentinel\n');
const sha256=createHash('sha256').update(bytes).digest('hex');
function settings() {const m=manifestFixture();return{manifest:m,projectRef:m.source!.ref,providerToken:'private-provider-token',serviceKey:'private-service-key',
  sentinel:{path:`${m.runId}/sentinel.bin`,sha256,bytes},readinessOrigin:`https://issue29-${m.runId}.owner.workers.dev`,monitorToken:'dedicated-monitor-token-12345678901234567890123456'};}
describe('Issue29 exact sentinel transaction',()=>{
  it('rejects preserved project and wrong path before any Storage or provider action',()=>{
    const s=settings();s.manifest.preservedRefs.push(s.projectRef);let calls=0;
    expect(()=>createSentinelAdapter(s,{now:()=>now,fetchImpl:async()=>{calls++;return new Response();}})).toThrow('PRESERVED_PROJECT_FORBIDDEN');
    expect(calls).toBe(0);
  });
});
function ownedSettings(){const s=settings();s.manifest.target=null;s.manifest.cleanup.resources.push({provider:'supabase',id:s.projectRef,runId:s.manifest.runId,createdAt:now,evidenceSha256:'e'.repeat(64),disposition:'persistent',absentAt:null});return s;}
function targetSettings(){const s=ownedSettings();s.manifest.target=structuredClone(target);s.projectRef=target.ref;s.readinessOrigin=`https://issue29-restore-${s.manifest.runId}.owner.workers.dev`;s.manifest.cleanup.resources.push({provider:'supabase',id:target.ref,runId:s.manifest.runId,createdAt:now,evidenceSha256:'e'.repeat(64),disposition:'disposable',absentAt:null});return s;}
function storageFixture(s:ReturnType<typeof ownedSettings>,initialBucket=false){
  let bucket:Record<string,unknown>|null=initialBucket?{id:'operations-sentinels',name:'operations-sentinels',public:false}:null,object:Uint8Array|null=null,foreign=false,failDelete=false;
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
function own(s:ReturnType<typeof ownedSettings>,id:string){s.manifest.cleanup.resources.push({provider:'supabase-storage',id,runId:s.manifest.runId,createdAt:now,evidenceSha256:'f'.repeat(64),disposition:s.projectRef===s.manifest.source?.ref?'persistent':'disposable',absentAt:null});}

it('creates one private owned bucket/sentinel, removes exactly that path, recovers without upsert and proves absence',async()=>{
  const s=targetSettings(),fixture=storageFixture(s),adapter=createSentinelAdapter(s,{now:()=>now,fetchImpl:fixture.fetchImpl});
  const bucket=adapter.operation('create-bucket');await bucket.inspect();await bucket.mutate();expect(await bucket.readback()).toMatchObject({status:'verified'});own(s,adapter.resourceIds.bucket);
  const upload=adapter.operation('upload');await upload.inspect();await upload.mutate();expect(await upload.readback()).toMatchObject({status:'verified',sha256});own(s,adapter.resourceIds.object);
  const remove=adapter.operation('remove');await remove.inspect();await remove.mutate();expect(await remove.readback()).toMatchObject({status:'absent'});
  const deletion=fixture.mutations.find(x=>x.method==='DELETE');expect(deletion?.body).toEqual({prefixes:[`${s.manifest.runId}/sentinel.bin`]});
  const recover=adapter.operation('recover');await recover.inspect();await recover.mutate();expect(await recover.readback()).toMatchObject({status:'verified',sha256});
  expect(fixture.mutations.filter(x=>x.path.includes('/object/')&&x.method==='POST'&&!x.path.includes('/list/')).every(x=>x.headers.get('x-upsert')==='false')).toBe(true);
  const cleanupObject=adapter.operation('remove');await cleanupObject.inspect();await cleanupObject.mutate();await cleanupObject.readback();
  const cleanupBucket=adapter.operation('delete-bucket');await cleanupBucket.inspect();await cleanupBucket.mutate();expect(await cleanupBucket.readback()).toMatchObject({status:'absent'});
});
it('allows an exact restore-owned target sentinel bucket to receive its sentinel, but refuses an unproven existing bucket',async()=>{
  const restored=targetSettings(),restoredFixture=storageFixture(restored,true),restoredAdapter=createSentinelAdapter(restored,{now:()=>now,fetchImpl:restoredFixture.fetchImpl});
  own(restored,restoredAdapter.resourceIds.bucket);
  const upload=restoredAdapter.operation('upload');await upload.inspect();await upload.mutate();expect(await upload.readback()).toMatchObject({status:'verified',sha256});
  const foreign=targetSettings(),foreignFixture=storageFixture(foreign,true),foreignAdapter=createSentinelAdapter(foreign,{now:()=>now,fetchImpl:foreignFixture.fetchImpl});
  await expect(foreignAdapter.operation('upload').inspect()).rejects.toThrow('SENTINEL_RESOURCE_NOT_OWNED');
  await expect(foreignAdapter.operation('create-bucket').inspect()).rejects.toThrow('SENTINEL_BUCKET_FOREIGN');
});
it('does not retry an ambiguous sentinel deletion and refuses unknown bucket content or a corrupt fixture',async()=>{
  const s=targetSettings(),fixture=storageFixture(s),a=createSentinelAdapter(s,{now:()=>now,fetchImpl:fixture.fetchImpl});
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
  const resend={apiKey:'re_privatefixtureapikey123456789',senderMode:'resend-account-test' as const,webhookId:'4dd369bc-aa82-4ff3-97de-514ae3000ee0',
    from:'onboarding@resend.dev' as const,to:'private-canary@example.test',operationId:'21212121-2121-4212-8212-212121212121',windowStart:now,
    webhookOrigin:s.readinessOrigin,syntheticScopeEvidenceSha256:'a'.repeat(64),freePlanEvidence:{observedAt:now,remainingDaily:5,quotedCost:0 as const,evidenceSha256:'b'.repeat(64)}};
  const database={scope:{mode:'hosted' as const,role:'source' as const,runId:s.manifest.runId,projectRef:s.projectRef,sourceRef:s.projectRef,preservedRefs:s.manifest.preservedRefs,createdResourceEvidenceSha256:'e'.repeat(64),apiUrl:s.manifest.source!.url},
    connection:{host:`db.${s.projectRef}.supabase.co`,port:5432,user:'postgres',database:'postgres',password:'private-db-secret',sslmode:'verify-full' as const},toolchain:{mode:'container' as const}};
  let sends=0,lastEvent='sent';const rows:Record<string,string>[]=[];let checkpoint:Record<string,unknown>|null=null;
  const fetchImpl:typeof fetch=async(url,init)=>{
    const u=new URL(String(url));
    if(u.hostname==='api.resend.com'){
      if(u.pathname.startsWith('/domains/'))throw new Error('obsolete Resend domain lookup');
      if(u.pathname.startsWith('/webhooks/'))return Response.json({id:resend.webhookId,endpoint:s.readinessOrigin+'/api/webhooks/resend',status:'enabled',events:['email.delivered'],signing_secret:'private-signing-key'});
      if(u.pathname==='/emails'){sends++;expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(`issue29/${s.manifest.runId}/${resend.operationId}`);return Response.json({id:messageId});}
      return Response.json({id:messageId,from:resend.from,to:[resend.to],subject:`Aromatika synthetic canary ${s.manifest.runId} ${resend.operationId}`,created_at:now,last_event:lastEvent,html:'must not escape'});
    }
    if(u.pathname.endsWith('/record_operations_checkpoint')){const b=JSON.parse(String(init?.body));checkpoint={deploymentIdentity:b.p_deployment_identity,checkpointAt:b.p_checkpoint_at,ok:b.p_ok,evidenceSha256:b.p_evidence_sha256};return Response.json(null);}
    if(u.pathname.endsWith('/get_operations_snapshot'))return Response.json({checkpoints:{email_canary:checkpoint}});
    return sourceFixture.fetchImpl(url,init);
  };
  expect(()=>createEmailCanaryAdapter({...s,resend:{...resend,senderMode:'domain-verified'} as any,database},{now:()=>time,fetchImpl,ledgerReader:async()=>rows})).toThrow('CANARY_PRIVATE_CONFIG_INVALID');
  expect(()=>createEmailCanaryAdapter({...s,resend:{...resend,from:'canary@example.test'} as any,database},{now:()=>time,fetchImpl,ledgerReader:async()=>rows})).toThrow('CANARY_PRIVATE_CONFIG_INVALID');
  expect(()=>createEmailCanaryAdapter({...s,resend:{...resend,to:'simulator@resend.dev'},database},{now:()=>time,fetchImpl,ledgerReader:async()=>rows})).toThrow('CANARY_PRIVATE_CONFIG_INVALID');
  expect(()=>createEmailCanaryAdapter({...s,resend:{...resend,domainId:'d91cd9bd-1176-453e-8fc1-35364d380206'} as any,database},{now:()=>time,fetchImpl,ledgerReader:async()=>rows})).toThrow('CANARY_PRIVATE_CONFIG_INVALID');
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
import { createMonitorAdapter, MONITOR_SIGNALS } from '../../scripts/issue29-operations/monitor-adapter.mjs';
import { captureMonitoringPhase } from '../../scripts/issue29-operations/monitoring-proof.mjs';
it('requires a restored target and re-reads exact delivered/recovered notifications and sentinel absence for the drill',async()=>{
  const s=targetSettings();s.manifest.state='integrity_verified';
  const storage=storageFixture(s),sourceOrigin='https://issue29-source.owner.workers.dev',config={workerAlias:'aromatika-issue29-monitor',origin:'https://aromatika-issue29-monitor.owner.workers.dev',targetOrigin:sourceOrigin,targetProbeOrigin:s.readinessOrigin,targetRole:'target' as const,targetCycleId:s.manifest.runId,environmentAlias:'synthetic-recovery',runtimeEnvironment:'development' as const,candidateSha:s.manifest.candidate.sha,runId:s.manifest.runId,configSha256:'f'.repeat(64),webhookSigningSecretSha256:'0badb513f9e2c6f69084754fbf2bae5f0b1aed5247b16bff099dfb213881f9cd',evidenceReadToken:'e'.repeat(43),watchdogToken:'w'.repeat(43),backupCheckpointToken:'b'.repeat(43),maintenanceToken:'m'.repeat(43)};
  let current=now,healthy=true;const incidentId='45454545-4545-4454-8454-454545454545';
  const fetchImpl:typeof fetch=async(url,init)=>{const u=new URL(String(url));
    if(u.origin===config.origin&&u.pathname==='/ops/monitor/config')return Response.json({schemaVersion:1,environment:config.environmentAlias,runtimeEnvironment:'development',targetOrigin:sourceOrigin,release:config.candidateSha,signalFamilies:MONITOR_SIGNALS,scheduleMinutes:10,configSha256:config.configSha256,webhookSigningSecretSha256:config.webhookSigningSecretSha256});
    if(u.origin===config.origin&&u.pathname==='/ops/monitor/state')return Response.json({schemaVersion:1,environment:config.environmentAlias,release:config.candidateSha,observedTargetOrigin:s.readinessOrigin,lastSuccessfulMonitorCycleAt:current,lastCompletedMonitorCycleAt:current,latestTrustedBackupCheckpointAt:'2026-09-05T11:59:00.000Z',latestTrustedBackupDescriptorSha256:'a'.repeat(64),latestTrustedBackupArtifactSha256:'b'.repeat(64),integrityFailureEvidenceSha256:null,maintenance:{active:true,endsAt:'2026-09-05T13:00:00.000Z',incidentId,target:{origin:s.readinessOrigin,runtimeEnvironment:'development',release:config.candidateSha}},signals:MONITOR_SIGNALS.map(signal=>({signal,ok:signal!=='storage'||healthy,severity:signal==='storage'&&!healthy?'critical':'none',reasonCode:signal==='storage'&&!healthy?'sentinel_unavailable':'healthy',checkedAt:current,...(signal==='storage'?{incidentId}:{})}))});
    if(u.origin===config.origin&&u.pathname==='/ops/monitor/events'){const state=u.searchParams.get('state');return Response.json({schemaVersion:1,incidentId,signal:'storage',state,messageId:state==='firing'?'55555555-5555-4555-8555-555555555555':'66666666-6666-4666-8666-666666666666',eventId:state==='firing'?'incident-firing':'incident-resolved',eventType:'email.delivered',occurredAt:state==='firing'?'2026-09-05T12:21:00.000Z':'2026-09-05T12:42:10.000Z'});}
    if(u.origin===s.readinessOrigin&&u.pathname==='/api/operations/readiness')return Response.json({schemaVersion:1,signals:MONITOR_SIGNALS.map(signal=>({signal,ok:signal!=='storage'||healthy,severity:signal==='storage'&&!healthy?'critical':'none',reasonCode:signal==='storage'&&!healthy?'sentinel_unavailable':'healthy',checkedAt:current,deploymentIdentity:s.manifest.candidate.sha,environment:'development',correlationId:incidentId,runbookAnchor:`docs/INCIDENT-RESPONSE.md#${signal.replaceAll('_','-')}`}))});
    return storage.fetchImpl(url,init);
  };
  const monitor=createMonitorAdapter(config,{now:()=>current,fetchImpl}),a=createSentinelAdapter(s,{now:()=>current,fetchImpl});
  const bucket=a.operation('create-bucket');await bucket.inspect();await bucket.mutate();await bucket.readback();own(s,a.resourceIds.bucket);
  const upload=a.operation('upload');await upload.inspect();await upload.mutate();await upload.readback();own(s,a.resourceIds.object);
  const baseline=await captureIncidentBaseline(monitor,a,{now:current});
  expect(baseline).toMatchObject({status:'deterministic-only',projectRef:s.projectRef});
  current='2026-09-05T12:01:00.000Z';const remove=a.operation('remove');await remove.inspect();await remove.mutate();const removed=await remove.readback();healthy=false;
  current='2026-09-05T12:02:00.000Z';const failureSignal=await a.readiness();
  current='2026-09-05T12:21:00.000Z';expect(await monitor.readSignal('storage')).toMatchObject({ok:false,incidentId,candidateSha:config.candidateSha,configSha256:config.configSha256,checkedAt:current});const failure=await captureMonitoringPhase(monitor,{ruleKey:'storage',phase:'failure',windowStart:removed.checkedAt,incidentId,now:current});
  current='2026-09-05T12:22:00.000Z';const recover=a.operation('recover');await recover.inspect();await recover.mutate();const recovered=await recover.readback();healthy=true;const recoverySignal=await a.readiness();
  current='2026-09-05T12:43:00.000Z';const recovery=await captureMonitoringPhase(monitor,{ruleKey:'storage',phase:'recovery',windowStart:recovered.checkedAt,incidentId,now:current});
  current='2026-09-05T12:44:00.000Z';const clean=a.operation('remove');await clean.inspect();await clean.mutate();await clean.readback();
  const cleanBucket=a.operation('delete-bucket');await cleanBucket.inspect();await cleanBucket.mutate();await cleanBucket.readback();
  const input={baseline,removed,recovered,failureSignal,recoverySignal,phases:[failure,recovery] as Parameters<typeof verifyStorageIncident>[2]['phases'],
    acknowledgement:{ruleKey:'storage',failureEventId:'incident-firing',acknowledgedAt:'2026-09-05T12:21:10.000Z',roleAlias:'owner' as const,inboxEvidenceSha256:'e'.repeat(64)},
    containedAt:'2026-09-05T12:21:20.000Z',diagnosedAt:'2026-09-05T12:21:30.000Z',rollbackDecision:{decision:'fixture-restore-only' as const,decidedAt:'2026-09-05T12:21:35.000Z',evidenceSha256:'c'.repeat(64)},
    runbookSha256:'b'.repeat(64),closedAt:current,now:current};
  const proof=await verifyStorageIncident(monitor,a,input);
  expect(proof).toMatchObject({status:'deterministic-only',recoveredAt:'2026-09-05T12:22:00.000Z',recoveryDeliveredAt:'2026-09-05T12:42:10.000Z',cleanup:{status:'absent'}});
  expect(JSON.stringify(proof)).not.toMatch(/sentinel.bin|private-owner|private-token/);
  await expect(verifyStorageIncident(monitor,a,{...input,recovered:{...recovered,sha256:'f'.repeat(64)}})).rejects.toThrow('INCIDENT_RECEIPT_INVALID');
  await expect(verifyStorageIncident(monitor,a,{...input,acknowledgement:{...input.acknowledgement,failureEventId:'unrelated'}})).rejects.toThrow('MONITORING_ACKNOWLEDGEMENT_INVALID');
  s.manifest.state='database_restored';await expect(captureIncidentBaseline(monitor,a,{now:current})).rejects.toThrow('INCIDENT_RESTORED_INTEGRITY_REQUIRED');
});
it('keeps persistent source sentinel resources out of destructive rehearsal and cleanup',()=>{
  const s=ownedSettings(),a=createSentinelAdapter(s,{now:()=>now,fetchImpl:storageFixture(s).fetchImpl});
  expect(()=>a.operation('remove')).toThrow('PERSISTENT_SENTINEL_DESTRUCTION_FORBIDDEN');
  expect(()=>a.operation('recover')).toThrow('PERSISTENT_SENTINEL_DESTRUCTION_FORBIDDEN');
  expect(()=>a.operation('delete-bucket')).toThrow('PERSISTENT_SENTINEL_DESTRUCTION_FORBIDDEN');
  expect(()=>a.operation('upload')).not.toThrow();
});
