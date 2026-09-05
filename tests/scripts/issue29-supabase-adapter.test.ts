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
    await expect(adapter.remove(bad)).rejects.toThrow('PRESERVED_PROJECT_FORBIDDEN');
    expect(calls).toHaveLength(0);
  });
  it('does not reflect provider bodies, credential values or redirect to another host', async () => {
    const adapter = createSupabaseOperationsAdapter({ token:'private-token', fetch: async (_url, init) => { expect(init?.redirect).toBe('error'); return Response.json({token:'private-token',message:'private-provider-body'}, {status:403}); } });
    await expect(adapter.preflight(context)).rejects.toThrow('PROVIDER_READ_FAILED');
  });
});

it('accepts a bodyless exact delete response but requires independent list and direct absence readback',async()=>{
 const c=structuredClone(context);const source=c.manifest.source!;
 c.manifest.cleanup.resources.push({provider:'supabase',id:source.ref,runId:c.manifest.runId,createdAt:now,evidenceSha256:'d'.repeat(64),disposition:'disposable',absentAt:null});c.manifest.pending={step:'retire-source',operationId:c.operationId,startedAt:now,resourceId:source.ref,priorStateSha256:null};
 let deleted=false;const methods:string[]=[];
 const adapter=createSupabaseOperationsAdapter({token:'private-token',clock:()=>now,fetch:async(url,init)=>{methods.push(init?.method??'GET');if(init?.method==='DELETE'){deleted=true;return new Response(null,{status:204});}if(String(url).endsWith('/projects'))return Response.json([]);if(deleted)return new Response(null,{status:404});return Response.json({ref:source.ref,organization_slug:source.organizationId,region:source.region});}});
 await adapter.remove(c);expect((await adapter.readAbsent(c)).absent).toBe(true);expect(methods).toEqual(['GET','DELETE','GET','GET']);
 await expect(adapter.remove(c)).rejects.toThrow('MUTATION_ALREADY_ATTEMPTED');
});
