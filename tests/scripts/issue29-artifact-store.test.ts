import { createHash, generateKeyPairSync } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRecoverySet, LOGICAL_COMPONENTS } from '../../scripts/issue29-operations/recovery-set.mjs';
import { describe, expect, it } from 'vitest';
import { verifyGitHubArtifact, verifyEncryptedArtifactDirectory } from '../../scripts/issue29-operations/artifact-store.mjs';
describe('Issue 29 GitHub encrypted artifact boundary', () => {
    it('rejects the wrong candidate before following an artifact download redirect', async () => {
        const calls: string[] = [];
        await expect(verifyGitHubArtifact({
            repository: 'owner/recovery', repositoryId: 12, runId: 34, runAttempt: 1,
            candidateSha: 'a'.repeat(40), artifactId: 56, artifactName: 'issue29-recovery-34-1',
            expectedArchiveSha256: 'b'.repeat(64), maxBytes: 1024, token: 'github-token-fixture',
            now: '2026-09-05T12:00:00.000Z',
            fetchImpl: async (url: string | URL | Request) => {
                calls.push(String(url));
                return Response.json({ id: 56, name: 'issue29-recovery-34-1', size_in_bytes: 100,
                    expired: false, created_at: '2026-09-05T11:59:00Z', expires_at: '2026-10-10T11:59:00Z',
                    digest: `sha256:${'b'.repeat(64)}`, workflow_run: { id: 34, repository_id: 12,
                        head_repository_id: 12, head_branch: 'main', head_sha: 'c'.repeat(40) } });
            }
        })).rejects.toThrow('ARTIFACT_IDENTITY_MISMATCH');
        expect(calls).toEqual(['https://api.github.com/repos/owner/recovery/actions/artifacts/56']);
    });
    function artifactFixture() {
        const archive = Buffer.from('synthetic encrypted archive bytes');
        const digest = createHash('sha256').update(archive).digest('hex');
        const metadata = { id: 56, name: 'issue29-recovery-34-1', size_in_bytes: archive.length,
            expired: false, created_at: '2026-09-05T11:59:00Z', expires_at: '2026-10-10T11:59:00Z',
            digest: `sha256:${digest}`, workflow_run: { id: 34, repository_id: 12,
                head_repository_id: 12, head_branch: 'main', head_sha: 'a'.repeat(40) } };
        const calls: {
            url: string;
            headers?: HeadersInit;
            redirect?: RequestRedirect;
        }[] = [];
        const options = { repository: 'owner/recovery', repositoryId: 12, runId: 34, runAttempt: 1,
            candidateSha: 'a'.repeat(40), artifactId: 56, artifactName: 'issue29-recovery-34-1',
            expectedArchiveSha256: digest, maxBytes: 1024, token: 'github-token-fixture', now: '2026-09-05T12:00:00.000Z',
            fetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
                const url = String(input);
                calls.push({ url, headers: init?.headers, redirect: init?.redirect });
                if (url.endsWith('/56'))
                    return Response.json(metadata);
                if (url.endsWith('/zip'))
                    return new Response(null, { status: 302, headers: { location: 'https://production.blob.core.windows.net/artifacts/archive.zip?sig=private-signed-url' } });
                return new Response(archive);
            }
        };
        return { archive, metadata, calls, options };
    }
    it('checks real downloaded archive bytes and never forwards GitHub authorization to blob storage', async () => {
        const { options, calls, archive } = artifactFixture();
        const result = await verifyGitHubArtifact(options);
        expect(result).toMatchObject({ artifactId: 56, runId: 34, runAttempt: 1, sizeBytes: archive.length, retentionDays: 35, sha256: options.expectedArchiveSha256 });
        expect(calls).toHaveLength(3);
        expect(new Headers(calls[0].headers).get('authorization')).toBe('Bearer github-token-fixture');
        expect(new Headers(calls[2].headers).get('authorization')).toBeNull();
        expect(calls[2].redirect).toBe('error');
        expect(JSON.stringify(result)).not.toContain('private-signed-url');
        expect(JSON.stringify(result)).not.toContain('github-token-fixture');
    });
    it.each(['id', 'name', 'run', 'repository', 'fork', 'branch', 'digest', 'expired', 'retention', 'future', 'old'])('rejects %s readback drift without a download request', async (kind) => {
        const { metadata, calls, options } = artifactFixture();
        if (kind === 'id')
            metadata.id = 57;
        if (kind === 'name')
            metadata.name = 'issue29-recovery-34-2';
        if (kind === 'run')
            metadata.workflow_run.id = 35;
        if (kind === 'repository')
            metadata.workflow_run.repository_id = 13;
        if (kind === 'fork')
            metadata.workflow_run.head_repository_id = 13;
        if (kind === 'branch')
            metadata.workflow_run.head_branch = 'pull-request';
        if (kind === 'digest')
            metadata.digest = `sha256:${'0'.repeat(64)}`;
        if (kind === 'expired')
            metadata.expired = true;
        if (kind === 'retention')
            metadata.expires_at = '2026-10-09T11:59:00Z';
        if (kind === 'future')
            metadata.created_at = '2026-09-06T11:59:00Z';
        if (kind === 'old')
            metadata.created_at = '2026-09-04T11:59:00Z';
        await expect(verifyGitHubArtifact(options)).rejects.toThrow();
        expect(calls).toHaveLength(1);
    });
    it.each(['http://production.blob.core.windows.net/file', 'https://evil.example/file', 'https://user:secret@production.blob.core.windows.net/file', 'https://127.0.0.1/file'])('rejects an unsafe signed redirect %s', async (location) => {
        const { options } = artifactFixture();
        const fetchOriginal = options.fetchImpl;
        let calls = 0;
        options.fetchImpl = async (input, init) => {
            calls++;
            if (String(input).endsWith('/zip'))
                return new Response(null, { status: 302, headers: { location } });
            return fetchOriginal(input, init);
        };
        await expect(verifyGitHubArtifact(options)).rejects.toThrow('ARTIFACT_REDIRECT_FORBIDDEN');
        expect(calls).toBe(2);
    });
    it.each(['corrupt', 'short', 'oversized', 'provider-error'])('fails closed on %s downloaded bytes', async (kind) => {
        const { options, archive } = artifactFixture();
        const fetchOriginal = options.fetchImpl;
        options.fetchImpl = async (input, init) => {
            if (!String(input).includes('blob.core.windows.net'))
                return fetchOriginal(input, init);
            if (kind === 'provider-error')
                throw new Error('credential=never-log-this');
            if (kind === 'short')
                return new Response(archive.subarray(0, archive.length - 1));
            if (kind === 'oversized')
                return new Response(Buffer.alloc(2048));
            return new Response(Buffer.alloc(archive.length));
        };
        await expect(verifyGitHubArtifact(options)).rejects.toThrow(/ARTIFACT_(?:INTEGRITY_MISMATCH|SIZE_LIMIT|READBACK_FAILED)/u);
    });
    it('bounds malformed provider JSON and refuses an unsafe artifact request before any network call', async () => {
        const { options } = artifactFixture();
        let calls = 0;
        options.fetchImpl = async () => { calls++; return new Response('x'.repeat(100000)); };
        await expect(verifyGitHubArtifact({ ...options, repository: 'owner/..' })).rejects.toThrow('ARTIFACT_REQUEST_INVALID');
        expect(calls).toBe(0);
        await expect(verifyGitHubArtifact(options)).rejects.toThrow('ARTIFACT_READBACK_INVALID');
    });
    it('roundtrips every encrypted component without a private key and rejects additional plaintext', async () => {
        const root = await mkdtemp(join(tmpdir(), 'issue29-artifacts-'));
        try {
            const directory = join(root, 'published');
            const keys = generateKeyPairSync('rsa', { modulusLength: 3072 });
            const checkpoint = { snapshotId: 'fixture-snapshot', finalizedRowsetSha256: 'd'.repeat(64) };
            const created = await createRecoverySet({
                destination: directory, repositoryRoot: process.cwd(), publicKey: keys.publicKey,
                components: new Map(Object.keys(LOGICAL_COMPONENTS).map((name) => [name, Buffer.from(`synthetic fixture ${name}`)])),
                storageManifest: { bucket: 'listing-images', files: [] }, checkpointBefore: checkpoint, checkpointAfter: checkpoint,
                metadata: { backupSetId: '29292929-2929-4292-8292-292929292929',
                    source: { environmentAlias: 'synthetic-source', organizationId: 'owner-org', projectRef: 's'.repeat(20), region: 'eu-central-1', classification: 'synthetic-owner-controlled' },
                    release: { commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), workerVersion: 'worker-fixture' },
                    startedAt: '2026-09-05T11:58:00.000Z', finishedAt: '2026-09-05T11:59:00.000Z',
                    tools: { supabaseCli: '2.109.1', postgres: '17.6', operator: 'issue29-v1' }, migration: { count: 1, sha256: 'd'.repeat(64) },
                    destinationAlias: 'github-encrypted', exclusions: ['source-sessions'], manualReconstruction: ['auth-settings'] }
            });
            const options = { directory, repositoryRoot: process.cwd(), expectedDescriptorSha256: created.descriptorSha256, maxBytes: 1048576 };
            const verified = await verifyEncryptedArtifactDirectory(options);
            expect(verified.fileNames).toHaveLength(9);
            const componentPath = join(directory, created.descriptor.components[0].name);
            await chmod(componentPath, 0o644);
            await expect(verifyEncryptedArtifactDirectory(options)).rejects.toThrow('ARTIFACT_FILE_UNSAFE');
            await expect(verifyEncryptedArtifactDirectory({ ...options, downloaded: true })).resolves.toMatchObject({ descriptorSha256: created.descriptorSha256 });
            const bytes = await readFile(componentPath);
            bytes[bytes.length - 1] ^= 1;
            await writeFile(componentPath, bytes);
            await expect(verifyEncryptedArtifactDirectory(options)).rejects.toThrow('ARTIFACT_COMPONENT_INTEGRITY_MISMATCH');
            await writeFile(join(directory, 'database.sql'), 'must never upload', { mode: 0o600 });
            await expect(verifyEncryptedArtifactDirectory(options)).rejects.toThrow('ARTIFACT_COMPONENT_INVENTORY_MISMATCH');
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
