# Backup and restore runbook

Supabase database backups do not contain Storage objects. The beta therefore treats PostgreSQL and finalized listing images as two coordinated backup sets.

## Authority and safety boundary

This runbook defines backup/restore invariants and rehearsal mechanics. It does not authorize a hosted restore, destructive cleanup, production recovery, provider mutation, or deletion of hosted data.

Before hosted mutation, establish the applicable repository/issue/recovery authority, exact source and target project, expected pre-state, expected post-state, rollback/recovery path, and required evidence. Production restore remains an R3 protected recovery action under `docs/agents/AUTONOMY.md` and `docs/agents/HUMAN-GATES.md`.

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

## Backup target safety

Verify the exact source project and environment before a hosted backup operation. A variable or credential labelled "staging" or "production" is not target proof. For staging, use the target-lock rules in `docs/STAGING-CREDENTIALS.md`; for production, use the then-current release/recovery authority.

A valid credential does not authorize backup or restore against the wrong project.

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

The receipt must identify the source checkpoint/environment, backup-set identifier, verified target, database finalized-photo count, descriptor/object count, restored count, integrity/upload failures, elapsed time, verification result, and cleanup disposition. Do not include secrets.

Rehearsal cleanup is itself a hosted mutation. Verify the exact non-production rehearsal target, preserve required evidence, and use the narrowest authorized cleanup method.

## Failure rules

- Hash mismatch: stop the backup/restore and investigate; never silently accept it.
- Missing object: keep the database backup, record the affected listing IDs and open an incident.
- Existing destination object: do not enable overwrite. Confirm the target is truly empty or restore to a new project.
- Wrong project URL: stop immediately and rotate the exposed secret if logs or terminals were shared.

No restore is considered proven until both database relations and finalized image objects are available together.

## Production and skill boundaries

A successful rehearsal, backup, script exit code, or specialist recommendation does not authorize production restore. Prepare non-destructive evidence first and stop at the applicable R3/Human Gate before any protected production recovery action.

Skill routing remains defined by `docs/agents/SKILL-ROUTER.md`. Superpowers owns the primary process; Matt Pocock and ECC/platform skills may contribute recovery, integrity, security, Supabase, or provider expertise. No skill may bypass target verification, weaken integrity checks, enable overwrite to make a rehearsal pass, authorize production recovery, or create a competing recovery lifecycle.
