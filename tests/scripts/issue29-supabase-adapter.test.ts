import { describe, expect, it } from 'vitest';
import { createSupabaseOperationsAdapter } from '../../scripts/issue29-operations/supabase-adapter.mjs';
import { manifestFixture } from '../fixtures/issue29-operations';

const now = '2026-09-05T12:00:00.000Z';
const capacity = { organizationId: 'owned-org', checkedAt: now, projectLimit: 2, availableProjects: 1, quotedCost: 0, currency: 'USD', deletionAuthorized: true, evidenceSha256: 'd'.repeat(64) };
const context = { manifest: manifestFixture(), operationId: '29292929-2929-4292-8292-292929292929', purpose: 'source' as const };
function transport(calls: {url:string;method:string;body:string}[]) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push({url, method: init?.method ?? 'GET', body: String(init?.body ?? '')});
    if (url.endsWith('/organizations/owned-org')) return Response.json({ id: 'owned-org', plan: 'free' });
    if (url.endsWith('/projects')) return Response.json([{ref:'cdefghijklmnopqrstuv',organization_slug:'owned-org',region:'eu-central-1',status:'ACTIVE_HEALTHY'}]);
    if (url.includes('/available-regions')) return Response.json({ all: { specific: [{code:'eu-central-1',type:'specific',provider:'AWS'}] } });
    return Response.json({private:'must not leak'}, {status:403});
  };
}
describe('Supabase exact project adapter', () => {
  it('reads live plan, inventory and region plus separately verified capacity, without mutation', async () => {
    const calls: {url:string;method:string;body:string}[] = [];
    const adapter = createSupabaseOperationsAdapter({ token: 'private-token', fetch: transport(calls), clock: () => now, readCapacityQuote: async () => capacity });
    const result = await adapter.preflight(context);
    expect(result.quotedCost).toBe(0); expect(result.inventoryRefs).toEqual(['cdefghijklmnopqrstuv']);
    expect(calls.every(call => call.method === 'GET')).toBe(true);
  });
  it('never infers available quota or a cost quote from a free plan alone', async () => {
    const adapter = createSupabaseOperationsAdapter({ token: 'private-token', fetch: transport([]), clock: () => now });
    await expect(adapter.preflight(context)).rejects.toThrow('PROVIDER_CAPACITY_HANDOFF_REQUIRED');
  });
  it('rejects deletion of preserved staging before any network request', async () => {
    const calls: {url:string;method:string;body:string}[] = [];
    const adapter = createSupabaseOperationsAdapter({ token: 'private-token', fetch: transport(calls), clock: () => now });
    const bad = structuredClone(context); bad.manifest.source!.ref = bad.manifest.preservedRefs[0];
    await expect(adapter.remove(bad)).rejects.toThrow('PERSISTENT_SOURCE_DELETION_FORBIDDEN');
    expect(calls).toHaveLength(0);
  });
  it('does not reflect provider bodies, credential values or redirect to another host', async () => {
    const adapter = createSupabaseOperationsAdapter({ token:'private-token', fetch: async (_url, init) => { expect(init?.redirect).toBe('error'); return Response.json({token:'private-token',message:'private-provider-body'}, {status:403}); } });
    await expect(adapter.preflight(context)).rejects.toThrow('PROVIDER_READ_FAILED');
  });
});

it('accepts a bodyless exact delete response but requires independent list and direct absence readback',async()=>{
 const c={...structuredClone(context),purpose:'target' as const};const source=c.manifest.target!;
 c.manifest.cleanup.resources.push({provider:'supabase',id:source.ref,runId:c.manifest.runId,createdAt:now,evidenceSha256:'d'.repeat(64),disposition:'disposable',absentAt:null});c.manifest.pending={step:'cleanup-resource',operationId:c.operationId,startedAt:now,resourceId:source.ref,priorStateSha256:null};
 let deleted=false;const methods:string[]=[];
 const adapter=createSupabaseOperationsAdapter({token:'private-token',clock:()=>now,fetch:async(url,init)=>{methods.push(init?.method??'GET');if(init?.method==='DELETE'){deleted=true;return new Response(null,{status:204});}if(String(url).endsWith('/projects'))return Response.json([]);if(deleted)return new Response(null,{status:404});return Response.json({ref:source.ref,organization_slug:source.organizationId,region:source.region});}});
 await adapter.remove(c);expect((await adapter.readAbsent(c)).absent).toBe(true);expect(methods).toEqual(['GET','DELETE','GET','GET']);
 await expect(adapter.remove(c)).rejects.toThrow('MUTATION_ALREADY_ATTEMPTED');
});

