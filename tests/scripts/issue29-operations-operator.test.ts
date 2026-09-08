import{createHash}from'node:crypto';import{canonicalJson}from'../../scripts/issue29-operations/recovery-set.mjs';
function evidenced<T extends Record<string,unknown>>(value:T){const{evidenceSha256:_hash,evidence:_old,...evidence}=value;return{...value,evidence,evidenceSha256:createHash('sha256').update(canonicalJson(evidence)).digest('hex')};}
import { afterEach, describe, expect, test } from 'vitest';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPrivateManifest, validateManifest, writePrivateManifest } from '../../scripts/issue29-operations/manifest.mjs';
const now = '2026-09-05T12:00:00.000Z';
import { candidate, source, target, manifestFixture } from '../fixtures/issue29-operations';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function privatePath() { const dir = await mkdtemp(join(tmpdir(), 'issue29-test-')); await chmod(dir, 0o700); directories.push(dir); return join(dir, 'manifest.json'); }
describe('Issue #29 private transaction boundary', () => {
    test('accepts only a current exact-candidate synthetic transaction with distinct recovery target', async () => {
        const path = await privatePath();
        await writePrivateManifest(path, manifestFixture(), { repositoryRoot: process.cwd(), now, candidate });
        expect((await readPrivateManifest(path, { repositoryRoot: process.cwd(), now, candidate })).runId).toBe('29292929-2929-4292-8292-292929292929');
        expect(() => validateManifest({ ...manifestFixture(), target: source }, { now, candidate })).toThrow('TARGET_FORBIDDEN');
    });
});
import { assertExactTarget, buildChildEnvironment } from '../../scripts/issue29-operations/manifest.mjs';
function projectReadback() {
    return { ...target, status: 'ACTIVE_HEALTHY', plan: 'free', cost: 0, owned: true, freeCapacity: true,
        credential: { id: 'restore-key', role: 'restore-write', projectRef: target.ref, organizationId: target.organizationId }, candidate,
        isolation: { productionRoutes: false, stagingRoutes: false, foreignSecrets: false, foreignUsers: false, foreignData: false, foreignObjects: false, outboundEffects: false } };
}
describe('exact-target mutation guards', () => {
    test('binds the credential purpose and readback to one zero-cost isolated target', () => {
        expect(assertExactTarget(manifestFixture(), projectReadback(), { role: 'restore-write', now })).toEqual(target);
        expect(() => assertExactTarget(manifestFixture(), { ...projectReadback(), credential: { ...projectReadback().credential, role: 'source-read' } }, { role: 'restore-write', now })).toThrow('CREDENTIAL_ROLE_MISMATCH');
        expect(buildChildEnvironment({ PATH: '/usr/bin', NODE_OPTIONS: '--require evil', SUPABASE_ACCESS_TOKEN: 'foreign', PGHOST: 'target', PGPASSWORD: 'private' }, 'restore-write')).toEqual({ PATH: '/usr/bin', PGHOST: 'target', PGPASSWORD: 'private' });
    });
});
import { executeOperatorStep, executeProjectLifecycleStep, persistOperationsIntent } from '../../scripts/issue29-operations/operator.mjs';
describe('persisted mutation execution', () => {
    test('writes pending intent before one mutation and advances only after exact readback', async () => {
        const path = await privatePath();
        const input = manifestFixture();
        input.state = 'quarantine_verified';
        await writePrivateManifest(path, input, { repositoryRoot: process.cwd(), now });
        const evidence = { status: 'verified', evidenceSha256: 'd'.repeat(64), operationId: '', resourceId: null, targetRef: target.ref, candidateSha: candidate.sha, completedAt: now };
        let mutations = 0;
        const result = await executeOperatorStep({ manifestPath: path, repositoryRoot: process.cwd(), step: 'restore-database', capability: 'restore-write', candidate, now,
            inspect: async () => projectReadback(),
            mutate: async ({ operationId }) => { const persisted = await readPrivateManifest(path, { repositoryRoot: process.cwd(), now }); expect(persisted.pending?.operationId).toBe(operationId); expect(persisted.state).toBe('quarantine_verified'); mutations++; evidence.operationId = operationId; },
            readback: async () => evidenced(evidence) });
        expect(result.state).toBe('database_restored');
        expect(result.pending).toBeNull();
        expect(mutations).toBe(1);
    });
});
describe('ambiguous mutation recovery', () => {
    test('never retries a mutation whose outcome is unknown, but permits exact readback-only resume', async () => {
        const path = await privatePath();
        const input = manifestFixture();
        input.state = 'quarantine_verified';
        await writePrivateManifest(path, input, { repositoryRoot: process.cwd(), now });
        let mutations = 0;
        const base = { manifestPath: path, repositoryRoot: process.cwd(), step: 'restore-database', capability: 'restore-write' as const, candidate, now,
            inspect: async () => projectReadback(), mutate: async () => { mutations++; throw new Error('SECRET_PROVIDER_BODY'); } };
        await expect(executeOperatorStep({ ...base, readback: async () => { throw new Error('not reached'); } })).rejects.toThrow('MUTATION_OUTCOME_UNCERTAIN_READBACK_ONLY');
        const pending = (await readPrivateManifest(path, { repositoryRoot: process.cwd(), now })).pending!;
        await expect(executeOperatorStep({ ...base, step: 'restore-storage', readback: async () => { throw new Error('not reached'); } })).rejects.toThrow('PENDING_OPERATION_REQUIRES_READBACK');
        await expect(executeOperatorStep({ ...base, readback: async () => { throw new Error('SECRET_PROVIDER_BODY'); } })).rejects.toThrow('READBACK_UNCERTAIN_NO_RETRY');
        const recovered = await executeOperatorStep({ ...base, readback: async () => evidenced({ status: 'verified', evidenceSha256: 'd'.repeat(64), operationId: pending.operationId, resourceId: null, targetRef: target.ref, candidateSha: candidate.sha, completedAt: now }) });
        expect(recovered.state).toBe('database_restored');
        expect(mutations).toBe(1);
        await executeOperatorStep({ ...base, readback: async () => { throw new Error('must not repeat'); } });
        expect(mutations).toBe(1);
    });
    test.each([
        ['organization', (value: ReturnType<typeof projectReadback>) => { value.organizationId = 'foreign'; }],
        ['region', (value: ReturnType<typeof projectReadback>) => { value.region = 'us-east-1'; }],
        ['status', (value: ReturnType<typeof projectReadback>) => { value.status = 'COMING_UP'; }],
        ['plan', (value: ReturnType<typeof projectReadback>) => { value.plan = 'pro'; }],
        ['cost', (value: ReturnType<typeof projectReadback>) => { value.cost = 1; }],
        ['credential ID', (value: ReturnType<typeof projectReadback>) => { value.credential.id = 'wrong'; }],
        ['foreign users', (value: ReturnType<typeof projectReadback>) => { value.isolation.foreignUsers = true; }],
        ['outbound effects', (value: ReturnType<typeof projectReadback>) => { value.isolation.outboundEffects = true; }]
    ])('rejects %s mismatch before intent or mutation', async (_name, change) => {
        const path = await privatePath();
        const input = manifestFixture();
        input.state = 'quarantine_verified';
        const observed = projectReadback();
        change(observed);
        await writePrivateManifest(path, input, { repositoryRoot: process.cwd(), now });
        let mutated = false;
        await expect(executeOperatorStep({ manifestPath: path, repositoryRoot: process.cwd(), step: 'restore-database', capability: 'restore-write', candidate, now,
            inspect: async () => observed, mutate: async () => { mutated = true; }, readback: async () => { throw new Error('not reached'); } })).rejects.toThrow();
        expect(mutated).toBe(false);
        expect((await readPrivateManifest(path, { repositoryRoot: process.cwd(), now })).pending).toBeNull();
    });
});
describe('private manifest rejection', () => {
    test.each(['expiry', 'candidate', 'forbidden', 'cost', 'secret', 'source classification', 'retention'])('rejects %s drift', (kind) => {
        const value = manifestFixture();
        if (kind === 'expiry')
            value.expiresAt = now;
        if (kind === 'candidate')
            value.candidate = { ...candidate, sha: 'e'.repeat(40) };
        if (kind === 'forbidden')
            value.forbiddenRefs.push(target.ref);
        if (kind === 'cost')
            value.maximumCost = 1;
        if (kind === 'secret')
            Object.assign(value, { accessToken: 'private' });
        if (kind === 'source classification')
            value.source = { ...source, classification: 'unknown' };
        if (kind === 'retention')
            value.backup.retentionDays = 7;
        expect(() => validateManifest(value, { now, candidate })).toThrow();
    });
    test('rejects non-private modes, symlinks, repository paths, and overwrite', async () => {
        const path = await privatePath();
        await writePrivateManifest(path, manifestFixture(), { repositoryRoot: process.cwd(), now });
        await expect(writePrivateManifest(path, manifestFixture(), { repositoryRoot: process.cwd(), now })).rejects.toThrow('PRIVATE_MANIFEST_WRITE_FAILED');
        await chmod(path, 0o644);
        await expect(readPrivateManifest(path, { repositoryRoot: process.cwd(), now })).rejects.toThrow('PRIVATE_FILE_MODE_REQUIRED');
        await chmod(path, 0o600);
        const linked = `${path}.link`;
        await symlink(path, linked);
        await expect(readPrivateManifest(linked, { repositoryRoot: process.cwd(), now })).rejects.toThrow('PRIVATE_FILE_MODE_REQUIRED');
        await expect(writePrivateManifest(join(process.cwd(), 'test-private.json'), manifestFixture(), { repositoryRoot: process.cwd(), now })).rejects.toThrow('PRIVATE_PATH_IN_REPOSITORY');
    });
});
describe('manifest-owned cleanup', () => {
    test('retains the exact disposable resource until an independent absence readback succeeds', async () => {
        const path = await privatePath();
        const input = manifestFixture();
        input.state = 'incident_drill_verified';
        input.cleanup.resources = [{ provider: 'supabase', id: target.ref, runId: input.runId, createdAt: now, evidenceSha256: 'd'.repeat(64), disposition: 'disposable', absentAt: null }];
        await writePrivateManifest(path, input, { repositoryRoot: process.cwd(), now });
        let deleted = 0;
        const observed = projectReadback();
        observed.credential = { ...observed.credential, id: 'cleanup-key', role: 'cleanup' };
        const base = { manifestPath: path, repositoryRoot: process.cwd(), step: 'cleanup-resource', capability: 'cleanup' as const, resourceId: target.ref, candidate, now, inspect: async () => observed, mutate: async () => { deleted++; } };
        await expect(executeOperatorStep({ ...base, readback: async ({ operationId }) => evidenced({ operationId, status: 'present', resourceId: target.ref, targetRef: target.ref, candidateSha: candidate.sha, completedAt: now, evidenceSha256: 'f'.repeat(64) }) })).rejects.toThrow('READBACK_UNCERTAIN_NO_RETRY');
        expect((await readPrivateManifest(path, { repositoryRoot: process.cwd(), now })).cleanup.resources[0].absentAt).toBeNull();
        const final = await executeOperatorStep({ ...base, readback: async ({ operationId }) => evidenced({ operationId, status: 'absent', resourceId: target.ref, targetRef: target.ref, candidateSha: candidate.sha, completedAt: now, evidenceSha256: 'f'.repeat(64) }) });
        expect(deleted).toBe(1);
        expect(final.cleanup.resources[0].absentAt).toBe(now);
    });
    test('never deletes an unowned or retained persistent resource', async () => {
        const path = await privatePath();
        const input = manifestFixture();
        input.state = 'incident_drill_verified';
        input.cleanup.resources = [{ provider: 'cloudflare-monitor', id: 'persistent-rule', runId: input.runId, createdAt: now, evidenceSha256: 'd'.repeat(64), disposition: 'persistent', absentAt: null }];
        await writePrivateManifest(path, input, { repositoryRoot: process.cwd(), now });
        for (const resourceId of ['foreign-project', 'persistent-rule'])
            await expect(executeOperatorStep({ manifestPath: path, repositoryRoot: process.cwd(), step: 'cleanup-resource', capability: 'cleanup', resourceId, candidate, now, inspect: async () => { throw new Error('not reached'); }, mutate: async () => { throw new Error('not reached'); }, readback: async () => { throw new Error('not reached'); } })).rejects.toThrow('CLEANUP_OWNERSHIP_MISMATCH');
    });
    test('rejects duplicate resource identity across providers before cleanup can become ambiguous', () => {
        const input = manifestFixture();
        input.cleanup.resources = ['cloudflare-monitor', 'cloudflare'].map(provider => ({ provider, id: 'same-id', runId: input.runId, createdAt: now, evidenceSha256: 'd'.repeat(64), disposition: 'disposable', absentAt: null }));
        expect(() => validateManifest(input, { now })).toThrow('MANIFEST_INVALID');
    });
});
test('requires the fresh project lifecycle for target creation instead of legacy source health assumptions',async()=>{
    const path=await privatePath(); const input=manifestFixture(); input.state='backup_verified'; input.target=null; await writePrivateManifest(path,input,{repositoryRoot:process.cwd(),now});
    await expect(executeOperatorStep({manifestPath:path,repositoryRoot:process.cwd(),step:'create-target',capability:'restore-write',candidate,now,inspect:async()=>projectReadback(),mutate:async()=>{throw new Error('must not mutate');},readback:async()=>{throw new Error('must not read');}})).rejects.toThrow('FRESH_PROJECT_LIFECYCLE_REQUIRED');
});

