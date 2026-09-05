import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  manifest.cleanup.resources.push({provider:'supabase',id:manifest.source!.ref,runId:manifest.runId,createdAt:now,evidenceSha256:'e'.repeat(64),disposition:'disposable',absentAt:null});
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
    await configureGrafanaMonitoring(f.options);expect(f.creates()).toBe(16);
  });
  it('resumes an ambiguous create by exact readback, never by repeating provider mutation',async()=>{
    const f=await setup();f.failNext();
    await expect(configureGrafanaMonitoring(f.options)).rejects.toThrow('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY');
    const pending=await readPrivateManifest(f.manifestPath,{repositoryRoot,now,candidate:f.manifest.candidate});
    expect(pending.state).toBe('implementation_verified');expect(pending.pending?.step).toBe('configure-monitoring');expect(f.creates()).toBe(1);
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
