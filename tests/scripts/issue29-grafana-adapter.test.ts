import { createHash } from 'node:crypto';
import { canonicalJson } from '../../scripts/issue29-operations/recovery-set.mjs';
import { describe, expect, it } from 'vitest';
import { createGrafanaHeartbeatAdapter } from '../../scripts/issue29-operations/grafana-adapter.mjs';

const now = '2026-09-05T12:00:00.000Z';
const heartbeat = { checkpointAt: '2026-09-04T10:00:00.000Z', candidateSha: 'a'.repeat(40),
  descriptorSha256: 'b'.repeat(64), configSha256: 'c'.repeat(64), artifactId: '456' };
const config = { writeOrigin: 'https://influx-prod-01-prod-eu-west-0.grafana.net',
  queryOrigin: 'https://prometheus-prod-01-prod-eu-west-0.grafana.net', queryBasePath: '/api/prom' as const,
  metricsInstanceId: '123', writeToken: 'write-private-token-1234567890123456',
  readToken: 'read-private-token-12345678901234567', environmentAlias: 'synthetic-source',
  candidateSha: heartbeat.candidateSha, configSha256: heartbeat.configSha256 };

describe('Issue 29 real Grafana HTTP adapter', () => {
  it('publishes the original backup checkpoint only to the independent exact metrics intake', async () => {
    const requests: {url: string; init?: RequestInit}[] = [];
    const adapter = createGrafanaHeartbeatAdapter(config, {now: () => now, fetchImpl: async (url, init) => {
      requests.push({url: String(url), init}); return new Response(null, {status: 204});
    }});
    const receipt = await adapter.publishBackupHeartbeat(heartbeat);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://influx-prod-01-prod-eu-west-0.grafana.net/api/v1/push/influx/write');
    expect(requests[0].init?.body).toContain('checkpoint_seconds=1788516000');
    expect(requests[0].init?.body).not.toContain('checkpoint_seconds=1788609600');
    expect(receipt).toMatchObject({status:'submitted', checkpointAt:heartbeat.checkpointAt});
    expect(JSON.stringify(receipt)).not.toContain('private-token');
  });
});

it('rejects redirects, oversized provider bodies, and ambiguous writes without retry or secret errors', async () => {
  for (const response of [new Response('private-body', {status:302,headers:{location:'https://evil.test'}}),
    new Response('private-body',{status:500}), new Response('x'.repeat(524_289),{status:200})]) {
    let calls=0;
    const a=createGrafanaHeartbeatAdapter(config,{now:()=>now,fetchImpl:async()=>{calls++;return response;}});
    await expect(a.publishBackupHeartbeat(heartbeat)).rejects.toThrow('GRAFANA_MUTATION_UNCERTAIN_READBACK_ONLY');
    expect(calls).toBe(1);
  }
});
it('fails closed before network for wrong exact origins, reused credentials, future time and wrong candidate', async () => {
  let calls=0; const opts={now:()=>now,fetchImpl:async()=>{calls++;return new Response(null,{status:204});}};
  for (const writeOrigin of ['http://influx-fixture.grafana.net','https://influx-fixture.grafana.net.evil.test','https://user@influx-fixture.grafana.net','https://influx-fixture.grafana.net/api'])
    expect(()=>createGrafanaHeartbeatAdapter({...config,writeOrigin},opts)).toThrow('GRAFANA_ORIGIN_FORBIDDEN');
  expect(()=>createGrafanaHeartbeatAdapter({...config,readToken:config.writeToken},opts)).toThrow('GRAFANA_CAPABILITIES_NOT_DISTINCT');
  const a=createGrafanaHeartbeatAdapter(config,opts);
  await expect(a.publishBackupHeartbeat({...heartbeat,candidateSha:'d'.repeat(40)})).rejects.toThrow('GRAFANA_HEARTBEAT_IDENTITY_OR_TIME');
  await expect(a.publishBackupHeartbeat({...heartbeat,checkpointAt:'2026-09-05T13:00:00.000Z'})).rejects.toThrow('GRAFANA_HEARTBEAT_IDENTITY_OR_TIME');
  expect(calls).toBe(0);
});
it('independently reads exact descriptor/artifact and refuses duplicate or mismatched metric series', async () => {
  for (const wrong of ['none','candidate','duplicate']) {
    const row={metric:{environment:'synthetic-source',candidate:wrong==='candidate'?'d'.repeat(40):heartbeat.candidateSha,
      config:heartbeat.configSha256,descriptor:heartbeat.descriptorSha256,artifact:heartbeat.artifactId},value:[1788609600,'1788516000']};
    let auth='';
    const a=createGrafanaHeartbeatAdapter(config,{now:()=>now,fetchImpl:async(url,init)=>{
      expect(String(url)).toContain('/api/prom/api/v1/query?query='); auth=String((init?.headers as Record<string,string>).Authorization);
      return Response.json({status:'success',data:{resultType:'vector',result:wrong==='duplicate'?[row,row]:[row]}});
    }});
    if(wrong==='none') expect(await a.verifyBackupHeartbeat(heartbeat)).toMatchObject({status:'verified',checkpointAt:heartbeat.checkpointAt});
    else await expect(a.verifyBackupHeartbeat(heartbeat)).rejects.toThrow('GRAFANA_HEARTBEAT_READBACK_MISMATCH');
    expect(Buffer.from(auth.slice(6),'base64').toString()).toBe(`123:${config.readToken}`);
  }
});

