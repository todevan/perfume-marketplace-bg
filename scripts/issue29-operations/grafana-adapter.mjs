import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ensure, OperationsError } from './manifest.mjs';
import { canonicalJson } from './recovery-set.mjs';

const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const alias = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/u);
const token = z.string().min(32).max(4096).regex(/^[!-~]+$/u);
const id = z.string().regex(/^[1-9][0-9]{0,17}$/u);
/** @param {unknown} value */
function digest(value) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
/** @param {string} value @param {RegExp} host */
function origin(value, host) {
  try {
    const u = new URL(value);
    ensure(u.protocol === 'https:' && host.test(u.hostname) && value === u.origin && !u.username && !u.password && !u.port, 'GRAFANA_ORIGIN_FORBIDDEN');
    return u.origin;
  } catch { throw new OperationsError('GRAFANA_ORIGIN_FORBIDDEN'); }
}
/** @typedef {{fetchImpl?:typeof fetch,now?:()=>string}} AdapterOptions */
/** Only this private transport touches provider response bodies. Never return an underlying error/cause.
 * @param {typeof fetch} fetchImpl @param {string} url @param {RequestInit} init @param {boolean} mutation
 */
async function request(fetchImpl, url, init, mutation = false) {
  try {
    const response = await fetchImpl(url, {...init, redirect:'manual', signal:AbortSignal.timeout(15_000)});
    if(response.status>=300)await response.body?.cancel().catch(()=>{});
    ensure(response.status < 300 || (!mutation && response.status === 404), mutation ? 'GRAFANA_MUTATION_UNCERTAIN_READBACK_ONLY' : 'GRAFANA_READBACK_UNAVAILABLE');
    ensure(response.status >= 200, 'GRAFANA_READBACK_UNAVAILABLE');
    if (response.status === 404) return {absent:true};
    if (response.status === 204) return {};
    const reader = response.body?.getReader();
    ensure(reader, 'GRAFANA_RESPONSE_INVALID');
    const parts = []; let length = 0;
    try {
      while (true) { const {done,value} = await reader.read(); if (done) break;
        length += value.byteLength; ensure(length <= 524_288, 'GRAFANA_RESPONSE_LIMIT'); parts.push(value); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!length) return {};
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch (error) {
    if (mutation) throw new OperationsError('GRAFANA_MUTATION_UNCERTAIN_READBACK_ONLY');
    if (error instanceof OperationsError) throw error;
    throw new OperationsError('GRAFANA_READBACK_UNAVAILABLE');
  }
}
const heartbeatConfigSchema = z.object({
  writeOrigin:z.string(), queryOrigin:z.string(), queryBasePath:z.enum(['/api/prom','/prometheus']),
  metricsInstanceId:id, writeToken:token, readToken:token, environmentAlias:alias, candidateSha:sha, configSha256:hash
}).strict();
const heartbeatSchema = z.object({ checkpointAt:z.iso.datetime(), candidateSha:sha, descriptorSha256:hash,
  configSha256:hash, artifactId:id }).strict();
/** @typedef {z.infer<typeof heartbeatConfigSchema>} HeartbeatConfig */
/** @typedef {z.infer<typeof heartbeatSchema>} BackupHeartbeat */
/** Narrow independent metrics capability; no Grafana administrative or Supabase credential needed.
 * Official contract: grafana.com/docs/grafana-cloud/send-data/metrics/metrics-influxdb/push-from-telegraf/
 * Influx measurement_field becomes the Prometheus series name. Original backup time is the VALUE;
 * verification/ingestion time cannot refresh the age of old recovery data.
 * @param {HeartbeatConfig} input @param {AdapterOptions} options
 */
export function createGrafanaHeartbeatAdapter(input, options = {}) {
  const parsed = heartbeatConfigSchema.safeParse(input); ensure(parsed.success, 'GRAFANA_HEARTBEAT_CONFIG_INVALID');
  const c = parsed.data; ensure(c.writeToken !== c.readToken, 'GRAFANA_CAPABILITIES_NOT_DISTINCT');
  const writeOrigin = origin(c.writeOrigin, /^influx-[a-z0-9-]+\.grafana\.net$/u);
  const queryOrigin = origin(c.queryOrigin, /^prometheus-[a-z0-9-]+\.grafana\.net$/u);
  const fetchImpl = options.fetchImpl ?? fetch, now = options.now ?? (() => new Date().toISOString());
  /** @param {BackupHeartbeat} raw */
  function validate(raw) {
    const p = heartbeatSchema.safeParse(raw); ensure(p.success, 'GRAFANA_HEARTBEAT_INVALID');
    const h = p.data, age = Date.parse(now()) - Date.parse(h.checkpointAt);
    ensure(h.candidateSha === c.candidateSha && h.configSha256 === c.configSha256 && age >= -300_000 && age <= 35 * 86_400_000, 'GRAFANA_HEARTBEAT_IDENTITY_OR_TIME');
    return h;
  }
  /** @param {BackupHeartbeat} h */
  function labels(h) { return {environment:c.environmentAlias,candidate:h.candidateSha,config:h.configSha256,descriptor:h.descriptorSha256,artifact:h.artifactId}; }
  return {
    /** Caller MUST persist intent before this one mutation; on ambiguity call verifyBackupHeartbeat, never repeat.
     * @param {BackupHeartbeat} raw */
    async publishBackupHeartbeat(raw) {
      const h = validate(raw), tags = Object.entries(labels(h)).map(([k,v])=>`${k}=${v}`).join(',');
      const body = `aromatika_ops_backup,${tags} checkpoint_seconds=${Date.parse(h.checkpointAt)/1000},verified=1 ${BigInt(Date.parse(now()))*1_000_000n}\naromatika_ops_backup_status,environment=${c.environmentAlias},candidate=${c.candidateSha},config=${c.configSha256} usable=1 ${BigInt(Date.parse(now()))*1_000_000n}\n`;
      await request(fetchImpl, `${writeOrigin}/api/v1/push/influx/write`, {method:'POST',headers:{
        Authorization:`Basic ${Buffer.from(`${c.metricsInstanceId}:${c.writeToken}`).toString('base64')}`,
        'Content-Type':'text/plain'},body},true);
      return {status:'submitted',checkpointAt:h.checkpointAt,evidenceSha256:digest({labels:labels(h),checkpointAt:h.checkpointAt})};
    },
    /** A definite integrity/decryption failure never overwrites or refreshes the latest good checkpoint.
     * @param {{candidateSha:string,configSha256:string,evidenceSha256:string}} raw */
    async publishBackupFailure(raw) {
      ensure(raw.candidateSha===c.candidateSha && raw.configSha256===c.configSha256 && hash.safeParse(raw.evidenceSha256).success,'GRAFANA_HEARTBEAT_IDENTITY_OR_TIME');
      const body=`aromatika_ops_backup_status,environment=${c.environmentAlias},candidate=${c.candidateSha},config=${c.configSha256} usable=0 ${BigInt(Date.parse(now()))*1_000_000n}\n`;
      await request(fetchImpl,`${writeOrigin}/api/v1/push/influx/write`,{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${c.metricsInstanceId}:${c.writeToken}`).toString('base64')}`,'Content-Type':'text/plain'},body},true);
      return {status:'submitted',reasonCode:'backup_integrity_failed',evidenceSha256:raw.evidenceSha256};
    },
    /** Verify remote data by exact private linkage after publication/ambiguous request. No current-time substitution.
     * @param {BackupHeartbeat} raw */
    async verifyBackupHeartbeat(raw) {
      const h = validate(raw), selector = Object.entries(labels(h)).map(([k,v])=>`${k}="${v}"`).join(',');
      const query = `last_over_time(aromatika_ops_backup_checkpoint_seconds{${selector}}[5m]) and last_over_time(aromatika_ops_backup_verified{${selector}}[5m]) == 1 and on(environment,candidate,config) last_over_time(aromatika_ops_backup_status_usable{environment="${c.environmentAlias}",candidate="${c.candidateSha}",config="${c.configSha256}"}[5m]) == 1`;
      const data = await request(fetchImpl, `${queryOrigin}${c.queryBasePath}/api/v1/query?${new URLSearchParams({query,time:now()})}`,{
        headers:{Authorization:`Basic ${Buffer.from(`${c.metricsInstanceId}:${c.readToken}`).toString('base64')}`}});
      const rows = data?.data?.result;
      ensure(data.status === 'success' && data.data?.resultType === 'vector' && Array.isArray(rows) && rows.length === 1 &&
        Object.entries(labels(h)).every(([k,v])=>rows[0].metric?.[k] === v) &&
        Number(rows[0].value?.[1]) === Date.parse(h.checkpointAt)/1000 &&
        Math.abs(Number(rows[0].value?.[0])*1000-Date.parse(now())) <= 300_000, 'GRAFANA_HEARTBEAT_READBACK_MISMATCH');
      return {status:'verified',...h,environmentAlias:c.environmentAlias,verifiedAt:now(),evidenceSha256:digest({labels:labels(h),checkpointAt:h.checkpointAt})};
    }
  };
}

export const GRAFANA_SIGNALS = Object.freeze(['health','auth','database','storage','email','deals','safety','backup_freshness','monitor_heartbeat']);
const monitorConfigSchema = z.object({
  stackSlug:alias, stackId:z.number().int().positive(), orgId:z.number().int().positive(), tenantId:z.number().int().positive(),
  namespace:z.string().regex(/^stacks-[1-9][0-9]*$/u), smOrigin:z.string(), cloudReadToken:token,
  stackToken:token, syntheticToken:token, monitorToken:z.string().regex(/^[A-Za-z0-9_-]{43,256}$/u).refine(value=>!value.startsWith('sb_')),
  privateEmail:z.email().max(254), environmentAlias:alias, runtimeEnvironment:z.enum(['development','staging']), runId:z.string().uuid(), candidateSha:sha,
  targetOrigin:z.string(), publicPath:z.string().regex(/^\/[a-zA-Z0-9/_-]*$/u),
  folderUid:alias, datasourceUid:alias, publicProbeId:z.number().int().positive(), k6ChannelId:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/u),
  metricsQueryOrigin:z.string(), metricsQueryBasePath:z.enum(['/api/prom','/prometheus']), metricsInstanceId:id, metricsReadToken:token,
  freePlanEvidence:z.object({stackId:z.number().int().positive(),plan:z.literal('free'),trial:z.literal(false),maxNewSpend:z.literal(0),
    providerPlan:z.string().min(1).max(64),observedAt:z.iso.datetime(),evidenceSha256:hash}).strict()
}).strict();
/** @typedef {z.infer<typeof monitorConfigSchema>} GrafanaConfig */
/** @typedef {{kind:'folder'|'secret'|'receiver'|'check'|'rule',key:string,payload:Record<string,any>}} Resource */
/** @param {string} metric @param {number} intervalSeconds
 * Grafana native hysteresis score: 2 fires, 1 holds prior state, 0 resolves.
 * Range functions use actual check samples, not repeated alert evaluations of the last cached point.
 */