import { maintenanceFixture } from '../fixtures/issue29-operations';
import { canonicalJson } from '../../scripts/issue29-operations/recovery-set.mjs';
import { createHash } from 'node:crypto';
const digest=(v:unknown)=>createHash('sha256').update(canonicalJson(v)).digest('hex');
function maintenanceContext(){const c=structuredClone(context);c.manifest.maintenance=maintenanceFixture(c.manifest);c.manifest.maintenance.phase='pause_pending';c.manifest.state='source_pause_pending';c.manifest.allowedActions.push('pause-source','resume-source');c.manifest.cleanup.resources.push({provider:'supabase',id:c.manifest.source!.ref,runId:c.manifest.runId,createdAt:now,evidenceSha256:'d'.repeat(64),disposition:'persistent',absentAt:null});c.manifest.pending={step:'pause-source',operationId:c.operationId,startedAt:now,resourceId:c.manifest.source!.ref,priorStateSha256:digest(c.manifest.maintenance.preservation)};return c;}
it('rejects mismatched persisted preservation before provider access',async()=>{
 const c=maintenanceContext();c.manifest.pending!.priorStateSha256='0'.repeat(64);let calls=0;
 const adapter=createSupabaseOperationsAdapter({token:'private-token',clock:()=>now,fetch:async()=>{calls++;return Response.json({});}});
 await expect(adapter.pauseSource(c)).rejects.toThrow('PERSISTED_INTENT_REQUIRED');expect(calls).toBe(0);
});
it('pauses and resumes once using bodyless POST acknowledgement and independent exact identity readback',async()=>{
 const c=maintenanceContext();let status='ACTIVE_HEALTHY';const calls:string[]=[];
 const adapter=createSupabaseOperationsAdapter({token:'private-token',clock:()=>now,fetch:async(url,init)=>{const path=new URL(String(url)).pathname;calls.push(`${init?.method} ${path}`);if(init?.method==='POST'){expect(init.body).toBeUndefined();status=path.endsWith('/pause')?'INACTIVE':'ACTIVE_HEALTHY';return new Response(null,{status:200});}return Response.json({ref:c.manifest.source!.ref,organization_slug:'owned-org',region:'eu-central-1',database:{version:'17.6.1'},status});}});
 await adapter.pauseSource(c);await expect(adapter.pauseSource(c)).rejects.toThrow('MUTATION_ALREADY_ATTEMPTED');const paused=await adapter.readPaused(c);expect(paused.status).toBe('INACTIVE');expect(paused.configurationObserved).toBe(false);
 c.manifest.state='source_resume_pending';c.manifest.maintenance!.phase='resume_pending';c.operationId='39393939-3939-4393-8393-393939393939';c.manifest.pending!.operationId=c.operationId;c.manifest.pending!.step='resume-source';await adapter.resumeSource(c);expect((await adapter.readResumed(c)).status).toBe('ACTIVE_HEALTHY');expect(calls.filter(x=>x.startsWith('POST'))).toEqual([`POST /v1/projects/${c.manifest.source!.ref}/pause`,`POST /v1/projects/${c.manifest.source!.ref}/restore`]);expect(calls.some(x=>x.includes('DELETE'))).toBe(false);
});
it('derives actual zero slots from scoped two-slot authorization and fresh full inventory, not a quota endpoint',async()=>{
 const c=maintenanceContext();const authorization={schemaVersion:1 as const,policy:'supabase-free-two-active-projects' as const,organizationId:'owned-org',preservedStagingRef:c.manifest.preservedRefs[0],authorizedAt:now,expiresAt:'2026-09-06T12:00:00.000Z',maximumActiveProjects:2 as const,maximumCost:0 as const,evidenceSha256:'a'.repeat(64)};
 let foreign=false;const adapter=createSupabaseOperationsAdapter({token:'private-token',clock:()=>now,twoSlotAuthorization:authorization,fetch:async(url,init)=>String(url).endsWith('/projects')?Response.json([{ref:c.manifest.preservedRefs[0],organization_slug:'owned-org',status:'ACTIVE_HEALTHY'},{ref:c.manifest.source!.ref,organization_slug:foreign?'foreign-org':'owned-org',status:'ACTIVE_HEALTHY'}]):transport([])(url,init)});
 expect((await adapter.preflight(c)).availableProjects).toBe(0);foreign=true;await expect(adapter.preflight(c)).rejects.toThrow('ACCOUNT_CAPACITY_SCOPE_UNPROVEN');
});