test('does not admit a nonempty owner-authorized pending source readback',async()=>{
 const path=await privatePath(),input=manifestFixture();input.source=null;input.target=null;input.sourceProvenance=null;input.forbiddenRefs=[...input.preservedRefs];input.state='source_creation_pending';input.pending={step:'create-source',operationId:input.runId,startedAt:now,resourceId:null,priorStateSha256:null};await writePrivateManifest(path,input,{repositoryRoot:process.cwd(),now});await persistOperationsIntent(path,input,process.cwd());
 const ownerSourceAuthorization={schemaVersion:1,policy:'issue29-owner-authorized-pending-source-readback',runId:input.runId,operationId:input.runId,organizationId:input.provisioning.organizationId,projectRef:source.ref,region:input.provisioning.region,sourceName:input.provisioning.sourceName,observedCreatedAt:'2026-09-05T11:20:24.000Z',authorizedAt:'2026-09-05T11:59:00.000Z',expiresAt:'2026-09-05T13:00:00.000Z',evidenceSha256:'e'.repeat(64),originalIntentSha256:'a'.repeat(64)};
 const proof=evidenced({project:source,createdAt:'2026-09-05T11:20:24.000Z',foreignState:true,ownerSourceAuthorization});
 await expect(executeProjectLifecycleStep({manifestPath:path,repositoryRoot:process.cwd(),candidate,step:'create-source',now,adapter:{preflight:async()=>{throw new Error('not reached');},readCreated:async()=>proof as any}})).rejects.toThrow('TARGET_IDENTITY_MISMATCH');
 expect((await readPrivateManifest(path,{repositoryRoot:process.cwd(),candidate,now})).pending?.step).toBe('create-source');
});

