import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ensure,OperationsError} from './manifest.mjs';
import {canonicalJson} from './recovery-set.mjs';
const hash=z.string().regex(/^[a-f0-9]{64}$/u),sha=z.string().regex(/^[a-f0-9]{40}$/u),utc=z.iso.datetime();
const contextSchema=z.strictObject({runId:z.uuid(),maintenanceId:z.uuid(),targetRef:z.string().regex(/^[a-z]{20}$/u),candidateSha:sha,treeSha:sha,deploymentId:z.string().regex(/^[a-zA-Z0-9-]{1,128}$/u),operationId:z.uuid(),startedAt:utc});
/** @typedef {z.infer<typeof contextSchema>} BrowserContext */
/** @param {unknown} value */
const digest=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
export const APPLICATION_TEST_TITLES=Object.freeze(['seller → buyer → offer → chat → deal → review','moderator reaches the AAL2 moderation queue']);
/** Validate actual pinned Playwright JSON report, not caller-asserted success booleans. Full reporter
 * contents stay private; the public proof has only fixed test labels, counts, times, identities/hash.
 * @param {any} report @param {BrowserContext} context @param {string} now */
export function validateApplicationReport(report,context,now){
 ensure(contextSchema.safeParse(context).success&&utc.safeParse(now).success,'APPLICATION_CONTEXT_INVALID');
 ensure(canonicalJson(report?.config?.metadata?.issue29)===canonicalJson(context)&&report.config.workers===1&&report.config.forbidOnly===true,'APPLICATION_REPORT_IDENTITY_MISMATCH');
 const projects=report.config.projects;ensure(Array.isArray(projects)&&projects.length===1&&projects[0].name==='chromium'&&projects[0].retries===0&&projects[0].repeatEach===1,'APPLICATION_BROWSER_POLICY_MISMATCH');
 const stats=report.stats;ensure(stats&&stats.expected===2&&stats.unexpected===0&&stats.flaky===0&&stats.skipped===0&&Array.isArray(report.errors)&&report.errors.length===0,'APPLICATION_TESTS_INCOMPLETE');
 const start=Date.parse(stats.startTime),finish=start+stats.duration;
 ensure(utc.safeParse(stats.startTime).success&&Number.isFinite(stats.duration)&&stats.duration>0&&stats.duration<=1800000&&start>=Date.parse(context.startedAt)&&finish<=Date.parse(now)+5000,'APPLICATION_REPORT_TIME_INVALID');
 /** @type {any[]} */const specs=[];
 /** @param {any[]} suites @param {number} depth */
 function visit(suites,depth){ensure(Array.isArray(suites)&&suites.length<=4&&depth<5,'APPLICATION_REPORT_INVENTORY_INVALID');for(const suite of suites){ensure(suite.file==='real-beta.spec.ts'&&Array.isArray(suite.specs),'APPLICATION_REPORT_INVENTORY_INVALID');specs.push(...suite.specs);if(suite.suites)visit(suite.suites,depth+1);}}
 visit(report.suites,0);ensure(specs.length===2&&APPLICATION_TEST_TITLES.every(title=>specs.filter(s=>s.title===title).length===1),'APPLICATION_TEST_DISCOVERY_MISMATCH');
 for(const spec of specs){ensure(spec.ok===true&&spec.file==='real-beta.spec.ts'&&Array.isArray(spec.tests)&&spec.tests.length===1,'APPLICATION_TESTS_INCOMPLETE');const t=spec.tests[0];
  ensure(t.projectName==='chromium'&&t.expectedStatus==='passed'&&t.status==='expected'&&Array.isArray(t.results)&&t.results.length===1,'APPLICATION_TESTS_INCOMPLETE');const r=t.results[0];
  ensure(r.status==='passed'&&r.retry===0&&!r.error&&['errors','attachments','stdout','stderr'].every(key=>Array.isArray(r[key])&&r[key].length===0),'APPLICATION_TEST_OR_PRIVATE_OUTPUT_INVALID');
  ensure(utc.safeParse(r.startTime).success&&Date.parse(r.startTime)>=start&&Number.isFinite(r.duration)&&r.duration>=0&&Date.parse(r.startTime)+r.duration<=finish+5000,'APPLICATION_REPORT_TIME_INVALID');
 }
 return{schemaVersion:1,kind:'issue29-application-browser',...context,testCount:2,tests:[...APPLICATION_TEST_TITLES],startedAt:stats.startTime,finishedAt:new Date(finish).toISOString(),reportSha256:digest(report)};
}

