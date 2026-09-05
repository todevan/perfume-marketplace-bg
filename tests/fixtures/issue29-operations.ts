const now = '2026-09-05T12:00:00.000Z';
export const candidate = { sha: 'a'.repeat(40), tree: 'b'.repeat(40), deploymentId: 'version-29' };
export const source = { organizationId: 'owned-org', ref: 'abcdefghijklmnopqrst', region: 'eu-central-1', environment: 'synthetic', url: 'https://abcdefghijklmnopqrst.supabase.co', postgresVersion: '17.6', classification: 'synthetic-owner-controlled' };
export const target = { ...source, ref: 'bcdefghijklmnopqrstu', url: 'https://bcdefghijklmnopqrstu.supabase.co', environment: 'disposable' };
export function manifestFixture(): import('../../scripts/issue29-operations/manifest.mjs').OperationsManifest {
    return { schemaVersion: 2, issue: 29, runId: '29292929-2929-4292-8292-292929292929', expiresAt: '2026-09-05T15:00:00.000Z', state: 'planned', candidate, source, target,
        preservedRefs: ['cdefghijklmnopqrstuv'], provisioning: { organizationId: 'owned-org', region: 'eu-central-1', sourceName: 'issue29-source', targetName: 'issue29-target' }, providerPreflight: null, backupVerification: null, sourceProvenance: { createdAt: now, creationIntentId: '29292929-2929-4292-8292-292929292929', creationReadbackSha256: 'd'.repeat(64), fixtureRunId: '29292929-2929-4292-8292-292929292929', fixtureManifestSha256: 'f'.repeat(64), inventorySha256: 'e'.repeat(64), releaseBindingSha256: 'd'.repeat(64), verifiedAt: now }, forbiddenRefs: [source.ref, 'cdefghijklmnopqrstuv'], allowedActions: ['create-source', 'verify-source', 'retire-source', 'preflight', 'implementation-verified', 'configure-monitoring', 'monitoring-proof', 'backup-set', 'verify-backup', 'create-target', 'quarantine', 'restore-database', 'restore-storage', 'verify-restore', 'incident-drill', 'cleanup-resource', 'cleanup'], maximumCost: 0, capabilityIds: { 'source-read': 'source-key', 'restore-write': 'restore-key', 'monitoring-config': 'monitor-key', 'artifact-upload': 'upload-key', cleanup: 'cleanup-key' },
        grafana: { stackAlias: 'ops-free', destinationAlias: 'owner-primary', ruleAliases: ['storage-integrity'] },
        backup: { destinationAlias: 'github-encrypted', retentionDays: 35, publicKeyId: 'c'.repeat(64) },
        fixture: { alias: 'synthetic-recovery', classification: 'synthetic-owner-controlled' }, humanBoundary: null,
        cleanup: { authorized: true, resources: [] }, pending: null, attempts: {}, history: [], terminal: null };
}
