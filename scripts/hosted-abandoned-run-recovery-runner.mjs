import {
  assertAbandonedRecoveryCheckpoint,
  assessAbandonedRecoveryDryRun,
  createAbandonedRecoverySupabaseAdapter,
  executeAbandonedRecoveryCleanup,
  HostedAbandonedRunRecoveryError
} from './hosted-abandoned-run-recovery.mjs';

/** @typedef {{ role: string, userId: string, createdAt: string, provisioningAttemptId: string }} RecoveryActor */
/**
 * @typedef {{
 *   targetProjectRef: string,
 *   runId: string,
 *   provisioningAttemptId: string,
 *   credentialStoreId: string,
 *   pendingActors: readonly unknown[],
 *   actors: RecoveryActor[],
 *   reports: Array<Record<string, any>>,
 *   uploads: Array<Record<string, any>>,
 *   queueRows: Array<Record<string, any>>
 * }} RecoveryManifest
 */

/**
 * Read-only abandoned-run recovery dry-run.
 *
 * @param {{
 *   manifestBytes: Uint8Array,
 *   serviceClient: any,
 *   expectedRunId: string,
 *   expectedProjectRef: string
 * }} options
 */
export async function runAbandonedRecoveryDryRun({
  manifestBytes,
  serviceClient,
  expectedRunId,
  expectedProjectRef
}) {
  if (!(manifestBytes instanceof Uint8Array)) {
    throw new HostedAbandonedRunRecoveryError(
      'recovery manifest bytes are invalid'
    );
  }

  /** @type {RecoveryManifest} */
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new HostedAbandonedRunRecoveryError(
      'recovery manifest is invalid JSON'
    );
  }

  const adapter = createAbandonedRecoverySupabaseAdapter({
    serviceClient
  });

  const actorAttestations = await Promise.all(
    manifest.actors.map((actor) => adapter.inspectActor(actor.userId))
  );

  const inventory = await adapter.inspectInventory(manifest);

  const counts = assessAbandonedRecoveryDryRun({
    manifest,
    expectedRunId,
    expectedProjectRef,
    inventory,
    actorAttestations
  });

  return Object.freeze({
    status: 'DRY_RUN_VERIFIED',
    runId: expectedRunId,
    projectRef: expectedProjectRef,
    actorCount: manifest.actors.length,
    counts
  });
}

/**
 * Stateful recovery entrypoint. This remains disabled unless the caller
 * supplies the exact dedicated approval token. All other cleanup wiring is
 * deliberately unreachable before this gate passes.
 *
 * @param {{
 *   approval?: string,
 *   manifestBytes?: Uint8Array,
 *   checkpoint?: unknown,
 *   serviceClient?: any,
 *   expectedRunId?: string,
 *   expectedProjectRef?: string
 * }} options
 */
export async function runAbandonedRecoveryCleanup({
  approval,
  manifestBytes,
  checkpoint,
  serviceClient,
  expectedRunId,
  expectedProjectRef
} = {}) {
  if (approval !== 'ABANDONED_GATE3_RECOVERY_CLEANUP') {
    throw new HostedAbandonedRunRecoveryError(
      'recovery cleanup approval is disabled'
    );
  }

  if (!serviceClient) {
    throw new HostedAbandonedRunRecoveryError(
      'recovery cleanup service client is unavailable'
    );
  }

  const exactManifestBytes = /** @type {Uint8Array} */ (manifestBytes);
  const exactRunId = /** @type {string} */ (expectedRunId);
  const exactProjectRef = /** @type {string} */ (expectedProjectRef);

  const approvedCheckpoint = assertAbandonedRecoveryCheckpoint({
    checkpoint,
    manifestBytes: exactManifestBytes,
    expectedRunId: exactRunId,
    expectedProjectRef: exactProjectRef
  });

  if (approvedCheckpoint.phase !== 'dry-run-verified') {
    throw new HostedAbandonedRunRecoveryError(
      'recovery checkpoint is not approved for cleanup'
    );
  }

  /** @type {RecoveryManifest} */
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(exactManifestBytes));
  } catch {
    throw new HostedAbandonedRunRecoveryError(
      'recovery manifest is invalid JSON'
    );
  }

  const adapter = createAbandonedRecoverySupabaseAdapter({
    serviceClient
  });

  const actorAttestations = await Promise.all(
    manifest.actors.map((actor) =>
      adapter.inspectActor(actor.userId, { allowMissing: true })
    )
  );

  const inventory = await adapter.inspectInventory(manifest);

  assessAbandonedRecoveryDryRun({
    manifest,
    expectedRunId: exactRunId,
    expectedProjectRef: exactProjectRef,
    inventory,
    actorAttestations,
    allowAlreadyMissingActors: true,
    initialVerifiedCounts: approvedCheckpoint.counts
  });

  const result = await executeAbandonedRecoveryCleanup({
    manifest,
    expectedRunId: exactRunId,
    expectedProjectRef: exactProjectRef,
    inventory,
    actorAttestations,
    allowAlreadyMissingActors: true,
    initialVerifiedCounts: approvedCheckpoint.counts,
    deleteActorById: (userId) => adapter.deleteActorById(userId),
    inspectAfterCleanup: () => adapter.inspectInventory(manifest)
  });

  return Object.freeze({
    status: 'CLEANUP_VERIFIED',
    runId: exactRunId,
    projectRef: exactProjectRef,
    deletedActorCount: result.deletedActorCount,
    counts: result.counts
  });
}