import {join,resolve} from 'node:path';
/** Build only a fixed Playwright invocation against the exact target. No inherited real-beta
 * credentials or arbitrary Node options; headed challenges are completed by the authorized human.
 * @param {{repositoryRoot:string,privateDirectory:string,browserSettingsPath:string,origin:string,context:BrowserContext}} input
 * @param {NodeJS.ProcessEnv} [environment] */
export function applicationBrowserPlan(input,environment=process.env){
 ensure(contextSchema.safeParse(input.context).success,'APPLICATION_CONTEXT_INVALID');
 const origin=new URL(input.origin);ensure(origin.protocol==='https:'&&origin.origin===input.origin&&origin.hostname.startsWith(`issue29-restore-${input.context.maintenanceId}.`)&&origin.hostname.endsWith('.workers.dev'),'APPLICATION_TARGET_ORIGIN_FORBIDDEN');
 const configPath=join(input.privateDirectory,'playwright.config.mjs'),reportPath=join(input.privateDirectory,'playwright-report.json');
 const config={testDir:join(input.repositoryRoot,'tests','e2e'),testMatch:'real-beta.spec.ts',fullyParallel:false,workers:1,forbidOnly:true,retries:0,repeatEach:1,timeout:900000,globalTimeout:1800000,
  metadata:{issue29:input.context},reporter:[['json',{outputFile:reportPath}]],preserveOutput:'never',outputDir:join(input.privateDirectory,'browser-output'),
  use:{baseURL:input.origin,headless:false,trace:'off',screenshot:'off',video:'off'},projects:[{name:'chromium',use:{browserName:'chromium'}}]};
 /** @type {Record<string,string>} */const env={};for(const key of ['PATH','HOME','DISPLAY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR','XAUTHORITY','DBUS_SESSION_BUS_ADDRESS']){const value=environment[key];if(value)env[key]=value;}
 env.LANG='C.UTF-8';env.TZ='UTC';env.E2E_ISSUE29_BROWSER_SETTINGS=input.browserSettingsPath;
 return{config,configPath,reportPath,configText:`process.umask(0o077);\nexport default ${JSON.stringify(config)};\n`,env,
  args:[join(input.repositoryRoot,'node_modules','@playwright','test','cli.js'),'test','real-beta.spec.ts','--config',configPath,'--project=chromium','--workers=1','--retries=0','--headed','--trace=off','--forbid-only','--fail-on-flaky-tests']};
}

