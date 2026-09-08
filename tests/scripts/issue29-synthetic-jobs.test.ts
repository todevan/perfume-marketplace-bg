import { expect, test } from 'vitest';
import { controlSyntheticJobs } from '../../scripts/issue29-operations/synthetic-jobs.mjs';
import { manifestFixture } from '../fixtures/issue29-operations';
test('rejects preserved or unowned project before any database query', async () => {
    const manifest = structuredClone(manifestFixture());
    manifest.allowedActions.push('synthetic-jobs');
    manifest.source!.ref = manifest.preservedRefs[0];
    let calls = 0;
    await expect(controlSyntheticJobs({ manifest, role: 'source', mode: 'quiesce', plan: { priorState: [], startedAt: '2026-09-05T12:00:00.000Z', expiresAt: '2026-09-05T12:01:00.000Z' }, repositoryRoot: process.cwd(), connection: {} as never, toolchain: { mode: 'container' }, persistIntent: async () => { calls++; }, readbackVerified: async () => { } }, { readState: async () => { calls++; return []; } } as never)).rejects.toThrow('PRESERVED_PROJECT_FORBIDDEN');
    expect(calls).toBe(0);
});
import { CANONICAL_SYNTHETIC_JOBS } from '../../scripts/issue29-operations/synthetic-jobs.mjs';
function owned() { const manifest = structuredClone(manifestFixture()); manifest.allowedActions.push('synthetic-jobs'); manifest.cleanup.resources.push({ provider: 'supabase', id: manifest.source!.ref, runId: manifest.runId, createdAt: '2026-09-05T12:00:00.000Z', evidenceSha256: 'a'.repeat(64), disposition: 'persistent', absentAt: null }); return manifest; }
test('quiesces only canonical jobs, persists prior configuration before mutation and reads back no running jobs', async () => {
    const prior = CANONICAL_SYNTHETIC_JOBS.map(j => ({ ...j, nodeport: 5432, nodename: 'localhost', database: 'postgres', username: 'postgres', active: true }));
    let current = structuredClone(prior);
    const events: string[] = [];
    const result = await controlSyntheticJobs({ manifest: owned(), role: 'source', mode: 'quiesce', plan: { priorState: prior, startedAt: '2026-09-05T12:00:00.000Z', expiresAt: '2026-09-05T12:01:00.000Z' }, repositoryRoot: process.cwd(), connection: {} as never, toolchain: { mode: 'container' }, persistIntent: async (i: any) => { expect(i.before).toEqual(prior); events.push('intent'); }, readbackVerified: async () => { events.push('readback'); } }, { verifySafety: async () => { }, readState: async () => current, applyState: async (next: any) => { events.push('mutation'); current = next; }, readRunning: async () => 0, readProof: async () => [] } as never);
    expect(events).toEqual(['intent', 'mutation', 'readback']);
    expect(result!.mode).toBe('quiesced');
    expect(current.every(j => !j.active)).toBe(true);
    expect(result!.priorState).toEqual(prior);
});
test('real job proof must be independently read and always restores bounded temporary configuration before rejecting missing history', async () => {
    let current: any[] = [];
    const events: string[] = [];
    const plan = { priorState: [], startedAt: '2026-09-05T12:00:00.000Z', expiresAt: '2026-09-05T12:01:00.000Z' };
    await expect(controlSyntheticJobs({ manifest: owned(), role: 'source', mode: 'prove', plan, repositoryRoot: process.cwd(), connection: {} as never, toolchain: { mode: 'container' }, clock: () => plan.startedAt, wait: async () => { }, persistIntent: async (i: any) => { events.push(i.phase); }, readbackVerified: async () => { } }, { verifySafety: async () => { }, readState: async () => current, applyState: async (next: any) => { current = next; }, readRunning: async () => 0, readProof: async () => [] } as never)).rejects.toThrow('JOBS_SUCCESS_HISTORY_REQUIRED');
    expect(events).toEqual(['proof-start', 'proof-restore']);
    expect(current.map(j => j.schedule)).toEqual(CANONICAL_SYNTHETIC_JOBS.map(j => j.schedule));
    expect(current.every(j => !j.command.includes('where'))).toBe(true);
});
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeSyntheticJobsCommand, readSyntheticJobsEvidence } from '../../scripts/issue29-operations/synthetic-jobs.mjs';
import { writePrivateManifest, readPrivateManifest } from '../../scripts/issue29-operations/manifest.mjs';
test('same-manifest command persists uncertainty, resumes readback without a second mutation and hashes the actual prior state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'issue29-jobs-test-'));
    try {
        const manifest = owned(), manifestPath = join(directory, 'manifest.json'), settingsPath = join(directory, 'settings.json'), now = '2026-09-05T12:00:00.000Z';
        manifest.state = 'monitoring_proved';
        await writePrivateManifest(manifestPath, manifest, { repositoryRoot: process.cwd(), candidate: manifest.candidate, now });
        await writeFile(settingsPath, JSON.stringify({ schemaVersion: 1, operation: 'synthetic-jobs', mode: 'quiesce', role: 'source', connection: { host: `db.${manifest.source!.ref}.supabase.co`, port: 5432, database: 'postgres', user: 'postgres', password: 'private', sslmode: 'verify-full' }, toolchain: { mode: 'container' } }), { mode: 0o600 });
        let state = CANONICAL_SYNTHETIC_JOBS.map(j => ({ ...j, nodename: 'localhost', nodeport: 5432, database: 'postgres', username: 'postgres', active: true }));
        let mutations = 0;
        const adapter = { verifySafety: async () => { }, readState: async () => state, applyState: async (after: any) => { const pending = (await readPrivateManifest(manifestPath, { repositoryRoot: process.cwd(), now })).pending; expect(pending?.step).toBe('synthetic-jobs'); mutations++; state = after; throw Error('private-provider-body'); }, readRunning: async () => 0, readProof: async () => [], close: async () => { } };
        const options = { manifestPath, settingsPath, repositoryRoot: process.cwd(), candidate: manifest.candidate, operation: 'synthetic-jobs' as const, clock: () => now };
        await expect(executeSyntheticJobsCommand(options, { createAdapter: () => adapter })).rejects.toThrow('JOBS_MUTATION_UNCERTAIN_READBACK_ONLY');
        expect(mutations).toBe(1);
        const result = await executeSyntheticJobsCommand(options, { createAdapter: () => adapter });
        expect(mutations).toBe(1);
        expect(result.mode).toBe('quiesced');
        const updated = await readPrivateManifest(manifestPath, { repositoryRoot: process.cwd(), now });
        expect(updated.pending).toBeNull();
        expect((await readSyntheticJobsEvidence({ manifest: updated, manifestPath, repositoryRoot: process.cwd(), role: 'source' })).evidenceSha256).toBe(result.evidenceSha256);
        expect(JSON.stringify(result)).not.toContain('private-provider-body');
        expect(JSON.parse(await readFile(result.privateReceiptPath, 'utf8')).priorState.every((j: any) => j.active)).toBe(true);
    }
    finally {
        await rm(directory, { recursive: true, force: true });
    }
});
test('accepts actual pinned pg_cron one-row completion evidence, not a guessed command tag', async () => {
    let current: any[] = [];
    const plan = { priorState: [], startedAt: '2026-09-05T12:00:00.000Z', expiresAt: '2026-09-05T12:01:00.000Z' };
    const result = await controlSyntheticJobs({ manifest: owned(), role: 'source', mode: 'prove', plan, repositoryRoot: process.cwd(), connection: {} as never, toolchain: { mode: 'container' }, clock: () => plan.startedAt, wait: async () => { }, persistIntent: async () => { }, readbackVerified: async () => { } }, { verifySafety: async () => { }, readState: async () => current, applyState: async (next: any) => { current = next; }, readRunning: async () => 0, readProof: async () => CANONICAL_SYNTHETIC_JOBS.map(j => ({ jobname: j.jobname, startTime: '2026-09-05T12:00:05.000Z', endTime: '2026-09-05T12:00:05.005Z', status: 'succeeded', returnMessage: '1 row' })) } as never);
    expect(result.mode).toBe('proved');
    expect(result.proof).toHaveLength(2);
});
test('rejects a foreign job and expired fresh proof before mutation', async () => {
    for (const kind of ['foreign', 'expired']) {
        let writes = 0;
        const plan = { priorState: kind === 'foreign' ? [{ jobname: 'foreign', schedule: '* * * * *', command: 'select private.run_beta_maintenance(500)', nodename: 'localhost', nodeport: 5432, database: 'postgres', username: 'postgres', active: true }] : [], startedAt: '2026-09-05T12:00:00.000Z', expiresAt: '2026-09-05T12:01:00.000Z' };
        await expect(controlSyntheticJobs({ manifest: owned(), role: 'source', mode: 'prove', plan, repositoryRoot: process.cwd(), connection: {} as never, toolchain: { mode: 'container' }, clock: () => '2026-09-05T12:02:00.000Z', wait: async () => { }, persistIntent: async () => { writes++; }, readbackVerified: async () => { } }, { verifySafety: async () => { }, readState: async () => [], applyState: async () => { writes++; }, readRunning: async () => 0, readProof: async () => [] } as never)).rejects.toThrow(kind === 'foreign' ? 'FOREIGN_JOBS_FORBIDDEN' : 'JOBS_PROOF_WINDOW_EXPIRED');
        expect(writes).toBe(0);
    }
});
test('an ambiguous configuration restore resumes by readback and never starts another proof schedule', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'issue29-jobs-resume-'));
    try {
        const manifest = owned(), manifestPath = join(directory, 'manifest.json'), settingsPath = join(directory, 'settings.json'), now = '2026-09-05T12:00:00.000Z';
        manifest.state = 'monitoring_proved';
        await writePrivateManifest(manifestPath, manifest, { repositoryRoot: process.cwd(), candidate: manifest.candidate, now });
        await writeFile(settingsPath, JSON.stringify({ schemaVersion: 1, operation: 'synthetic-jobs', mode: 'prove', role: 'source', connection: { host: `db.${manifest.source!.ref}.supabase.co`, port: 5432, database: 'postgres', user: 'postgres', password: 'private', sslmode: 'verify-full' }, toolchain: { mode: 'container' } }), { mode: 0o600 });
        let state: any[] = [];
        let writes = 0;
        const adapter = { verifySafety: async () => { }, readState: async () => state, applyState: async (after: any) => { state = after; if (++writes === 2)
                throw Error('timeout'); }, readRunning: async () => 0, readProof: async () => CANONICAL_SYNTHETIC_JOBS.map(j => ({ jobname: j.jobname, startTime: '2026-09-05T12:00:05.000Z', endTime: '2026-09-05T12:00:05.005Z', status: 'succeeded', returnMessage: '1 row' })), close: async () => { } };
        const options = { manifestPath, settingsPath, repositoryRoot: process.cwd(), candidate: manifest.candidate, operation: 'synthetic-jobs' as const, clock: () => now };
        await expect(executeSyntheticJobsCommand(options, { createAdapter: () => adapter })).rejects.toThrow('JOBS_MUTATION_UNCERTAIN_READBACK_ONLY');
        expect((await readPrivateManifest(manifestPath, { repositoryRoot: process.cwd(), now })).pending?.resourceId).toBe('source-jobs-proof-restore');
        const result = await executeSyntheticJobsCommand(options, { createAdapter: () => adapter });
        expect(writes).toBe(2);
        expect(result.mode).toBe('proved');
    }
    finally {
        await rm(directory, { recursive: true, force: true });
    }
});
