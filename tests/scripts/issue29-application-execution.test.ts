import {expect,it} from 'vitest';
const now='2026-09-05T12:10:00.000Z';
const context={runId:'29292929-2929-4292-8292-292929292929',maintenanceId:'45454545-4545-4454-8454-454545454545',targetRef:'abcdefghijklmnopqrst',candidateSha:'a'.repeat(40),treeSha:'b'.repeat(40),deploymentId:'version-29',operationId:'56565656-5656-4565-8565-565656565656',startedAt:'2026-09-05T12:00:00.000Z'};
function report(){return{config:{workers:1,forbidOnly:true,metadata:{issue29:context},projects:[{name:'chromium',retries:0,repeatEach:1}]},stats:{startTime:'2026-09-05T12:01:00.000Z',duration:500000,expected:2,unexpected:0,flaky:0,skipped:0},errors:[],suites:[{file:'real-beta.spec.ts',specs:[],suites:[{file:'real-beta.spec.ts',specs:['seller → buyer → offer → chat → deal → review','moderator reaches the AAL2 moderation queue'].map(title=>({title,ok:true,file:'real-beta.spec.ts',tests:[{projectName:'chromium',expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0,startTime:'2026-09-05T12:01:00.000Z',duration:240000,errors:[],stdout:[],stderr:[],attachments:[]}]}]}))}]}]};}
it('accepts only both real hosted journeys from the exact current browser operation, returning sanitized proof',async()=>{
 const {validateApplicationReport}=await import('../../scripts/issue29-operations/application-execution.mjs');
 expect(validateApplicationReport(report(),context,now)).toMatchObject({kind:'issue29-application-browser',testCount:2,runId:context.runId,targetRef:context.targetRef,candidateSha:context.candidateSha,reportSha256:expect.stringMatching(/^[a-f0-9]{64}$/)});
});

it.each(['zero','skipped','retry','wrong-operation','wrong-file','extra-test','attachments','private-stdout','late','failed'] as const)('fails closed for %s browser evidence',async wrong=>{
 const {validateApplicationReport}=await import('../../scripts/issue29-operations/application-execution.mjs');const r=report();const spec=r.suites[0].suites[0].specs[0],result=spec.tests[0].results[0];
 if(wrong==='zero')r.stats.expected=0;if(wrong==='skipped')r.stats.skipped=1;if(wrong==='retry')result.retry=1;if(wrong==='wrong-operation')r.config.metadata.issue29={...context,operationId:'67676767-6767-4676-8676-676767676767'};
 if(wrong==='wrong-file')spec.file='other.spec.ts';if(wrong==='extra-test')r.suites[0].suites[0].specs.push(structuredClone(spec));if(wrong==='attachments')(result.attachments as unknown[]).push({path:'private.png'});if(wrong==='private-stdout')(result.stdout as unknown[]).push({text:'private session'});if(wrong==='late')r.stats.startTime='2026-09-05T13:00:00.000Z';if(wrong==='failed')result.status='failed';
 expect(()=>validateApplicationReport(r,context,now)).toThrow('Issue #29:');
});

it('builds the single headed Chromium plan with no capture, retries, inherited secrets or noncanonical test discovery',async()=>{
 const {applicationBrowserPlan}=await import('../../scripts/issue29-operations/application-execution.mjs');
 const p=applicationBrowserPlan({repositoryRoot:'/home/operator/repo',privateDirectory:'/tmp/private-run',browserSettingsPath:'/tmp/private-run/boundary.json',origin:`https://issue29-restore-${context.maintenanceId}.owner.workers.dev`,context},{PATH:'/usr/bin',HOME:'/home/operator',DISPLAY:':0',SUPABASE_SERVICE_ROLE_KEY:'must-not-leak',GITHUB_TOKEN:'must-not-leak',NODE_OPTIONS:'--require=evil',E2E_REAL_BUYER_PASSWORD:'must-not-leak'});
 expect(p.args).toEqual(['/home/operator/repo/node_modules/@playwright/test/cli.js','test','real-beta.spec.ts','--config','/tmp/private-run/playwright.config.mjs','--project=chromium','--workers=1','--retries=0','--headed','--trace=off','--forbid-only','--fail-on-flaky-tests']);
 expect(p.config.use).toMatchObject({headless:false,trace:'off',screenshot:'off',video:'off'});expect(p.config.reporter).toEqual([['json',{outputFile:'/tmp/private-run/playwright-report.json'}]]);expect(p.config.testMatch).toBe('real-beta.spec.ts');
 expect(p.env).toEqual({PATH:'/usr/bin',HOME:'/home/operator',DISPLAY:':0',LANG:'C.UTF-8',TZ:'UTC',E2E_ISSUE29_BROWSER_SETTINGS:'/tmp/private-run/boundary.json'});expect(JSON.stringify(p)).not.toContain('must-not-leak');
});

