import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifestFixture } from '../fixtures/issue29-operations';
import { validateManifest, writePrivateManifest, readPrivateManifest } from '../../scripts/issue29-operations/manifest.mjs';
import { executeProjectLifecycleStep } from '../../scripts/issue29-operations/operator.mjs';

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
const preflight = {
  organizationId: 'owned-org', region: 'eu-central-1', checkedAt: now, expiresAt: '2026-09-05T12:10:00.000Z',
  plan: 'free' as const, projectLimit: 2, activeProjectCount: 1, availableProjects: 1,
  quotedCost: 0 as const, currency: 'USD' as const, deletionSupported: true as const, regionAvailable: true as const,
  inventoryRefs: ['cdefghijklmnopqrstuv'], evidenceSha256: 'a'.repeat(64)
};
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
        expect(pending.source).toBeNull(); expect(pending.state).toBe('source_creation_pending'); expect(pending.pending?.step).toBe('create-source'); creates++;
      }, readCreated: async () => ({ project: manifestFixture().source!, createdAt: now, evidenceSha256: 'b'.repeat(64), foreignState: false }) } };
    await executeProjectLifecycleStep({ ...options, step: 'preflight' });
    const result = await executeProjectLifecycleStep({ ...options, step: 'create-source' });
    expect(result.state).toBe('source_read_back'); expect(result.source?.ref).toBe('abcdefghijklmnopqrst');
    expect(result.cleanup.resources[0].id).toBe(result.source?.ref); expect(result.pending).toBeNull(); expect(creates).toBe(1);
  });
  it('does not retry a source creation after an ambiguous provider result', async () => {
    const path = await saved(); let creates = 0;
    const options = { manifestPath: path, repositoryRoot: process.cwd(), candidate: planned().candidate, now,
      adapter: { preflight: async () => preflight, create: async () => { creates++; throw new Error('private body'); },
        readCreated: async () => ({ project: manifestFixture().source!, createdAt: now, evidenceSha256: 'b'.repeat(64), foreignState: false }) } };
    await executeProjectLifecycleStep({ ...options, step: 'preflight' });
    await expect(executeProjectLifecycleStep({ ...options, step: 'create-source' })).rejects.toThrow('MUTATION_OUTCOME_UNCERTAIN');
    const result = await executeProjectLifecycleStep({ ...options, step: 'create-source' });
    expect(creates).toBe(1); expect(result.state).toBe('source_read_back');
  });
  it.each(['cost','capacity','region','preserved inventory'])('rejects unproved %s before source creation', async kind => {
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
      adapter: { preflight: async () => preflight, remove: async () => { deleted = true; } } })).rejects.toThrow('BACKUP_VERIFICATION_REQUIRED');
    expect(deleted).toBe(false);
  });
  it('proves source absence before creating a distinct target with fresh capacity readback', async () => {
    const value = manifestFixture(); value.state = 'backup_verified'; value.target = null;
    value.backupVerification = { descriptorSha256: 'a'.repeat(64), independentlyVerifiedAt: now, sourceReadsComplete: true };
    value.cleanup.resources = [{ provider: 'supabase', id: value.source!.ref, runId: value.runId, createdAt: now, evidenceSha256: 'b'.repeat(64), disposition: 'disposable', absentAt: null }];
    value.cleanup.resources.push({provider:'supabase-storage',id:`storage-object:${value.source!.ref}:${value.runId}:sentinel`,runId:value.runId,createdAt:now,evidenceSha256:'d'.repeat(64),disposition:'disposable',absentAt:null});
    const path = await saved(value); let deleted = 0; let created = 0; let capacityReads = 0;
    const adapter = { preflight: async () => { capacityReads++; return preflight; }, remove: async () => {
      expect((await readPrivateManifest(path, { repositoryRoot: process.cwd(), now })).pending?.resourceId).toBe(value.source!.ref); deleted++;
    }, readAbsent: async () => ({ absent: true, evidenceSha256: 'c'.repeat(64) }), create: async () => { created++; },
      readCreated: async () => ({ project: manifestFixture().target!, createdAt: now, foreignState: false, evidenceSha256: 'b'.repeat(64) }) };
    const options = { manifestPath: path, repositoryRoot: process.cwd(), candidate: value.candidate, now, adapter };
    const retired = await executeProjectLifecycleStep({ ...options, step: 'retire-source' });
    expect(retired.state).toBe('source_absence_verified'); expect(retired.cleanup.resources.every(r=>r.absentAt===now)).toBe(true);
    const target = await executeProjectLifecycleStep({ ...options, step: 'create-target' });
    expect(target.state).toBe('target_read_back'); expect(target.target!.ref).not.toBe(target.source!.ref);
    expect([deleted, created, capacityReads]).toEqual([1, 1, 1]);
  });
  it.each(['foreign organization','source collision','foreign state'])('rejects target %s after creation without advancing ownership', async kind => {
    const value = manifestFixture(); value.state = 'backup_verified'; value.target = null;
    value.backupVerification = { descriptorSha256: 'a'.repeat(64), independentlyVerifiedAt: now, sourceReadsComplete: true };
    const path = await saved(value); const project = { ...manifestFixture().target! };
    if (kind === 'foreign organization') project.organizationId = 'foreign';
    if (kind === 'source collision') project.ref = value.source!.ref;
    await expect(executeProjectLifecycleStep({ manifestPath: path, repositoryRoot: process.cwd(), candidate: value.candidate, now, step: 'create-target',
      adapter: { preflight: async () => preflight, create: async () => {}, readCreated: async () => ({ project, createdAt: now, foreignState: kind === 'foreign state', evidenceSha256: 'b'.repeat(64) }) } })).rejects.toThrow();
    const remaining = await readPrivateManifest(path, { repositoryRoot: process.cwd(), now });
    expect(remaining.target).toBeNull(); expect(remaining.pending?.step).toBe('create-target');
  });
});
