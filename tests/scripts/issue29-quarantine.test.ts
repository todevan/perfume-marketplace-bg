import { it, expect } from 'vitest';
import { readRestoreQuarantine } from '../../scripts/issue29-operations/quarantine.mjs';
import { manifestFixture } from '../fixtures/issue29-operations';
const now='2026-09-05T12:01:00.000Z';
function fixture(){const m=manifestFixture();m.state='target_read_back';m.cleanup.resources.push({provider:'supabase',id:m.target!.ref,runId:m.runId,createdAt:'2026-09-05T12:00:00.000Z',evidenceSha256:'d'.repeat(64),disposition:'disposable',absentAt:null});return m;}
function request(change?:(path:string,value:any)=>any){return async(url:string|URL|Request,init?:RequestInit)=>{expect(init?.redirect).toBe('error');const path=String(url);let value:any=path.endsWith('/functions')?[]:path.endsWith('/config/auth')?Object.fromEntries(['custom_access_token','mfa_verification_attempt','password_verification_attempt','send_sms','send_email','before_user_created','after_user_created'].map(k=>[`hook_${k}_enabled`,false])):path.includes('/organizations/')?{id:'owned-org',plan:'free'}:{ref:fixture().target!.ref,organization_slug:'owned-org',region:'eu-central-1',status:'ACTIVE_HEALTHY',database:{version:'17.6.1'},created_at:'2026-09-05T12:00:00Z'};return Response.json(change?change(path,value):value);};}
it('generates quarantine only from exact new project and disabled provider effects',async()=>{
 const result=await readRestoreQuarantine({manifest:fixture(),providerToken:'private-token',fetchImpl:request(),now});expect(result.quarantine.projectRef).toBe(fixture().target!.ref);expect(result.quarantine.noOutboundIntegrations).toBe(true);expect(JSON.stringify(result)).not.toContain('private-token');
});
it.each(['hook','function','project','worker'])('fails before restore writes on %s uncertainty',async kind=>{
 const manifest=fixture();if(kind==='worker')manifest.cleanup.resources.push({provider:'cloudflare',id:'issue29-fixture',runId:manifest.runId,createdAt:now,evidenceSha256:'d'.repeat(64),disposition:'disposable',absentAt:null});
 const fetchImpl=request((p,v)=>{if(kind==='hook'&&p.endsWith('/config/auth'))v.hook_send_email_enabled=true;if(kind==='function'&&p.endsWith('/functions'))v.push({id:'unknown'});if(kind==='project'&&v.ref)v.ref='z'.repeat(20);return v;});
 await expect(readRestoreQuarantine({manifest,providerToken:'private-token',fetchImpl,now})).rejects.toThrow('Issue #29:');
});
