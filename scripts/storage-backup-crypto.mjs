import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';

const FORMAT_VERSION = 1;

/** @param {string} passphrase @param {Buffer} salt @returns {Buffer} */
export function deriveBackupKey(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 32) {
    throw new Error('BACKUP_ENCRYPTION_KEY must contain at least 32 characters');
  }
  return scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/** @param {Buffer} plain @param {Buffer} key @returns {Buffer} */
export function encryptBuffer(plain, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

/** @param {Buffer} sealed @param {Buffer} key @returns {Buffer} */
export function decryptBuffer(sealed, key) {
  if (sealed.length < 29) throw new Error('Encrypted backup object is truncated');
  const nonce = sealed.subarray(0, 12);
  const tag = sealed.subarray(12, 28);
  const ciphertext = sealed.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** @param {import('node:crypto').BinaryLike} value @returns {string} */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {Buffer} salt @param {number} fileCount @param {Record<string, unknown>} [metadata] */
export function createDescriptor(salt, fileCount, metadata = {}) {
  return {
    format: 'perfume-marketplace-storage-backup',
    version: FORMAT_VERSION,
    cipher: 'aes-256-gcm',
    kdf: 'scrypt-N32768-r8-p1',
    salt: salt.toString('base64'),
    files: fileCount,
    createdAt: new Date().toISOString(),
    ...metadata
  };
}

/** @param {unknown} descriptor */
export function validateDescriptor(descriptor) {
  const value =
    descriptor && typeof descriptor === 'object'
      ? /** @type {Record<string, unknown>} */ (descriptor)
      : {};
  if (
    value.format !== 'perfume-marketplace-storage-backup' ||
    value.version !== FORMAT_VERSION ||
    value.cipher !== 'aes-256-gcm'
  ) {
    throw new Error('Unsupported storage backup format');
  }
  if (
    value.kdf !== 'scrypt-N32768-r8-p1' ||
    !Number.isInteger(value.files) ||
    Number(value.files) < 0 ||
    typeof value.createdAt !== 'string' ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    typeof value.salt !== 'string' ||
    Buffer.from(value.salt, 'base64').length !== 32
  ) {
    throw new Error('Invalid storage backup descriptor');
  }
}

/** @param {unknown} manifest @param {number} expectedFiles */
export function validateManifest(manifest, expectedFiles) {
  const value =
    manifest && typeof manifest === 'object'
      ? /** @type {Record<string, unknown>} */ (manifest)
      : {};
  if (value.bucket !== 'listing-images' || !Array.isArray(value.files)) {
    throw new Error('Invalid storage backup manifest');
  }
  if (value.files.length !== expectedFiles) {
    throw new Error('Backup manifest file count mismatch');
  }
  const paths = new Set();
  const backupNames = new Set();
  for (const rawFile of value.files) {
    const file =
      rawFile && typeof rawFile === 'object'
        ? /** @type {Record<string, unknown>} */ (rawFile)
        : {};
    if (
      typeof file.path !== 'string' ||
      !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|webp|avif)$/iu.test(file.path) ||
      typeof file.backupName !== 'string' ||
      !/^[a-f0-9]{64}\.bin$/u.test(file.backupName) ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      !Number.isSafeInteger(file.bytes) ||
      Number(file.bytes) < 1 ||
      !['image/jpeg', 'image/webp', 'image/avif'].includes(String(file.contentType)) ||
      paths.has(file.path) ||
      backupNames.has(file.backupName)
    ) {
      throw new Error('Invalid storage backup manifest entry');
    }
    paths.add(file.path);
    backupNames.add(file.backupName);
  }
  return /** @type {{bucket: 'listing-images'; files: Array<{path:string; backupName:string; sha256:string; bytes:number; contentType:string}>}} */ (value);
}
