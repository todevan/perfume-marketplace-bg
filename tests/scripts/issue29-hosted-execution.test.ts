import{createHash}from'node:crypto';import{canonicalJson}from'../../scripts/issue29-operations/recovery-set.mjs';
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executeHostedLifecycle,lifecycleDatabaseConnection} from '../../scripts/issue29-operations/hosted-execution.mjs';
import {writePrivateManifest,readPrivateManifest} from '../../scripts/issue29-operations/manifest.mjs';
import {manifestFixture,candidate} from '../fixtures/issue29-operations';
const dirs:string[]=[];const now='2026-09-05T12:01:00.000Z';
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function fixture(){const d=await mkdtemp(join(tmpdir(),'issue29-hosted-'));dirs.push(d);const manifest=manifestFixture();manifest.source=null;manifest.target=null;manifest.sourceProvenance=null;manifest.forbiddenRefs=[...manifest.preservedRefs];const manifestPath=join(d,'manifest.json');await writePrivateManifest(manifestPath,manifest,{repositoryRoot:process.cwd(),now});const settings={schemaVersion:1,operation:'preflight',providerToken:'private-management-token',capability:{role:'source-read',id:manifest.capabilityIds['source-read']}};const settingsPath=join(d,'settings.json');await writeFile(settingsPath,JSON.stringify(settings),{mode:0o600});return{d,manifest,manifestPath,settingsPath,settings,repositoryRoot:process.cwd(),candidate,now,operation:'preflight'};}
it('wires preflight into the existing persisted lifecycle with no mutation',async()=>{
 const f=await fixture();const proof={organizationId:'owned-org',region:'eu-central-1',checkedAt:now,expiresAt:'2026-09-05T12:02:00.000Z',plan:'free',projectLimit:2,activeProjectCount:1,availableProjects:1,quotedCost:0,currency:'USD',deletionSupported:true,regionAvailable:true,inventoryRefs:f.manifest.preservedRefs,evidenceSha256:'e'.repeat(64)};
 const {evidenceSha256:_hash,...evidence}=proof;const observed={...proof,evidence,evidenceSha256:createHash('sha256').update(canonicalJson(evidence)).digest('hex')};const mutate=vi.fn();const adapterFactory=vi.fn(()=>({preflight:async()=>observed,create:mutate}));
 const result=await executeHostedLifecycle(f,{adapterFactory} as any);expect(result.state).toBe('provider_preflighted');expect(mutate).not.toHaveBeenCalled();expect(await readPrivateManifest(f.manifestPath,{repositoryRoot:f.repositoryRoot,now})).toMatchObject({state:'provider_preflighted',pending:null});expect(JSON.stringify(result)).not.toContain('private-management-token');
});
it.each(['wrong-role','operation-mismatch','public-settings','unapproved-field'])('fails before provider access for %s',async kind=>{
 const f=await fixture();if(kind==='wrong-role')f.settings.capability.role='restore-write';if(kind==='operation-mismatch')f.operation='create-source';if(kind==='unapproved-field')(f.settings as any).sql='DROP SCHEMA public CASCADE;';await writeFile(f.settingsPath,JSON.stringify(f.settings));if(kind==='public-settings'){const {chmod}=await import('node:fs/promises');await chmod(f.settingsPath,0o644);}const adapterFactory=vi.fn();await expect(executeHostedLifecycle(f,{adapterFactory})).rejects.toThrow('Issue #29:');expect(adapterFactory).not.toHaveBeenCalled();
});
it('accepts the exact Supabase session-pooler coordinates and rejects foreign host or project user bindings',()=>{
 const m=manifestFixture(),scope={runId:m.runId,ref:m.source!.ref,sourceRef:m.source!.ref,preservedRefs:m.preservedRefs,createdResourceEvidenceSha256:'d'.repeat(64),url:m.source!.url};const pooler={host:'aws-0-eu-central-1.pooler.supabase.com',port:5432 as const,database:'postgres' as const,user:`postgres.${m.source!.ref}`,sslmode:'verify-full' as const,sslRootCert:'supabase-prod-2021' as const};
 expect(lifecycleDatabaseConnection(scope,'source','private-password',pooler)).toMatchObject(pooler);
 expect(()=>lifecycleDatabaseConnection(scope,'source','private-password',{...pooler,host:'foreign.pooler.supabase.com'})).toThrow('DATABASE_TARGET_MISMATCH');
 expect(()=>lifecycleDatabaseConnection(scope,'source','private-password',{...pooler,user:'postgres.bcdefghijklmnopqrstu'})).toThrow('DATABASE_TARGET_MISMATCH');
});