function sampleScore(metric, intervalSeconds) {
  const range = `${metric}[${intervalSeconds*1000+1}ms]`;
  const n = `count_over_time(${range})`, min = `min_over_time(${range})`, max = `max_over_time(${range})`;
  const trigger = `clamp_max(((${min} > bool 0) * (${n} >= bool 2)) + (last_over_time(${range}) >= bool 2), 1)`;
  const recovery = `((${max} == bool 0) * (${n} >= bool 2))`;
  return `(sum(1 + ${trigger} - ${recovery})) or vector(2)`;
}
/** @param {GrafanaConfig} c @param {string} secretName */
function protectedScript(c, secretName) {
  // No URL, exception message, response body or secret is logged or used as a custom metric label.
  return `import http from 'k6/http';
import secrets from 'k6/secrets';
import { Gauge } from 'k6/metrics';
export const options = { maxRedirects:0, insecureSkipTLSVerify:false, systemTags:['status','method','name'], throw:false };
const names = ${JSON.stringify(GRAFANA_SIGNALS.filter(x=>!['backup_freshness','monitor_heartbeat'].includes(x)))};
const gauges = Object.fromEntries(names.map(n=>[n,new Gauge('aromatika_'+n)]));
const heartbeat = new Gauge('aromatika_monitor_checkpoint_seconds');
export default async function() {
  const values = Object.fromEntries(names.map(n=>[n,1]));
  try {
    const credential = await secrets.get(${JSON.stringify(secretName)});
    const r = http.get(${JSON.stringify(c.targetOrigin+'/api/operations/readiness')}, {headers:{Authorization:'Bearer '+credential},redirects:0,timeout:'12s',tags:{name:'issue29-readiness'}});
    if (r.status === 200 && typeof r.body === 'string' && r.body.length <= 32768) {
      const body = JSON.parse(r.body);
      const rows = body.schemaVersion === 1 && Array.isArray(body.signals) && body.signals.length === 9 ? body.signals : [];
      if(new Set(rows.map(s=>s.signal)).size===9) for (const n of names) {
        const s = rows.find(s=>s.signal===n);
        const identity = s && s.environment===${JSON.stringify(c.runtimeEnvironment)} && s.deploymentIdentity===${JSON.stringify(c.candidateSha)};
        const fresh = s && Number.isFinite(Date.parse(s.checkedAt)) && Math.abs(Date.now()-Date.parse(s.checkedAt))<=120000;
        const valid = identity && fresh && typeof s.ok==='boolean' && (s.ok ? s.severity==='none' && s.reasonCode==='healthy' : ['warning','critical'].includes(s.severity) && s.reasonCode!=='healthy') && s.runbookAnchor==='docs/INCIDENT-RESPONSE.md#'+n.replaceAll('_','-') && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s.correlationId);
        const immediate = s && ['deployment_identity_mismatch','storage_integrity_mismatch','deal_invariant_violation','safety_invariant_violation','email_canary_absent'].includes(s.reasonCode);
        values[n] = !identity ? 2 : !valid ? 1 : s.ok ? 0 : immediate ? 2 : 1;
      }
    }
  } catch { /* A sanitized failed sample, never exception/body logging. */ }
  for (const n of names) gauges[n].add(values[n]);
  heartbeat.add(Date.now()/1000);
}`;
}
/** @param {GrafanaConfig} c */
function resources(c) {
  const suffix = c.runId.replaceAll('-','').slice(0,10), prefix=`i29-${suffix}`;
  const secretName=`${prefix}-monitor`, receiverTitle=`${prefix}-owner-primary`;
  const configurationSha256=digest({version:1,stackId:c.stackId,orgId:c.orgId,tenantId:c.tenantId,environment:c.environmentAlias,
    candidate:c.candidateSha,runtimeEnvironment:c.runtimeEnvironment,target:c.targetOrigin,publicPath:c.publicPath,probe:c.publicProbeId,k6:c.k6ChannelId,
    folder:c.folderUid,datasource:c.datasourceUid,runId:c.runId,ruleContract:'raw-sample-hysteresis-v1',destinationAlias:'owner-primary'});
  const labels={issue29_run:c.runId,issue29_candidate:c.candidateSha,issue29_config:configurationSha256,environment:c.environmentAlias};
  /** @type {Resource[]} */ const result=[{kind:'folder',key:c.folderUid,payload:{uid:c.folderUid,title:`Issue29 ${suffix}`}}];
  result.push({kind:'secret',key:secretName,payload:{metadata:{name:secretName,namespace:c.namespace,labels:{'issue29-run':suffix}},
    spec:{description:'Issue29 read-only monitor',value:c.monitorToken,decrypters:['synthetic-monitoring']}}});
  // Receiver names are the base64url-encoded title in the v1beta1 compatibility API (provider owns UID).
  result.push({kind:'receiver',key:Buffer.from(receiverTitle).toString('base64url'),payload:{apiVersion:'notifications.alerting.grafana.app/v1beta1',kind:'Receiver',
    metadata:{namespace:c.namespace},spec:{title:receiverTitle,integrations:[{type:'email',version:'v1',disableResolveMessage:false,
      settings:{addresses:c.privateEmail,singleEmail:true}}]}}});
  const publicJob=`${prefix}-public`, protectedJob=`${prefix}-protected`;
  const common={enabled:true,timeout:15000,offset:0,probes:[c.publicProbeId],basicMetricsOnly:false,
    labels:Object.entries(labels).map(([name,value])=>({name,value})),folderUid:c.folderUid};
  const publicScript = `import http from 'k6/http';
import { Gauge } from 'k6/metrics';
export const options = {maxRedirects:0,insecureSkipTLSVerify:false,discardResponseBodies:true,systemTags:['status','method','name'],throw:false};
const health = new Gauge('aromatika_public_health');
export default function() {
  let state = 1;
  try { const r=http.get(${JSON.stringify(c.targetOrigin+c.publicPath)},{redirects:0,timeout:'12s',tags:{name:'issue29-public'}});
    const identity=r.headers['X-Deployed-Git-Sha'] ?? r.headers['x-deployed-git-sha'];
    state=r.status>=200 && r.status<300 && identity!==${JSON.stringify(c.candidateSha)} ? 2 : r.status===200 && identity===${JSON.stringify(c.candidateSha)} ? 0 : 1;
  } catch { /* Never log provider/network error bodies. */ }
  health.add(state);
}`;
  result.push({kind:'check',key:publicJob,payload:{...common,job:publicJob,target:c.targetOrigin+c.publicPath,frequency:300000,
    channels:{k6:{id:c.k6ChannelId}},settings:{scripted:{script:Buffer.from(publicScript).toString('base64')}}}});
  result.push({kind:'check',key:protectedJob,payload:{...common,job:protectedJob,target:c.targetOrigin+'/api/operations/readiness',frequency:600000,
    channels:{k6:{id:c.k6ChannelId}},settings:{scripted:{script:Buffer.from(protectedScript(c,secretName)).toString('base64')}}}});
  /** @param {string} signal @param {string} expr @param {string} severity @param {string} postfix @param {string} [keep] */
  function rule(signal,expr,severity,postfix='',keep='0s') {
    const key=`${prefix}-${signal.replaceAll('_','-')}${postfix}`;
    result.push({kind:'rule',key,payload:{uid:key,orgID:1,folderUID:c.folderUid,ruleGroup:`${prefix}-one-minute`,title:key,
      condition:'B',data:[{refId:'A',datasourceUid:c.datasourceUid,queryType:'',relativeTimeRange:{from:1200,to:0},
        model:{refId:'A',expr,instant:true,range:false,format:'time_series',datasource:{type:'prometheus',uid:c.datasourceUid}}},
      {refId:'B',datasourceUid:'__expr__',relativeTimeRange:{from:0,to:0},model:{refId:'B',type:'threshold',expression:'A',
        conditions:[{evaluator:{type:'gt',params:[1]},unloadEvaluator:{type:'lt',params:[1]}}]}}],
      noDataState:'Alerting',execErrState:'Alerting',for:'0s',keep_firing_for:keep,isPaused:false,
      labels:{...labels,signal,severity,destination_alias:'owner-primary'},
      annotations:{summary:`${signal}: ${severity}; verify exact target before action`,runbook_url:`docs/INCIDENT-RESPONSE.md#${signal.replaceAll('_','-')}`},
      notification_settings:{receiver:receiverTitle,group_by:['alertname','grafana_folder','issue29_run','issue29_candidate','issue29_config','signal'],
        group_wait:'0s',group_interval:'1m',repeat_interval:'4h'}}});
  }
  for(const signal of GRAFANA_SIGNALS.filter(x=>!['backup_freshness','monitor_heartbeat'].includes(x))) {
    const metric=`probe_aromatika_${signal}{job="${protectedJob}",instance="${c.targetOrigin}/api/operations/readiness"}`;
    rule(signal,sampleScore(metric,600),'critical');
  }
  // Public hostname/TLS/DNS/header checks are independent of the protected surface's availability.
  const publicMetric=`probe_aromatika_public_health{job="${publicJob}",instance="${c.targetOrigin+c.publicPath}"}`;
  rule('health',sampleScore(publicMetric,300),'critical','-public');
  const heartbeat=`probe_aromatika_monitor_checkpoint_seconds{job="${protectedJob}",instance="${c.targetOrigin}/api/operations/readiness"}`;
  rule('monitor_heartbeat',`(2 * (time() - max(last_over_time(${heartbeat}[1h])) > bool 1200)) or vector(2)`,'critical','','1m');
  const backup=`aromatika_ops_backup_checkpoint_seconds{environment="${c.environmentAlias}",candidate="${c.candidateSha}",config="${configurationSha256}"}`;
  const age=`(time() - max(last_over_time(${backup}[35d])))`;
  rule('backup_freshness',`(2 * (${age} > bool 86400)) or vector(2)`,'warning','-warning','1m');
  const usable=`min(last_over_time(aromatika_ops_backup_status_usable{environment="${c.environmentAlias}",candidate="${c.candidateSha}",config="${configurationSha256}"}[35d]))`;
  rule('backup_freshness',`(2 * clamp_max((${age} > bool 93600) + (${usable} != bool 1),1)) or vector(2)`,'critical','','1m');
  return {resources:result,configurationSha256,labels,publicJob,protectedJob,receiverTitle};
}
/** Build one selected Grafana integration, never a multi-provider interface.
 * Every resource operation has separate inspect/mutate/readback callbacks so the persisted operator
 * can record intent before exactly one create and resume ambiguous results by readback alone.
 * @param {GrafanaConfig} input @param {AdapterOptions} options */
