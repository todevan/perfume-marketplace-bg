import {constants} from 'node:fs';
import {open,unlink,readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {assertPrivatePath,ensure,OperationsError,readPrivateManifest,writePrivateManifest,assertOwnedSource} from './manifest.mjs';
import {canonicalJson} from './recovery-set.mjs';
import {attestCandidateWorktree} from '../issue22-hosted/candidate.mjs';
import {readSourceReleaseBinding} from './source-binding.mjs';
import {createSupabaseOperationsAdapter} from './supabase-adapter.mjs';
import {createIssue29WorkerAdapter,readIssue29WorkerBinding,workerNameFor,issue29WorkerSettingsSchema} from './worker-adapter.mjs';
import {createGrafanaAdapter,createGrafanaRuleFixtureAdapter,grafanaConfigSchema} from './grafana-adapter.mjs';
import {hasCurrentPremergeOwnerCopy,monitoringExecutionSettingsSchema} from './monitoring-execution.mjs';
const hash=z.string().regex(/^[a-f0-9]{64}$/u),sha=z.string().regex(/^[a-f0-9]{40}$/u),secret=z.string().min(16).max(4096).regex(/^[!-~]+$/u),id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u),utc=z.iso.datetime();
/** @param {unknown} value */const digest=value=>createHash('sha256').update(Buffer.isBuffer(value)?value:canonicalJson(value)).digest('hex');
const localGateIds=['supabase-reset','database-lint','database-pgtap','database-contracts','generated-types','application-tests','svelte-check','browser','dependency-audit','cloudflare-staging-dry-run','cloudflare-production-dry-run','local-recovery'];
const commandSchema=z.strictObject({id,command:z.string().min(1).max(1024),candidateSha:sha,treeSha:sha,startedAt:utc,completedAt:utc,exitCode:z.literal(0),outputSha256:hash,testReportSha256:hash.optional()});
const reviewSchema=z.strictObject({role:z.enum(['engineering','adversarial']),reviewerAlias:id,candidateSha:sha,treeSha:sha,completedAt:utc,verdict:z.literal('PASS'),unresolvedBlockers:z.literal(0),reportSha256:hash});
const stageSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('issue29-stage04-verification'),candidateSha:sha,treeSha:sha,baseSha:sha,branch:z.string().min(1).max(128),configSha256:hash,lockfileSha256:hash,fixtureSha256:hash,changedFiles:z.array(z.strictObject({path:z.string().regex(/^(?!\/|.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_.\/-]+$/u),acceptance:z.array(z.number().int().min(1).max(5)).min(1)})).min(1),focused:z.array(hash).min(1).max(100),full:z.array(hash).length(localGateIds.length),reviews:z.array(hash).length(2)});
/** Validate original Stage04 artifacts rather than a generic PASS timestamp. Raw command output,
 * machine-readable Vitest test reports and the two actual final-SHA reviewer artifacts remain private.
 * @param {unknown} value @param {(hash:string)=>Buffer|undefined} readEvidence @param {import('./manifest.mjs').Candidate} candidate */
