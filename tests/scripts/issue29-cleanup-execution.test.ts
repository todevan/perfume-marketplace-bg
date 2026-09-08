import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {canonicalJson} from '../../scripts/issue29-operations/recovery-set.mjs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {executeProjectCleanup} from '../../scripts/issue29-operations/cleanup-execution.mjs';
import {readPrivateManifest,writePrivateManifest} from '../../scripts/issue29-operations/manifest.mjs';
import {manifestFixture,candidate} from '../fixtures/issue29-operations';
const dirs:string[]=[];const now='2026-09-05T12:01:00.000Z';
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const evidence={projectRef:'bcdefghijklmnopqrstu',absent:true,checkedAt:now};const proof={absent:true,evidence,evidenceSha256:createHash('sha256').update(canonicalJson(evidence)).digest('hex')};
async function fixture(){const d=await mkdtemp(join(tmpdir(),'issue29-cleanup-'));dirs.push(d);const m=manifestFixture();m.state='incident_drill_verified';m.cleanup.resources=[{provider:'supabase',id:m.source!.ref,runId:m.runId,createdAt:now,evidenceSha256:'e'.repeat(64),disposition:'persistent',absentAt:null},{provider:'supabase',id:m.target!.ref,runId:m.runId,createdAt:now,evidenceSha256:'f'.repeat(64),disposition:'disposable',absentAt:null}];const manifestPath=join(d,'manifest.json');await writePrivateManifest(manifestPath,m,{repositoryRoot:process.cwd(),now});const settingsPath=join(d,'settings.json');await writeFile(settingsPath,JSON.stringify({schemaVersion:1,operation:'cleanup',action:'delete-restore-project',providerToken:'private-provider-token',capabilityId:m.capabilityIds.cleanup}),{mode:0o600});return{manifest:m,manifestPath,settingsPath,repositoryRoot:process.cwd(),candidate,now};}
it('persists exact deletion before mutation and proves absence without touching persistent source',async()=>{
 const f=await fixture();let count=0;const factory=()=>({remove:async(ctx:any)=>{const m=await readPrivateManifest(f.manifestPath,{repositoryRoot:f.repositoryRoot,now});expect(m.pending?.resourceId).toBe(f.manifest.target!.ref);expect(ctx.purpose).toBe('target');count++;},readAbsent:async()=>(proof)});
 expect(await executeProjectCleanup(f,{adapterFactory:factory} as any)).toMatchObject({status:'DISPOSABLE_RESTORE_PROJECT_ABSENT'});const m=await readPrivateManifest(f.manifestPath,{repositoryRoot:f.repositoryRoot,now});expect(m.cleanup.resources[0].absentAt).toBeNull();expect(m.cleanup.resources[1].absentAt).toBe(now);expect(m.pending).toBeNull();const record=m.history.at(-1)!;expect(record.intentSha256).toMatch(/^[a-f0-9]{64}$/);const raw=JSON.parse(await readFile(join(f.manifestPath,'..',record.intentSha256+'.json'),'utf8'));expect(raw.pending.resourceId).toBe(f.manifest.target!.ref);expect(raw.pending.step).toBe('cleanup-resource');expect(await readFile(join(f.manifestPath,'..',record.evidenceSha256+'.json'),'utf8')).toBe(canonicalJson(evidence));await executeProjectCleanup(f,{adapterFactory:factory} as any);expect(count).toBe(1);
});
it('does not repeat an uncertain DELETE on resume',async()=>{
 const f=await fixture();const remove=vi.fn(async()=>{throw new Error('private response');});const factory=()=>({remove,readAbsent:async()=>(proof)});await expect(executeProjectCleanup(f,{adapterFactory:factory} as any)).rejects.toThrow('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY');await executeProjectCleanup(f,{adapterFactory:factory} as any);expect(remove).toHaveBeenCalledTimes(1);
});
it('rejects selecting a persistent project before provider access',async()=>{const f=await fixture();f.manifest.cleanup.resources[1].disposition='persistent';await writePrivateManifest(f.manifestPath,f.manifest,{repositoryRoot:f.repositoryRoot,now,replace:true});const factory=vi.fn();await expect(executeProjectCleanup(f,{adapterFactory:factory})).rejects.toThrow('CLEANUP_OWNERSHIP_MISMATCH');expect(factory).not.toHaveBeenCalled();});