test('checks the live completion clock for a legitimate restore longer than five minutes',async()=>{
    const path=await privatePath(); const input=manifestFixture(); input.state='quarantine_verified'; await writePrivateManifest(path,input,{repositoryRoot:process.cwd(),now}); let liveTime=now;
    const result=await executeOperatorStep({manifestPath:path,repositoryRoot:process.cwd(),step:'restore-database',capability:'restore-write',candidate,clock:()=>liveTime,inspect:async()=>projectReadback(),mutate:async()=>{liveTime='2026-09-05T12:30:00.000Z';},readback:async({operationId})=>evidenced({operationId,status:'verified',resourceId:null,targetRef:target.ref,candidateSha:candidate.sha,completedAt:liveTime,evidenceSha256:'f'.repeat(64)})});
    expect(result.state).toBe('database_restored'); expect(result.history[0].completedAt).toBe('2026-09-05T12:30:00.000Z');
});

test('final cleanup verifies absence without probing an already retired source', async () => {
 const path=await privatePath();const manifest=manifestFixture();manifest.state='transient_cleanup_pending';
 manifest.cleanup.resources.push({provider:'supabase',id:source.ref,runId:manifest.runId,createdAt:now,evidenceSha256:'d'.repeat(64),disposition:'disposable',absentAt:now});
 await writePrivateManifest(path,manifest,{repositoryRoot:process.cwd(),now});
 let inspections=0;
 const result=await executeOperatorStep({manifestPath:path,repositoryRoot:process.cwd(),step:'cleanup',capability:'cleanup',candidate,now,
  inspect:async()=>{inspections++;throw new Error('source no longer exists');},
  readback:async({operationId})=>evidenced({operationId,resourceId:null,targetRef:source.ref,candidateSha:candidate.sha,status:'verified',completedAt:now,evidenceSha256:'e'.repeat(64)})});
 expect(result.state).toBe('cleanup_verified');expect(inspections).toBe(0);
});