import { createGrafanaAdapter } from '../../scripts/issue29-operations/grafana-adapter.mjs';
import {monitoringConfig,providerFixture} from '../fixtures/issue29-grafana';

it('generates one selected configuration with all nine signal families and no destination/token values in its receipt',()=>{
  const adapter=createGrafanaAdapter(monitoringConfig,{now:()=>now});
  const plan=adapter.configuration();
  expect(plan.signals).toEqual(['health','auth','database','storage','email','deals','safety','backup_freshness','monitor_heartbeat']);
  expect(plan.destinationAlias).toBe('owner-primary');
  expect(plan.checks.map(c=>c.frequencyMs)).toEqual([300000,600000]);
  expect(plan.resources.filter(r=>r.kind==='rule')).toHaveLength(11);
  expect(plan.resources.every(r=>r.key.length<=63)).toBe(true);
  expect(JSON.stringify(plan)).not.toMatch(/private-owner|private-token|Bearer|supabase/);
});

it('binds k6 samples and native rule selectors to the exact current release, not mutable check job alone',async()=>{
  const fixture=providerFixture(),a=createGrafanaAdapter(monitoringConfig,{fetchImpl:fixture.fetchImpl,now:()=>now}),p=a.configuration();
  for(const r of p.resources){const op=a.resourceOperation(r.key);await op.inspect();await op.mutate();}
  const checks=fixture.requests.filter(r=>r.method==='POST'&&new URL(r.url).pathname==='/api/v1/check');
  for(const r of checks){const script=Buffer.from(r.body.settings.scripted.script,'base64').toString();
    expect(script).toContain(`"issue29_candidate":"${monitoringConfig.candidateSha}"`);
    expect(script).toContain(`"issue29_config":"${p.configSha256}"`);}
  for(const r of fixture.stored.values())if(r.ruleGroup&&!r.labels.signal.startsWith('backup')){
    expect(r.data[0].model.expr).toContain(`issue29_candidate="${monitoringConfig.candidateSha}"`);
    expect(r.data[0].model.expr).toContain(`issue29_config="${p.configSha256}"`);}
});

it('reads the actual monitor heartbeat value and rejects stale, foreign, or duplicate series',async()=>{
  let mode='valid';const clock='2026-09-05T12:00:00.000Z',heartbeatAt='2026-09-05T11:51:00.000Z';
  const a=createGrafanaAdapter(monitoringConfig,{now:()=>clock,fetchImpl:async(url)=>{
    const query=new URL(String(url)).searchParams.get('query')!;expect(query).toContain('last_over_time(probe_aromatika_monitor_checkpoint_seconds');
    const labels={job:'i29-7abbd7fca0-protected',instance:monitoringConfig.targetOrigin+'/api/operations/readiness',issue29_run:monitoringConfig.runId,issue29_candidate:mode==='foreign'?'d'.repeat(40):monitoringConfig.candidateSha,issue29_config:a.configuration().configSha256};
    const row={metric:labels,value:[Date.parse(clock)/1000,String(Date.parse(mode==='stale'?'2026-09-05T11:39:59.000Z':heartbeatAt)/1000)]};
    return Response.json({status:'success',data:{resultType:'vector',result:mode==='duplicate'?[row,row]:[row]}});
  }});
  expect(await a.readMonitorHeartbeat()).toMatchObject({heartbeatAt,checkedAt:clock,candidateSha:monitoringConfig.candidateSha});
  for(mode of ['stale','foreign','duplicate'])await expect(a.readMonitorHeartbeat()).rejects.toThrow('GRAFANA_MONITOR_HEARTBEAT_UNPROVEN');
});

// Public HTTP fixtures follow the current official SM v1.15.0/Receiver/historian payloads.
// They are contract evidence only; no fixture result is a hosted alert-delivery attestation.

