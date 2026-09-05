import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ensure } from './manifest.mjs';
import { canonicalJson } from './recovery-set.mjs';

/** @typedef {ReturnType<import('./grafana-adapter.mjs').createGrafanaAdapter>} GrafanaAdapter */
/** @param {unknown} value */
function digest(value) {return createHash('sha256').update(canonicalJson(value)).digest('hex');}

/** Read-only proof phase. Fault/recovery changes belong in separate persisted manifest-owned
 * mutations, never inside this function or a production fault-injection endpoint.
 * @param {GrafanaAdapter} adapter
 * @param {{ruleKey:string,phase:'failure'|'recovery',windowStart:string,now?:string}} input
 */
export async function captureMonitoringPhase(adapter,input) {
  const p=adapter.configuration(),now=input.now??new Date().toISOString();
  ensure(['failure','recovery'].includes(input.phase) && Date.parse(input.windowStart)<=Date.parse(now) &&
    Date.parse(now)-Date.parse(input.windowStart)<=7200000,'MONITORING_PROOF_WINDOW_INVALID');
  const evaluation=await adapter.readEvaluation(input.ruleKey),score=await adapter.readRuleScore(input.ruleKey);
  ensure(evaluation.state===(input.phase==='failure'?'firing':'inactive') && score.score===(input.phase==='failure'?2:0),'MONITORING_PHASE_NOT_OBSERVED');
  ensure(Date.parse(evaluation.evaluatedAt)>=Date.parse(input.windowStart),'MONITORING_EVALUATION_PRECEDES_WINDOW');
  const events=await adapter.notificationHistory({ruleKey:input.ruleKey,status:input.phase==='failure'?'firing':'resolved',from:input.windowStart,to:now});
  ensure(events.length>0,'MONITORING_DELIVERY_NOT_PROVEN');
  const event=events.sort((a,b)=>Date.parse(a.deliveredAt)-Date.parse(b.deliveredAt))[0];
  if(input.phase==='failure')ensure(evaluation.firedAt && Date.parse(evaluation.firedAt)>=Date.parse(input.windowStart) && Date.parse(event.deliveredAt)>=Date.parse(evaluation.firedAt),'MONITORING_DELIVERY_PRECEDES_FAILURE');
  const body={schemaVersion:1,evidenceMode:p.evidenceMode,runId:p.runId,candidateSha:p.candidateSha,configSha256:p.configSha256,
    ruleKey:input.ruleKey,phase:input.phase,windowStart:input.windowStart,observedAt:now,evaluation,score,event};
  return {...body,evidenceSha256:digest(body)};
}
const phaseSchema=z.object({schemaVersion:z.literal(1),evidenceMode:z.enum(['provider-readback','deterministic-http-fixture']),runId:z.string().uuid(),
  candidateSha:z.string().regex(/^[a-f0-9]{40}$/u),configSha256:z.string().regex(/^[a-f0-9]{64}$/u),ruleKey:z.string(),phase:z.enum(['failure','recovery']),
  windowStart:z.iso.datetime(),observedAt:z.iso.datetime(),evaluation:z.object({ruleKey:z.string(),state:z.enum(['firing','inactive','pending']),evaluatedAt:z.iso.datetime(),firedAt:z.iso.datetime().nullable(),candidateSha:z.string(),configSha256:z.string(),evidenceSha256:z.string()}).strict(),
  score:z.object({ruleKey:z.string(),score:z.number(),checkedAt:z.iso.datetime(),candidateSha:z.string(),configSha256:z.string()}).strict(),
  event:z.object({eventId:z.string(),status:z.enum(['firing','resolved']),deliveredAt:z.iso.datetime(),destinationAlias:z.literal('owner-primary'),ruleKey:z.string(),evidenceSha256:z.string()}).strict(),
  evidenceSha256:z.string().regex(/^[a-f0-9]{64}$/u)}).strict();
/** @typedef {z.infer<typeof phaseSchema>} MonitoringPhase */
/** @typedef {{ruleKey:string,failureEventId:string,acknowledgedAt:string,roleAlias:'owner'|'authorized-operator',inboxEvidenceSha256:string}} Acknowledgement */
/** Verify a single real failure/recovery journey for the controlled incident drill as well as
 * the all-rule acceptance proof; always re-read the exact notification event identities.
 * @param {GrafanaAdapter} adapter
 * @param {{ruleKey:string,phases:MonitoringPhase[],acknowledgements:Acknowledgement[],now?:string}} input
 */