import {chmod,mkdtemp,readFile,writeFile,rm,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {manifestFixture,maintenanceFixture} from '../fixtures/issue29-operations';
import {canonicalJson} from '../../scripts/issue29-operations/recovery-set.mjs';
import {readPrivateManifest,writePrivateManifest} from '../../scripts/issue29-operations/manifest.mjs';
it.each(['unfinished-report','staged-credential-cleanup','removed-credential-readback'])('resumes %s without repeating browser work or deleting unowned credentials',async scenario=>{
 const {executeApplicationProof,applicationBrowserPlan}=await import('../../scripts/issue29-operations/application-execution.mjs');const directory=await mkdtemp(join(tmpdir(),'i29-app-pending-'));await chmod(directory,0o700);
 try{
  const digest=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');const store=async(name:string,value:unknown)=>writeFile(join(directory,name),canonicalJson(value),{mode:0o600});
  const m=manifestFixture();m.state='storage_restored';m.targetDeploymentId='target-version';m.maintenance=maintenanceFixture(m);m.maintenance.id=context.maintenanceId;
  m.cleanup.resources.push({provider:'supabase',id:m.target!.ref,runId:m.runId,createdAt:'2026-09-05T12:00:00.000Z',evidenceSha256:'e'.repeat(64),disposition:'disposable',absentAt:null});
  m.recoveryTimings={startedAt:'2026-09-05T12:00:00.000Z',databaseVerifiedAt:'2026-09-05T12:00:10.000Z',storageStartedAt:'2026-09-05T12:00:10.000Z',storageVerifiedAt:'2026-09-05T12:00:20.000Z'};
  const manifestPath=join(directory,'manifest.json'),settingsPath=join(directory,'settings.json'),browserSettingsPath=join(directory,'boundary.json');
  const binding={providerToken:'private-provider-token',source:{apiUrl:m.target!.url,serviceKey:'private-target-service-key'},deployment:{accountId:'c'.repeat(32),workerName:`issue29-restore-${context.maintenanceId}`,versionId:'target-version',origin:`https://issue29-restore-${context.maintenanceId}.owner.workers.dev`,readToken:'private-cloudflare-token'}};
  const boundary={schemaVersion:1,operation:'verify-application',manifestPath,sourcePrivateDirectory:directory,bindingSettingsPath:join(directory,'binding.json'),publishableKey:'sb_publishable_fixture',sessionCredentialsPath:join(directory,'browser-sessions.json'),allowLiveHumanChallenges:true};
  const settings={schemaVersion:1,operation:'verify-application',action:'run',browserSettingsPath,restoreSettingsPath:join(directory,'restore.json'),privateDirectory:directory,sourceSessionProofPath:join(directory,'source-proof.json'),oldSourceAccessTokenPath:join(directory,'old-token'),database:{connection:{host:`db.${m.target!.ref}.supabase.co`,port:5432,database:'postgres',user:'postgres',password:'private-password',sslmode:'verify-full',sslRootCert:'system'},toolchain:{mode:'container'}}};
  const {action:_action,...shared}=settings,preparation={schemaVersion:1,kind:'issue29-application-preparation',runId:m.runId,maintenanceId:m.maintenance.id,targetRef:m.target!.ref,candidate:m.candidate,settingsSha256:digest(shared),browserSettingsSha256:digest(boundary)};
  const sourceProof={fixture:'source-proof-never-consumed-without-browser-report'};await store('source-proof.json',sourceProof);
  m.history.push({step:'verify-source',resourceId:'source-session:fixture',operationId:m.runId,completedAt:context.startedAt,evidenceSha256:digest(sourceProof)});
  m.history.push({step:'verify-restore',resourceId:`application-preparation:${m.target!.ref}`,operationId:m.runId,completedAt:context.startedAt,evidenceSha256:digest(preparation)});await store(digest(preparation)+'.json',preparation);
  const ownContext={...context,targetRef:m.target!.ref,runId:m.runId,deploymentId:m.targetDeploymentId},plan=applicationBrowserPlan({repositoryRoot:process.cwd(),privateDirectory:directory,browserSettingsPath,origin:binding.deployment.origin,context:ownContext});
  const intent={schemaVersion:1,kind:'issue29-application-intent',context:ownContext,configSha256:createHash('sha256').update(plan.configText).digest('hex'),preparationSha256:digest(preparation),sourceSessionProofSha256:digest(sourceProof)};
  await store(digest(intent)+'.json',intent);await writeFile(plan.configPath,plan.configText,{mode:0o600});m.pending={step:'verify-restore',resourceId:'application',operationId:ownContext.operationId,startedAt:ownContext.startedAt,priorStateSha256:digest(intent)};
  m.attempts[`verify-restore:application:${m.target!.ref}`]=1;await writePrivateManifest(manifestPath,m,{repositoryRoot:process.cwd(),now});await store('settings.json',settings);await store('boundary.json',boundary);await store('binding.json',binding);
  let launches=0,reads=0;const fetchImpl:typeof fetch=async(url,init)=>{reads++;expect(init?.method??'GET').toBe('GET');const u=new URL(String(url));
   if(u.hostname==='api.supabase.com'){if(u.pathname.includes('/organizations/'))return Response.json({id:'owned-org',plan:'free'});if(u.pathname.endsWith('/api-keys'))return Response.json([{name:'service_role',api_key:binding.source.serviceKey}]);return Response.json({ref:m.target!.ref,organization_slug:'owned-org',region:'eu-central-1',status:'ACTIVE_HEALTHY',database:{version:'17.6.1'}});}
   if(u.hostname==='api.cloudflare.com'){if(u.pathname.endsWith('/deployments'))return Response.json({success:true,result:{deployments:[{versions:[{version_id:'target-version',percentage:100}]}]}});return Response.json({success:true,result:{id:'target-version',metadata:{created_on:context.startedAt},resources:{bindings:[['RELEASE_COMMIT_SHA',m.candidate.sha],['PUBLIC_SUPABASE_URL',m.target!.url],['APP_ENV','development'],['ISSUE29_CANDIDATE_TREE',m.candidate.tree],['ISSUE29_RUN_ID',m.runId]].map(([name,text])=>({name,text,type:'plain_text'}))}}});}
   return new Response(null,{status:200,headers:{'x-deployed-git-sha':m.candidate.sha}});
  };
  const options={manifestPath,settingsPath,repositoryRoot:process.cwd(),candidate:m.candidate,now},dependencies={fetchImpl,runBrowser:async()=>{launches++;return{exitCode:0,signal:null};}};
  if(scenario!=='unfinished-report'){
   const bundle={schemaVersion:1,runId:m.runId,targetRef:m.target!.ref,candidate:m.candidate,operationId:ownContext.operationId,actors:[{alias:'fixture',accessToken:'private-target-session'}]};
   const authBody={schemaVersion:1,kind:'issue29-target-auth',runId:m.runId,targetRef:m.target!.ref,candidateSha:m.candidate.sha,treeSha:m.candidate.tree,oldSourceTokenDenied:true,actors:['seller','buyer','outsider','future-staff'].map(alias=>({alias,freshLoginVerified:true,aal:alias==='future-staff'?'aal2':'aal1'}))};
   const stage={schemaVersion:1,kind:'issue29-application-integrity',status:'deterministic-only',runId:m.runId,maintenanceId:m.maintenance.id,targetRef:m.target!.ref,candidate:m.candidate,verifiedAt:now,preparationSha256:digest(preparation),browser:{operationId:ownContext.operationId},browserSessionSha256:digest(bundle),auth:{...authBody,evidenceSha256:digest(authBody)}};
   await store(digest(stage)+'.json',stage);m.history.push({step:'verify-restore',resourceId:`application-integrity:${m.target!.ref}`,operationId:ownContext.operationId,completedAt:now,evidenceSha256:digest(stage)});await writePrivateManifest(manifestPath,m,{repositoryRoot:process.cwd(),now,replace:true});
   const wrong={...bundle,operationId:'78787878-7878-4787-8787-787878787878'};await store('browser-sessions.json',wrong);
   await expect(executeApplicationProof(options,dependencies)).rejects.toThrow('APPLICATION_CREDENTIAL_OWNERSHIP_UNPROVEN');expect(JSON.parse(await readFile(boundary.sessionCredentialsPath,'utf8'))).toEqual(wrong);expect(launches).toBe(0);
   await store('browser-sessions.json',bundle);if(scenario==='removed-credential-readback')await unlink(boundary.sessionCredentialsPath);const result=await executeApplicationProof(options,dependencies);expect(result.credentialCleanup).toMatchObject({absent:true,operationId:ownContext.operationId});await expect(readFile(boundary.sessionCredentialsPath)).rejects.toMatchObject({code:'ENOENT'});expect(launches).toBe(0);
   // Completed re-entry consumes the persisted actual integrity proof, not deleted credentials.
   expect(await executeApplicationProof(options,dependencies)).toEqual(result);expect(launches).toBe(0);return;
  }
  await expect(executeApplicationProof(options,dependencies)).rejects.toThrow('APPLICATION_PRIVATE_READBACK_REQUIRED');expect(launches).toBe(0);expect(reads).toBeGreaterThan(0);
  await writeFile(plan.reportPath,'{"stats":',{mode:0o600});await expect(executeApplicationProof(options,dependencies)).rejects.toThrow('APPLICATION_PRIVATE_READBACK_REQUIRED');expect(launches).toBe(0);
  expect((await readPrivateManifest(manifestPath,{repositoryRoot:process.cwd(),now})).pending).toEqual(m.pending);expect(await readFile(plan.configPath,'utf8')).toBe(plan.configText);
  await store(ownContext.operationId+'-process.json',{exitCode:1,signal:null});await expect(executeApplicationProof(options,dependencies)).rejects.toThrow('APPLICATION_BROWSER_FAILED_NO_RERUN');
  const failed=await readPrivateManifest(manifestPath,{repositoryRoot:process.cwd(),now});expect(failed.pending).toBeNull();expect(failed.state).toBe('storage_restored');expect(failed.history.some(h=>h.resourceId===`application-failed:${m.target!.ref}`)).toBe(true);
  await expect(executeApplicationProof(options,dependencies)).rejects.toThrow('ATTEMPT_LIMIT');expect(launches).toBe(0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
