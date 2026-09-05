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
const sourceRef = 's'.repeat(20);
const targetRef = 't'.repeat(20);
const productionRef = 'p'.repeat(20);
const signalFamilies = ['health', 'auth', 'database', 'storage', 'email', 'deals', 'safety', 'backup_freshness', 'monitor_heartbeat'];

// Synthetic contract observations only; these are not hosted proof artifacts.
function receiptFixture() {
	return {
		schemaVersion: 1, kind: 'issue29-operations-readiness', runId: 'contract-fixture',
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
			secondaryCopy: { destinationAlias: 'owner-secondary', verifiedAt: time('08:15'), sha256: hash, privateKeyCoLocated: false },
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
			storageStartedAt: time('08:40'), storageRestoredAt: time('08:50'), completedAt: time('09:00'),
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
			productionRefs: [productionRef], canonicalStagingRef: sourceRef, forbiddenRefs: [sourceRef, productionRef],
			productionReadOnly: true, sourceSyntheticVerified: true, targetDedicatedVerified: true,
			noForeignStateVerified: true, noSharedCredentialsVerified: true, evidenceSha256: hash
		},
		cleanup: {
			state: 'cleanup_verified', verifiedAt: time('10:00'), pendingMutationCount: 0,
			resources: [{
				provider: 'supabase', resourceIdSha256: createHash('sha256').update(targetRef).digest('hex'),
				createdIntentSha256: hash, createdReadbackSha256: hash, deleteIntentSha256: hash,
				deleteReadbackSha256: hash, absenceReadbackSha256: hash, absent: true
			}], temporaryCredentialCount: 1, revokedTemporaryCredentialCount: 1,
			retainedResources: [
				{ alias: 'owner-operations', kind: 'grafana-stack' },
				{ alias: 'owner-primary', kind: 'grafana-destination' },
				{ alias: 'launch-readiness', kind: 'grafana-rule' },
				{ alias: 'daily-backup', kind: 'encrypted-backup' },
				{ alias: 'owner-secondary', kind: 'secondary-encrypted-copy' }
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

function withEvidence(receipt = receiptFixture()) {
	const descriptorBytes = Buffer.from(`${canonicalJson(descriptorFixture())}\n`);
	const evidence = new Map<string, Buffer>([[createHash('sha256').update(descriptorBytes).digest('hex'), descriptorBytes]]);
	for (const name of ['monitor', 'alerts', 'backup', 'decryption', 'restore', 'incident', 'isolation', 'cleanup'] as const) {
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
	for (const name of ['recoveryCheckpointAt', 'startedAt', 'quarantineVerifiedAt', 'databaseIntegrityAt', 'storageStartedAt', 'storageRestoredAt', 'completedAt'] as const) {
		receipt.restore[name] = before(receipt.restore[name]);
	}
	receipt.decryption.backupSetId = descriptor.metadata.backupSetId;
	receipt.decryption.descriptorSha256 = digest;
	receipt.decryption.verifiedAt = before(receipt.decryption.verifiedAt);
	const result = withEvidence(receipt);
	result.evidence.set(digest, bytes);
	return { ...result, rehearsedDescriptor: descriptor };
}

describe('Issue 29 operations readiness receipt', () => {
	it('rejects a generic passing timestamp instead of independent recovery evidence', () => {
		expect(validateOperationsReadiness({ passed: true, checkedAt: new Date().toISOString() }))
			.toEqual(['operations receipt schema is invalid']);
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
		['wrong secondary copy', (r) => { r.backup.secondaryCopy.sha256 = 'b'.repeat(64); }, 'secondary encrypted copy hash'],
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
		expect(result).toHaveLength(10);
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