import {constants} from 'node:fs';
import {open,unlink,lstat,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {assertPrivatePath,readPrivateManifest,writePrivateManifest} from './manifest.mjs';
import {readPrivateBytes} from './execution.mjs';
import {executeRestore} from './restore-execution.mjs';
import {readTargetReleaseBinding} from './source-binding.mjs';
import {readSeededSourceEvidence} from './source-execution.mjs';
import {runTargetDatabaseContracts,verifyTargetAuthPrivacy,TARGET_DATABASE_CONTRACTS} from './target-integrity.mjs';
import {prepareTargetStaff} from './auth-execution.mjs';
import {measureRecovery} from './recovery-set.mjs';
const connection=z.strictObject({host:z.string(),port:z.literal(5432),database:z.literal('postgres'),user:z.string(),password:z.string().min(1).max(1024),sslmode:z.literal('verify-full'),sslRootCert:z.literal('system').optional()});
export const applicationSettingsSchema=z.strictObject({schemaVersion:z.literal(1),operation:z.literal('verify-application'),action:z.enum(['prepare','run']),browserSettingsPath:z.string(),restoreSettingsPath:z.string(),privateDirectory:z.string(),sourceSessionProofPath:z.string(),oldSourceAccessTokenPath:z.string(),database:z.strictObject({connection,toolchain:z.strictObject({mode:z.literal('container')})})});
const boundarySchema=z.strictObject({schemaVersion:z.literal(1),operation:z.literal('verify-application'),manifestPath:z.string(),sourcePrivateDirectory:z.string(),bindingSettingsPath:z.string(),publishableKey:z.string().min(10),totpSecretPath:z.string().optional(),sessionCredentialsPath:z.string(),allowLiveHumanChallenges:z.literal(true)});
/** @param {ReturnType<typeof applicationBrowserPlan>} plan @param {string} repositoryRoot */
async function runBrowser(plan,repositoryRoot){
 ensure(plan.env.DISPLAY||plan.env.WAYLAND_DISPLAY,'APPLICATION_HEADED_DISPLAY_REQUIRED');
 return new Promise((resolve,reject)=>{let settled=false;
  const child=spawn(process.execPath,plan.args,{cwd:repositoryRoot,env:plan.env,stdio:['ignore','ignore','ignore']});
  const timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),5000).unref();},1810000);
  child.once('error',()=>{clearTimeout(timer);if(!settled){settled=true;reject(new OperationsError('APPLICATION_PROCESS_OUTCOME_UNCERTAIN'));}});
  child.once('close',(code,signal)=>{clearTimeout(timer);if(!settled){settled=true;resolve({exitCode:code,signal});}});
 });
}
/** @typedef {{manifestPath:string,settingsPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,now?:string,clock?:()=>string}} ApplicationOptions */
/** Prepare uses real restore readback + rollback-only SQL contracts + exact target staff fixture.
 * Run never repeats a pending browser journey: it only consumes its private complete current-run
 * report/session bundle and independently re-reads the target. Jobs are proved by the existing CLI
 * between prepare and run; no scheduler or CAPTCHA exceptions are introduced here.
 * @param {ApplicationOptions} options
 * @param {{fetchImpl?:typeof fetch,runBrowser?:typeof runBrowser}} [dependencies] */
