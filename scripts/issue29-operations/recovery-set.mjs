import { constants, createPrivateKey, createPublicKey, KeyObject, privateDecrypt, publicEncrypt, randomBytes, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { decryptBuffer, encryptBuffer, sha256, validateManifest as validateStorageManifest } from '../storage-backup-crypto.mjs';
import { assertPrivatePath, ensure, OperationsError } from './manifest.mjs';
/** @typedef {{backupSetId:string,source:{environmentAlias:string,organizationId:string,projectRef:string,region:string,classification:string},release:{commitSha:string,treeSha:string,workerVersion:string},startedAt:string,finishedAt:string,tools:{supabaseCli:string,postgres:string,operator:string},migration:{count:number,sha256:string},destinationAlias:string,exclusions:string[],manualReconstruction:string[]}} RecoveryMetadata */
/** @typedef {{snapshotId:string,finalizedRowsetSha256:string}} RecoveryCheckpoint */
/** @typedef {ReturnType<typeof validateStorageManifest>} StorageManifest */
/** @typedef {{name:string,kind:string,ciphertextSha256:string,bytes:number}} EncryptedComponent */
/** @typedef {{format:string,version:number,metadata:RecoveryMetadata,checkpoint:RecoveryCheckpoint,storage:{objectCount:number,totalBytes:number,pathTreeSha256:string,manifestSha256:string,finalizedRowsetSha256:string},encryption:{cipher:string,wrap:string,keyId:string,publicKey:string,wrappedKey:string},retention:{days:number,expiresAt:string},components:EncryptedComponent[],manifest:EncryptedComponent}} RecoveryDescriptor */
/** @typedef {{name:string,inputName:string,plaintextSha256:string,bytes:number}} PrivateComponent */
/** @typedef {{contextSha256:string,components:PrivateComponent[],storageManifest:StorageManifest}} PrivateInventory */
/** @typedef {{directory:string,repositoryRoot:string,privateKey:import('node:crypto').KeyLike,expectedDescriptorSha256:string}} VerifyOptions */
/** @type {Readonly<Record<string,string>>} */
export const LOGICAL_COMPONENTS = Object.freeze({ 'roles.sql': 'roles', 'schema.sql': 'schema', 'data.sql': 'data', 'migration-history.sql': 'migration-history', 'auth-recovery.sql': 'auth-recovery', 'managed-schema.sql': 'managed-schema-changes', 'platform-inventory.json': 'platform-inventory' });
const HASH = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ALIAS = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;
const MAX_COMPONENT_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
/** Canonical JSON binds descriptor metadata, encryption context and encrypted component inventory. @param {unknown} value @returns {string} */
export function canonicalJson(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(/** @type {Record<string,unknown>} */ (value)[key])}`).join(',')}}`;
}
/** @param {unknown} value @param {string[]} keys @returns {asserts value is Record<string,unknown>} */
function shape(value, keys) { ensure(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(k => keys.includes(k)), 'RECOVERY_DESCRIPTOR_INVALID'); }
/** @param {unknown} value @param {RegExp} pattern */
function matching(value, pattern) { ensure(typeof value === 'string' && pattern.test(value), 'RECOVERY_DESCRIPTOR_INVALID'); }
/** @param {unknown} value @returns {RecoveryMetadata} */
function metadataValue(value) {
    shape(value, ['backupSetId', 'source', 'release', 'startedAt', 'finishedAt', 'tools', 'migration', 'destinationAlias', 'exclusions', 'manualReconstruction']);
    matching(value.backupSetId, UUID);
    shape(value.source, ['environmentAlias', 'organizationId', 'projectRef', 'region', 'classification']);
    for (const name of ['environmentAlias', 'organizationId', 'region'])
        matching(value.source[name], ALIAS);
    matching(value.source.projectRef, /^[a-z]{20}$/u);
    ensure(value.source.classification === 'synthetic-owner-controlled', 'SOURCE_CLASSIFICATION_UNPROVEN');
    shape(value.release, ['commitSha', 'treeSha', 'workerVersion']);
    matching(value.release.commitSha, /^[a-f0-9]{40}$/u);
    matching(value.release.treeSha, /^[a-f0-9]{40}$/u);
    matching(value.release.workerVersion, /^[a-zA-Z0-9-]{1,128}$/u);
    matching(value.startedAt, INSTANT);
    matching(value.finishedAt, INSTANT);
    ensure(Number.isFinite(Date.parse(String(value.startedAt))) && Date.parse(String(value.finishedAt)) >= Date.parse(String(value.startedAt)), 'RECOVERY_TIMING_INVALID');
    shape(value.tools, ['supabaseCli', 'postgres', 'operator']);
    for (const tool of Object.values(value.tools))
        matching(tool, /^[a-zA-Z0-9.+-]{1,64}$/u);
    shape(value.migration, ['count', 'sha256']);
    ensure(Number.isSafeInteger(value.migration.count) && Number(value.migration.count) > 0, 'MIGRATION_INVENTORY_REQUIRED');
    matching(value.migration.sha256, HASH);
    matching(value.destinationAlias, ALIAS);
    for (const values of [value.exclusions, value.manualReconstruction]) {
        ensure(Array.isArray(values) && values.length > 0 && values.length <= 100 && new Set(values).size === values.length, 'RECOVERY_EXCLUSIONS_REQUIRED');
        values.forEach(item => matching(item, ALIAS));
    }
    return /** @type {RecoveryMetadata} */ ( /** @type {unknown} */(value));
}
/** @param {unknown} value @returns {RecoveryCheckpoint} */
function checkpointValue(value) { shape(value, ['snapshotId', 'finalizedRowsetSha256']); matching(value.snapshotId, /^[a-zA-Z0-9-]{1,128}$/u); matching(value.finalizedRowsetSha256, HASH); return /** @type {RecoveryCheckpoint} */ ( /** @type {unknown} */(value)); }
/** @param {StorageManifest} manifest */
function storageSummary(manifest) {
    return { objectCount: manifest.files.length, totalBytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0), pathTreeSha256: sha256(manifest.files.map(file => `${file.path}\t${file.sha256}\t${file.bytes}`).sort().join('\n')), manifestSha256: sha256(canonicalJson(manifest)) };
}
/** @param {RecoveryDescriptor} descriptor */
function descriptorContext(descriptor) { const { manifest: _manifest, ...context } = descriptor; return context; }
/** @param {string} path @param {Buffer|string} bytes */
async function writePrivate(path, bytes) { const handle = await open(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600); try {
    await handle.writeFile(bytes);
    await handle.sync();
}
finally {
    await handle.close();
} }
/** @param {string} path @param {number} [limit] */
async function readPrivate(path, limit = MAX_COMPONENT_BYTES) {
    const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
        const info = await handle.stat();
        ensure(info.isFile() && info.nlink === 1 && (info.mode & 0o777) === 0o600 && info.size <= limit, 'RECOVERY_FILE_UNSAFE');
        return await handle.readFile();
    }
    finally {
        await handle.close();
    }
}
/** @param {import('node:crypto').KeyLike} input */
function ownerPublicKey(input) { const key = input instanceof KeyObject && input.type === 'public' ? input : createPublicKey(input); ensure(key.asymmetricKeyType === 'rsa' && Number(key.asymmetricKeyDetails?.modulusLength) >= 3072, 'OWNER_PUBLIC_KEY_UNSUPPORTED'); return key; }
/** @param {unknown} value @returns {RecoveryDescriptor} */
export function validateRecoveryDescriptor(value) {
    shape(value, ['format', 'version', 'metadata', 'checkpoint', 'storage', 'encryption', 'retention', 'components', 'manifest']);
    ensure(value.format === 'aromatika-coordinated-recovery-set' && value.version === 1, 'RECOVERY_FORMAT_UNSUPPORTED');
    metadataValue(value.metadata);
    checkpointValue(value.checkpoint);
    shape(value.storage, ['objectCount', 'totalBytes', 'pathTreeSha256', 'manifestSha256', 'finalizedRowsetSha256']);
    ensure(Number.isSafeInteger(value.storage.objectCount) && Number(value.storage.objectCount) >= 0 && Number(value.storage.objectCount) <= 100000 && Number.isSafeInteger(value.storage.totalBytes) && Number(value.storage.totalBytes) >= 0 && Number(value.storage.totalBytes) <= MAX_TOTAL_BYTES, 'RECOVERY_DESCRIPTOR_INVALID');
    for (const name of ['pathTreeSha256', 'manifestSha256', 'finalizedRowsetSha256'])
        matching(value.storage[name], HASH);
    ensure(value.storage.finalizedRowsetSha256 === /** @type {RecoveryCheckpoint} */ (value.checkpoint).finalizedRowsetSha256, 'CHECKPOINT_MISMATCH');
    shape(value.encryption, ['cipher', 'wrap', 'keyId', 'publicKey', 'wrappedKey']);
    ensure(value.encryption.cipher === 'aes-256-gcm' && value.encryption.wrap === 'rsa-oaep-sha256', 'RECOVERY_FORMAT_UNSUPPORTED');
    matching(value.encryption.keyId, HASH);
    matching(value.encryption.publicKey, /^[A-Za-z0-9+/]{1,4096}={0,2}$/u);
    matching(value.encryption.wrappedKey, /^[A-Za-z0-9+/]{1,4096}={0,2}$/u);
    ensure(sha256(Buffer.from(String(value.encryption.publicKey), 'base64')) === value.encryption.keyId, 'OWNER_PUBLIC_KEY_MISMATCH');
    shape(value.retention, ['days', 'expiresAt']);
    ensure(value.retention.days === 35 && value.retention.expiresAt === new Date(Date.parse(/** @type {RecoveryMetadata} */ (value.metadata).finishedAt) + 35 * 86400000).toISOString(), 'RETENTION_INVALID');
    ensure(Array.isArray(value.components) && value.components.length === Object.keys(LOGICAL_COMPONENTS).length + Number(value.storage.objectCount), 'COMPONENT_INVENTORY_MISMATCH');
    const names = new Set();
    for (const component of [...value.components, value.manifest]) {
        shape(component, ['name', 'kind', 'ciphertextSha256', 'bytes']);
        matching(component.name, /^(?:component-\d{6}|manifest)\.bin$/u);
        matching(component.ciphertextSha256, HASH);
        ensure(Number.isSafeInteger(component.bytes) && Number(component.bytes) >= 29 && Number(component.bytes) <= MAX_COMPONENT_BYTES + 28 && !names.has(component.name), 'COMPONENT_INVENTORY_MISMATCH');
        names.add(component.name);
    }
    const kinds = value.components.map(item => item.kind);
    for (const kind of Object.values(LOGICAL_COMPONENTS))
        ensure(kinds.filter(item => item === kind).length === 1, 'COMPONENT_INVENTORY_MISMATCH');
    ensure(kinds.filter(kind => kind === 'storage-object').length === Number(value.storage.objectCount), 'COMPONENT_INVENTORY_MISMATCH');
    ensure(/** @type {EncryptedComponent} */ (value.manifest).name === 'manifest.bin' && /** @type {EncryptedComponent} */ (value.manifest).kind === 'storage-manifest', 'COMPONENT_INVENTORY_MISMATCH');
    return /** @type {RecoveryDescriptor} */ ( /** @type {unknown} */(value));
}
/** @param {{directory:string,repositoryRoot:string,expectedDescriptorSha256:string}} options */
export async function readRecoveryDescriptor({ directory, repositoryRoot, expectedDescriptorSha256 }) {
    await assertPrivatePath(join(directory, 'backup-set.json'), repositoryRoot);
    ensure(HASH.test(expectedDescriptorSha256), 'DESCRIPTOR_HASH_REQUIRED');
    try {
        const bytes = await readPrivate(join(directory, 'backup-set.json'), 1048576);
        ensure(sha256(bytes) === expectedDescriptorSha256, 'DESCRIPTOR_HASH_MISMATCH');
        return validateRecoveryDescriptor(JSON.parse(bytes.toString('utf8')));
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('RECOVERY_DESCRIPTOR_UNREADABLE');
    }
}
/** @param {string} directory @param {RecoveryDescriptor} descriptor @param {Buffer} key */
async function decryptInventory(directory, descriptor, key) {
    /** @type {Map<string,Buffer>} */ const decoded = new Map();
    let inventoryBytes;
    try {
        const expectedFiles = ['backup-set.json', descriptor.manifest.name, ...descriptor.components.map(c => c.name)].sort();
        ensure(canonicalJson((await readdir(directory)).sort()) === canonicalJson(expectedFiles), 'COMPONENT_INVENTORY_MISMATCH');
        const encryptedManifest = await readPrivate(join(directory, descriptor.manifest.name));
        ensure(encryptedManifest.length === descriptor.manifest.bytes && sha256(encryptedManifest) === descriptor.manifest.ciphertextSha256, 'CIPHERTEXT_INTEGRITY_FAILED');
        inventoryBytes = decryptBuffer(encryptedManifest, key);
        const raw = JSON.parse(inventoryBytes.toString('utf8'));
        shape(raw, ['contextSha256', 'components', 'storageManifest']);
        ensure(raw.contextSha256 === sha256(canonicalJson(descriptorContext(descriptor))), 'MANIFEST_CONTEXT_MISMATCH');
        ensure(Array.isArray(raw.components) && raw.components.length === descriptor.components.length, 'COMPONENT_INVENTORY_MISMATCH');
        const storageManifest = validateStorageManifest(raw.storageManifest, descriptor.storage.objectCount);
        const summary = storageSummary(storageManifest);
        ensure(Object.entries(summary).every(([k, v]) => descriptor.storage[ /** @type {keyof typeof summary} */(k)] === v), 'STORAGE_MANIFEST_MISMATCH');
        /** @type {PrivateInventory} */ const inventory = /** @type {PrivateInventory} */ ( /** @type {unknown} */(raw));
        const required = new Set([...Object.keys(LOGICAL_COMPONENTS), ...storageManifest.files.map(file => file.backupName)]);
        let bytes = 0;
        for (const component of descriptor.components) {
            const matches = inventory.components.filter(item => item.name === component.name);
            ensure(matches.length === 1, 'COMPONENT_INVENTORY_MISMATCH');
            const item = matches[0];
            shape(item, ['name', 'inputName', 'plaintextSha256', 'bytes']);
            ensure(required.delete(item.inputName), 'COMPONENT_INVENTORY_MISMATCH');
            matching(item.plaintextSha256, HASH);
            ensure(Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= MAX_COMPONENT_BYTES, 'COMPONENT_INVENTORY_MISMATCH');
            const expectedKind = LOGICAL_COMPONENTS[item.inputName] ?? 'storage-object';
            ensure(component.kind === expectedKind, 'COMPONENT_INVENTORY_MISMATCH');
            const sealed = await readPrivate(join(directory, component.name));
            ensure(sealed.length === component.bytes && sha256(sealed) === component.ciphertextSha256, 'CIPHERTEXT_INTEGRITY_FAILED');
            const plain = decryptBuffer(sealed, key);
            decoded.set(item.inputName, plain);
            bytes += plain.length;
            ensure(plain.length === item.bytes && sha256(plain) === item.plaintextSha256 && bytes <= MAX_TOTAL_BYTES, 'PLAINTEXT_INTEGRITY_FAILED');
            const file = storageManifest.files.find(file => file.backupName === item.inputName);
            if (file)
                ensure(plain.length === file.bytes && sha256(plain) === file.sha256, 'STORAGE_OBJECT_MISMATCH');
        }
        ensure(required.size === 0, 'COMPONENT_INVENTORY_MISMATCH');
        return { components: decoded, storageManifest };
    }
    catch (error) {
        for (const plain of decoded.values())
            plain.fill(0);
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('DECRYPTION_INTEGRITY_FAILED');
    }
    finally {
        inventoryBytes?.fill(0);
    }
}
/** Build and verify ciphertext in a private temporary directory, then atomically publish a descriptor commit marker. Never overwrite a completed or partial foreign destination.
 * @param {{destination:string,repositoryRoot:string,metadata:RecoveryMetadata,components:Map<string,Buffer>,storageManifest:StorageManifest,checkpointBefore:RecoveryCheckpoint,checkpointAfter:RecoveryCheckpoint,publicKey:import('node:crypto').KeyLike}} input
 */
