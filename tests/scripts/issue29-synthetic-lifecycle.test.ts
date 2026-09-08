import{createHash}from'node:crypto';import{canonicalJson}from'../../scripts/issue29-operations/recovery-set.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifestFixture, maintenanceFixture } from '../fixtures/issue29-operations';
import { validateManifest, writePrivateManifest, readPrivateManifest } from '../../scripts/issue29-operations/manifest.mjs';
import { executeProjectLifecycleStep } from '../../scripts/issue29-operations/operator.mjs';

function evidenced<T extends Record<string,unknown>>(value:T){const{evidenceSha256:_hash,evidence:_old,...evidence}=value;return{...value,evidence,evidenceSha256:createHash('sha256').update(canonicalJson(evidence)).digest('hex')};}
const now = '2026-09-05T12:00:00.000Z';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('fresh synthetic source authorization', () => {
  it('allows a pre-creation manifest without inventing a source project ref', () => {
    const value = { ...manifestFixture(), schemaVersion: 2, source: null, target: null,
      preservedRefs: ['cdefghijklmnopqrstuv'], sourceProvenance: null, backupVerification: null,
      providerPreflight: null, provisioning: { organizationId: 'owned-org', region: 'eu-central-1', sourceName: 'issue29-source', targetName: 'issue29-target' } };
    expect(validateManifest(value, { now }).source).toBeNull();
  });
  it('rejects a preserved source even when its classification is asserted synthetic', () => {
    const value = manifestFixture();
    Object.assign(value, { preservedRefs: [value.source!.ref] });
    expect(() => validateManifest(value, { now })).toThrow('PRESERVED_PROJECT_FORBIDDEN');
  });
  it('rejects an existing-staging source designation', () => {
    const value = manifestFixture();
    value.source = { ...value.source!, environment: 'staging' };
    expect(() => validateManifest(value, { now })).toThrow('FRESH_SYNTHETIC_SOURCE_REQUIRED');
  });
});