export function validateStage04Evidence(value,readEvidence,candidate){
 const parsed=stageSchema.safeParse(value);ensure(parsed.success,'STAGE04_EVIDENCE_INVALID');const s=parsed.data;ensure(s.candidateSha===candidate.sha&&s.treeSha===candidate.tree,'STAGE04_CANDIDATE_MISMATCH');
 /** @param {string} key */function bytes(key){const b=readEvidence(key);ensure(Buffer.isBuffer(b)&&b.length>0&&b.length<=16777216&&digest(b)===key,'STAGE04_REFERENCED_EVIDENCE_INVALID');return b;}
 /** @param {string} key */function json(key){try{return JSON.parse(bytes(key).toString('utf8'));}catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('STAGE04_REFERENCED_EVIDENCE_INVALID');}}
 let discovered=0,allowedLocalHostedSkips=0;
 /** @type {string[]} */
 const fullIds=[];
 /** @type {number[]} */
 const completion=[];
 for(const [phase,refs]of /** @type {const} */([['focused',s.focused],['full',s.full]]))for(const key of refs){
  const result=commandSchema.safeParse(json(key));ensure(result.success,'STAGE04_COMMAND_EVIDENCE_INVALID');const c=result.data;ensure(c.candidateSha===candidate.sha&&c.treeSha===candidate.tree&&Date.parse(c.completedAt)>=Date.parse(c.startedAt),'STAGE04_CANDIDATE_MISMATCH');bytes(c.outputSha256);completion.push(Date.parse(c.completedAt));if(phase==='full')fullIds.push(c.id);
  if(phase==='full'&&['database-pgtap','database-contracts','application-tests','browser'].includes(c.id))ensure(c.testReportSha256,'STAGE04_TEST_REPORT_REQUIRED');
  if(c.testReportSha256){const discovery=testDiscovery(bytes(c.testReportSha256),phase==='full'&&c.id==='browser');discovered+=discovery.passed;allowedLocalHostedSkips+=discovery.skipped;}
 }
 ensure(new Set(fullIds).size===localGateIds.length&&localGateIds.every(k=>fullIds.includes(k))&&discovered>0,'STAGE04_FULL_GATE_INCOMPLETE');
 const reviews=s.reviews.map(key=>{const result=reviewSchema.safeParse(json(key));ensure(result.success,'STAGE04_REVIEW_EVIDENCE_INVALID');const r=result.data;ensure(r.candidateSha===candidate.sha&&r.treeSha===candidate.tree&&Date.parse(r.completedAt)>=Math.max(...completion),'STAGE04_REVIEW_CANDIDATE_MISMATCH');const text=bytes(r.reportSha256).toString('utf8');ensure(text.includes(candidate.sha)&&text.includes(candidate.tree)&&text.includes('PASS'),'STAGE04_REVIEW_REPORT_MISMATCH');return r;});
 ensure(new Set(reviews.map(r=>r.role)).size===2&&new Set(reviews.map(r=>r.reviewerAlias)).size===2,'STAGE04_INDEPENDENT_REVIEWS_REQUIRED');
 return{candidateSha:s.candidateSha,treeSha:s.treeSha,discoveredTests:discovered,allowedLocalHostedSkips,fullGateCount:fullIds.length,reviews:reviews.map(r=>({role:r.role,reviewerAlias:r.reviewerAlias,reportSha256:r.reportSha256})),configSha256:s.configSha256,lockfileSha256:s.lockfileSha256};
}
/** Native reporter output; only existing explicitly protected hosted suites may skip in the full
 * local browser gate. Focused/hosted evidence never inherits this exception.
 * @param {Buffer} bytes @param {boolean} allowLocalHostedSkips */
