import { describe, expect, it } from 'vitest';
import { executeMonitoringAction, monitoringExecutionSettingsSchema } from '../../scripts/issue29-operations/monitoring-execution.mjs';
describe('Issue29 single CLI monitoring execution',()=>{
  it('rejects unrecognized private action/config before any provider mutation',async()=>{
    expect(monitoringExecutionSettingsSchema.safeParse({schemaVersion:1,operation:'incident-drill',action:'delete-production',grafana:{}}).success).toBe(false);
    await expect(executeMonitoringAction({manifestPath:'/tmp/nonexistent',repositoryRoot:process.cwd(),candidate:{sha:'a'.repeat(40),tree:'b'.repeat(40),deploymentId:'v'},settings:{schemaVersion:1,operation:'incident-drill',action:'delete-production'}})).rejects.toThrow('MONITORING_SETTINGS_INVALID');
  });
});

import {chmod,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {manifestFixture} from '../fixtures/issue29-operations';
import {monitoringConfig,providerFixture} from '../fixtures/issue29-grafana';
import {createGrafanaAdapter} from '../../scripts/issue29-operations/grafana-adapter.mjs';
import {readPrivateManifest,writePrivateManifest} from '../../scripts/issue29-operations/manifest.mjs';
const now='2026-09-05T12:00:00.000Z';
it('persists eight exact source silence intents, resumes ambiguity without repeats, then proves expiry and genuine green recovery',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'i29-monitor-exec-'));await chmod(directory,0o700);
  try{
    const manifestPath=join(directory,'manifest.json'),repositoryRoot=process.cwd(),m=manifestFixture();m.target=null;m.state='backup_verified';
    m.cleanup.resources.push({provider:'supabase',id:m.source!.ref,runId:m.runId,createdAt:now,evidenceSha256:'e'.repeat(64),disposition:'persistent',absentAt:null});
    m.allowedActions.push('maintenance-silence','maintenance-unsilence','resume-source','synthetic-jobs');
    const binding={providerToken:'private-provider-token',source:{apiUrl:m.source!.url,serviceKey:'private-service-role-key'},deployment:{accountId:'c'.repeat(32),workerName:`issue29-${m.runId}`,versionId:m.candidate.deploymentId,origin:`https://issue29-${m.runId}.owner.workers.dev`,readToken:'private-cloudflare-token'}};
    const config={...monitoringConfig,runId:m.runId,runtimeEnvironment:'development' as const,targetOrigin:binding.deployment.origin};
    const f=providerFixture({},config),silences=new Map<string,Record<string,any>>();let creates=0,deletes=0,ambiguous=true;
    const fetchImpl:typeof fetch=async(url,init)=>{const u=new URL(String(url));
      if(u.hostname==='api.supabase.com'){
        if(u.pathname.includes('/organizations/'))return Response.json({id:'owned-org',plan:'free'});
        if(u.pathname.endsWith('/api-keys'))return Response.json([{name:'service_role',api_key:binding.source.serviceKey}]);
        return Response.json({ref:m.source!.ref,organization_slug:'owned-org',region:'eu-central-1',status:'ACTIVE_HEALTHY',database:{version:'17.6.1'}});
      }
      if(u.hostname==='api.cloudflare.com'){
        if(u.pathname.endsWith('/deployments'))return Response.json({success:true,result:{deployments:[{versions:[{version_id:m.candidate.deploymentId,percentage:100}]}]}});
        return Response.json({success:true,result:{id:m.candidate.deploymentId,metadata:{created_on:now},resources:{bindings:[['RELEASE_COMMIT_SHA',m.candidate.sha],['PUBLIC_SUPABASE_URL',m.source!.url],['APP_ENV','development'],['ISSUE29_CANDIDATE_TREE',m.candidate.tree],['ISSUE29_RUN_ID',m.runId]].map(([name,text])=>({name,text,type:'plain_text'}))}}});
      }
      if(u.hostname.endsWith('.workers.dev'))return new Response(null,{status:200,headers:{'x-deployed-git-sha':m.candidate.sha}});
      if(u.pathname.endsWith('/api/v2/silences')){
        if(init?.method==='POST'){const persisted=JSON.parse(await readFile(manifestPath,'utf8'));expect(persisted.pending.step).toBe('maintenance-silence');creates++;
          const id=`45454545-4545-4454-8454-${String(creates).padStart(12,'0')}`,row={...JSON.parse(String(init.body)),id,status:{state:'active'},updatedAt:now};silences.set(id,row);
          if(ambiguous){ambiguous=false;throw new Error('private uncertain result');}return Response.json({silenceID:id});}
        const match=u.searchParams.get('filter')?.split('"')[1];return Response.json([...silences.values()].filter(row=>row.matchers.some((v:Record<string,unknown>)=>v.name==='__alert_rule_uid__'&&v.value===match)));
      }
      if(u.pathname.includes('/api/v2/silence/')){const id=u.pathname.split('/').at(-1)!,row=silences.get(id)!;
        if(init?.method==='DELETE'){const persisted=JSON.parse(await readFile(manifestPath,'utf8'));expect(persisted.pending.step).toBe('maintenance-unsilence');deletes++;row.status={state:'expired'};row.endsAt=now;return new Response(null,{status:200});}return Response.json(row);}
      if(u.pathname==='/api/prometheus/grafana/api/v1/rules')return Response.json({status:'success',data:{groups:[{rules:[...f.stored.values()].filter(r=>r.ruleGroup).map(r=>({uid:r.uid,folderUid:config.folderUid,health:'ok',isPaused:false,state:'inactive',lastEvaluation:now,activeAt:null,labels:r.labels}))}]}});
      if(u.pathname==='/api/prom/api/v1/query')return Response.json({status:'success',data:{resultType:'vector',result:[{metric:{},value:[Date.parse(now)/1000,'0']}]}});
      return f.fetchImpl(url,init);
    };
    const g=createGrafanaAdapter(config,{fetchImpl,now:()=>now});for(const r of g.configuration().resources){const op=g.resourceOperation(r.key);await op.inspect();await op.mutate();const p=await op.readback();m.cleanup.resources.push({provider:'grafana',id:`${r.kind}:${p.resourceId}`,runId:m.runId,createdAt:now,evidenceSha256:'a'.repeat(64),disposition:'persistent',absentAt:null});}
    m.grafana={stackAlias:config.stackSlug,destinationAlias:'owner-primary',ruleAliases:g.configuration().resources.filter(r=>r.kind==='rule').map(r=>r.key),configSha256:g.configuration().configSha256};
    const preservation={identitySha256:'1'.repeat(64),configSha256:'2'.repeat(64),provenanceSha256:'3'.repeat(64),workerSha256:'4'.repeat(64)};
    m.maintenance={schemaVersion:1,id:'67676767-6767-4676-8676-676767676767',sourceRef:m.source!.ref,authorizedAt:now,expiresAt:'2026-09-05T14:00:00.000Z',backup:{descriptorSha256:'a'.repeat(64),artifactSha256:'b'.repeat(64),checkpointSha256:'c'.repeat(64),verifiedAt:now,retentionVerifiedAt:now},preservation,monitoring:null,phase:'authorized',pausedAt:null,pauseReadbackSha256:null,resumedAt:null,resumeReadbackSha256:null,resumeProof:null,endedAt:null};
    await writePrivateManifest(manifestPath,m,{repositoryRoot,now});
    const settings={schemaVersion:1,operation:'maintenance-silence',action:'maintenance-silence',actionId:'window',grafana:config,binding};
    const options={manifestPath,repositoryRoot,candidate:m.candidate,settings,fetchImpl,now};
    await expect(executeMonitoringAction(options)).rejects.toThrow('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY');
    const pending=await readPrivateManifest(manifestPath,{repositoryRoot,now});expect(pending.pending?.step).toBe('maintenance-silence');expect(creates).toBe(1);
    expect(await executeMonitoringAction(options)).toMatchObject({status:'deterministic-only',phase:'monitoring_ready'});expect(creates).toBe(8);
    const prepared=await readPrivateManifest(manifestPath,{repositoryRoot,now});expect(prepared.maintenance?.monitoring?.silences).toHaveLength(8);
    expect(prepared.maintenance?.monitoring?.silences.every(r=>!r.ruleKey.includes('backup-freshness')&&!r.ruleKey.includes('monitor-heartbeat'))).toBe(true);
    prepared.maintenance!.phase='active';prepared.maintenance!.pausedAt=now;prepared.maintenance!.pauseReadbackSha256='a'.repeat(64);prepared.maintenance!.resumedAt=now;prepared.maintenance!.resumeReadbackSha256='b'.repeat(64);
    prepared.maintenance!.resumeProof={...preservation,checkedAt:now,checkpointSha256:'c'.repeat(64),readinessSha256:'d'.repeat(64),evidenceSha256:'e'.repeat(64)};
    await writePrivateManifest(manifestPath,prepared,{repositoryRoot,now,replace:true});
    await expect(executeMonitoringAction({...options,settings:{...settings,operation:'maintenance-unsilence',action:'maintenance-unsilence'}})).rejects.toThrow('SOURCE_JOBS_RESUME_PROOF_REQUIRED');
    expect(deletes).toBe(0);
    const {CANONICAL_SYNTHETIC_JOBS}=await import('../../scripts/issue29-operations/synthetic-jobs.mjs');
    const jobs={schemaVersion:1,runId:m.runId,projectRef:m.source!.ref,role:'source',mode:'proved',checkedAt:now,priorState:CANONICAL_SYNTHETIC_JOBS.map(job=>({...job,nodename:'localhost',nodeport:5432,database:'postgres',username:'postgres',active:false})),state:CANONICAL_SYNTHETIC_JOBS.map(job=>({...job,nodename:'localhost',nodeport:5432,database:'postgres',username:'postgres',active:true})),proof:CANONICAL_SYNTHETIC_JOBS.map(job=>({jobname:job.jobname,startTime:now,endTime:now,status:'succeeded',returnMessage:'1 row'}))};
    const jobsSha256=createHash('sha256').update(canonicalJson(jobs)).digest('hex');
    prepared.history.push({step:'resume-source',operationId:m.runId,resourceId:`${m.source!.ref}:${prepared.maintenance!.id}`,completedAt:now,evidenceSha256:'f'.repeat(64)});
    prepared.history.push({step:'synthetic-jobs',operationId:m.runId,resourceId:'source-jobs',completedAt:now,evidenceSha256:jobsSha256});
    await writeFile(join(directory,`${jobsSha256}.json`),canonicalJson(jobs),{mode:0o600});
    await writePrivateManifest(manifestPath,prepared,{repositoryRoot,now,replace:true});
    expect(await executeMonitoringAction({...options,settings:{...settings,operation:'maintenance-unsilence',action:'maintenance-unsilence'}})).toMatchObject({phase:'closed',notificationClaim:'none-maintenance-suppresses-notifications'});
    expect(deletes).toBe(8);const final=await readPrivateManifest(manifestPath,{repositoryRoot,now});expect(final.cleanup.resources.filter(r=>r.id.startsWith('silence:')).every(r=>r.absentAt===now)).toBe(true);
    for(const entry of final.history.filter(h=>h.step.startsWith('maintenance-'))){
      expect(entry.intentSha256).toMatch(/^[a-f0-9]{64}$/);
      const intent=JSON.parse(await readFile(join(directory,entry.intentSha256+'.json'),'utf8'));
      expect(intent.pending).toMatchObject({operationId:entry.operationId,step:entry.step,resourceId:entry.resourceId});
      expect(JSON.parse(await readFile(join(directory,entry.evidenceSha256+'.json'),'utf8'))).toMatchObject({maintenanceId:m.maintenance.id});
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

import {executeDailyCanary} from '../../scripts/issue29-operations/monitoring-execution.mjs';
it('runs a daily Free-only synthetic canary once, polls signed delivery readback, and records a separate checkpoint',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'i29-daily-canary-'));await chmod(directory,0o700);
  try{
    const manifestPath=join(directory,'manifest.json'),repositoryRoot=process.cwd(),m=manifestFixture();m.target=null;m.state='monitoring_configured';
    m.cleanup.resources.push({provider:'supabase',id:m.source!.ref,runId:m.runId,createdAt:now,evidenceSha256:'e'.repeat(64),disposition:'persistent',absentAt:null});
    const binding={providerToken:'private-provider-token',source:{apiUrl:m.source!.url,serviceKey:'private-service-role-key'},deployment:{accountId:'c'.repeat(32),workerName:`issue29-${m.runId}`,versionId:m.candidate.deploymentId,origin:`https://issue29-${m.runId}.owner.workers.dev`,readToken:'private-cloudflare-token'}};
    const config={...monitoringConfig,runId:m.runId,runtimeEnvironment:'development' as const,targetOrigin:binding.deployment.origin};
    const g=createGrafanaAdapter(config);m.grafana={stackAlias:config.stackSlug,destinationAlias:'owner-primary',ruleAliases:g.configuration().resources.filter(r=>r.kind==='rule').map(r=>r.key),configSha256:g.configuration().configSha256};
    await writePrivateManifest(manifestPath,m,{repositoryRoot,now});
    const executionId='45454545-4545-4454-8454-454545454545',messageId='56565656-5656-4565-8565-565656565656';
    let current=now,sends=0,checkpoints=0,sleeps=0;let email:Record<string,unknown>={},checkpoint:Record<string,unknown>={};
    const fetchImpl:typeof fetch=async(url,init)=>{const u=new URL(String(url));
      if(u.hostname==='api.supabase.com'){
        if(u.pathname.includes('/organizations/'))return Response.json({id:'owned-org',plan:'free'});
        if(u.pathname.endsWith('/api-keys'))return Response.json([{name:'service_role',api_key:binding.source.serviceKey}]);
        return Response.json({ref:m.source!.ref,organization_slug:'owned-org',region:'eu-central-1',status:'ACTIVE_HEALTHY',database:{version:'17.6.1'}});
      }
      if(u.hostname==='api.cloudflare.com'){
        if(u.pathname.endsWith('/deployments'))return Response.json({success:true,result:{deployments:[{versions:[{version_id:m.candidate.deploymentId,percentage:100}]}]}});
        return Response.json({success:true,result:{id:m.candidate.deploymentId,metadata:{created_on:now},resources:{bindings:[['RELEASE_COMMIT_SHA',m.candidate.sha],['PUBLIC_SUPABASE_URL',m.source!.url],['APP_ENV','development'],['ISSUE29_CANDIDATE_TREE',m.candidate.tree],['ISSUE29_RUN_ID',m.runId]].map(([name,text])=>({name,text,type:'plain_text'}))}}});
      }
      if(u.hostname.endsWith('.workers.dev'))return new Response(null,{status:200,headers:{'x-deployed-git-sha':m.candidate.sha}});
      if(u.hostname==='api.resend.com'){
        const headers={'x-resend-daily-quota':'1','x-resend-monthly-quota':'20'};
        if(u.pathname.startsWith('/domains/'))return Response.json({id:'67676767-6767-4676-8676-676767676767',name:'example.test',status:'verified',capabilities:{sending:'enabled'}},{headers});
        if(u.pathname.startsWith('/webhooks/'))return Response.json({id:'78787878-7878-4787-8787-787878787878',endpoint:binding.deployment.origin+'/api/webhooks/resend',status:'enabled',events:['email.delivered']},{headers});
        if(u.pathname==='/emails'){const pending=JSON.parse(await readFile(manifestPath,'utf8')).pending;expect(pending.resourceId).toContain('canary-send');sends++;email=JSON.parse(String(init?.body));return Response.json({id:messageId});}
        return Response.json({id:messageId,...email,created_at:now,last_event:sleeps?'delivered':'sent'});
      }
      if(u.pathname.endsWith('/record_operations_checkpoint')){const pending=JSON.parse(await readFile(manifestPath,'utf8')).pending;expect(pending.resourceId).toContain('canary-checkpoint');checkpoints++;const b=JSON.parse(String(init?.body));checkpoint={deploymentIdentity:b.p_deployment_identity,checkpointAt:b.p_checkpoint_at,ok:b.p_ok,evidenceSha256:b.p_evidence_sha256};return Response.json(null);}
      if(u.pathname.endsWith('/get_operations_snapshot'))return Response.json({checkpoints:{email_canary:checkpoint}});
      throw new Error('Unexpected fixture path');
    };
    const canary={database:{scope:{mode:'hosted',role:'source',runId:m.runId,projectRef:m.source!.ref,sourceRef:m.source!.ref,preservedRefs:m.preservedRefs,createdResourceEvidenceSha256:'e'.repeat(64),apiUrl:m.source!.url},connection:{host:`db.${m.source!.ref}.supabase.co`,port:5432,user:'postgres',database:'postgres',password:'private-db-secret-123',sslmode:'verify-full'},toolchain:{mode:'container'}},
      resend:{apiKey:'re_privatecanarykey123456789',domainId:'67676767-6767-4676-8676-676767676767',webhookId:'78787878-7878-4787-8787-787878787878',from:'canary@example.test',to:'private-canary@example.test',operationId:m.runId,windowStart:now,webhookOrigin:binding.deployment.origin,syntheticScopeEvidenceSha256:'a'.repeat(64),freePlanEvidence:{observedAt:'2026-01-01T00:00:00.000Z',remainingDaily:1,quotedCost:0,evidenceSha256:'b'.repeat(64)}}};
    const settings={schemaVersion:1,operation:'monitoring-proof',action:'canary-send',actionId:'daily',grafana:config,binding,canary};
    const options={manifestPath,repositoryRoot,candidate:m.candidate,settings,executionId,preparedAt:now,fetchImpl,clock:()=>current,
      ledgerReader:async()=>sleeps?[{providerEventId:'msg_dailycanaryevent123',providerMessageId:messageId,eventType:'email.delivered',occurredAt:current,receivedAt:current}]:[],
      sleep:async(milliseconds:number)=>{expect(milliseconds).toBe(30000);sleeps++;current='2026-09-05T12:00:30.000Z';}};
    const proof=await executeDailyCanary(options);expect(proof).toMatchObject({kind:'daily-synthetic-canary',checkpointAt:'2026-09-05T12:00:30.000Z'});expect(sends).toBe(1);expect(checkpoints).toBe(1);expect(sleeps).toBe(1);
    await executeDailyCanary(options);expect(sends).toBe(1);expect(checkpoints).toBe(1);
    expect(JSON.stringify(proof)).not.toMatch(/private-|example.test/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {canonicalJson} from '../../scripts/issue29-operations/recovery-set.mjs';
it('updates standing monitors only after protected merge adoption and persists every prior before once writes, including later-resource resume',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'i29-release-exec-'));await chmod(directory,0o700);
  try{
    const hash=(v:unknown)=>createHash('sha256').update(canonicalJson(v)).digest('hex');
    const manifestPath=join(directory,'manifest.json'),repositoryRoot=process.cwd(),m=manifestFixture();m.target=null;m.state='monitoring_configured';
    m.allowedActions.push('adopt-merged-release','update-worker');
    const previousCandidate={...m.candidate};m.cleanup.resources.push({provider:'supabase',id:m.source!.ref,runId:m.runId,createdAt:now,evidenceSha256:'e'.repeat(64),disposition:'persistent',absentAt:null});
    const binding={providerToken:'private-provider-token',source:{apiUrl:m.source!.url,serviceKey:'private-service-role-key'},deployment:{accountId:'c'.repeat(32),workerName:`issue29-${m.runId}`,versionId:'merged-version',origin:`https://issue29-${m.runId}.owner.workers.dev`,readToken:'private-cloudflare-token'}};
    const config={...monitoringConfig,runId:m.runId,runtimeEnvironment:'development' as const,targetOrigin:binding.deployment.origin},f=providerFixture({},config);
    const old=createGrafanaAdapter(config,{fetchImpl:f.fetchImpl,now:()=>now});
    for(const r of old.configuration().resources){const op=old.resourceOperation(r.key);await op.inspect();await op.mutate();const p=await op.readback();
      m.cleanup.resources.push({provider:'grafana',id:`${r.kind}:${p.resourceId}`,runId:m.runId,createdAt:now,evidenceSha256:p.evidenceSha256,disposition:'persistent',absentAt:null});
      m.history.push({step:'configure-monitoring',resourceId:r.key,operationId:m.runId,completedAt:now,evidenceSha256:p.evidenceSha256});}
    m.grafana={stackAlias:config.stackSlug,destinationAlias:'owner-primary',ruleAliases:old.configuration().resources.filter(r=>r.kind==='rule').map(r=>r.key),configSha256:old.configuration().configSha256};
    m.candidate={...previousCandidate,sha:'c'.repeat(40),deploymentId:'merged-version'};
    const proof={schemaVersion:1,kind:'issue29-protected-merge',evidenceMode:'deterministic-http-fixture',repository:'owner/aromatika',repositoryId:123,pullRequestNumber:29,fromCandidate:previousCandidate,mergeSha:m.candidate.sha,treeSha:m.candidate.tree,verifiedAt:now,mergedAt:now,protectionSha256:'d'.repeat(64),checkRunsSha256:'e'.repeat(64)};
    m.releaseUpdate={fromCandidate:previousCandidate,mergeSha:m.candidate.sha,treeSha:m.candidate.tree,pullRequestNumber:29,verifiedAt:now,evidenceSha256:hash(proof),repository:proof.repository,repositoryId:123};
    await writeFile(join(directory,hash(proof)+'.json'),canonicalJson(proof),{mode:0o600});
    m.history.push({step:'adopt-merged-release',resourceId:m.candidate.sha,operationId:m.runId,completedAt:now,evidenceSha256:hash(proof)});
    m.history.push({step:'update-worker',resourceId:binding.deployment.workerName,operationId:m.runId,completedAt:now,evidenceSha256:'f'.repeat(64)});
    await writePrivateManifest(manifestPath,m,{repositoryRoot,now});
    let writes=0,ambiguous=true;
    const fetchImpl:typeof fetch=async(url,init)=>{const u=new URL(String(url));
      if(u.hostname==='api.supabase.com'){
        if(u.pathname.includes('/organizations/'))return Response.json({id:'owned-org',plan:'free'});
        if(u.pathname.endsWith('/api-keys'))return Response.json([{name:'service_role',api_key:binding.source.serviceKey}]);
        return Response.json({ref:m.source!.ref,organization_slug:'owned-org',region:'eu-central-1',status:'ACTIVE_HEALTHY',database:{version:'17.6.1'}});}
      if(u.hostname==='api.cloudflare.com'){
        if(u.pathname.endsWith('/deployments'))return Response.json({success:true,result:{deployments:[{versions:[{version_id:m.candidate.deploymentId,percentage:100}]}]}});
        return Response.json({success:true,result:{id:m.candidate.deploymentId,metadata:{created_on:now},resources:{bindings:[['RELEASE_COMMIT_SHA',m.candidate.sha],['PUBLIC_SUPABASE_URL',m.source!.url],['APP_ENV','development'],['ISSUE29_CANDIDATE_TREE',m.candidate.tree],['ISSUE29_RUN_ID',m.runId]].map(([name,text])=>({name,text,type:'plain_text'}))}}});}
      if(u.hostname.endsWith('.workers.dev'))return new Response(null,{status:200,headers:{'x-deployed-git-sha':m.candidate.sha}});
      const updating=init?.method==='PUT'||(init?.method==='POST'&&/^\/api\/v1\/check\/[0-9]+$/.test(u.pathname));
      if(updating){writes++;const pending=JSON.parse(await readFile(manifestPath,'utf8')).pending;expect(pending.step).toBe('configure-monitoring');
        const prior=JSON.parse(await readFile(join(directory,pending.priorStateSha256+'.json'),'utf8'));expect(prior.kind).toBe('issue29-grafana-release-prior');expect(hash(prior)).toBe(pending.priorStateSha256);}
      const response=await f.fetchImpl(url,init);if(updating&&writes===2&&ambiguous){ambiguous=false;throw new Error('uncertain second update');}return response;
    };
    const settings={schemaVersion:1,operation:'configure-monitoring',action:'release-update',actionId:'merged',previousCandidateSha:previousCandidate.sha,grafana:{...config,candidateSha:m.candidate.sha},binding};
    const options={manifestPath,repositoryRoot,candidate:m.candidate,settings,fetchImpl,now};
    await expect(executeMonitoringAction({...options,settings:{...settings,previousCandidateSha:'d'.repeat(40)}})).rejects.toThrow('MONITORING_RELEASE_PRIOR_MISMATCH');expect(writes).toBe(0);
    await expect(executeMonitoringAction(options)).rejects.toThrow('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY');expect(writes).toBe(2);
    const finished=await executeMonitoringAction(options);expect(finished).toMatchObject({kind:'issue29-grafana-release-update',previousConfigSha256:old.configuration().configSha256,candidateSha:m.candidate.sha});expect(writes).toBe(13);
    const final=await readPrivateManifest(manifestPath,{repositoryRoot,now});expect(final.grafana.configSha256).toBe(finished.configSha256);expect(final.pending).toBeNull();
    expect(JSON.parse(await readFile(join(directory,hash(finished)+'.json'),'utf8'))).toEqual(finished);
    await executeMonitoringAction(options);expect(writes).toBe(13);
  }finally{await rm(directory,{recursive:true,force:true});}
});