export async function executeApplicationProof(options,dependencies={}){
 const {manifestPath,repositoryRoot,candidate}=options,clock=options.clock??(()=>options.now??new Date().toISOString());
 const parsed=applicationSettingsSchema.safeParse(JSON.parse((await readPrivateBytes(options.settingsPath,repositoryRoot)).toString()));ensure(parsed.success,'APPLICATION_SETTINGS_INVALID');const s=parsed.data;
 const b=boundarySchema.safeParse(JSON.parse((await readPrivateBytes(s.browserSettingsPath,repositoryRoot)).toString()));ensure(b.success,'APPLICATION_BOUNDARY_INVALID');const boundary=b.data;
 ensure(resolve(boundary.manifestPath)===resolve(manifestPath)&&resolve(boundary.sessionCredentialsPath)===join(resolve(s.privateDirectory),'browser-sessions.json'),'APPLICATION_BOUNDARY_INVALID');
 await assertPrivatePath(join(s.privateDirectory,'boundary'),repositoryRoot);const dir=await lstat(s.privateDirectory);ensure(dir.isDirectory()&&!dir.isSymbolicLink()&&(dir.mode&0o777)===0o700,'PRIVATE_DIRECTORY_MODE_REQUIRED');
 const {action:_action,...shared}=s,settingsSha256=digest(shared),browserSettingsSha256=digest(boundary);
 let initial=await readPrivateManifest(manifestPath,{repositoryRoot,candidate,now:clock()});
 const target=initial.target;ensure(target&&initial.source&&target.ref!==initial.source.ref&&!initial.forbiddenRefs.includes(target.ref)&&!initial.preservedRefs.includes(target.ref),'TARGET_FORBIDDEN');
 ensure(initial.allowedActions.includes('verify-restore')&&!initial.terminal&&!initial.humanBoundary&&initial.maintenance?.phase==='paused'&&initial.targetDeploymentId&&['storage_restored','integrity_verified'].includes(initial.state),'APPLICATION_RESTORE_STATE_INVALID');
 ensure(initial.cleanup.resources.some(r=>r.provider==='supabase'&&r.id===target.ref&&r.runId===initial.runId&&r.disposition==='disposable'&&r.absentAt===null),'APPLICATION_TARGET_OWNERSHIP_REQUIRED');
 const restoreKey=`application-restore:${target.ref}`,contractsKey=`application-contracts:${target.ref}`,staffKey=`staff:${target.ref}`,prepareKey=`application-preparation:${target.ref}`,completeKey=`application:${target.ref}`,stageKey=`application-integrity:${target.ref}`,credentialsKey=`application-credentials:${target.ref}`;
 /** @type {Awaited<ReturnType<typeof executeRestore>>|null} */let restore=null;
 // executeRestore owns this same lock, so run its read-only initial comparison before acquiring it,
 // then prove the manifest did not change. After fixture writes, never replay original table counts.
 if(s.action==='prepare'&&!initial.history.some(h=>h.step==='verify-restore'&&h.resourceId===restoreKey)){
  ensure(initial.state==='storage_restored'&&!initial.pending,'APPLICATION_PREPARATION_READBACK_REQUIRED');
  ensure(initial.recoveryTimings?.databaseVerifiedAt&&initial.recoveryTimings.storageVerifiedAt,'APPLICATION_RECOVERY_TIMING_REQUIRED');
  restore=await executeRestore({...options,settingsPath:s.restoreSettingsPath,verifyOnly:true,clock});
 }
 let lock;try{lock=await open(manifestPath+'.lock',constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch{throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}
 try{
  const m=await readPrivateManifest(manifestPath,{repositoryRoot,candidate,now:clock()});ensure(digest(m)===digest(initial),'APPLICATION_MANIFEST_CHANGED');initial=m;
  const save=()=>writePrivateManifest(manifestPath,m,{repositoryRoot,candidate,now:clock(),replace:true});
  /** @param {string} name */const file=name=>join(s.privateDirectory,name);
  /** @param {string} path @param {string} bytes */async function write(path,bytes){await assertPrivatePath(path,repositoryRoot);try{const h=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}}catch(error){ensure(/** @type {NodeJS.ErrnoException} */(error).code==='EEXIST'&&(await readPrivateBytes(path,repositoryRoot,16777216)).toString()===bytes,'APPLICATION_EVIDENCE_COLLISION');}}
  /** @param {unknown} proof */async function store(proof){const sha256=digest(proof);await write(file(sha256+'.json'),canonicalJson(proof));return sha256;}
  /** @param {string} sha256 */async function read(sha256){ensure(hash.safeParse(sha256).success,'APPLICATION_EVIDENCE_HASH_INVALID');const proof=JSON.parse((await readPrivateBytes(file(sha256+'.json'),repositoryRoot,16777216)).toString());ensure(digest(proof)===sha256,'APPLICATION_EVIDENCE_HASH_MISMATCH');return proof;}
  /** @param {string} key */async function historyProof(key){const h=m.history.find(h=>h.step==='verify-restore'&&h.resourceId===key);ensure(h,'APPLICATION_PREPARATION_REQUIRED');return read(h.evidenceSha256);}
  /** @param {string} key @param {unknown} proof @param {string} [operationId] */async function record(key,proof,operationId=randomUUID()){const evidenceSha256=await store(proof);m.history.push({step:'verify-restore',resourceId:key,operationId,completedAt:clock(),evidenceSha256});await save();return evidenceSha256;}
  const binding=JSON.parse((await readPrivateBytes(boundary.bindingSettingsPath,repositoryRoot)).toString());
  const bind=()=>readTargetReleaseBinding({manifest:m,settings:binding,fetchImpl:dependencies.fetchImpl,now:clock()});
  if(s.action==='prepare'){
   if(m.history.some(h=>h.step==='verify-restore'&&h.resourceId===prepareKey)){ensure(!m.pending,'PENDING_OPERATION_REQUIRES_READBACK');await bind();return historyProof(prepareKey);}
   ensure(m.state==='storage_restored','APPLICATION_RESTORE_STATE_INVALID');await bind();
   if(restore)await record(restoreKey,restore);const restoreProof=await historyProof(restoreKey);
   let contracts;const existingContracts=m.history.find(h=>h.step==='verify-restore'&&h.resourceId===contractsKey);
   if(existingContracts)contracts=await read(existingContracts.evidenceSha256);
   else{
    if(!m.pending){const attempt=`verify-restore:${contractsKey}`;ensure(!m.attempts[attempt],'ATTEMPT_LIMIT');m.pending={step:'verify-restore',resourceId:contractsKey,operationId:randomUUID(),startedAt:clock(),priorStateSha256:digest(restoreProof)};m.attempts[attempt]=1;await save();
     const contractOptions={manifestPath,manifest:m,repositoryRoot,...s.database};contracts=await runTargetDatabaseContracts(contractOptions);await write(file(m.pending.operationId+'-contracts.json'),canonicalJson(contracts));
    }else{ensure(m.pending.step==='verify-restore'&&m.pending.resourceId===contractsKey,'PENDING_OPERATION_REQUIRES_READBACK');contracts=JSON.parse((await readPrivateBytes(file(m.pending.operationId+'-contracts.json'),repositoryRoot)).toString());}
    ensure(contracts.kind==='issue29-target-database-contracts'&&contracts.runId===m.runId&&contracts.targetRef===target.ref&&contracts.candidateSha===candidate.sha&&contracts.treeSha===candidate.tree&&contracts.rolledBack===true&&contracts.testCount>0&&contracts.contracts?.length===TARGET_DATABASE_CONTRACTS.length,'APPLICATION_DATABASE_CONTRACTS_UNPROVEN');
    const pending=m.pending;m.pending=null;await record(contractsKey,contracts,pending.operationId);
   }
   const seed=await readSeededSourceEvidence({manifest:m,privateDirectory:boundary.sourcePrivateDirectory,repositoryRoot});
   let staff;const oldStaff=m.history.find(h=>h.step==='verify-restore'&&h.resourceId===staffKey);
   if(oldStaff)staff=await read(oldStaff.evidenceSha256);else staff=await prepareTargetStaff({manifest:m,fixture:seed.fixture,...s.database,resuming:m.pending?.resourceId===staffKey,
    persistIntent:async intent=>{ensure(!m.pending&&!m.attempts[`verify-restore:${staffKey}`],'STAFF_PENDING_OR_ATTEMPT_LIMIT');m.pending={step:'verify-restore',resourceId:intent.resourceId,operationId:randomUUID(),startedAt:clock(),priorStateSha256:intent.priorStateSha256};m.attempts[`verify-restore:${staffKey}`]=1;await save();},
    readbackVerified:async proof=>{ensure(m.pending?.step==='verify-restore'&&m.pending.resourceId===staffKey,'STAFF_READBACK_INTENT_REQUIRED');const id=m.pending.operationId;m.pending=null;await record(staffKey,proof,id);}});
   const proof={schemaVersion:1,kind:'issue29-application-preparation',runId:m.runId,maintenanceId:m.maintenance?.id,targetRef:target.ref,candidate,settingsSha256,browserSettingsSha256,preparedAt:clock(),
    actorInventorySha256:digest(seed.fixture.privateAuthFixtures.users.map((/** @type {any} */a)=>({alias:a.alias,id:a.id}))),restore:restoreProof,contracts,staff};await record(prepareKey,proof);return proof;
  }
  const preparation=await historyProof(prepareKey);
  ensure(preparation.kind==='issue29-application-preparation'&&preparation.runId===m.runId&&preparation.maintenanceId===m.maintenance?.id&&preparation.targetRef===target.ref&&canonicalJson(preparation.candidate)===canonicalJson(candidate)&&preparation.settingsSha256===settingsSha256&&preparation.browserSettingsSha256===browserSettingsSha256,'APPLICATION_PREPARATION_IDENTITY_MISMATCH');
  async function proveCredentialAbsence(){try{await lstat(boundary.sessionCredentialsPath);throw new OperationsError('APPLICATION_CREDENTIALS_STILL_PRESENT');}catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='ENOENT')throw error;}}
  /** Auth/browser proof is committed before credential removal. A lost delete response resumes
   * this exact cleanup intent only; it cannot launch a browser or require deleted access tokens.
   * @param {any} stage @param {string} stageSha256 */
  async function finalizeCredentials(stage,stageSha256){
   ensure(target,'TARGET_FORBIDDEN');
   ensure(m.pending?.step==='verify-restore'&&['application',credentialsKey].includes(m.pending.resourceId??'')&&stage.kind==='issue29-application-integrity'&&stage.runId===m.runId&&stage.targetRef===target.ref&&stage.maintenanceId===m.maintenance?.id&&canonicalJson(stage.candidate)===canonicalJson(candidate)&&stage.preparationSha256===digest(preparation)&&stage.browser?.operationId===m.pending.operationId&&hash.safeParse(stage.browserSessionSha256).success,'APPLICATION_CREDENTIAL_OWNERSHIP_UNPROVEN');
   const auth=stage.auth;ensure(auth?.kind==='issue29-target-auth'&&auth.runId===m.runId&&auth.targetRef===target.ref&&auth.candidateSha===candidate.sha&&auth.treeSha===candidate.tree&&auth.oldSourceTokenDenied===true&&Array.isArray(auth.actors)&&auth.actors.length===4,'APPLICATION_AUTH_PROOF_NOT_PERSISTED');
   const {evidenceSha256:authHash,...authBody}=auth;ensure(digest(authBody)===authHash&&['seller','buyer','outsider','future-staff'].every(alias=>auth.actors.filter((/** @type {any} */a)=>a.alias===alias&&a.freshLoginVerified===true&&a.aal===(alias==='future-staff'?'aal2':'aal1')).length===1),'APPLICATION_AUTH_PROOF_NOT_PERSISTED');
   ensure(m.history.some(h=>h.step==='verify-restore'&&h.resourceId===stageKey&&h.evidenceSha256===stageSha256&&h.operationId===m.pending?.operationId),'APPLICATION_AUTH_PROOF_NOT_PERSISTED');
   if(m.pending.resourceId==='application'){ensure(!m.attempts[`verify-restore:${credentialsKey}`],'ATTEMPT_LIMIT');m.pending={...m.pending,resourceId:credentialsKey,priorStateSha256:stageSha256};m.attempts[`verify-restore:${credentialsKey}`]=1;await save();}
   ensure(m.pending.priorStateSha256===stageSha256,'APPLICATION_CREDENTIAL_OWNERSHIP_UNPROVEN');
   let bytes;try{bytes=await readPrivateBytes(boundary.sessionCredentialsPath,repositoryRoot,131072);}catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='ENOENT')throw error;}
   if(bytes){const sessions=JSON.parse(bytes.toString());ensure(sessions.schemaVersion===1&&sessions.runId===m.runId&&sessions.targetRef===target.ref&&sessions.operationId===m.pending.operationId&&canonicalJson(sessions.candidate)===canonicalJson(candidate)&&digest(sessions)===stage.browserSessionSha256,'APPLICATION_CREDENTIAL_OWNERSHIP_UNPROVEN');await unlink(boundary.sessionCredentialsPath);}
   await proveCredentialAbsence();const proof={...stage,credentialCleanup:{alias:'target-browser-sessions',operationId:m.pending.operationId,absent:true,verifiedAt:clock()}};
   const id=m.pending.operationId;m.pending=null;ensure(m.recoveryTimings,'APPLICATION_RECOVERY_TIMING_REQUIRED');m.recoveryTimings.applicationVerifiedAt=stage.verifiedAt;if(stage.status==='verified')m.state='integrity_verified';await record(completeKey,proof,id);return proof;
  }
  const completed=m.history.find(h=>h.step==='verify-restore'&&h.resourceId===completeKey);if(completed){ensure(!m.pending,'PENDING_OPERATION_REQUIRES_READBACK');await bind();await proveCredentialAbsence();return read(completed.evidenceSha256);}
  ensure(m.state==='storage_restored'&&(!m.pending||(m.pending.step==='verify-restore'&&['application',credentialsKey].includes(m.pending.resourceId??''))),'APPLICATION_PENDING_READBACK_REQUIRED');
  const staged=m.history.find(h=>h.step==='verify-restore'&&h.resourceId===stageKey);
  if(staged){await bind();return finalizeCredentials(await read(staged.evidenceSha256),staged.evidenceSha256);}
  ensure(m.pending?.resourceId!==credentialsKey,'APPLICATION_AUTH_PROOF_NOT_PERSISTED');
  const sourceSessionProof=JSON.parse((await readPrivateBytes(s.sourceSessionProofPath,repositoryRoot)).toString());
  ensure(m.history.some(h=>h.step==='verify-source'&&h.evidenceSha256===digest(sourceSessionProof)),'APPLICATION_SOURCE_SESSION_PROVENANCE_REQUIRED');
  await bind();
  if(!m.pending){
   ensure(!m.attempts[`verify-restore:application:${target.ref}`],'ATTEMPT_LIMIT');
   for(const path of [file('playwright-report.json'),boundary.sessionCredentialsPath,file('playwright.config.mjs')]){try{await lstat(path);throw new OperationsError('APPLICATION_OUTPUT_ALREADY_EXISTS');}catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='ENOENT')throw error;}}
   const operationId=randomUUID(),context={runId:m.runId,maintenanceId:/** @type {string} */(m.maintenance?.id),targetRef:target.ref,candidateSha:candidate.sha,treeSha:candidate.tree,deploymentId:/** @type {string} */(m.targetDeploymentId),operationId,startedAt:clock()};
   const plan=applicationBrowserPlan({repositoryRoot,privateDirectory:s.privateDirectory,browserSettingsPath:s.browserSettingsPath,origin:binding.deployment.origin,context});
   const packageJson=JSON.parse(await readFile(join(repositoryRoot,'node_modules','@playwright','test','package.json'),'utf8'));ensure(/^v22\./u.test(process.version)&&packageJson.version==='1.61.1','APPLICATION_TOOLCHAIN_VERSION_MISMATCH');
   await write(plan.configPath,plan.configText);const intent={schemaVersion:1,kind:'issue29-application-intent',context,configSha256:createHash('sha256').update(plan.configText).digest('hex'),preparationSha256:digest(preparation),sourceSessionProofSha256:digest(sourceSessionProof),toolVersions:{node:process.version,playwright:packageJson.version}};
   const priorStateSha256=await store(intent);m.pending={step:'verify-restore',resourceId:'application',operationId,startedAt:context.startedAt,priorStateSha256};m.attempts[`verify-restore:application:${target.ref}`]=1;await save();
   try{const result=await(dependencies.runBrowser??runBrowser)(plan,repositoryRoot);await write(file(operationId+'-process.json'),canonicalJson(result));
    if(result.exitCode!==0){await bind();m.pending=null;await record(`application-failed:${target.ref}`,{schemaVersion:1,kind:'issue29-application-attempt',status:'failed',runId:m.runId,targetRef:target.ref,operationId,checkedAt:clock(),reasonCode:'browser-process-failed',process:result},operationId);throw new OperationsError('APPLICATION_BROWSER_FAILED_NO_RERUN');}
   }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('APPLICATION_PROCESS_OUTCOME_UNCERTAIN');}
  }
  const pending=m.pending;ensure(pending.priorStateSha256,'APPLICATION_INTENT_UNPROVEN');const intent=await read(pending.priorStateSha256);
  ensure(intent.kind==='issue29-application-intent'&&intent.context?.operationId===pending.operationId&&intent.context.targetRef===target.ref&&intent.preparationSha256===digest(preparation)&&intent.sourceSessionProofSha256===digest(sourceSessionProof),'APPLICATION_INTENT_UNPROVEN');
  let processResult;try{processResult=JSON.parse((await readPrivateBytes(file(pending.operationId+'-process.json'),repositoryRoot)).toString());}catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='ENOENT')throw error;}
  if(processResult&&processResult.exitCode!==0){await bind();m.pending=null;await record(`application-failed:${target.ref}`,{schemaVersion:1,kind:'issue29-application-attempt',status:'failed',runId:m.runId,targetRef:target.ref,operationId:pending.operationId,checkedAt:clock(),reasonCode:'browser-process-failed',process:processResult},pending.operationId);throw new OperationsError('APPLICATION_BROWSER_FAILED_NO_RERUN');}
  const configBytes=await readPrivateBytes(file('playwright.config.mjs'),repositoryRoot);ensure(createHash('sha256').update(configBytes).digest('hex')===intent.configSha256,'APPLICATION_CONFIG_DRIFT');
  const report=JSON.parse((await readPrivateBytes(file('playwright-report.json'),repositoryRoot,16777216)).toString());const browser=validateApplicationReport(report,intent.context,clock());await store(report);
  const sessions=JSON.parse((await readPrivateBytes(boundary.sessionCredentialsPath,repositoryRoot,131072)).toString());
  ensure(sessions.schemaVersion===1&&sessions.runId===m.runId&&sessions.targetRef===target.ref&&sessions.operationId===pending.operationId&&canonicalJson(sessions.candidate)===canonicalJson(candidate)&&Array.isArray(sessions.actors)&&sessions.actors.length===4&&digest(sessions.actors.map((/** @type {any} */a)=>({alias:a.alias,id:a.id})))===preparation.actorInventorySha256,'APPLICATION_SESSION_BUNDLE_MISMATCH');
  for(const a of sessions.actors)ensure(a.requiredAal===(a.alias==='future-staff'?'aal2':'aal1'),'APPLICATION_MFA_PROOF_REQUIRED');
  const oldSourceAccessToken=(await readPrivateBytes(s.oldSourceAccessTokenPath,repositoryRoot,16384)).toString().trim();const timing=m.recoveryTimings;ensure(timing?.databaseVerifiedAt&&timing.storageStartedAt&&timing.storageVerifiedAt,'APPLICATION_RECOVERY_TIMING_REQUIRED');
  const auth=await verifyTargetAuthPrivacy({manifest:m,publicKey:boundary.publishableKey,sourceSessionProof,oldSourceAccessToken,actors:sessions.actors,restoredAt:timing.databaseVerifiedAt,fetchImpl:dependencies.fetchImpl,now:clock()});const databaseAuthIntegrityAt=clock();
  const release=await bind(),finishedAt=clock();
  const recoveryPointAt=new Date(Date.parse(timing.startedAt)-preparation.restore.recoveryPointAgeAtStartSeconds*1000).toISOString();
  const measurement=measureRecovery({recoveryPointAt,authorizedAt:timing.startedAt,databaseIntegrityAt:databaseAuthIntegrityAt,storageStartedAt:timing.storageStartedAt,storageIntegrityAt:timing.storageVerifiedAt,applicationStartedAt:pending.startedAt,allIntegrityAt:finishedAt});
  const proof={schemaVersion:1,kind:'issue29-application-integrity',status:!measurement.withinTargets?'failed':dependencies.fetchImpl||dependencies.runBrowser?'deterministic-only':'verified',runId:m.runId,maintenanceId:m.maintenance?.id,targetRef:target.ref,candidate,verifiedAt:finishedAt,preparationSha256:digest(preparation),browserSessionSha256:digest(sessions),browser,auth,release,measurement,databaseSnapshotVerifiedAt:timing.databaseVerifiedAt,databaseAuthIntegrityAt,applicationStartedAt:pending.startedAt};
  const stageSha256=await record(stageKey,proof,pending.operationId);return finalizeCredentials(proof,stageSha256);
 }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('APPLICATION_PRIVATE_READBACK_REQUIRED');}
 finally{await lock.close();await unlink(manifestPath+'.lock').catch(()=>{});}
}