it('requires preflight before exactly one resource create, then independently verifies identity/readback',async()=>{
  const fixture=providerFixture(); const a=createGrafanaAdapter(monitoringConfig,{now:()=>now,fetchImpl:fixture.fetchImpl});
  const key=a.configuration().resources.find(r=>r.kind==='receiver')!.key, op=a.resourceOperation(key);
  await expect(op.mutate()).rejects.toThrow('GRAFANA_PRE_MUTATION_INSPECTION_REQUIRED');
  expect(fixture.requests).toHaveLength(0);
  expect(await op.inspect()).toMatchObject({status:'absent'});
  await op.mutate(); const read=await op.readback();expect(read).toMatchObject({status:'verified',key,resourceId:`provider-${key}`});
  await expect(op.mutate()).rejects.toThrow('GRAFANA_PRE_MUTATION_INSPECTION_REQUIRED');
  const creates=fixture.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/receivers'));
  expect(creates).toHaveLength(1);expect(creates[0].body.spec.integrations).toEqual([{type:'email',version:'v1',disableResolveMessage:false,settings:{addresses:'private-owner@example.test',singleEmail:true}}]);
  expect(JSON.stringify(read)).not.toMatch(/private-owner|must-not-leak|private-token/);
});
it.each([{orgId:555},{trial:1},{status:'disabled'},{MaxScriptedChecks:1}])('rejects wrong provider ownership/plan/capacity before any create: %j',async(override)=>{
  const fixture=providerFixture(override);const a=createGrafanaAdapter(monitoringConfig,{now:()=>now,fetchImpl:fixture.fetchImpl});
  const op=a.resourceOperation(a.configuration().resources[0].key);
  await expect(op.inspect()).rejects.toThrow(/GRAFANA_/);
  expect(fixture.requests.filter(r=>r.method!=='GET')).toHaveLength(0);
});
it('creates and independently reads all exact rules, checks, secret metadata, folder and destination',async()=>{
  const fixture=providerFixture();const a=createGrafanaAdapter(monitoringConfig,{now:()=>now,fetchImpl:fixture.fetchImpl});
  for(const r of a.configuration().resources){const op=a.resourceOperation(r.key);await op.inspect();await op.mutate();expect(await op.readback()).toMatchObject({status:'verified',key:r.key});}
  expect(await a.verifyConfiguration()).toMatchObject({status:'verified',candidateSha:monitoringConfig.candidateSha});
  const rules=fixture.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/alert-rules')).map(r=>r.body);
  expect(rules).toHaveLength(11);
  for(const r of rules){expect(r.uid.length).toBeLessThanOrEqual(40);expect(r.notification_settings.receiver).toContain('owner-primary');expect(r.data[1].model.conditions[0].unloadEvaluator).toEqual({type:'lt',params:[1]});expect(r.noDataState).toBe('Alerting');expect(r.execErrState).toBe('Alerting');}
  const checks=fixture.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/check')).map(r=>r.body);
  expect(checks.map(c=>c.frequency)).toEqual([300000,600000]);
  const scripts=checks.map(c=>Buffer.from(c.settings.scripted.script,'base64').toString());
  expect(scripts[1]).toContain("secrets.get(");expect(scripts.join()).not.toMatch(/private-token|supabase|console\./);
});
it('filters actual notification-history successes by exact rule, run, candidate, config and destination without exposing errors',async()=>{
  const fixture=providerFixture(); const a=createGrafanaAdapter(monitoringConfig,{now:()=>now,fetchImpl:fixture.fetchImpl});
  const plan=a.configuration(),key=plan.resources.find(r=>r.kind==='rule')!.key;
  const row={uuid:'event-123',timestamp:'2026-09-05T11:59:00.000Z',receiver:'i29-7abbd7fca0-owner-primary',integration:'email',integrationIndex:0,status:'firing',outcome:'success',ruleUIDs:[key],
    groupLabels:{issue29_run:monitoringConfig.runId,issue29_candidate:monitoringConfig.candidateSha,issue29_config:plan.configSha256}};
  fixture.setEvents([{...row,uuid:'wrong-candidate',groupLabels:{...row.groupLabels,issue29_candidate:'d'.repeat(40)}},{...row,uuid:'failed',outcome:'error',error:'private provider body'},row]);
  const matches=await a.notificationHistory({ruleKey:key,status:'firing',from:'2026-09-05T11:50:00.000Z',to:now});
  expect(matches).toHaveLength(1);expect(matches[0]).toMatchObject({eventId:'event-123',destinationAlias:'owner-primary',deliveredAt:'2026-09-05T11:59:00.000Z'});
  expect(JSON.stringify(matches)).not.toContain('private provider');
});
it('deletes only the exact read-back resource ID and separately proves absence',async()=>{
  const fixture=providerFixture();const a=createGrafanaAdapter(monitoringConfig,{now:()=>now,fetchImpl:fixture.fetchImpl});
  const key=a.configuration().resources.find(r=>r.kind==='receiver')!.key,create=a.resourceOperation(key);
  await create.inspect();await create.mutate();const created=await create.readback();
  await expect(a.cleanupOperation(key,'foreign-id').inspect()).rejects.toThrow('GRAFANA_RESOURCE_ID_MISMATCH');
  const cleanup=a.cleanupOperation(key,String(created.resourceId));await cleanup.inspect();await cleanup.mutate();expect(await cleanup.readback()).toMatchObject({status:'absent',resourceId:created.resourceId});
  const deletion=fixture.requests.find(r=>r.method==='DELETE');expect(deletion?.body.preconditions).toEqual({uid:created.resourceId,resourceVersion:'1'});
  expect(()=>a.cleanupOperation(a.configuration().resources[0].key,'foreign-folder')).toThrow('GRAFANA_FOLDER_CLEANUP_FORBIDDEN');
});

