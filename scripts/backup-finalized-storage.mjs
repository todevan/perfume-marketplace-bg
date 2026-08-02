import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createDescriptor, deriveBackupKey, encryptBuffer, sha256 } from './storage-backup-crypto.mjs';

const projectUrl = process.env.PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const passphrase = process.env.BACKUP_ENCRYPTION_KEY;
const bucket = process.env.FINALIZED_IMAGE_BUCKET || 'listing-images';
const backupRoot = resolve(process.env.BACKUP_DIRECTORY || '.backups');
const expectedProjectRef = process.env.EXPECTED_SUPABASE_PROJECT_REF?.trim();

if (!projectUrl || !secret || !passphrase || !expectedProjectRef) {
  throw new Error('PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, BACKUP_ENCRYPTION_KEY and EXPECTED_SUPABASE_PROJECT_REF are required');
}
const projectRef = new URL(projectUrl).hostname.split('.')[0];
if (projectRef !== expectedProjectRef || !/^[a-z]{20}$/u.test(projectRef)) {
  throw new Error('PUBLIC_SUPABASE_URL does not match EXPECTED_SUPABASE_PROJECT_REF');
}

const client = createClient(projectUrl, secret, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputDirectory = resolve(backupRoot, `storage-${timestamp}`);
const objectDirectory = resolve(outputDirectory, 'objects');
await mkdir(objectDirectory, { recursive: true });

const photos = [];
for (let offset = 0; ; offset += 500) {
  const { data, error } = await client
    .from('listing_photos')
    .select('id,storage_path,content_hash,mime_type,byte_size,sanitized_at')
    .not('sanitized_at', 'is', null)
    .order('id')
    .range(offset, offset + 499);
  if (error) throw error;
  photos.push(...data);
  if (data.length < 500) break;
}
const databaseCheckpoint = sha256(JSON.stringify(photos.map((photo) => ({
  id: photo.id,
  path: photo.storage_path,
  hash: photo.content_hash,
  bytes: photo.byte_size,
  sanitizedAt: photo.sanitized_at
}))));

async function listBucketFiles(prefix = '') {
  const paths = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: 'name', order: 'asc' }
    });
    if (error) throw new Error(`Storage inventory failed at ${prefix || '/'}: ${error.message}`);
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id || entry.metadata) paths.push(path);
      else paths.push(...await listBucketFiles(path));
    }
    if ((data ?? []).length < 1000) break;
  }
  return paths;
}

const databasePaths = new Set(photos.map((photo) => photo.storage_path));
const storagePaths = new Set(await listBucketFiles());
const missingObjects = [...databasePaths].filter((path) => !storagePaths.has(path));
const orphanObjects = [...storagePaths].filter((path) => !databasePaths.has(path));
if (missingObjects.length || orphanObjects.length) {
  throw new Error(
    `Finalized Storage is not reconciled (missing=${missingObjects.length}, orphan=${orphanObjects.length})`
  );
}

const salt = randomBytes(32);
const key = deriveBackupKey(passphrase, salt);
const manifest = { bucket, files: [] };

for (const photo of photos) {
  const { data, error } = await client.storage.from(bucket).download(photo.storage_path);
  if (error) throw new Error(`Download failed for ${photo.storage_path}: ${error.message}`);

  const plain = Buffer.from(await data.arrayBuffer());
  const digest = sha256(plain);
  if (photo.content_hash && digest !== photo.content_hash) {
    throw new Error(`Database hash mismatch for ${photo.storage_path}`);
  }

  const backupName = `${sha256(photo.storage_path)}.bin`;
  await writeFile(resolve(objectDirectory, backupName), encryptBuffer(plain, key), { flag: 'wx' });
  manifest.files.push({
    path: photo.storage_path,
    backupName,
    sha256: digest,
    bytes: plain.length,
    contentType: photo.mime_type
  });
}

const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
await writeFile(resolve(outputDirectory, 'manifest.enc'), encryptBuffer(manifestBytes, key), { flag: 'wx' });
await writeFile(
  resolve(outputDirectory, 'backup.json'),
  `${JSON.stringify(createDescriptor(salt, manifest.files.length, {
    sourceProjectRef: projectRef,
    bucket,
    databaseCheckpoint
  }), null, 2)}\n`,
  { flag: 'wx' }
);

const verificationRows = [];
for (let offset = 0; ; offset += 500) {
  const { data, error } = await client
    .from('listing_photos')
    .select('id,storage_path,content_hash,mime_type,byte_size,sanitized_at')
    .not('sanitized_at', 'is', null)
    .order('id')
    .range(offset, offset + 499);
  if (error) throw error;
  verificationRows.push(...data);
  if (data.length < 500) break;
}
const verificationCheckpoint = sha256(JSON.stringify(verificationRows.map((photo) => ({
  id: photo.id,
  path: photo.storage_path,
  hash: photo.content_hash,
  bytes: photo.byte_size,
  sanitizedAt: photo.sanitized_at
}))));
if (verificationCheckpoint !== databaseCheckpoint) {
  throw new Error('Finalized photo database changed during backup; discard this checkpoint');
}

console.log(`Encrypted backup created: ${outputDirectory}`);
console.log(`Finalized objects: ${manifest.files.length}`);