async function ownerAuthorizedReboundPending() {
 const path=await privatePath(),input=manifestFixture(),originalCandidate={sha:'c'.repeat(40),tree:'d'.repeat(40),deploymentId:'original-29'};
 input.candidate=originalCandidate;input.source=null;input.target=null;input.sourceProvenance=null;input.forbiddenRefs=[...input.preservedRefs];input.state='source_creation_pending';input.pending={step:'create-source',operationId:input.runId,startedAt:now,resourceId:null,priorStateSha256:null};
 await writePrivateManifest(path,input,{repositoryRoot:process.cwd(),now,candidate:originalCandidate});
 const originalIntentSha256=await persistOperationsIntent(path,input,process.cwd());
 input.candidate=candidate;
 await writePrivateManifest(path,input,{repositoryRoot:process.cwd(),now,candidate,replace:true});
 const ownerSourceAuthorization={schemaVersion:1 as const,policy:'issue29-owner-authorized-pending-source-readback' as const,runId:input.runId,operationId:input.runId,organizationId:input.provisioning.organizationId,projectRef:source.ref,region:input.provisioning.region,sourceName:input.provisioning.sourceName,observedCreatedAt:'2026-09-05T11:20:24.000Z',authorizedAt:'2026-09-05T11:59:00.000Z',expiresAt:'2026-09-05T13:00:00.000Z',evidenceSha256:'e'.repeat(64),originalIntentSha256};
 return{path,input,originalIntentSha256,ownerSourceAuthorization};
}
function ownerAuthorizedProof(ownerSourceAuthorization:Record<string,unknown>){return evidenced({project:source,createdAt:'2026-09-05T11:20:24.000Z',foreignState:false,ownerSourceAuthorization});}

