# Backup and restore runbook

Supabase database backups do not contain Storage objects. The beta therefore treats PostgreSQL and finalized listing images as two coordinated backup sets.

## Backup

1. Record the Supabase database backup/PITR checkpoint and project identifier.
2. Export only rows with `listing_photos.sanitized_at IS NOT NULL` and download the corresponding `listing-images` objects.
3. Encrypt each object and the private manifest with AES-256-GCM:

```bash
BACKUP_ENCRYPTION_KEY="a unique secret of at least 32 characters" \
PUBLIC_SUPABASE_URL="https://PROJECT.supabase.co" \
SUPABASE_SECRET_KEY="..." \
pnpm backup:storage
```

The script verifies each object against `content_hash`, writes an encrypted manifest and refuses to overwrite an existing backup object. `.backups/` is Git-ignored. Transfer the resulting directory to an access-controlled encrypted backup destination, then remove the local working copy through the approved retention process.

Keep `BACKUP_ENCRYPTION_KEY` in a separate password/secrets system. Loss of this key makes the image set unrecoverable; storing it beside the backup defeats the protection.

## Restore rehearsal

Use an empty staging project, never production, for the regular rehearsal:

1. Restore the matching database snapshot/migration state.
2. Point the environment variables to the empty staging target.
3. Run the guarded restore command:

```bash
pnpm restore:storage -- --backup=/absolute/path/to/storage-TIMESTAMP
```

4. The script authenticates every encrypted object, checks byte length and SHA-256, and uploads with `upsert: false`.
5. Compare the restored database count of finalized photos with the descriptor count.
6. Open a sample across JPEG/WebP, sellers and listing states; verify only sanitized paths are available.
7. Record date, operator, source checkpoint, target project, counts, failures, elapsed time and deletion of the rehearsal data.

## Failure rules

## Owner-authored recovery boundaries

Database backups do not contain Storage objects. A complete marketplace recovery set therefore requires compatible PostgreSQL state plus finalized sanitized listing-image objects and an attributable manifest. Backup keys and server credentials are placeholders only and must never be committed, logged, or copied into shared evidence. This runbook does not authorize a hosted restore, destructive cleanup, production recovery, or provider mutation; those actions require the applicable release and Human Gate authority.

- Hash mismatch: stop the backup/restore and investigate; never silently accept it.
- Missing object: keep the database backup, record the affected listing IDs and open an incident.
- Existing destination object: do not enable overwrite. Confirm the target is truly empty or restore to a new project.
- Wrong project URL: stop immediately and rotate the exposed secret if logs or terminals were shared.

No restore is considered proven until both database relations and finalized image objects are available together.
