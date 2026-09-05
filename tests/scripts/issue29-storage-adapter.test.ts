import { expect, test } from 'vitest';
import { exportFinalizedStorage } from '../../scripts/issue29-operations/storage-adapter.mjs';
test('refuses preserved source data before making a Storage request', async () => {
    let called = false;
    const scope = { mode: 'hosted' as const, role: 'source' as const, runId: '29292929-2929-4292-8292-292929292929', projectRef: 'abcdefghijklmnopqrst', sourceRef: 'abcdefghijklmnopqrst', preservedRefs: ['abcdefghijklmnopqrst'], createdResourceEvidenceSha256: 'a'.repeat(64), apiUrl: 'https://abcdefghijklmnopqrst.supabase.co' };
    await expect(exportFinalizedStorage({ scope, secretKey: 'private-test-key', photos: [], expectedRowsetSha256: 'a'.repeat(64), fetchImpl: async () => { called = true; throw new Error('not reached'); } })).rejects.toThrow('PRESERVED_PROJECT_FORBIDDEN');
    expect(called).toBe(false);
});
import { restoreFinalizedStorage, verifyFinalizedStorage } from '../../scripts/issue29-operations/storage-adapter.mjs';
import { finalizedRowsetSha256 } from '../../scripts/issue29-operations/logical-recovery.mjs';
import { sha256 } from '../../scripts/storage-backup-crypto.mjs';
const objectPath = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.webp';
const bytes = Buffer.from('synthetic-webp-bytes');
const photo = { id: '33333333-3333-4333-8333-333333333333', storage_path: objectPath, content_hash: sha256(bytes), mime_type: 'image/webp', byte_size: bytes.length, sanitized_at: '2026-09-05T12:00:00+00:00' };
const bucket = { id: 'listing-images', name: 'listing-images', public: false, file_size_limit: 10485760, allowed_mime_types: ['image/webp'] };
function fixture() { const scope = { mode: 'hosted' as const, role: 'target' as const, runId: '29292929-2929-4292-8292-292929292929', projectRef: 'cdefghijklmnopqrstuv', sourceRef: 'abcdefghijklmnopqrst', preservedRefs: ['bcdefghijklmnopqrstu'], createdResourceEvidenceSha256: 'a'.repeat(64), apiUrl: 'https://cdefghijklmnopqrstuv.supabase.co' }; return { scope, secretKey: 'private-test-key', photos: [photo], expectedRowsetSha256: finalizedRowsetSha256([photo]), storageManifest: { bucket: 'listing-images' as const, files: [{ path: objectPath, backupName: `${sha256(objectPath)}.bin`, sha256: photo.content_hash, bytes: bytes.length, contentType: 'image/webp' }] }, components: new Map([[`${sha256(objectPath)}.bin`, bytes]]), bucketInventory: [bucket], descriptorSha256: 'd'.repeat(64), persistIntent: async () => { }, readbackVerified: async () => { } }; }
function storageHttp(initial = new Map<string, Buffer>(), hasBucket = true) {
    const objects = new Map(initial);
    let mutations = 0;
    let uncertain = false;
    const events: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
        const u = new URL(String(input));
        const method = init?.method ?? 'GET';
        const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
        if (u.pathname === '/storage/v1/bucket' && method === 'GET')
            return json(hasBucket ? [bucket] : []);
        if (u.pathname === '/storage/v1/bucket' && method === 'POST') {
            mutations++;
            hasBucket = true;
            return json({ name: bucket.name });
        }
        if (u.pathname === '/storage/v1/object/list/listing-images') {
            const { prefix } = JSON.parse(String(init?.body));
            const grouped = new Map();
            for (const path of objects.keys()) {
                if (prefix && !path.startsWith(`${prefix}/`))
                    continue;
                const rest = prefix ? path.slice(prefix.length + 1) : path;
                const [name, ...parts] = rest.split('/');
                grouped.set(name, { name, id: parts.length ? null : 'object-id', metadata: parts.length ? null : { size: objects.get(path)!.length } });
            }
            return json([...grouped.values()]);
        }
        const marker = '/storage/v1/object/listing-images/';
        if (u.pathname.startsWith(marker)) {
            const path = decodeURIComponent(u.pathname.slice(marker.length));
            if (method === 'GET') {
                const value = objects.get(path);
                return value ? new Response(Uint8Array.from(value)) : json({ message: 'missing' }, 404);
            }
            if (method === 'POST') {
                expect(new Headers(init?.headers).get('x-upsert')).toBe('false');
                mutations++;
                events.push('upload');
                objects.set(path, Buffer.from(await new Response(init?.body).arrayBuffer()));
                if (uncertain)
                    throw new Error('PRIVATE_PROVIDER_RESPONSE');
                return json({ Key: `listing-images/${path}` });
            }
        }
        throw new Error('Unexpected test HTTP route');
    };
    return { fetchImpl, objects, events, get mutations() { return mutations; }, set uncertain(value: boolean) { uncertain = value; } };
}
test('validates every plaintext component before creating a missing target bucket', async () => { const http = storageHttp(new Map(), false); const input = fixture(); input.components.clear(); await expect(restoreFinalizedStorage({ ...input, fetchImpl: http.fetchImpl })).rejects.toThrow('STORAGE_COMPONENT_HASH_MISMATCH'); expect(http.mutations).toBe(0); });
test('exports only the exact finalized rowset and redownloaded hashes', async () => { const input = fixture(); const http = storageHttp(new Map([[objectPath, bytes]])); const source = { ...input.scope, role: 'source' as const, projectRef: input.scope.sourceRef, apiUrl: `https://${input.scope.sourceRef}.supabase.co` }; const result = await exportFinalizedStorage({ ...input, scope: source, fetchImpl: http.fetchImpl }); expect(result.objectCount).toBe(1); expect(result.totalBytes).toBe(bytes.length); expect(result.components.get(`${sha256(objectPath)}.bin`)).toEqual(bytes); expect(http.mutations).toBe(0); });
test('persists upload intent before mutation and acknowledges only after exact readback', async () => { const input = fixture(), http = storageHttp(); const result = await restoreFinalizedStorage({ ...input, fetchImpl: http.fetchImpl, persistIntent: async () => { http.events.push('intent'); }, readbackVerified: async () => { http.events.push('verified'); } }); expect(http.events).toEqual(['verified', 'intent', 'upload', 'verified']); expect(result.restored).toBe(1); expect(result.allObjectHashesVerified).toBe(true); const proof = await verifyFinalizedStorage({ ...input, fetchImpl: http.fetchImpl }); expect(proof.objectCount).toBe(1); expect(http.mutations).toBe(1); });
test('stops ambiguous upload once and resumes by hashing existing objects, never by overwrite', async () => { const input = fixture(), http = storageHttp(); http.uncertain = true; await expect(restoreFinalizedStorage({ ...input, fetchImpl: http.fetchImpl })).rejects.toThrow('STORAGE_UPLOAD_OUTCOME_UNCERTAIN'); expect(http.mutations).toBe(1); http.uncertain = false; const result = await restoreFinalizedStorage({ ...input, fetchImpl: http.fetchImpl, resumeDescriptorSha256: input.descriptorSha256 }); expect(result.resumed).toBe(1); expect(result.restored).toBe(0); expect(http.mutations).toBe(1); });
test('rejects foreign objects and corrupt resumable objects before any mutation', async () => { const input = fixture(); const foreign = storageHttp(new Map([[objectPath.replace('.webp', '-foreign.webp'), bytes]])); await expect(restoreFinalizedStorage({ ...input, fetchImpl: foreign.fetchImpl, resumeDescriptorSha256: input.descriptorSha256 })).rejects.toThrow('TARGET_FOREIGN_STORAGE'); expect(foreign.mutations).toBe(0); const corrupt = storageHttp(new Map([[objectPath, Buffer.from('wrong')]])); await expect(restoreFinalizedStorage({ ...input, fetchImpl: corrupt.fetchImpl, resumeDescriptorSha256: input.descriptorSha256 })).rejects.toThrow('RESUME_OBJECT_HASH_MISMATCH'); expect(corrupt.mutations).toBe(0); });
test('allows only the exact current-run synthetic monitoring sentinel as an explicit finalized-backup exclusion', async () => {
    const input = fixture(), http = storageHttp(new Map([[objectPath, bytes]]));
    const source = { ...input.scope, role: 'source' as const, projectRef: input.scope.sourceRef, apiUrl: `https://${input.scope.sourceRef}.supabase.co` };
    const sentinel = { path: `${source.runId}/sentinel.bin`, sha256: sha256(bytes), bytes: bytes.length };
    const fetchImpl: typeof fetch = async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path === '/storage/v1/bucket')
            return new Response(JSON.stringify([bucket, { id: 'operations-sentinels', name: 'operations-sentinels', public: false, file_size_limit: 1024, allowed_mime_types: null }]), { headers: { 'content-type': 'application/json' } });
        if (path === '/storage/v1/object/list/operations-sentinels') {
            const { prefix } = JSON.parse(String(init?.body));
            return new Response(JSON.stringify(prefix ? [{ id: 'owned-sentinel', name: 'sentinel.bin', metadata: { size: bytes.length } }] : [{ id: null, name: source.runId, metadata: null }]), { headers: { 'content-type': 'application/json' } });
        }
        if (path === `/storage/v1/object/operations-sentinels/${sentinel.path}`)
            return new Response(Uint8Array.from(bytes));
        return http.fetchImpl(url, init);
    };
    const result = await exportFinalizedStorage({ ...input, scope: source, fetchImpl, sentinel });
    expect(result.objectCount).toBe(1);
    expect(result.bucketInventory).toHaveLength(2);
    await expect(exportFinalizedStorage({ ...input, scope: source, fetchImpl })).rejects.toThrow('MONITOR_SENTINEL_PROVENANCE_REQUIRED');
    await expect(exportFinalizedStorage({ ...input, scope: source, fetchImpl, sentinel: { ...sentinel, sha256: 'f'.repeat(64) } })).rejects.toThrow('MONITOR_SENTINEL_HASH_MISMATCH');
});
