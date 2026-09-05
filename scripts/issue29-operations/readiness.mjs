import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { canonicalJson, validateRecoveryDescriptor } from './recovery-set.mjs';

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const skew = 5 * 60 * 1000;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const gitSha = z.string().regex(/^[a-f0-9]{40}$/u);
const alias = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);
const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/u);
const projectRef = z.string().regex(/^[a-z]{20}$/u);
const utc = z.iso.datetime();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const yes = z.literal(true);
const object = z.strictObject;
const signals = ['health', 'auth', 'database', 'storage', 'email', 'deals', 'safety', 'backup_freshness', 'monitor_heartbeat'];
const components = ['roles', 'schema', 'data', 'migration-history', 'auth-recovery', 'managed-schema-changes', 'platform-inventory', 'storage-manifest', 'storage-objects'];
/** @typedef {'monitor'|'alerts'|'backup'|'decryption'|'restore'|'incident'|'isolation'|'cleanup'} EvidenceSection */
/** @type {EvidenceSection[]} */
const sections = ['monitor', 'alerts', 'backup', 'decryption', 'restore', 'incident', 'isolation', 'cleanup'];
const checks = object(Object.fromEntries([
  'schemaMigration', 'databaseStorageCheckpoint', 'authRecovery', 'rls', 'crossUserPrivacy',
  'oldSourceTokenDenied', 'freshTargetLogin', 'application', 'deals', 'safety',
  'finalizedImages', 'noOutboundEffects', 'noProductionConfiguration'
].map((name) => [name, yes])));

