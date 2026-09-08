import {describe,it,expect} from 'vitest';
import {verifyExactCandidateCi,validateStage04Evidence} from '../../scripts/issue29-operations/verification-execution.mjs';
const sha='a'.repeat(40),tree='b'.repeat(40),now='2026-09-05T12:00:00.000Z';
describe('Issue29 final candidate verification boundaries',()=>{
 it('requires both actual GitHub Actions app/database checks on the exact candidate and complete discovery',async()=>{
  const checks=['app','database'].map((name,id)=>({id:id+1,name,head_sha:sha,app:{slug:'github-actions'},status:'completed',conclusion:'success'}));
  const fetchImpl:typeof fetch=async(_url,init)=>{expect(init?.method??'GET').toBe('GET');return Response.json({total_count:2,check_runs:checks});};
  expect(await verifyExactCandidateCi({repository:'todevan/perfume-marketplace-bg',candidateSha:sha,readToken:'r'.repeat(40),now,fetchImpl})).toMatchObject({candidateSha:sha,checks:[{name:'app'},{name:'database'}]});
  checks[1].head_sha='c'.repeat(40);await expect(verifyExactCandidateCi({repository:'todevan/perfume-marketplace-bg',candidateSha:sha,readToken:'r'.repeat(40),now,fetchImpl})).rejects.toThrow('EXACT_CANDIDATE_CI_NOT_GREEN');
 });
 it('rejects generic Stage04 pass timestamps without actual local/review evidence',()=>{
  expect(()=>validateStage04Evidence({status:'PASS',checkedAt:now},()=>undefined,{sha,tree,deploymentId:'pending'})).toThrow('STAGE04_EVIDENCE_INVALID');
 });
});

import {createHash} from 'node:crypto';
import {canonicalJson} from '../../scripts/issue29-operations/recovery-set.mjs';
function stageFixture(change?:(f:any)=>void){
 const evidence=new Map<string,Buffer>(),hash='d'.repeat(64);const store=(v:unknown)=>{const b=Buffer.isBuffer(v)?v:Buffer.from(canonicalJson(v));const h=createHash('sha256').update(b).digest('hex');evidence.set(h,b);return h;};
 const machine={success:true,numTotalTests:2,numPassedTests:2,numFailedTests:0,numPendingTests:0,testResults:[{assertionResults:[{status:'passed'},{status:'passed'}]}]};
 const output=store(Buffer.from('Synthetic contract-only command output, not a hosted/local completion claim.'));
 const ids=['supabase-reset','database-lint','database-pgtap','database-contracts','generated-types','application-tests','svelte-check','browser','dependency-audit','cloudflare-staging-dry-run','cloudflare-production-dry-run','local-recovery'];
 const commands=ids.map(id=>({id,command:'pnpm fixture-command',candidateSha:sha,treeSha:tree,startedAt:'2026-09-05T10:00:00.000Z',completedAt:'2026-09-05T10:01:00.000Z',exitCode:0,outputSha256:output,testReportSha256:''}));
 const reviews=['engineering','adversarial'].map(role=>({role,reviewerAlias:role+'-reviewer',candidateSha:sha,treeSha:tree,completedAt:'2026-09-05T11:00:00.000Z',verdict:'PASS',unresolvedBlockers:0,reportSha256:store(Buffer.from(`Synthetic ${role} fixture PASS ${sha} ${tree}`))}));
 change?.({machine,commands,reviews,evidence,output});const report=store(machine);commands.forEach(c=>c.testReportSha256=report);
 const s={schemaVersion:1,kind:'issue29-stage04-verification',candidateSha:sha,treeSha:tree,baseSha:'c'.repeat(40),branch:'issue-29',configSha256:hash,lockfileSha256:hash,fixtureSha256:hash,changedFiles:[{path:'scripts/issue29-operations/cli.mjs',acceptance:[1,2,3,4,5]}],focused:[store(commands[0])],full:commands.map(store),reviews:reviews.map(store)};
 return{s,evidence};
}
it('hash-verifies nonzero local discovery and exactly two independent final-SHA reviewer artifacts',()=>{
 const f=stageFixture();expect(validateStage04Evidence(f.s,key=>f.evidence.get(key),{sha,tree,deploymentId:'pending'})).toMatchObject({discoveredTests:26,fullGateCount:12,reviews:[{role:'engineering'},{role:'adversarial'}]});
});
it.each(['zero-tests','failed-test','skipped','missing-output','wrong-command-sha','missing-full-gate','same-reviewer','same-review-role','old-review','missing-review-report','review-before-gates','unresolved-finding'])('rejects %s without manufacturing Stage04 verification',kind=>{
 const f=stageFixture(({machine,commands,reviews,evidence,output})=>{
 if(kind==='zero-tests'){machine.numTotalTests=0;machine.numPassedTests=0;machine.testResults=[];}
 if(kind==='failed-test')machine.testResults[0].assertionResults[1].status='failed';
 if(kind==='skipped')machine.numPendingTests=1;
 if(kind==='missing-output')evidence.delete(output);
 if(kind==='wrong-command-sha')commands[0].candidateSha='f'.repeat(40);
 if(kind==='missing-full-gate')commands[0].id='not-applicable';
 if(kind==='same-reviewer')reviews[1].reviewerAlias=reviews[0].reviewerAlias;
 if(kind==='same-review-role')reviews[1].role=reviews[0].role;
 if(kind==='old-review')reviews[1].candidateSha='f'.repeat(40);
 if(kind==='missing-review-report')evidence.delete(reviews[0].reportSha256);
 if(kind==='review-before-gates')reviews[0].completedAt='2026-09-05T09:00:00.000Z';
 if(kind==='unresolved-finding')reviews[0].unresolvedBlockers=1;
 });expect(()=>validateStage04Evidence(f.s,key=>f.evidence.get(key),{sha,tree,deploymentId:'pending'})).toThrow('Issue #29:');
});

