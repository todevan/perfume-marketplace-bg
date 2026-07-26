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

if (!projectUrl || !secret || !passphrase) {
  throw new Error('PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and BACKUP_ENCRYPTION_KEY are required');
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
  `${JSON.stringify(createDescriptor(salt, manifest.files.length), null, 2)}\n`,
  { flag: 'wx' }
);

console.log(`Encrypted backup created: ${outputDirectory}`);
console.log(`Finalized objects: ${manifest.files.length}`);
