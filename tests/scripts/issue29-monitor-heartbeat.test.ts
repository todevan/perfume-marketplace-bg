import {describe,it,expect} from 'vitest';
import {createMonitorHeartbeatAdapter} from '../../scripts/issue29-operations/monitor-heartbeat.mjs';
const now='2026-09-08T12:00:00.000Z',config={origin:'https://issue29-monitor.owner.workers.dev',writeToken:'w'.repeat(43),readToken:'r'.repeat(43),environmentAlias:'synthetic-recovery',candidateSha:'c'.repeat(40),configSha256:'d'.repeat(64)};
const checkpoint={checkpointAt:now,candidateSha:config.candidateSha,configSha256:config.configSha256,descriptorSha256:'a'.repeat(64),artifactSha256:'b'.repeat(64),artifactId:'29'};
const observed={schemaVersion:1,environment:config.environmentAlias,release:config.candidateSha,backupRelease:config.candidateSha,configSha256:config.configSha256,checkpointAt:now,descriptorSha256:checkpoint.descriptorSha256,artifactSha256:checkpoint.artifactSha256,integrityFailureEvidenceSha256:null};
describe('trusted checkpoint monitor handoff',()=>{
 it.each(['environment','backupRelease','release','configSha256','checkpointAt','descriptorSha256','artifactSha256','integrityFailureEvidenceSha256'])('rejects mismatched %s even when the HTTP read succeeds',async field=>{
  const body={...observed,[field]:field==='checkpointAt'?'2026-09-08T11:00:00.000Z':(field==='release'||field==='backupRelease')?'f'.repeat(40):field==='environment'?'production':'f'.repeat(64)};
  const adapter=createMonitorHeartbeatAdapter(config,{fetchImpl:async()=>Response.json(body),now:()=>now});
  await expect(adapter.verifyBackupHeartbeat(checkpoint)).rejects.toThrow('Issue #29:');
 });
 it('does not retry an ambiguous POST or leak the provider body',async()=>{
  let calls=0;const adapter=createMonitorHeartbeatAdapter(config,{fetchImpl:async()=>{calls++;throw new Error('private provider secret');}});
  await expect(adapter.publishBackupHeartbeat(checkpoint)).rejects.toThrow('MONITOR_CHECKPOINT_MUTATION_UNCERTAIN_READBACK_ONLY');expect(calls).toBe(1);
 });
 it('bounds a streamed readback before JSON parsing',async()=>{
  let canceled=false;const response=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(20000));},cancel(){canceled=true;}}));
  await expect(createMonitorHeartbeatAdapter(config,{fetchImpl:async()=>response}).verifyBackupHeartbeat(checkpoint)).rejects.toThrow('MONITOR_CHECKPOINT_RESPONSE_INVALID');expect(canceled).toBe(true);
 });
 it('sends failure evidence without a new checkpoint timestamp',async()=>{
  let body:Record<string,unknown>={};const adapter=createMonitorHeartbeatAdapter(config,{fetchImpl:async(_url,init)=>{body=JSON.parse(String(init?.body));return new Response(null,{status:204});}});
  await adapter.publishBackupFailure({candidateSha:config.candidateSha,configSha256:config.configSha256,evidenceSha256:'f'.repeat(64)});expect(body).not.toHaveProperty('checkpointAt');expect(body).not.toHaveProperty('descriptorSha256');
 });
});
