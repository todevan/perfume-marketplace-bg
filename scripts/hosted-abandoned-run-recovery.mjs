import { createHash } from 'node:crypto';

/** @typedef {{ role: string, userId: string, createdAt: string, provisioningAttemptId: string }} RecoveryActor */
/** @typedef {{ id?: unknown, actorRole?: unknown, reporter_id?: unknown }} RecoveryReport */
/** @typedef {{ id?: unknown, uploaderId?: unknown, uploader_id?: unknown, objectPath?: unknown, storage_path?: unknown }} RecoveryUpload */
/** @typedef {{ id?: unknown, storage_path?: unknown }} RecoveryQueueRow */
/**
 * @typedef {{
 *   targetProjectRef: string,
 *   runId: string,
 *   provisioningAttemptId: string,
 *   credentialStoreId: string,
 *   pendingActors: readonly unknown[],
 *   actors: RecoveryActor[],
 *   reports: RecoveryReport[],
 *   uploads: RecoveryUpload[],
 *   queueRows: RecoveryQueueRow[]
 * }} RecoveryManifest
 */
/**
 * @typedef {{
 *   accounts: number,
 *   pending: number,
 *   reports: number,
 *   uploads: number,
 *   objects: number,
 *   queueRows: number,
 *   foreignArtifacts: number,
 *   preExistingAccounts: number
 * }} RecoveryInventory
 */
/**
 * @typedef {{
 *   userId: string,
 *   exists: boolean,
 *   createdAt: string,
 *   runId: unknown,
 *   provisioningNonce: unknown,
 *   provisioningAttemptId: unknown
 * }} RecoveryActorAttestation
 */
/**
 * @typedef {{
 *   manifestSha256: string,
 *   runId: string,
 *   projectRef: string,
 *   phase: string,
 *   counts: Readonly<Record<string, number>>
 * }} RecoveryCheckpoint
 */

export class HostedAbandonedRunRecoveryError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'HostedAbandonedRunRecoveryError';
  }
}

/**
 * Validates the exact persisted abandoned-run manifest before any recovery operation.
 *
 * @param {{
 *   manifest: unknown,
 *   expectedRunId: string,
 *   expectedProjectRef: string
 * }} options
 * @returns {RecoveryManifest}
 */
