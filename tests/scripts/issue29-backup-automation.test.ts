import { describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecoverySet, LOGICAL_COMPONENTS } from '../../scripts/issue29-operations/recovery-set.mjs';
import { readPrivateManifest, writePrivateManifest } from '../../scripts/issue29-operations/manifest.mjs';
import { manifestFixture } from '../fixtures/issue29-operations';
import { prepareBackupAutomation, preparePublication, finalizeArtifact, beginHeartbeat, finalizeHeartbeat, cleanupBackupAutomation, validateAutomationContext } from '../../scripts/issue29-operations/backup-automation.mjs';
describe('Issue 29 trusted backup automation', () => {
    it('accepts only an exact protected default-branch execution, never a pull request', () => {
        const context = { repository: 'todevan/perfume-marketplace-bg', repositoryId: 12, eventName: 'workflow_dispatch', ref: 'refs/heads/main', refProtected: true, workflowRef: 'todevan/perfume-marketplace-bg/.github/workflows/operations-backup.yml@refs/heads/main', sha: 'a'.repeat(40), workflowSha: 'a'.repeat(40), runId: 34, runAttempt: 1 };
        expect(validateAutomationContext(context)).toEqual(context);
        expect(() => validateAutomationContext({ ...context, eventName: 'pull_request' })).toThrow('UNTRUSTED_AUTOMATION_CONTEXT');
    });
});
const now = '2026-09-05T12:00:00.000Z';
const context = { repository: 'todevan/perfume-marketplace-bg', repositoryId: 12, eventName: 'workflow_dispatch', ref: 'refs/heads/main', refProtected: true, workflowRef: 'todevan/perfume-marketplace-bg/.github/workflows/operations-backup.yml@refs/heads/main', sha: 'a'.repeat(40), workflowSha: 'a'.repeat(40), runId: 34, runAttempt: 1 };
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
function authorization() {
    const manifest = manifestFixture();
    manifest.target = null;
    manifest.state = 'monitoring_proved';
    manifest.allowedActions.push('artifact-upload', 'backup-heartbeat');
    manifest.backup.publicKeyId = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
    manifest.cleanup.resources.push({ provider: 'supabase', id: manifest.source!.ref, runId: manifest.runId, createdAt: now, evidenceSha256: 'd'.repeat(64), disposition: 'disposable', absentAt: null });
    return { manifest, costAuthorization: { schemaVersion: 1, kind: 'github-personal-budget-ui-readback', account: 'todevan', product: 'actions', budgetUsd: 0, stopUsage: true, capturedAt: now, expiresAt: '2026-09-06T12:00:00.000Z', capturedEvidenceSha256: '1'.repeat(64), attestedBy: 'owner' }, maxArtifactBytes: 1000000, settings: { deployment: { accountId: 'a'.repeat(32), workerName: 'issue29-fixture', versionId: '29292929-2929-4292-8292-292929292929', origin: 'https://issue29-fixture.example.workers.dev', readToken: 'r'.repeat(40) }, schemaVersion: 1, operation: 'backup-set', providerToken: 'sbp_fixture_provider_read_only', connection: { host: `db.${manifest.source!.ref}.supabase.co`, port: 5432, database: 'postgres', user: 'postgres', password: 'fixture-password', sslmode: 'verify-full' }, toolchain: { mode: 'container' }, source: { apiUrl: manifest.source!.url, serviceKey: 'fixture-service-key' }, managedBaseline: { path: '/private/source-baseline.json', sha256: 'e'.repeat(64) }, ownerPublicKeyPath: '/private/owner-public.pem', outputDirectory: '/private/output', privateDirectory: '/private/temp' } };
}
it('materializes only an existing authorized synthetic source without renewing its manifest', async () => {
    const runnerTemp = await mkdtemp(join(tmpdir(), 'issue29-runner-test-'));
    const auth = authorization();
    try {
        const result = await prepareBackupAutomation({ authorizationJson: JSON.stringify(auth), publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), context, runnerTemp, repositoryRoot: process.cwd(), now });
        expect(JSON.parse(await readFile(result.manifestPath, 'utf8'))).toEqual(auth.manifest);
        expect((await stat(result.manifestPath)).mode & 0o777).toBe(0o600);
        const settings = JSON.parse(await readFile(result.settingsPath, 'utf8'));
        expect(settings.managedBaseline.sha256).toBe('e'.repeat(64));
        expect(settings.outputDirectory).toBe(join(result.directory, 'published'));
        expect(await readFile(result.ownerPublicKeyPath, 'utf8')).not.toContain('PRIVATE KEY');
    }
    finally {
        await rm(runnerTemp, { recursive: true, force: true });
    }
});
it.each(['fork', 'ref', 'workflow-ref', 'workflow-sha', 'unprotected', 'rerun'])('rejects untrusted %s before authorization processing', async (kind) => {
    const c = { ...context };
    if (kind === 'fork')
        c.repository = 'other/fork';
    if (kind === 'ref')
        c.ref = 'refs/heads/topic';
    if (kind === 'workflow-ref')
        c.workflowRef = c.workflowRef.replace('main', 'topic');
    if (kind === 'workflow-sha')
        c.workflowSha = 'c'.repeat(40);
    if (kind === 'unprotected')
        c.refProtected = false;
    if (kind === 'rerun')
        c.runAttempt = 2;
    expect(() => validateAutomationContext(c)).toThrow('UNTRUSTED_AUTOMATION_CONTEXT');
});
it.each(['preserved', 'unowned', 'retired', 'expired', 'pending', 'foreign-setting', 'private-key', 'wrong-key', 'source-null'])('rejects %s before creating runner files', async (kind) => {
    const runnerTemp = await mkdtemp(join(tmpdir(), 'issue29-runner-test-'));
    const a = authorization();
    let pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    if (kind === 'preserved')
        a.manifest.preservedRefs.push(a.manifest.source!.ref);
    if (kind === 'unowned')
        a.manifest.cleanup.resources = [];
    if (kind === 'retired')
        a.manifest.backupVerification = { descriptorSha256: 'd'.repeat(64), independentlyVerifiedAt: now, sourceReadsComplete: true };
    if (kind === 'expired')
        a.manifest.expiresAt = now;
    if (kind === 'pending')
        a.manifest.pending = { step: 'backup-set', operationId: a.manifest.runId, startedAt: now, resourceId: null, priorStateSha256: null };
    if (kind === 'foreign-setting')
        a.settings.source.apiUrl = 'https://cdefghijklmnopqrstuv.supabase.co';
    if (kind === 'private-key')
        pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    if (kind === 'wrong-key')
        a.manifest.backup.publicKeyId = 'c'.repeat(64);
    if (kind === 'source-null') {
        a.manifest.source = null;
        a.manifest.sourceProvenance = null;
        a.manifest.state = 'planned';
    }
    try {
        await expect(prepareBackupAutomation({ authorizationJson: JSON.stringify(a), publicKeyPem: pem, context, runnerTemp, repositoryRoot: process.cwd(), now })).rejects.toThrow('Issue #29:');
        expect(await (await import('node:fs/promises')).readdir(runnerTemp)).toEqual([]);
    }
    finally {
        await rm(runnerTemp, { recursive: true, force: true });
    }
});
async function publicationFixture() {
    const runnerTemp = await mkdtemp(join(tmpdir(), 'issue29-runner-test-'));
    const a = authorization();
    const paths = await prepareBackupAutomation({ authorizationJson: JSON.stringify(a), publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), context, runnerTemp, repositoryRoot: process.cwd(), now });
    const manifest = await readPrivateManifest(paths.manifestPath, { repositoryRoot: process.cwd(), now });
    manifest.state = 'backup_started';
    const checkpoint = { snapshotId: 'fixture-snapshot', finalizedRowsetSha256: 'd'.repeat(64) };
    const created = await createRecoverySet({ destination: paths.outputDirectory, repositoryRoot: process.cwd(), publicKey, components: new Map(Object.keys(LOGICAL_COMPONENTS).map(name => [name, Buffer.from(`synthetic ${name}`)])), storageManifest: { bucket: 'listing-images', files: [] }, checkpointBefore: checkpoint, checkpointAfter: checkpoint, metadata: { backupSetId: manifest.runId, source: { environmentAlias: manifest.fixture.alias, organizationId: manifest.source!.organizationId, projectRef: manifest.source!.ref, region: manifest.source!.region, classification: 'synthetic-owner-controlled' }, release: { commitSha: manifest.candidate.sha, treeSha: manifest.candidate.tree, workerVersion: manifest.candidate.deploymentId }, startedAt: now, finishedAt: now, tools: { supabaseCli: '2.109.1', postgres: '17.6', operator: 'issue29-v1' }, migration: { count: 1, sha256: 'd'.repeat(64) }, destinationAlias: manifest.backup.destinationAlias, exclusions: ['source-sessions'], manualReconstruction: ['auth-settings'] } });
    manifest.history.push({ step: 'backup-set', operationId: manifest.runId, completedAt: now, evidenceSha256: created.descriptorSha256, resourceId: null });
    await writePrivateManifest(paths.manifestPath, manifest, { repositoryRoot: process.cwd(), now, replace: true });
    const options = { ...paths, context, repositoryRoot: process.cwd(), expectedDescriptorSha256: created.descriptorSha256, now };
    return { runnerTemp, paths, created, options };
}
it('persists exact immutable upload intent before the official action and never blindly repeats it', async () => {
    const f = await publicationFixture();
    try {
        const result = await preparePublication(f.options);
        const m = await readPrivateManifest(f.paths.manifestPath, { repositoryRoot: process.cwd(), now });
        expect(result.artifactName).toBe('issue29-recovery-34-1');
        expect(result.fileNames).toHaveLength(9);
        expect(m.state).toBe('artifact_upload_pending');
        expect(m.pending).toMatchObject({ step: 'artifact-upload', resourceId: 'issue29-recovery-34-1' });
        expect(m.backupVerification).toBeNull();
        await expect(preparePublication(f.options)).rejects.toThrow('PENDING_OPERATION_REQUIRES_READBACK');
    }
    finally {
        await rm(f.runnerTemp, { recursive: true, force: true });
    }
});
it('advances only after exact API/archive and extracted-component readback, retaining a persistent artifact', async () => {
    const f = await publicationFixture();
    try {
        await preparePublication(f.options);
        await cp(f.paths.outputDirectory, f.paths.downloadDirectory, { recursive: true });
        const archive = Buffer.from('opaque encrypted ZIP fixture');
        const archiveHash = createHash('sha256').update(archive).digest('hex');
        const fetchImpl = async (url: string | URL | Request) => String(url).endsWith('/56') ? Response.json({ id: 56, name: 'issue29-recovery-34-1', size_in_bytes: archive.length, expired: false, created_at: now, expires_at: '2026-10-10T12:00:00.000Z', digest: `sha256:${archiveHash}`, workflow_run: { id: 34, repository_id: 12, head_repository_id: 12, head_branch: 'main', head_sha: context.sha } }) : String(url).endsWith('/zip') ? new Response(null, { status: 302, headers: { location: 'https://fixture.blob.core.windows.net/exact.zip' } }) : new Response(archive);
        const result = await finalizeArtifact({ ...f.options, artifactId: 56, archiveSha256: archiveHash, token: 'github-token-fixture', fetchImpl });
        expect(result).toMatchObject({ descriptorSha256: f.created.descriptorSha256, artifact: { artifactId: 56, retentionDays: 35 } });
        const m = await readPrivateManifest(f.paths.manifestPath, { repositoryRoot: process.cwd(), now });
        expect(m.state).toBe('artifact_verified');
        expect(m.pending).toBeNull();
        expect(m.backupVerification).toBeNull();
        expect(m.cleanup.resources.find(r => r.provider === 'github')).toMatchObject({ id: '56', disposition: 'persistent', absentAt: null });
    }
    finally {
        await rm(f.runnerTemp, { recursive: true, force: true });
    }
});
it('rejects missing or expired owner UI cost evidence rather than inferring free artifact storage from a public repo', async () => {
    const runnerTemp = await mkdtemp(join(tmpdir(), 'issue29-runner-test-'));
    const a = authorization();
    try {
        a.costAuthorization.expiresAt = now;
        await expect(prepareBackupAutomation({ authorizationJson: JSON.stringify(a), publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), context, runnerTemp, repositoryRoot: process.cwd(), now })).rejects.toThrow('GITHUB_ZERO_COST_READBACK_REQUIRED');
    }
    finally {
        await rm(runnerTemp, { recursive: true, force: true });
    }
});
it('keeps ambiguous independent heartbeat pending and retries only readback, never submission', async () => {
    const f = await publicationFixture();
    try {
        await preparePublication(f.options);
        await cp(f.paths.outputDirectory, f.paths.downloadDirectory, { recursive: true });
        const archive = Buffer.from('opaque encrypted ZIP fixture');
        const archiveSha256 = createHash('sha256').update(archive).digest('hex');
        const fetchArtifact = async (url: string | URL | Request) => String(url).endsWith('/56') ? Response.json({ id: 56, name: 'issue29-recovery-34-1', size_in_bytes: archive.length, expired: false, created_at: now, expires_at: '2026-10-10T12:00:00.000Z', digest: `sha256:${archiveSha256}`, workflow_run: { id: 34, repository_id: 12, head_repository_id: 12, head_branch: 'main', head_sha: context.sha } }) : String(url).endsWith('/zip') ? new Response(null, { status: 302, headers: { location: 'https://fixture.blob.core.windows.net/exact.zip' } }) : new Response(archive);
        await finalizeArtifact({ ...f.options, artifactId: 56, archiveSha256, token: 'github-token-fixture', fetchImpl: fetchArtifact });
        const heartbeatConfig = { writeOrigin: 'https://influx-fixture.grafana.net', queryOrigin: 'https://prometheus-fixture.grafana.net', queryBasePath: '/api/prom' as const, metricsInstanceId: '12', writeToken: 'w'.repeat(40), readToken: 'r'.repeat(40), environmentAlias: 'synthetic-recovery', candidateSha: context.sha, configSha256: 'e'.repeat(64) };
        let posts = 0;
        const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => { if (init?.method === 'POST') {
            posts++;
            throw new Error('secret provider response');
        } return Response.json({ status: 'success', data: { resultType: 'vector', result: [{ metric: { environment: 'synthetic-recovery', candidate: context.sha, config: 'e'.repeat(64), descriptor: f.created.descriptorSha256, artifact: '56' }, value: [Date.parse(now) / 1000, String(Date.parse(now) / 1000)] }] } }); };
        const options = { ...f.options, heartbeatConfig, fetchImpl };
        await expect(beginHeartbeat(options)).rejects.toThrow('READBACK_ONLY');
        expect(await beginHeartbeat(options)).toEqual({ status: 'readback-only' });
        expect(posts).toBe(1);
        expect(await finalizeHeartbeat(options)).toMatchObject({ status: 'verified', checkpointAt: now, artifactId: '56' });
        const m = await readPrivateManifest(f.paths.manifestPath, { repositoryRoot: process.cwd(), now });
        expect(m.state).toBe('backup_verified');
        expect(m.pending).toBeNull();
        expect(m.backupVerification).toBeNull();
        await cleanupBackupAutomation({ directory: f.paths.directory, repositoryRoot: process.cwd(), context });
        await expect(stat(f.paths.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    finally {
        await rm(f.runnerTemp, { recursive: true, force: true });
    }
});

it.each(['cost-expiry', 'extra-plaintext', 'missing-backup-provenance', 'wrong-descriptor', 'revoked-action'])(
    'fails %s before persisting any upload intent', async kind => {
        const f = await publicationFixture();
        try {
            if (kind === 'cost-expiry') f.options.now = '2026-09-06T12:00:00.000Z';
            if (kind === 'extra-plaintext') await (await import('node:fs/promises')).writeFile(join(f.paths.outputDirectory, 'database.sql'), 'private fixture', { mode: 0o600 });
            if (kind === 'wrong-descriptor') f.options.expectedDescriptorSha256 = '0'.repeat(64);
            if (['missing-backup-provenance', 'revoked-action'].includes(kind)) {
                const manifest = await readPrivateManifest(f.paths.manifestPath, { repositoryRoot: process.cwd(), now });
                if (kind === 'missing-backup-provenance') manifest.history = [];
                else manifest.allowedActions = manifest.allowedActions.filter(a => a !== 'artifact-upload');
                await writePrivateManifest(f.paths.manifestPath, manifest, { repositoryRoot: process.cwd(), now, replace: true });
            }
            await expect(preparePublication(f.options)).rejects.toThrow('Issue #29:');
            const manifest = await readPrivateManifest(f.paths.manifestPath, { repositoryRoot: process.cwd(), now });
            expect(manifest.state).toBe('backup_started'); expect(manifest.pending).toBeNull();
        } finally { await rm(f.runnerTemp, { recursive: true, force: true }); }
    }
);
it('does not clean a directory owned by another GitHub run', async () => {
    const f = await publicationFixture();
    try {
        await expect(cleanupBackupAutomation({ directory: f.paths.directory, repositoryRoot: process.cwd(), context: { ...context, runId: 35 } })).rejects.toThrow('RUNNER_CLEANUP_OWNERSHIP_MISMATCH');
        expect((await stat(f.paths.directory)).isDirectory()).toBe(true);
    } finally { await rm(f.runnerTemp, { recursive: true, force: true }); }
});
