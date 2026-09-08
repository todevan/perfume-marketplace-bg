import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { verifyWorkerRollback } from '../../scripts/verify-worker-rollback.mjs';

const accountId = 'a'.repeat(32);
const versionId = '11111111-1111-4111-8111-111111111111';
const sourceSha = 'b'.repeat(40);
const workerName = 'perfume-marketplace-bg-staging';
const version = { id: versionId, metadata: { created_on: '2026-09-01T00:00:00.000Z' },
  annotations: { 'workers/tag': sourceSha }, resources: { script: { etag: 'c'.repeat(32) } } };
const provenance = { schemaVersion: 1, accountId, workerName, versionId,
  createdOn: '2026-09-01T00:00:00.000Z', sourceSha, scriptEtag: 'c'.repeat(32) };
const provenanceSha256 = createHash('sha256').update(JSON.stringify(provenance)).digest('hex');
const input = { accountId, versionId, sourceSha, provenanceSha256, token: 'private-test-credential' };
const response = (result: unknown) => new Response(JSON.stringify({ success: true, result }));

describe('exact staging Worker rollback provenance', () => {
  it('reads the exact version and compares operator-supplied immutable provenance', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => response(version));
    await expect(verifyWorkerRollback(input, { fetchImpl })).resolves.toEqual(provenance);
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/versions/${versionId}`);
    expect(fetchImpl.mock.calls).toHaveLength(1);
  });
  it.each([
    { versionId: '../production' }, { accountId: 'wrong' }, { provenanceSha256: 'd'.repeat(64) },
    { sourceSha: 'e'.repeat(40) }
  ])('fails closed for mismatched coordinates or provenance %j', async (patch) => {
    await expect(verifyWorkerRollback({ ...input, ...patch }, { fetchImpl: async () => response(version) })).rejects.toThrow('rollback_verification_failed');
  });
  it('requires exact 100 percent deployment readback after rollback', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(version)).mockResolvedValueOnce(response({ deployments: [{ versions: [{ version_id: versionId, percentage: 50 }] }] }));
    await expect(verifyWorkerRollback({ ...input, deployed: true }, { fetchImpl })).rejects.toThrow('rollback_verification_failed');
  });
  it('never retries an uncertain provider response and does not leak its body', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('private provider secret'); });
    await expect(verifyWorkerRollback(input, { fetchImpl })).rejects.toThrow(/^rollback_verification_failed$/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('requires fresh provenance before deploy and readback after exact-version rollback', () => {
    const workflow = parse(readFileSync('.github/workflows/deploy.yml', 'utf8'));
    const job = workflow.jobs.staging;
    expect(job.env.SAFE_ROLLBACK_VERSION).toBeUndefined();
    expect(workflow.on.workflow_dispatch.inputs.rollback_version_id.required).toBe(true);
    expect(workflow.on.workflow_dispatch.inputs.rollback_provenance_sha256.required).toBe(true);
    const preflight = job.steps.findIndex((step: any) => step.run === 'node scripts/verify-worker-rollback.mjs');
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(job.steps.findIndex((step: any) => step.id === 'deploy'));
    expect(job.steps.some((step: any) => step.run === 'node scripts/verify-worker-rollback.mjs --deployed')).toBe(true);
  });
});
