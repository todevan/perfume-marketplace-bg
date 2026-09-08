import { createHash } from 'node:crypto';
import { chmodSync, linkSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOperationsEvidence, createOperationsEvidenceReader, recoveryContractDigest, validateOperationsReadiness } from '../../scripts/issue29-operations/readiness.mjs';
import { canonicalJson } from '../../scripts/issue29-operations/recovery-set.mjs';


const now = Date.parse('2026-09-05T12:00:00.000Z');
const time = (clock: string) => `2026-09-05T${clock}:00.000Z`;
const hash = 'a'.repeat(64);
const proofBytes=Buffer.from('contract-only private provider readback');
const proofHash=createHash('sha256').update(proofBytes).digest('hex');
const runId='29292929-2929-4292-8292-292929292929';
const idHash=(id:string)=>createHash('sha256').update(id).digest('hex');
const sourceRef = 's'.repeat(20);
const targetRef = 't'.repeat(20);
const productionRef = 'p'.repeat(20);
const signalFamilies = ['health', 'auth', 'database', 'storage', 'email', 'deals', 'safety', 'backup_freshness', 'monitor_heartbeat'];

// Synthetic contract observations only; these are not hosted proof artifacts.
function receiptFixture() {
	return {
		schemaVersion: 2, kind: 'issue29-operations-readiness', runId,
		commitSha: 'c'.repeat(40), treeSha: 'd'.repeat(40), workerVersion: 'worker-contract-fixture',
		environmentAlias: 'staging', projectRef: sourceRef, generatedAt: time('12:00'),
		monitor: {
			provider: 'grafana-cloud-free', stackAlias: 'owner-operations', destinationAlias: 'owner-primary',
			targetProjectRef: sourceRef, targetEnvironmentAlias: 'staging', targetCommitSha: 'c'.repeat(40),
			targetWorkerVersion: 'worker-contract-fixture', configSha256: hash,
			readBackAt: time('11:55'), heartbeatAt: time('11:55'), signalFamilies: [...signalFamilies],
			maxCost: 0, evidenceSha256: hash
		},
		alerts: {
			configSha256: hash, targetProjectRef: sourceRef, destinationAlias: 'owner-primary',
			failureEventId: 'contract-failure', recoveryEventId: 'contract-recovery',
			firedAt: time('11:30'), deliveredAt: time('11:31'), acknowledgedAt: time('11:32'),
			recoveredAt: time('11:40'), recoveryDeliveredAt: time('11:41'),
			provedSignalFamilies: [...signalFamilies], evidenceSha256: hash
		},
		backup: {
			setId: '12345678-1234-4123-8123-123456789012', descriptorSha256: descriptorBindings().descriptorSha256, sourceProjectRef: sourceRef,
			sourceClassification: 'synthetic-owner-controlled', sourceCommitSha: 'c'.repeat(40),
			checkpointSha256: descriptorBindings().checkpointSha256, checkpointAt: time('08:00'), completedAt: time('08:10'), verifiedAt: time('08:11'),
			components: ['roles', 'schema', 'data', 'migration-history', 'auth-recovery', 'managed-schema-changes', 'platform-inventory', 'storage-manifest', 'storage-objects'].map((name) => ({ name, sha256: name === 'storage-objects' ? descriptorBindings().storageObjectsSha256 : hash, sizeBytes: 100 })),
			artifact: {
				provider: 'github-actions', id: '123', createdAt: time('08:12'),
				expiresAt: '2026-10-10T08:12:00.000Z', retentionDays: 35,
				readBackAt: time('08:13'), downloadVerifiedAt: time('08:14'), sizeBytes: 800, sha256: hash
			},
			encryption: { algorithm: 'AES-256-GCM', envelopeVersion: 1, keyId: descriptorBindings().keyId, publicKeySha256: descriptorBindings().keyId, wrappedKeySha256: descriptorBindings().wrappedKeySha256 },
			secondaryCopy: { destinationAlias: 'owner-secondary', verifiedAt: time('08:15'), descriptorSha256:descriptorBindings().descriptorSha256, componentInventorySha256:idHash(canonicalJson([...descriptorFixture().components,descriptorFixture().manifest])), copyEvidenceSha256:idHash(canonicalJson(copyFixture())), privateKeyCoLocated: false },
			evidenceSha256: hash
		},
		decryption: {
			backupSetId: '12345678-1234-4123-8123-123456789012', descriptorSha256: descriptorBindings().descriptorSha256, keyId: descriptorBindings().keyId, verifiedAt: time('08:16'),
			allComponentsAuthenticated: true, privateKeyCustody: 'owner-offline', privateKeyRetainedByAutomation: false,
			evidenceSha256: hash
		},
		restore: {
			backupSetId: '12345678-1234-4123-8123-123456789012', descriptorSha256: descriptorBindings().descriptorSha256, targetAlias: 'disposable-restore', targetProjectRef: targetRef,
			recoveryCheckpointAt: time('08:00'), recoveryContractSha256: recoveryContractDigest(descriptorFixture()),
			startedAt: time('08:20'), quarantineVerifiedAt: time('08:21'), databaseIntegrityAt: time('08:40'),
			storageStartedAt: time('08:40'), storageRestoredAt: time('08:50'), applicationStartedAt:time('08:50'), completedAt: time('09:00'),
			recoveryPointAgeAtStartMs: 1_200_000, databaseRecoveryElapsedMs: 1_200_000,
			storageRecoveryElapsedMs: 600_000, applicationRecoveryElapsedMs: 600_000, fullRecoveryElapsedMs: 2_400_000,
			checks: {
				schemaMigration: true, databaseStorageCheckpoint: true, authRecovery: true, rls: true,
				crossUserPrivacy: true, oldSourceTokenDenied: true, freshTargetLogin: true, application: true,
				deals: true, safety: true, finalizedImages: true, noOutboundEffects: true, noProductionConfiguration: true
			}, evidenceSha256: hash
		},
		incident: {
			runbookSha256: hash,
			roles: { incidentCommander: 'owner', technicalLead: 'authorized-operator', privacyCommunications: 'owner', backupRestoreOperator: 'authorized-operator' },
			contactMapAlias: 'owner-private-contact-map', contactsAttestedAt: time('10:00'),
			drill: {
				kind: 'storage-sentinel', targetProjectRef: targetRef, startedAt: time('09:10'),
				mutationReadBackAt: time('09:11'), detectedAt: time('09:12'), deliveredAt: time('09:13'),
				acknowledgedAt: time('09:14'), diagnosedAt: time('09:15'), restoredAt: time('09:16'),
				recoveredAt: time('09:19'), recoveryDeliveredAt: time('09:20'), closedAt: time('09:21')
			}, evidenceSha256: hash
		},
		isolation: {
			matrixSha256: hash, checkedAt: time('11:00'), sourceProjectRef: sourceRef, restoreProjectRef: targetRef,
			productionRefs: [productionRef], canonicalStagingRef: 'q'.repeat(20), forbiddenRefs: [sourceRef, productionRef,'q'.repeat(20)],
			productionReadOnly: true, sourceSyntheticVerified: true, targetDedicatedVerified: true,
			noForeignStateVerified: true, noSharedCredentialsVerified: true, evidenceSha256: hash
		},
        maintenance:{
          id:runId,phase:'closed',sourceRef,sourceWorkerName:`issue29-${runId}`,authorizedAt:time('08:17'),expiresAt:time('10:17'),pausedAt:time('08:19'),pauseReadbackSha256:proofHash,resumedAt:time('09:30'),resumeReadbackSha256:proofHash,endedAt:time('09:45'),
          backup:{descriptorSha256:descriptorBindings().descriptorSha256,artifactSha256:proofHash,checkpointSha256:descriptorBindings().checkpointSha256,verifiedAt:time('08:16'),retentionVerifiedAt:time('08:15')},
          preservation:{identitySha256:proofHash,configSha256:proofHash,provenanceSha256:proofHash,workerSha256:proofHash},
          resumeProof:{checkedAt:time('09:32'),identitySha256:proofHash,configSha256:proofHash,provenanceSha256:proofHash,workerSha256:proofHash,checkpointSha256:descriptorBindings().checkpointSha256,readinessSha256:proofHash,evidenceSha256:proofHash},
          monitoring:{beganAt:time('08:18'),endedAt:time('09:43'),sourceConfigSha256:hash,evidenceSha256:proofHash,endEvidenceSha256:proofHash},
          targetProjectRef:targetRef,targetWorkerName:`issue29-restore-${runId}`,targetAbsentAt:time('09:25'),targetWorkerAbsentAt:time('09:26'),evidenceSha256:hash
        },
		cleanup: {
			state: 'cleanup_verified', verifiedAt: time('10:00'), pendingMutationCount: 0,
			resources: [{
				provider: 'supabase', resourceIdSha256: createHash('sha256').update(targetRef).digest('hex'),
				createdIntentSha256: hash, createdReadbackSha256: hash, deleteIntentSha256: hash,
				deleteReadbackSha256: hash, absenceReadbackSha256: hash, absent: true
			},{provider:'cloudflare',resourceIdSha256:idHash(`issue29-restore-${runId}`),createdIntentSha256:hash,createdReadbackSha256:hash,deleteIntentSha256:hash,deleteReadbackSha256:hash,absenceReadbackSha256:hash,absent:true}], temporaryCredentialCount: 1, revokedTemporaryCredentialCount: 1,
			retainedResources: [
				{ alias: 'owner-operations', kind: 'grafana-stack' },
				{ alias: 'owner-primary', kind: 'grafana-destination' },
				{ alias: 'launch-readiness', kind: 'grafana-rule' },
				{ alias: 'daily-backup', kind: 'encrypted-backup' },
				{ alias: 'owner-secondary', kind: 'secondary-encrypted-copy' },
                {alias:'synthetic-source',kind:'synthetic-source',resourceIdSha256:idHash(sourceRef)},
                {alias:'synthetic-worker',kind:'synthetic-worker',resourceIdSha256:idHash(`issue29-${runId}`)}
			], cost: 0, evidenceSha256: hash
		}
	};
}