const receiptSchema = object({
  schemaVersion: z.literal(1), kind: z.literal('issue29-operations-readiness'),
  runId: identity, commitSha: gitSha, treeSha: gitSha, workerVersion: identity,
  environmentAlias: alias, projectRef, generatedAt: utc,
  monitor: object({
    provider: z.literal('grafana-cloud-free'), stackAlias: alias,
    destinationAlias: z.literal('owner-primary'), targetProjectRef: projectRef,
    targetEnvironmentAlias: alias, targetCommitSha: gitSha, targetWorkerVersion: identity,
    configSha256: sha256, readBackAt: utc, heartbeatAt: utc,
    signalFamilies: z.array(z.enum(signals)).length(signals.length),
    maxCost: z.literal(0), evidenceSha256: sha256
  }),
  alerts: object({
    configSha256: sha256, targetProjectRef: projectRef,
    destinationAlias: z.literal('owner-primary'), failureEventId: identity,
    recoveryEventId: identity, firedAt: utc, deliveredAt: utc, acknowledgedAt: utc,
    recoveredAt: utc, recoveryDeliveredAt: utc,
    provedSignalFamilies: z.array(z.enum(signals)).length(signals.length),
    evidenceSha256: sha256
  }),
  backup: object({
    setId: identity, descriptorSha256: sha256, sourceProjectRef: projectRef,
    sourceClassification: z.literal('synthetic-owner-controlled'), sourceCommitSha: gitSha,
    checkpointSha256: sha256, checkpointAt: utc, completedAt: utc, verifiedAt: utc,
    components: z.array(object({ name: z.enum(components), sha256, sizeBytes: count })).length(components.length),
    artifact: object({
      provider: z.literal('github-actions'), id: z.string().regex(/^[1-9][0-9]{0,24}$/u),
      createdAt: utc, expiresAt: utc, retentionDays: z.literal(35),
      readBackAt: utc, downloadVerifiedAt: utc, sizeBytes: count.positive(), sha256
    }),
    encryption: object({
      algorithm: z.literal('AES-256-GCM'), envelopeVersion: z.literal(1), keyId: identity,
      publicKeySha256: sha256, wrappedKeySha256: sha256
    }),
    secondaryCopy: object({
      destinationAlias: alias, verifiedAt: utc, sha256, privateKeyCoLocated: z.literal(false)
    }),
    evidenceSha256: sha256
  }),
  decryption: object({
    backupSetId: identity, descriptorSha256: sha256, keyId: identity, verifiedAt: utc,
    allComponentsAuthenticated: yes, privateKeyCustody: z.literal('owner-offline'),
    privateKeyRetainedByAutomation: z.literal(false), evidenceSha256: sha256
  }),
  restore: object({
    backupSetId: identity, descriptorSha256: sha256, targetAlias: alias, targetProjectRef: projectRef,
    recoveryCheckpointAt: utc, recoveryContractSha256: sha256,
    startedAt: utc, quarantineVerifiedAt: utc, databaseIntegrityAt: utc,
    storageStartedAt: utc, storageRestoredAt: utc, completedAt: utc,
    recoveryPointAgeAtStartMs: count, databaseRecoveryElapsedMs: count,
    storageRecoveryElapsedMs: count, applicationRecoveryElapsedMs: count,
    fullRecoveryElapsedMs: count, checks, evidenceSha256: sha256
  }),
  incident: object({
    runbookSha256: sha256,
    roles: object({
      incidentCommander: z.literal('owner'), technicalLead: z.literal('authorized-operator'),
      privacyCommunications: z.literal('owner'), backupRestoreOperator: z.literal('authorized-operator')
    }),
    contactMapAlias: z.literal('owner-private-contact-map'), contactsAttestedAt: utc,
    drill: object({
      kind: z.literal('storage-sentinel'), targetProjectRef: projectRef,
      startedAt: utc, mutationReadBackAt: utc, detectedAt: utc, deliveredAt: utc,
      acknowledgedAt: utc, diagnosedAt: utc, restoredAt: utc, recoveredAt: utc,
      recoveryDeliveredAt: utc, closedAt: utc
    }),
    evidenceSha256: sha256
  }),
  isolation: object({
    matrixSha256: sha256, checkedAt: utc, sourceProjectRef: projectRef,
    restoreProjectRef: projectRef, productionRefs: z.array(projectRef).max(100),
    canonicalStagingRef: projectRef, forbiddenRefs: z.array(projectRef).min(1).max(100),
    productionReadOnly: yes, sourceSyntheticVerified: yes, targetDedicatedVerified: yes,
    noForeignStateVerified: yes, noSharedCredentialsVerified: yes, evidenceSha256: sha256
  }),
  cleanup: object({
    state: z.literal('cleanup_verified'), verifiedAt: utc, pendingMutationCount: z.literal(0),
    resources: z.array(object({
      provider: z.enum(['supabase', 'cloudflare', 'grafana']), resourceIdSha256: sha256,
      createdIntentSha256: sha256, createdReadbackSha256: sha256, deleteIntentSha256: sha256,
      deleteReadbackSha256: sha256, absenceReadbackSha256: sha256, absent: yes
    })).min(1).max(200),
    temporaryCredentialCount: count, revokedTemporaryCredentialCount: count,
    retainedResources: z.array(object({
      alias, kind: z.enum(['grafana-stack', 'grafana-destination', 'grafana-rule', 'encrypted-backup', 'secondary-encrypted-copy'])
    })).min(5).max(100),
    cost: z.literal(0), evidenceSha256: sha256
  })
});

const expectedSchema = object({
  commitSha: gitSha, treeSha: gitSha, workerVersion: identity, environmentAlias: alias,
  projectRef, monitorConfigSha256: sha256, runbookSha256: sha256, isolationMatrixSha256: sha256
});

/** @param {unknown} value @returns {unknown} */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

// This encodes observations already read back by the operator. It does not perform
// provider verification and must never be used to manufacture hosted success.
/**
 * @param {{runId:string,commitSha:string,treeSha:string,workerVersion:string}} receiptIdentity
 * @param {EvidenceSection} operation
 * @param {unknown} payload
 */