describe('owner-authorized original source intent continuation',()=>{
 test('uses the immutable original intent after a candidate rebound and only performs readback',async()=>{
  const f=await ownerAuthorizedReboundPending();let reads=0,creates=0;
  const result=await executeProjectLifecycleStep({manifestPath:f.path,repositoryRoot:process.cwd(),candidate,step:'create-source',now,ownerSourceAuthorization:f.ownerSourceAuthorization,adapter:{preflight:async()=>{throw new Error('not reached');},create:async()=>{creates++;},readCreated:async()=>{reads++;return ownerAuthorizedProof(f.ownerSourceAuthorization) as any;}}});
  expect(result.state).toBe('source_read_back');expect(result.history.at(-1)?.intentSha256).toBe(f.originalIntentSha256);const evidence=JSON.parse(await readFile(join(f.path,'..',`${result.history.at(-1)?.evidenceSha256}.json`),'utf8'));expect(evidence.ownerSourceAuthorization.originalIntentSha256).toBe(f.originalIntentSha256);expect(reads).toBe(1);expect(creates).toBe(0);
 });
 test('keeps candidate drift blocked without the authorization before any provider readback',async()=>{
  const f=await ownerAuthorizedReboundPending();let reads=0;
  await expect(executeProjectLifecycleStep({manifestPath:f.path,repositoryRoot:process.cwd(),candidate,step:'create-source',now,adapter:{preflight:async()=>{throw new Error('not reached');},readCreated:async()=>{reads++;throw new Error('not reached');}}})).rejects.toThrow('INTENT_EVIDENCE_REQUIRED');
  expect(reads).toBe(0);
 });
 test.each(['mutated pending','foreign hash','missing original','tampered original','non-private original'])('rejects %s before provider readback',async kind=>{
  const f=await ownerAuthorizedReboundPending();let reads=0;
  if(kind==='mutated pending'){f.input.pending!.startedAt='2026-09-05T11:59:59.000Z';await writePrivateManifest(f.path,f.input,{repositoryRoot:process.cwd(),now,candidate,replace:true});}
  if(kind==='foreign hash')f.ownerSourceAuthorization.originalIntentSha256='f'.repeat(64);
  if(kind==='missing original')await rm(join(f.path,'..',`${f.originalIntentSha256}.json`));
  if(kind==='tampered original')await writeFile(join(f.path,'..',`${f.originalIntentSha256}.json`),'tampered');
  if(kind==='non-private original')await chmod(join(f.path,'..',`${f.originalIntentSha256}.json`),0o644);
  await expect(executeProjectLifecycleStep({manifestPath:f.path,repositoryRoot:process.cwd(),candidate,step:'create-source',now,ownerSourceAuthorization:f.ownerSourceAuthorization,adapter:{preflight:async()=>{throw new Error('not reached');},readCreated:async()=>{reads++;return ownerAuthorizedProof(f.ownerSourceAuthorization) as any;}}})).rejects.toThrow(kind==='foreign hash'||kind==='missing original'?'ORIGINAL_INTENT_EVIDENCE_REQUIRED':kind==='non-private original'?'PRIVATE_FILE_MODE_REQUIRED':'ORIGINAL_INTENT_EVIDENCE_MISMATCH');
  expect(reads).toBe(0);
 });
});
