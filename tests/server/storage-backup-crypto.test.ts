import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as backupCrypto from '../../scripts/storage-backup-crypto.mjs';

const {
  createDescriptor,
  decryptBuffer,
  deriveBackupKey,
  encryptBuffer,
  sha256,
  validateDescriptor,
  validateManifest
} = backupCrypto;

describe('encrypted finalized-image backups', () => {
  it('round-trips content through authenticated encryption', () => {
    const key = deriveBackupKey('a deliberately long backup passphrase', randomBytes(32));
    const original = Buffer.from('binary image fixture\0\u0001', 'utf8');
    const encrypted = encryptBuffer(original, key);

    expect(encrypted.equals(original)).toBe(false);
    expect(decryptBuffer(encrypted, key)).toEqual(original);
    expect(sha256(decryptBuffer(encrypted, key))).toBe(sha256(original));
  });

  it('rejects tampering through the GCM authentication tag', () => {
    const key = deriveBackupKey('a deliberately long backup passphrase', randomBytes(32));
    const encrypted = encryptBuffer(Buffer.from('sensitive file'), key);
    encrypted[encrypted.length - 1] ^= 1;

    expect(() => decryptBuffer(encrypted, key)).toThrow();
  });

  it('validates the versioned public descriptor', () => {
    const descriptor = createDescriptor(randomBytes(32), 4);
    expect(() => validateDescriptor(descriptor)).not.toThrow();
    expect(() => validateDescriptor({ ...descriptor, version: 999 })).toThrow(
      'Unsupported storage backup format'
    );
  });

  it('rejects manifest path traversal, duplicate paths, and count drift', () => {
    const validFile = {
      path: `${'1'.repeat(8)}-${'1'.repeat(4)}-4111-8111-${'1'.repeat(12)}/${'2'.repeat(8)}-${'2'.repeat(4)}-4222-8222-${'2'.repeat(12)}/${'3'.repeat(8)}-${'3'.repeat(4)}-4333-8333-${'3'.repeat(12)}.jpg`,
      backupName: `${'a'.repeat(64)}.bin`,
      sha256: 'b'.repeat(64),
      bytes: 128,
      contentType: 'image/jpeg'
    };
    expect(validateManifest({ bucket: 'listing-images', files: [validFile] }, 1).files).toHaveLength(
      1
    );
    expect(() =>
      validateManifest(
        { bucket: 'listing-images', files: [{ ...validFile, path: '../escape.jpg' }] },
        1
      )
    ).toThrow('Invalid storage backup manifest entry');
    expect(() =>
      validateManifest(
        {
          bucket: 'listing-images',
          files: [validFile, { ...validFile, backupName: `${'c'.repeat(64)}.bin` }]
        },
        2
      )
    ).toThrow('Invalid storage backup manifest entry');
    expect(() =>
      validateManifest({ bucket: 'listing-images', files: [validFile] }, 2)
    ).toThrow('Backup manifest file count mismatch');
  });
});