function planned() {
  const value = manifestFixture();
  value.source = null; value.target = null; value.sourceProvenance = null;
  value.forbiddenRefs = [...value.preservedRefs];
  return value;
}
const preflight = evidenced({
  organizationId: 'owned-org', region: 'eu-central-1', checkedAt: now, expiresAt: '2026-09-05T12:10:00.000Z',
  plan: 'free' as const, projectLimit: 2, activeProjectCount: 1, availableProjects: 1,
  quotedCost: 0 as const, currency: 'USD' as const, deletionSupported: true as const, regionAvailable: true as const,
  inventoryRefs: ['cdefghijklmnopqrstuv'], evidenceSha256: 'a'.repeat(64)
});
async function saved(value = planned()) {
  const root = await mkdtemp(join(tmpdir(), 'issue29-lifecycle-')); await chmod(root, 0o700); roots.push(root);
  const path = join(root, 'manifest.json'); await writePrivateManifest(path, value, { repositoryRoot: process.cwd(), now }); return path;
}
describe('sequential project transaction', () => {
  it('persists an unknown-ref source creation before one mutation and reads its exact identity back', async () => {
    const path = await saved(); let creates = 0;
    const options = { manifestPath: path, repositoryRoot: process.cwd(), candidate: planned().candidate, now,
      adapter: { preflight: async () => preflight, create: async () => {
        const pending = await readPrivateManifest(path, { repositoryRoot: process.cwd(), now });
        const {readdir,readFile}=await import('node:fs/promises');const{dirname}=await import('node:path');const entries=await readdir(dirname(path));const intents=await Promise.all(entries.filter(p=>/^[a-f0-9]{64}\.json$/.test(p)).map(async p=>JSON.parse(await readFile(join(dirname(path),p),'utf8'))));expect(intents.some(p=>p.kind==='issue29-operator-intent'&&p.pending.operationId===pending.pending?.operationId)).toBe(true);expect(pending.source).toBeNull(); expect(pending.state).toBe('source_creation_pending'); expect(pending.pending?.step).toBe('create-source'); creates++;
      }, readCreated: async () => evidenced({ project: manifestFixture().source!, createdAt: now, evidenceSha256: 'b'.repeat(64), foreignState: false }) } };
    await executeProjectLifecycleStep({ ...options, step: 'preflight' });
    const result = await executeProjectLifecycleStep({ ...options, step: 'create-source' });
    expect(result.history.at(-1)?.intentSha256).toMatch(/^[a-f0-9]{64}$/);expect(result.state).toBe('source_read_back'); expect(result.source?.ref).toBe('abcdefghijklmnopqrst');
    expect(result.cleanup.resources[0].id).toBe(result.source?.ref); expect(result.cleanup.resources[0].disposition).toBe('persistent'); expect(result.pending).toBeNull(); expect(creates).toBe(1);
  });
  it('does not retry a source creation after an ambiguous provider result', async () => {
    const path = await saved(); let creates = 0;
    const options = { manifestPath: path, repositoryRoot: process.cwd(), candidate: planned().candidate, now,
      adapter: { preflight: async () => preflight, create: async () => { creates++; throw new Error('private body'); },
        readCreated: async () => evidenced({ project: manifestFixture().source!, createdAt: now, evidenceSha256: 'b'.repeat(64), foreignState: false }) } };
    await executeProjectLifecycleStep({ ...options, step: 'preflight' });
    await expect(executeProjectLifecycleStep({ ...options, step: 'create-source' })).rejects.toThrow('MUTATION_OUTCOME_UNCERTAIN');
    const result = await executeProjectLifecycleStep({ ...options, step: 'create-source' });
    expect(creates).toBe(1); expect(result.state).toBe('source_read_back');
  });
  it.each(['cost','region','preserved inventory'])('rejects unproved %s before source creation', async kind => {
    const path = await saved(); const evidence = structuredClone(preflight);
    if (kind === 'cost') Object.assign(evidence, { quotedCost: 1 });
    if (kind === 'capacity') evidence.availableProjects = 0;
    if (kind === 'region') Object.assign(evidence, { regionAvailable: false });
    if (kind === 'preserved inventory') evidence.inventoryRefs = [];
    let mutated = false;
    await expect(executeProjectLifecycleStep({ manifestPath: path, repositoryRoot: process.cwd(), candidate: planned().candidate, now, step: 'preflight',
      adapter: { preflight: async () => evidence, create: async () => { mutated = true; } } })).rejects.toThrow();
    expect(mutated).toBe(false); expect((await readPrivateManifest(path, { repositoryRoot: process.cwd(), now })).pending).toBeNull();
  });
  it('blocks retirement until independent backup verification closes all source reads', async () => {
    const value = manifestFixture(); value.state = 'backup_verified'; value.target = null;
    value.cleanup.resources = [{ provider: 'supabase', id: value.source!.ref, runId: value.runId, createdAt: now, evidenceSha256: 'b'.repeat(64), disposition: 'disposable', absentAt: null }];
    const path = await saved(value); let deleted = false;
    await expect(executeProjectLifecycleStep({ manifestPath: path, repositoryRoot: process.cwd(), candidate: value.candidate, now, step: 'retire-source',
      adapter: { preflight: async () => preflight, remove: async () => { deleted = true; } } })).rejects.toThrow('PERSISTENT_SOURCE_DELETION_FORBIDDEN');
    expect(deleted).toBe(false);
  });
  it('requires a verified paused source and actual free capacity before creating the restore target',async()=>{
    const value=manifestFixture();value.state='source_paused';value.target=null;value.backupVerification={descriptorSha256:'a'.repeat(64),independentlyVerifiedAt:now,sourceReadsComplete:true};value.maintenance=maintenanceFixture(value);value.cleanup.resources=[{provider:'supabase',id:value.source!.ref,runId:value.runId,createdAt:now,evidenceSha256:'a'.repeat(64),disposition:'persistent',absentAt:null}];const path=await saved(value);let creates=0;const adapter={readPaused:async()=>({project:value.source!,status:'INACTIVE' as const,identitySha256:value.maintenance!.preservation.identitySha256,preservationSha256:createHash('sha256').update(canonicalJson(value.maintenance!.preservation)).digest('hex'),configurationObserved:false,evidenceSha256:'a'.repeat(64)}),preflight:async()=>evidenced({...preflight,inventoryRefs:[...preflight.inventoryRefs,value.source!.ref]}),create:async()=>{creates++;},readCreated:async()=>evidenced({project:manifestFixture().target!,createdAt:now,foreignState:false,evidenceSha256:'b'.repeat(64)})};const result=await executeProjectLifecycleStep({manifestPath:path,repositoryRoot:process.cwd(),candidate:value.candidate,now,step:'create-target',adapter});expect(creates).toBe(1);expect(result.source!.ref).not.toBe(result.target!.ref);expect(result.cleanup.resources[0].disposition).toBe('persistent');expect(result.cleanup.resources[0].absentAt).toBeNull();
  });
  it.each(['foreign organization','source collision','foreign state'])('rejects target %s after creation without advancing ownership', async kind => {
    const value = manifestFixture(); value.state = 'source_paused'; value.target = null;
    value.backupVerification = { descriptorSha256: 'a'.repeat(64), independentlyVerifiedAt: now, sourceReadsComplete: true };
    value.maintenance=maintenanceFixture(value);
    const path = await saved(value); const project = { ...manifestFixture().target! };
    if (kind === 'foreign organization') project.organizationId = 'foreign';
    if (kind === 'source collision') project.ref = value.source!.ref;
    await expect(executeProjectLifecycleStep({ manifestPath: path, repositoryRoot: process.cwd(), candidate: value.candidate, now, step: 'create-target',
      adapter: { readPaused:async()=>({project:value.source!,status:'INACTIVE' as const,identitySha256:value.maintenance!.preservation.identitySha256,preservationSha256:createHash('sha256').update(canonicalJson(value.maintenance!.preservation)).digest('hex'),configurationObserved:false,evidenceSha256:'a'.repeat(64)}),preflight: async () => preflight, create: async () => {}, readCreated: async () => ({ project, createdAt: now, foreignState: kind === 'foreign state', evidenceSha256: 'b'.repeat(64) }) } })).rejects.toThrow();
    const remaining = await readPrivateManifest(path, { repositoryRoot: process.cwd(), now });
    expect(remaining.target).toBeNull(); expect(remaining.pending?.step).toBe('create-target');
  });
});

