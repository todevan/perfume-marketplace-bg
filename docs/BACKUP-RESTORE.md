# Backup and restore runbook

## Purpose

Supabase database backups do not contain Storage objects.

The marketplace therefore treats PostgreSQL state and finalized listing images as one versioned, coordinated recovery set.

This runbook defines the engineering backup/restore invariants and the regular restore-rehearsal procedure.

**Verification boundary:** The Issue #29 recovery and readiness contracts below are
requirements, not proof that hosted monitoring, automatic backups, Auth recovery,
or a restore rehearsal have succeeded. Repository contract tests are not hosted
acceptance. Do not declare recovery usable until the exact current source,
components, key recovery, isolated restore, and cleanup have provider-backed proof.

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
- `docs/agents/SECURITY.md`.

A production restore is a protected R3 recovery operation and requires the exact target, current backup and recovery evidence, rollback limitations, and owner action defined by current authority.

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

## Coordinated recovery contract

The zero-new-spend canonical path is a logical database export with the
repository-pinned Supabase/Postgres tools, coordinated with the reviewed finalized
`listing-images` backup. Paid managed cloning and “Restore to a new project” are
not dependencies. Already-entitled managed backup metadata is supplementary only.

The versioned set must cover custom roles/grants, application schema/data,
migration history/digest, approved synthetic Auth recovery state, custom
`auth`/`storage` changes, extensions/publications inventory, finalized objects, and
non-secret bucket/platform inventory. Bind it to the exact source organization,
project/ref, region, synthetic classification, Git SHA/tree and Worker version.

Do not assume the CLI's default dump is a recovery contract. The inspected pinned
CLI 2.109.1 data dump includes transient Auth sessions/refresh tokens/flow state,
managed Storage metadata and outbound-hook state; default dumps omit migration
history. **Never blindly replay that default data dump.** Explicit migration
history export and a tested synthetic Auth/custom-managed-schema recovery path are
required. The CLI does not expose a `--snapshot` option; a coherent database
checkpoint and the finalized-photo rowset's before/after comparison must be
empirically proven before a coordinated set is accepted. A tools-only inspection
does not prove that the exporter or restore sequence is complete.

Only export finalized rows with `listing_photos.sanitized_at IS NOT NULL`, using
the existing guarded Storage mechanism and recorded content hashes. Create one
unique private temporary directory; never overwrite a completed set. Reject
rowset/checkpoint drift, missing/added/duplicate objects, wrong paths/hashes, or
uncoordinated components. Authenticate and hash every component before atomic
publication. Remove definite failed partial plaintext/output, not completed sets.

Inventory explicit exclusions and reconstruction steps: secrets, Edge Functions,
Auth/API-key settings, Realtime/provider settings, DNS, Worker routes and external
integrations are **not automatically restored** by a logical dump.

## Encryption and custody

Preserve the existing AES-256-GCM invariants. Each coordinated set requires a
fresh random data-encryption key and a versioned public-key envelope wrapping that
key to an owner-held public key. Automation may receive the public key only. The
private key stays outside GitHub, providers, artifacts, logs, receipts and chat.
Prove owner-held private-key recovery during the isolated rehearsal.

`BACKUP_ENCRYPTION_KEY` remains the existing offline Storage primitive's input;
it is not permission to place a reusable decryption secret in a scheduled workflow.
Do not put plaintext dumps, decrypted manifests, passphrases, data keys or private
keys outside the ephemeral/private execution boundary. Loss of the owner key makes
the set unrecoverable; storing it beside the artifact defeats this protection.

## Automation, freshness and retention

The executor contract is `.github/workflows/operations-backup.yml`: manual
`workflow_dispatch` plus daily at 03:17 UTC, trusted protected `main` only, with
immutable action SHAs, Node 22.23.2, Supabase CLI 2.109.1 and PostgreSQL 17.6
from the immutable image pinned in `logical-recovery.mjs`. Permissions are limited
to repository contents/read and Actions/read; upload uses the official Actions
artifact capability. Never expose backup secrets to pull requests, forks or untrusted
refs. Publish only encrypted components and a sanitized descriptor, retain them
for 35 days, and independently read back artifact identity, size, creation/expiry
and hashes. This retention provides at least seven daily and four weekly points
only while daily execution remains healthy.

Do not claim a scheduled backup is operational merely because the workflow
contract exists or a historical run was green. A new workflow requires one real
post-merge default-branch dispatch with artifact and success-heartbeat readback
before Issue #29 closes. A missing/failed execution remains a blocker.

