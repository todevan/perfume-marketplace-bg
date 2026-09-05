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