export function createGrafanaAdapter(input, options={}) {
  const parsed=monitorConfigSchema.safeParse(input); ensure(parsed.success,'GRAFANA_CONFIG_INVALID');
  const c=parsed.data, now=options.now ?? (()=>new Date().toISOString()), fetchImpl=options.fetchImpl ?? fetch;
  ensure(c.namespace===`stacks-${c.stackId}` && new Set([c.cloudReadToken,c.stackToken,c.syntheticToken,c.monitorToken,c.metricsReadToken]).size===5,'GRAFANA_IDENTITY_OR_CAPABILITY_INVALID');
  const stackOrigin=`https://${c.stackSlug}.grafana.net`;
  const smOrigin=origin(c.smOrigin,/^synthetic-monitoring-api(?:-[a-z0-9-]+)?\.grafana\.net$/u);
  origin(c.targetOrigin,/^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.workers\.dev$/u);
  const queryOrigin=origin(c.metricsQueryOrigin,/^prometheus-[a-z0-9-]+\.grafana\.net$/u);
  const p=resources(c);
  /** @param {Resource} r */
  function summary(r) { return {kind:r.kind,key:r.key,configSha256:p.configurationSha256}; }
  const stackHeaders={Authorization:`Bearer ${c.stackToken}`,'Content-Type':'application/json'};
  const smHeaders={Authorization:`Bearer ${c.syntheticToken}`,'Content-Type':'application/json'};
  const receiverBase=`/apis/notifications.alerting.grafana.app/v1beta1/namespaces/${c.namespace}/receivers`;
  const secretBase=`/apis/secret.grafana.app/v1beta1/namespaces/${c.namespace}/securevalues`;
  const historyBase=`/apis/historian.alerting.grafana.app/v0alpha1/namespaces/${c.namespace}`;
  /** @param {string} path @param {RequestInit} [init] @param {boolean} [mutation] */
  const stack=(path,init={},mutation=false)=>request(fetchImpl,stackOrigin+path,{...init,headers:stackHeaders},mutation);
  /** @param {string} path @param {RequestInit} [init] @param {boolean} [mutation] */
  const sm=(path,init={},mutation=false)=>request(fetchImpl,smOrigin+path,{...init,headers:smHeaders},mutation);
  async function checks() {
    /** @type {Record<string,any>[]} */ const items=[]; let cursor=''; const seen=new Set();
    for(let page=0;page<5;page++) {
      const body=await sm('/api/v1/check?'+new URLSearchParams({page_size:'100',...(cursor?{cursor}:{})}));
      ensure(Array.isArray(body.items) && body.items.length<=100,'GRAFANA_CHECK_INVENTORY_INVALID');
      items.push(...body.items); if(!body.next_cursor) return items;
      ensure(typeof body.next_cursor==='string' && body.next_cursor.length<=1024 && !seen.has(body.next_cursor),'GRAFANA_PAGINATION_INVALID');
      cursor=body.next_cursor;seen.add(cursor);
    } throw new OperationsError('GRAFANA_INVENTORY_BOUND_EXCEEDED');
  }
  async function preflight() {
    const cost=c.freePlanEvidence;
    ensure(cost.stackId===c.stackId && Date.parse(now())-Date.parse(cost.observedAt)>=0 && Date.parse(now())-Date.parse(cost.observedAt)<=3600000,'GRAFANA_FREE_PLAN_EVIDENCE_STALE');
    const cloud=await request(fetchImpl,`https://grafana.com/api/instances/${c.stackSlug}`,{headers:{Authorization:`Bearer ${c.cloudReadToken}`}});
    ensure(cloud.id===c.stackId && cloud.orgId===c.orgId && cloud.slug===c.stackSlug && cloud.url===stackOrigin && cloud.status==='active' && cloud.trial===0 && cloud.plan===cost.providerPlan,'GRAFANA_STACK_IDENTITY_OR_PLAN_MISMATCH');
    const tenant=await sm('/api/v1/tenant');
    ensure(tenant.id===c.tenantId && tenant.orgId===c.orgId && tenant.stackId===c.stackId && tenant.status===0,'GRAFANA_TENANT_IDENTITY_MISMATCH');
    const limits=await sm('/api/v1/tenant/limits'), inventory=await checks();
    const missing=p.resources.filter(r=>r.kind==='check' && !inventory.some(x=>x.job===r.key)).length;
    ensure(Number.isInteger(limits.MaxChecks) && inventory.length+missing<=limits.MaxChecks &&
      Number.isInteger(limits.MaxScriptedChecks) && inventory.filter(x=>x.settings?.scripted).length+missing<=limits.MaxScriptedChecks,'GRAFANA_FREE_CAPACITY_INSUFFICIENT');
    // Count all existing enabled checks/probes rather than pretending an unrelated stack is empty.
    const monthly=inventory.filter(x=>x.enabled).reduce((n,x)=>n+(31*86400000/Math.max(x.frequency,1))*(x.probes?.length??0),0)+
      p.resources.filter(r=>r.kind==='check'&&!inventory.some(x=>x.job===r.key)).reduce((n,r)=>n+31*86400000/r.payload.frequency,0);
    ensure(Number.isFinite(monthly) && monthly<=90000,'GRAFANA_FREE_EXECUTION_BUDGET_EXCEEDED');
    const probes=await sm('/api/v1/probe');
    const probe=Array.isArray(probes)?probes.find(x=>x.id===c.publicProbeId):null;
    ensure(probe?.public===true && probe.online===true && probe.disabled===false && probe.deprecated===false && probe.capabilities?.disableScriptedChecks!==true && probe.k6Versions?.[c.k6ChannelId],'GRAFANA_PROBE_UNAVAILABLE');
    const organization=await stack('/api/org');ensure(organization.id===1,'GRAFANA_INTERNAL_ORGANIZATION_MISMATCH');
    const ds=await stack(`/api/datasources/uid/${c.datasourceUid}`);
    ensure(ds.uid===c.datasourceUid && ds.type==='prometheus' && ds.url===queryOrigin+c.metricsQueryBasePath && ds.basicAuthUser===c.metricsInstanceId,'GRAFANA_METRICS_DATASOURCE_MISMATCH');
    // Capability reads before writes: historian availability is required, not inferred from a green test send.
    const history=await stack(historyBase+'/notification/query',{method:'POST',body:JSON.stringify({type:'entries',from:now(),to:now(),limit:1})});
    ensure(Array.isArray(history.entries),'GRAFANA_NOTIFICATION_HISTORY_UNAVAILABLE');
    return {status:'verified',stackAlias:c.stackSlug,stackId:c.stackId,orgId:c.orgId,tenantId:c.tenantId,
      observedAt:now(),cost:0,monthlyApiExecutionUpperBound:Math.ceil(monthly),freePlanEvidenceSha256:cost.evidenceSha256,
      evidenceSha256:digest({stack:c.stackId,org:c.orgId,tenant:c.tenantId,costEvidence:cost.evidenceSha256,config:p.configurationSha256,at:now()})};
  }
  /** @param {string} key */
  function resource(key) { const r=p.resources.find(r=>r.key===key);ensure(r,'GRAFANA_RESOURCE_NOT_OWNED');return r; }
  /** @param {Resource} r @param {string} [resourceId] */
  async function readRaw(r,resourceId) {
    if(r.kind==='check') {
      const matches=(await checks()).filter(x=>x.job===r.key);
      ensure(matches.length<=1,'GRAFANA_RESOURCE_AMBIGUOUS');
      if(matches.length===0)return {absent:true};
      const raw=matches[0];ensure(!resourceId || String(raw.id)===resourceId,'GRAFANA_RESOURCE_ID_MISMATCH');return raw;
    }
    const paths={folder:`/api/folders/${r.key}`,secret:`${secretBase}/${r.key}`,receiver:`${receiverBase}/${r.key}`,rule:`/api/v1/provisioning/alert-rules/${r.key}`};
    return stack(paths[r.kind]);
  }
  /** Provider-added defaults are permitted; changed intended settings never are.
   * @param {unknown} expected @param {unknown} actual @returns {boolean} */
  function includes(expected,actual) {
    if(Array.isArray(expected))return Array.isArray(actual)&&actual.length===expected.length&&expected.every((x,i)=>includes(x,actual[i]));
    if(expected && typeof expected==='object')return !!actual&&typeof actual==='object'&&Object.entries(expected).every(([k,v])=>includes(v,/** @type {Record<string,unknown>} */(actual)[k]));
    return expected===actual;
  }
  /** @param {Resource} r @param {Record<string,any>} raw */
  function validateResource(r,raw) {
    let expected=r.payload;
    if(r.kind==='secret') expected={...r.payload,spec:{description:r.payload.spec.description,decrypters:['synthetic-monitoring']}};
    ensure(includes(expected,raw),'GRAFANA_RESOURCE_CONFIG_MISMATCH');
    if(r.kind==='receiver') ensure(raw.metadata?.name===r.key,'GRAFANA_RECEIVER_ID_MISMATCH');
    if(r.kind==='check') ensure(raw.tenantId===c.tenantId && Number.isSafeInteger(raw.id) && raw.id>0,'GRAFANA_CHECK_IDENTITY_MISMATCH');
    const resourceId=r.kind==='check'?String(raw.id):r.kind==='rule'||r.kind==='folder'?raw.uid:raw.metadata?.uid;
    ensure(typeof resourceId==='string' && resourceId.length>0 && resourceId.length<=128,'GRAFANA_RESOURCE_ID_INVALID');
    return {status:'verified',...summary(r),resourceId,evidenceSha256:digest({resource:summary(r),resourceId,at:now()}),readBackAt:now()};
  }
  /** @param {string} key @param {string} [resourceId] */
  async function readResource(key,resourceId) {
    const r=resource(key), raw=await readRaw(r,resourceId);
    if(raw.absent)return {status:'absent',...summary(r),resourceId:resourceId??null,readBackAt:now(),evidenceSha256:digest({resource:summary(r),absent:true,at:now()})};
    const receipt=validateResource(r,raw);ensure(!resourceId||receipt.resourceId===resourceId,'GRAFANA_RESOURCE_ID_MISMATCH');return receipt;
  }
  /** @param {string} key */
  function resourceOperation(key) {
    const r=resource(key);let inspectedAt=0,attempted=false;
    return {
      async inspect() {await preflight();const existing=await readResource(key);ensure(existing.status==='absent','GRAFANA_RESOURCE_ALREADY_EXISTS');inspectedAt=Date.parse(now());return existing;},
      async mutate() {
        ensure(inspectedAt>0 && Date.parse(now())-inspectedAt>=0 && Date.parse(now())-inspectedAt<=60000 && !attempted,'GRAFANA_PRE_MUTATION_INSPECTION_REQUIRED');
        attempted=true;
        if(r.kind==='check') await sm('/api/v1/check',{method:'POST',body:JSON.stringify(r.payload)},true);
        else {const paths={folder:'/api/folders',secret:secretBase,receiver:receiverBase,rule:'/api/v1/provisioning/alert-rules'};
          await stack(paths[r.kind],{method:'POST',body:JSON.stringify(r.payload)},true);}
      },
      readback:()=>readResource(key)
    };
  }
  /** @param {{ruleKey:string,status:'firing'|'resolved',from:string,to:string}} q */
  async function notificationHistory(q) {
    const r=resource(q.ruleKey);const begin=Date.parse(q.from),end=Date.parse(q.to);
    ensure(r.kind==='rule' && ['firing','resolved'].includes(q.status) && Number.isFinite(begin) && end>=begin && end-begin<=7200000 && end<=Date.parse(now())+300000,'GRAFANA_NOTIFICATION_WINDOW_INVALID');
    const body=await stack(historyBase+'/notification/query',{method:'POST',body:JSON.stringify({type:'entries',from:q.from,to:q.to,limit:100,
      receiver:p.receiverTitle,status:q.status,outcome:'success',ruleUID:r.key,
      groupLabels:Object.entries(p.labels).filter(([k])=>k!=='environment').map(([label,value])=>({type:'=',label,value}))})});
    ensure(Array.isArray(body.entries) && body.entries.length<100,'GRAFANA_NOTIFICATION_HISTORY_TRUNCATED');
    /** @type {{eventId:string,status:string,deliveredAt:string,destinationAlias:string,ruleKey:string,evidenceSha256:string}[]} */ const matches=[];
    const seen=new Set();
    for(const row of body.entries) {
      const time=Date.parse(row.timestamp);
      if(row.receiver!==p.receiverTitle||row.integration!=='email'||row.status!==q.status||row.outcome!=='success'||row.error||row.integrationIndex!==0||
        !Array.isArray(row.ruleUIDs)||row.ruleUIDs.length!==1||row.ruleUIDs[0]!==r.key||!Number.isFinite(time)||time<begin||time>end||
        !Object.entries(p.labels).filter(([k])=>k!=='environment').every(([k,v])=>row.groupLabels?.[k]===v))continue;
      ensure(typeof row.uuid==='string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(row.uuid) && !seen.has(row.uuid),'GRAFANA_NOTIFICATION_ID_INVALID');seen.add(row.uuid);
      matches.push({eventId:row.uuid,status:q.status,deliveredAt:new Date(time).toISOString(),destinationAlias:'owner-primary',ruleKey:r.key,
        evidenceSha256:digest({eventId:row.uuid,ruleKey:r.key,status:q.status,deliveredAt:row.timestamp,config:p.configurationSha256})});
    }
    return matches;
  }
  /** Real Grafana-managed rule state; a contact-point test is not a rule evaluation.
   * @param {string} key */
  async function readEvaluation(key) {
    const selected=resource(key);ensure(selected.kind==='rule','GRAFANA_RULE_REQUIRED');
    const config=await readResource(key);ensure(config.status==='verified','GRAFANA_RULE_CONFIG_UNVERIFIED');
    const response=await stack('/api/prometheus/grafana/api/v1/rules');
    ensure(response.status==='success' && Array.isArray(response.data?.groups) && !response.data.groupNextToken,'GRAFANA_RULE_STATE_UNAVAILABLE');
    const matches=response.data.groups.flatMap(/** @param {Record<string,any>} g */ g=>g.rules??[]).filter(/** @param {Record<string,any>} r */ r=>r.uid===key);
    ensure(matches.length===1,'GRAFANA_RULE_STATE_AMBIGUOUS');const r=matches[0];
    ensure(r.folderUid===c.folderUid && r.health==='ok' && !r.lastError && r.isPaused===false && ['firing','inactive','pending'].includes(r.state) &&
      Object.entries(selected.payload.labels).every(([k,v])=>r.labels?.[k]===v) &&
      Math.abs(Date.parse(now())-Date.parse(r.lastEvaluation))<=120000,'GRAFANA_RULE_STATE_MISMATCH');
    const firedAt=r.activeAt??r.alerts?.find(/** @param {Record<string,any>} a */ a=>a.state==='firing')?.activeAt??null;
    ensure(r.state!=='firing'||Number.isFinite(Date.parse(firedAt)),'GRAFANA_RULE_FIRED_TIME_MISSING');
    return {ruleKey:key,state:r.state,evaluatedAt:r.lastEvaluation,firedAt,candidateSha:c.candidateSha,configSha256:p.configurationSha256,
      evidenceSha256:digest({key,state:r.state,evaluatedAt:r.lastEvaluation,firedAt,config:p.configurationSha256})};
  }
  /** Independently execute the exact read-back rule's PromQL against its expected data tenant.
   * @param {string} key */
  async function readRuleScore(key) {
    const r=resource(key);ensure(r.kind==='rule','GRAFANA_RULE_REQUIRED');
    const response=await request(fetchImpl,queryOrigin+c.metricsQueryBasePath+'/api/v1/query?'+new URLSearchParams({query:r.payload.data[0].model.expr,time:now()}),
      {headers:{Authorization:`Basic ${Buffer.from(`${c.metricsInstanceId}:${c.metricsReadToken}`).toString('base64')}`}});
    const rows=response.data?.result;
    ensure(response.status==='success' && response.data?.resultType==='vector' && Array.isArray(rows) && rows.length===1 &&
      [0,1,2].includes(Number(rows[0].value?.[1])) && Math.abs(Number(rows[0].value?.[0])*1000-Date.parse(now()))<=120000,'GRAFANA_RULE_SCORE_UNAVAILABLE');
    return {ruleKey:key,score:Number(rows[0].value[1]),checkedAt:now(),candidateSha:c.candidateSha,configSha256:p.configurationSha256};
  }
  async function verifyConfiguration() {
    await preflight();const observed=[];
    for(const r of p.resources) {const receipt=await readResource(r.key);ensure(receipt.status==='verified','GRAFANA_CONFIGURATION_INCOMPLETE');observed.push(receipt);}
    const group=await stack(`/api/v1/provisioning/folder/${c.folderUid}/rule-groups/${p.resources.find(r=>r.kind==='rule')?.payload.ruleGroup}`);
    const expected=p.resources.filter(r=>r.kind==='rule').map(r=>r.key).sort();
    ensure(group.interval===60 && Array.isArray(group.rules) && canonicalJson(group.rules.map(/** @param {Record<string,any>} r */ r=>r.uid).sort())===canonicalJson(expected),'GRAFANA_EVALUATION_GROUP_MISMATCH');
    return {status:'verified',candidateSha:c.candidateSha,configSha256:p.configurationSha256,verifiedAt:now(),resources:observed,
      evidenceSha256:digest(observed)};
  }
  /** No folder deletion: a folder may acquire unrelated children; retain approved monitoring folder.
   * Parent must additionally bind this exact provider ID to its manifest-created disposable inventory.
   * @param {string} key @param {string} resourceId */
  function cleanupOperation(key,resourceId) {
    const r=resource(key);ensure(r.kind!=='folder','GRAFANA_FOLDER_CLEANUP_FORBIDDEN');let inspectedAt=0,attempted=false;
    /** @type {Record<string,any>|null} */let raw=null;
    return {
      async inspect() { raw=await readRaw(r,resourceId);ensure(raw && !raw.absent,'GRAFANA_RESOURCE_ALREADY_ABSENT');const receipt=validateResource(r,raw);
        ensure(receipt.resourceId===resourceId,'GRAFANA_RESOURCE_ID_MISMATCH');inspectedAt=Date.parse(now());return receipt;},
      async mutate() {ensure(raw && inspectedAt>0 && Date.parse(now())-inspectedAt>=0 && Date.parse(now())-inspectedAt<=60000 && !attempted,'GRAFANA_PRE_MUTATION_INSPECTION_REQUIRED');attempted=true;
        if(r.kind==='check')await sm(`/api/v1/check/${resourceId}`,{method:'DELETE'},true);
        else if(r.kind==='rule')await stack(`/api/v1/provisioning/alert-rules/${r.key}`,{method:'DELETE'},true);
        else await stack(`${r.kind==='secret'?secretBase:receiverBase}/${r.key}`,{method:'DELETE',body:JSON.stringify({apiVersion:'v1',kind:'DeleteOptions',preconditions:{uid:resourceId,resourceVersion:raw.metadata?.resourceVersion}})},true);
      },
      async readback() {const receipt=await readResource(key,resourceId);ensure(receipt.status==='absent','GRAFANA_CLEANUP_ABSENCE_NOT_PROVEN');return receipt;}
    };
  }
  return {
    assertCredentialSeparation(/** @type {string[]} */ forbidden) {ensure(!forbidden.some(value=>[c.stackToken,c.syntheticToken,c.monitorToken,c.cloudReadToken,c.metricsReadToken].includes(value)),'GRAFANA_CROSS_PROVIDER_CREDENTIAL_FORBIDDEN');},
    preflight, resourceOperation, readResource, notificationHistory, readEvaluation, readRuleScore, verifyConfiguration, cleanupOperation,
    configuration() { return {schemaVersion:1,evidenceMode:options.fetchImpl && options.fetchImpl!==fetch?'deterministic-http-fixture':'provider-readback',runId:c.runId,targetOrigin:c.targetOrigin,runtimeEnvironment:c.runtimeEnvironment,stackAlias:c.stackSlug,environmentAlias:c.environmentAlias,candidateSha:c.candidateSha,
      configSha256:p.configurationSha256,destinationAlias:'owner-primary',signals:[...GRAFANA_SIGNALS],
      checks:p.resources.filter(r=>r.kind==='check').map(r=>({key:r.key,frequencyMs:r.payload.frequency})),resources:p.resources.map(summary)}; }
  };
}
