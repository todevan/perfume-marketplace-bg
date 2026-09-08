import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalJson} from '../../scripts/issue29-operations/recovery-set.mjs';
import { configureGrafanaMonitoring } from '../../scripts/issue29-operations/grafana-operator.mjs';
import { createGrafanaAdapter } from '../../scripts/issue29-operations/grafana-adapter.mjs';
import { readPrivateManifest, writePrivateManifest } from '../../scripts/issue29-operations/manifest.mjs';
import { manifestFixture } from '../fixtures/issue29-operations';
import { monitoringConfig, providerFixture } from '../fixtures/issue29-grafana';

const now='2026-09-05T12:00:00.000Z',repositoryRoot=process.cwd();
const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function setup() {
  const directory=await mkdtemp(join(tmpdir(),'issue29-grafana-'));directories.push(directory);await chmod(directory,0o700);
  const manifestPath=join(directory,'transaction.json'),manifest=manifestFixture();manifest.state='implementation_verified';manifest.target=null;
  manifest.cleanup.resources.push({provider:'supabase',id:manifest.source!.ref,runId:manifest.runId,createdAt:now,evidenceSha256:'e'.repeat(64),disposition:'persistent',absentAt:null});
  const bindingSettings={providerToken:'private-provider-token',source:{apiUrl:manifest.source!.url,serviceKey:'private-storage-key'},
    deployment:{accountId:'c'.repeat(32),workerName:`issue29-${manifest.runId}`,versionId:manifest.candidate.deploymentId,
      origin:`https://issue29-${manifest.runId}.owner.workers.dev`,readToken:'private-cloudflare-token'}};
  const config={...monitoringConfig,runId:manifest.runId,runtimeEnvironment:'development' as const,targetOrigin:bindingSettings.deployment.origin};
  const provider=providerFixture({},config);let creates=0,failAfterCreate=false,wrongBinding=false;
  const fetchImpl:typeof fetch=async(url,init)=>{
    const u=String(url);let value:unknown;
    if(u.startsWith('https://api.supabase.com/')){
      if(u.endsWith('/organizations/owned-org'))value={id:'owned-org',plan:'free'};
      else if(u.endsWith('/api-keys?reveal=true'))value=[{name:'service_role',api_key:bindingSettings.source.serviceKey}];
      else value={ref:manifest.source!.ref,organization_slug:'owned-org',region:'eu-central-1',status:'ACTIVE_HEALTHY',database:{version:'17.6.1'}};
      return Response.json(value);
    }
    if(u.startsWith('https://api.cloudflare.com/')){
      if(u.endsWith('/deployments'))value={success:true,result:{deployments:[{versions:[{version_id:bindingSettings.deployment.versionId,percentage:100}]}]}};
      else value={success:true,result:{id:bindingSettings.deployment.versionId,metadata:{created_on:now},resources:{bindings:[
        {type:'plain_text',name:'RELEASE_COMMIT_SHA',text:wrongBinding?'d'.repeat(40):manifest.candidate.sha},
        {type:'plain_text',name:'PUBLIC_SUPABASE_URL',text:manifest.source!.url},{type:'plain_text',name:'APP_ENV',text:'development'},
        {type:'plain_text',name:'ISSUE29_CANDIDATE_TREE',text:manifest.candidate.tree},{type:'plain_text',name:'ISSUE29_RUN_ID',text:manifest.runId}]}}};
      return Response.json(value);
    }
    if(u===bindingSettings.deployment.origin+'/')return new Response(null,{status:200,headers:{'x-deployed-git-sha':manifest.candidate.sha}});
    const mutation=init?.method==='POST'&&!u.endsWith('/notification/query');
    if(mutation){creates++;const persisted=JSON.parse(await readFile(manifestPath,'utf8'));
      expect(persisted.pending.step).toBe('configure-monitoring');expect(persisted.pending.resourceId).toBeTruthy();expect(persisted.grafana.configSha256).toBeTruthy();
      const evidence=await Promise.all((await readdir(directory)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(async name=>JSON.parse(await readFile(join(directory,name),'utf8'))));
      expect(evidence.some(e=>e.kind==='issue29-operator-intent'&&e.pending.operationId===persisted.pending.operationId)).toBe(true);
      expect(JSON.stringify(init?.body)).not.toContain('private-storage-key');}
    const result=await provider.fetchImpl(url,init);
    if(mutation&&failAfterCreate){failAfterCreate=false;throw new Error('private response ambiguity');}
    return result;
  };
  const adapter=createGrafanaAdapter(config,{fetchImpl,now:()=>now}),plan=adapter.configuration();
  manifest.grafana={stackAlias:config.stackSlug,destinationAlias:'owner-primary',ruleAliases:plan.resources.filter(r=>r.kind==='rule').map(r=>r.key)};
  await writePrivateManifest(manifestPath,manifest,{repositoryRoot,now,candidate:manifest.candidate});
  return {manifest,manifestPath,config,provider,fetchImpl,adapter,bindingSettings,options:{manifestPath,repositoryRoot,candidate:manifest.candidate,adapter,bindingSettings,fetchImpl,now},
    creates:()=>creates,failNext:()=>{failAfterCreate=true;},wrongBinding:()=>{wrongBinding=true;}};
}

describe('one private Issue29 Grafana transaction',()=>{
  it('persists each exact create intent and completes only after full independent configuration readback',async()=>{
    const f=await setup(),result=await configureGrafanaMonitoring(f.options);
    expect(result.state).toBe('monitoring_configured');expect(result.pending).toBeNull();
    expect(result.cleanup.resources.filter(r=>r.provider==='grafana')).toHaveLength(16);
    expect(result.cleanup.resources.filter(r=>r.provider==='grafana').every(r=>r.disposition==='persistent'&&r.runId===result.runId)).toBe(true);
    expect(result.grafana.configSha256).toBe(f.adapter.configuration().configSha256);
    expect(f.creates()).toBe(16);
    for(const owned of result.cleanup.resources.filter(r=>r.provider==='grafana')){
      const completed=result.history.find(h=>h.evidenceSha256===owned.evidenceSha256)!;
      expect(completed.intentSha256).toMatch(/^[a-f0-9]{64}$/);
      const prefix=f.manifestPath.slice(0,f.manifestPath.lastIndexOf('/'));
      const intent=JSON.parse(await readFile(join(prefix,completed.intentSha256+'.json'),'utf8'));
      expect(intent).toMatchObject({kind:'issue29-operator-intent',runId:result.runId,pending:{operationId:completed.operationId,resourceId:completed.resourceId}});
      const bytes=await readFile(join(prefix,completed.evidenceSha256+'.json'));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(completed.evidenceSha256);
      expect(JSON.parse(bytes.toString())).toMatchObject({status:'verified',resourceId:owned.id.slice(owned.id.indexOf(':')+1)});
      expect(createHash('sha256').update(canonicalJson(intent)).digest('hex')).toBe(completed.intentSha256);
    }
    await configureGrafanaMonitoring(f.options);expect(f.creates()).toBe(16);
  });
  it('resumes an ambiguous create by exact readback, never by repeating provider mutation',async()=>{
    const f=await setup();f.failNext();
    await expect(configureGrafanaMonitoring(f.options)).rejects.toThrow('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY');
    const pending=await readPrivateManifest(f.manifestPath,{repositoryRoot,now,candidate:f.manifest.candidate});
    expect(pending.state).toBe('implementation_verified');expect(pending.pending?.step).toBe('configure-monitoring');expect(f.creates()).toBe(1);
    const directory=f.manifestPath.slice(0,f.manifestPath.lastIndexOf('/'));
    const names=await readdir(directory);let missing='';let bytes=Buffer.alloc(0);
    for(const name of names.filter(name=>/^[a-f0-9]{64}\.json$/.test(name))){const file=await readFile(join(directory,name)),proof=JSON.parse(file.toString());if(proof.kind==='issue29-operator-intent'&&proof.pending.operationId===pending.pending?.operationId){missing=join(directory,name);bytes=file;}}
    expect(missing).not.toBe('');await unlink(missing);
    await expect(configureGrafanaMonitoring(f.options)).rejects.toThrow('INTENT_EVIDENCE_REQUIRED');expect(f.creates()).toBe(1);
    await expect(readFile(missing)).rejects.toMatchObject({code:'ENOENT'});
    await writeFile(missing,bytes,{mode:0o600});
    const result=await configureGrafanaMonitoring(f.options);expect(result.state).toBe('monitoring_configured');expect(f.creates()).toBe(16);
    expect(f.provider.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/api/folders'))).toHaveLength(1);
  });
  it('refuses candidate/Worker drift before any hosted configuration mutation',async()=>{
    const f=await setup();f.wrongBinding();
    await expect(configureGrafanaMonitoring(f.options)).rejects.toThrow('WORKER_SOURCE_BINDING_MISMATCH');expect(f.creates()).toBe(0);
    const manifest=await readPrivateManifest(f.manifestPath,{repositoryRoot,now,candidate:f.manifest.candidate});expect(manifest.pending).toBeNull();
  });
  it('rejects changed private configuration on an ambiguous resume',async()=>{
    const f=await setup();f.failNext();await expect(configureGrafanaMonitoring(f.options)).rejects.toThrow('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY');
    const adapter=createGrafanaAdapter({...f.config,k6ChannelId:'preview'},{fetchImpl:f.fetchImpl,now:()=>now});
    await expect(configureGrafanaMonitoring({...f.options,adapter})).rejects.toThrow('MONITORING_CONFIG_DRIFT');expect(f.creates()).toBe(1);
  });
  it('rejects a preserved source and wrong permission mode before a provider request',async()=>{
    const f=await setup();await chmod(f.manifestPath,0o644);
    await expect(configureGrafanaMonitoring(f.options)).rejects.toThrow(/PRIVATE_/);expect(f.creates()).toBe(0);
  });
});

import {target,maintenanceFixture} from '../fixtures/issue29-operations';
it('configures a separate disposable target while retaining the source monitors and shared owned folder',async()=>{
  const f=await setup();await configureGrafanaMonitoring(f.options);
  const m=await readPrivateManifest(f.manifestPath,{repositoryRoot,now});m.target=structuredClone(target);m.targetDeploymentId='target-version';m.state='storage_restored';m.maintenance=maintenanceFixture(m);m.maintenance.id='45454545-4545-4454-8454-454545454545';
  m.cleanup.resources.push({provider:'supabase',id:target.ref,runId:m.runId,createdAt:now,evidenceSha256:'f'.repeat(64),disposition:'disposable',absentAt:null});
  const bindingSettings={...f.bindingSettings,source:{apiUrl:target.url,serviceKey:'private-target-service-key'},deployment:{...f.bindingSettings.deployment,workerName:`issue29-restore-${m.maintenance.id}`,versionId:'target-version',origin:`https://issue29-restore-${m.maintenance.id}.owner.workers.dev`}};
  const config={...f.config,targetRole:'target' as const,targetCycleId:m.maintenance.id,environmentAlias:'synthetic-restore',targetOrigin:bindingSettings.deployment.origin};
  let sourceReads=0;const fetchImpl:typeof fetch=async(url,init)=>{const u=new URL(String(url));
    if(u.href.includes(m.source!.ref)||u.hostname===new URL(f.bindingSettings.deployment.origin).hostname){sourceReads++;throw new Error('source paused');}
    if(u.hostname==='api.supabase.com'){
      if(u.pathname.includes('/organizations/'))return Response.json({id:'owned-org',plan:'free'});
      if(u.pathname.endsWith('/api-keys'))return Response.json([{name:'service_role',api_key:bindingSettings.source.serviceKey}]);
      return Response.json({ref:target.ref,organization_slug:'owned-org',region:target.region,status:'ACTIVE_HEALTHY',database:{version:'17.6.1'}});
    }
    if(u.hostname==='api.cloudflare.com'){
      if(u.pathname.endsWith('/deployments'))return Response.json({success:true,result:{deployments:[{versions:[{version_id:'target-version',percentage:100}]}]}});
      return Response.json({success:true,result:{id:'target-version',metadata:{created_on:now},resources:{bindings:[['RELEASE_COMMIT_SHA',m.candidate.sha],['PUBLIC_SUPABASE_URL',target.url],['APP_ENV','development'],['ISSUE29_CANDIDATE_TREE',m.candidate.tree],['ISSUE29_RUN_ID',m.runId]].map(([name,text])=>({type:'plain_text',name,text}))}}});
    }
    if(u.hostname.endsWith('.workers.dev'))return new Response(null,{status:200,headers:{'x-deployed-git-sha':m.candidate.sha}});
    if(init?.method==='POST'&&!u.pathname.endsWith('/notification/query')){const persisted=JSON.parse(await readFile(f.manifestPath,'utf8'));expect(persisted.pending.step).toBe('configure-monitoring');expect(persisted.grafana.targetConfigSha256).toBeTruthy();}
    return f.provider.fetchImpl(url,init);
  };
  const adapter=createGrafanaAdapter(config,{fetchImpl,now:()=>now});delete m.grafana.targetRuleAliases;delete m.grafana.targetConfigSha256;
  await writePrivateManifest(f.manifestPath,m,{repositoryRoot,now,replace:true});
  const result=await configureGrafanaMonitoring({...f.options,adapter,bindingSettings,fetchImpl});
  expect(result.state).toBe('storage_restored');expect(sourceReads).toBe(0);expect(result.cleanup.resources.filter(r=>r.provider==='grafana'&&r.disposition==='disposable')).toHaveLength(15);
  expect(result.cleanup.resources.filter(r=>r.provider==='grafana'&&r.disposition==='persistent')).toHaveLength(16);
});
