import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { canonicalJson, validateRecoveryDescriptor } from './recovery-set.mjs';
import { protectedMergeProofSchema } from './worker-adapter.mjs';
import {validateManifest} from './manifest.mjs';
import {validateApplicationReport} from './application-execution.mjs';
import {TARGET_DATABASE_CONTRACTS,validateTargetTap} from './target-integrity.mjs';

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
/** @typedef {'monitor'|'alerts'|'backup'|'decryption'|'restore'|'incident'|'isolation'|'cleanup'|'maintenance'} EvidenceSection */
/** @type {EvidenceSection[]} */
const sections = ['monitor', 'alerts', 'backup', 'decryption', 'restore', 'incident', 'isolation', 'cleanup', 'maintenance'];
const checks = object(Object.fromEntries([
  'schemaMigration', 'databaseStorageCheckpoint', 'authRecovery', 'rls', 'crossUserPrivacy',
  'oldSourceTokenDenied', 'freshTargetLogin', 'application', 'deals', 'safety',
  'finalizedImages', 'noOutboundEffects', 'noProductionConfiguration'
].map((name) => [name, yes])));

const receiptSchema = object({
  schemaVersion: z.literal(2), kind: z.literal('issue29-operations-readiness'),
  runId: identity, commitSha: gitSha, treeSha: gitSha, workerVersion: identity,
  environmentAlias: alias, projectRef, generatedAt: utc,
  releaseUpdate:object({protectedMergeSha256:sha256,workerReadbackSha256:sha256,monitorReadbackSha256:sha256,originalRehearsalDescriptorSha256:sha256}).optional(),
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
      destinationAlias: alias, verifiedAt: utc, descriptorSha256:sha256, componentInventorySha256:sha256, copyEvidenceSha256:sha256, privateKeyCoLocated: z.literal(false)
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
    storageStartedAt: utc, storageRestoredAt: utc, applicationStartedAt:utc, completedAt: utc,
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
  maintenance: object({
    id:identity, phase:z.literal('closed'), sourceRef:projectRef, sourceWorkerName:alias,
    authorizedAt:utc, expiresAt:utc, pausedAt:utc, pauseReadbackSha256:sha256,
    resumedAt:utc, resumeReadbackSha256:sha256, endedAt:utc,
    backup:object({descriptorSha256:sha256,artifactSha256:sha256,checkpointSha256:sha256,verifiedAt:utc,retentionVerifiedAt:utc}),
    preservation:object({identitySha256:sha256,configSha256:sha256,provenanceSha256:sha256,workerSha256:sha256}),
    resumeProof:object({checkedAt:utc,identitySha256:sha256,configSha256:sha256,provenanceSha256:sha256,workerSha256:sha256,checkpointSha256:sha256,readinessSha256:sha256,evidenceSha256:sha256}),
    monitoring:object({beganAt:utc,endedAt:utc,sourceConfigSha256:sha256,evidenceSha256:sha256,endEvidenceSha256:sha256}),
    targetProjectRef:projectRef,targetWorkerName:alias,targetAbsentAt:utc,targetWorkerAbsentAt:utc,
    evidenceSha256:sha256
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
      alias, kind: z.enum(['grafana-stack', 'grafana-destination', 'grafana-rule', 'encrypted-backup', 'secondary-encrypted-copy', 'synthetic-source', 'synthetic-worker']), resourceIdSha256: sha256.optional()
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
  const { monitor, alerts, backup, decryption, restore, incident, isolation, cleanup, maintenance } = receipt;
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
  fresh(backup.secondaryCopy.verifiedAt, 30 * day, 'secondary encrypted copy');
  require(decryption.backupSetId === restore.backupSetId && decryption.descriptorSha256 === restore.descriptorSha256 && decryption.keyId === backup.encryption.keyId, 'decryption proof is not bound to the rehearsed backup');
  fresh(decryption.verifiedAt, 30 * day, 'private-key recovery');

  if (options.requireCurrentBackupRehearsal && !receipt.releaseUpdate) {
    require(restore.backupSetId === backup.setId && restore.descriptorSha256 === backup.descriptorSha256, 'initial rehearsal must use the exact current backup');
  }
  fresh(restore.completedAt, 30 * day, 'restore rehearsal');
  ordered([restore.recoveryCheckpointAt, restore.startedAt, restore.quarantineVerifiedAt, restore.storageStartedAt, restore.storageRestoredAt, restore.applicationStartedAt, restore.completedAt], 'restore');
  ordered([restore.quarantineVerifiedAt,restore.databaseIntegrityAt,restore.completedAt],'database/Auth integrity');
  require(restore.recoveryPointAgeAtStartMs === at(restore.startedAt) - at(restore.recoveryCheckpointAt) && restore.recoveryPointAgeAtStartMs <= day, 'measured RPO exceeds 24 hours or is inconsistent');
  require(restore.databaseRecoveryElapsedMs === at(restore.databaseIntegrityAt) - at(restore.startedAt), 'database RTO is inconsistent');
  require(restore.storageRecoveryElapsedMs === at(restore.storageRestoredAt) - at(restore.storageStartedAt), 'Storage RTO is inconsistent');
  require(restore.applicationRecoveryElapsedMs === at(restore.completedAt) - at(restore.applicationStartedAt), 'application RTO is inconsistent');
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
  require(backup.sourceProjectRef!==isolation.canonicalStagingRef,'preserved staging cannot be a recovery source');
  require(!isolation.productionRefs.includes(backup.sourceProjectRef), 'recovery source must not be production');
  require(isolation.productionRefs.every((ref) => isolation.forbiddenRefs.includes(ref)) && isolation.forbiddenRefs.includes(isolation.canonicalStagingRef), 'forbidden project inventory is incomplete');
  fresh(cleanup.verifiedAt, day, 'cleanup');
  require(cleanup.temporaryCredentialCount === cleanup.revokedTemporaryCredentialCount, 'temporary credential revocation is incomplete');
  require(new Set(cleanup.resources.map((resource) => `${resource.provider}:${resource.resourceIdSha256}`)).size === cleanup.resources.length, 'cleanup resource inventory contains duplicates');
  require(cleanup.resources.some((resource) => resource.provider === 'supabase' && resource.resourceIdSha256 === createHash('sha256').update(restore.targetProjectRef).digest('hex')), 'cleanup does not prove absence of the exact restore target');
  require(['grafana-stack', 'grafana-destination', 'grafana-rule', 'encrypted-backup', 'secondary-encrypted-copy'].every((kind) => cleanup.retainedResources.some((resource) => resource.kind === kind)), 'retained resource inventory is incomplete');

  /** @param {string} digest */
  const readHashedJson=(digest)=>{const bytes=options.readEvidence?.(digest);if(!Buffer.isBuffer(bytes)||bytes.length>1024*1024||createHash('sha256').update(bytes).digest('hex')!==digest)throw new Error('readback hash mismatch');return JSON.parse(bytes.toString('utf8'));};
  /** @type {{fromCandidate:{sha:string,tree:string,deploymentId:string},previousConfigSha256:string}|undefined} */
  let adoptedRelease;
  if(receipt.releaseUpdate){try{
    const binding=receipt.releaseUpdate,merge=protectedMergeProofSchema.parse(readHashedJson(binding.protectedMergeSha256));
    const resourceSchema=object({status:z.literal('verified'),kind:z.enum(['folder','secret','receiver','check','rule']),key:identity,configSha256:sha256,resourceId:identity,evidenceSha256:sha256,readBackAt:utc});
    const transitionSchema=object({schemaVersion:z.literal(1),kind:z.literal('issue29-grafana-release-update'),evidenceMode:z.literal('provider-readback'),runId:identity,previousCandidateSha:gitSha,candidateSha:gitSha,previousConfigSha256:sha256,configSha256:sha256,environmentAlias:alias,origin:z.url(),verifiedAt:utc,protectedMergeEvidenceSha256:sha256,resources:z.array(resourceSchema.extend({previousCandidateSha:gitSha,candidateSha:gitSha,priorStateSha256:sha256})).length(13),configuration:object({status:z.literal('verified'),candidateSha:gitSha,configSha256:sha256,verifiedAt:utc,resources:z.array(resourceSchema).length(16),evidenceSha256:sha256})});
    const transition=transitionSchema.parse(readHashedJson(binding.monitorReadbackSha256));
    const worker=object({evidenceMode:z.literal('provider-readback'),workerName:alias,accountId:z.string().regex(/^[a-f0-9]{32}$/u),purpose:z.literal('source'),versionId:identity,candidateSha:gitSha,candidateTree:gitSha,projectRef,createdAt:utc,configSha256:sha256,origin:z.url(),status:z.literal('verified'),checkedAt:utc,evidenceSha256:sha256}).parse(readHashedJson(binding.workerReadbackSha256));
    require(merge.evidenceMode==='provider-readback'&&merge.mergeSha===expected.commitSha&&merge.treeSha===expected.treeSha&&merge.fromCandidate.tree===expected.treeSha&&merge.fromCandidate.sha!==expected.commitSha,'protected merge does not preserve the reviewed candidate tree');
    require(merge.repository==='todevan/perfume-marketplace-bg','protected merge repository does not match');
    require(binding.originalRehearsalDescriptorSha256===restore.descriptorSha256&&at(restore.completedAt)<=at(merge.mergedAt)&&at(maintenance.endedAt)<=at(merge.mergedAt),'protected merge must follow the exact completed original rehearsal');
    require(worker.workerName===`issue29-${receipt.runId}`&&worker.projectRef===expected.projectRef&&worker.candidateSha===expected.commitSha&&worker.candidateTree===expected.treeSha&&worker.versionId===expected.workerVersion&&worker.versionId!==merge.fromCandidate.deploymentId,'merged Worker readback does not match');
    require(transition.runId===receipt.runId&&transition.previousCandidateSha===merge.fromCandidate.sha&&transition.candidateSha===expected.commitSha&&transition.configSha256===monitor.configSha256&&transition.environmentAlias===expected.environmentAlias&&transition.origin===worker.origin&&transition.protectedMergeEvidenceSha256===binding.protectedMergeSha256,'merged monitor target/configuration does not match');
    require(transition.configuration.candidateSha===expected.commitSha&&transition.configuration.configSha256===monitor.configSha256&&new Set(transition.resources.map(r=>r.key)).size===13&&transition.resources.filter(r=>r.kind==='check').length===2&&transition.resources.filter(r=>r.kind==='rule').length===11,'merged monitor resource inventory does not match');
    require(transition.resources.every(r=>r.previousCandidateSha===merge.fromCandidate.sha&&r.candidateSha===expected.commitSha&&r.configSha256===monitor.configSha256&&transition.configuration.resources.some(c=>c.key===r.key&&c.kind===r.kind&&c.resourceId===r.resourceId&&c.configSha256===r.configSha256)),'merged monitor exact resource readbacks do not match');
    ordered([merge.mergedAt,merge.verifiedAt,worker.createdAt,transition.verifiedAt,monitor.readBackAt],'protected release adoption');
    ordered([worker.createdAt,worker.checkedAt,monitor.readBackAt],'current merged Worker readback');
    require(at(backup.checkpointAt)>=at(transition.verifiedAt),'merged daily backup predates the actual persistent release update');
    fresh(worker.checkedAt,day,'merged Worker readback');
    adoptedRelease={fromCandidate:merge.fromCandidate,previousConfigSha256:transition.previousConfigSha256};
  }catch{failures.push('operations protected release adoption evidence could not be verified');}}

  const sourceWorker=`issue29-${receipt.runId}`, targetWorker=`issue29-restore-${maintenance.id}`;
  const hashId=(/** @type {string} */value)=>createHash('sha256').update(value).digest('hex');
  require(maintenance.sourceRef===expected.projectRef&&maintenance.sourceRef===backup.sourceProjectRef&&maintenance.sourceWorkerName===sourceWorker,'maintenance source identity does not match');
  require(maintenance.targetProjectRef===restore.targetProjectRef&&maintenance.targetWorkerName===targetWorker,'maintenance disposable identity does not match');
  require(maintenance.backup.descriptorSha256===restore.descriptorSha256,'maintenance backup does not match the rehearsed set');
  require(at(maintenance.expiresAt)>at(maintenance.authorizedAt)&&at(maintenance.expiresAt)-at(maintenance.authorizedAt)<=2*hour&&at(maintenance.endedAt)<=at(maintenance.expiresAt),'maintenance exceeded its authorized window');
  ordered([maintenance.backup.verifiedAt,maintenance.authorizedAt,maintenance.monitoring.beganAt,maintenance.pausedAt,restore.startedAt,drill.closedAt,maintenance.targetAbsentAt,maintenance.resumedAt,maintenance.resumeProof.checkedAt,maintenance.monitoring.endedAt,maintenance.endedAt,cleanup.verifiedAt],'two-slot maintenance');
  require(at(maintenance.backup.retentionVerifiedAt)<=at(maintenance.authorizedAt)&&at(maintenance.authorizedAt)-at(maintenance.backup.retentionVerifiedAt)<=5*60*1000&&at(maintenance.authorizedAt)-at(maintenance.backup.verifiedAt)<=5*60*1000,'maintenance backup verification is stale');
  require(at(decryption.verifiedAt)<=at(maintenance.pausedAt),'maintenance pause preceded owner decryption proof');
  require(at(maintenance.targetWorkerAbsentAt)>=at(drill.closedAt)&&at(maintenance.targetWorkerAbsentAt)<=at(maintenance.resumedAt),'target Worker absence must precede source resume');
  for(const key of /** @type {const} */(['identitySha256','configSha256','provenanceSha256','workerSha256']))require(maintenance.resumeProof[key]===maintenance.preservation[key],'resumed source preservation proof does not match');
  require(maintenance.resumeProof.checkpointSha256===maintenance.backup.checkpointSha256,'resumed source checkpoint does not match');
  require(maintenance.monitoring.sourceConfigSha256===(adoptedRelease?.previousConfigSha256??monitor.configSha256),'maintenance monitor configuration does not match');
  fresh(maintenance.endedAt,30*day,'maintenance completion');
  require(at(monitor.readBackAt)>=at(maintenance.monitoring.endedAt)&&at(monitor.heartbeatAt)>=at(maintenance.monitoring.endedAt),'persistent monitoring was not independently checked after maintenance');
  require(cleanup.resources.some(r=>r.provider==='cloudflare'&&r.resourceIdSha256===hashId(targetWorker)),'cleanup does not prove exact target Worker absence');
  require(!cleanup.resources.some(r=>r.resourceIdSha256===hashId(sourceWorker)||r.resourceIdSha256===hashId(backup.sourceProjectRef)),'cleanup must not delete persistent source resources');
  for(const [kind,id] of [['synthetic-source',backup.sourceProjectRef],['synthetic-worker',sourceWorker]])require(cleanup.retainedResources.filter(r=>r.kind===kind&&r.resourceIdSha256===hashId(id)).length===1,'persistent source resource inventory does not match');
  // Referenced readbacks are private content-addressed observations, not standalone asserted hashes.
  for(const digest of [maintenance.backup.artifactSha256,maintenance.pauseReadbackSha256,maintenance.resumeReadbackSha256,...Object.values(maintenance.preservation),maintenance.resumeProof.readinessSha256,maintenance.resumeProof.evidenceSha256,maintenance.monitoring.evidenceSha256,maintenance.monitoring.endEvidenceSha256]){
    try{const bytes=options.readEvidence?.(digest);require(Buffer.isBuffer(bytes)&&bytes.length<=1024*1024&&createHash('sha256').update(bytes).digest('hex')===digest,'maintenance referenced readback is unavailable or corrupt');}
    catch{failures.push('operations maintenance referenced readback could not be verified');}
  }

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
    require(hashId(canonicalJson(rehearsed.checkpoint))===maintenance.backup.checkpointSha256,'maintenance checkpoint does not match rehearsed descriptor');
    require(rehearsed.metadata.backupSetId === restore.backupSetId &&
      rehearsed.metadata.source.projectRef === isolation.sourceProjectRef &&
      rehearsed.metadata.release.commitSha === (adoptedRelease?.fromCandidate.sha??expected.commitSha) &&
      rehearsed.metadata.release.treeSha === expected.treeSha &&
      rehearsed.metadata.release.workerVersion === (adoptedRelease?.fromCandidate.deploymentId??expected.workerVersion) &&
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

  try {
    const secondary=backup.secondaryCopy;
    const copy=object({schemaVersion:z.literal(1),provider:z.literal('owner-encrypted-retention'),runId:identity,sourceRef:projectRef,destinationAlias:alias,destinationSha256:sha256,descriptorSha256:sha256,retentionDays:z.literal(35),expiresAt:utc,verifiedAt:utc,componentInventorySha256:sha256,encryptedOnly:yes,workflowProof:z.literal(false)}).parse(readHashedJson(secondary.copyEvidenceSha256));
    require([backup.descriptorSha256,restore.descriptorSha256].includes(secondary.descriptorSha256),'secondary encrypted copy is not a verified recovery set');
    const copied=readDescriptor(secondary.descriptorSha256),inventory=hashId(canonicalJson([...copied.components,copied.manifest]));
    require(copy.runId===receipt.runId&&copy.sourceRef===backup.sourceProjectRef&&copy.descriptorSha256===secondary.descriptorSha256&&copy.destinationAlias===secondary.destinationAlias&&copy.verifiedAt===secondary.verifiedAt&&copy.expiresAt===copied.retention.expiresAt,'secondary encrypted copy identity does not match');
    require(copy.componentInventorySha256===inventory&&secondary.componentInventorySha256===inventory,'secondary encrypted copy hash does not match');
    require(at(copy.verifiedAt)>=at(copied.metadata.finishedAt)&&at(copy.expiresAt)>now,'secondary encrypted copy is incomplete or expired');
  }catch{failures.push('operations secondary encrypted copy evidence could not be verified');}

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

/** Assemble normalized public fields only from selected, hash-bound command outputs. No caller may
 * supply a ready-made section or a PASS bit. The returned evidence remains private until the full
 * independent validator succeeds. Provider adapters, not this encoder, perform hosted actions.
 * @param {{manifest:unknown,records:unknown,now:number,readEvidence:(hash:string)=>Buffer|undefined,runbookSha256:string}} input */
export function assembleOperationsReadiness(input){
 try{return assembleObserved(input);}catch{throw new Error('operations producer evidence is incomplete or invalid');}
}
/** @param {{manifest:unknown,records:unknown,now:number,readEvidence:(hash:string)=>Buffer|undefined,runbookSha256:string}} input */
function assembleObserved(input){
 const recordNames=['monitor','alerts','application','incident','isolation','artifact','decryption','secondaryCopy','contacts','cleanup','latestDescriptor'];
 const refs=object(Object.fromEntries(recordNames.map(name=>[name,sha256]))).parse(input.records);
 /** @type {Map<string,Buffer>} */const evidence=new Map();
 /** @param {unknown} condition */const assert=condition=>{if(!condition)throw new Error('producer mismatch');};
 /** @param {string} key */const bytes=key=>{const value=input.readEvidence(key);assert(Buffer.isBuffer(value)&&value.length<=1048576&&createHash('sha256').update(/** @type {Buffer} */(value)).digest('hex')===key);evidence.set(key,/** @type {Buffer} */(value));return /** @type {Buffer} */(value);};
 /** @param {string} key @returns {any} */const read=key=>JSON.parse(bytes(key).toString('utf8'));
 /** @type {any} */const m=validateManifest(structuredClone(input.manifest),{now:new Date(input.now).toISOString()});
 assert(m?.schemaVersion===2&&m.issue===29&&m.state==='cleanup_verified'&&m.pending===null&&m.terminal===null&&m.humanBoundary===null&&m.maximumCost===0&&m.source&&m.target&&m.maintenance?.phase==='closed'&&m.cleanup?.authorized===true&&Array.isArray(m.history));
 /** @param {string} key @param {string[]} steps */const owned=(key,steps)=>assert(m.history.some((/** @type {any} */h)=>h.evidenceSha256===key&&steps.includes(h.step)));
 for(const [name,steps]of [['monitor',['monitoring-proof']],['alerts',['monitoring-proof']],['application',['verify-restore']],['incident',['incident-drill']],['decryption',['verify-backup']],['secondaryCopy',['artifact-upload']],['cleanup',['cleanup']],['isolation',['verify-restore']]])owned(refs[/** @type {string} */(name)],/** @type {string[]} */(steps));
 const monitor=read(refs.monitor),alerts=read(refs.alerts),app=read(refs.application),incident=read(refs.incident),isolation=read(refs.isolation),artifact=read(refs.artifact),decryption=read(refs.decryption),copy=read(refs.secondaryCopy),contacts=read(refs.contacts),cleanup=read(refs.cleanup);
 const latest=validateRecoveryDescriptor(read(refs.latestDescriptor)),rehearsed=validateRecoveryDescriptor(read(m.maintenance.backup.descriptorSha256));
 const release=m.releaseUpdate?.fromCandidate??m.candidate;
 assert(monitor.status==='verified'&&monitor.configuration?.status==='verified'&&monitor.configuration.candidateSha===m.candidate.sha&&monitor.configuration.configSha256===m.grafana.configSha256&&monitor.configuration.resources.length===16&&monitor.checks?.length===11&&monitor.checks.every((/** @type {any} */c)=>c.score?.score===0&&c.state?.state==='inactive')&&monitor.heartbeatAt===monitor.heartbeat?.heartbeatAt);
 assert(alerts.status==='verified'&&alerts.evidenceMode==='provider-readback'&&alerts.runId===m.runId&&alerts.candidateSha===release.sha&&alerts.destinationAlias==='owner-primary'&&alerts.timelines?.length===11&&alerts.ruleMappings?.length===11&&new Set(alerts.ruleMappings.map((/** @type {any} */r)=>r.ruleKey)).size===11&&signals.every(s=>alerts.ruleMappings.some((/** @type {any} */r)=>r.signal===s)));
 assert(alerts.sourceConfigSha256===(m.releaseUpdate?m.maintenance.monitoring.sourceConfigSha256:m.grafana.configSha256));
 for(const timeline of alerts.timelines){assert(alerts.ruleMappings.some((/** @type {any} */r)=>r.ruleKey===timeline.ruleKey)&&timeline.destinationAlias==='owner-primary'&&Date.parse(timeline.deliveredAt)<=Date.parse(timeline.acknowledgedAt)&&Date.parse(timeline.acknowledgedAt)-Date.parse(timeline.deliveredAt)<=900000&&input.now-Date.parse(timeline.deliveredAt)<=day&&input.now-Date.parse(timeline.recoveryDeliveredAt)<=day);bytes(timeline.ackEvidenceSha256);}
 const representative=alerts.timelines.find((/** @type {any} */t)=>alerts.ruleMappings.some((/** @type {any} */r)=>r.ruleKey===t.ruleKey&&r.signal==='storage'));assert(representative);
 assert(app.kind==='issue29-application-integrity'&&app.status==='verified'&&app.runId===m.runId&&app.maintenanceId===m.maintenance.id&&app.targetRef===m.target.ref&&app.candidate.sha===release.sha&&app.candidate.tree===m.candidate.tree&&app.measurement?.withinTargets===true&&app.credentialCleanup?.absent===true);
 const preparation=read(app.preparationSha256);assert(preparation.kind==='issue29-application-preparation'&&preparation.runId===m.runId&&preparation.targetRef===m.target.ref&&preparation.restore?.descriptorSha256===m.maintenance.backup.descriptorSha256&&preparation.restore.status==='DATABASE_STORAGE_VERIFIED_APPLICATION_PROOF_PENDING');
 assert(preparation.contracts?.kind==='issue29-target-database-contracts'&&preparation.contracts.rolledBack===true&&preparation.contracts.contracts?.length===5&&preparation.contracts.testCount>0&&preparation.contracts.targetRef===m.target.ref&&preparation.contracts.candidateSha===release.sha&&preparation.contracts.treeSha===m.candidate.tree);
 assert(app.auth?.kind==='issue29-target-auth'&&app.auth.oldSourceTokenDenied===true&&app.auth.targetRef===m.target.ref&&app.auth.actors?.length===4&&['seller','buyer','outsider','future-staff'].every(alias=>app.auth.actors.filter((/** @type {any} */a)=>a.alias===alias&&a.freshLoginVerified===true&&a.aal===(alias==='future-staff'?'aal2':'aal1')).length===1));
 const browser=read(app.browser.reportSha256),browserProof=validateApplicationReport(browser,browser.config.metadata.issue29,app.verifiedAt);assert(canonicalJson(browserProof)===canonicalJson(app.browser)&&app.browser.candidateSha===release.sha&&app.browser.treeSha===m.candidate.tree&&app.browser.targetRef===m.target.ref);
 for(const contract of preparation.contracts.contracts){assert(TARGET_DATABASE_CONTRACTS.includes(contract.name));const actual=validateTargetTap(bytes(contract.outputSha256).toString('utf8'),contract.name,contract.sourceSha256);assert(canonicalJson(actual)===canonicalJson(contract));}
 assert(incident.status==='verified'&&incident.evidenceMode==='provider-readback'&&incident.runId===m.runId&&incident.projectRef===m.target.ref&&incident.candidateSha===release.sha&&incident.runbookSha256===input.runbookSha256&&incident.rollbackDecision?.decision==='fixture-restore-only');
 assert(isolation.schemaVersion===1&&isolation.kind==='issue29-environment-isolation'&&isolation.evidenceMode==='provider-readback'&&isolation.runId===m.runId&&isolation.sourceRef===m.source.ref&&isolation.targetRef===m.target.ref&&isolation.candidate.sha===release.sha&&isolation.candidate.tree===m.candidate.tree&&isolation.classificationBasis==='owner-environment-map-and-live-identity-readback'&&['productionReadOnly','sourceSyntheticVerified','targetDedicatedVerified','noForeignStateVerified','noSharedCredentialsVerified'].every(key=>isolation[key]===true));
 for(const key of ['sourceProvenanceSha256','providerPreflightSha256','quarantineSha256','sourceWorkerSha256','targetWorkerSha256','sourcePausedSha256'])bytes(isolation[key]);
 assert(artifact.kind==='issue29-artifact-readback'&&artifact.repository==='todevan/perfume-marketplace-bg'&&artifact.candidateSha===m.candidate.sha&&artifact.recovery?.descriptorSha256===refs.latestDescriptor&&artifact.recovery.componentInventorySha256===createHash('sha256').update(canonicalJson([...latest.components,latest.manifest])).digest('hex'));
 assert(decryption.status==='OWNER_KEY_RECOVERY_VERIFIED'&&decryption.decryptionVerified===true&&decryption.descriptorSha256===m.maintenance.backup.descriptorSha256&&decryption.keyId===latest.encryption.keyId&&decryption.componentCount===rehearsed.components.length);
 assert(copy.provider==='owner-encrypted-retention'&&copy.runId===m.runId&&copy.sourceRef===m.source.ref&&copy.encryptedOnly===true&&copy.workflowProof===false);
 const owner=object({schemaVersion:z.literal(1),kind:z.literal('issue29-owner-contact-attestation'),runId:identity,roleAlias:z.literal('owner'),runbookSha256:sha256,contactMapAlias:z.literal('owner-private-contact-map'),attestedAt:utc,privateKeyCustody:z.literal('owner-offline'),privateKeyRetainedByAutomation:z.literal(false),privateKeyCoLocatedWithSecondary:z.literal(false)}).parse(contacts);assert(owner.runId===m.runId&&owner.runbookSha256===input.runbookSha256);
 assert(cleanup.kind==='issue29-final-cleanup'&&cleanup.evidenceMode==='provider-readback'&&cleanup.runId===m.runId&&cleanup.candidate.sha===m.candidate.sha&&cleanup.candidate.tree===m.candidate.tree&&cleanup.maintenanceId===m.maintenance.id&&cleanup.maximumCost===0&&cleanup.observations?.length===m.cleanup.resources.filter((/** @type {any} */r)=>r.disposition==='disposable').length);
 /** @param {string} value */const hashId=value=>createHash('sha256').update(value).digest('hex');
 const cleanupResources=[];
 for(const resource of m.cleanup.resources.filter((/** @type {any} */r)=>r.disposition==='disposable'&&r.provider!=='supabase-storage')){
  assert(resource.absentAt&&['supabase','cloudflare','grafana'].includes(resource.provider));
  const observationIndex=cleanup.observations.findIndex((/** @type {any} */o)=>o.provider===resource.provider&&o.resourceId===resource.id);assert(observationIndex>=0);const observation=cleanup.observations[observationIndex];assert(observation.proof?.absent===true||observation.proof?.status==='absent'||(observation.proof?.status==='expired'&&observation.proof.effectiveAbsence===true));
  const created=m.history.find((/** @type {any} */h)=>h.evidenceSha256===resource.evidenceSha256&&h.intentSha256);assert(created);
  const removed=m.history.filter((/** @type {any} */h)=>h.intentSha256&&h.completedAt===resource.absentAt&&h.operationId!==created.operationId).find((/** @type {any} */h)=>{const intent=read(h.intentSha256);return intent.pending?.resourceId===resource.id||intent.pending?.resourceId===resource.id.split(':').slice(1).join(':');});assert(removed);
  const createIntent=read(created.intentSha256),removeIntent=read(removed.intentSha256);assert(createIntent.runId===m.runId&&removeIntent.runId===m.runId&&createIntent.pending.operationId===created.operationId&&removeIntent.pending.operationId===removed.operationId);
  bytes(resource.evidenceSha256);bytes(removed.evidenceSha256);bytes(cleanup.observationSha256[observationIndex]);
  cleanupResources.push({provider:resource.provider,resourceIdSha256:hashId(resource.id),createdIntentSha256:created.intentSha256,createdReadbackSha256:resource.evidenceSha256,deleteIntentSha256:removed.intentSha256,deleteReadbackSha256:removed.evidenceSha256,absenceReadbackSha256:cleanup.observationSha256[observationIndex],absent:true});
 }
 const worker=cleanup.persistent.workerBinding;assert(worker.workerName===`issue29-${m.runId}`&&worker.projectRef===m.source.ref&&worker.versionId===m.candidate.deploymentId);
 const componentInventory=components.map(name=>{const matches=name==='storage-manifest'?[latest.manifest]:latest.components.filter(c=>c.kind===(name==='storage-objects'?'storage-object':name));return{name,sha256:name==='storage-objects'?hashId(canonicalJson(matches)):matches[0]?.ciphertextSha256,sizeBytes:matches.reduce((n,c)=>n+c.bytes,0)};});
 const timing=m.recoveryTimings;assert(timing?.startedAt&&timing.storageStartedAt&&timing.storageVerifiedAt&&app.applicationStartedAt);
 const quarantine=m.history.find((/** @type {any} */h)=>h.step==='quarantine'&&h.resourceId===m.target.ref);assert(quarantine);bytes(quarantine.evidenceSha256);
 const retained=[{alias:'synthetic-source',kind:'synthetic-source',resourceIdSha256:hashId(m.source.ref)},{alias:'synthetic-worker',kind:'synthetic-worker',resourceIdSha256:hashId(worker.workerName)},{alias:m.grafana.stackAlias,kind:'grafana-stack'},{alias:'owner-primary',kind:'grafana-destination'},{alias:'launch-readiness',kind:'grafana-rule'},{alias:latest.metadata.destinationAlias,kind:'encrypted-backup',resourceIdSha256:hashId(String(artifact.artifactId))},{alias:copy.destinationAlias,kind:'secondary-encrypted-copy',resourceIdSha256:hashId(`owner-copy:${copy.descriptorSha256}`)}];
 const credentialCount=cleanupResources.filter(r=>r.provider==='supabase'||r.provider==='cloudflare').length+cleanup.observations.filter((/** @type {any} */o)=>o.provider==='grafana'&&o.resourceId.startsWith('secret:')).length+1;
 /** @type {any} */const receipt={schemaVersion:2,kind:'issue29-operations-readiness',runId:m.runId,commitSha:m.candidate.sha,treeSha:m.candidate.tree,workerVersion:m.candidate.deploymentId,environmentAlias:latest.metadata.source.environmentAlias,projectRef:m.source.ref,generatedAt:new Date(input.now).toISOString(),
  monitor:{provider:'grafana-cloud-free',stackAlias:m.grafana.stackAlias,destinationAlias:'owner-primary',targetProjectRef:m.source.ref,targetEnvironmentAlias:latest.metadata.source.environmentAlias,targetCommitSha:m.candidate.sha,targetWorkerVersion:m.candidate.deploymentId,configSha256:m.grafana.configSha256,readBackAt:monitor.checkedAt,heartbeatAt:monitor.heartbeatAt,signalFamilies:signals,maxCost:0},
  alerts:{configSha256:m.grafana.configSha256,targetProjectRef:m.source.ref,destinationAlias:'owner-primary',failureEventId:representative.failureEventId,recoveryEventId:representative.recoveryEventId,firedAt:representative.firedAt,deliveredAt:representative.deliveredAt,acknowledgedAt:representative.acknowledgedAt,recoveredAt:representative.recoveryEvaluatedAt,recoveryDeliveredAt:representative.recoveryDeliveredAt,provedSignalFamilies:signals},
  backup:{setId:latest.metadata.backupSetId,descriptorSha256:refs.latestDescriptor,sourceProjectRef:m.source.ref,sourceClassification:latest.metadata.source.classification,sourceCommitSha:latest.metadata.release.commitSha,checkpointSha256:hashId(canonicalJson(latest.checkpoint)),checkpointAt:latest.metadata.startedAt,completedAt:latest.metadata.finishedAt,verifiedAt:latest.metadata.finishedAt,components:componentInventory,artifact:{provider:'github-actions',id:String(artifact.artifactId),createdAt:artifact.createdAt,expiresAt:artifact.expiresAt,retentionDays:35,readBackAt:artifact.verifiedAt,downloadVerifiedAt:artifact.verifiedAt,sizeBytes:artifact.sizeBytes,sha256:artifact.sha256},encryption:{algorithm:'AES-256-GCM',envelopeVersion:1,keyId:latest.encryption.keyId,publicKeySha256:latest.encryption.keyId,wrappedKeySha256:createHash('sha256').update(Buffer.from(latest.encryption.wrappedKey,'base64')).digest('hex')},secondaryCopy:{destinationAlias:copy.destinationAlias,verifiedAt:copy.verifiedAt,descriptorSha256:copy.descriptorSha256,componentInventorySha256:copy.componentInventorySha256,copyEvidenceSha256:refs.secondaryCopy,privateKeyCoLocated:false}},
  decryption:{backupSetId:decryption.backupSetId,descriptorSha256:decryption.descriptorSha256,keyId:decryption.keyId,verifiedAt:decryption.independentlyVerifiedAt,allComponentsAuthenticated:true,privateKeyCustody:owner.privateKeyCustody,privateKeyRetainedByAutomation:false},
  restore:{backupSetId:rehearsed.metadata.backupSetId,descriptorSha256:m.maintenance.backup.descriptorSha256,targetAlias:'disposable-restore',targetProjectRef:m.target.ref,recoveryCheckpointAt:rehearsed.metadata.startedAt,recoveryContractSha256:recoveryContractDigest(rehearsed),startedAt:timing.startedAt,quarantineVerifiedAt:quarantine.completedAt,databaseIntegrityAt:app.databaseAuthIntegrityAt,storageStartedAt:timing.storageStartedAt,storageRestoredAt:timing.storageVerifiedAt,applicationStartedAt:app.applicationStartedAt,completedAt:app.verifiedAt,...Object.fromEntries(Object.entries(app.measurement).filter(([key])=>key!=='withinTargets')),checks:Object.fromEntries(Object.keys(checks.shape).map(key=>[key,true]))},
  incident:{runbookSha256:input.runbookSha256,roles:{incidentCommander:'owner',technicalLead:'authorized-operator',privacyCommunications:'owner',backupRestoreOperator:'authorized-operator'},contactMapAlias:owner.contactMapAlias,contactsAttestedAt:owner.attestedAt,drill:{kind:'storage-sentinel',targetProjectRef:m.target.ref,startedAt:incident.startedAt,mutationReadBackAt:incident.mutationReadBackAt,detectedAt:incident.detectedAt,deliveredAt:incident.deliveredAt,acknowledgedAt:incident.acknowledgedAt,diagnosedAt:incident.diagnosedAt,restoredAt:incident.recoveredAt,recoveredAt:incident.recoveryEvaluatedAt,recoveryDeliveredAt:incident.recoveryDeliveredAt,closedAt:incident.closedAt}},
  isolation:{matrixSha256:refs.isolation,checkedAt:isolation.checkedAt,sourceProjectRef:m.source.ref,restoreProjectRef:m.target.ref,productionRefs:isolation.preserved.productionRefs,canonicalStagingRef:isolation.preserved.canonicalStagingRef,forbiddenRefs:isolation.preserved.forbiddenRefs,productionReadOnly:true,sourceSyntheticVerified:true,targetDedicatedVerified:true,noForeignStateVerified:true,noSharedCredentialsVerified:true},
  maintenance:{...structuredClone(m.maintenance),sourceWorkerName:`issue29-${m.runId}`,targetProjectRef:m.target.ref,targetWorkerName:`issue29-restore-${m.maintenance.id}`,targetAbsentAt:m.cleanup.resources.find((/** @type {any} */r)=>r.provider==='supabase'&&r.id===m.target.ref)?.absentAt,targetWorkerAbsentAt:m.cleanup.resources.find((/** @type {any} */r)=>r.provider==='cloudflare'&&r.id===`issue29-restore-${m.maintenance.id}`)?.absentAt},
  cleanup:{state:'cleanup_verified',verifiedAt:cleanup.verifiedAt,pendingMutationCount:0,resources:cleanupResources,temporaryCredentialCount:credentialCount,revokedTemporaryCredentialCount:credentialCount,retainedResources:retained,cost:0}};
 delete receipt.maintenance.schemaVersion;delete receipt.maintenance.monitoring.silences;
 if(m.releaseUpdate){const transition=m.history.filter((/** @type {any} */h)=>h.step==='configure-monitoring'&&h.resourceId?.startsWith('source-release-update-')).at(-1);assert(transition);bytes(transition.evidenceSha256);bytes(m.releaseUpdate.evidenceSha256);bytes(cleanup.persistentSha256.workerBinding);receipt.releaseUpdate={protectedMergeSha256:m.releaseUpdate.evidenceSha256,workerReadbackSha256:cleanup.persistentSha256.workerBinding,monitorReadbackSha256:transition.evidenceSha256,originalRehearsalDescriptorSha256:m.maintenance.backup.descriptorSha256};}
 for(const section of sections){const generated=createOperationsEvidence(receipt,section,receipt[section]);receipt[section].evidenceSha256=generated.sha256;evidence.set(generated.sha256,generated.bytes);}
 const expected={commitSha:receipt.commitSha,treeSha:receipt.treeSha,workerVersion:receipt.workerVersion,environmentAlias:receipt.environmentAlias,projectRef:receipt.projectRef,monitorConfigSha256:receipt.monitor.configSha256,runbookSha256:input.runbookSha256,isolationMatrixSha256:refs.isolation};
 // Copy every referenced private preimage the independent validator will need, retaining exact bytes.
 for(const key of [m.maintenance.backup.artifactSha256,m.maintenance.pauseReadbackSha256,m.maintenance.resumeReadbackSha256,...Object.values(m.maintenance.preservation),m.maintenance.resumeProof.readinessSha256,m.maintenance.resumeProof.evidenceSha256,m.maintenance.monitoring.evidenceSha256,m.maintenance.monitoring.endEvidenceSha256])bytes(/** @type {string} */(key));
 assert(validateOperationsReadiness(receipt,{now:input.now,expected,requireCurrentBackupRehearsal:true,readEvidence:key=>evidence.get(key)}).length===0);
 return{receipt,expected,evidence,latestDescriptorSha256:refs.latestDescriptor,rehearsedDescriptorSha256:m.maintenance.backup.descriptorSha256};
}