const expected = {
	commitSha: 'c'.repeat(40), treeSha: 'd'.repeat(40), workerVersion: 'worker-contract-fixture',
	environmentAlias: 'staging', projectRef: sourceRef, monitorConfigSha256: hash,
	runbookSha256: hash, isolationMatrixSha256: hash
};

function descriptorFixture() {
	const publicKey = Buffer.from('contract-public-key');
	return {
		format: 'aromatika-coordinated-recovery-set', version: 1,
		metadata: {
			backupSetId: '12345678-1234-4123-8123-123456789012',
			source: { environmentAlias: 'staging', organizationId: 'owner-org', projectRef: sourceRef, region: 'eu-central-1', classification: 'synthetic-owner-controlled' },
			release: { commitSha: 'c'.repeat(40), treeSha: 'd'.repeat(40), workerVersion: 'worker-contract-fixture' },
			startedAt: time('08:00'), finishedAt: time('08:10'), tools: { supabaseCli: '2.109.1', postgres: '17.6', operator: '1' },
			migration: { count: 1, sha256: hash }, destinationAlias: 'daily-backup', exclusions: ['transient-auth'], manualReconstruction: ['runtime-secrets']
		},
		checkpoint: { snapshotId: 'contract-snapshot', finalizedRowsetSha256: hash },
		storage: { objectCount: 1, totalBytes: 72, pathTreeSha256: hash, manifestSha256: hash, finalizedRowsetSha256: hash },
		encryption: { cipher: 'aes-256-gcm', wrap: 'rsa-oaep-sha256', keyId: createHash('sha256').update(publicKey).digest('hex'), publicKey: publicKey.toString('base64'), wrappedKey: Buffer.from('contract-wrapped-key').toString('base64') },
		retention: { days: 35, expiresAt: '2026-10-10T08:10:00.000Z' },
		components: ['roles', 'schema', 'data', 'migration-history', 'auth-recovery', 'managed-schema-changes', 'platform-inventory', 'storage-object'].map((kind, index) => ({ name: `component-${index.toString().padStart(6, '0')}.bin`, kind, ciphertextSha256: hash, bytes: 100 })),
		manifest: { name: 'manifest.bin', kind: 'storage-manifest', ciphertextSha256: hash, bytes: 100 }
	};
}

function descriptorBindings() {
	const descriptor = descriptorFixture();
	return {
		descriptorSha256: createHash('sha256').update(`${canonicalJson(descriptor)}\n`).digest('hex'),
		checkpointSha256: createHash('sha256').update(canonicalJson(descriptor.checkpoint)).digest('hex'),
		keyId: descriptor.encryption.keyId,
		wrappedKeySha256: createHash('sha256').update(Buffer.from(descriptor.encryption.wrappedKey, 'base64')).digest('hex'),
		storageObjectsSha256: createHash('sha256').update(canonicalJson(descriptor.components.filter((entry) => entry.kind === 'storage-object'))).digest('hex')
	};
}

function copyFixture(){return{schemaVersion:1,provider:'owner-encrypted-retention',runId,sourceRef,destinationAlias:'owner-secondary',destinationSha256:hash,descriptorSha256:descriptorBindings().descriptorSha256,retentionDays:35,expiresAt:descriptorFixture().retention.expiresAt,verifiedAt:time('08:15'),componentInventorySha256:idHash(canonicalJson([...descriptorFixture().components,descriptorFixture().manifest])),encryptedOnly:true,workflowProof:false};}

