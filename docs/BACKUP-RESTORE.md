# Backup and restore runbook

## Purpose

Supabase database backups do not contain Storage objects.

The marketplace therefore treats PostgreSQL state and finalized listing images as two coordinated backup sets.

This runbook defines the engineering backup/restore invariants and the regular restore-rehearsal procedure.

It does not by itself authorize:

- a hosted database restore;
- destructive cleanup;
- production recovery;
- production provider mutation;
- deletion of existing hosted data.

Before any hosted mutation, also apply:

- `AGENTS.md`;
- `docs/PROJECT-STATUS.md`;
- `docs/PRODUCTION-SETUP.md`;
- `docs/STAGING-CREDENTIALS.md`;
- the current GitHub issue;
- the applicable release/recovery plan;
- `docs/agents/AUTONOMY.md`;
- `docs/agents/HUMAN-GATES.md`.

A production restore is a protected recovery operation and must follow the applicable R3/Human Gate authority.

---

# Backup model

A usable marketplace backup consists of coordinated evidence for:

```text
PostgreSQL state
+
finalized sanitized Storage objects
```

Neither half alone is a proven complete restore set.

The database checkpoint and Storage backup must be attributable to compatible source state.

Do not describe a database-only backup as complete marketplace recovery evidence when finalized Storage objects are required.

---

# Backup

1. Record the Supabase database backup/PITR checkpoint and exact project identifier.

2. Export only finalized listing-image records with:

```text
listing_photos.sanitized_at IS NOT NULL
```

and download the corresponding finalized `listing-images` objects.

3. Encrypt each object and the private manifest with AES-256-GCM:

```bash
BACKUP_ENCRYPTION_KEY="a unique secret of at least 32 characters" \
PUBLIC_SUPABASE_URL="https://PROJECT.supabase.co" \
SUPABASE_SECRET_KEY="..." \
pnpm backup:storage
```

The values above are placeholders.

Never place a real backup key or Supabase server credential in documentation, source control or shared logs.

4. The backup tooling must verify each object against its recorded `content_hash`.

5. The tooling must write an encrypted manifest and refuse to overwrite an existing backup object.

6. `.backups/` remains Git-ignored.

7. Transfer the completed backup directory to an access-controlled encrypted backup destination.

8. Remove the temporary local working copy only according to the approved retention/cleanup process.

---

# Backup encryption key

Keep:

```text
BACKUP_ENCRYPTION_KEY
```

in a separate password/secrets system from the encrypted backup set.

Do not:

- commit it;
- store it inside the backup directory;
- place it in ordinary Worker runtime configuration;
- include it in backup receipts;
- log it.

Loss of the key makes the encrypted Storage set unrecoverable.

Storing the key beside the backup defeats the intended protection.

---

# Backup target safety

Before a hosted backup operation, verify the exact source project/environment.

Do not rely solely on an environment variable name such as:

```text
staging
production
```

when the tooling can prove the actual project identity.

For staging operations, use the target-locking rules in:

`docs/STAGING-CREDENTIALS.md`

For production, use the production/release authority applicable at that time.

A valid credential does not authorize backing up or restoring the wrong project.

---

# Restore rehearsal

The regular restore rehearsal must use an isolated empty staging/test project.

Do not use production for routine rehearsal.

The rehearsal target must contain no real personal data.

Before restore mutation, verify that the selected target is the explicitly authorized rehearsal environment.

---

## Rehearsal sequence

1. Restore the matching database snapshot or migration-compatible database state into the authorized rehearsal target.

2. Verify that the database state corresponds to the Storage backup being rehearsed.

3. Point the required environment variables only at the verified empty rehearsal project.

4. Run the guarded restore command:

```bash
pnpm restore:storage -- --backup=/absolute/path/to/storage-TIMESTAMP
```

5. The restore tooling must authenticate every encrypted object.

6. It must verify:

- authenticated encryption;
- expected byte length;
- SHA-256 integrity.

7. It must upload with:

```text
upsert: false
```

Existing destination objects are therefore a stop condition rather than permission to overwrite.

8. Compare the restored database count of finalized photo records with the restored backup descriptor/object count.

9. Open a representative sample across:

- JPEG/WebP derivatives where represented by the backup;
- different sellers;
- different listing states.

10. Verify that only finalized/sanitized paths intended by the architecture are available.

11. Record the rehearsal receipt.

---

# Restore rehearsal receipt

Record at least:

- rehearsal date/time;
- operator or automation identity;
- source database checkpoint;
- source environment/project identity;
- backup set identifier;
- target project identity;
- database finalized-photo count;
- backup descriptor/object count;
- restored object count;
- integrity failures;
- upload failures;
- elapsed time;
- verification result;
- cleanup/deletion disposition for rehearsal data.

Do not include secrets in the receipt.

Where exact SHA/project binding is required by a later release gate, include those identifiers according to that gate's evidence contract.

---

# Rehearsal cleanup

Deletion of rehearsal data is a hosted mutation.

Do not interpret:

```text
record deletion of the rehearsal data
```

as permission to perform broad or destructive cleanup against an ambiguous target.

Before cleanup:

1. verify the exact rehearsal project;
2. confirm it is not production;
3. confirm the cleanup is within the authorized rehearsal scope;
4. preserve required evidence/receipts;
5. use the narrowest supported cleanup method.

Do not use production data, migration history rewriting or unrelated provider cleanup as part of rehearsal teardown.

If target identity is uncertain, stop.

---

# Failure rules

## Hash mismatch

Stop the backup or restore immediately.