it('independently reads historical disposable absence without authorizing source or preserved reads or deletion', async()=>{
 const manifest=manifestFixture(), oldRef='uvwxyzabcdefghijklmn';manifest.forbiddenRefs.push(oldRef);
 manifest.cleanup.resources.push({provider:'supabase',id:oldRef,runId:manifest.runId,createdAt:now,evidenceSha256:'b'.repeat(64),disposition:'disposable',absentAt:now});
 const methods:string[]=[];let stillListed=false;const adapter=createSupabaseOperationsAdapter({token:'private-token',clock:()=>now,fetch:async(url,init)=>{methods.push(init?.method??'GET');return String(url).endsWith('/projects')?Response.json(stillListed?[{ref:oldRef}]:[]):new Response(null,{status:404});}});
 expect((await adapter.readOwnedDisposableAbsent({manifest,resourceId:oldRef})).absent).toBe(true);
 stillListed=true;expect((await adapter.readOwnedDisposableAbsent({manifest,resourceId:oldRef})).absent).toBe(false);
 for(const resourceId of [manifest.source!.ref,manifest.preservedRefs[0],'zzzzzzzzzzzzzzzzzzzz'])await expect(adapter.readOwnedDisposableAbsent({manifest,resourceId})).rejects.toThrow();
 expect(methods).toEqual(['GET','GET','GET','GET']);
});

it('exposes the exact sanitized preflight hash preimage and labels classifications as manifest assertions',async()=>{
 const adapter=createSupabaseOperationsAdapter({token:'private-token',clock:()=>now,readCapacityQuote:async()=>capacity,fetch:async(url,init)=>{const response=await transport([])(url,init);if(String(url).endsWith('/projects'))return Response.json([{ref:'cdefghijklmnopqrstuv',organization_slug:'owned-org',region:'eu-central-1',status:'ACTIVE_HEALTHY',database_password:'DO_NOT_RETAIN',owner_email:'DO_NOT_RETAIN'}]);return response;}});
 const proof=await adapter.preflight(context);expect(digest(proof.evidence)).toBe(proof.evidenceSha256);expect(proof.evidence.providerInventory.projects).toEqual([{ref:'cdefghijklmnopqrstuv',organizationId:'owned-org',region:'eu-central-1',status:'ACTIVE_HEALTHY'}]);expect(proof.evidence.classification.basis).toBe('manifest-authorization-only');expect(JSON.stringify(proof)).not.toContain('DO_NOT_RETAIN');
});

