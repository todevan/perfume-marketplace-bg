import { describe, expect, it } from 'vitest';
import { readSourceReleaseBinding } from '../../scripts/issue29-operations/source-binding.mjs';
import { manifestFixture } from '../fixtures/issue29-operations';
const manifest = manifestFixture();
const settings = { providerToken: 'private-provider-token', source: { apiUrl: manifest.source!.url, serviceKey: 'private-storage-key' }, deployment: { accountId: 'c'.repeat(32), workerName: `issue29-${manifest.runId}`, versionId: manifest.candidate.deploymentId, origin: `https://issue29-${manifest.runId}.owner.workers.dev`, readToken: 'private-cloudflare-token' } };
function request(change?: (url:string,value:any)=>any) { return async (url: string|URL|Request, init?: RequestInit) => {
 const u=String(url); expect(init?.redirect).toBe('error'); expect(init?.method??'GET').toBe('GET');
 let value:any;
 if(u.endsWith('/organizations/owned-org'))value={id:'owned-org',plan:'free'};
 else if(u.endsWith(`/projects/${manifest.source!.ref}`))value={ref:manifest.source!.ref,organization_slug:'owned-org',region:'eu-central-1',status:'ACTIVE_HEALTHY',database:{version:'17.6.1'}};
 else if(u.endsWith('/api-keys?reveal=true'))value=[{name:'service_role',api_key:settings.source.serviceKey}];
 else if(u.endsWith('/deployments'))value={success:true,result:{deployments:[{versions:[{version_id:settings.deployment.versionId,percentage:100}]}]}};
 else if(u.includes('/versions/'))value={success:true,result:{id:settings.deployment.versionId,annotations:{'workers/tag':manifest.candidate.sha},metadata:{created_on:'2026-09-05T12:00:00.000Z'},resources:{bindings:[{type:'plain_text',name:'RELEASE_COMMIT_SHA',text:manifest.candidate.sha},{type:'plain_text',name:'PUBLIC_SUPABASE_URL',text:manifest.source!.url},{type:'plain_text',name:'APP_ENV',text:'development'},{type:'plain_text',name:'ISSUE29_CANDIDATE_TREE',text:manifest.candidate.tree},{type:'plain_text',name:'ISSUE29_RUN_ID',text:manifest.runId}]}}};
 else return new Response(null,{status:200,headers:{'x-deployed-git-sha':manifest.candidate.sha}});
 return Response.json(change?change(u,value):value);
 }; }
describe('live synthetic source/release binding',()=>{
 it('reads exact organization, project, credential and active version without emitting credentials',async()=>{
  const proof=await readSourceReleaseBinding({manifest,settings,fetchImpl:request(),now:'2026-09-05T12:01:00.000Z'});
  expect(proof.sourceRef).toBe(manifest.source!.ref);expect(proof.candidate).toEqual(manifest.candidate);expect(JSON.stringify(proof)).not.toContain('private-');
 });
 it.each(['project','region','plan','key','deployment','sha','url'])('denies %s drift',async kind=>{
  const fetchImpl=request((u,v)=>{if(kind==='project'&&v.ref)v.ref='z'.repeat(20);if(kind==='region'&&v.region)v.region='us-west-1';if(kind==='plan'&&v.plan)v.plan='pro';if(kind==='key'&&Array.isArray(v))v[0].api_key='other';if(kind==='deployment'&&u.endsWith('/deployments'))v.result.deployments[0].versions[0].percentage=50;if(kind==='sha'&&v.result?.resources)v.result.resources.bindings[0].text='d'.repeat(40);if(kind==='url'&&v.result?.resources)v.result.resources.bindings[1].text='https://foreign.supabase.co';return v;});
  await expect(readSourceReleaseBinding({manifest,settings,fetchImpl,now:'2026-09-05T12:01:00.000Z'})).rejects.toThrow('Issue #29:');
 });
 it('rejects preserved source before network and sanitizes transport errors',async()=>{
  let calls=0; const fetchImpl=async()=>{calls++;throw new Error('private-provider-token');};
  await expect(readSourceReleaseBinding({manifest:{...manifest,preservedRefs:[manifest.source!.ref]},settings,fetchImpl})).rejects.toThrow('PRESERVED_PROJECT_FORBIDDEN');expect(calls).toBe(0);
  await expect(readSourceReleaseBinding({manifest,settings,fetchImpl})).rejects.toThrow('SOURCE_BINDING_READ_FAILED');
 });
});