import { captureMonitoringPhase, verifyMonitoringProof } from '../../scripts/issue29-operations/monitoring-proof.mjs';
it('does not confuse contact-point delivery with live rule evaluation or missing notification history',async()=>{
  const fixture=providerFixture();const a=createGrafanaAdapter(monitoringConfig,{now:()=>now,fetchImpl:fixture.fetchImpl});
  const key=a.configuration().resources.find(r=>r.kind==='rule')!.key;
  await expect(captureMonitoringPhase(a,{ruleKey:key,phase:'failure',windowStart:'2026-09-05T11:50:00.000Z',now})).rejects.toThrow('GRAFANA_RULE_CONFIG_UNVERIFIED');
  await expect(verifyMonitoringProof(a,{phases:[],acknowledgements:[],now})).rejects.toThrow('MONITORING_RULE_COVERAGE_INCOMPLETE');
});
it('executes the real exported k6 protected script with only the narrow monitor secret and emits sanitized metrics',async()=>{
  const fixture=providerFixture();const a=createGrafanaAdapter(monitoringConfig,{now:()=>now,fetchImpl:fixture.fetchImpl});
  const key=a.configuration().checks[1].key,op=a.resourceOperation(key);await op.inspect();await op.mutate();
  const encoded=fixture.requests.find(r=>r.method==='POST'&&r.url.endsWith('/check'))!.body.settings.scripted.script;
  const script=Buffer.from(encoded,'base64').toString();
  const names=['health','auth','database','storage','email','deals','safety','backup_freshness','monitor_heartbeat'];
  const rows=names.map(signal=>({signal,environment:'staging',deploymentIdentity:monitoringConfig.candidateSha,checkedAt:now,
    ok:true,severity:'none',reasonCode:'healthy',correlationId:'6eb5963f-6a9a-4d96-83fc-d0e33793037d',runbookAnchor:'docs/INCIDENT-RESPONSE.md#'+signal.replaceAll('_','-')}));
  const values:Record<string,number>={}; const {runInNewContext}=await import('node:vm');
  const executable=script.replace(/^import .*;$/gm,'').replace('export const options','const options').replace('export default async function()','globalThis.probe=async function()');
  let credentialSent='';const sandbox={Gauge:class {name:string;constructor(name:string){this.name=name;}add(value:number){values[this.name]=value;}},
    secrets:{get:async()=>monitoringConfig.monitorToken},http:{get:(url:string,o:{headers:{Authorization:string}})=>{
      expect(url).toBe('https://issue29-fixture.workers.dev/api/operations/readiness');credentialSent=o.headers.Authorization;return {status:200,body:JSON.stringify({schemaVersion:1,signals:rows})};}},
    Date:class extends Date {static now(){return Date.parse(now);}},probe:async()=>{}};
  runInNewContext(executable,sandbox);await sandbox.probe();expect(credentialSent).toBe('Bearer '+monitoringConfig.monitorToken);
  expect(values.aromatika_storage).toBe(0);expect(values.aromatika_monitor_checkpoint_seconds).toBe(1788609600);
  rows[3]={...rows[3],ok:false,severity:'critical',reasonCode:'storage_integrity_mismatch'};
  await sandbox.probe();expect(values.aromatika_storage).toBe(2);
  rows[3]={...rows[3],ok:false,severity:'critical',reasonCode:'sentinel_unavailable'};
  await sandbox.probe();expect(values.aromatika_storage).toBe(1);
  rows[3]={...rows[3],ok:true,severity:'critical',reasonCode:'healthy'};
  await sandbox.probe();expect(values.aromatika_storage).toBe(1);
  expect(Object.keys(values)).not.toContain('aromatika_backup_freshness');
  expect(Object.keys(values)).not.toContain('aromatika_monitor_heartbeat');
});
it('reads real rule evaluation and emitted score before recording delivered-failure proof',async()=>{
  const fixture=providerFixture();let evaluation:Record<string,unknown>={};let score=2;
  const fetchImpl:typeof fetch=async(url,init)=>{
    if(new URL(String(url)).pathname==='/api/prometheus/grafana/api/v1/rules')return Response.json({status:'success',data:{groups:[{rules:[evaluation]}]}});
    if(new URL(String(url)).pathname==='/api/prom/api/v1/query')return Response.json({status:'success',data:{resultType:'vector',result:[{metric:{},value:[1788609600,String(score)]}]}});
    return fixture.fetchImpl(url,init);
  };
  const a=createGrafanaAdapter(monitoringConfig,{now:()=>now,fetchImpl}),plan=a.configuration(),key=plan.resources.find(r=>r.kind==='rule')!.key;
  const op=a.resourceOperation(key);await op.inspect();await op.mutate();
  const payload=fixture.requests.find(r=>r.method==='POST'&&r.url.endsWith('/alert-rules'))!.body;
  evaluation={uid:key,folderUid:'issue29-fixture',health:'ok',isPaused:false,state:'firing',lastEvaluation:now,activeAt:'2026-09-05T11:58:00.000Z',labels:payload.labels};
  fixture.setEvents([{uuid:'delivery-event',timestamp:'2026-09-05T11:59:00.000Z',receiver:payload.notification_settings.receiver,integration:'email',integrationIndex:0,status:'firing',outcome:'success',ruleUIDs:[key],groupLabels:payload.labels}]);
  const phase=await captureMonitoringPhase(a,{ruleKey:key,phase:'failure',windowStart:'2026-09-05T11:50:00.000Z',now});
  expect(phase).toMatchObject({evidenceMode:'deterministic-http-fixture',phase:'failure',event:{eventId:'delivery-event'},evaluation:{firedAt:'2026-09-05T11:58:00.000Z'}});
  expect(JSON.stringify(phase)).not.toContain('private-owner');
  score=1;await expect(captureMonitoringPhase(a,{ruleKey:key,phase:'failure',windowStart:'2026-09-05T11:50:00.000Z',now})).rejects.toThrow('MONITORING_PHASE_NOT_OBSERVED');
});
it('publishes a definite backup failure without refreshing its successful checkpoint',async()=>{
  let posted='';const a=createGrafanaHeartbeatAdapter(config,{now:()=>now,fetchImpl:async(_url,init)=>{posted=String(init?.body);return new Response(null,{status:204});}});
  await a.publishBackupFailure({candidateSha:config.candidateSha,configSha256:config.configSha256,evidenceSha256:'d'.repeat(64)});
  expect(posted).toContain('usable=0');expect(posted).not.toContain('checkpoint_seconds');
});
it('assembles all real HTTP-phase readbacks and private acknowledgements without promoting fixture evidence to hosted PASS',async()=>{
  const fixture=providerFixture();let current=now,phase='failure';
  const fetchImpl:typeof fetch=async(url,init)=>{
    const path=new URL(String(url)).pathname;
    if(path==='/api/prometheus/grafana/api/v1/rules')return Response.json({status:'success',data:{groups:[{rules:[...fixture.stored.values()].filter(r=>r.ruleGroup).map(r=>({
      uid:r.uid,folderUid:'issue29-fixture',health:'ok',isPaused:false,state:phase==='failure'?'firing':'inactive',lastEvaluation:current,
      activeAt:phase==='failure'?'2026-09-05T11:58:00.000Z':null,labels:r.labels}))}]}});
    if(path==='/api/prom/api/v1/query')return Response.json({status:'success',data:{resultType:'vector',result:[{metric:{},value:[Date.parse(current)/1000,phase==='failure'?'2':'0']}]}});
    return fixture.fetchImpl(url,init);
  };
  const a=createGrafanaAdapter(monitoringConfig,{now:()=>current,fetchImpl}),plan=a.configuration();
  for(const r of plan.resources){const op=a.resourceOperation(r.key);await op.inspect();await op.mutate();}
  const rules=[...fixture.stored.values()].filter(r=>r.ruleGroup);
  fixture.setEvents(rules.flatMap(r=>['firing','resolved'].map(status=>({uuid:`${r.uid}-${status}`,timestamp:status==='firing'?'2026-09-05T11:59:00.000Z':'2026-09-05T12:11:00.000Z',
    receiver:r.notification_settings.receiver,integration:'email',integrationIndex:0,status,outcome:'success',ruleUIDs:[r.uid],groupLabels:r.labels}))));
  const phases=[];
  for(const r of rules)phases.push(await captureMonitoringPhase(a,{ruleKey:r.uid,phase:'failure',windowStart:'2026-09-05T11:50:00.000Z',now:current}));
  current='2026-09-05T12:12:00.000Z';phase='recovery';
  for(const r of rules)phases.push(await captureMonitoringPhase(a,{ruleKey:r.uid,phase:'recovery',windowStart:'2026-09-05T12:01:00.000Z',now:current}));
  const acknowledgements=rules.map(r=>({ruleKey:r.uid,failureEventId:`${r.uid}-firing`,acknowledgedAt:'2026-09-05T12:00:00.000Z',roleAlias:'owner' as const,inboxEvidenceSha256:'e'.repeat(64)}));
  // The phase DTO schema is independently re-parsed at the production boundary.
  const input={phases:phases as Parameters<typeof verifyMonitoringProof>[1]['phases'],acknowledgements,now:current};
  const proof=await verifyMonitoringProof(a,input);
  expect(proof.status).toBe('deterministic-only');expect(proof.timelines).toHaveLength(11);expect(JSON.stringify(proof)).not.toMatch(/private-owner|private-token/);
  expect(proof.sourceConfigSha256).toBe(plan.configSha256);expect(proof.configuration.resources).toHaveLength(16);
  expect(proof.signalFamilies).toEqual(['health','auth','database','storage','email','deals','safety','backup_freshness','monitor_heartbeat']);
  expect(proof.ruleMappings).toHaveLength(11);expect(proof.ruleMappings.every(r=>r.ruleKey===r.sourceRuleKey)).toBe(true);
  await expect(verifyMonitoringProof(a,{...input,acknowledgements:[]})).rejects.toThrow('MONITORING_RULE_COVERAGE_INCOMPLETE');
  const tampered=structuredClone(input);tampered.phases[0].configSha256='d'.repeat(64);
  await expect(verifyMonitoringProof(a,tampered)).rejects.toThrow('MONITORING_PHASE_IDENTITY_OR_HASH_MISMATCH');
  const forged=structuredClone(input);forged.phases[0].evaluation.candidateSha='d'.repeat(40);
  const {evidenceSha256:discard,...forgedBody}=forged.phases[0];
  forged.phases[0].evidenceSha256=createHash('sha256').update(canonicalJson(forgedBody)).digest('hex');
  await expect(verifyMonitoringProof(a,forged)).rejects.toThrow('MONITORING_NESTED_IDENTITY_MISMATCH');
  const unacknowledged=structuredClone(input);unacknowledged.acknowledgements[0].failureEventId='foreign-event';
  await expect(verifyMonitoringProof(a,unacknowledged)).rejects.toThrow('MONITORING_ACKNOWLEDGEMENT_INVALID');
});
it('isolates target monitoring resource identities from the persistent source configuration',()=>{
  const source=createGrafanaAdapter(monitoringConfig).configuration();
  const target=createGrafanaAdapter({...monitoringConfig,targetRole:'target',environmentAlias:'synthetic-restore',targetOrigin:'https://issue29-target.owner.workers.dev',folderUid:'issue29-target'}).configuration();
  expect(target.targetRole).toBe('target');
  expect(target.resources.every(r=>!source.resources.some(s=>s.key===r.key))).toBe(true);
});
it('creates a rule-specific expiring maintenance silence and expires only its exact read-back identity',async()=>{
  const f=providerFixture();let silence:Record<string,any>|null=null,posts=0,deletes=0,ambiguous=false;
  const fetchImpl:typeof fetch=async(url,init)=>{const path=new URL(String(url)).pathname;
    if(path.endsWith('/api/v2/silences')){if(init?.method==='POST'){posts++;silence={...JSON.parse(String(init.body)),id:'45454545-4545-4454-8454-454545454545',status:{state:'active'},updatedAt:now};if(ambiguous)throw new Error('private body');return Response.json({silenceID:'45454545-4545-4454-8454-454545454545'});}return Response.json(silence?[silence]:[]);}
    if(path.includes('/api/v2/silence/')){if(init?.method==='DELETE'){deletes++;silence={...silence,endsAt:now,status:{state:'expired'}};return new Response(null,{status:200});}return silence?Response.json(silence):new Response(null,{status:404});}
    return f.fetchImpl(url,init);
  };
  const a=createGrafanaAdapter(monitoringConfig,{fetchImpl,now:()=>now});for(const r of a.configuration().resources){const op=a.resourceOperation(r.key);await op.inspect();await op.mutate();}
  const maintenance={id:'65656565-6565-4656-8656-656565656565',authorizedAt:now,expiresAt:'2026-09-05T14:00:00.000Z',sourceConfigSha256:a.configuration().configSha256};
  const key=a.configuration().resources.find(r=>r.key.endsWith('-storage'))!.key;
  const op=a.maintenanceSilenceOperation({maintenance,ruleKey:key,action:'create'});await op.inspect();ambiguous=true;
  await expect(op.mutate()).rejects.toThrow('GRAFANA_MUTATION_UNCERTAIN_READBACK_ONLY');
  const proof=await a.maintenanceSilenceOperation({maintenance,ruleKey:key,action:'create'}).readback();
  expect(proof).toMatchObject({status:'active',resourceId:'45454545-4545-4454-8454-454545454545',expiresAt:maintenance.expiresAt});expect(posts).toBe(1);
  expect((silence as Record<string,any>|null)?.matchers).toContainEqual({name:'__alert_rule_uid__',value:key,isEqual:true,isRegex:false});
  const heartbeat=a.configuration().resources.find(r=>r.key.endsWith('-monitor-heartbeat'))!.key;
  expect(()=>a.maintenanceSilenceOperation({maintenance,ruleKey:heartbeat,action:'create'})).toThrow('MAINTENANCE_DEADMAN_SILENCE_FORBIDDEN');
  const remove=a.maintenanceSilenceOperation({maintenance,ruleKey:key,action:'expire',resourceId:proof.resourceId});await remove.inspect();await remove.mutate();
  expect(await remove.readback()).toMatchObject({status:'expired',effectiveAbsence:true});expect(deletes).toBe(1);
  await expect(remove.mutate()).rejects.toThrow('GRAFANA_PRE_MUTATION_INSPECTION_REQUIRED');
});
it('independently reads back the exact failed-artifact event without changing the good checkpoint',async()=>{
  let body='';const failure={candidateSha:config.candidateSha,configSha256:config.configSha256,evidenceSha256:'d'.repeat(64)};
  const a=createGrafanaHeartbeatAdapter(config,{now:()=>now,fetchImpl:async(url,init)=>{
    if(init?.method==='POST'){body=String(init.body);return new Response(null,{status:204});}
    expect(new URL(String(url)).searchParams.get('query')).toContain(`evidence="${failure.evidenceSha256}"`);
    return Response.json({status:'success',data:{resultType:'vector',result:[{metric:{environment:config.environmentAlias,candidate:config.candidateSha,config:config.configSha256,evidence:failure.evidenceSha256},value:[Date.parse(now)/1000,'1']}]}});
  }});
  await a.publishBackupFailure(failure);expect(await a.verifyBackupFailure(failure)).toMatchObject({status:'verified',reasonCode:'backup_integrity_failed'});
  expect(body).toContain('aromatika_ops_backup_failure');expect(body).not.toContain('checkpoint_seconds');
});

