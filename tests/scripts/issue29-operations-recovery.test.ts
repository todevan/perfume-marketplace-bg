import { afterEach, describe, expect, test } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecoverySet, verifyRecoverySet } from '../../scripts/issue29-operations/recovery-set.mjs';
import { sha256 } from '../../scripts/storage-backup-crypto.mjs';
const keys = generateKeyPairSync('rsa', { modulusLength: 3072 });
const now = '2026-09-05T12:00:00.000Z';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function destination() { const dir = await mkdtemp(join(tmpdir(), 'issue29-recovery-')); await chmod(dir, 0o700); dirs.push(dir); return join(dir, 'recovery-set'); }
function backupFixture() {
    const object = Buffer.from('synthetic finalized image bytes');
    const path = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.webp';
    const backupName = `${sha256(path)}.bin`;
    const components = new Map(['roles.sql', 'schema.sql', 'data.sql', 'migration-history.sql', 'auth-recovery.sql', 'managed-schema.sql', 'platform-inventory.json'].map(name => [name, Buffer.from(`synthetic ${name}`)]));
    components.set(backupName, object);
    const storageManifest = { bucket: 'listing-images' as const, files: [{ path, backupName, sha256: sha256(object), bytes: object.length, contentType: 'image/webp' }] };
    const metadata = { backupSetId: '29292929-2929-4292-8292-292929292929', source: { environmentAlias: 'synthetic-staging', organizationId: 'owned-org', projectRef: 'abcdefghijklmnopqrst', region: 'eu-central-1', classification: 'synthetic-owner-controlled' }, release: { commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), workerVersion: 'version-29' }, startedAt: '2026-09-05T11:59:00.000Z', finishedAt: now, tools: { supabaseCli: '2.109.1', postgres: '17.6', operator: 'issue29-v1' }, migration: { count: 123, sha256: 'c'.repeat(64) }, destinationAlias: 'github-encrypted', exclusions: ['source-sessions', 'api-keys'], manualReconstruction: ['auth-settings', 'worker-secrets'] };
    const checkpointBefore = { snapshotId: '00000003-0000000D-1', finalizedRowsetSha256: 'd'.repeat(64) };
    return { components, storageManifest, metadata, checkpointBefore, checkpointAfter: { ...checkpointBefore } };
}
describe('coordinated encrypted recovery sets', () => {
    test('publishes only a complete authenticated set recoverable by the owner private key', async () => {
        const directory = await destination();
        const input = backupFixture();
        const created = await createRecoverySet({ ...input, destination: directory, repositoryRoot: process.cwd(), publicKey: keys.publicKey });
        const proof = await verifyRecoverySet({ directory, repositoryRoot: process.cwd(), privateKey: keys.privateKey, expectedDescriptorSha256: created.descriptorSha256 });
        expect(proof).toMatchObject({ decryptionVerified: true, backupSetId: input.metadata.backupSetId, objectCount: 1, componentCount: 8 });
        const descriptorText = await readFile(join(directory, 'backup-set.json'), 'utf8');
        expect(descriptorText).not.toContain(input.storageManifest.files[0].path);
        expect(descriptorText).not.toContain('synthetic roles.sql');
        expect((await readdir(directory)).every(file => file === 'backup-set.json' || file.endsWith('.bin'))).toBe(true);
    });
});
import { withVerifiedRecoverySet } from '../../scripts/issue29-operations/recovery-set.mjs';
describe('recovery-set fail-closed integrity', () => {
    test.each(['missing logical component', 'extra component', 'object omission', 'object bytes', 'duplicate object path', 'checkpoint drift', 'unknown classification'])('rejects %s without publishing a partial set', async (kind) => {
        const directory = await destination();
        const fixture = backupFixture();
        if (kind === 'missing logical component')
            fixture.components.delete('migration-history.sql');
        if (kind === 'extra component')
            fixture.components.set('sessions.sql', Buffer.from('unsafe'));
        if (kind === 'object omission')
            fixture.components.delete(fixture.storageManifest.files[0].backupName);
        if (kind === 'object bytes')
            fixture.components.set(fixture.storageManifest.files[0].backupName, Buffer.from('wrong'));
        if (kind === 'duplicate object path')
            fixture.storageManifest.files.push({ ...fixture.storageManifest.files[0] });
        if (kind === 'checkpoint drift')
            fixture.checkpointAfter.finalizedRowsetSha256 = 'e'.repeat(64);
        if (kind === 'unknown classification')
            fixture.metadata.source.classification = 'unknown';
        await expect(createRecoverySet({ ...fixture, destination: directory, repositoryRoot: process.cwd(), publicKey: keys.publicKey })).rejects.toThrow();
        expect(await readdir(join(directory, '..'))).toEqual([]);
    });
    test.each(['missing ciphertext', 'added file', 'ciphertext corruption', 'manifest corruption', 'descriptor tampering', 'wrapped key tampering'])('rejects %s before exposing any decrypted component', async (kind) => {
        const directory = await destination();
        const fixture = backupFixture();
        const created = await createRecoverySet({ ...fixture, destination: directory, repositoryRoot: process.cwd(), publicKey: keys.publicKey });
        let descriptorSha256 = created.descriptorSha256;
        if (kind === 'missing ciphertext')
            await rm(join(directory, created.descriptor.components[0].name));
        if (kind === 'added file')
            await writeFile(join(directory, 'unexpected.bin'), 'unexpected', { mode: 0o600 });
        if (kind === 'ciphertext corruption' || kind === 'manifest corruption') {
            const path = join(directory, kind === 'manifest corruption' ? 'manifest.bin' : created.descriptor.components[0].name);
            const bytes = await readFile(path);
            bytes[bytes.length - 1] ^= 1;
            await writeFile(path, bytes);
        }
        if (kind === 'descriptor tampering' || kind === 'wrapped key tampering') {
            const changed = structuredClone(created.descriptor);
            if (kind === 'descriptor tampering')
                changed.metadata.release.workerVersion = 'attacker-version';
            else
                changed.encryption.wrappedKey = Buffer.alloc(384).toString('base64');
            const bytes = Buffer.from(JSON.stringify(changed));
            await writeFile(join(directory, 'backup-set.json'), bytes);
            descriptorSha256 = sha256(bytes);
        }
        let exposed = false;
        await expect(withVerifiedRecoverySet({ directory, repositoryRoot: process.cwd(), privateKey: keys.privateKey, expectedDescriptorSha256: descriptorSha256 }, async () => { exposed = true; })).rejects.toThrow();
        expect(exposed).toBe(false);
    });
    test('rejects the wrong owner key and does not overwrite or delete a completed encrypted recovery set', async () => {
        const directory = await destination();
        const fixture = backupFixture();
        const created = await createRecoverySet({ ...fixture, destination: directory, repositoryRoot: process.cwd(), publicKey: keys.publicKey });
        const wrong = generateKeyPairSync('rsa', { modulusLength: 3072 });
        await expect(verifyRecoverySet({ directory, repositoryRoot: process.cwd(), privateKey: wrong.privateKey, expectedDescriptorSha256: created.descriptorSha256 })).rejects.toThrow('OWNER_PRIVATE_KEY_MISMATCH');
        await expect(createRecoverySet({ ...fixture, destination: directory, repositoryRoot: process.cwd(), publicKey: keys.publicKey })).rejects.toThrow();
        expect(sha256(await readFile(join(directory, 'backup-set.json')))).toBe(created.descriptorSha256);
        expect((await readdir(join(directory, '..')))).toEqual(['recovery-set']);
    });
    test('uses a fresh envelope each time and wipes private buffers even when the restore consumer fails', async () => {
        const first = await destination();
        const second = await destination();
        const fixture = backupFixture();
        const a = await createRecoverySet({ ...fixture, destination: first, repositoryRoot: process.cwd(), publicKey: keys.publicKey });
        const b = await createRecoverySet({ ...fixture, destination: second, repositoryRoot: process.cwd(), publicKey: keys.publicKey });
        expect(a.descriptor.encryption.wrappedKey).not.toBe(b.descriptor.encryption.wrappedKey);
        expect(a.descriptor.components[0].ciphertextSha256).not.toBe(b.descriptor.components[0].ciphertextSha256);
        let retained: Buffer | undefined;
        await expect(withVerifiedRecoverySet({ directory: first, repositoryRoot: process.cwd(), privateKey: keys.privateKey, expectedDescriptorSha256: a.descriptorSha256 }, async ({ components }) => { retained = components.get('roles.sql'); expect(retained?.toString()).toBe('synthetic roles.sql'); throw new Error('PRIVATE_PROVIDER_MESSAGE'); })).rejects.toThrow('DECRYPTION_INTEGRITY_FAILED');
        expect(retained?.equals(Buffer.alloc(retained.length))).toBe(true);
    });
});
import { copyEncryptedRecoverySet, measureRecovery } from '../../scripts/issue29-operations/recovery-set.mjs';
describe('recovery retention and timing', () => {
    test('copies and hash-verifies encrypted secondary retention without access to a private key', async () => {
        const directory = await destination();
        const secondary = await destination();
        const fixture = backupFixture();
        const created = await createRecoverySet({ ...fixture, destination: directory, repositoryRoot: process.cwd(), publicKey: keys.publicKey });
        const copied = await copyEncryptedRecoverySet({ directory, destination: secondary, repositoryRoot: process.cwd(), expectedDescriptorSha256: created.descriptorSha256 });
        expect(copied).toMatchObject({ descriptorSha256: created.descriptorSha256, encryptedCopyVerified: true });
        expect((await verifyRecoverySet({ directory: secondary, repositoryRoot: process.cwd(), privateKey: keys.privateKey, expectedDescriptorSha256: created.descriptorSha256 })).decryptionVerified).toBe(true);
    });
});
describe('measured recovery targets', () => {
    test('measures database and full recovery independently and keeps breached RPO/RTO as failures', () => {
        const input = { recoveryPointAt: '2026-09-04T12:00:00.000Z', authorizedAt: '2026-09-05T12:00:00.000Z', databaseIntegrityAt: '2026-09-05T12:30:00.000Z', storageStartedAt: '2026-09-05T12:30:00.000Z', storageIntegrityAt: '2026-09-05T13:00:00.000Z', applicationStartedAt: '2026-09-05T13:00:00.000Z', allIntegrityAt: '2026-09-05T14:00:00.000Z' };
        expect(measureRecovery(input)).toEqual({ recoveryPointAgeAtStartMs: 86400000, databaseRecoveryElapsedMs: 1800000, storageRecoveryElapsedMs: 1800000, applicationRecoveryElapsedMs: 3600000, fullRecoveryElapsedMs: 7200000, withinTargets: true });
        expect(measureRecovery({ ...input, allIntegrityAt: '2026-09-05T14:00:00.001Z' }).withinTargets).toBe(false);
        expect(measureRecovery({ ...input, recoveryPointAt: '2026-09-04T11:59:59.999Z' }).withinTargets).toBe(false);
        expect(() => measureRecovery({ ...input, databaseIntegrityAt: '2026-09-05T11:00:00.000Z' })).toThrow('RECOVERY_TIMING_INVALID');
    });
});
