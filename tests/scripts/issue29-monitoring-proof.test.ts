import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { canonicalJson } from '../../scripts/issue29-operations/recovery-set.mjs';
import { captureMonitoringPhase, verifyMonitoringRuleJourney } from '../../scripts/issue29-operations/monitoring-proof.mjs';
const sha='a'.repeat(40), hash='b'.repeat(64), incidentId='11111111-1111-4111-8111-111111111111';
const start='2026-09-08T12:00:00.000Z', fired='2026-09-08T12:01:00.000Z', recovered='2026-09-08T12:10:00.000Z', now='2026-09-08T12:15:00.000Z';
const config={signals:['storage'],candidateSha:sha,configSha256:hash,runId:'22222222-2222-4222-8222-222222222222'};
const events={firing:{schemaVersion:1,incidentId,signal:'storage',state:'firing',messageId:'33333333-3333-4333-8333-333333333333',eventId:'evt_failure',eventType:'email.delivered',occurredAt:fired},resolved:{schemaVersion:1,incidentId,signal:'storage',state:'resolved',messageId:'44444444-4444-4444-8444-444444444444',eventId:'evt_recovery',eventType:'email.delivered',occurredAt:recovered}};
function adapter(ok=false){return {configuration:()=>config,verifyConfiguration:async()=>config,readSignal:async()=>({signal:'storage',ok,severity:ok?'none':'critical',reasonCode:ok?'healthy':'sentinel_unavailable',checkedAt:ok?recovered:fired,incidentId,candidateSha:sha,configSha256:hash}),deliveryEvent:async(_id:string,state:'firing'|'resolved')=>events[state]} as unknown as Parameters<typeof captureMonitoringPhase>[0];}
const acknowledgement={ruleKey:'storage',failureEventId:'evt_failure',acknowledgedAt:'2026-09-08T12:02:00.000Z',roleAlias:'owner' as const,inboxEvidenceSha256:'c'.repeat(64)};
const reseal=(value:any)=>{const {evidenceSha256:_,...body}=value;return {...body,evidenceSha256:createHash('sha256').update(canonicalJson(body)).digest('hex')};};
describe('exact authenticated monitor delivery proof',()=>{
 it('binds distinct failure and recovery deliveries to one incident',async()=>{
  const failure=await captureMonitoringPhase(adapter(),{ruleKey:'storage',phase:'failure',windowStart:start,now});
  const recovery=await captureMonitoringPhase(adapter(true),{ruleKey:'storage',phase:'recovery',windowStart:recovered,now});
  const proof=await verifyMonitoringRuleJourney(adapter(),{ruleKey:'storage',phases:[failure,recovery],acknowledgements:[acknowledgement],now});expect(proof.incidentId).toBe(incidentId);expect(proof.recoveryEventId).toBe('evt_recovery');
 });
 it.each(['candidate','config','incident','future'])('rejects resealed nested %s mismatch',async kind=>{
  const failure=await captureMonitoringPhase(adapter(),{ruleKey:'storage',phase:'failure',windowStart:start,now});
  const recovery=await captureMonitoringPhase(adapter(true),{ruleKey:'storage',phase:'recovery',windowStart:recovered,now});
  const changed={...failure,signal:{...failure.signal,...(kind==='candidate'?{candidateSha:'f'.repeat(40)}:kind==='config'?{configSha256:'f'.repeat(64)}:kind==='incident'?{incidentId:'55555555-5555-4555-8555-555555555555'}:{checkedAt:'2026-09-08T13:00:00.000Z'})}};
  await expect(verifyMonitoringRuleJourney(adapter(),{ruleKey:'storage',phases:[reseal(changed),recovery],acknowledgements:[acknowledgement],now})).rejects.toThrow('MONITORING_NESTED_IDENTITY_MISMATCH');
 });
 it('rejects email.sent even if an adapter returned it',async()=>{
  const a=adapter();a.deliveryEvent=async()=>({...events.firing,eventType:'email.sent'}) as never;
  await expect(captureMonitoringPhase(a,{ruleKey:'storage',phase:'failure',windowStart:start,now})).rejects.toThrow('MONITORING_DELIVERY_NOT_PROVEN');
 });
});