export function validateAbandonedRecoveryManifest({
  manifest,
  expectedRunId,
  expectedProjectRef
}) {
  if (!manifest || typeof manifest !== 'object') {
    throw new HostedAbandonedRunRecoveryError(
      'recovery manifest target does not match approved abandoned run'
    );
  }

  const candidate = /** @type {Record<string, any>} */ (manifest);

  if (
    candidate.runId !== expectedRunId ||
    candidate.targetProjectRef !== expectedProjectRef
  ) {
    throw new HostedAbandonedRunRecoveryError(
      'recovery manifest target does not match approved abandoned run'
    );
  }

  if (!Array.isArray(candidate.actors) || candidate.actors.length !== 4) {
    throw new HostedAbandonedRunRecoveryError(
      'recovery manifest must contain exactly four unique actors'
    );
  }

  /** @type {RecoveryActor[]} */
  const actors = candidate.actors;

  const actorUserIds = actors.map((actor) => actor.userId);
  if (new Set(actorUserIds).size !== 4) {
    throw new HostedAbandonedRunRecoveryError(
      'recovery manifest must contain exactly four unique actors'
    );
  }

  if (!Array.isArray(candidate.pendingActors) || candidate.pendingActors.length !== 0) {
    throw new HostedAbandonedRunRecoveryError(
      'recovery manifest must not contain pending actors'
    );
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

  if (
    typeof candidate.provisioningAttemptId !== 'string' ||
    !uuidPattern.test(candidate.provisioningAttemptId)
  ) {
    throw new HostedAbandonedRunRecoveryError(
      'recovery manifest provisioning attempt ID is invalid'
    );
  }

  if (
    actors.some(
      (actor) => actor.provisioningAttemptId !== candidate.provisioningAttemptId
    )
  ) {
    throw new HostedAbandonedRunRecoveryError(
      'actor provisioning attempt does not match manifest binding'
    );
  }

  if (
    actors.some(
      (actor) => typeof actor.userId !== 'string' || !uuidPattern.test(actor.userId)
    )
  ) {
    throw new HostedAbandonedRunRecoveryError(
      'actor user ID is invalid'
    );
  }

  const timestampPattern =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/u;

  const invalidTimestamp = actors.some((actor) => {
    if (typeof actor.createdAt !== 'string') return true;

    const match = timestampPattern.exec(actor.createdAt);
    if (!match) return true;

    const parsed = Date.parse(actor.createdAt);
    const milliseconds = (match[2] ?? '').padEnd(3, '0').slice(0, 3);
    const canonicalMilliseconds = `${match[1]}.${milliseconds}Z`;

    return (
      !Number.isFinite(parsed) ||
      new Date(parsed).toISOString() !== canonicalMilliseconds
    );
  });

  if (invalidTimestamp) {
    throw new HostedAbandonedRunRecoveryError(
      'actor provisioning timestamp is invalid'
    );
  }

  if (
    typeof candidate.credentialStoreId !== 'string' ||
    !/^[a-f0-9]{64}$/iu.test(candidate.credentialStoreId)
  ) {
    throw new HostedAbandonedRunRecoveryError(
      'credential store binding is invalid'
    );
  }

  return /** @type {RecoveryManifest} */ (candidate);
}

/**
 * Performs the non-mutating isolation and provenance gate.
 *
 * @param {{
 *   manifest: unknown,
 *   expectedRunId: string,
 *   expectedProjectRef: string,
 *   inventory: RecoveryInventory,
 *   actorAttestations?: readonly RecoveryActorAttestation[],
 *   allowAlreadyMissingActors?: boolean,
 *   initialVerifiedCounts?: Readonly<Record<string, number>>
 * }} options
 * @returns {Readonly<RecoveryInventory>}
 */
export function assessAbandonedRecoveryDryRun({
  manifest,
  expectedRunId,
  expectedProjectRef,
  inventory,
  actorAttestations,
  allowAlreadyMissingActors = false,
  initialVerifiedCounts
}) {
  const validatedManifest = validateAbandonedRecoveryManifest({
    manifest,
    expectedRunId,
    expectedProjectRef
  });

  if (
    !inventory ||
    inventory.foreignArtifacts > 0 ||
    inventory.preExistingAccounts > 0
  ) {
    throw new HostedAbandonedRunRecoveryError(
      'recovery scope is not isolated'
    );
  }

  if (!Array.isArray(actorAttestations) || actorAttestations.length !== 4) {
    throw new HostedAbandonedRunRecoveryError(
      'actor provenance attestations are required'
    );
  }

  /** @type {Array<keyof RecoveryInventory>} */
  const resumeZeroKeys = [
    'pending',
    'reports',
    'uploads',
    'objects',
    'queueRows',
    'foreignArtifacts',
    'preExistingAccounts'
  ];

  const resumeWithAlreadyMissingActors =
    allowAlreadyMissingActors === true &&
    initialVerifiedCounts?.accounts === 4 &&
    resumeZeroKeys.every((key) => initialVerifiedCounts?.[key] === 0) &&
    resumeZeroKeys.every((key) => inventory[key] === 0);

  const existingActorAttestations = actorAttestations.filter(
    (attestation) => attestation.exists === true
  );

  const provisioningNoncePattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

  const sharedProvisioningNonce =
    existingActorAttestations.length > 0
      ? existingActorAttestations[0].provisioningNonce
      : null;

  const provisioningNonceValid =
    existingActorAttestations.every(
      (attestation) =>
        typeof attestation.provisioningNonce === 'string' &&
        provisioningNoncePattern.test(attestation.provisioningNonce) &&
        attestation.provisioningNonce === sharedProvisioningNonce
    );

  const invalidProvenance =
    !provisioningNonceValid ||
    validatedManifest.actors.some((actor) => {
      const attestation = actorAttestations.find(
        (candidate) => candidate.userId === actor.userId
      );

      if (!attestation) return true;

      if (attestation.exists !== true) {
        return !resumeWithAlreadyMissingActors;
      }

      return (
        attestation.createdAt !== actor.createdAt ||
        attestation.runId !== expectedRunId ||
        attestation.provisioningAttemptId !== actor.provisioningAttemptId
      );
    });

  if (invalidProvenance) {
    throw new HostedAbandonedRunRecoveryError(
      'actor provenance is invalid'
    );
  }

  if (resumeWithAlreadyMissingActors) {
    const existingAttestationCount = actorAttestations.filter(
      (attestation) => attestation.exists === true
    ).length;

    if (
      !Number.isInteger(inventory.accounts) ||
      inventory.accounts !== existingAttestationCount
    ) {
      throw new HostedAbandonedRunRecoveryError(
        'recovery resume inventory does not match actor attestations'
      );
    }
  }

  return Object.freeze({ ...inventory });
}
/**
 * @param {{
 *   manifest: unknown,
 *   expectedRunId: string,
 *   expectedProjectRef: string,
 *   inventory: RecoveryInventory,
 *   actorAttestations: readonly RecoveryActorAttestation[],
 *   allowAlreadyMissingActors?: boolean,
 *   initialVerifiedCounts?: Readonly<Record<string, number>>,
 *   deleteActorById: (userId: string) => Promise<unknown>,
 *   inspectAfterCleanup: () => Promise<RecoveryInventory>
 * }} options
 */
export async function executeAbandonedRecoveryCleanup({
  manifest,
  expectedRunId,
  expectedProjectRef,
  inventory,
  actorAttestations,
  allowAlreadyMissingActors = false,
  initialVerifiedCounts,
  deleteActorById,
  inspectAfterCleanup
}) {
  const validatedManifest = validateAbandonedRecoveryManifest({
    manifest,
    expectedRunId,
    expectedProjectRef
  });

  assessAbandonedRecoveryDryRun({
    manifest: validatedManifest,
    expectedRunId,
    expectedProjectRef,
    inventory,
    actorAttestations,
    allowAlreadyMissingActors,
    initialVerifiedCounts
  });

  if (typeof deleteActorById !== 'function') {
    throw new HostedAbandonedRunRecoveryError(
      'recovery delete adapter is unavailable'
    );
  }

  for (const actor of validatedManifest.actors) {
    await deleteActorById(actor.userId);
  }

  if (typeof inspectAfterCleanup !== 'function') {
    throw new HostedAbandonedRunRecoveryError(
      'recovery post-cleanup inspection is unavailable'
    );
  }

  const after = await inspectAfterCleanup();

  /** @type {Array<keyof RecoveryInventory>} */
  const requiredZeroCounts = [
    'accounts',
    'pending',
    'reports',
    'uploads',
    'objects',
    'queueRows',
    'foreignArtifacts',
    'preExistingAccounts'
  ];

  const verificationFailed =
    !after ||
    requiredZeroCounts.some(
      (key) =>
        typeof after[key] !== 'number' ||
        !Number.isInteger(after[key]) ||
        after[key] !== 0
    );

  if (verificationFailed) {
    throw new HostedAbandonedRunRecoveryError(
      'recovery cleanup verification found residual artifacts'
    );
  }

  return Object.freeze({
    deletedActorCount: validatedManifest.actors.length,
    counts: Object.freeze({ ...after })
  });
}


/** @param {Uint8Array} manifestBytes */function exactManifestSha256(manifestBytes) {
  if (!(manifestBytes instanceof Uint8Array)) {
    throw new HostedAbandonedRunRecoveryError(
      'recovery manifest bytes are invalid'
    );
  }

  return createHash('sha256').update(manifestBytes).digest('hex');
}

/**
 * @param {{
 *   manifestBytes: Uint8Array,
 *   runId: string,
 *   projectRef: string,
 *   phase: string,
 *   counts: Record<string, number>
 * }} options
 * @returns {Readonly<RecoveryCheckpoint>}
 */
export function createAbandonedRecoveryCheckpoint({
  manifestBytes,
  runId,
  projectRef,
  phase,
  counts
}) {
  return Object.freeze({
    manifestSha256: exactManifestSha256(manifestBytes),
    runId,
    projectRef,
    phase,
    counts: Object.freeze({ ...counts })
  });
}

/**
 * @param {{
 *   checkpoint: unknown,
 *   manifestBytes: Uint8Array,
 *   expectedRunId: string,
 *   expectedProjectRef: string
 * }} options
 * @returns {RecoveryCheckpoint}
 */
export function assertAbandonedRecoveryCheckpoint({
  checkpoint,
  manifestBytes,
  expectedRunId,
  expectedProjectRef
}) {
  const manifestSha256 = exactManifestSha256(manifestBytes);

  if (!checkpoint || typeof checkpoint !== 'object') {
    throw new HostedAbandonedRunRecoveryError(
      'checkpoint does not match the exact recovery manifest'
    );
  }

  const candidate = /** @type {Record<string, any>} */ (checkpoint);

  if (
    candidate.runId !== expectedRunId ||
    candidate.projectRef !== expectedProjectRef ||
    candidate.manifestSha256 !== manifestSha256
  ) {
    throw new HostedAbandonedRunRecoveryError(
      'checkpoint does not match the exact recovery manifest'
    );
  }

  return /** @type {RecoveryCheckpoint} */ (candidate);
}
/**
 * Minimal recovery-specific Supabase adapter.
 * It deliberately does not depend on actor emails, passwords, TOTP material,
 * management tokens or canonical A9/A11 actor credential configuration.
 *
 * @param {{ serviceClient: any }} options
 */
export function createAbandonedRecoverySupabaseAdapter({ serviceClient }) {
  if (
    !serviceClient?.auth?.admin ||
    typeof serviceClient.auth.admin.getUserById !== 'function'
  ) {
    throw new HostedAbandonedRunRecoveryError(
      'recovery Supabase adapter is unavailable'
    );
  }

  return Object.freeze({
    /**
     * @param {string} userId
     * @param {{ allowMissing?: boolean }} [options]
     */
    async inspectActor(userId, { allowMissing = false } = {}) {
      const result = await serviceClient.auth.admin.getUserById(userId);

      if (
        allowMissing &&
        !result?.data?.user &&
        result?.error?.status === 404
      ) {
        return Object.freeze({
          userId,
          exists: false,
          createdAt: '',
          runId: null,
          provisioningNonce: null,
          provisioningAttemptId: null
        });
      }

      if (result?.error || !result?.data?.user) {
        throw new HostedAbandonedRunRecoveryError(
          'recovery actor inspection failed'
        );
      }

      const user = result.data.user;
      const metadata =
        user.user_metadata && typeof user.user_metadata === 'object'
          ? user.user_metadata
          : {};

      return Object.freeze({
        userId: String(user.id),
        exists: true,
        createdAt: String(user.created_at ?? ''),
        runId: metadata.gate3_report_evidence_run_id,
        provisioningNonce:
          metadata.gate3_report_evidence_provisioning_nonce,
        provisioningAttemptId:
          metadata.gate3_report_evidence_provisioning_attempt_id
      });
    },

    /** @param {string} userId */
    async deleteActorById(userId) {
      const existing = await serviceClient.auth.admin.getUserById(userId);

      if (
        !existing?.data?.user &&
        existing?.error?.status === 404
      ) {
        return Object.freeze({
          userId,
          deleted: false,
          alreadyMissing: true
        });
      }

      if (existing?.error || !existing?.data?.user) {
        throw new HostedAbandonedRunRecoveryError(
          'recovery actor delete preflight failed'
        );
      }

      if (typeof serviceClient.auth.admin.deleteUser !== 'function') {
        throw new HostedAbandonedRunRecoveryError(
          'recovery actor delete adapter is unavailable'
        );
      }

      const deleted = await serviceClient.auth.admin.deleteUser(userId);

      if (deleted?.error) {
        throw new HostedAbandonedRunRecoveryError(
          'recovery exact actor cleanup failed'
        );
      }

      return Object.freeze({
        userId,
        deleted: true,
        alreadyMissing: false
      });
    },
    /** @param {RecoveryManifest} manifest @returns {Promise<Readonly<RecoveryInventory>>} */
    async inspectInventory(manifest) {
      const actorIds = manifest.actors.map((actor) => actor.userId);

      const accountResults = await Promise.all(
        actorIds.map((userId) => serviceClient.auth.admin.getUserById(userId))
      );

      if (accountResults.some((result) => result?.error && result?.error?.status !== 404)) {
        throw new HostedAbandonedRunRecoveryError(
          'recovery account inventory inspection failed'
        );
      }

      const accounts = accountResults.filter(
        (result) => Boolean(result?.data?.user)
      ).length;

      const reportsResult = await serviceClient
        .from('reports')
        .select('id, reporter_id')
        .in('reporter_id', actorIds);

      if (reportsResult?.error) {
        throw new HostedAbandonedRunRecoveryError(
          'recovery report inventory inspection failed'
        );
      }

      const uploadsResult = await serviceClient
        .from('report_evidence_uploads')
        .select('id, uploader_id, storage_path')
        .in('uploader_id', actorIds);

      if (uploadsResult?.error) {
        throw new HostedAbandonedRunRecoveryError(
          'recovery upload inventory inspection failed'
        );
      }

      /** @type {Array<Record<string, any>>} */
      const reports = Array.isArray(reportsResult?.data) ? reportsResult.data : [];
      /** @type {Array<Record<string, any>>} */
      const uploads = Array.isArray(uploadsResult?.data) ? uploadsResult.data : [];

      const objectPaths = [];
      for (const actor of manifest.actors) {
        const listed = await serviceClient.storage
          .from('report-evidence')
          .list(actor.userId, { limit: 100, offset: 0 });

        if (listed?.error) {
          throw new HostedAbandonedRunRecoveryError(
            'recovery object inventory inspection failed'
          );
        }

        for (const object of listed?.data ?? []) {
          objectPaths.push(`${actor.userId}/${object.name}`);
        }
      }

      const manifestReportIds = new Set(
        manifest.reports.map((report) => String(report.id))
      );
      const manifestUploadIds = new Set(
        manifest.uploads.map((upload) => String(upload.id))
      );
      const allowedPaths = new Set(
        manifest.uploads.map((upload) => String(upload.objectPath))
      );

      const manifestPaths = [...allowedPaths];
      /** @type {Array<Record<string, any>>} */
      let queueRows = [];

      if (manifestPaths.length > 0) {
        const queueResult = await serviceClient
          .from('upload_cleanup_queue')
          .select('id, storage_path')
          .in('storage_path', manifestPaths);

        if (queueResult?.error) {
          throw new HostedAbandonedRunRecoveryError(
            'recovery queue inventory inspection failed'
          );
        }

        queueRows = Array.isArray(queueResult?.data) ? queueResult.data : [];
      }

      const foreignArtifacts =
        reports.filter(
          (report) => !manifestReportIds.has(String(report.id))
        ).length +
        uploads.filter(
          (upload) =>
            !manifestUploadIds.has(String(upload.id)) ||
            !allowedPaths.has(String(upload.storage_path))
        ).length +
        objectPaths.filter((path) => !allowedPaths.has(path)).length +
        queueRows.filter(
          (row) => !allowedPaths.has(String(row.storage_path))
        ).length;

      return Object.freeze({
        accounts,
        pending: 0,
        reports: reports.length,
        uploads: uploads.length,
        objects: objectPaths.length,
        queueRows: queueRows.length,
        foreignArtifacts,
        preExistingAccounts: 0
      });
    }
  });
}