import { createGrafanaRuleFixtureAdapter } from '../../scripts/issue29-operations/grafana-adapter.mjs';
it('uses isolated disposable metric series and cloned rule predicates, never production injection or source metric writes',async()=>{
  const f=providerFixture();const base=createGrafanaAdapter(monitoringConfig,{fetchImpl:f.fetchImpl,now:()=>now});
  for(const r of base.configuration().resources){const op=base.resourceOperation(r.key);await op.inspect();await op.mutate();}
  let published='',omit=false;const fetchImpl:typeof fetch=async(url,init)=>{const u=new URL(String(url));if(u.hostname.startsWith('influx-')){published=String(init?.body);return new Response(null,{status:204});}
    if(u.pathname==='/api/prom/api/v1/query'){const rows=published.trim().split('\n').map(line=>{const [head,field,time]=line.split(' '),[name,...tags]=head.split(',');return {metric:{__name__:name+'_value',...Object.fromEntries(tags.map(t=>t.split('=')))},values:[[Number(BigInt(time)/1000000n)/1000,field.split('=')[1]]]};});return Response.json({status:'success',data:{resultType:'matrix',result:omit?rows.slice(1):rows}});}
    return f.fetchImpl(url,init);};
  const a=createGrafanaRuleFixtureAdapter(monitoringConfig,{writeOrigin:config.writeOrigin,writeToken:'fixture-metrics-write-123456789012345678',expiresAt:'2026-09-05T14:00:00.000Z'},{fetchImpl,now:()=>now});
  const plan=a.configuration();expect(plan.targetRole).toBe('fixture');expect(plan.resources).toHaveLength(11);
  expect(plan.sourceConfigSha256).toBe(base.configuration().configSha256);expect(plan.configSha256).not.toBe(plan.sourceConfigSha256);
  expect(new Set(plan.ruleMappings.map(r=>r.sourceRuleKey)).size).toBe(11);
  expect(plan.ruleMappings.every(r=>r.ruleKey.startsWith('f29-')&&r.sourceRuleKey.startsWith('i29-')&&base.configuration().resources.some(source=>source.key===r.sourceRuleKey))).toBe(true);
  for(const r of plan.resources){const op=a.resourceOperation(r.key);await op.inspect();await op.mutate();}
  const rules=[...f.stored.values()].filter(r=>r.uid?.startsWith('f29-'));
  expect(rules.every(r=>r.data[0].model.expr.includes('aromatika_issue29_fixture_')&&!r.data[0].model.expr.includes(monitoringConfig.targetOrigin))).toBe(true);
  expect(rules.every(r=>r.data[0].model.expr.includes('1788616800'))).toBe(true);
  const op=a.fixtureSampleOperation({phase:'failure',sampleAt:now});await op.inspect();await op.mutate();
  expect(published.split('\n').filter(Boolean)).toHaveLength(11);expect(published).not.toMatch(/probe_aromatika|aromatika_ops_backup,|private-token/);
  expect(published).toContain('aromatika_issue29_fixture_backup_status_usable');
  expect(await op.readback()).toMatchObject({status:'verified',phase:'failure',sampleAt:now});omit=true;await expect(op.readback()).rejects.toThrow('GRAFANA_FIXTURE_READBACK_MISMATCH');
  await expect(op.mutate()).rejects.toThrow('GRAFANA_PRE_MUTATION_INSPECTION_REQUIRED');
});