Do not silently accept, rewrite or regenerate the expected hash merely to continue.

Investigate whether the mismatch indicates:

- wrong object;
- corrupted backup;
- database/Storage inconsistency;
- incorrect source state;
- tooling defect;
- credential/target mistake.

---

## Missing object

Preserve the database backup.

Record the affected listing/image identifiers that can be safely included in the incident evidence.

Open or update the appropriate incident/engineering issue.

Do not fabricate a replacement object or mark the backup as complete.

---

## Existing destination object

Do not enable overwrite.

Confirm whether:

- the target was not actually empty;
- the wrong project was selected;
- a previous rehearsal left state behind;
- the restore was already partially attempted.

Prefer an explicitly authorized clean rehearsal target rather than mutating existing objects to force the restore through.

---

## Wrong project URL or identity

Stop immediately.

Do not continue merely because the credentials authenticate successfully.

If a credential may have been exposed through shared logs, screenshots, terminals or other unsafe output, follow the credential-incident procedure and rotate/revoke it where required.

---

## Authentication/decryption failure

Stop.

Do not skip the affected object.

A backup set with unauthenticated encrypted content is not considered proven.

Determine whether the cause is:

- wrong encryption key;
- corrupted ciphertext;
- wrong backup set;
- tooling defect.

---

## Database/Object count mismatch

Do not mark the rehearsal successful.

Investigate whether:

- finalized database rows are missing objects;
- the manifest is incomplete;
- the database checkpoint and Storage backup are incompatible;
- unexpected objects were included or omitted.

The count check is evidence of coordinated recovery, not merely a reporting metric.

---

# Restore completion criteria

No restore is considered proven until the required database relations and finalized Storage objects are available together and pass the applicable integrity checks.

Conceptually:

```text
database restored
+
Storage objects restored
+
cryptographic integrity verified
+
database/object relationship verified
+
representative access verified
=
restore rehearsal evidence
```

A successful database restore alone is insufficient.

A successful object upload alone is insufficient.

A script exit code alone is insufficient if the required cross-checks were not performed.

---

# Production restore boundary

A production restore is not the same operation as a routine staging rehearsal.

Production recovery may involve:

- real personal data;
- active users;
- live Auth state;
- live Storage objects;
- external providers;
- DNS/traffic;
- irreversible operational consequences.

Therefore production restore is a protected R3 recovery boundary.

Do not begin a production restore merely because:

- this runbook describes the mechanics;
- a staging rehearsal passed;
- a backup exists;
- an ECC/backend specialist recommends it;
- Superpowers reaches an implementation step.

Production recovery requires the applicable explicit owner authorization and incident/recovery procedure.

Where possible, prepare and verify non-destructive evidence before crossing that boundary.

---

# Forward-only database discipline

A restore/recovery operation does not create general authority to rewrite database history.

Outside an explicitly authorized disaster-recovery procedure, do not use:

- remote `db reset`;
- migration-history rewriting;
- arbitrary schema drops;
- blanket truncation;
- migration repair

as shortcuts for making hosted state match a backup.

Normal shared hosted evolution remains forward-only.

If disaster recovery requires exceptional database operations, those operations must be explicitly included in the protected recovery plan.

---

# Privacy and data handling

Backup sets may contain sensitive marketplace data.

Treat backup manifests, database snapshots and finalized private objects according to the repository's privacy/security requirements.

Do not:

- copy production backups into ordinary development environments;
- use production personal data as test fixtures;
- expose private object paths unnecessarily;
- place decrypted backup material in source control;
- retain temporary decrypted/local working copies indefinitely.

Use only the minimum data exposure necessary for the authorized recovery/rehearsal task.

---

# Incident escalation

A backup or restore failure that threatens recoverability, integrity or user data should follow:

`docs/INCIDENT-RESPONSE.md`

Examples include:

- missing required backup objects;
- irrecoverable encryption-key loss;
- backup corruption;
- cross-environment credential exposure;
- accidental restore to the wrong target;
- unexpected production-data exposure;
- inability to reconcile database and finalized Storage state.

Do not hide a failed restore rehearsal by regenerating evidence until it passes.

Preserve the failure evidence needed for diagnosis.

---

# Agent and skill interaction

This runbook defines backup/restore constraints.

It does not create another planning, debugging, TDD or completion workflow.

Skill routing remains defined by:

`docs/agents/SKILL-ROUTER.md`

The normal relationship is:

```text
repository / issue / recovery authority
        ↓
Superpowers primary process
        ↓
Matt Pocock engineering reasoning when useful
        ↓
ECC / platform specialist when useful
        ↓
repository-defined verification
```

Matt Pocock skills may help reason about:

- failure states;
- data invariants;
- recovery boundaries;
- implementation design.

ECC/platform specialists may help with:

- Supabase;
- Storage;
- backend/security;
- cryptographic/tooling review;
- provider-specific recovery behavior.

Neither system may:

- authorize production restore;
- weaken integrity checks;
- permit overwrite to bypass a failed rehearsal;
- bypass target verification;
- create a parallel recovery lifecycle.

---

# Core backup/restore invariant

```text
Database and finalized Storage are one coordinated recovery set.
Backups must be attributable to the correct source.
Encrypted objects must pass integrity verification.
Restore targets must be explicitly verified.
Routine rehearsals never use production.
Existing destination objects are a stop condition, not overwrite permission.
A restore is not proven until database and Storage agree.
Production restore remains a protected R3 action.
Skills may assist recovery work but do not grant recovery authority.
```