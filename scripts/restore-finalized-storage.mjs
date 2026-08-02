import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  decryptBuffer,
  deriveBackupKey,
  sha256,
  validateDescriptor,
  validateManifest
} from './storage-backup-crypto.mjs';

const dryRun = process.argv.includes('--dry-run');
const resume = process.argv.includes('--resume');
if (!dryRun && !process.argv.includes('--confirm-restore')) {
  throw new Error('Restore is intentionally guarded; pass --confirm-restore after checking the target project');
}

const directoryArgument = process.argv.find((argument) => argument.startsWith('--backup='));
if (!directoryArgument) throw new Error('Pass the backup directory as --backup=/absolute/path');

const projectUrl = process.env.PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const passphrase = process.env.BACKUP_ENCRYPTION_KEY;
const expectedProjectRef = process.env.EXPECTED_SUPABASE_PROJECT_REF?.trim();
if (!projectUrl || !secret || !passphrase || !expectedProjectRef) {
  throw new Error('PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, BACKUP_ENCRYPTION_KEY and EXPECTED_SUPABASE_PROJECT_REF are required');
}
const targetProjectRef = new URL(projectUrl).hostname.split('.')[0];
if (targetProjectRef !== expectedProjectRef || !/^[a-z]{20}$/u.test(targetProjectRef)) {
  throw new Error('Restore target does not match EXPECTED_SUPABASE_PROJECT_REF');
}

const backupDirectory = resolve(directoryArgument.slice('--backup='.length));
const descriptor = JSON.parse(await readFile(resolve(backupDirectory, 'backup.json'), 'utf8'));
validateDescriptor(descriptor);
const key = deriveBackupKey(passphrase, Buffer.from(descriptor.salt, 'base64'));
const manifest = JSON.parse(
  decryptBuffer(await readFile(resolve(backupDirectory, 'manifest.enc')), key).toString('utf8')
);
const validatedManifest = validateManifest(manifest, descriptor.files);
if (
  descriptor.bucket !== validatedManifest.bucket ||
  typeof descriptor.sourceProjectRef !== 'string' ||
  !/^[a-z]{20}$/u.test(descriptor.sourceProjectRef) ||
  typeof descriptor.databaseCheckpoint !== 'string' ||
  !/^[a-f0-9]{64}$/u.test(descriptor.databaseCheckpoint)
) {
  throw new Error('Backup descriptor is missing source identity or database checkpoint');
}

const client = createClient(projectUrl, secret, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function listBucketFiles(prefix = '') {
  const paths = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(validatedManifest.bucket).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: 'name', order: 'asc' }
    });
    if (error) throw new Error(`Target Storage inventory failed at ${prefix || '/'}: ${error.message}`);
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id || entry.metadata) paths.push(path);
      else paths.push(...await listBucketFiles(path));
    }
    if ((data ?? []).length < 1000) break;
  }
  return paths;
}

const manifestPaths = new Set(validatedManifest.files.map((file) => file.path));
const existingPaths = new Set(await listBucketFiles());
if (existingPaths.size && !resume) {
  throw new Error('Restore target bucket is not empty; use --resume only for a verified interrupted restore');
}
for (const path of existingPaths) {
  if (!manifestPaths.has(path)) throw new Error(`Restore target contains an unrelated object: ${path}`);
}

const targetRows = [];
for (let offset = 0; ; offset += 500) {
  const { data, error } = await client
    .from('listing_photos')
    .select('id,storage_path,content_hash,byte_size,sanitized_at')
    .not('sanitized_at', 'is', null)
    .order('id')
    .range(offset, offset + 499);
  if (error) throw new Error(`Target database inventory failed: ${error.message}`);
  targetRows.push(...data);
  if (data.length < 500) break;
}
if (
  targetRows.length !== manifestPaths.size ||
  targetRows.some((row) => !manifestPaths.has(row.storage_path))
) {
  throw new Error('Target database finalized-photo inventory does not match the backup manifest');
}
const targetDatabaseCheckpoint = sha256(JSON.stringify(targetRows.map((photo) => ({
  id: photo.id,
  path: photo.storage_path,
  hash: photo.content_hash,
  bytes: photo.byte_size,
  sanitizedAt: photo.sanitized_at
}))));
if (targetDatabaseCheckpoint !== descriptor.databaseCheckpoint) {
  throw new Error('Target database checkpoint does not match the coordinated backup');
}

if (dryRun) {
  console.log(
    `Restore dry-run passed for ${targetProjectRef}: ${validatedManifest.files.length} objects, ${existingPaths.size} resumable`
  );
  process.exit(0);
}

const objectDirectory = resolve(backupDirectory, 'objects');
let restored = 0;
let skipped = 0;
for (const file of validatedManifest.files) {
  const sealedPath = resolve(objectDirectory, file.backupName);
  const localRelativePath = relative(objectDirectory, sealedPath);
  if (
    localRelativePath.startsWith('..') ||
    localRelativePath === '' ||
    localRelativePath.includes('/') ||
    localRelativePath.includes('\\')
  ) {
    throw new Error(`Backup object path escapes its container: ${file.backupName}`);
  }
  const sealed = await readFile(sealedPath);
  const plain = decryptBuffer(sealed, key);
  if (plain.length !== file.bytes || sha256(plain) !== file.sha256) {
    throw new Error(`Integrity check failed for ${file.path}`);
  }

  if (existingPaths.has(file.path)) {
    const { data, error } = await client.storage.from(validatedManifest.bucket).download(file.path);
    if (error || !data) throw new Error(`Unable to verify resumable object ${file.path}`);
    const existing = Buffer.from(await data.arrayBuffer());
    if (existing.length !== file.bytes || sha256(existing) !== file.sha256) {
      throw new Error(`Existing restore object does not match the manifest: ${file.path}`);
    }
    skipped += 1;
    continue;
  }

  const { error } = await client.storage.from(validatedManifest.bucket).upload(file.path, plain, {
    contentType: file.contentType,
    upsert: false
  });
  if (error) throw new Error(`Restore failed for ${file.path}: ${error.message}`);
  const { data: verifiedBlob, error: verifyError } = await client.storage
    .from(validatedManifest.bucket)
    .download(file.path);
  if (verifyError || !verifiedBlob) throw new Error(`Post-upload verification failed for ${file.path}`);
  const verifiedBytes = Buffer.from(await verifiedBlob.arrayBuffer());
  if (verifiedBytes.length !== file.bytes || sha256(verifiedBytes) !== file.sha256) {
    throw new Error(`Post-upload integrity mismatch for ${file.path}`);
  }
  restored += 1;
}

const finalPaths = new Set(await listBucketFiles());
if (
  finalPaths.size !== manifestPaths.size ||
  [...manifestPaths].some((path) => !finalPaths.has(path))
) {
  throw new Error('Final target Storage inventory does not match the backup manifest');
}
console.log(
  `Restored ${restored}, resumed ${skipped}, and verified ${finalPaths.size} finalized objects to ${targetProjectRef}`
);