it('updates only existing candidate-bound checks/rules after exact private prior capture, and resumes an ambiguous update by readback',async()=>{
  const f=providerFixture(),old=createGrafanaAdapter(monitoringConfig,{now:()=>now,fetchImpl:f.fetchImpl});
  for(const r of old.configuration().resources){const op=old.resourceOperation(r.key);await op.inspect();await op.mutate();await op.readback();}
  const next=createGrafanaAdapter({...monitoringConfig,candidateSha:'b'.repeat(40)},{now:()=>now,fetchImpl:f.fetchImpl});
  const resources=next.configuration().resources.filter(r=>['check','rule'].includes(r.kind)),before=f.requests.length;
  for(const r of resources){const prior=await old.readResource(r.key);let privatePrior:Record<string,any>|null=null;
    const op=next.releaseUpdateOperation(r.key,monitoringConfig.candidateSha,{resourceId:prior.resourceId!,capturePrior:async proof=>{privatePrior=proof;}});
    await expect(op.mutate()).rejects.toThrow('GRAFANA_PRE_MUTATION_INSPECTION_REQUIRED');
    const inspected=await op.inspect();expect(privatePrior).not.toBeNull();expect(inspected.priorStateSha256).toMatch(/^[a-f0-9]{64}$/);
    await op.mutate();const read=await op.readback();expect(read).toMatchObject({status:'verified',resourceId:prior.resourceId,previousCandidateSha:monitoringConfig.candidateSha,candidateSha:'b'.repeat(40)});
    expect(JSON.stringify(read)).not.toMatch(/private-token|private-owner|script|providerState/);
    await expect(op.mutate()).rejects.toThrow('GRAFANA_PRE_MUTATION_INSPECTION_REQUIRED');
  }
  const writes=f.requests.slice(before).filter(r=>r.method!=='GET'&&!r.url.endsWith('/notification/query'));
  expect(writes).toHaveLength(13);expect(writes.filter(r=>r.method==='POST').map(r=>new URL(r.url).pathname)).toEqual(['/api/v1/check/1','/api/v1/check/2']);
  expect(writes.filter(r=>r.method==='PUT')).toHaveLength(11);expect(await next.verifyConfiguration()).toMatchObject({status:'verified'});
  const key=resources[2].key,newer=createGrafanaAdapter({...monitoringConfig,candidateSha:'c'.repeat(40)},{now:()=>now,fetchImpl:async(url,init)=>{
    const response=await f.fetchImpl(url,init);if(init?.method==='PUT')throw new Error('uncertain private body');return response;
  }});
  let privatePrior:Record<string,any>|undefined;const update=newer.releaseUpdateOperation(key,'b'.repeat(40),{resourceId:key,capturePrior:async proof=>{privatePrior=proof;}});
  const inspected=await update.inspect();await expect(update.mutate()).rejects.toThrow('GRAFANA_MUTATION_UNCERTAIN_READBACK_ONLY');
  const count=f.requests.filter(r=>r.method==='PUT').length;
  const resume=newer.releaseUpdateOperation(key,'b'.repeat(40),{resourceId:key,priorState:privatePrior,expectedPriorSha256:inspected.priorStateSha256,capturePrior:async()=>{throw new Error('must not inspect');}});
  expect(await resume.readback()).toMatchObject({status:'verified',candidateSha:'c'.repeat(40)});expect(f.requests.filter(r=>r.method==='PUT')).toHaveLength(count);
});