export function createOperationsEvidence(receiptIdentity, operation, payload) {
  const identityResult = object({
    runId: identity, commitSha: gitSha, treeSha: gitSha, workerVersion: identity
  }).safeParse({
    runId: receiptIdentity?.runId, commitSha: receiptIdentity?.commitSha,
    treeSha: receiptIdentity?.treeSha, workerVersion: receiptIdentity?.workerVersion
  });
  if (!identityResult.success || !sections.includes(operation) || !payload ||
      typeof payload !== 'object' || Array.isArray(payload) || Object.hasOwn(payload, 'evidenceSha256') ||
      !receiptSchema.shape[operation].safeParse({ ...payload, evidenceSha256: '0'.repeat(64) }).success) {
    throw new Error('operations evidence schema is invalid');
  }
  const evidence = {
    schemaVersion: 1, kind: 'issue29-operations-evidence', runId: receiptIdentity.runId,
    commitSha: receiptIdentity.commitSha, treeSha: receiptIdentity.treeSha,
    workerVersion: receiptIdentity.workerVersion, operation, payload
  };
  const bytes = Buffer.from(`${JSON.stringify(canonical(evidence))}\n`);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Bind the material recovery contract, not changing row counts or backup IDs.
 * @param {import('./recovery-set.mjs').RecoveryDescriptor} input
 * @returns {string}
 */
export function recoveryContractDigest(input) {
  const descriptor = validateRecoveryDescriptor(input);
  return createHash('sha256').update(canonicalJson({
    format: descriptor.format, version: descriptor.version,
    migration: descriptor.metadata.migration, tools: descriptor.metadata.tools,
    componentKinds: [...new Set(descriptor.components.map((component) => component.kind).filter((kind) => kind !== 'storage-object'))].sort(),
    exclusions: [...descriptor.metadata.exclusions].sort(),
    manualReconstruction: [...descriptor.metadata.manualReconstruction].sort()
  })).digest('hex');
}

/** Create a private, bounded content-addressed evidence reader without exposing paths in errors.
 * @param {string} directory
 * @param {string} repositoryRoot
 * @returns {(digest:string)=>Buffer}
 */
export function createOperationsEvidenceReader(directory, repositoryRoot) {
  let root;
  try {
    root = realpathSync(directory);
    const location = relative(realpathSync(repositoryRoot), root);
    if (location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location)) {
      throw new Error('private evidence must be outside the repository');
    }
  } catch {
    throw new Error('operations evidence directory is invalid');
  }
  return (digest) => {
    let descriptor;
    try {
      if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error('invalid digest');
      descriptor = openSync(resolve(root, `${digest}.json`), constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = fstatSync(descriptor);
      if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || info.size > 1024 * 1024) {
        throw new Error('invalid private evidence file');
      }
      return readFileSync(descriptor);
    } catch {
      throw new Error('operations evidence file is invalid');
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  };
}

/** Validate a sanitized receipt against independently supplied release bindings and evidence bytes.
 * @param {unknown} input
 * @param {{now?:number,expected?:unknown,readEvidence?:(sha256:string)=>Buffer|undefined,requireCurrentBackupRehearsal?:boolean}} [options]
 * @returns {string[]}
 */
export function validateOperationsReadiness(input, options = {}) {
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) return ['operations receipt schema is invalid'];
  const expectedResult = expectedSchema.safeParse(options.expected);
  if (!expectedResult.success) return ['operations expected release bindings are invalid'];
  const receipt = parsed.data;
  const expected = expectedResult.data;
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) return ['operations validation clock is invalid'];
  /** @type {string[]} */
  const failures = [];
  /** @param {boolean} valid @param {string} reason */
  const require = (valid, reason) => { if (!valid) failures.push(`operations ${reason}`); };
  /** @param {string} value */
  const at = (value) => Date.parse(value);
  /** @param {string} value @param {number} maximumAge @param {string} name */
  const fresh = (value, maximumAge, name) => {
    require(at(value) <= now + skew && at(value) >= now - maximumAge, `${name} is stale or future-dated`);
  };
  /** @param {string[]} values @param {string} name */
  const ordered = (values, name) => {
    require(values.every((value, index) => index === 0 || at(value) >= at(values[index - 1])), `${name} timeline is inconsistent`);
  };
  /** @param {string[]} actual @param {string[]} wanted */
  const sameSet = (actual, wanted) => actual.length === wanted.length && new Set(actual).size === wanted.length && wanted.every((value) => actual.includes(value));

  for (const name of /** @type {const} */ (['commitSha', 'treeSha', 'workerVersion', 'environmentAlias', 'projectRef'])) {
    require(receipt[name] === expected[name], `${name} does not match the release target`);
  }
  fresh(receipt.generatedAt, day, 'receipt');
  const { monitor, alerts, backup, decryption, restore, incident, isolation, cleanup } = receipt;
  require(monitor.targetProjectRef === expected.projectRef && monitor.targetEnvironmentAlias === expected.environmentAlias && monitor.targetCommitSha === expected.commitSha && monitor.targetWorkerVersion === expected.workerVersion, 'monitor target does not match the release');
  require(monitor.configSha256 === expected.monitorConfigSha256, 'monitor configuration checksum does not match');
  require(sameSet(monitor.signalFamilies, signals), 'monitor signal coverage is incomplete');
  fresh(monitor.readBackAt, 10 * 60 * 1000, 'monitor configuration');
  fresh(monitor.heartbeatAt, 20 * 60 * 1000, 'monitor heartbeat');
  require(alerts.configSha256 === monitor.configSha256 && alerts.targetProjectRef === monitor.targetProjectRef && alerts.destinationAlias === monitor.destinationAlias, 'alert routing does not match the monitor');
  require(sameSet(alerts.provedSignalFamilies, signals), 'alert rule coverage is incomplete');
  require(alerts.failureEventId !== alerts.recoveryEventId, 'alert failure and recovery identities must differ');
  fresh(alerts.deliveredAt, day, 'alert delivery');
  fresh(alerts.recoveryDeliveredAt, day, 'recovery delivery');
  ordered([alerts.firedAt, alerts.deliveredAt, alerts.acknowledgedAt, alerts.recoveredAt, alerts.recoveryDeliveredAt], 'alert');
  require(at(alerts.acknowledgedAt) - at(alerts.deliveredAt) <= 15 * 60 * 1000, 'critical alert acknowledgement exceeds 15 minutes');

  require(backup.sourceProjectRef === isolation.sourceProjectRef && backup.sourceCommitSha === expected.commitSha, 'backup source identity does not match');
  require(sameSet(backup.components.map((component) => component.name), components), 'backup component inventory is incomplete');
  fresh(backup.checkpointAt, day, 'backup checkpoint');
  fresh(backup.verifiedAt, day, 'backup verification');
  fresh(backup.artifact.readBackAt, day, 'backup artifact readback');
  fresh(backup.artifact.downloadVerifiedAt, day, 'backup artifact download');
  ordered([backup.checkpointAt, backup.completedAt, backup.verifiedAt, backup.artifact.createdAt, backup.artifact.readBackAt, backup.artifact.downloadVerifiedAt], 'backup');
  require(at(backup.artifact.expiresAt) - at(backup.artifact.createdAt) >= 35 * day && at(backup.artifact.expiresAt) > now, 'backup retention is shorter than 35 days or expired');
  require(backup.secondaryCopy.sha256 === backup.artifact.sha256, 'secondary encrypted copy hash does not match');
  fresh(backup.secondaryCopy.verifiedAt, 30 * day, 'secondary encrypted copy');
  require(at(backup.secondaryCopy.verifiedAt) >= at(backup.artifact.createdAt), 'secondary copy predates the artifact');
  require(decryption.backupSetId === restore.backupSetId && decryption.descriptorSha256 === restore.descriptorSha256 && decryption.keyId === backup.encryption.keyId, 'decryption proof is not bound to the rehearsed backup');
  fresh(decryption.verifiedAt, 30 * day, 'private-key recovery');

  if (options.requireCurrentBackupRehearsal) {
    require(restore.backupSetId === backup.setId && restore.descriptorSha256 === backup.descriptorSha256, 'initial rehearsal must use the exact current backup');
  }
  fresh(restore.completedAt, 30 * day, 'restore rehearsal');
  ordered([restore.recoveryCheckpointAt, restore.startedAt, restore.quarantineVerifiedAt, restore.databaseIntegrityAt, restore.storageStartedAt, restore.storageRestoredAt, restore.completedAt], 'restore');
  require(restore.recoveryPointAgeAtStartMs === at(restore.startedAt) - at(restore.recoveryCheckpointAt) && restore.recoveryPointAgeAtStartMs <= day, 'measured RPO exceeds 24 hours or is inconsistent');
  require(restore.databaseRecoveryElapsedMs === at(restore.databaseIntegrityAt) - at(restore.startedAt), 'database RTO is inconsistent');
  require(restore.storageRecoveryElapsedMs === at(restore.storageRestoredAt) - at(restore.storageStartedAt), 'Storage RTO is inconsistent');
  require(restore.applicationRecoveryElapsedMs === at(restore.completedAt) - at(restore.storageRestoredAt), 'application RTO is inconsistent');
  require(restore.fullRecoveryElapsedMs === at(restore.completedAt) - at(restore.startedAt) && restore.fullRecoveryElapsedMs <= 2 * hour, 'measured full RTO exceeds 2 hours or is inconsistent');

  require(incident.runbookSha256 === expected.runbookSha256, 'incident runbook checksum does not match');
  fresh(incident.contactsAttestedAt, day, 'incident contacts');
  fresh(incident.drill.closedAt, 30 * day, 'incident drill');
  const drill = incident.drill;
  require(drill.targetProjectRef === restore.targetProjectRef, 'incident drill target does not match restore');
  ordered([restore.completedAt, drill.startedAt, drill.mutationReadBackAt, drill.detectedAt, drill.deliveredAt, drill.acknowledgedAt, drill.diagnosedAt, drill.restoredAt, drill.recoveredAt, drill.recoveryDeliveredAt, drill.closedAt, cleanup.verifiedAt], 'incident drill and cleanup');
  require(at(drill.acknowledgedAt) - at(drill.deliveredAt) <= 15 * 60 * 1000, 'incident acknowledgement exceeds 15 minutes');
  require(isolation.matrixSha256 === expected.isolationMatrixSha256, 'isolation matrix checksum does not match');
  fresh(isolation.checkedAt, day, 'environment isolation');
  require(isolation.restoreProjectRef === restore.targetProjectRef && isolation.sourceProjectRef === backup.sourceProjectRef, 'isolation identities do not match recovery');
  const forbidden = new Set([...isolation.forbiddenRefs, ...isolation.productionRefs, isolation.canonicalStagingRef, isolation.sourceProjectRef, expected.projectRef]);
  require(!forbidden.has(restore.targetProjectRef), 'restore target collides with a protected project');
  require(!isolation.productionRefs.includes(backup.sourceProjectRef), 'recovery source must not be production');
  require(isolation.productionRefs.every((ref) => isolation.forbiddenRefs.includes(ref)) && isolation.forbiddenRefs.includes(isolation.canonicalStagingRef), 'forbidden project inventory is incomplete');
  fresh(cleanup.verifiedAt, day, 'cleanup');
  require(cleanup.temporaryCredentialCount === cleanup.revokedTemporaryCredentialCount, 'temporary credential revocation is incomplete');
  require(new Set(cleanup.resources.map((resource) => `${resource.provider}:${resource.resourceIdSha256}`)).size === cleanup.resources.length, 'cleanup resource inventory contains duplicates');
  require(cleanup.resources.some((resource) => resource.provider === 'supabase' && resource.resourceIdSha256 === createHash('sha256').update(restore.targetProjectRef).digest('hex')), 'cleanup does not prove absence of the exact restore target');
  require(['grafana-stack', 'grafana-destination', 'grafana-rule', 'encrypted-backup', 'secondary-encrypted-copy'].every((kind) => cleanup.retainedResources.some((resource) => resource.kind === kind)), 'retained resource inventory is incomplete');

  /** @param {string} digest */
  const readDescriptor = (digest) => {
    const bytes = options.readEvidence?.(digest);
    if (!Buffer.isBuffer(bytes) || bytes.length > 1024 * 1024 ||
        createHash('sha256').update(bytes).digest('hex') !== digest) {
      throw new Error('descriptor unavailable');
    }
    return validateRecoveryDescriptor(JSON.parse(bytes.toString('utf8')));
  };
  try {
    const descriptor = readDescriptor(backup.descriptorSha256);
    require(descriptor.metadata.backupSetId === backup.setId &&
      descriptor.metadata.source.projectRef === backup.sourceProjectRef &&
      descriptor.metadata.source.classification === backup.sourceClassification &&
      descriptor.metadata.release.commitSha === expected.commitSha &&
      descriptor.metadata.release.treeSha === expected.treeSha &&
      descriptor.metadata.release.workerVersion === expected.workerVersion &&
      descriptor.metadata.startedAt === backup.checkpointAt &&
      descriptor.metadata.finishedAt === backup.completedAt, 'backup descriptor identity does not match');
    require(createHash('sha256').update(canonicalJson(descriptor.checkpoint)).digest('hex') === backup.checkpointSha256,
      'backup descriptor checkpoint does not match');
    require(descriptor.encryption.keyId === backup.encryption.keyId &&
      descriptor.encryption.keyId === backup.encryption.publicKeySha256 &&
      createHash('sha256').update(Buffer.from(descriptor.encryption.wrappedKey, 'base64')).digest('hex') === backup.encryption.wrappedKeySha256,
      'backup descriptor encryption does not match');
    require(recoveryContractDigest(descriptor) === restore.recoveryContractSha256, 'latest backup recovery contract does not match the rehearsal');
    for (const component of backup.components) {
      const matches = component.name === 'storage-manifest' ? [descriptor.manifest] :
        descriptor.components.filter((entry) => entry.kind === (component.name === 'storage-objects' ? 'storage-object' : component.name));
      const digest = component.name === 'storage-objects' ?
        createHash('sha256').update(canonicalJson(matches)).digest('hex') : matches[0]?.ciphertextSha256;
      require(component.sha256 === digest && component.sizeBytes === matches.reduce((total, entry) => total + entry.bytes, 0),
        'backup descriptor component integrity does not match');
    }
  } catch {
    failures.push('operations backup descriptor could not be verified');
  }

  try {
    const rehearsed = readDescriptor(restore.descriptorSha256);
    require(rehearsed.metadata.backupSetId === restore.backupSetId &&
      rehearsed.metadata.source.projectRef === isolation.sourceProjectRef &&
      rehearsed.metadata.release.commitSha === expected.commitSha &&
      rehearsed.metadata.release.treeSha === expected.treeSha &&
      rehearsed.metadata.release.workerVersion === expected.workerVersion &&
      rehearsed.metadata.startedAt === restore.recoveryCheckpointAt,
      'restore proof is not bound to the rehearsed backup identity');
    require(rehearsed.encryption.keyId === backup.encryption.keyId &&
      rehearsed.encryption.keyId === backup.encryption.publicKeySha256,
      'rehearsed backup owner key does not match the latest backup');
    require(recoveryContractDigest(rehearsed) === restore.recoveryContractSha256,
      'rehearsed backup recovery contract does not match');
    require(at(restore.startedAt) >= at(rehearsed.metadata.finishedAt), 'restore starts before its backup completed');
    require(at(decryption.verifiedAt) >= at(rehearsed.metadata.finishedAt), 'private-key recovery predates the backup');
  } catch {
    failures.push('operations rehearsed backup descriptor could not be verified');
  }

  for (const section of sections) {
    const { evidenceSha256, ...payload } = receipt[section];
    try {
      const bytes = options.readEvidence?.(evidenceSha256);
      require(Buffer.isBuffer(bytes) && bytes.length <= 1024 * 1024 && createHash('sha256').update(bytes).digest('hex') === evidenceSha256, `${section} evidence is missing or has a hash mismatch`);
      if (!Buffer.isBuffer(bytes) || bytes.length > 1024 * 1024) continue;
      const wanted = createOperationsEvidence(receipt, section, payload);
      require(wanted.bytes.equals(bytes), `${section} evidence does not match the receipt provenance`);
    } catch {
      // Never print parser, path, provider, or credential-bearing exception values.
      failures.push(`operations ${section} evidence could not be verified`);
    }
  }
  return failures;
}