export async function createRecoverySet(input) {
    const { destination, repositoryRoot } = input;
    await assertPrivatePath(destination, repositoryRoot);
    const metadata = metadataValue(input.metadata);
    const checkpoint = checkpointValue(input.checkpointBefore);
    ensure(canonicalJson(checkpoint) === canonicalJson(checkpointValue(input.checkpointAfter)), 'CHECKPOINT_DRIFT');
    let storageManifest;
    try {
        storageManifest = validateStorageManifest(input.storageManifest, input.storageManifest?.files?.length);
    }
    catch {
        throw new OperationsError('STORAGE_MANIFEST_INVALID');
    }
    const required = [...Object.keys(LOGICAL_COMPONENTS), ...storageManifest.files.map(file => file.backupName)];
    ensure(input.components instanceof Map && canonicalJson([...input.components.keys()].sort()) === canonicalJson(required.sort()), 'COMPONENT_INVENTORY_MISMATCH');
    let total = 0;
    for (const [name, plain] of input.components) {
        ensure(Buffer.isBuffer(plain) && plain.length > 0 && plain.length <= MAX_COMPONENT_BYTES, 'COMPONENT_INVENTORY_MISMATCH');
        total += plain.length;
        const object = storageManifest.files.find(file => file.backupName === name);
        if (object)
            ensure(object.bytes === plain.length && object.sha256 === sha256(plain), 'STORAGE_OBJECT_MISMATCH');
    }
    ensure(total <= MAX_TOTAL_BYTES, 'RECOVERY_SIZE_LIMIT');
    const temporary = join(dirname(destination), `.issue29-${metadata.backupSetId}-${randomUUID()}.partial`);
    let key;
    let ownsDestination = false;
    let published = false;
    try {
        const publicKey = ownerPublicKey(input.publicKey);
        const publicDer = publicKey.export({ type: 'spki', format: 'der' });
        key = randomBytes(32);
        const wrappedKey = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
        await mkdir(temporary, { mode: 0o700 });
        /** @type {RecoveryDescriptor} */ const descriptor = { format: 'aromatika-coordinated-recovery-set', version: 1, metadata, checkpoint, storage: { ...storageSummary(storageManifest), finalizedRowsetSha256: checkpoint.finalizedRowsetSha256 }, encryption: { cipher: 'aes-256-gcm', wrap: 'rsa-oaep-sha256', keyId: sha256(publicDer), publicKey: publicDer.toString('base64'), wrappedKey: wrappedKey.toString('base64') }, retention: { days: 35, expiresAt: new Date(Date.parse(metadata.finishedAt) + 35 * 86400000).toISOString() }, components: [], manifest: { name: 'manifest.bin', kind: 'storage-manifest', ciphertextSha256: '', bytes: 0 } };
        /** @type {PrivateComponent[]} */ const privateComponents = [];
        for (const [index, name] of required.entries()) {
            const plain = /** @type {Buffer} */ (input.components.get(name));
            const sealed = encryptBuffer(plain, key);
            const filename = `component-${String(index).padStart(6, '0')}.bin`;
            await writePrivate(join(temporary, filename), sealed);
            descriptor.components.push({ name: filename, kind: LOGICAL_COMPONENTS[name] ?? 'storage-object', ciphertextSha256: sha256(sealed), bytes: sealed.length });
            privateComponents.push({ name: filename, inputName: name, plaintextSha256: sha256(plain), bytes: plain.length });
        }
        const privateManifest = Buffer.from(canonicalJson({ contextSha256: sha256(canonicalJson(descriptorContext(descriptor))), components: privateComponents, storageManifest }));
        let sealedManifest;
        try {
            sealedManifest = encryptBuffer(privateManifest, key);
        }
        finally {
            privateManifest.fill(0);
        }
        descriptor.manifest = { name: 'manifest.bin', kind: 'storage-manifest', ciphertextSha256: sha256(sealedManifest), bytes: sealedManifest.length };
        await writePrivate(join(temporary, 'manifest.bin'), sealedManifest);
        const descriptorBytes = Buffer.from(`${canonicalJson(validateRecoveryDescriptor(descriptor))}\n`);
        ensure(descriptorBytes.length <= 1048576, 'RECOVERY_DESCRIPTOR_SIZE_LIMIT');
        await writePrivate(join(temporary, 'backup-set.json'), descriptorBytes);
        const verified = await decryptInventory(temporary, descriptor, key);
        for (const plain of verified.components.values())
            plain.fill(0);
        await mkdir(destination, { mode: 0o700 });
        ownsDestination = true;
        // Ciphertext links are not a published recovery set until this descriptor is linked last.
        for (const name of [...descriptor.components.map(item => item.name), 'manifest.bin'])
            await link(join(temporary, name), join(destination, name));
        await rm(temporary, { recursive: true }); // Remove extra links before readers enforce nlink=1.
        await writePrivate(join(destination, '.descriptor.pending'), descriptorBytes);
        await rename(join(destination, '.descriptor.pending'), join(destination, 'backup-set.json'));
        published = true;
        const dir = await open(destination, fsConstants.O_RDONLY);
        try {
            await dir.sync();
        }
        finally {
            await dir.close();
        }
        return { descriptor, descriptorSha256: sha256(descriptorBytes), backupSetId: metadata.backupSetId, publication: 'complete' };
    }
    catch (error) {
        if (ownsDestination && !published)
            await rm(destination, { recursive: true, force: true });
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('RECOVERY_PUBLICATION_FAILED');
    }
    finally {
        key?.fill(0);
        await rm(temporary, { recursive: true, force: true });
    }
}
/** Run one bounded restore consumer without returning decrypted bytes to CLI output. Buffers are wiped after the callback, including on errors. @template T @param {VerifyOptions} options @param {(value:{descriptor:RecoveryDescriptor,components:Map<string,Buffer>,storageManifest:StorageManifest})=>Promise<T>} consume @returns {Promise<T>} */
export async function withVerifiedRecoverySet(options, consume) {
    const descriptor = await readRecoveryDescriptor(options);
    let key;
    let contents;
    try {
        const privateKey = options.privateKey instanceof KeyObject ? options.privateKey : createPrivateKey(options.privateKey);
        ensure(privateKey.type === 'private', 'OWNER_PRIVATE_KEY_REQUIRED');
        const publicKey = ownerPublicKey(privateKey);
        ensure(sha256(publicKey.export({ type: 'spki', format: 'der' })) === descriptor.encryption.keyId, 'OWNER_PRIVATE_KEY_MISMATCH');
        key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(descriptor.encryption.wrappedKey, 'base64'));
        ensure(key.length === 32, 'WRAPPED_KEY_INVALID');
        contents = await decryptInventory(options.directory, descriptor, key);
        return await consume({ descriptor, ...contents });
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('DECRYPTION_INTEGRITY_FAILED');
    }
    finally {
        key?.fill(0);
        if (contents)
            for (const plain of contents.components.values())
                plain.fill(0);
    }
}
/** Only sanitized verification proof is returned. @param {VerifyOptions} options */
export async function verifyRecoverySet(options) { return withVerifiedRecoverySet(options, async ({ descriptor }) => ({ backupSetId: descriptor.metadata.backupSetId, descriptorSha256: options.expectedDescriptorSha256, decryptionVerified: true, componentCount: descriptor.components.length, objectCount: descriptor.storage.objectCount, totalBytes: descriptor.storage.totalBytes, keyId: descriptor.encryption.keyId, checkpointSha256: sha256(canonicalJson(descriptor.checkpoint)) })); }
/** Hash verification is possible without private-key custody; it is not proof of decryption or hosted retention. @param {{directory:string,repositoryRoot:string,expectedDescriptorSha256:string}} options */
export async function verifyEncryptedRecoverySet(options) {
    const descriptor = await readRecoveryDescriptor(options);
    try {
        const files = [...descriptor.components, descriptor.manifest];
        ensure(canonicalJson((await readdir(options.directory)).sort()) === canonicalJson(['backup-set.json', ...files.map(item => item.name)].sort()), 'COMPONENT_INVENTORY_MISMATCH');
        for (const item of files) {
            const bytes = await readPrivate(join(options.directory, item.name));
            ensure(bytes.length === item.bytes && sha256(bytes) === item.ciphertextSha256, 'CIPHERTEXT_INTEGRITY_FAILED');
        }
        return { descriptor, descriptorSha256: options.expectedDescriptorSha256, ciphertextVerified: true };
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('CIPHERTEXT_VERIFICATION_FAILED');
    }
}
/** Copy ciphertext only to a second exact private destination; no private key is accepted. @param {{directory:string,destination:string,repositoryRoot:string,expectedDescriptorSha256:string}} options */
export async function copyEncryptedRecoverySet(options) {
    const { descriptor } = await verifyEncryptedRecoverySet(options);
    await assertPrivatePath(options.destination, options.repositoryRoot);
    let owned = false;
    let completed = false;
    try {
        await mkdir(options.destination, { mode: 0o700 });
        owned = true;
        for (const item of [...descriptor.components, descriptor.manifest]) {
            const bytes = await readPrivate(join(options.directory, item.name));
            ensure(bytes.length === item.bytes && sha256(bytes) === item.ciphertextSha256, 'CIPHERTEXT_INTEGRITY_FAILED');
            await writePrivate(join(options.destination, item.name), bytes);
        }
        const descriptorBytes = await readPrivate(join(options.directory, 'backup-set.json'), 1048576);
        ensure(sha256(descriptorBytes) === options.expectedDescriptorSha256, 'DESCRIPTOR_HASH_MISMATCH');
        await writePrivate(join(options.destination, '.descriptor.pending'), descriptorBytes);
        await rename(join(options.destination, '.descriptor.pending'), join(options.destination, 'backup-set.json'));
        completed = true;
        const dir = await open(options.destination, fsConstants.O_RDONLY);
        try {
            await dir.sync();
        }
        finally {
            await dir.close();
        }
        await verifyEncryptedRecoverySet({ ...options, directory: options.destination });
        return { descriptorSha256: options.expectedDescriptorSha256, backupSetId: descriptor.metadata.backupSetId, encryptedCopyVerified: true };
    }
    catch (error) {
        if (owned && !completed)
            await rm(options.destination, { recursive: true, force: true });
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('ENCRYPTED_COPY_FAILED');
    }
}
/** Timestamps come from actual proof, not from estimated job durations. Values are milliseconds. @param {{recoveryPointAt:string,authorizedAt:string,databaseIntegrityAt:string,storageStartedAt:string,storageIntegrityAt:string,applicationStartedAt:string,allIntegrityAt:string}} input */
export function measureRecovery(input) {
    const times = [input.recoveryPointAt, input.authorizedAt, input.databaseIntegrityAt, input.storageStartedAt, input.storageIntegrityAt, input.applicationStartedAt, input.allIntegrityAt];
    ensure(times.every(value => INSTANT.test(value) && Number.isFinite(Date.parse(value))), 'RECOVERY_TIMING_INVALID');
    const [point, start, database, storageStart, storage, applicationStart, end] = times.map(Date.parse);
    ensure(point <= start && start <= database && database <= storageStart && storageStart <= storage && storage <= applicationStart && applicationStart <= end, 'RECOVERY_TIMING_INVALID');
    return { recoveryPointAgeAtStartMs: start - point, databaseRecoveryElapsedMs: database - start, storageRecoveryElapsedMs: storage - storageStart, applicationRecoveryElapsedMs: end - applicationStart, fullRecoveryElapsedMs: end - start, withinTargets: start - point <= 86400000 && end - start <= 7200000 };
}
