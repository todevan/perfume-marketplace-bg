import { createClient } from '@supabase/supabase-js';
import { ensure, OperationsError } from './manifest.mjs';
import { assertRecoveryScope, finalizedRowsetSha256 } from './logical-recovery.mjs';
import { sha256, validateManifest as validateStorageManifest } from '../storage-backup-crypto.mjs';
import { canonicalJson } from './recovery-set.mjs';
/** @typedef {import('./logical-recovery.mjs').RecoveryScope} RecoveryScope */
/** @typedef {{id:string,storage_path:string,content_hash:string,mime_type:string,byte_size:number,sanitized_at:string}} FinalizedPhoto */
/** @typedef {{id:string,name:string,public:boolean,file_size_limit:number|null,allowed_mime_types:string[]|null}} BucketConfiguration */
/** @typedef {{scope:RecoveryScope,secretKey:string,fetchImpl?:typeof fetch}} StorageOptions */
const BUCKET = 'listing-images';
const BUCKETS = ['listing-images', 'listing-image-quarantine', 'merchant-documents', 'report-evidence', 'operations-sentinels'];
/** @param {StorageOptions} options */
function storageClient({ scope, secretKey, fetchImpl = fetch }) { assertRecoveryScope(scope); ensure(typeof secretKey === 'string' && secretKey.length > 0, 'STORAGE_CREDENTIAL_REQUIRED'); return createClient(scope.apiUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (url, init) => fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) }) } }); }
/** @typedef {ReturnType<typeof storageClient>} StorageClient */
/** @param {StorageClient} client @param {string} bucket @param {string} [prefix] @param {number} [depth] @returns {Promise<string[]>} */
async function listPaths(client, bucket, prefix = '', depth = 0) {
    ensure(depth <= 3, 'STORAGE_PATH_DEPTH_INVALID');
    const paths = [];
    for (let offset = 0; offset < 100000; offset += 1000) {
        const result = await client.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
        ensure(!result.error && Array.isArray(result.data), 'STORAGE_INVENTORY_FAILED');
        for (const entry of result.data) {
            ensure(typeof entry.name === 'string' && !entry.name.includes('/') && !entry.name.includes('\\') && entry.name !== '.' && entry.name !== '..', 'STORAGE_PATH_INVALID');
            const path = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.id || entry.metadata)
                paths.push(path);
            else
                paths.push(...await listPaths(client, bucket, path, depth + 1));
            ensure(paths.length <= 100000, 'STORAGE_INVENTORY_LIMIT');
        }
        if (result.data.length < 1000)
            return paths;
    }
    throw new OperationsError('STORAGE_INVENTORY_LIMIT');
}
/** @param {StorageClient} client @returns {Promise<BucketConfiguration[]>} */
async function buckets(client) { const result = await client.storage.listBuckets(); ensure(!result.error && Array.isArray(result.data), 'STORAGE_BUCKET_INVENTORY_FAILED'); const selected = result.data.map(b => ({ id: b.id, name: b.name, public: b.public, file_size_limit: b.file_size_limit === undefined || b.file_size_limit === null ? null : Number(b.file_size_limit), allowed_mime_types: b.allowed_mime_types ?? null })); ensure(selected.every(b => BUCKETS.includes(b.id) && b.name === b.id && b.public === false), 'STORAGE_BUCKET_SCOPE_UNPROVEN'); return selected.sort((a, b) => a.id.localeCompare(b.id)); }
/** @param {StorageClient} client @param {string} path @param {string} [bucket] */
async function download(client, path, bucket = BUCKET) { const response = await client.storage.from(bucket).download(path); ensure(!response.error && response.data, 'STORAGE_OBJECT_READ_FAILED'); const bytes = Buffer.from(await response.data.arrayBuffer()); ensure(bytes.length <= 10 * 1024 * 1024, 'STORAGE_OBJECT_SIZE_INVALID'); return bytes; }
/** @param {FinalizedPhoto[]} photos @param {string} expected */
function rowset(photos, expected) {
    ensure(Array.isArray(photos) && photos.length <= 100000 && finalizedRowsetSha256(photos) === expected, 'FINALIZED_ROWSET_MISMATCH');
    const manifest = { bucket: BUCKET, files: photos.map(p => ({ path: p.storage_path, backupName: `${sha256(p.storage_path)}.bin`, sha256: p.content_hash, bytes: p.byte_size, contentType: p.mime_type })) };
    try {
        return validateStorageManifest(manifest, photos.length);
    }
    catch {
        throw new OperationsError('FINALIZED_ROWSET_INVALID');
    }
}
/** Exact read-only finalized object export coordinated by the caller's held Postgres snapshot. @param {StorageOptions & {photos:FinalizedPhoto[],expectedRowsetSha256:string,sentinel?:{path:string,sha256:string,bytes:number}}} options */
export async function exportFinalizedStorage(options) {
    assertRecoveryScope(options.scope);
    ensure(options.scope.role === 'source', 'SOURCE_CAPABILITY_REQUIRED');
    const manifest = rowset(options.photos, options.expectedRowsetSha256);
    const client = storageClient(options); /** @type {Map<string,Buffer>} */
    const components = new Map();
    try {
        const bucketInventory = await buckets(client);
        ensure(bucketInventory.some(b => b.id === BUCKET), 'FINALIZED_BUCKET_MISSING');
        for (const bucket of bucketInventory)
            if (bucket.id !== BUCKET) {
                const paths = await listPaths(client, bucket.id);
                if (bucket.id === 'operations-sentinels') {
                    const sentinel = options.sentinel;
                    ensure(sentinel && sentinel.path === `${options.scope.runId}/sentinel.bin` && /^[a-f0-9]{64}$/u.test(sentinel.sha256) && Number.isSafeInteger(sentinel.bytes) && sentinel.bytes > 0 && sentinel.bytes <= 1024, 'MONITOR_SENTINEL_PROVENANCE_REQUIRED');
                    ensure(paths.length === 1 && paths[0] === sentinel.path, 'MONITOR_SENTINEL_INVENTORY_MISMATCH');
                    const bytes = await download(client, sentinel.path, bucket.id);
                    try {
                        ensure(bytes.length === sentinel.bytes && sha256(bytes) === sentinel.sha256, 'MONITOR_SENTINEL_HASH_MISMATCH');
                    }
                    finally {
                        bytes.fill(0);
                    }
                }
                else
                    ensure(paths.length === 0, 'NONFINALIZED_STORAGE_REQUIRES_SEPARATE_RECOVERY');
            }
        const paths = await listPaths(client, BUCKET);
        ensure(canonicalJson(paths.sort()) === canonicalJson(manifest.files.map(f => f.path).sort()), 'STORAGE_ROWSET_MISMATCH');
        for (const file of manifest.files) {
            const bytes = await download(client, file.path);
            ensure(bytes.length === file.bytes && sha256(bytes) === file.sha256, 'STORAGE_OBJECT_HASH_MISMATCH');
            components.set(file.backupName, bytes);
        }
        ensure(canonicalJson((await listPaths(client, BUCKET)).sort()) === canonicalJson(paths), 'STORAGE_INVENTORY_DRIFT');
        return { components, storageManifest: manifest, bucketInventory, finalizedRowsetSha256: options.expectedRowsetSha256, objectCount: manifest.files.length, totalBytes: manifest.files.reduce((n, f) => n + f.bytes, 0), pathTreeSha256: sha256(manifest.files.map(f => `${f.path}\t${f.sha256}\t${f.bytes}`).sort().join('\n')) };
    }
    catch (error) {
        for (const bytes of components.values())
            bytes.fill(0);
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('STORAGE_EXPORT_FAILED');
    }
}
/** @typedef {{kind:'bucket-create'|'object-upload',resource:string,sha256:string}} StorageIntent */
/** Recreate bucket configuration and upload via the Storage API, never replay managed storage.objects rows. @param {StorageOptions & {photos:FinalizedPhoto[],expectedRowsetSha256:string,storageManifest:ReturnType<typeof validateStorageManifest>,components:Map<string,Buffer>,bucketInventory:BucketConfiguration[],descriptorSha256:string,resumeDescriptorSha256?:string,persistIntent:(intent:StorageIntent)=>Promise<void>,readbackVerified:(intent:StorageIntent)=>Promise<void>}} options */
export async function restoreFinalizedStorage(options) {
    assertRecoveryScope(options.scope);
    ensure(options.scope.role === 'target', 'RESTORE_CAPABILITY_REQUIRED');
    const expected = rowset(options.photos, options.expectedRowsetSha256);
    let manifest;
    try {
        manifest = validateStorageManifest(options.storageManifest, expected.files.length);
    }
    catch {
        throw new OperationsError('STORAGE_MANIFEST_INVALID');
    }
    ensure(canonicalJson(manifest) === canonicalJson(expected), 'STORAGE_ROWSET_MISMATCH');
    ensure(/^[a-f0-9]{64}$/u.test(options.descriptorSha256) && typeof options.persistIntent === 'function' && typeof options.readbackVerified === 'function', 'STORAGE_RESTORE_PROVENANCE_REQUIRED');
    for (const file of manifest.files) {
        const bytes = options.components.get(file.backupName);
        ensure(bytes && bytes.length === file.bytes && sha256(bytes) === file.sha256, 'STORAGE_COMPONENT_HASH_MISMATCH');
    }
    const client = storageClient(options);
    let restored = 0, resumed = 0;
    try {
        const currentBuckets = await buckets(client);
        ensure(options.bucketInventory.every(b => BUCKETS.includes(b.id) && b.id === b.name && b.public === false), 'STORAGE_BUCKET_SCOPE_UNPROVEN');
        ensure(currentBuckets.every(b => options.bucketInventory.some(expected => expected.id === b.id && canonicalJson(expected) === canonicalJson(b))), 'TARGET_FOREIGN_BUCKET');
        for (const config of currentBuckets)
            if (config.id !== BUCKET)
                ensure((await listPaths(client, config.id)).length === 0, 'TARGET_FOREIGN_STORAGE');
        const existing = new Set(currentBuckets.some(b => b.id === BUCKET) ? await listPaths(client, BUCKET) : []);
        if (existing.size > 0)
            ensure(options.resumeDescriptorSha256 === options.descriptorSha256, 'TARGET_NOT_EMPTY_RESUME_UNPROVEN');
        ensure([...existing].every(path => manifest.files.some(file => file.path === path)), 'TARGET_FOREIGN_STORAGE');
        // Check every resumable object and every input before the first object upload.
        for (const file of manifest.files) {
            const bytes = options.components.get(file.backupName);
            ensure(bytes && bytes.length === file.bytes && sha256(bytes) === file.sha256, 'STORAGE_COMPONENT_HASH_MISMATCH');
            if (existing.has(file.path)) {
                const observed = await download(client, file.path);
                ensure(observed.length === file.bytes && sha256(observed) === file.sha256, 'RESUME_OBJECT_HASH_MISMATCH');
                observed.fill(0);
                await options.readbackVerified({ kind: 'object-upload', resource: file.path, sha256: file.sha256 });
            }
        }
        for (const config of options.bucketInventory) {
            if (currentBuckets.some(b => b.id === config.id)) {
                await options.readbackVerified({ kind: 'bucket-create', resource: config.id, sha256: sha256(canonicalJson(config)) });
                continue;
            }
            const intent = { kind: /** @type {const} */ ('bucket-create'), resource: config.id, sha256: sha256(canonicalJson(config)) };
            await options.persistIntent(intent);
            const response = await client.storage.createBucket(config.id, { public: false, ...(config.file_size_limit === null ? {} : { fileSizeLimit: config.file_size_limit }), ...(config.allowed_mime_types === null ? {} : { allowedMimeTypes: config.allowed_mime_types }) });
            ensure(!response.error, 'STORAGE_BUCKET_MUTATION_UNCERTAIN');
            const observed = (await buckets(client)).find(b => b.id === config.id);
            ensure(observed && canonicalJson(observed) === canonicalJson(config), 'STORAGE_BUCKET_READBACK_MISMATCH');
            await options.readbackVerified(intent);
        }
        for (const file of manifest.files) {
            if (existing.has(file.path)) {
                resumed++;
                continue;
            }
            const intent = { kind: /** @type {const} */ ('object-upload'), resource: file.path, sha256: file.sha256 };
            await options.persistIntent(intent);
            const upload = await client.storage.from(BUCKET).upload(file.path, /** @type {Buffer} */ (options.components.get(file.backupName)), { contentType: file.contentType, upsert: false });
            ensure(!upload.error, 'STORAGE_UPLOAD_OUTCOME_UNCERTAIN');
            const observed = await download(client, file.path);
            ensure(observed.length === file.bytes && sha256(observed) === file.sha256, 'STORAGE_UPLOAD_READBACK_MISMATCH');
            observed.fill(0);
            await options.readbackVerified(intent);
            restored++;
        }
        const finalPaths = await listPaths(client, BUCKET);
        ensure(canonicalJson(finalPaths.sort()) === canonicalJson(manifest.files.map(f => f.path).sort()), 'STORAGE_FINAL_INVENTORY_MISMATCH');
        for (const file of manifest.files) {
            const observed = await download(client, file.path);
            ensure(observed.length === file.bytes && sha256(observed) === file.sha256, 'STORAGE_FINAL_HASH_MISMATCH');
            observed.fill(0);
        }
        return { projectRef: options.scope.projectRef, descriptorSha256: options.descriptorSha256, restored, resumed, objectCount: manifest.files.length, totalBytes: manifest.files.reduce((n, f) => n + f.bytes, 0), finalizedRowsetSha256: options.expectedRowsetSha256, pathTreeSha256: sha256(manifest.files.map(f => `${f.path}\t${f.sha256}\t${f.bytes}`).sort().join('\n')), allObjectHashesVerified: true };
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('STORAGE_RESTORE_OUTCOME_UNCERTAIN');
    }
}
/** Independent read-only every-object verification, suitable for ambiguous upload readback. @param {StorageOptions & {photos:FinalizedPhoto[],expectedRowsetSha256:string,storageManifest:ReturnType<typeof validateStorageManifest>,descriptorSha256:string,bucketInventory:BucketConfiguration[]}} options */
export async function verifyFinalizedStorage(options) {
    assertRecoveryScope(options.scope);
    ensure(options.scope.role === 'target', 'RESTORE_CAPABILITY_REQUIRED');
    const expected = rowset(options.photos, options.expectedRowsetSha256);
    ensure(canonicalJson(expected) === canonicalJson(options.storageManifest) && /^[a-f0-9]{64}$/u.test(options.descriptorSha256), 'STORAGE_ROWSET_MISMATCH');
    const client = storageClient(options);
    try {
        ensure(canonicalJson(await buckets(client)) === canonicalJson([...options.bucketInventory].sort((a, b) => a.id.localeCompare(b.id))), 'STORAGE_BUCKET_READBACK_MISMATCH');
        for (const bucket of options.bucketInventory)
            if (bucket.id !== BUCKET)
                ensure((await listPaths(client, bucket.id)).length === 0, 'TARGET_FOREIGN_STORAGE');
        const paths = await listPaths(client, BUCKET);
        ensure(canonicalJson(paths.sort()) === canonicalJson(expected.files.map(f => f.path).sort()), 'STORAGE_FINAL_INVENTORY_MISMATCH');
        for (const file of expected.files) {
            const bytes = await download(client, file.path);
            ensure(bytes.length === file.bytes && sha256(bytes) === file.sha256, 'STORAGE_FINAL_HASH_MISMATCH');
            bytes.fill(0);
        }
        return { projectRef: options.scope.projectRef, descriptorSha256: options.descriptorSha256, objectCount: expected.files.length, totalBytes: expected.files.reduce((n, f) => n + f.bytes, 0), finalizedRowsetSha256: options.expectedRowsetSha256, pathTreeSha256: sha256(expected.files.map(f => `${f.path}\t${f.sha256}\t${f.bytes}`).sort().join('\n')), allObjectHashesVerified: true };
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('STORAGE_READBACK_FAILED');
    }
}