function testDiscovery(bytes,allowLocalHostedSkips){
 const text=bytes.toString('utf8');let report;try{report=JSON.parse(text);}catch{
  const native=Object.fromEntries([...text.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(m=>[m[1],Number(m[2])]));
  if(native.tests!==undefined){ensure(native.tests>0&&native.pass===native.tests&&native.fail===0&&native.cancelled===0&&native.skipped===0&&native.todo===0,'STAGE04_TEST_DISCOVERY_INVALID');return{passed:native.tests,skipped:0};}
  const match=/Files=\d+,\s*Tests=(\d+),/u.exec(text);ensure(match&&Number(match[1])>0&&text.includes('All tests successful.')&&/Result:\s*PASS/u.test(text),'STAGE04_TEST_DISCOVERY_INVALID');return{passed:Number(match[1]),skipped:0};
 }
 ensure(report&&typeof report==='object'&&!Array.isArray(report),'STAGE04_TEST_DISCOVERY_INVALID');
 if('numTotalTests'in report){ensure(report.success===true&&Number.isSafeInteger(report.numTotalTests)&&report.numTotalTests>0&&report.numPassedTests===report.numTotalTests&&report.numFailedTests===0&&report.numPendingTests===0&&Array.isArray(report.testResults)&&report.testResults.length>0,'STAGE04_TEST_DISCOVERY_INVALID');const assertions=report.testResults.flatMap((/** @type {any} */r)=>r.assertionResults??[]);ensure(assertions.length===report.numTotalTests&&assertions.every((/** @type {any} */r)=>r.status==='passed'),'STAGE04_TEST_DISCOVERY_INVALID');return{passed:report.numTotalTests,skipped:0};}
 ensure(report.stats&&Number.isSafeInteger(report.stats.expected)&&report.stats.expected>0&&report.stats.unexpected===0&&report.stats.flaky===0&&Number.isSafeInteger(report.stats.skipped)&&report.stats.skipped>=0&&Array.isArray(report.suites),'STAGE04_TEST_DISCOVERY_INVALID');
 let count=0,nodes=0,skipped=0,hostedSkips=0,duplicateViewportSkips=0;
 /** @param {any[]} suites @param {number} depth @param {string} inheritedFile */
 function walk(suites,depth,inheritedFile){ensure(depth<32,'STAGE04_TEST_DISCOVERY_INVALID');for(const suite of suites){ensure(++nodes<=100000,'STAGE04_TEST_DISCOVERY_INVALID');const file=suite.file??inheritedFile;for(const spec of suite.specs??[]){ensure(spec.ok===true&&Array.isArray(spec.tests)&&spec.tests.length>0,'STAGE04_TEST_DISCOVERY_INVALID');for(const t of spec.tests){
  if(t.status==='skipped'){
   const path=spec.file??file;
   const real=/^(?:tests\/e2e\/)?real-beta\.spec\.ts$/u.test(path),reports=/^(?:tests\/e2e\/)?hosted-report-evidence\.spec\.ts$/u.test(path);
   const titles=real?['seller → buyer → offer → chat → deal → review','moderator reaches the AAL2 moderation queue']:reports?['executes all ten target-locked scenarios','executes the checkpointed Issue #24 moderation-safety proof','cleans only the persisted A10 manifest under A11']:[];
   const reasons=real?['Set E2E_REAL_RUN=true to run the state-changing real-beta suite.','Real-beta mutations run once in the desktop Chromium project.']:['Hosted report-evidence verification requires both explicit real-run flags and every approved secure input.','Hosted mutations run once in the desktop project.'];
   const annotations=Array.isArray(t.annotations)&&t.annotations.some((/** @type {any} */a)=>a.type==='skip'&&reasons.includes(a.description));
   const hosted=allowLocalHostedSkips&&titles.includes(spec.title)&&['chromium','mobile'].includes(t.projectName)&&annotations;
   const duplicateViewport=allowLocalHostedSkips&&/^(?:tests\/e2e\/)?marketplace\.spec\.ts$/u.test(path)&&spec.title==='core pages do not create document-level overflow at acceptance viewports'&&t.projectName==='mobile'&&Array.isArray(t.annotations)&&t.annotations.some((/** @type {any} */a)=>a.type==='skip'&&a.description==='One Chromium matrix covers the exact widths.');
   ensure((hosted||duplicateViewport)&&t.expectedStatus==='skipped'&&Array.isArray(t.results)&&t.results.every((/** @type {any} */r)=>r.status==='skipped'),'STAGE04_UNAPPROVED_TEST_SKIP');if(hosted)hostedSkips++;if(duplicateViewport)duplicateViewportSkips++;skipped++;
  }else{ensure(t.status==='expected'&&t.expectedStatus==='passed'&&Array.isArray(t.results)&&t.results.length===1&&t.results[0].status==='passed','STAGE04_TEST_DISCOVERY_INVALID');count++;}
 }}walk(suite.suites??[],depth+1,file);}}
 walk(report.suites,0,'');ensure(count===report.stats.expected&&skipped===report.stats.skipped&&hostedSkips<=10&&duplicateViewportSkips<=1&&skipped<=11,'STAGE04_TEST_DISCOVERY_INVALID');return{passed:count,skipped};
}
/** Existing exact-SHA app/database gate with complete bounded readback and sanitized errors.
 * @param {{repository:string,candidateSha:string,readToken:string,now?:string,fetchImpl?:typeof fetch}} options */
export async function verifyExactCandidateCi(options){
 ensure(options.repository==='todevan/perfume-marketplace-bg'&&sha.safeParse(options.candidateSha).success&&secret.safeParse(options.readToken).success,'CI_SETTINGS_INVALID');
 try{const response=await(options.fetchImpl??fetch)(`https://api.github.com/repos/${options.repository}/commits/${options.candidateSha}/check-runs?per_page=100&filter=latest`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${options.readToken}`,'X-GitHub-Api-Version':'2026-03-10'}});ensure(response.ok&&!response.headers.get('link')?.includes('rel="next"'),'EXACT_CANDIDATE_CI_UNAVAILABLE');const payload=JSON.parse((await boundedBody(response,2097152)).toString('utf8'));ensure(Array.isArray(payload.check_runs)&&payload.total_count===payload.check_runs.length&&payload.check_runs.length<=100,'EXACT_CANDIDATE_CI_INCOMPLETE');
 const checks=['app','database'].map(name=>{const matches=payload.check_runs.filter((/** @type {any} */r)=>r.name===name&&r.app?.slug==='github-actions');ensure(matches.length===1&&matches[0].head_sha===options.candidateSha&&matches[0].status==='completed'&&matches[0].conclusion==='success'&&Number.isSafeInteger(matches[0].id),'EXACT_CANDIDATE_CI_NOT_GREEN');return{name,id:matches[0].id,status:'completed',conclusion:'success'};});
 return{schemaVersion:1,kind:'issue29-exact-candidate-ci',evidenceMode:options.fetchImpl?'deterministic-http-fixture':'provider-readback',repository:options.repository,candidateSha:options.candidateSha,checkedAt:options.now??new Date().toISOString(),checks};
 }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('EXACT_CANDIDATE_CI_UNAVAILABLE');}
}
/** @param {Response} response @param {number} maximum */async function boundedBody(response,maximum){ensure(response.body,'VERIFICATION_RESPONSE_INVALID');const r=response.body.getReader(),parts=[];let length=0;try{for(;;){const p=await r.read();if(p.done)break;length+=p.value.length;ensure(length<=maximum,'VERIFICATION_RESPONSE_LIMIT');parts.push(Buffer.from(p.value));}}finally{await r.cancel();r.releaseLock();}return Buffer.concat(parts);}
/** @param {string} path @param {string} root @param {number} [maximum] */
async function privateBytes(path,root,maximum=65536){try{await assertPrivatePath(path,root);const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=await h.stat();ensure(st.isFile()&&st.nlink===1&&(st.mode&0o777)===0o600&&st.size<=maximum,'VERIFICATION_PRIVATE_FILE_UNSAFE');return await h.readFile();}finally{await h.close();}}catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('VERIFICATION_PRIVATE_FILE_UNAVAILABLE');}}
/** @param {string} path @param {string} root */
async function privateJson(path,root){try{return JSON.parse((await privateBytes(path,root)).toString('utf8'));}catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('VERIFICATION_PRIVATE_JSON_INVALID');}}
/** @param {unknown} value @param {string} directory @param {string} root */async function store(value,directory,root){const b=Buffer.from(canonicalJson(value)),hash=digest(b),path=join(directory,`${hash}.json`);await assertPrivatePath(path,root);try{const h=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{await h.writeFile(b);await h.sync();}finally{await h.close();}}catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='EEXIST')throw error;ensure((await privateBytes(path,root,16777216)).equals(b),'VERIFICATION_EVIDENCE_COLLISION');}return hash;}
/** @typedef {{manifestPath:string,settingsPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,clock?:()=>string}} ExecutionOptions */
/** @template T @param {ExecutionOptions} options @param {(m:import('./manifest.mjs').OperationsManifest,save:()=>Promise<void>,now:()=>string)=>Promise<T>} operation */
async function transaction(options,operation){const clock=options.clock??(()=>new Date().toISOString());await assertPrivatePath(options.manifestPath,options.repositoryRoot);let lock;try{lock=await open(options.manifestPath+'.lock',constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch{throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}try{const m=await readPrivateManifest(options.manifestPath,{repositoryRoot:options.repositoryRoot,candidate:options.candidate,now:clock()});ensure(!m.pending&&!m.terminal&&!m.humanBoundary,'PENDING_OPERATION_REQUIRES_READBACK');return await operation(m,()=>writePrivateManifest(options.manifestPath,m,{repositoryRoot:options.repositoryRoot,candidate:options.candidate,now:clock(),replace:true}),clock);}finally{await lock.close();await unlink(options.manifestPath+'.lock');}}
const implementationSchema=z.strictObject({schemaVersion:z.literal(1),operation:z.literal('implementation-verified'),repository:z.literal('todevan/perfume-marketplace-bg'),githubReadToken:secret,evidenceDirectory:z.string(),stage04Sha256:hash,configPath:z.string()});
/** Read existing final-candidate evidence; never run reviews or fabricate their outcome.
 * @param {ExecutionOptions} options @param {{fetchImpl?:typeof fetch}} [dependencies] */
export async function executeImplementationVerification(options,dependencies={}){
 const parsed=implementationSchema.safeParse(await privateJson(options.settingsPath,options.repositoryRoot));ensure(parsed.success,'IMPLEMENTATION_SETTINGS_INVALID');const s=parsed.data;
 return transaction(options,async(m,save,clock)=>{
  ensure(m.allowedActions.includes('implementation-verified')&&['source_verified','preflighted','implementation_verified'].includes(m.state),'IMPLEMENTATION_STATE_INVALID');assertOwnedSource(m);await attestCandidateWorktree(options.repositoryRoot,m.candidate.sha);
  const stageBytes=await privateBytes(join(s.evidenceDirectory,`${s.stage04Sha256}.json`),options.repositoryRoot,16777216);ensure(digest(stageBytes)===s.stage04Sha256,'STAGE04_EVIDENCE_INVALID');const stage=stageSchema.parse(JSON.parse(stageBytes.toString()));
  const refs=[...stage.focused,...stage.full,...stage.reviews];const map=new Map();for(const key of refs){const b=await privateBytes(join(s.evidenceDirectory,`${key}.json`),options.repositoryRoot,16777216);map.set(key,b);const p=JSON.parse(b.toString());for(const child of [p.outputSha256,p.testReportSha256,p.reportSha256].filter(Boolean)){ensure(hash.safeParse(child).success,'STAGE04_EVIDENCE_INVALID');map.set(child,await privateBytes(join(s.evidenceDirectory,`${child}.json`),options.repositoryRoot,16777216));}}
  const local=validateStage04Evidence(stage,key=>map.get(key),m.candidate);ensure(digest(await readFile(join(options.repositoryRoot,'pnpm-lock.yaml')))===local.lockfileSha256&&digest(await privateBytes(s.configPath,options.repositoryRoot,16777216))===local.configSha256,'STAGE04_LOCAL_PROVENANCE_MISMATCH');
  const ci=await verifyExactCandidateCi({repository:s.repository,candidateSha:m.candidate.sha,readToken:s.githubReadToken,fetchImpl:dependencies.fetchImpl,now:clock()});const proof={schemaVersion:1,kind:'issue29-implementation-verification',runId:m.runId,candidate:m.candidate,stage04Sha256:s.stage04Sha256,local,ci,verifiedAt:clock()};const evidenceSha256=await store(proof,dirname(options.manifestPath),options.repositoryRoot);
  m.history.push({step:'implementation-verified',operationId:randomUUID(),completedAt:proof.verifiedAt,resourceId:null,evidenceSha256});m.state='implementation_verified';await save();return{state:m.state,evidenceSha256,discoveredTests:local.discoveredTests};
 });
}

const workerRead=z.strictObject({settings:issue29WorkerSettingsSchema,privateDirectory:z.string(),readToken:secret});
const finalSchema=z.strictObject({schemaVersion:z.literal(1),operation:z.literal('cleanup'),action:z.literal('finalize'),providerToken:secret,capabilityId:id,sourceMonitoringSettingsPath:z.string(),sourceWorker:workerRead,
 workers:z.array(z.strictObject({resourceId:id,settings:issue29WorkerSettingsSchema,readToken:secret})).max(100),
 grafanaGroups:z.array(z.strictObject({config:grafanaConfigSchema,fixture:z.strictObject({writeOrigin:z.url(),writeToken:secret,expiresAt:utc}).optional(),resources:z.array(z.strictObject({key:id,resourceId:id})).min(1).max(100)})).max(100),
 silences:z.array(z.strictObject({config:grafanaConfigSchema,maintenance:z.strictObject({id:z.uuid(),authorizedAt:utc,expiresAt:utc,sourceConfigSha256:hash}),ruleKey:id,resourceId:z.uuid()})).max(200)});
/** @typedef {{fetchImpl?:typeof fetch,supabaseFactory?:typeof createSupabaseOperationsAdapter,workerFactory?:typeof createIssue29WorkerAdapter,sourceBinding?:typeof readSourceReleaseBinding,workerBinding?:typeof readIssue29WorkerBinding,grafanaFactory?:typeof createGrafanaAdapter,fixtureFactory?:typeof createGrafanaRuleFixtureAdapter}} CleanupDependencies */
/** Finalization performs only fresh readback. It never invokes DELETE, expire, deploy or another
 * mutation as a fallback. Every disposable identity must already have a recorded absence.
 * @param {ExecutionOptions} options @param {CleanupDependencies} [dependencies] */
export async function executeFinalizeCleanup(options,dependencies={}){
 const parsed=finalSchema.safeParse(await privateJson(options.settingsPath,options.repositoryRoot));ensure(parsed.success,'FINAL_CLEANUP_SETTINGS_INVALID');const s=parsed.data;
 return transaction(options,async(m,save,clock)=>{
  ensure(m.allowedActions.includes('cleanup')&&m.capabilityIds.cleanup===s.capabilityId&&m.cleanup.authorized,'CLEANUP_AUTHORITY_REQUIRED');const source=assertOwnedSource(m);
  ensure(m.maintenance?.phase==='closed'&&m.maintenance.endedAt&&m.state!=='planned','CLOSED_MAINTENANCE_REQUIRED');
  const disposable=m.cleanup.resources.filter(r=>r.disposition==='disposable');ensure(disposable.length>0&&disposable.every(r=>r.absentAt!==null),'DISPOSABLE_ABSENCE_REQUIRED');
  ensure(m.cleanup.resources.filter(r=>r.disposition==='persistent').every(r=>r.absentAt===null),'PERSISTENT_RESOURCE_RETENTION_REQUIRED');
  const monitoring=monitoringExecutionSettingsSchema.safeParse(await privateJson(s.sourceMonitoringSettingsPath,options.repositoryRoot));ensure(monitoring.success,'FINAL_SOURCE_MONITORING_SETTINGS_INVALID');const ms=monitoring.data;
  const privateCapabilities=[s.providerToken,s.sourceWorker.readToken,ms.binding.providerToken,ms.binding.source.serviceKey,ms.binding.deployment.readToken,...s.workers.map(w=>w.readToken)];
  for(const config of [ms.grafana,...s.grafanaGroups.map(g=>g.config),...s.silences.map(g=>g.config)])ensure(!privateCapabilities.some(value=>[config.stackToken,config.syntheticToken,config.cloudReadToken,config.metricsReadToken,config.monitorToken].includes(value)),'GRAFANA_CROSS_PROVIDER_CREDENTIAL_FORBIDDEN');
  ensure(!s.grafanaGroups.some(g=>g.fixture&&privateCapabilities.includes(g.fixture.writeToken)),'GRAFANA_CROSS_PROVIDER_CREDENTIAL_FORBIDDEN');
  const mapping=new Map();for(const w of s.workers){ensure(w.settings.purpose==='target'&&w.settings.accountId===s.sourceWorker.settings.accountId&&w.settings.subdomain===s.sourceWorker.settings.subdomain&&!mapping.has(w.resourceId),'FINAL_CLEANUP_MAPPING_INVALID');mapping.set(w.resourceId,'cloudflare');}
  for(const group of s.grafanaGroups){ensure(group.config.runId===m.runId&&(group.config.targetRole==='target'||group.fixture),'FINAL_CLEANUP_MAPPING_INVALID');const g=group.fixture?(dependencies.fixtureFactory??createGrafanaRuleFixtureAdapter)(group.config,group.fixture,{fetchImpl:dependencies.fetchImpl,now:clock}):(dependencies.grafanaFactory??createGrafanaAdapter)(group.config,{fetchImpl:dependencies.fetchImpl,now:clock});
   for(const item of group.resources){const r=g.configuration().resources.find(r=>r.key===item.key);ensure(r&&r.kind!=='folder','FINAL_CLEANUP_MAPPING_INVALID');const ownedId=`${r.kind}:${item.resourceId}`;ensure(!mapping.has(ownedId),'FINAL_CLEANUP_MAPPING_INVALID');mapping.set(ownedId,'grafana');}}
  for(const silence of s.silences){ensure(silence.config.runId===m.runId&&(silence.config.targetRole??'source')==='source'&&!mapping.has(`silence:${silence.resourceId}`),'FINAL_CLEANUP_MAPPING_INVALID');mapping.set(`silence:${silence.resourceId}`,'grafana');}
  const providerMapped=disposable.filter(r=>['cloudflare','grafana'].includes(r.provider));ensure(mapping.size===providerMapped.length&&providerMapped.every(r=>mapping.get(r.id)===r.provider),'FINAL_CLEANUP_MAPPING_INCOMPLETE');ensure(disposable.every(r=>['supabase','supabase-storage','cloudflare','grafana'].includes(r.provider)),'FINAL_CLEANUP_PROVIDER_UNSUPPORTED');
  const observations=[];const adapter=(dependencies.supabaseFactory??createSupabaseOperationsAdapter)({token:s.providerToken,fetch:dependencies.fetchImpl,clock});
  for(const owned of disposable.filter(r=>r.provider==='supabase')){
   ensure(owned.id!==source.ref&&!m.preservedRefs.includes(owned.id),'PRESERVED_PROJECT_FORBIDDEN');
   const proof=await adapter.readOwnedDisposableAbsent({manifest:m,resourceId:owned.id});ensure(proof.absent===true,'FINAL_PROJECT_ABSENCE_UNPROVEN');observations.push({provider:'supabase',resourceId:owned.id,proof});
  }
  for(const owned of disposable.filter(r=>r.provider==='supabase-storage')){const parentRef=owned.id.split(':')[1];ensure(observations.some(o=>o.provider==='supabase'&&o.resourceId===parentRef),'FINAL_STORAGE_PARENT_ABSENCE_REQUIRED');observations.push({provider:'supabase-storage',resourceId:owned.id,parentProjectRef:parentRef,absence:'parent-project-independently-absent'});}
  for(const w of s.workers){const match=/^issue29-restore-([a-f0-9-]{36})$/u.exec(w.resourceId);ensure(match&&z.uuid().safeParse(match[1]).success,'FINAL_WORKER_IDENTITY_INVALID');const scope=structuredClone(m);scope.maintenance={...m.maintenance,id:match[1]};ensure(workerNameFor(scope,'target')===w.resourceId,'FINAL_WORKER_IDENTITY_INVALID');
   const worker=(dependencies.workerFactory??createIssue29WorkerAdapter)({settings:w.settings,readToken:w.readToken,privateDirectory:s.sourceWorker.privateDirectory,repositoryRoot:options.repositoryRoot},{fetchImpl:dependencies.fetchImpl,now:clock});const proof=await worker.readAbsent({manifest:scope,operationId:m.runId});ensure(proof.absent===true&&proof.workerName===w.resourceId,'FINAL_WORKER_ABSENCE_UNPROVEN');observations.push({provider:'cloudflare',resourceId:w.resourceId,proof});}
  for(const group of s.grafanaGroups){const g=group.fixture?(dependencies.fixtureFactory??createGrafanaRuleFixtureAdapter)(group.config,group.fixture,{fetchImpl:dependencies.fetchImpl,now:clock}):(dependencies.grafanaFactory??createGrafanaAdapter)(group.config,{fetchImpl:dependencies.fetchImpl,now:clock});for(const item of group.resources){const kind=g.configuration().resources.find(r=>r.key===item.key)?.kind;const proof=await g.cleanupOperation(item.key,item.resourceId).readback();ensure(proof.status==='absent','FINAL_GRAFANA_ABSENCE_UNPROVEN');observations.push({provider:'grafana',resourceId:`${kind}:${item.resourceId}`,proof});}}
  for(const silence of s.silences){const g=(dependencies.grafanaFactory??createGrafanaAdapter)(silence.config,{fetchImpl:dependencies.fetchImpl,now:clock});const proof=await g.maintenanceSilenceOperation({...silence,action:'expire'}).readback();ensure(proof.status==='expired'&&proof.effectiveAbsence===true&&proof.resourceId===silence.resourceId,'FINAL_SILENCE_ABSENCE_UNPROVEN');observations.push({provider:'grafana',resourceId:`silence:${silence.resourceId}`,proof});}
  const g=(dependencies.grafanaFactory??createGrafanaAdapter)(ms.grafana,{fetchImpl:dependencies.fetchImpl,now:clock}),config=g.configuration();
  ensure((ms.grafana.targetRole??'source')==='source'&&config.runId===m.runId&&config.candidateSha===m.candidate.sha&&config.configSha256===m.grafana.configSha256&&config.stackAlias===m.grafana.stackAlias&&config.destinationAlias==='owner-primary'&&config.targetOrigin===ms.binding.deployment.origin&&ms.binding.source.apiUrl===source.url&&s.sourceWorker.settings.purpose==='source','FINAL_PERSISTENT_MONITOR_IDENTITY_MISMATCH');
  const sourceBinding=await(dependencies.sourceBinding??readSourceReleaseBinding)({manifest:m,settings:ms.binding,fetchImpl:dependencies.fetchImpl,now:clock()});const workerBinding=await(dependencies.workerBinding??readIssue29WorkerBinding)({...s.sourceWorker,manifest:m,repositoryRoot:options.repositoryRoot},{fetchImpl:dependencies.fetchImpl,now:clock});
  const configuration=await g.verifyConfiguration();
  const rules=[];
  const deferBackupFreshness=await hasCurrentPremergeOwnerCopy(m,options.manifestPath,options.repositoryRoot,clock());
  const monitoredRules=config.resources.filter(r=>r.kind==='rule'&&!(deferBackupFreshness&&r.key.includes('backup-freshness')));
  ensure(Array.isArray(configuration.resources)&&configuration.resources.length===16&&configuration.candidateSha===m.candidate.sha&&configuration.configSha256===config.configSha256&&configuration.resources.every(r=>m.cleanup.resources.some(owned=>owned.provider==='grafana'&&owned.id===`${r.kind}:${r.resourceId}`&&owned.disposition==='persistent'&&owned.absentAt===null)),'PERSISTENT_MONITOR_OWNERSHIP_INCOMPLETE');
for(const rule of monitoredRules){const score=await g.readRuleScore(rule.key),evaluation=await g.readEvaluation(rule.key);ensure(score.score===0&&evaluation.state==='inactive','PERSISTENT_MONITOR_NOT_GREEN');rules.push({score,evaluation});}ensure(rules.length===monitoredRules.length,'PERSISTENT_MONITOR_INVENTORY_INCOMPLETE');
  ensure(observations.length===disposable.length,'FINAL_CLEANUP_INVENTORY_INCOMPLETE');
  const proof={schemaVersion:1,kind:'issue29-final-cleanup',evidenceMode:Object.keys(dependencies).length?'deterministic-http-fixture':'provider-readback',runId:m.runId,candidate:m.candidate,maintenanceId:m.maintenance.id,maintenanceEndedAt:m.maintenance.endedAt,verifiedAt:clock(),observations,persistent:{sourceBinding,workerBinding,configuration,rules},deferredBackupFreshness:deferBackupFreshness,retainedResources:m.cleanup.resources.filter(r=>r.disposition==='persistent').map(r=>({provider:r.provider,id:r.id})),maximumCost:0};
  const observationSha256=[];for(const observation of observations)observationSha256.push(await store(observation,dirname(options.manifestPath),options.repositoryRoot));
  const persistentSha256=Object.fromEntries(await Promise.all(Object.entries(proof.persistent).map(async([key,value])=>[key,await store(value,dirname(options.manifestPath),options.repositoryRoot)])));
  const evidenceSha256=await store({...proof,observationSha256,persistentSha256},dirname(options.manifestPath),options.repositoryRoot);m.history.push({step:'cleanup',operationId:randomUUID(),resourceId:m.maintenance.id,completedAt:proof.verifiedAt,evidenceSha256});m.state='cleanup_verified';await save();return{state:m.state,evidenceSha256,disposableCount:observations.length,persistentCount:proof.retainedResources.length};
 });
}

const generationRecords=z.strictObject(Object.fromEntries(['monitor','alerts','application','incident','isolation','decryption','secondaryCopy','contacts','cleanup','latestDescriptor'].map(key=>[key,hash])));
const generationSchema=z.strictObject({schemaVersion:z.literal(1),operation:z.literal('generate-receipt'),records:generationRecords,evidenceFiles:z.array(z.strictObject({sha256:hash,path:z.string()})).min(1).max(1000),evidenceDirectory:z.string(),artifact:z.strictObject({repository:z.literal('todevan/perfume-marketplace-bg'),repositoryId:z.number().int().positive(),runId:z.number().int().positive(),runAttempt:z.literal(1),candidateSha:sha,artifactId:z.number().int().positive(),artifactName:z.string().min(1).max(128),expectedArchiveSha256:hash,maxBytes:z.number().int().positive().max(134217728),token:secret})});
/** Generate the one public readiness receipt from real history-bound private outputs; the only
 * human assertion accepted is the explicitly private owner contact/key-custody attestation.
 * Artifact bytes are independently read back here because ephemeral runner receipts are not retained.
 * @param {ExecutionOptions} options */
export async function executeGenerateOperationsReceipt(options){
 const parsed=generationSchema.safeParse(await privateJson(options.settingsPath,options.repositoryRoot));ensure(parsed.success,'READINESS_GENERATION_SETTINGS_INVALID');const s=parsed.data;
 return transaction(options,async(m,_save,clock)=>{
  ensure(m.state==='cleanup_verified'&&m.maintenance?.phase==='closed'&&m.candidate.sha===s.artifact.candidateSha,'READINESS_GENERATION_STATE_INVALID');assertOwnedSource(m);
  const {assembleOperationsReadiness}=await import('./readiness.mjs'),{verifyGitHubArtifact}=await import('./artifact-store.mjs');
  const evidence=new Map();let totalBytes=0;for(const file of s.evidenceFiles){ensure(!evidence.has(file.sha256),'READINESS_EVIDENCE_DUPLICATE');const bytes=await privateBytes(file.path,options.repositoryRoot,1048576);totalBytes+=bytes.length;ensure(totalBytes<=16777216&&digest(bytes)===file.sha256,'READINESS_EVIDENCE_HASH_MISMATCH');evidence.set(file.sha256,bytes);}
  const artifact=await verifyGitHubArtifact({...s.artifact,expectedDescriptorSha256:s.records.latestDescriptor,now:clock()});const artifactSha256=digest(artifact);evidence.set(artifactSha256,Buffer.from(canonicalJson(artifact)));
  const assembled=assembleOperationsReadiness({manifest:m,records:{...s.records,artifact:artifactSha256},now:Date.parse(clock()),readEvidence:key=>evidence.get(key),runbookSha256:digest(await readFile(join(options.repositoryRoot,'docs/INCIDENT-RESPONSE.md')))});
  for(const [key,bytes]of assembled.evidence){ensure(digest(bytes)===key,'READINESS_EVIDENCE_HASH_MISMATCH');const path=join(s.evidenceDirectory,key+'.json');await assertPrivatePath(path,options.repositoryRoot);try{const h=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}}catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='EEXIST')throw error;ensure((await privateBytes(path,options.repositoryRoot,1048576)).equals(bytes),'READINESS_EVIDENCE_COLLISION');}}
  const receiptSha256=await store(assembled.receipt,s.evidenceDirectory,options.repositoryRoot),expectedSha256=await store(assembled.expected,s.evidenceDirectory,options.repositoryRoot);
  return{status:'OPERATIONS_READINESS_RECEIPT_GENERATED',receiptSha256,expectedSha256,latestDescriptorSha256:assembled.latestDescriptorSha256,rehearsedDescriptorSha256:assembled.rehearsedDescriptorSha256};
 });
}