it('persists the exact pending intent preimage and refuses to invent it on an ambiguous resume',async()=>{
 const {persistOperationsIntent}=await import('../../scripts/issue29-operations/operator.mjs');const value=planned();value.state='source_creation_pending';value.pending={step:'create-source',operationId:value.runId,startedAt:now,resourceId:null,priorStateSha256:null};const path=await saved(value);
 await expect(persistOperationsIntent(path,value,process.cwd(),{mustExist:true})).rejects.toThrow('INTENT_EVIDENCE_REQUIRED');
 const sha=await persistOperationsIntent(path,value,process.cwd());const {readFile,stat}=await import('node:fs/promises');const {dirname}=await import('node:path');const bytes=await readFile(join(dirname(path),`${sha}.json`));expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha);expect(JSON.parse(bytes.toString()).pending).toEqual(value.pending);expect((await stat(join(dirname(path),`${sha}.json`))).mode&0o777).toBe(0o600);expect(await persistOperationsIntent(path,value,process.cwd(),{mustExist:true})).toBe(sha);
 value.pending.startedAt='2026-09-05T12:00:01.000Z';await expect(persistOperationsIntent(path,value,process.cwd())).rejects.toThrow('PERSISTED_INTENT_MISMATCH');
});

it.each(['missing','tampered'])('never completes a created project with %s readback evidence',async kind=>{
 const path=await saved(),candidate=planned().candidate;let creates=0;const adapter={preflight:async()=>preflight,create:async()=>{creates++;},readCreated:async()=>{const proof=evidenced({project:manifestFixture().source!,createdAt:now,foreignState:false});return kind==='missing'?{...proof,evidence:undefined}:{...proof,evidence:{...proof.evidence,createdAt:'2026-09-04T12:00:00.000Z'}};}};const options={manifestPath:path,repositoryRoot:process.cwd(),candidate,now,adapter};await executeProjectLifecycleStep({...options,step:'preflight'});await expect(executeProjectLifecycleStep({...options,step:'create-source'})).rejects.toThrow(kind==='missing'?'READBACK_EVIDENCE_REQUIRED':'READBACK_EVIDENCE_HASH_MISMATCH');const pending=await readPrivateManifest(path,{repositoryRoot:process.cwd(),candidate,now});expect(creates).toBe(1);expect(pending.pending?.step).toBe('create-source');expect(pending.source).toBeNull();expect(pending.cleanup.resources).toHaveLength(0);
});
