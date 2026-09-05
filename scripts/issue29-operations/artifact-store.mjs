import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { assertPrivatePath, ensure, OperationsError } from './manifest.mjs';
import { canonicalJson, validateRecoveryDescriptor } from './recovery-set.mjs';
const HASH = /^[a-f0-9]{64}$/u;
const DAY = 86400000;
const artifactSchema = z.object({
    id: z.number().int().positive(), name: z.string(), size_in_bytes: z.number().int().positive(),
    expired: z.boolean(), created_at: z.iso.datetime(), expires_at: z.iso.datetime(),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    workflow_run: z.object({ id: z.number().int().positive(), repository_id: z.number().int().positive(),
        head_repository_id: z.number().int().positive(), head_branch: z.string(), head_sha: z.string() })
});
/** @typedef {{repository:string,repositoryId:number,runId:number,runAttempt:number,candidateSha:string,artifactId:number,artifactName:string,expectedArchiveSha256:string,maxBytes:number,token:string,now?:string,fetchImpl?:typeof fetch}} ArtifactOptions */
/** Verify the immutable archive independently of the official upload/download action's status.
 * No mutations, retries, provider bodies, signed URLs or credentials are returned.
 * @param {ArtifactOptions} options
 */
export async function verifyGitHubArtifact(options) {
    const { repository, repositoryId, runId, runAttempt, candidateSha, artifactId, artifactName, expectedArchiveSha256, maxBytes, token, fetchImpl = fetch } = options;
    const now = options.now ?? new Date().toISOString();
    ensure(/^[A-Za-z0-9-]+\/[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(repository) &&
        [repositoryId, runId, runAttempt, artifactId].every((value) => Number.isSafeInteger(value) && value > 0) &&
        /^[a-f0-9]{40}$/u.test(candidateSha) && HASH.test(expectedArchiveSha256) &&
        artifactName === `issue29-recovery-${runId}-${runAttempt}` &&
        Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 1100000000 &&
        /^[A-Za-z0-9_-]{10,512}$/u.test(token) && Number.isFinite(Date.parse(now)), 'ARTIFACT_REQUEST_INVALID');
    const endpoint = `https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}`;
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2026-03-10' };
    try {
        const response = await fetchImpl(endpoint, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
        ensure(response.status === 200, 'ARTIFACT_READBACK_UNAVAILABLE');
        const raw = await boundedResponse(response, 65536);
        const parsed = artifactSchema.safeParse(JSON.parse(raw.toString('utf8')));
        ensure(parsed.success, 'ARTIFACT_READBACK_INVALID');
        const artifact = parsed.data;
        ensure(artifact.id === artifactId && artifact.name === artifactName &&
            artifact.workflow_run.id === runId && artifact.workflow_run.repository_id === repositoryId &&
            artifact.workflow_run.head_repository_id === repositoryId && artifact.workflow_run.head_branch === 'main' &&
            artifact.workflow_run.head_sha === candidateSha, 'ARTIFACT_IDENTITY_MISMATCH');
        ensure(!artifact.expired && Date.parse(artifact.created_at) <= Date.parse(now) + 300000 &&
            Date.parse(artifact.created_at) >= Date.parse(now) - DAY &&
            Date.parse(artifact.expires_at) - Date.parse(artifact.created_at) >= 35 * DAY &&
            Date.parse(artifact.expires_at) > Date.parse(now), 'ARTIFACT_RETENTION_INVALID');
        ensure(artifact.digest === `sha256:${expectedArchiveSha256}` && artifact.size_in_bytes <= maxBytes, 'ARTIFACT_INTEGRITY_MISMATCH');
        const redirect = await fetchImpl(`${endpoint}/zip`, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
        ensure(redirect.status === 302 && redirect.headers.has('location'), 'ARTIFACT_DOWNLOAD_UNAVAILABLE');
        const location = new URL(/** @type {string} */ (redirect.headers.get('location')));
        ensure(location.protocol === 'https:' && !location.username && !location.password && !location.port &&
            (location.hostname.endsWith('.blob.core.windows.net') || location.hostname.endsWith('.githubusercontent.com')), 'ARTIFACT_REDIRECT_FORBIDDEN');
        // Never forward the GitHub authorization header to a signed blob URL.
        const archive = await fetchImpl(location.href, { redirect: 'error', signal: AbortSignal.timeout(120000) });
        ensure(archive.status === 200 && archive.body, 'ARTIFACT_DOWNLOAD_UNAVAILABLE');
        const digest = createHash('sha256');
        const reader = archive.body.getReader();
        let sizeBytes = 0;
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done)
                    break;
                sizeBytes += value.byteLength;
                ensure(sizeBytes <= maxBytes && sizeBytes <= artifact.size_in_bytes, 'ARTIFACT_SIZE_LIMIT');
                digest.update(value);
            }
        }
        finally {
            await reader.cancel().catch(() => { });
            reader.releaseLock();
        }
        const sha256 = digest.digest('hex');
        ensure(sizeBytes === artifact.size_in_bytes && sha256 === expectedArchiveSha256, 'ARTIFACT_INTEGRITY_MISMATCH');
        return { schemaVersion: 1, kind: 'issue29-artifact-readback', repository, repositoryId, runId, runAttempt,
            candidateSha, artifactId, artifactName, sha256, sizeBytes, retentionDays: 35,
            createdAt: artifact.created_at, expiresAt: artifact.expires_at,
            verifiedAt: options.now ?? new Date().toISOString() };
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('ARTIFACT_READBACK_FAILED');
    }
}
/** @param {Response} response @param {number} maximum */
async function boundedResponse(response, maximum) {
    ensure(response.body, 'ARTIFACT_READBACK_INVALID');
    const reader = response.body.getReader();
    /** @type {Buffer[]} */ const chunks = [];
    let bytes = 0;
    try {
        while (true) {
            const result = await reader.read();
            if (result.done)
                break;
            bytes += result.value.byteLength;
            ensure(bytes <= maximum, 'ARTIFACT_READBACK_INVALID');
            chunks.push(Buffer.from(result.value));
        }
    }
    finally {
        await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
    return Buffer.concat(chunks);
}
/** Validate every ciphertext and the exact sanitized descriptor, including after official action extraction.
 * Download-artifact does not preserve POSIX modes; only exact verified encrypted files are normalized.
 * @param {{directory:string,repositoryRoot:string,expectedDescriptorSha256:string,maxBytes:number,downloaded?:boolean}} options
 */
export async function verifyEncryptedArtifactDirectory(options) {
    const { directory, repositoryRoot, expectedDescriptorSha256, maxBytes, downloaded = false } = options;
    ensure(HASH.test(expectedDescriptorSha256) && Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 1100000000, 'ARTIFACT_REQUEST_INVALID');
    await assertPrivatePath(join(directory, 'boundary'), repositoryRoot);
    /** @param {string} name @param {number} limit */
    const read = async (name, limit) => {
        const path = join(directory, name);
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const stat = await handle.stat();
            ensure(stat.isFile() && stat.nlink === 1 && stat.size <= limit &&
                ((stat.mode & 0o777) === 0o600 || (downloaded && (stat.mode & 0o777) === 0o644)), 'ARTIFACT_FILE_UNSAFE');
            const bytes = await handle.readFile();
            ensure(bytes.length <= limit, 'ARTIFACT_SIZE_LIMIT');
            if (downloaded)
                await handle.chmod(0o600);
            return bytes;
        }
        finally {
            await handle.close();
        }
    };
    try {
        const descriptorBytes = await read('backup-set.json', 1048576);
        ensure(createHash('sha256').update(descriptorBytes).digest('hex') === expectedDescriptorSha256, 'DESCRIPTOR_HASH_MISMATCH');
        const descriptor = validateRecoveryDescriptor(JSON.parse(descriptorBytes.toString('utf8')));
        const components = [...descriptor.components, descriptor.manifest];
        const names = ['backup-set.json', ...components.map((component) => component.name)].sort();
        ensure(canonicalJson((await readdir(directory)).sort()) === canonicalJson(names), 'ARTIFACT_COMPONENT_INVENTORY_MISMATCH');
        let sizeBytes = descriptorBytes.length;
        for (const component of components) {
            const bytes = await read(component.name, Math.min(component.bytes, maxBytes));
            ensure(bytes.length === component.bytes && createHash('sha256').update(bytes).digest('hex') === component.ciphertextSha256, 'ARTIFACT_COMPONENT_INTEGRITY_MISMATCH');
            sizeBytes += bytes.length;
            ensure(sizeBytes <= maxBytes, 'ARTIFACT_SIZE_LIMIT');
        }
        return { descriptor, descriptorSha256: expectedDescriptorSha256, fileNames: names, sizeBytes,
            componentInventorySha256: createHash('sha256').update(canonicalJson(components)).digest('hex') };
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('ARTIFACT_FILES_INVALID');
    }
}