Private Actions handoffs are `ISSUE29_BACKUP_AUTHORIZATION_JSON`,
`ISSUE29_OWNER_BACKUP_PUBLIC_KEY` (public PEM only), and
`ISSUE29_GRAFANA_HEARTBEAT_JSON` (distinct narrow metrics write/read tokens).
Authorization contains the **existing** expiring version-2 lifecycle manifest,
exact source/deployment read credentials, pinned backup settings and a maximum
artifact byte allowance. It cannot mint source provenance or renew authorization.
The executor live-revalidates the source and deployment before every export;
GitHub run attempt 2 or later cannot repeat an uncertain upload. Persisted upload
and heartbeat intent belongs to the same private transaction manifest.

Managed `auth`/`storage` baseline SQL is never installed as a GitHub secret or
artifact. The runner reconstructs it in a fresh, empty local pinned Supabase
fixture and requires the source-recorded normalized schema digest to match.
Differences in hosted provider base schemas fail closed, even if PostgreSQL
versions match. Plaintext and local fixtures stay on the ephemeral runner and are
removed in the workflow's `always()` cleanup; the encrypted artifact is retained.

The official artifact is immutable and retained for 35 days. Success requires exact
artifact/run/repository/candidate metadata readback, archive-byte SHA-256
verification, and rechecking every extracted ciphertext against the immutable
descriptor. Only then can Grafana receive a success heartbeat carrying the original
backup checkpoint time, followed by independent metrics readback. Daily creation
uses only the public key and authenticates components before wiping the ephemeral
data key; it is **not** owner-held private-key decryption or monthly restore proof.