export async function verifyMonitoringRuleJourney(adapter,input) {
  const p=adapter.configuration(),key=input.ruleKey,now=input.now??new Date().toISOString();
  ensure(p.resources.some(r=>r.kind==='rule'&&r.key===key),'MONITORING_RULE_UNKNOWN');
    const matched=input.phases.filter(x=>x.ruleKey===key);
    const eventIds=new Set();
    ensure(matched.length===2,'MONITORING_RULE_COVERAGE_INCOMPLETE');
    for(const raw of matched) {
      const parsed=phaseSchema.safeParse(raw);ensure(parsed.success,'MONITORING_PHASE_INVALID');const {evidenceSha256,...body}=parsed.data;
      ensure(digest(body)===evidenceSha256 && body.runId===p.runId && body.candidateSha===p.candidateSha && body.configSha256===p.configSha256 &&
        body.evidenceMode===p.evidenceMode && Date.parse(now)-Date.parse(body.observedAt)>=0 && Date.parse(now)-Date.parse(body.observedAt)<=7200000,
        'MONITORING_PHASE_IDENTITY_OR_HASH_MISMATCH');
      ensure(body.evaluation.ruleKey===key && body.score.ruleKey===key && body.event.ruleKey===key &&
        body.evaluation.candidateSha===p.candidateSha && body.score.candidateSha===p.candidateSha &&
        body.evaluation.configSha256===p.configSha256 && body.score.configSha256===p.configSha256,
        'MONITORING_NESTED_IDENTITY_MISMATCH');
      const start=Date.parse(body.windowStart),end=Date.parse(body.observedAt);
      ensure(end>=start && end-start<=7200000 && [body.evaluation.evaluatedAt,body.score.checkedAt,body.event.deliveredAt]
        .every(at=>Date.parse(at)>=start && Date.parse(at)<=end) && end-Date.parse(body.score.checkedAt)<=120000 &&
        end-Date.parse(body.evaluation.evaluatedAt)<=120000 &&
        (body.phase!=='failure' || (body.evaluation.firedAt!==null && Date.parse(body.evaluation.firedAt)>=start &&
          Date.parse(body.evaluation.firedAt)<=Date.parse(body.event.deliveredAt))), 'MONITORING_PHASE_WINDOW_MISMATCH');
      const events=await adapter.notificationHistory({ruleKey:key,status:body.event.status,from:body.windowStart,to:now});
      ensure(events.some(e=>canonicalJson(e)===canonicalJson(body.event)) && !eventIds.has(body.event.eventId),'MONITORING_EVENT_READBACK_MISMATCH');
      eventIds.add(body.event.eventId);
    }
    const failure=matched.find(x=>x.phase==='failure'),recovery=matched.find(x=>x.phase==='recovery');
    ensure(failure && recovery && failure.event.status==='firing' && recovery.event.status==='resolved' &&
      failure.score.score===2 && recovery.score.score===0 && failure.evaluation.state==='firing' && recovery.evaluation.state==='inactive' &&
      Date.parse(recovery.windowStart)>Date.parse(failure.event.deliveredAt) && Date.parse(recovery.event.deliveredAt)>Date.parse(failure.event.deliveredAt),
      'MONITORING_RECOVERY_SEQUENCE_INVALID');
    const a=input.acknowledgements.filter(a=>a.ruleKey===key);ensure(a.length===1,'MONITORING_ACKNOWLEDGEMENT_MISSING');const ack=a[0];
    const elapsed=Date.parse(ack.acknowledgedAt)-Date.parse(failure.event.deliveredAt);
    ensure(ack.failureEventId===failure.event.eventId && ['owner','authorized-operator'].includes(ack.roleAlias) && /^[a-f0-9]{64}$/u.test(ack.inboxEvidenceSha256) &&
      elapsed>=0 && elapsed<=900000 && Date.parse(ack.acknowledgedAt)<=Date.parse(recovery.event.deliveredAt),'MONITORING_ACKNOWLEDGEMENT_INVALID');
    return {ruleKey:key,destinationAlias:'owner-primary',firedAt:failure.evaluation.firedAt,deliveredAt:failure.event.deliveredAt,
      acknowledgedAt:ack.acknowledgedAt,recoveryEvaluatedAt:recovery.evaluation.evaluatedAt,recoveryDeliveredAt:recovery.event.deliveredAt,
      failureEventId:failure.event.eventId,recoveryEventId:recovery.event.eventId,ackEvidenceSha256:ack.inboxEvidenceSha256};
}

/** Assemble only generated, hash-bound phases and independently re-read every notification identity.
 * Human acknowledgement proves the private destination was actually received; Grafana's success
 * means its email integration accepted delivery, not that a human opened the inbox.
 * @param {GrafanaAdapter} adapter
 * @param {{phases:MonitoringPhase[],acknowledgements:Acknowledgement[],now?:string}} input
 */
export async function verifyMonitoringProof(adapter,input) {
  const p=adapter.configuration(),now=input.now??new Date().toISOString(),expected=p.resources.filter(r=>r.kind==='rule').map(r=>r.key);
  ensure(input.phases.length===expected.length*2 && input.acknowledgements.length===expected.length,'MONITORING_RULE_COVERAGE_INCOMPLETE');
  const configuration=await adapter.verifyConfiguration();
  const timelines=[];const eventIds=new Set();
  for(const key of expected) {
    const timeline=await verifyMonitoringRuleJourney(adapter,{...input,ruleKey:key});
    ensure(!eventIds.has(timeline.failureEventId)&&!eventIds.has(timeline.recoveryEventId),'MONITORING_EVENT_READBACK_MISMATCH');
    eventIds.add(timeline.failureEventId);eventIds.add(timeline.recoveryEventId);timelines.push(timeline);
  }
  const result={schemaVersion:1,status:p.evidenceMode==='provider-readback'?'verified':'deterministic-only',evidenceMode:p.evidenceMode,
    candidateSha:p.candidateSha,configSha256:p.configSha256,runId:p.runId,environmentAlias:p.environmentAlias,destinationAlias:'owner-primary',
    verifiedAt:now,configurationEvidenceSha256:configuration.evidenceSha256,timelines};
  return {...result,evidenceSha256:digest(result)};
}
