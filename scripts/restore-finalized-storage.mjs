import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { decryptBuffer, deriveBackupKey, sha256, validateDescriptor } from './storage-backup-crypto.mjs';

if (!process.argv.includes('--confirm-restore')) {
  throw new Error('Restore is intentionally guarded; pass --confirm-restore after checking the target project');
}

const directoryArgument = process.argv.find((argument) => argument.startsWith('--backup='));
if (!directoryArgument) throw new Error('Pass the backup directory as --backup=/absolute/path');

const projectUrl = process.env.PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const passphrase = process.env.BACKUP_ENCRYPTION_KEY;
if (!projectUrl || !secret || !passphrase) {
  throw new Error('PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and BACKUP_ENCRYPTION_KEY are required');
}

const backupDirectory = resolve(directoryArgument.slice('--backup='.length));
const descriptor = JSON.parse(await readFile(resolve(backupDirectory, 'backup.json'), 'utf8'));
validateDescriptor(descriptor);
const key = deriveBackupKey(passphrase, Buffer.from(descriptor.salt, 'base64'));
const manifest = JSON.parse(
  decryptBuffer(await readFile(resolve(backupDirectory, 'manifest.enc')), key).toString('utf8')
);

if (manifest.files.length !== descriptor.files) throw new Error('Backup manifest file count mismatch');

const client = createClient(projectUrl, secret, {
  auth: { autoRefreshToken: false, persistSession: false }
});

let restored = 0;
for (const file of manifest.files) {
  const sealed = await readFile(resolve(backupDirectory, 'objects', file.backupName));
  const plain = decryptBuffer(sealed, key);
  if (plain.length !== file.bytes || sha256(plain) !== file.sha256) {
    throw new Error(`Integrity check failed for ${file.path}`);
  }

  const { error } = await client.storage.from(manifest.bucket).upload(file.path, plain, {
    contentType: file.contentType,
    upsert: false
  });
  if (error) throw new Error(`Restore failed for ${file.path}: ${error.message}`);
  restored += 1;
}

console.log(`Restored and verified ${restored} finalized objects to ${projectUrl}`);