it('rejects retargeting and provider prior drift before any release-update write',async()=>{
  const f=providerFixture(),old=createGrafanaAdapter(monitoringConfig,{now:()=>now,fetchImpl:f.fetchImpl});
  const key=old.configuration().resources.find(r=>r.kind==='rule')!.key,create=old.resourceOperation(key);await create.inspect();await create.mutate();
  const next=createGrafanaAdapter({...monitoringConfig,candidateSha:'b'.repeat(40)},{now:()=>now,fetchImpl:f.fetchImpl});
  const op=next.releaseUpdateOperation(key,monitoringConfig.candidateSha,{resourceId:key,capturePrior:async()=>{}});await op.inspect();
  f.stored.get('/api/v1/provisioning/alert-rules/'+key)!.isPaused=true;
  await expect(op.mutate()).rejects.toThrow('GRAFANA_RELEASE_PRIOR_DRIFT');expect(f.requests.filter(r=>r.method==='PUT')).toHaveLength(0);
  const retarget=createGrafanaAdapter({...monitoringConfig,candidateSha:'b'.repeat(40),targetOrigin:'https://unrelated.workers.dev'},{now:()=>now,fetchImpl:f.fetchImpl});
  await expect(retarget.releaseUpdateOperation(key,monitoringConfig.candidateSha,{resourceId:key,capturePrior:async()=>{}}).inspect()).rejects.toThrow('GRAFANA_RESOURCE_CONFIG_MISMATCH');
  expect(()=>next.releaseUpdateOperation(monitoringConfig.folderUid,monitoringConfig.candidateSha,{resourceId:monitoringConfig.folderUid,capturePrior:async()=>{}})).toThrow('GRAFANA_RELEASE_RESOURCE_FORBIDDEN');
});

