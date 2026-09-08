import { z } from 'zod';
import { ensure, OperationsError } from './manifest.mjs';

const hash=z.string().regex(/^[a-f0-9]{64}$/u),sha=z.string().regex(/^[a-f0-9]{40}$/u),token=z.string().regex(/^[A-Za-z0-9_-]{43,256}$/u);
const schema=z.strictObject({origin:z.url(),writeToken:token,readToken:token,environmentAlias:z.string().regex(/^[a-z][a-z0-9-]{0,62}$/u),candidateSha:sha,configSha256:hash});
/** @typedef {z.infer<typeof schema>} HeartbeatConfig */
const checkpoint=z.strictObject({checkpointAt:z.iso.datetime(),candidateSha:sha,descriptorSha256:hash,configSha256:hash,artifactId:z.string().regex(/^[1-9][0-9]{0,24}$/u),artifactSha256:hash});
const failure=z.strictObject({candidateSha:sha,configSha256:hash,evidenceSha256:hash});
const readback=z.strictObject({schemaVersion:z.literal(1),environment:z.string(),release:sha,backupRelease:sha.nullable(),configSha256:hash,checkpointAt:z.iso.datetime().nullable(),descriptorSha256:hash.nullable(),artifactSha256:hash.nullable(),integrityFailureEvidenceSha256:hash.nullable()});

/** @param {Response} response */
async function boundedJson(response){
 ensure(response.body,'MONITOR_CHECKPOINT_RESPONSE_INVALID');const reader=response.body.getReader();const chunks=[];let size=0;
 try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;ensure(size<=16384,'MONITOR_CHECKPOINT_RESPONSE_INVALID');chunks.push(next.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** Publish only after the existing backup executor has proved encrypted artifact retention.
 * Readback binds the original backup time and both hashes; sending never advances freshness locally.
 * @param {HeartbeatConfig} raw @param {{fetchImpl?:typeof fetch,now?:()=>string}} [options] */
export function createMonitorHeartbeatAdapter(raw,options={}){
 const parsed=schema.safeParse(raw);ensure(parsed.success,'HEARTBEAT_CONFIG_INVALID');const c=parsed.data,u=new URL(c.origin);
 ensure(c.origin===u.origin&&u.protocol==='https:'&&u.hostname.endsWith('.workers.dev')&&!u.port&&!u.username&&!u.password&&c.readToken!==c.writeToken,'HEARTBEAT_CONFIG_INVALID');
 const fetcher=options.fetchImpl??fetch,now=options.now??(()=>new Date().toISOString());
 /** @param {string} path @param {Record<string,unknown>} [body] */
 async function request(path,body){try{
  const response=await fetcher(c.origin+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${body?c.writeToken:c.readToken}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(body){await response.body?.cancel();ensure(response.status===204,'MONITOR_CHECKPOINT_MUTATION_UNCERTAIN_READBACK_ONLY');return null;}
  ensure(response.ok,'MONITOR_CHECKPOINT_READBACK_UNAVAILABLE');const p=readback.safeParse(await boundedJson(response));ensure(p.success,'MONITOR_CHECKPOINT_READBACK_INVALID');
  ensure(p.data.environment===c.environmentAlias&&p.data.release===c.candidateSha&&p.data.configSha256===c.configSha256,'MONITOR_CHECKPOINT_IDENTITY_MISMATCH');return p.data;
 }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError(body?'MONITOR_CHECKPOINT_MUTATION_UNCERTAIN_READBACK_ONLY':'MONITOR_CHECKPOINT_READBACK_UNAVAILABLE');}}
 /** @param {z.infer<typeof checkpoint>} value */
 function validCheckpoint(value){const p=checkpoint.safeParse(value);ensure(p.success&&p.data.candidateSha===c.candidateSha&&p.data.configSha256===c.configSha256,'HEARTBEAT_TARGET_MISMATCH');return p.data;}
 /** @param {z.infer<typeof failure>} value */
 function validFailure(value){const p=failure.safeParse(value);ensure(p.success&&p.data.candidateSha===c.candidateSha&&p.data.configSha256===c.configSha256,'HEARTBEAT_TARGET_MISMATCH');return p.data;}
 return {
  /** @param {z.infer<typeof checkpoint>} value */
  async publishBackupHeartbeat(value){const p=validCheckpoint(value);await request('/ops/monitor/backup-checkpoint',{schemaVersion:1,environment:c.environmentAlias,release:c.candidateSha,checkpointAt:p.checkpointAt,descriptorSha256:p.descriptorSha256,artifactSha256:p.artifactSha256});return{status:'submitted-readback-required'};},
  /** @param {z.infer<typeof checkpoint>} value */
  async verifyBackupHeartbeat(value){const p=validCheckpoint(value),r=await request('/ops/monitor/backup-checkpoint');ensure(r&&r.backupRelease===c.candidateSha&&r.checkpointAt===p.checkpointAt&&r.descriptorSha256===p.descriptorSha256&&r.artifactSha256===p.artifactSha256&&r.integrityFailureEvidenceSha256===null,'MONITOR_CHECKPOINT_READBACK_MISMATCH');return{status:'verified',...p,verifiedAt:now()};},
  /** @param {z.infer<typeof failure>} value */
  async publishBackupFailure(value){const p=validFailure(value);await request('/ops/monitor/backup-failure',{schemaVersion:1,environment:c.environmentAlias,release:c.candidateSha,evidenceSha256:p.evidenceSha256});return{status:'submitted-readback-required'};},
  /** @param {z.infer<typeof failure>} value */
  async verifyBackupFailure(value){const p=validFailure(value),r=await request('/ops/monitor/backup-checkpoint');ensure(r&&r.integrityFailureEvidenceSha256===p.evidenceSha256,'MONITOR_FAILURE_READBACK_MISMATCH');return{status:'verified',...p,verifiedAt:now()};}
 };
}