import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {manifestFixture,maintenanceFixture} from '../fixtures/issue29-operations';
import {monitoringConfig} from '../fixtures/issue29-grafana';
import {createGrafanaAdapter} from '../../scripts/issue29-operations/grafana-adapter.mjs';
import {readPrivateManifest,writePrivateManifest} from '../../scripts/issue29-operations/manifest.mjs';
import {executeFinalizeCleanup} from '../../scripts/issue29-operations/verification-execution.mjs';
async function cleanupFixture(){
 const directory=await mkdtemp('/tmp/issue29-finalize-'),root=process.cwd(),m=manifestFixture();m.state='source_resumed';m.maintenance=maintenanceFixture(m);Object.assign(m.maintenance,{phase:'closed',resumedAt:now,resumeReadbackSha256:'a'.repeat(64),endedAt:now,resumeProof:{...m.maintenance.preservation,checkedAt:now,checkpointSha256:m.maintenance.backup.checkpointSha256,readinessSha256:'a'.repeat(64),evidenceSha256:'a'.repeat(64)}});Object.assign(m.maintenance.monitoring!,{endedAt:now,endEvidenceSha256:'a'.repeat(64)});
 m.cleanup.resources.push({provider:'supabase',id:m.source!.ref,runId:m.runId,createdAt:now,evidenceSha256:'a'.repeat(64),disposition:'persistent',absentAt:null},{provider:'supabase',id:m.target!.ref,runId:m.runId,createdAt:now,evidenceSha256:'b'.repeat(64),disposition:'disposable',absentAt:now},{provider:'cloudflare',id:`issue29-${m.runId}`,runId:m.runId,createdAt:now,evidenceSha256:'c'.repeat(64),disposition:'persistent',absentAt:null});
 const origin=`https://issue29-${m.runId}.owner.workers.dev`,config={...monitoringConfig,runId:m.runId,candidateSha:m.candidate.sha,runtimeEnvironment:'development' as const,targetOrigin:origin},g=createGrafanaAdapter(config),configuration=g.configuration();m.grafana.configSha256=configuration.configSha256;m.grafana.stackAlias=configuration.stackAlias;
 const monitoring={schemaVersion:1,operation:'monitoring-proof',action:'source-green',actionId:'final-source-green',grafana:config,binding:{providerToken:'private-provider-token',source:{apiUrl:m.source!.url,serviceKey:'private-service-role-key'},deployment:{accountId:'c'.repeat(32),workerName:`issue29-${m.runId}`,versionId:m.candidate.deploymentId,origin,readToken:'private-cloudflare-token'}}};
 const settings={schemaVersion:1,operation:'cleanup',action:'finalize',providerToken:'private-read-token',capabilityId:m.capabilityIds.cleanup,sourceMonitoringSettingsPath:join(directory,'monitoring.json'),sourceWorker:{settings:{accountId:'c'.repeat(32),subdomain:'owner',purpose:'source',publishableKey:'sb_publishable_fixture',turnstileSiteKey:'0x4fixture',operations:{migrationSha256:'a'.repeat(64),schemaSha256:'b'.repeat(64),sentinelSha256:'c'.repeat(64),canaryExpectedUtc:'03:17'}},privateDirectory:directory,readToken:'private-cloudflare-token'},workers:[],grafanaGroups:[],silences:[]};
 const persistentResources=configuration.resources.map((r,i)=>({...r,resourceId:'persistent-'+i}));for(const r of persistentResources)m.cleanup.resources.push({provider:'grafana',id:`${r.kind}:${r.resourceId}`,runId:m.runId,createdAt:now,evidenceSha256:'e'.repeat(64),disposition:'persistent',absentAt:null});
 const manifestPath=join(directory,'manifest.json'),settingsPath=join(directory,'settings.json');await writePrivateManifest(manifestPath,m,{repositoryRoot:root,now});await writeFile(settingsPath,JSON.stringify(settings),{mode:0o600});await writeFile(settings.sourceMonitoringSettingsPath,JSON.stringify(monitoring),{mode:0o600});
 let reads=0;const dependencies={supabaseFactory:()=>({readOwnedDisposableAbsent:async({resourceId}:any)=>{reads++;return{absent:true,resourceId,evidenceSha256:'d'.repeat(64)};}}),sourceBinding:async()=>{reads++;return{sourceRef:m.source!.ref};},workerBinding:async()=>{reads++;return{workerName:`issue29-${m.runId}`};},grafanaFactory:()=>({configuration:()=>configuration,verifyConfiguration:async()=>{reads++;return{status:'verified',candidateSha:m.candidate.sha,configSha256:configuration.configSha256,resources:persistentResources};},readRuleScore:async(key:string)=>{reads++;return{ruleKey:key,score:0};},readEvaluation:async(key:string)=>{reads++;return{ruleKey:key,state:'inactive'};}})};
 return{directory,m,settings,manifestPath,settingsPath,repositoryRoot:root,candidate:m.candidate,clock:()=>now,dependencies,reads:()=>reads};
}
async function installPremergeOwnerCopy(f:Awaited<ReturnType<typeof cleanupFixture>>,options:{stale?:boolean,mismatch?:boolean,githubArtifact?:boolean}={}){
 const descriptorSha256=f.m.maintenance!.backup.descriptorSha256,expiresAt=options.stale?'2026-09-05T11:59:59.000Z':'2026-10-10T12:00:00.000Z';
 const copy={provider:'owner-encrypted-retention',runId:f.m.runId,sourceRef:options.mismatch?'z'.repeat(20):f.m.source!.ref,destinationAlias:'owner-secondary',destinationSha256:'f'.repeat(64),descriptorSha256,retentionDays:35,expiresAt,encryptedOnly:true,workflowProof:false};
 const copySha256=createHash('sha256').update(canonicalJson(copy)).digest('hex');
 const artifact={...copy,verifiedAt:f.m.maintenance!.backup.retentionVerifiedAt,recovery:{descriptorSha256},retentionProof:'owner-authorized-35-day-private-retention'};
 const artifactSha256=createHash('sha256').update(canonicalJson(artifact)).digest('hex');
 f.m.backupVerification={descriptorSha256,independentlyVerifiedAt:f.m.maintenance!.backup.verifiedAt,sourceReadsComplete:true};f.m.maintenance!.backup.artifactSha256=artifactSha256;
 f.m.cleanup.resources.push({provider:'owner-copy',id:`owner-copy:${descriptorSha256}`,runId:f.m.runId,createdAt:now,evidenceSha256:copySha256,disposition:'persistent',absentAt:null});
 if(options.githubArtifact)f.m.cleanup.resources.push({provider:'github',id:'29',runId:f.m.runId,createdAt:now,evidenceSha256:'f'.repeat(64),disposition:'persistent',absentAt:null});
 await writeFile(join(f.directory,`${copySha256}.json`),canonicalJson(copy),{mode:0o600});await writeFile(join(f.directory,`${artifactSha256}.json`),canonicalJson(artifact),{mode:0o600});await writePrivateManifest(f.manifestPath,f.m,{repositoryRoot:f.repositoryRoot,now,replace:true});
}
it('writes actual final readback bytes before terminal cleanup state and never calls a provider mutation',async()=>{
 const f=await cleanupFixture();try{const result=await executeFinalizeCleanup(f,f.dependencies as any);expect(result).toMatchObject({state:'cleanup_verified',disposableCount:1,persistentCount:18});expect(f.reads()).toBe(26);const after=await readPrivateManifest(f.manifestPath,{repositoryRoot:f.repositoryRoot,now});expect(after.history.at(-1)?.step).toBe('cleanup');const bytes=await readFile(join(f.directory,result.evidenceSha256+'.json'));expect(createHash('sha256').update(bytes).digest('hex')).toBe(result.evidenceSha256);expect(bytes.toString()).not.toContain('private-read-token');expect(JSON.parse(bytes.toString()).evidenceMode).toBe('deterministic-http-fixture');}finally{await rm(f.directory,{recursive:true,force:true});}
});
it('persists independent final readback preimages instead of confusing internal provider hashes with full DTO hashes',async()=>{
 const f=await cleanupFixture();try{const result=await executeFinalizeCleanup(f,f.dependencies as any);const proof=JSON.parse((await readFile(join(f.directory,result.evidenceSha256+'.json'))).toString());
 for(const [key,value]of Object.entries({...proof.persistent,observation:proof.observations[0]})){const digest=key==='observation'?proof.observationSha256[0]:proof.persistentSha256[key];const bytes=await readFile(join(f.directory,digest+'.json'));expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);expect(JSON.parse(bytes.toString())).toEqual(value);}
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
it('closes the first premerge rehearsal from only its current verified owner copy, while leaving backup freshness deferred',async()=>{
 const f=await cleanupFixture();try{await installPremergeOwnerCopy(f);const prior=f.dependencies.grafanaFactory;f.dependencies.grafanaFactory=()=>({...prior(),readRuleScore:async(key:string)=>({ruleKey:key,score:key.includes('backup-freshness')?1:0})});const result=await executeFinalizeCleanup(f,f.dependencies as any);const proof=JSON.parse((await readFile(join(f.directory,result.evidenceSha256+'.json'))).toString());expect(proof.deferredBackupFreshness).toBe(true);expect(proof.persistent.rules).toHaveLength(9);}finally{await rm(f.directory,{recursive:true,force:true});}
});
it.each(['stale-owner-copy','mismatched-owner-copy','github-artifact-present'])('rejects %s instead of deferring backup freshness',async kind=>{
 const f=await cleanupFixture();try{await installPremergeOwnerCopy(f,{stale:kind==='stale-owner-copy',mismatch:kind==='mismatched-owner-copy',githubArtifact:kind==='github-artifact-present'});const prior=f.dependencies.grafanaFactory;f.dependencies.grafanaFactory=()=>({...prior(),readRuleScore:async(key:string)=>({ruleKey:key,score:key.includes('backup-freshness')?1:0})});await expect(executeFinalizeCleanup(f,f.dependencies as any)).rejects.toThrow(['stale-owner-copy','mismatched-owner-copy'].includes(kind)?'PREMERGE_OWNER_COPY_PROOF_INVALID':'PERSISTENT_MONITOR_NOT_GREEN');}finally{await rm(f.directory,{recursive:true,force:true});}
});
it.each(['pending','still-present','persistent-deleted','maintenance-open','unmapped-resource','not-actually-absent','monitor-firing'])('refuses %s before terminal advancement',async kind=>{
 const f=await cleanupFixture();try{
 if(kind==='pending')f.m.pending={step:'backup-set',operationId:f.m.runId,startedAt:now,resourceId:null,priorStateSha256:null};
 if(kind==='still-present')f.m.cleanup.resources[1].absentAt=null;
 if(kind==='persistent-deleted')f.m.cleanup.resources[0].absentAt=now;
 if(kind==='maintenance-open')f.m.maintenance!.phase='active';
 if(kind==='unmapped-resource')f.m.cleanup.resources.push({provider:'cloudflare',id:`issue29-restore-${f.m.runId}`,runId:f.m.runId,createdAt:now,evidenceSha256:'d'.repeat(64),disposition:'disposable',absentAt:now});
 if(kind==='not-actually-absent')f.dependencies.supabaseFactory=()=>({readOwnedDisposableAbsent:async({resourceId}:any)=>({absent:false,resourceId,evidenceSha256:'d'.repeat(64)})});
 if(kind==='monitor-firing'){const prior=f.dependencies.grafanaFactory;f.dependencies.grafanaFactory=()=>({...prior(),readRuleScore:async(key:string)=>({ruleKey:key,score:2})});}
 await writePrivateManifest(f.manifestPath,f.m,{repositoryRoot:f.repositoryRoot,now,replace:true});await expect(executeFinalizeCleanup(f,f.dependencies as any)).rejects.toThrow('Issue #29:');expect((await readPrivateManifest(f.manifestPath,{repositoryRoot:f.repositoryRoot,now})).state).not.toBe('cleanup_verified');
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
function replaceMachineReport(f:ReturnType<typeof stageFixture>,index:number,report:unknown,focused=false){
 const refs=focused?f.s.focused:f.s.full,key=refs[index],command=JSON.parse(f.evidence.get(key)!.toString());const store=(value:unknown)=>{const b=Buffer.isBuffer(value)?value:Buffer.from(canonicalJson(value)),h=createHash('sha256').update(b).digest('hex');f.evidence.set(h,b);return h;};command.testReportSha256=store(report);refs[index]=store(command);
}
it('parses native node --test TAP counts without inventing converted pass evidence',()=>{
 const f=stageFixture();replaceMachineReport(f,3,Buffer.from('TAP version 13\n# tests 8\n# suites 2\n# pass 8\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'));
 expect(validateStage04Evidence(f.s,key=>f.evidence.get(key),{sha,tree,deploymentId:'pending'}).discoveredTests).toBe(32);
 replaceMachineReport(f,3,Buffer.from('# tests 8\n# pass 7\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n'));expect(()=>validateStage04Evidence(f.s,key=>f.evidence.get(key),{sha,tree,deploymentId:'pending'})).toThrow('STAGE04_TEST_DISCOVERY_INVALID');
});
function browserReport(){return{stats:{expected:1,unexpected:0,flaky:0,skipped:1},suites:[{file:'listing.spec.ts',specs:[{title:'shows listings',ok:true,tests:[{projectName:'chromium',status:'expected',expectedStatus:'passed',annotations:[] as {type:string,description:string}[],results:[{status:'passed'}]}]}]},{file:'real-beta.spec.ts',specs:[{title:'seller → buyer → offer → chat → deal → review',ok:true,tests:[{projectName:'chromium',status:'skipped',expectedStatus:'skipped',annotations:[{type:'skip',description:'Set E2E_REAL_RUN=true to run the state-changing real-beta suite.'}],results:[{status:'skipped'}]}]}]}]};}
function fullBrowserReport(){const passed=Array.from({length:13},(_,index)=>({title:`real local browser scenario ${index}`,ok:true,tests:[{projectName:'chromium',status:'expected',expectedStatus:'passed',annotations:[] as {type:string,description:string}[],results:[{status:'passed'}]}]}));const hosted=[
 ['real-beta.spec.ts','seller → buyer → offer → chat → deal → review','Set E2E_REAL_RUN=true to run the state-changing real-beta suite.'],
 ['real-beta.spec.ts','moderator reaches the AAL2 moderation queue','Real-beta mutations run once in the desktop Chromium project.'],
 ['hosted-report-evidence.spec.ts','executes all ten target-locked scenarios','Hosted report-evidence verification requires both explicit real-run flags and every approved secure input.'],
 ['hosted-report-evidence.spec.ts','executes the checkpointed Issue #24 moderation-safety proof','Hosted mutations run once in the desktop project.'],
 ['hosted-report-evidence.spec.ts','cleans only the persisted A10 manifest under A11','Hosted mutations run once in the desktop project.']
].flatMap(([file,title,reason])=>['chromium','mobile'].map(projectName=>({file,specs:[{title,ok:true,tests:[{projectName,status:'skipped',expectedStatus:'skipped',annotations:[{type:'skip',description:reason}],results:[{status:'skipped'}]}]}]})));
 return{stats:{expected:13,unexpected:0,flaky:0,skipped:11},suites:[{file:'marketplace.spec.ts',specs:passed},...hosted,{file:'marketplace.spec.ts',specs:[{title:'core pages do not create document-level overflow at acceptance viewports',ok:true,tests:[{projectName:'mobile',status:'skipped',expectedStatus:'skipped',annotations:[{type:'skip',description:'One Chromium matrix covers the exact widths.'}],results:[{status:'skipped'}]}]}]}]};}
it('counts only exact existing guarded hosted-suite skips in the full local browser gate',()=>{
 const f=stageFixture();replaceMachineReport(f,7,browserReport());expect(validateStage04Evidence(f.s,key=>f.evidence.get(key),{sha,tree,deploymentId:'pending'})).toMatchObject({discoveredTests:25,allowedLocalHostedSkips:1});
});
it('accepts the actual thirteen-pass, eleven-skip native browser report only with the one bounded mobile viewport duplicate',()=>{
 const f=stageFixture();replaceMachineReport(f,7,fullBrowserReport());expect(validateStage04Evidence(f.s,key=>f.evidence.get(key),{sha,tree,deploymentId:'pending'})).toMatchObject({discoveredTests:37,allowedLocalHostedSkips:11});
});
it.each(['wrong-reason','duplicate-project','second-duplicate'])('rejects an unbounded viewport duplicate (%s)',kind=>{
 const f=stageFixture(),report=fullBrowserReport(),duplicate=report.suites.at(-1)!.specs[0]!.tests[0]!;
 if(kind==='wrong-reason')duplicate.annotations[0].description='viewport run is optional';
 if(kind==='duplicate-project')duplicate.projectName='chromium';
 if(kind==='second-duplicate'){report.suites.push({file:'marketplace.spec.ts',specs:[{title:'core pages do not create document-level overflow at acceptance viewports',ok:true,tests:[{...duplicate,annotations:[...duplicate.annotations],results:[...duplicate.results]}]}]});report.stats.skipped++;}
 replaceMachineReport(f,7,report);expect(()=>validateStage04Evidence(f.s,key=>f.evidence.get(key),{sha,tree,deploymentId:'pending'})).toThrow(kind==='second-duplicate'?'STAGE04_TEST_DISCOVERY_INVALID':'STAGE04_UNAPPROVED_TEST_SKIP');
});
it.each(['wrong-file','wrong-title','wrong-reason','focused','unknown-project'])('rejects %s skipped browser evidence rather than weakening applicable discovery',kind=>{
 const f=stageFixture(),report=browserReport();
 if(kind==='wrong-file')report.suites[1].file='listing.spec.ts';
 if(kind==='wrong-title')report.suites[1].specs[0].title='skipped correctness regression';
 if(kind==='wrong-reason')report.suites[1].specs[0].tests[0].annotations![0].description='test is flaky';
 if(kind==='unknown-project')report.suites[1].specs[0].tests[0].projectName='unknown';
 replaceMachineReport(f,kind==='focused'?0:7,report,kind==='focused');expect(()=>validateStage04Evidence(f.s,key=>f.evidence.get(key),{sha,tree,deploymentId:'pending'})).toThrow('STAGE04_UNAPPROVED_TEST_SKIP');
});
it('rejects arbitrary readiness sections instead of accepting a private settings PASS',async()=>{
 const {executeGenerateOperationsReceipt}=await import('../../scripts/issue29-operations/verification-execution.mjs');const f=await cleanupFixture();try{
 await writeFile(f.settingsPath,JSON.stringify({schemaVersion:1,operation:'generate-receipt',status:'PASS',receipt:{passed:true}}),{mode:0o600});
 await expect(executeGenerateOperationsReceipt(f)).rejects.toThrow('READINESS_GENERATION_SETTINGS_INVALID');
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
