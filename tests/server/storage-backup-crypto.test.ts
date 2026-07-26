import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as backupCrypto from '../../scripts/storage-backup-crypto.mjs';

const {
  createDescriptor,
  decryptBuffer,
  deriveBackupKey,
  encryptBuffer,
  sha256,
  validateDescriptor
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
});