it('uses distinct disposable rule/check identities for each monthly target cycle without changing the persistent source folder',()=>{
  const base={...monitoringConfig,targetRole:'target' as const,targetOrigin:'https://issue29-restore-fixture.workers.dev'};
  const first=createGrafanaAdapter({...base,targetCycleId:'45454545-4545-4454-8454-454545454545'}).configuration();
  const second=createGrafanaAdapter({...base,targetCycleId:'56565656-5656-4565-8565-565656565656'}).configuration();
  expect(first.resources.some(r=>r.kind==='folder')).toBe(false);expect(first.folderUid).toBe(second.folderUid);
  expect(first.configSha256).not.toBe(second.configSha256);
  expect(first.resources.every(r=>!second.resources.some(s=>s.key===r.key))).toBe(true);
  expect(first.resources.map(r=>r.key)).toContain('t29-4545454545-public');
});

it('does not claim an exact check absent merely because its job name was changed',async()=>{
  const f=providerFixture(),g=createGrafanaAdapter(monitoringConfig,{fetchImpl:f.fetchImpl,now:()=>now});
  const key=g.configuration().resources.find(r=>r.kind==='check')!.key,create=g.resourceOperation(key);await create.inspect();await create.mutate();const receipt=await create.readback();
  const listed=await (await f.fetchImpl(monitoringConfig.smOrigin+'/api/v1/check')).json();
  await f.fetchImpl(monitoringConfig.smOrigin+'/api/v1/check/'+receipt.resourceId,{method:'POST',body:JSON.stringify({...listed.items[0],job:'foreign-renamed-check'})});
  await expect(g.cleanupOperation(key,receipt.resourceId!).readback()).rejects.toThrow('GRAFANA_RESOURCE_CONFIG_MISMATCH');
  expect(f.requests.some(r=>r.method==='GET'&&r.url.endsWith('/api/v1/check/1'))).toBe(true);
  expect(f.requests.some(r=>r.method==='DELETE')).toBe(false);
});