function withEvidence(receipt = receiptFixture()) {
	const descriptorBytes = Buffer.from(`${canonicalJson(descriptorFixture())}\n`);
	const evidence = new Map<string, Buffer>([[createHash('sha256').update(descriptorBytes).digest('hex'), descriptorBytes]]);
	evidence.set(proofHash,proofBytes);const copy=Buffer.from(canonicalJson(copyFixture()));evidence.set(idHash(copy.toString()),copy);
	for (const name of ['monitor', 'alerts', 'backup', 'decryption', 'restore', 'incident', 'isolation', 'cleanup','maintenance'] as const) {
		const { evidenceSha256: _hash, ...payload } = receipt[name];
		const result = createOperationsEvidence(receipt, name, payload);
		receipt[name].evidenceSha256 = result.sha256;
		evidence.set(result.sha256, result.bytes);
	}
	return { receipt, evidence, options: { now, expected, readEvidence: (sha: string) => evidence.get(sha) } };
}

function historicalFixture(days = 4) {
	const receipt = receiptFixture();
	const descriptor = descriptorFixture();
	const before = (value: string) => new Date(Date.parse(value) - days * 86_400_000).toISOString();
	descriptor.metadata.backupSetId = '22345678-1234-4123-8123-123456789012';
	descriptor.metadata.startedAt = before(descriptor.metadata.startedAt);
	descriptor.metadata.finishedAt = before(descriptor.metadata.finishedAt);
	descriptor.retention.expiresAt = before(descriptor.retention.expiresAt);
	const bytes = Buffer.from(`${canonicalJson(descriptor)}\n`);
	const digest = createHash('sha256').update(bytes).digest('hex');
	receipt.restore.backupSetId = descriptor.metadata.backupSetId;
	receipt.restore.descriptorSha256 = digest;
	for (const name of ['recoveryCheckpointAt', 'startedAt', 'quarantineVerifiedAt', 'databaseIntegrityAt', 'storageStartedAt', 'storageRestoredAt', 'applicationStartedAt', 'completedAt'] as const) {
		receipt.restore[name] = before(receipt.restore[name]);
	}
	receipt.decryption.backupSetId = descriptor.metadata.backupSetId;
	receipt.decryption.descriptorSha256 = digest;
	receipt.decryption.verifiedAt = before(receipt.decryption.verifiedAt);
    receipt.maintenance.backup.descriptorSha256=digest;
    for(const key of ['authorizedAt','expiresAt','pausedAt','resumedAt','endedAt','targetAbsentAt','targetWorkerAbsentAt'] as const)receipt.maintenance[key]=before(receipt.maintenance[key]);
    receipt.maintenance.backup.verifiedAt=before(receipt.maintenance.backup.verifiedAt);receipt.maintenance.backup.retentionVerifiedAt=before(receipt.maintenance.backup.retentionVerifiedAt);receipt.maintenance.resumeProof.checkedAt=before(receipt.maintenance.resumeProof.checkedAt);receipt.maintenance.monitoring.beganAt=before(receipt.maintenance.monitoring.beganAt);receipt.maintenance.monitoring.endedAt=before(receipt.maintenance.monitoring.endedAt);
    for(const key of ['startedAt','mutationReadBackAt','detectedAt','deliveredAt','acknowledgedAt','diagnosedAt','restoredAt','recoveredAt','recoveryDeliveredAt','closedAt'] as const)receipt.incident.drill[key]=before(receipt.incident.drill[key]);
	const result = withEvidence(receipt);
	result.evidence.set(digest, bytes);
	return { ...result, rehearsedDescriptor: descriptor };
}