**Current lifecycle and cost limits:** Preserved canonical staging/production are
inventory/read-only-monitoring targets only, never scheduled recovery sources.
A disposable synthetic source that has been retired cannot silently become a
standing daily source. Source expiry, retirement or missing authorization must
make the workflow fail until a newly authorized source arrangement exists.
Public repository status proves free standard-runner compute, not unbounded free
artifact storage. The personal-owner budget has no documented REST readback;
publication requires current private owner UI evidence of the exact Actions $0
hard-stop budget, capture hash and expiry (maximum 24 hours). This is explicitly
owner-attested UI evidence, not an API result. It is never automatically refreshed.
No artifact upload is authorized while that evidence is missing or stale. See
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
and the currently organization-scoped [budget API](https://docs.github.com/en/rest/billing/budgets).
The schedule is consequently not yet proof of unattended, continuously healthy
backups under the current disposable-source authorization.

- RPO target: 24 hours; warn above 24 hours, critical above 26 hours or on any
  integrity/decryption failure.
- Full-service RTO target: 2 hours; record DB/Auth recovery and full recovery
  separately.
- Independent dead-man: Grafana Cloud Free, not the GitHub schedule itself.
- Secondary copy: one owner-controlled encrypted destination, alias
  `owner-secondary`; copy at least one complete encrypted artifact and compare its
  hash without co-locating the private key.
- Rehearse before launch, after a material recovery-contract change, and at least
  monthly while beta is active.

---

# Backup target safety

Before a hosted backup operation, verify the exact source project/environment.

Do not rely solely on an environment variable name such as:

```text
staging
production
```

when the tooling can prove the actual project identity.

Under the current Issue #29 owner boundary, canonical staging, production and
all pre-existing inventory refs are **preserved**: read-only inventory/monitoring
only, with no backup exports, restores, data changes or cleanup. Recovery source
creation requires a fresh manifest-owned synthetic project with current live free
capacity/cost and ownership proof. Historical source credentials do not authorize
exports. Future production recovery requires separate current owner authority.

A valid credential does not authorize backing up or restoring the wrong project.

---

# Restore rehearsal

The regular rehearsal requires one newly created, dedicated, disposable normal
Supabase project within existing free capacity. Provider base schemas may exist;
foreign Auth users, unrelated application data or objects may not. Do not purchase
capacity or delete an unrelated project to make room.

Do not use production for routine rehearsal.

The source and target must be fresh manifest-owned synthetic projects. Unknown or
real staging data must not be copied, deleted or reclassified to force a pass.
If simultaneous free capacity is unavailable, the current owner permits exact
source deletion only **after** independent owner-key backup verification and a
persisted no-further-source-reads boundary. Read back that source's absence, then
live-recheck free quota/cost before creating the new restore target. Never delete
an unrelated project for capacity. If no compliant arrangement exists, stop.

Before restore mutation, verify that the selected target is the explicitly authorized rehearsal environment.

---

## Rehearsal sequence

The single operator entry point is `node scripts/issue29-operations/cli.mjs`.
Use only commands actually listed by that entry point. The intended sequence is
`preflight` → `backup-set` → `verify-backup` → `restore` → `verify-restore` →
`incident-drill` → `cleanup` → `validate-receipt`; a listed contract or command
name is not evidence that hosted acceptance has passed. The scheduled workflow
uses `backup-set --manifest=PRIVATE_PATH --settings=PRIVATE_PATH`; source settings
and baseline stay mode-0600 outside the repository. Consult the exact candidate's
`--help` for available commands and current stop boundaries. No fabricated success
receipt or historical local rehearsal can stand in for exact hosted proof.

1. Create the private mode-0600, expiring transaction manifest outside the
   repository. Bind source/target identities, SHA/tree/deployment, forbidden refs,
   role-scoped capabilities, zero cost and exact cleanup ownership.
2. Read back source ownership/classification and free target capacity. Reject
   source/target equality, production, canonical staging, historical/unrelated
   forbidden refs and foreign state before mutation.
3. Persist intent before any mutation, execute once, read back the exact provider
   identity, then advance state. Ambiguous results stop for inspection, not retry.
4. Read back `quarantine_verified` before data loading: no copied runtime secrets,
   production routes, outbound email, copied cron/net jobs, webhooks, callbacks,
   queued requests, billing or indexing. Inventory triggers and prove the load
   method cannot cause outbound effects; uncertainty stops before restore writes.
5. Use one empirically tested schema strategy: do not apply migrations then
   blindly replay a full schema dump. Restore required roles/extensions,
   application schema/data and migration history consistently; restore only the
   approved custom managed-schema changes and synthetic Auth recovery state.
   Exclude transient source sessions/tokens and unsafe managed Storage internals.
6. Verify fresh target login and old-source-token rejection under distinct signing
   identity, RLS, cross-user denials, staff MFA, schema/migration inventory and the
   absence of production configuration/outbound effects.
7. Restore finalized Storage through the existing authenticated mechanism with
   exact target/manifest checks and `upsert: false`. A fresh target bucket must be
   empty; resume only if every existing object is verified against this same
   manifest. Do not treat unrelated objects as resumable state.
8. Re-download and hash every object; reconcile complete path-tree/count/bytes and
   finalized-photo rowset/checkpoint with the database.
9. Reuse existing application/deal/safety/privacy proof journeys, including
   listing/search, accepted-offer private chat, report/block/moderation/evidence,
   finalized-image access and monitor health.
10. Measure actual RPO and DB/Storage/application/full RTO from recorded UTC
    boundaries. Missed RPO/RTO targets remain failed acceptance, not a warning-only
    success.
11. Perform the disposable Storage-sentinel incident drill in
    `docs/INCIDENT-RESPONSE.md`, then delete only manifest-owned disposable resources
    and independently prove absence. Retain approved monitors/encrypted artifacts.

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
- `recoveryPointAgeAtStartMs` (actual RPO, at most 24 hours);
- `databaseRecoveryElapsedMs` (through DB/Auth integrity);
- `storageRecoveryElapsedMs` and `applicationRecoveryElapsedMs`;
- `fullRecoveryElapsedMs` (through all checks, at most 2 hours);
- private-key recovery proof without secret values;
- runbook/configuration/isolation checksums and current-run provenance;
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
5. delete only IDs created by this manifest, or restore exact temporary
   configuration captured before this transaction;
6. read back every deletion/rollback and independently verify absence before
   `cleanup_verified`; leave no ambiguous pending mutation.

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

Resume only when every existing destination object matches this exact authenticated
manifest and target. Otherwise stop; prefer an explicitly authorized dedicated
rehearsal target rather than deleting or overwriting foreign state.

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

# Core backup/restore invariant

```text
Database and finalized Storage are one coordinated recovery set.
Backups must be attributable to the correct source.
Encrypted objects must pass integrity verification.
Restore targets must be explicitly verified.
Routine rehearsals never use production.
Existing foreign destination state is a stop condition, not overwrite permission.
A restore is not proven until database and Storage agree.
Production restore remains a protected R3 action.
```