function pendingSourceContext(){const c=structuredClone(context);c.manifest.source=null;c.manifest.target=null;c.manifest.sourceProvenance=null;c.manifest.forbiddenRefs=[...c.manifest.preservedRefs];c.manifest.state='source_creation_pending';c.manifest.pending={step:'create-source',operationId:c.operationId,startedAt:now,resourceId:null,priorStateSha256:null};return c;}
function ownerSourceAuthorization(c:ReturnType<typeof pendingSourceContext>,overrides:Record<string,unknown>={}){return{schemaVersion:1 as const,policy:'issue29-owner-authorized-pending-source-readback' as const,runId:c.manifest.runId,operationId:c.operationId,organizationId:c.manifest.provisioning.organizationId,projectRef:'zvqmspihywhxdzxpgtzo',region:c.manifest.provisioning.region,sourceName:c.manifest.provisioning.sourceName,observedCreatedAt:'2026-09-05T11:20:24.000Z',authorizedAt:'2026-09-05T11:59:00.000Z',expiresAt:'2026-09-05T13:00:00.000Z',evidenceSha256:'5'.repeat(64),...overrides};}
function staleCreatedProject(c:ReturnType<typeof pendingSourceContext>,purpose:'source'|'target'='source'){const name=purpose==='source'?c.manifest.provisioning.sourceName:c.manifest.provisioning.targetName;return async(input:string|URL|Request,init?:RequestInit)=>{const url=String(input);if(url.endsWith('/projects'))return Response.json([{name,ref:'zvqmspihywhxdzxpgtzo'}]);return Response.json({name,ref:'zvqmspihywhxdzxpgtzo',organization_slug:c.manifest.provisioning.organizationId,region:c.manifest.provisioning.region,status:'ACTIVE_HEALTHY',created_at:'2026-09-05T11:20:24.000Z',database:{version:'17.6.1'}});};}
describe('owner-authorized pending source readback',()=>{
 it('preserves the observed creation time and labels an authorized readback without POST',async()=>{
  const c=pendingSourceContext(),methods:string[]=[];const adapter=createSupabaseOperationsAdapter({token:'private-token',clock:()=>now,ownerSourceAuthorization:ownerSourceAuthorization(c),inspectEmpty:async()=>true,fetch:async(input,init)=>{methods.push(init?.method??'GET');return staleCreatedProject(c)(input,init);}});
  const proof=await adapter.readCreated(c);expect(proof.createdAt).toBe('2026-09-05T11:20:24.000Z');expect(proof.evidence.kind).toBe('issue29-supabase-owner-authorized-source');expect(methods).toEqual(['GET','GET']);expect(methods).not.toContain('POST');
 });
 it('keeps the normal creation-time fence when no owner authorization is supplied',async()=>{
  const c=pendingSourceContext(),adapter=createSupabaseOperationsAdapter({token:'private-token',clock:()=>now,inspectEmpty:async()=>true,fetch:staleCreatedProject(c)});
  await expect(adapter.readCreated(c)).rejects.toThrow('CREATION_TIME_MISMATCH');
 });
 it('validates a supplied authorization even when the provider timestamp passes the normal window',async()=>{
  const c=pendingSourceContext();let inspected=false;const adapter=createSupabaseOperationsAdapter({token:'private-token',clock:()=>now,ownerSourceAuthorization:ownerSourceAuthorization(c,{projectRef:'abcdefghijklmnopqrst'}),inspectEmpty:async()=>{inspected=true;return true;},fetch:async(input)=>{const url=String(input),name=c.manifest.provisioning.sourceName;if(url.endsWith('/projects'))return Response.json([{name,ref:'zvqmspihywhxdzxpgtzo'}]);return Response.json({name,ref:'zvqmspihywhxdzxpgtzo',organization_slug:c.manifest.provisioning.organizationId,region:c.manifest.provisioning.region,status:'ACTIVE_HEALTHY',created_at:now,database:{version:'17.6.1'}});}});
  await expect(adapter.readCreated(c)).rejects.toThrow('OWNER_SOURCE_AUTHORIZATION_MISMATCH');expect(inspected).toBe(false);
 });
 it('rejects a future provider timestamp even with an otherwise matching authorization',async()=>{
  const c=pendingSourceContext(),future='2026-09-05T12:06:00.000Z';let inspected=false;const adapter=createSupabaseOperationsAdapter({token:'private-token',clock:()=>now,ownerSourceAuthorization:ownerSourceAuthorization(c,{observedCreatedAt:future}),inspectEmpty:async()=>{inspected=true;return true;},fetch:async(input)=>{const url=String(input),name=c.manifest.provisioning.sourceName;if(url.endsWith('/projects'))return Response.json([{name,ref:'zvqmspihywhxdzxpgtzo'}]);return Response.json({name,ref:'zvqmspihywhxdzxpgtzo',organization_slug:c.manifest.provisioning.organizationId,region:c.manifest.provisioning.region,status:'ACTIVE_HEALTHY',created_at:future,database:{version:'17.6.1'}});}});
  await expect(adapter.readCreated(c)).rejects.toThrow('CREATION_TIME_MISMATCH');expect(inspected).toBe(false);
 });
 it.each([
  ['mismatched operation',{operationId:'39393939-3939-4393-8393-393939393939'},'OWNER_SOURCE_AUTHORIZATION_MISMATCH'],
  ['expired authorization',{expiresAt:now},'OWNER_SOURCE_AUTHORIZATION_EXPIRED']
 ])('rejects %s before empty-state inspection',async(_name,overrides,code)=>{
  const c=pendingSourceContext();let inspected=false;const adapter=createSupabaseOperationsAdapter({token:'private-token',clock:()=>now,ownerSourceAuthorization:ownerSourceAuthorization(c,overrides),inspectEmpty:async()=>{inspected=true;return true;},fetch:staleCreatedProject(c)});
  await expect(adapter.readCreated(c)).rejects.toThrow(code);expect(inspected).toBe(false);
 });
 it('cannot be consumed for targets or preserved source refs',async()=>{
  const c=pendingSourceContext(),targetContext={...c,purpose:'target' as const};const targetAdapter=createSupabaseOperationsAdapter({token:'private-token',clock:()=>now,ownerSourceAuthorization:ownerSourceAuthorization(c),inspectEmpty:async()=>true,fetch:staleCreatedProject(c,'target')});
  await expect(targetAdapter.readCreated(targetContext)).rejects.toThrow('OWNER_SOURCE_AUTHORIZATION_SCOPE_FORBIDDEN');
  const preserved=pendingSourceContext(),ref=preserved.manifest.preservedRefs[0];const adapter=createSupabaseOperationsAdapter({token:'private-token',clock:()=>now,ownerSourceAuthorization:ownerSourceAuthorization(preserved,{projectRef:ref}),inspectEmpty:async()=>true,fetch:async(input,init)=>{const url=String(input);if(url.endsWith('/projects'))return Response.json([{name:preserved.manifest.provisioning.sourceName,ref}]);return Response.json({name:preserved.manifest.provisioning.sourceName,ref,organization_slug:preserved.manifest.provisioning.organizationId,region:preserved.manifest.provisioning.region,status:'ACTIVE_HEALTHY',created_at:'2026-09-05T11:20:24.000Z',database:{version:'17.6.1'}});}});
  await expect(adapter.readCreated(preserved)).rejects.toThrow('TARGET_IDENTITY_MISMATCH');
 });
});