describe('Issue 29 operations readiness receipt', () => {
	it('rejects a generic passing timestamp instead of independent recovery evidence', () => {
		expect(validateOperationsReadiness({ passed: true, checkedAt: new Date().toISOString() }))
			.toEqual(['operations receipt schema is invalid']);
	});
	it('verifies a complete encrypted directory copy without pretending its hash is the GitHub ZIP hash', () => {
        const f=withEvidence();expect(f.receipt.backup.secondaryCopy.componentInventorySha256).not.toBe(f.receipt.backup.artifact.sha256);
        expect(validateOperationsReadiness(f.receipt,f.options)).toEqual([]);
    });
	it('measures application phase from actual browser start rather than Storage completion', () => {
        const r=receiptFixture();r.restore.applicationStartedAt=time('08:52');r.restore.applicationRecoveryElapsedMs=480_000;
        const f=withEvidence(r);expect(validateOperationsReadiness(f.receipt,f.options)).toEqual([]);
    });
	it('measures DB/Auth completion independently when fresh login finishes after Storage', () => {
        const r=receiptFixture();r.restore.databaseIntegrityAt=time('08:55');r.restore.databaseRecoveryElapsedMs=2_100_000;
        const f=withEvidence(r);expect(validateOperationsReadiness(f.receipt,f.options)).toEqual([]);
    });
	it('accepts independently bound component observations and actual evidence bytes', () => {
		const { receipt, options } = withEvidence();
		expect(validateOperationsReadiness(receipt, options)).toEqual([]);
	});
	it.each(['commitSha', 'treeSha', 'workerVersion', 'environmentAlias', 'projectRef', 'monitorConfigSha256', 'runbookSha256', 'isolationMatrixSha256'] as const)(
		'rejects mismatched independent %s binding', (name) => {
			const { receipt, options } = withEvidence();
			const value = name === 'projectRef' ? productionRef : name.endsWith('Sha256') ? 'b'.repeat(64) : name.endsWith('Sha') ? 'b'.repeat(40) : 'wrong-target';
			expect(validateOperationsReadiness(receipt, { ...options, expected: { ...expected, [name]: value } }).length).toBeGreaterThan(0);
		}
	);

	const semanticFailures: [string, (receipt: ReturnType<typeof receiptFixture>) => void, string][] = [
		['monitor target', (r) => { r.monitor.targetProjectRef = productionRef; }, 'monitor target'],
		['monitor deployment', (r) => { r.monitor.targetWorkerVersion = 'old-worker'; }, 'monitor target'],
		['monitor configuration age', (r) => { r.monitor.readBackAt = time('11:49'); }, 'monitor configuration is stale'],
		['monitor heartbeat age', (r) => { r.monitor.heartbeatAt = time('11:39'); }, 'monitor heartbeat is stale'],
		['duplicate monitor signal', (r) => { r.monitor.signalFamilies[0] = 'auth'; }, 'monitor signal coverage'],
		['alert routing', (r) => { r.alerts.configSha256 = 'b'.repeat(64); }, 'alert routing'],
		['duplicate signal proof', (r) => { r.alerts.provedSignalFamilies[0] = 'auth'; }, 'alert rule coverage'],
		['reused recovery event', (r) => { r.alerts.recoveryEventId = r.alerts.failureEventId; }, 'identities must differ'],
		['old alert delivery', (r) => { r.alerts.deliveredAt = '2026-09-03T11:31:00.000Z'; }, 'alert delivery is stale'],
		['old recovery delivery', (r) => { r.alerts.recoveryDeliveredAt = '2026-09-03T11:41:00.000Z'; }, 'recovery delivery is stale'],
		['late acknowledgement', (r) => { r.alerts.acknowledgedAt = time('11:47'); }, 'acknowledgement exceeds 15 minutes'],
		['old source backup', (r) => { r.backup.checkpointAt = '2026-09-04T11:59:59.000Z'; }, 'backup checkpoint is stale'],
		['duplicate dump component', (r) => { r.backup.components[0].name = 'schema'; }, 'backup component inventory'],
		['short retention readback', (r) => { r.backup.artifact.expiresAt = '2026-10-10T08:11:59.000Z'; }, 'retention is shorter'],
		['wrong secondary copy', (r) => { r.backup.secondaryCopy.componentInventorySha256 = 'b'.repeat(64); }, 'secondary encrypted copy hash'],
		['unverified key for current backup', (r) => { r.decryption.backupSetId = 'old-backup'; }, 'decryption proof is not bound'],
		['wrong decryption key', (r) => { r.decryption.keyId = 'other-key'; }, 'decryption proof is not bound'],
		['private key proof predates backup', (r) => { r.decryption.verifiedAt = time('08:09'); }, 'private-key recovery predates'],
		['wrong restore backup', (r) => { r.restore.backupSetId = 'wrong-backup'; }, 'restore proof is not bound'],
		['invented RPO', (r) => { r.restore.recoveryPointAgeAtStartMs = 0; }, 'measured RPO'],
		['invented database RTO', (r) => { r.restore.databaseRecoveryElapsedMs = 0; }, 'database RTO'],
		['invented Storage RTO', (r) => { r.restore.storageRecoveryElapsedMs = 0; }, 'Storage RTO'],
		['invented application RTO', (r) => { r.restore.applicationRecoveryElapsedMs = 0; }, 'application RTO'],
		['invented full RTO', (r) => { r.restore.fullRecoveryElapsedMs = 0; }, 'measured full RTO'],
		['missed full RTO target', (r) => { r.restore.completedAt = time('10:21'); r.restore.fullRecoveryElapsedMs = 7_260_000; }, 'measured full RTO'],
		['quarantine after data integrity', (r) => { r.restore.quarantineVerifiedAt = time('08:41'); }, 'restore timeline'],
		['wrong drill target', (r) => { r.incident.drill.targetProjectRef = sourceRef; }, 'drill target'],
		['late drill acknowledgement', (r) => { r.incident.drill.acknowledgedAt = time('09:29'); }, 'incident acknowledgement'],
		['mismatched isolation target', (r) => { r.isolation.restoreProjectRef = sourceRef; }, 'isolation identities'],
		['target is canonical staging', (r) => { r.restore.targetProjectRef = sourceRef; }, 'collides with a protected project'],
		['target is production', (r) => { r.restore.targetProjectRef = productionRef; }, 'collides with a protected project'],
		['target is historical', (r) => { r.isolation.forbiddenRefs.push(targetRef); }, 'collides with a protected project'],
		['missing production exclusion', (r) => { r.isolation.forbiddenRefs = [sourceRef]; }, 'forbidden project inventory'],
		['incomplete temporary credential cleanup', (r) => { r.cleanup.revokedTemporaryCredentialCount = 0; }, 'credential revocation'],
		['duplicated resource cleanup', (r) => { r.cleanup.resources.push({ ...r.cleanup.resources[0] }); }, 'cleanup resource inventory contains duplicates'],
		['wrong deleted project', (r) => { r.cleanup.resources[0].resourceIdSha256 = hash; }, 'absence of the exact restore target'],
		['missing retained monitor', (r) => { r.cleanup.retainedResources[0].kind = 'grafana-rule'; }, 'retained resource inventory'],
		['future top-level timestamp', (r) => { r.generatedAt = time('12:06'); }, 'receipt is stale or future-dated']
	];
	it.each(semanticFailures)('rejects %s even with matching evidence hashes', (_name, mutate, message) => {
		const receipt = receiptFixture();
		mutate(receipt);
		const { options } = withEvidence(receipt);
		expect(validateOperationsReadiness(receipt, options).join('\n')).toContain(message);
	});

	it.each([
		['unknown root field', (r: ReturnType<typeof receiptFixture>) => Object.assign(r, { privateKey: 'never-print-secret' })],
		['unknown nested field', (r: ReturnType<typeof receiptFixture>) => Object.assign(r.alerts, { recipient: 'never-print-secret@example.invalid' })],
		['recipient in alias', (r: ReturnType<typeof receiptFixture>) => { r.monitor.stackAlias = 'never-print-secret@example.invalid'; }],
		['unsigned mode', (r: ReturnType<typeof receiptFixture>) => { r.backup.encryption.algorithm = 'plaintext'; }],
		['private key in automation', (r: ReturnType<typeof receiptFixture>) => { r.decryption.privateKeyRetainedByAutomation = true; }],
		['unknown source data', (r: ReturnType<typeof receiptFixture>) => { r.backup.sourceClassification = 'unknown'; }],
		['incomplete dump inventory', (r: ReturnType<typeof receiptFixture>) => { r.backup.components.pop(); }],
		['RLS failed', (r: ReturnType<typeof receiptFixture>) => { r.restore.checks.rls = false; }],
		['source tokens accepted', (r: ReturnType<typeof receiptFixture>) => { r.restore.checks.oldSourceTokenDenied = false; }],
		['cleanup pending', (r: ReturnType<typeof receiptFixture>) => { r.cleanup.pendingMutationCount = 1; }],
		['nonzero spend', (r: ReturnType<typeof receiptFixture>) => { r.cleanup.cost = 1; }]
	] as const)('fails closed for %s without leaking content', (_name, mutate) => {
		const { receipt, options } = withEvidence();
		mutate(receipt);
		expect(validateOperationsReadiness(receipt, options)).toEqual(['operations receipt schema is invalid']);
	});

	it.each(['monitor', 'alerts', 'backup', 'decryption', 'restore', 'incident', 'isolation', 'cleanup'] as const)(
		'requires the actual %s evidence bytes', (section) => {
			const { receipt, evidence, options } = withEvidence();
			evidence.delete(receipt[section].evidenceSha256);
			expect(validateOperationsReadiness(receipt, options).join('\n')).toContain(`${section} evidence is missing`);
		}
	);

	it('rejects changed evidence even when the top-level receipt hash would match', () => {
		const { receipt, evidence, options } = withEvidence();
		evidence.set(receipt.monitor.evidenceSha256, Buffer.from('tampered'));
		expect(validateOperationsReadiness(receipt, options).join('\n')).toContain('monitor evidence is missing or has a hash mismatch');
	});

	it('rejects evidence generated for a different candidate', () => {
		const { receipt, evidence, options } = withEvidence();
		const { evidenceSha256: _hash, ...payload } = receipt.monitor;
		const altered = createOperationsEvidence({ ...receipt, commitSha: 'f'.repeat(40) }, 'monitor', payload);
		receipt.monitor.evidenceSha256 = altered.sha256;
		evidence.set(altered.sha256, altered.bytes);
		expect(validateOperationsReadiness(receipt, options).join('\n')).toContain('monitor evidence does not match the receipt provenance');
	});

	it('does not echo provider or filesystem exception values', () => {
		const { receipt, options } = withEvidence();
		const result = validateOperationsReadiness(receipt, { ...options, readEvidence: () => { throw new Error('never-print-secret'); } });
		expect(result.length).toBeGreaterThanOrEqual(11);
		expect(result.join('\n')).not.toContain('never-print-secret');
	});

	it('refuses to encode unknown fields into supposedly sanitized evidence', () => {
		const receipt = receiptFixture();
		const { evidenceSha256: _hash, ...payload } = receipt.monitor;
		expect(() => createOperationsEvidence(receipt, 'monitor', { ...payload, secret: 'never-print-secret' }))
			.toThrow('operations evidence schema is invalid');
	});

	it('requires actual backup descriptor bytes, not only the backup summary hash', () => {
		const { receipt, evidence, options } = withEvidence();
		evidence.delete(receipt.backup.descriptorSha256);
		expect(validateOperationsReadiness(receipt, options).join('\n')).toContain('backup descriptor could not be verified');
	});

	it('keeps daily backup freshness independent from a recent monthly rehearsal and owner-key proof', () => {
		const { receipt, options } = historicalFixture();
		expect(receipt.restore.backupSetId).not.toBe(receipt.backup.setId);
		expect(validateOperationsReadiness(receipt, options)).toEqual([]);
	});

	it('requires the exact current set for initial Issue 29 acceptance', () => {
		const { receipt, options } = historicalFixture();
		expect(validateOperationsReadiness(receipt, { ...options, requireCurrentBackupRehearsal: true }).join('\n'))
			.toContain('initial rehearsal must use the exact current backup');
		const current = withEvidence();
		expect(validateOperationsReadiness(current.receipt, { ...current.options, requireCurrentBackupRehearsal: true })).toEqual([]);
	});

	it('does not refresh monthly restore or key-recovery evidence with the daily backup timestamp', () => {
		const { receipt, options } = historicalFixture(31);
		const failures = validateOperationsReadiness(receipt, options).join('\n');
		expect(failures).toContain('restore rehearsal is stale');
		expect(failures).toContain('private-key recovery is stale');
	});

	it('requires the actual independently hashed historical descriptor', () => {
		const { receipt, options, evidence } = historicalFixture();
		evidence.delete(receipt.restore.descriptorSha256);
		expect(validateOperationsReadiness(receipt, options).join('\n')).toContain('rehearsed backup descriptor could not be verified');
	});

	it('rejects recovery-contract drift despite recent daily and monthly proof timestamps', () => {
		const historical = historicalFixture();
		historical.receipt.restore.recoveryContractSha256 = 'b'.repeat(64);
		const { receipt, options, evidence } = withEvidence(historical.receipt);
		for (const [key, bytes] of historical.evidence) evidence.set(key, bytes);
		expect(validateOperationsReadiness(receipt, options).join('\n')).toContain('latest backup recovery contract does not match the rehearsal');
	});

	it('rejects altered backup component hashes against the real descriptor', () => {
		const receipt = receiptFixture();
		receipt.backup.components[0].sha256 = 'b'.repeat(64);
		const { options } = withEvidence(receipt);
		expect(validateOperationsReadiness(receipt, options).join('\n')).toContain('backup descriptor component integrity does not match');
	});

	it('reads exact mode-0600 evidence bytes from a private directory outside the repository', () => {
		const directory = mkdtempSync(join(tmpdir(), 'operations-evidence-'));
		try {
			const bytes = Buffer.from('private evidence fixture');
			const digest = createHash('sha256').update(bytes).digest('hex');
			const path = join(directory, `${digest}.json`);
			writeFileSync(path, bytes, { mode: 0o600 });
			const reader = createOperationsEvidenceReader(directory, resolve(import.meta.dirname, '../..'));
			expect(reader(digest)).toEqual(bytes);
			chmodSync(path, 0o644);
			expect(() => reader(digest)).toThrow('operations evidence file is invalid');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.each(['symlink', 'hardlink', 'oversize'] as const)('rejects a %s evidence file before reading it', (kind) => {
		const directory = mkdtempSync(join(tmpdir(), 'operations-evidence-'));
		try {
			const target = join(directory, 'private-source.json');
			writeFileSync(target, kind === 'oversize' ? Buffer.alloc(1024 * 1024 + 1) : 'private fixture', { mode: 0o600 });
			const path = join(directory, `${hash}.json`);
			if (kind === 'symlink') symlinkSync(target, path);
			else if (kind === 'hardlink') linkSync(target, path);
			else writeFileSync(path, Buffer.alloc(1024 * 1024 + 1), { mode: 0o600 });
			const reader = createOperationsEvidenceReader(directory, resolve(import.meta.dirname, '../..'));
			expect(() => reader(hash)).toThrow('operations evidence file is invalid');
			expect(() => reader('../private-source')).toThrow('operations evidence file is invalid');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('rejects in-repository evidence even when the directory exists', () => {
		const repository = resolve(import.meta.dirname, '../..');
		expect(() => createOperationsEvidenceReader(repository, repository)).toThrow('operations evidence directory is invalid');
	});

});

it('rejects the obsolete readiness receipt without two-slot maintenance and persistent ownership evidence',()=>{
 const {receipt,options}=withEvidence();
 expect(validateOperationsReadiness({...receipt,schemaVersion:1},options)).toEqual(['operations receipt schema is invalid']);
});

it.each(['worker-drift','source-deleted','missing-retention','paused-too-early','target-still-present','monitor-not-resumed','preserved-source'])('rejects %s even after rehashing the maintenance receipt',kind=>{
 const r=receiptFixture();
 if(kind==='worker-drift')r.maintenance.resumeProof.workerSha256='f'.repeat(64);
 if(kind==='source-deleted')r.cleanup.resources[1].resourceIdSha256=idHash(`issue29-${runId}`);
 if(kind==='missing-retention')r.cleanup.retainedResources=r.cleanup.retainedResources.filter(v=>v.kind!=='synthetic-source');
 if(kind==='paused-too-early')r.maintenance.pausedAt=time('08:10');
 if(kind==='target-still-present')r.maintenance.targetWorkerAbsentAt=time('09:40');
 if(kind==='monitor-not-resumed')r.monitor.readBackAt=time('09:00');
 if(kind==='preserved-source')r.isolation.canonicalStagingRef=sourceRef;
 const {receipt,options}=withEvidence(r);expect(validateOperationsReadiness(receipt,options).length).toBeGreaterThan(0);
});
it('requires actual private pause/resume/readiness readback bytes, not asserted hashes',()=>{
 const {receipt,evidence,options}=withEvidence();evidence.delete(proofHash);
 expect(validateOperationsReadiness(receipt,options).join('\n')).toContain('maintenance referenced readback is unavailable');
});

function mergedReadinessFixture(){
 const r={...receiptFixture(),releaseUpdate:{protectedMergeSha256:hash,workerReadbackSha256:hash,monitorReadbackSha256:hash,originalRehearsalDescriptorSha256:descriptorBindings().descriptorSha256}};
 const fromCandidate={sha:r.commitSha,tree:r.treeSha,deploymentId:r.workerVersion};r.commitSha='e'.repeat(40);r.workerVersion='11111111-1111-4111-8111-111111111111';r.monitor.targetCommitSha=r.commitSha;r.monitor.targetWorkerVersion=r.workerVersion;r.monitor.configSha256='b'.repeat(64);r.alerts.configSha256=r.monitor.configSha256;
 const origin=`https://issue29-${runId}.owner.workers.dev`;
 const merge={schemaVersion:1,kind:'issue29-protected-merge',evidenceMode:'provider-readback',repository:'todevan/perfume-marketplace-bg',repositoryId:12,pullRequestNumber:99,fromCandidate,mergeSha:r.commitSha,treeSha:r.treeSha,verifiedAt:time('10:01'),mergedAt:time('10:00'),protectionSha256:hash,checkRunsSha256:hash};
 const extra=new Map<string,Buffer>();const store=(v:unknown)=>{const b=Buffer.from(canonicalJson(v)),h=createHash('sha256').update(b).digest('hex');extra.set(h,b);return h;};r.releaseUpdate.protectedMergeSha256=store(merge);
 const worker={evidenceMode:'provider-readback',workerName:`issue29-${runId}`,accountId:'c'.repeat(32),purpose:'source',versionId:r.workerVersion,candidateSha:r.commitSha,candidateTree:r.treeSha,projectRef:sourceRef,createdAt:time('10:02'),configSha256:hash,origin,status:'verified',checkedAt:time('10:03'),evidenceSha256:hash};r.releaseUpdate.workerReadbackSha256=store(worker);
 const resources=Array.from({length:13},(_,i)=>({status:'verified',kind:i<2?'check':'rule',key:'rule-'+i,configSha256:r.monitor.configSha256,resourceId:'id-'+i,evidenceSha256:hash,readBackAt:time('10:04'),previousCandidateSha:fromCandidate.sha,candidateSha:r.commitSha,priorStateSha256:proofHash}));
 const configurationResources=[...resources.map(({previousCandidateSha:_p,candidateSha:_c,priorStateSha256:_s,...item})=>item),...['folder','secret','receiver'].map(kind=>({status:'verified',kind,key:kind,configSha256:r.monitor.configSha256,resourceId:kind,evidenceSha256:hash,readBackAt:time('10:04')}))];
 const monitor={schemaVersion:1,kind:'issue29-grafana-release-update',evidenceMode:'provider-readback',runId,previousCandidateSha:fromCandidate.sha,candidateSha:r.commitSha,previousConfigSha256:hash,configSha256:r.monitor.configSha256,environmentAlias:r.environmentAlias,origin,verifiedAt:time('10:05'),protectedMergeEvidenceSha256:r.releaseUpdate.protectedMergeSha256,resources,configuration:{status:'verified',candidateSha:r.commitSha,configSha256:r.monitor.configSha256,verifiedAt:time('10:05'),resources:configurationResources,evidenceSha256:hash}};r.releaseUpdate.monitorReadbackSha256=store(monitor);
 const descriptor=descriptorFixture();descriptor.metadata.backupSetId='22345678-1234-4123-8123-123456789012';descriptor.metadata.release={commitSha:r.commitSha,treeSha:r.treeSha,workerVersion:r.workerVersion};descriptor.metadata.startedAt=time('11:00');descriptor.metadata.finishedAt=time('11:10');descriptor.retention.expiresAt='2026-10-10T11:10:00.000Z';
 const b=Buffer.from(canonicalJson(descriptor)+'\n'),descriptorHash=createHash('sha256').update(b).digest('hex');extra.set(descriptorHash,b);r.backup.descriptorSha256=descriptorHash;r.backup.setId=descriptor.metadata.backupSetId;r.backup.sourceCommitSha=r.commitSha;r.backup.checkpointAt=time('11:00');r.backup.completedAt=time('11:10');r.backup.verifiedAt=time('11:11');r.backup.artifact.createdAt=time('11:12');r.backup.artifact.expiresAt='2026-10-10T11:12:00.000Z';r.backup.artifact.readBackAt=time('11:13');r.backup.artifact.downloadVerifiedAt=time('11:14');
 const result=withEvidence(r);for(const[k,v]of extra)result.evidence.set(k,v);
 return{...result,receipt:r,merge,worker,monitor,store,extra,options:{...result.options,expected:{...expected,commitSha:r.commitSha,workerVersion:r.workerVersion,monitorConfigSha256:r.monitor.configSha256},requireCurrentBackupRehearsal:true}};
}
it('keeps exact reviewed rehearsal and first trusted merged daily artifact distinct through actual same-tree adoption',()=>{
 const f=mergedReadinessFixture();expect(f.receipt.backup.descriptorSha256).not.toBe(f.receipt.restore.descriptorSha256);
 expect(validateOperationsReadiness(f.receipt,f.options)).toEqual([]);
});
it.each(['tree','old-key','proof-missing','monitor-retarget','old-worker','unreviewed-descriptor'])('rejects %s drift in protected-merge rehearsal reuse',kind=>{
 const f=mergedReadinessFixture();
 if(kind==='proof-missing'){f.evidence.delete(f.receipt.releaseUpdate.protectedMergeSha256);f.extra.delete(f.receipt.releaseUpdate.protectedMergeSha256);}
 if(kind==='old-key')f.receipt.backup.encryption.keyId='f'.repeat(64);
 if(kind==='unreviewed-descriptor')f.receipt.releaseUpdate.originalRehearsalDescriptorSha256=f.receipt.backup.descriptorSha256;
 if(kind==='tree'){f.merge.fromCandidate.tree='a'.repeat(40);f.receipt.releaseUpdate.protectedMergeSha256=f.store(f.merge);}
 if(kind==='monitor-retarget'){f.monitor.origin='https://unrelated.workers.dev';f.receipt.releaseUpdate.monitorReadbackSha256=f.store(f.monitor);}
 if(kind==='old-worker'){f.worker.versionId=f.merge.fromCandidate.deploymentId;f.receipt.releaseUpdate.workerReadbackSha256=f.store(f.worker);}
 for(const[k,v]of f.extra)f.evidence.set(k,v);expect(validateOperationsReadiness(f.receipt,f.options).length).toBeGreaterThan(0);
});

it('refuses a receipt generation request made of owner-asserted PASS sections',async()=>{
 const {assembleOperationsReadiness}=await import('../../scripts/issue29-operations/readiness.mjs');
 expect(()=>assembleOperationsReadiness({manifest:{},records:{monitor:{status:'PASS'}},now,readEvidence:()=>undefined,runbookSha256:hash})).toThrow('operations producer evidence');
});

import {manifestFixture,maintenanceFixture} from '../fixtures/issue29-operations';
import {APPLICATION_TEST_TITLES,validateApplicationReport} from '../../scripts/issue29-operations/application-execution.mjs';
import {TARGET_DATABASE_CONTRACTS,validateTargetTap} from '../../scripts/issue29-operations/target-integrity.mjs';
import {validateManifest} from '../../scripts/issue29-operations/manifest.mjs';
function producerFixture(){
 const f=withEvidence(),r=f.receipt,m=manifestFixture();const save=(value:any)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(canonicalJson(value)),key=idHash(bytes.toString());f.evidence.set(key,bytes);return key;};
 m.state='cleanup_verified';m.candidate={sha:r.commitSha,tree:r.treeSha,deploymentId:r.workerVersion};m.source={...m.source!,ref:sourceRef,url:`https://${sourceRef}.supabase.co`};m.target={...m.target!,ref:targetRef,url:`https://${targetRef}.supabase.co`};m.forbiddenRefs=r.isolation.forbiddenRefs;m.preservedRefs=[productionRef,r.isolation.canonicalStagingRef];m.grafana={...m.grafana,stackAlias:r.monitor.stackAlias,configSha256:r.monitor.configSha256};
 m.maintenance={...maintenanceFixture(m),id:runId,phase:'closed',sourceRef,authorizedAt:r.maintenance.authorizedAt,expiresAt:r.maintenance.expiresAt,pausedAt:r.maintenance.pausedAt,pauseReadbackSha256:proofHash,resumedAt:r.maintenance.resumedAt,resumeReadbackSha256:proofHash,endedAt:r.maintenance.endedAt,backup:r.maintenance.backup,preservation:r.maintenance.preservation,resumeProof:r.maintenance.resumeProof,monitoring:{...r.maintenance.monitoring,silences:[{ruleKey:'health',id:runId,evidenceSha256:proofHash}]}};
 m.recoveryTimings={startedAt:r.restore.startedAt,databaseVerifiedAt:r.restore.databaseIntegrityAt,storageStartedAt:r.restore.storageStartedAt,storageVerifiedAt:r.restore.storageRestoredAt,applicationVerifiedAt:r.restore.completedAt};
 const history=(step:string,value:any,resourceId:string|null=null,intentSha256?:string)=>{const evidenceSha256=save(value);m.history.push({step,operationId:runId,resourceId,evidenceSha256,completedAt:time('10:00'),...(intentSha256?{intentSha256}:{})});return evidenceSha256;};
 const timeline={...r.alerts,recoveryEvaluatedAt:r.alerts.recoveredAt,ackEvidenceSha256:save({roleAlias:'owner',acknowledgedAt:r.alerts.acknowledgedAt})};delete (timeline as any).evidenceSha256;
 const map=[...signalFamilies,'health','email'].map((signal,i)=>({signal,ruleKey:'fixture-'+i,sourceRuleKey:'rule-'+i}));
 const monitor=history('monitoring-proof',{status:'verified',configuration:{status:'verified',candidateSha:r.commitSha,configSha256:r.monitor.configSha256,resources:Array.from({length:16},()=>({status:'verified'}))},checks:Array.from({length:11},()=>({score:{score:0},state:{state:'inactive'}})),heartbeat:{heartbeatAt:r.monitor.heartbeatAt},heartbeatAt:r.monitor.heartbeatAt,checkedAt:r.monitor.readBackAt});
 const alerts=history('monitoring-proof',{status:'verified',evidenceMode:'provider-readback',runId,candidateSha:r.commitSha,sourceConfigSha256:r.monitor.configSha256,destinationAlias:'owner-primary',timelines:map.map((mapping,i)=>({...timeline,ruleKey:mapping.ruleKey,failureEventId:'failure-'+i,recoveryEventId:'recovery-'+i})),ruleMappings:map});
 const restore={status:'DATABASE_STORAGE_VERIFIED_APPLICATION_PROOF_PENDING',descriptorSha256:r.restore.descriptorSha256};
 const tap=Buffer.from('1..1\nok 1 - deterministic fixture only\n'),tapSha=save(tap);
 const preparation=save({kind:'issue29-application-preparation',runId,targetRef,restore,contracts:{kind:'issue29-target-database-contracts',rolledBack:true,targetRef,candidateSha:r.commitSha,treeSha:r.treeSha,testCount:5,contracts:TARGET_DATABASE_CONTRACTS.map(name=>validateTargetTap(tap.toString(),name,hash))}});expect(tapSha).toBe(idHash(tap.toString()));
 const context={runId,maintenanceId:runId,targetRef,candidateSha:r.commitSha,treeSha:r.treeSha,deploymentId:'target-version',operationId:runId,startedAt:r.restore.applicationStartedAt};
 const report={config:{metadata:{issue29:context},workers:1,forbidOnly:true,projects:[{name:'chromium',retries:0,repeatEach:1}]},stats:{startTime:r.restore.applicationStartedAt,duration:600000,expected:2,unexpected:0,flaky:0,skipped:0},errors:[],suites:[{file:'real-beta.spec.ts',specs:APPLICATION_TEST_TITLES.map(title=>({title,file:'real-beta.spec.ts',ok:true,tests:[{projectName:'chromium',expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0,errors:[],attachments:[],stdout:[],stderr:[],startTime:r.restore.applicationStartedAt,duration:100}]}]}))}]};save(report);
 const browser=validateApplicationReport(report,context,r.restore.completedAt);
 const application=history('verify-restore',{kind:'issue29-application-integrity',status:'verified',runId,maintenanceId:runId,targetRef,candidate:m.candidate,applicationStartedAt:r.restore.applicationStartedAt,verifiedAt:r.restore.completedAt,databaseAuthIntegrityAt:r.restore.databaseIntegrityAt,preparationSha256:preparation,browser,credentialCleanup:{absent:true},measurement:{recoveryPointAgeAtStartMs:r.restore.recoveryPointAgeAtStartMs,databaseRecoveryElapsedMs:r.restore.databaseRecoveryElapsedMs,storageRecoveryElapsedMs:r.restore.storageRecoveryElapsedMs,applicationRecoveryElapsedMs:r.restore.applicationRecoveryElapsedMs,fullRecoveryElapsedMs:r.restore.fullRecoveryElapsedMs,withinTargets:true},auth:{kind:'issue29-target-auth',oldSourceTokenDenied:true,targetRef,actors:['seller','buyer','outsider','future-staff'].map(alias=>({alias,freshLoginVerified:true,aal:alias==='future-staff'?'aal2':'aal1'}))}});
 const incident=history('incident-drill',{...r.incident.drill,status:'verified',evidenceMode:'provider-readback',runId,projectRef:targetRef,candidateSha:r.commitSha,runbookSha256:r.incident.runbookSha256,rollbackDecision:{decision:'fixture-restore-only'},recoveredAt:r.incident.drill.restoredAt,recoveryEvaluatedAt:r.incident.drill.recoveredAt});
 const isolation=history('verify-restore',{schemaVersion:1,kind:'issue29-environment-isolation',evidenceMode:'provider-readback',runId,sourceRef,targetRef,candidate:m.candidate,checkedAt:r.isolation.checkedAt,preserved:{productionRefs:r.isolation.productionRefs,canonicalStagingRef:r.isolation.canonicalStagingRef,forbiddenRefs:r.isolation.forbiddenRefs},classificationBasis:'owner-environment-map-and-live-identity-readback',sourceProvenanceSha256:proofHash,providerPreflightSha256:proofHash,quarantineSha256:proofHash,sourceWorkerSha256:proofHash,targetWorkerSha256:proofHash,sourcePausedSha256:proofHash,productionReadOnly:true,sourceSyntheticVerified:true,targetDedicatedVerified:true,noForeignStateVerified:true,noSharedCredentialsVerified:true});
 const artifact=save({kind:'issue29-artifact-readback',repository:'todevan/perfume-marketplace-bg',candidateSha:r.commitSha,artifactId:123,createdAt:r.backup.artifact.createdAt,expiresAt:r.backup.artifact.expiresAt,verifiedAt:r.backup.artifact.readBackAt,sizeBytes:r.backup.artifact.sizeBytes,sha256:hash,recovery:{descriptorSha256:r.backup.descriptorSha256,componentInventorySha256:copyFixture().componentInventorySha256}});
 const decryption=history('verify-backup',{status:'OWNER_KEY_RECOVERY_VERIFIED',decryptionVerified:true,descriptorSha256:r.restore.descriptorSha256,backupSetId:r.restore.backupSetId,keyId:r.decryption.keyId,componentCount:8,independentlyVerifiedAt:r.decryption.verifiedAt});
 const secondaryCopy=history('artifact-upload',copyFixture());
 const contacts=save({schemaVersion:1,kind:'issue29-owner-contact-attestation',runId,roleAlias:'owner',runbookSha256:hash,contactMapAlias:'owner-private-contact-map',attestedAt:r.incident.contactsAttestedAt,privateKeyCustody:'owner-offline',privateKeyRetainedByAutomation:false,privateKeyCoLocatedWithSecondary:false});
 const observations:any[]=[];for(const [provider,resourceId,absentAt]of [['supabase',targetRef,r.maintenance.targetAbsentAt],['cloudflare',`issue29-restore-${runId}`,r.maintenance.targetWorkerAbsentAt]]){
  const createId='19292929-2929-4292-8292-292929292929',deleteId='39292929-2929-4292-8292-292929292929';
  const created=save({provider,resourceId,empty:true}),removed=save({provider,resourceId,absent:true});
  const createIntent=save({runId,pending:{operationId:createId,resourceId}}),deleteIntent=save({runId,pending:{operationId:deleteId,resourceId}});
  m.cleanup.resources.push({provider:provider as any,id:resourceId,runId,createdAt:time('08:21'),evidenceSha256:created,disposition:'disposable',absentAt});
  m.history.push({step:provider==='supabase'?'create-target':'deploy-worker',operationId:createId,resourceId,evidenceSha256:created,intentSha256:createIntent,completedAt:time('08:21')},{step:'cleanup-resource',operationId:deleteId,resourceId,evidenceSha256:removed,intentSha256:deleteIntent,completedAt:absentAt});
  observations.push({provider,resourceId,proof:{absent:true}});
 }
 m.allowedActions.push('deploy-worker','artifact-upload');const quarantine=history('quarantine',{fixture:'actual-shape only'},targetRef);m.history.find(h=>h.evidenceSha256===quarantine)!.completedAt=r.restore.quarantineVerifiedAt;
 const cleanup=history('cleanup',{kind:'issue29-final-cleanup',evidenceMode:'provider-readback',runId,candidate:m.candidate,maintenanceId:runId,maximumCost:0,observations,observationSha256:observations.map(save),verifiedAt:r.cleanup.verifiedAt,persistent:{workerBinding:{workerName:`issue29-${runId}`,projectRef:sourceRef,versionId:r.workerVersion}}});
 return{manifest:m,records:{monitor,alerts,application,incident,isolation,artifact,decryption,secondaryCopy,contacts,cleanup,latestDescriptor:r.backup.descriptorSha256},now,readEvidence:(key:string)=>f.evidence.get(key),runbookSha256:hash,evidence:f.evidence};
}
it('generates every normalized section from actual producer-shaped preimages and exact manifest history',async()=>{
 const {assembleOperationsReadiness}=await import('../../scripts/issue29-operations/readiness.mjs');const f=producerFixture();expect(()=>validateManifest(f.manifest,{now:new Date(now).toISOString()})).not.toThrow();const result=assembleOperationsReadiness(f);expect(result.receipt).toMatchObject({kind:'issue29-operations-readiness',commitSha:'c'.repeat(40),restore:{fullRecoveryElapsedMs:2400000},cleanup:{temporaryCredentialCount:3,revokedTemporaryCredentialCount:3}});expect(validateOperationsReadiness(result.receipt,{now,expected:result.expected,readEvidence:key=>result.evidence.get(key),requireCurrentBackupRehearsal:true})).toEqual([]);
});
