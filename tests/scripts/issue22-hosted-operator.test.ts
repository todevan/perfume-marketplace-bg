import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
	TARGET,
	KNOWN_FAILED_RECOVERY,
	EXPECTED_STORAGE_BUCKETS,
	OPERATOR_CAPACITY_BUDGET,
	assertCleanupReceiptForMigratedBaseline,
	assertCurrentCleanupReceipt,
	assertAuthConfiguration,
	assertAuthState,
	assertCatalogCounts,
	assertExactWorkerConfig,
	assertFinalStorageState,
	assertLiveCloudflareCapacity,
	assertNullableAuthUpdateSchema,
	assertRecoveryAttribution,
	assertRecoveryEnvelope,
	assertSafeInventory,
	assertSafeDisabledAuth,
	buildAuthCredentialClearPatch,
	classifyExactWorkerProbe,
	clearAuthSafely,
	cleanupExactWorkerSecrets,
	decideMigrationExecution,
	fixedMigrationCommands,
	fixedWorkerSecretCommands,
	finalizeRecoveryArtifacts,
	buildIssue22ChildEnv,
	reconcileAuthenticatedRecoveryArtifacts,
	resolveWidgetForCleanup,
	resolveSavedWidgetForCleanup,
	recoverCatalogForCleanup,
	runLinkedCommand,
	runHostedExecutionWithRequiredCleanup,
	runPriorityCleanup,
	sealRecoveryArtifactTransition,
	sealRecoveryState
} from '../../scripts/issue22-hosted/operator-lib.mjs';

const repo = resolve(import.meta.dirname, '..', '..');
const operatorRoot = resolve(repo, 'scripts', 'issue22-hosted');
const receiptAuthenticationKey = `sbp_${'a'.repeat(40)}`;
const knownRecoveryChain = {
	predecessorSha: KNOWN_FAILED_RECOVERY.predecessorSha,
	recoverySha256: KNOWN_FAILED_RECOVERY.recoverySha256,
	generatedConfigSha256: KNOWN_FAILED_RECOVERY.generatedConfigSha256,
	runId: KNOWN_FAILED_RECOVERY.runId,
	ledgerSha256: null
};

const migratedObservedState = {
	baselineMode: 'migrated',
	migrationCount: 18,
	storageBuckets: 4,
	storageObjects: 0,
	catalog: { brands: 196, aliases: 48, memberships: 335 },
	authUsers: 0,
	applicationRows: 0,
	workerSecrets: 0,
	widgetAbsent: true,
	authDisabled: true,
	definitionFingerprints: {
		relationsSha256: '1'.repeat(64),
		storageAuthorizationSha256: '7'.repeat(64),
		typesSha256: '2'.repeat(64),
		functionsSha256: '3'.repeat(64),
		policiesSha256: '4'.repeat(64),
		triggersSha256: '5'.repeat(64),
		catalogSha256: '6'.repeat(64)
	}
};

const pristineObservedState = {
	...migratedObservedState,
	baselineMode: 'pristine',
	migrationCount: 0,
	storageBuckets: 0,
	catalog: { brands: 0, aliases: 0, memberships: 0 },
	definitionFingerprints: null
};

function authenticate(domain: string, payload: unknown) {
	return createHmac('sha256', receiptAuthenticationKey)
		.update(`${domain}\0${JSON.stringify(payload)}`)
		.digest('hex');
}

function currentRecoveryCore(candidateSha = 'a'.repeat(40)) {
	return {
		recoveryVersion: 2,
		candidateSha,
		projectRef: TARGET.projectRef,
		cloudflareAccountId: TARGET.cloudflareAccountId,
		workerName: TARGET.workerName,
		runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		widgetIntent: { name: 'aromatika-issue22-aaaaaaaa-aaa', domain: TARGET.workerHostname },
		widgetSitekey: null,
		createdAt: '2026-08-17T16:00:00.000Z',
		updatedAt: '2026-08-17T16:00:00.000Z',
		authQuiescedAt: null,
		baselineEstablishmentMode: null,
		adoptedPredecessorSha: null,
		adoptedRecoverySha256: null,
		adoptedGeneratedConfigSha256: null,
		sealedFinalState: false,
		predecessorEvidenceMac: null,
		cleanupFinalStateProvenAt: null,
		ledgerSha256: null,
		generatedConfigSha256: null,
		retainedLedger: null,
		retainedGeneratedConfig: null,
		retainedLedgerSha256: null,
		retainedGeneratedConfigSha256: null
	};
}

function receiptCore(candidateSha: string) {
	return {
		receiptVersion: 3,
		receiptKind: 'baseline-establishment',
		establishmentMode: 'legacy-adoption',
		at: '2026-08-17T17:00:00.000Z',
		candidateSha,
		projectRef: TARGET.projectRef,
		cloudflareAccountId: TARGET.cloudflareAccountId,
		worker: TARGET.workerName,
		originRunId: KNOWN_FAILED_RECOVERY.runId,
		originLedgerSha256: null,
		adoptedEvidence: {
			predecessorSha: KNOWN_FAILED_RECOVERY.predecessorSha,
			recoverySha256: KNOWN_FAILED_RECOVERY.recoverySha256,
			generatedConfigSha256: KNOWN_FAILED_RECOVERY.generatedConfigSha256,
			predecessorEvidenceMac: authenticate('issue22:recovery-adoption:v1', knownRecoveryChain)
		},
		etherealCredentialPersisted: false,
		maxSyntheticWorkerRequests: OPERATOR_CAPACITY_BUDGET.totalRequests,
		maxSyntheticWorkerCpuMs: OPERATOR_CAPACITY_BUDGET.totalCpuMs,
		observedFinalState: migratedObservedState
	};
}

function sealedReceipt(candidateSha: string) {
	const core = receiptCore(candidateSha);
	return { ...core, payloadMac: authenticate('issue22:baseline-establishment:v1', core) };
}

function currentReceipt(
	candidateSha: string,
	runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
	observedFinalState: typeof migratedObservedState | typeof pristineObservedState = migratedObservedState
) {
	const core = {
		receiptVersion: 3,
		receiptKind: 'current-run-cleanup',
		at: '2026-08-17T18:00:00.000Z',
		candidateSha,
		projectRef: TARGET.projectRef,
		cloudflareAccountId: TARGET.cloudflareAccountId,
		worker: TARGET.workerName,
		runId,
		ledgerSha256: null,
		etherealCredentialPersisted: false,
		maxSyntheticWorkerRequests: OPERATOR_CAPACITY_BUDGET.totalRequests,
		maxSyntheticWorkerCpuMs: OPERATOR_CAPACITY_BUDGET.totalCpuMs,
		observedFinalState
	};
	return { ...core, payloadMac: authenticate('issue22:current-run-cleanup:v1', core) };
}

describe('issue-22 hosted migration boundary', () => {
	it('constructs only noninteractive exact-target linked commands', () => {
		const workdir = 'C:\\private\\issue22-runtime';
		expect(fixedMigrationCommands(workdir)).toEqual([
			['exec', 'supabase', 'link', '--project-ref', TARGET.projectRef, '--workdir', workdir, '--yes'],
			['exec', 'supabase', 'db', 'push', '--linked', '--dry-run', '--workdir', workdir, '--yes'],
			['exec', 'supabase', 'db', 'push', '--linked', '--workdir', workdir, '--yes'],
			['exec', 'supabase', 'migration', 'list', '--linked', '--workdir', workdir]
		]);
	});

	it('checks the physical link immediately before and after every linked command', () => {
		const events: string[] = [];
		runLinkedCommand(
			['exec', 'supabase', 'db', 'push', '--linked'],
			() => events.push('attest-link'),
			() => events.push('command')
		);
		expect(events).toEqual(['attest-link', 'command', 'attest-link']);
	});

	it('requires exact organization, empty full inventory, and signup quiescence', () => {
		const safe = {
			projectRef: TARGET.projectRef,
			organizationId: TARGET.organizationId,
			region: TARGET.region,
			status: 'ACTIVE_HEALTHY',
			organizationPlan: 'free',
			selectedAddons: [],
			authUsers: 0,
			buckets: 0,
			objects: 0,
			hostedMigrations: [],
			publicRelations: [],
			publicFunctions: [],
			publicPolicies: [],
			privateSchemaExists: false,
			unexpectedSchemas: [],
			userTriggers: [],
			realtimePublicationTables: [],
			signupDisabled: true
		};
		expect(assertSafeInventory(safe, ['1', '2'])).toEqual({ mode: 'pristine' });
		expect(() => assertSafeInventory({ ...safe, organizationId: 'wrong' })).toThrow(/organization/i);
		expect(() => assertSafeInventory({ ...safe, publicFunctions: ['hostile'] })).toThrow(/inventory/i);
		expect(() => assertSafeInventory({ ...safe, unexpectedSchemas: ['hostile'] })).toThrow(/inventory/i);
		expect(() => assertSafeInventory({ ...safe, realtimePublicationTables: ['public.profiles'] })).toThrow(/inventory/i);
	});

	it('accepts only the exact migrated zero-run-data baseline and never a partial chain', () => {
		const expectedVersions = ['1', '2'];
		const migrated = {
			projectRef: TARGET.projectRef,
			organizationId: TARGET.organizationId,
			region: TARGET.region,
			status: 'ACTIVE_HEALTHY',
			organizationPlan: 'free',
			selectedAddons: [],
			authUsers: 0,
			bucketDefinitions: EXPECTED_STORAGE_BUCKETS,
			buckets: EXPECTED_STORAGE_BUCKETS.length,
			objects: 0,
			hostedMigrations: expectedVersions.map((version) => ({ version })),
			publicRelations: ['public.profiles'],
			publicFunctions: ['complete_beta_onboarding'],
			publicPolicies: ['public.profiles:profiles_self_update'],
			privateSchemaExists: true,
			unexpectedSchemas: ['private'],
			userTriggers: ['public.profiles:protect_profile_privileged_fields'],
			realtimePublicationTables: [],
			applicationRows: { profiles: 0, memberships: 0, consents: 0 },
			catalog: { brands: 196, aliases: 48, memberships: 335 },
			definitionFingerprints: {
				relationsSha256: '1'.repeat(64),
				storageAuthorizationSha256: '7'.repeat(64),
				typesSha256: '2'.repeat(64),
				functionsSha256: '3'.repeat(64),
				policiesSha256: '4'.repeat(64),
				triggersSha256: '5'.repeat(64),
				catalogSha256: '6'.repeat(64)
			},
			applicationTableCounts: [
				{ table: 'private.first_admin_bootstrap', rows: 0 },
				{ table: 'public.profiles', rows: 0 }
			],
			signupDisabled: true
		};
		const exactInventory = {
			public_relations: migrated.publicRelations,
			public_functions: migrated.publicFunctions,
			public_policies: migrated.publicPolicies,
			private_schema_exists: migrated.privateSchemaExists,
			unexpected_schemas: migrated.unexpectedSchemas,
			user_triggers: migrated.userTriggers,
			realtime_publication_tables: migrated.realtimePublicationTables,
			definition_fingerprints: migrated.definitionFingerprints,
			application_table_counts: migrated.applicationTableCounts
		};
		expect(assertSafeInventory(migrated, expectedVersions, exactInventory)).toEqual({ mode: 'migrated' });
		expect(() => assertSafeInventory({ ...migrated, hostedMigrations: [{ version: '1' }] }, expectedVersions, exactInventory)).toThrow(/migration/i);
		expect(() => assertSafeInventory({ ...migrated, applicationRows: { profiles: 1, memberships: 0, consents: 0 } }, expectedVersions, exactInventory)).toThrow(/run data/i);
		expect(() => assertSafeInventory({ ...migrated, bucketDefinitions: [] }, expectedVersions, exactInventory)).toThrow(/bucket/i);
		for (const field of ['publicRelations', 'publicFunctions', 'publicPolicies', 'unexpectedSchemas', 'userTriggers', 'realtimePublicationTables'] as const) {
			expect(() => assertSafeInventory({ ...migrated, [field]: [...migrated[field], 'hostile.drift'] }, expectedVersions, exactInventory)).toThrow(/inventory/i);
		}
		for (const field of ['storageAuthorizationSha256', 'typesSha256', 'functionsSha256', 'triggersSha256', 'catalogSha256'] as const) {
			expect(() => assertSafeInventory({
				...migrated,
				definitionFingerprints: { ...migrated.definitionFingerprints, [field]: 'f'.repeat(64) }
			}, expectedVersions, exactInventory)).toThrow(/fingerprint/i);
		}
		const storagePolicyDefinitionDrift = {
			...migrated,
			definitionFingerprints: { ...migrated.definitionFingerprints, policiesSha256: 'f'.repeat(64) }
		};
		expect(() => assertSafeInventory(storagePolicyDefinitionDrift, expectedVersions, exactInventory)).toThrow(/fingerprint/i);
		const nullVersusEmptyAclDrift = {
			...migrated,
			definitionFingerprints: { ...migrated.definitionFingerprints, relationsSha256: 'f'.repeat(64) }
		};
		expect(() => assertSafeInventory(nullVersusEmptyAclDrift, expectedVersions, exactInventory)).toThrow(/fingerprint/i);
		expect(() => assertSafeInventory({
			...migrated,
			applicationTableCounts: migrated.applicationTableCounts.map((item) => item.table === 'public.profiles' ? { ...item, rows: 1 } : item)
		}, expectedVersions, exactInventory)).toThrow(/application table/i);
		expect(() => assertSafeInventory({
			...migrated,
			applicationTableCounts: [{ table: 'public.profiles', rows: 0 }]
		}, expectedVersions, exactInventory)).toThrow(/application table/i);
	});

	it('requires the production catalogue baseline after the repository-native seed', () => {
		expect(() => assertCatalogCounts({ brands: 196, aliases: 48, memberships: 335 })).not.toThrow();
		expect(() => assertCatalogCounts({ brands: 0, aliases: 0, memberships: 0 })).toThrow(/catalog/i);
	});
});

describe('issue-22 hosted cleanup boundary', () => {
	it('fails closed without emitting success when recovery disappears after the journey starts', async () => {
		let recoveryPresent = true;
		const emitSuccess = vi.fn();
		const writeReceipt = vi.fn();
		await expect(runHostedExecutionWithRequiredCleanup({
			execute: async (markCleanupRequired) => {
				markCleanupRequired();
				recoveryPresent = false;
			},
			cleanup: async () => {
				if (!recoveryPresent) throw new Error('recovery state is missing');
				writeReceipt();
			},
			emitSuccess
		})).rejects.toThrow(/recovery state is missing/i);
		expect(emitSuccess).not.toHaveBeenCalled();
		expect(writeReceipt).not.toHaveBeenCalled();
	});

	it('preseals exact config and ledger transitions and recovers an interrupted materialization before provider cleanup', async () => {
		const candidateSha = 'a'.repeat(40);
		const initial = sealRecoveryState(currentRecoveryCore(candidateSha), receiptAuthenticationKey);
		const generatedConfig = '{"name":"perfume-marketplace-bg-issue22"}\n';
		const configPending = sealRecoveryArtifactTransition(initial, candidateSha, {
			generatedConfigContent: generatedConfig,
			updatedAt: '2026-08-17T16:00:01.000Z'
		}, receiptAuthenticationKey);

		expect(() => assertRecoveryEnvelope(configPending, candidateSha, receiptAuthenticationKey)).not.toThrow();
		const restoredConfig = reconcileAuthenticatedRecoveryArtifacts(configPending, {
			ledgerContent: null,
			generatedConfigContent: null
		});
		expect(restoredConfig).toMatchObject({ generatedConfigContent: generatedConfig, restoreGeneratedConfig: true });
		expect(() => assertRecoveryAttribution(configPending, candidateSha, {
			authenticationKey: receiptAuthenticationKey,
			ledgerSha256: null,
			generatedConfigSha256: createHash('sha256').update(generatedConfig).digest('hex')
		})).not.toThrow();

		const firstLedgerLine = '{"event":"create_intent","label":"alice"}\n';
		const ledgerPending = sealRecoveryArtifactTransition(configPending, candidateSha, {
			ledgerContent: firstLedgerLine,
			updatedAt: '2026-08-17T16:00:02.000Z'
		}, receiptAuthenticationKey);
		const restored = reconcileAuthenticatedRecoveryArtifacts(ledgerPending, {
			ledgerContent: null,
			generatedConfigContent: generatedConfig
		});
		expect(restored).toMatchObject({ ledgerContent: firstLedgerLine, restoreLedger: true });

		const events: string[] = ['restore-authenticated-local-artifacts'];
		await runPriorityCleanup({
			disable: async () => { events.push('disable-auth'); },
			rollbackDeploy: async () => { events.push('rollback'); },
			capacity: async () => undefined,
			rollbackSmoke: async () => undefined,
			recoverCatalog: async () => undefined,
			cleanupData: async () => { expect(restored.ledgerContent).toBe(firstLedgerLine); },
			cleanupSecrets: async () => undefined,
			cleanupWidget: async () => undefined,
			attestFinal: async () => undefined,
			deleteRecovery: async () => undefined
		}, 1);
		expect(events.slice(0, 3)).toEqual(['restore-authenticated-local-artifacts', 'disable-auth', 'rollback']);

		const tampered = { ...ledgerPending, recoveryMac: '0'.repeat(64) };
		expect(() => assertRecoveryEnvelope(tampered, candidateSha, receiptAuthenticationKey)).toThrow(/attribution/i);
	});

	it('allows only execution variables and Ethereal inputs into the Python child', () => {
		const environment = buildIssue22ChildEnv({
			PATH: 'python-path',
			SYSTEMROOT: 'system-root',
			ISSUE22_RECOVERY_SEAL_KEY: 'secret-seal-key',
			ISSUE22_RECOVERY_PATH: 'private-recovery-path',
			ISSUE22_LEDGER_PATH: 'private-ledger-path',
			SUPABASE_ACCESS_TOKEN: 'provider-secret'
		}, {
			ETHEREAL_USER: 'mail-user',
			ETHEREAL_PASS: 'mail-pass',
			ISSUE22_RECIPIENT: 'recipient@example.invalid'
		});
		expect(environment).toEqual({
			NO_COLOR: '1',
			PATH: 'python-path',
			SYSTEMROOT: 'system-root',
			ETHEREAL_USER: 'mail-user',
			ETHEREAL_PASS: 'mail-pass',
			ISSUE22_RECIPIENT: 'recipient@example.invalid'
		});
		expect(environment).not.toHaveProperty('ISSUE22_RECOVERY_SEAL_KEY');
	});

	it('runs the executable Issue 22 fingerprint test in database CI after local reset', () => {
		const packageJson = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8'));
		expect(packageJson.scripts['test:db:issue22-fingerprints']).toBe('node --test supabase/tests/issue22_fingerprints.local.test.mjs');
		const workflow = readFileSync(resolve(repo, '.github', 'workflows', 'ci.yml'), 'utf8');
		const reset = workflow.indexOf('run: pnpm db:reset');
		const fingerprint = workflow.indexOf('run: pnpm test:db:issue22-fingerprints');
		expect(reset).toBeGreaterThan(-1);
		expect(fingerprint).toBeGreaterThan(reset);
	});

	it('binds recovery to the exact candidate and provider targets', () => {
		const candidateSha = 'a'.repeat(40);
		const recoveryCore = {
			recoveryVersion: 2,
			candidateSha,
			projectRef: TARGET.projectRef,
			cloudflareAccountId: TARGET.cloudflareAccountId,
			workerName: TARGET.workerName,
			runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			widgetIntent: { name: 'aromatika-issue22-aaaaaaaa-aaa', domain: TARGET.workerHostname },
			widgetSitekey: null,
			createdAt: '2026-08-17T16:00:00.000Z',
			updatedAt: '2026-08-17T16:00:00.000Z',
			authQuiescedAt: null,
			baselineEstablishmentMode: null,
			adoptedPredecessorSha: null,
			adoptedRecoverySha256: null,
			adoptedGeneratedConfigSha256: null,
			sealedFinalState: false,
			predecessorEvidenceMac: null,
			cleanupFinalStateProvenAt: null,
			ledgerSha256: null,
			generatedConfigSha256: null,
			retainedLedger: null,
			retainedGeneratedConfig: null,
			retainedLedgerSha256: null,
			retainedGeneratedConfigSha256: null
		};
		const recovery = sealRecoveryState(recoveryCore, receiptAuthenticationKey);
		expect(() => assertRecoveryAttribution(recovery, candidateSha, { authenticationKey: receiptAuthenticationKey, ledgerSha256: null, generatedConfigSha256: null })).not.toThrow();
		expect(() => assertRecoveryAttribution(recoveryCore, candidateSha, { authenticationKey: receiptAuthenticationKey })).toThrow(/attribution/i);
		expect(() => assertRecoveryAttribution({ ...recovery, candidateSha: 'b'.repeat(40) }, candidateSha)).toThrow(/attribution/i);
		expect(() => assertRecoveryAttribution({ ...recovery, projectRef: TARGET.forbiddenProjectRef }, candidateSha)).toThrow(/attribution/i);
		const replayedForAnotherCandidate = { ...recovery, candidateSha: 'b'.repeat(40) };
		expect(() => assertRecoveryAttribution(replayedForAnotherCandidate, 'b'.repeat(40), { authenticationKey: receiptAuthenticationKey })).toThrow(/attribution/i);
		expect(() => assertRecoveryAttribution({ ...recovery, widgetSitekey: 'tampered-sitekey' }, candidateSha, { authenticationKey: receiptAuthenticationKey })).toThrow(/attribution/i);
	});

	it('adopts only predecessor recovery chained by a secret-backed authenticator', () => {
		const currentCandidate = 'b'.repeat(40);
		const predecessorRecovery = {
			candidateSha: KNOWN_FAILED_RECOVERY.predecessorSha,
			projectRef: TARGET.projectRef,
			cloudflareAccountId: TARGET.cloudflareAccountId,
			workerName: TARGET.workerName,
			runId: KNOWN_FAILED_RECOVERY.runId
		};
		const artifacts = {
			recoverySha256: KNOWN_FAILED_RECOVERY.recoverySha256,
			generatedConfigSha256: KNOWN_FAILED_RECOVERY.generatedConfigSha256,
			authenticationKey: receiptAuthenticationKey
		};
		expect(assertRecoveryAttribution(predecessorRecovery, currentCandidate, artifacts)).toEqual({
			adopted: true,
			predecessorSha: KNOWN_FAILED_RECOVERY.predecessorSha,
			recoverySha256: KNOWN_FAILED_RECOVERY.recoverySha256,
			generatedConfigSha256: KNOWN_FAILED_RECOVERY.generatedConfigSha256
		});
		const adoptedRetryCore = {
			...predecessorRecovery,
			recoveryVersion: 2,
			candidateSha: currentCandidate,
			widgetIntent: { name: `aromatika-issue22-${KNOWN_FAILED_RECOVERY.runId.slice(0, 12)}`, domain: TARGET.workerHostname },
			widgetSitekey: null,
			createdAt: '2026-08-17T16:00:00.000Z',
			updatedAt: '2026-08-17T17:00:00.000Z',
			authQuiescedAt: null,
			baselineEstablishmentMode: null,
			adoptedPredecessorSha: KNOWN_FAILED_RECOVERY.predecessorSha,
			adoptedRecoverySha256: KNOWN_FAILED_RECOVERY.recoverySha256,
			adoptedGeneratedConfigSha256: KNOWN_FAILED_RECOVERY.generatedConfigSha256,
			sealedFinalState: true,
			predecessorEvidenceMac: authenticate('issue22:recovery-adoption:v1', knownRecoveryChain),
			cleanupFinalStateProvenAt: '2026-08-17T17:00:00.000Z',
			ledgerSha256: null,
			generatedConfigSha256: KNOWN_FAILED_RECOVERY.generatedConfigSha256,
			retainedLedger: null,
			retainedGeneratedConfig: null,
			retainedLedgerSha256: null,
			retainedGeneratedConfigSha256: null
		};
		const adoptedRetry = sealRecoveryState(adoptedRetryCore, receiptAuthenticationKey);
		expect(() => assertRecoveryAttribution({ ...adoptedRetry, sealedFinalState: undefined }, currentCandidate, artifacts)).toThrow(/attribution/i);
		expect(assertRecoveryAttribution(adoptedRetry, currentCandidate, artifacts)).toMatchObject({
			adopted: true,
			predecessorSha: KNOWN_FAILED_RECOVERY.predecessorSha
		});
		expect(() => assertRecoveryAttribution({ ...adoptedRetry, predecessorEvidenceMac: '0'.repeat(64) }, currentCandidate, artifacts)).toThrow(/attribution/i);
		expect(() => assertRecoveryAttribution(adoptedRetry, currentCandidate, { ...artifacts, authenticationKey: `sbp_${'b'.repeat(40)}` })).toThrow(/attribution/i);
		expect(() => assertRecoveryAttribution({ ...adoptedRetry, cleanupFinalStateProvenAt: null }, currentCandidate, artifacts)).toThrow(/attribution/i);
		expect(() => assertRecoveryAttribution({ ...adoptedRetry, adoptedRecoverySha256: '0'.repeat(64) }, currentCandidate)).toThrow(/attribution/i);
		expect(() => assertRecoveryAttribution(predecessorRecovery, currentCandidate, { ...artifacts, recoverySha256: '0'.repeat(64) })).toThrow(/attribution/i);
		expect(() => assertRecoveryAttribution({ ...predecessorRecovery, runId: 'wrong' }, currentCandidate, artifacts)).toThrow(/attribution/i);
	});

	it('requires a cleanup receipt bound to the adopted recovery before migrated rerun', () => {
		const candidateSha = 'c'.repeat(40);
		const receipt = sealedReceipt(candidateSha);
		expect(() => assertCleanupReceiptForMigratedBaseline(receipt, candidateSha, receiptAuthenticationKey)).not.toThrow();
		for (const [field, forged] of [
			['originRunId', 'forged-run'],
			['originLedgerSha256', '0'.repeat(64)],
			['etherealCredentialPersisted', true],
			['maxSyntheticWorkerRequests', 1],
			['maxSyntheticWorkerCpuMs', 1],
			['observedFinalState', pristineObservedState],
			['adoptedEvidence', { ...receipt.adoptedEvidence, predecessorEvidenceMac: '0'.repeat(64) }]
		] as const) {
			const forgedCore = { ...receiptCore(candidateSha), [field]: forged };
			const forgedReceipt = { ...forgedCore, payloadMac: createHash('sha256').update(JSON.stringify(forgedCore)).digest('hex') };
			expect(() => assertCleanupReceiptForMigratedBaseline(forgedReceipt, candidateSha, receiptAuthenticationKey)).toThrow(/cleanup receipt/i);
		}
		expect(() => assertCleanupReceiptForMigratedBaseline({ ...receipt, payloadMac: '0'.repeat(64) }, candidateSha, receiptAuthenticationKey)).toThrow(/cleanup receipt/i);
		expect(() => assertCleanupReceiptForMigratedBaseline({ ...receipt, candidateSha: 'd'.repeat(40) }, candidateSha, receiptAuthenticationKey)).toThrow(/cleanup receipt/i);
		expect(decideMigrationExecution({ mode: 'pristine' }, null, candidateSha, receiptAuthenticationKey)).toBe('migrate');
		expect(decideMigrationExecution({ mode: 'migrated' }, receipt, candidateSha, receiptAuthenticationKey)).toBe('reuse');
		expect(() => decideMigrationExecution({ mode: 'migrated' }, null, candidateSha, receiptAuthenticationKey)).toThrow(/cleanup receipt/i);
	});

	it('preserves authenticated baseline evidence while pristine/current cleanup succeeds independently', async () => {
		const library = await import('../../scripts/issue22-hosted/operator-lib.mjs');
		expect(library.selectBaselineCleanupReceipt).toBeTypeOf('function');
		if (typeof library.selectBaselineCleanupReceipt !== 'function') return;
		const candidateSha = 'c'.repeat(40);
		const adopted = sealedReceipt(candidateSha);
		expect(library.selectBaselineCleanupReceipt({ existing: null, authenticatedEstablishment: adopted, candidateSha, authenticationKey: receiptAuthenticationKey })).toEqual(adopted);
		expect(library.selectBaselineCleanupReceipt({ existing: adopted, authenticatedEstablishment: sealedReceipt(candidateSha), candidateSha, authenticationKey: receiptAuthenticationKey })).toBe(adopted);
		expect(library.selectBaselineCleanupReceipt({ existing: adopted, authenticatedEstablishment: null, candidateSha, authenticationKey: receiptAuthenticationKey })).toBe(adopted);
		expect(library.selectBaselineCleanupReceipt({ existing: null, authenticatedEstablishment: null, candidateSha, authenticationKey: receiptAuthenticationKey })).toBeNull();
		expect(() => library.selectBaselineCleanupReceipt({ existing: null, authenticatedEstablishment: { ...adopted, payloadMac: '0'.repeat(64) }, candidateSha, authenticationKey: receiptAuthenticationKey })).toThrow(/baseline.*receipt/i);
		expect(decideMigrationExecution({ mode: 'migrated' }, adopted, candidateSha, receiptAuthenticationKey)).toBe('reuse');
		const pristineCleanup = currentReceipt(candidateSha, undefined, pristineObservedState);
		expect(() => assertCurrentCleanupReceipt(pristineCleanup, candidateSha, pristineCleanup.runId, receiptAuthenticationKey, pristineObservedState)).not.toThrow();
		expect(() => assertCurrentCleanupReceipt(pristineCleanup, candidateSha, pristineCleanup.runId, receiptAuthenticationKey, migratedObservedState)).toThrow(/current.*receipt/i);
		expect(() => assertCurrentCleanupReceipt(pristineCleanup, candidateSha, pristineCleanup.runId, `sbp_${'b'.repeat(40)}`, pristineObservedState)).toThrow(/current.*receipt/i);
	});

	it('preserves a pristine migration establishment receipt for the next migrated reuse', () => {
		const candidateSha = 'c'.repeat(40);
		const core = {
			...receiptCore(candidateSha),
			establishmentMode: 'pristine-migration',
			originRunId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			originLedgerSha256: 'a'.repeat(64),
			adoptedEvidence: null
		};
		const receipt = { ...core, payloadMac: authenticate('issue22:baseline-establishment:v1', core) };
		expect(() => assertCleanupReceiptForMigratedBaseline(receipt, candidateSha, receiptAuthenticationKey)).not.toThrow();
		expect(decideMigrationExecution({ mode: 'migrated' }, receipt, candidateSha, receiptAuthenticationKey)).toBe('reuse');
	});

	it('attests exact persistent migration-created buckets and zero objects', () => {
		expect(EXPECTED_STORAGE_BUCKETS).toHaveLength(4);
		expect(() => assertFinalStorageState(EXPECTED_STORAGE_BUCKETS, 0)).not.toThrow();
		expect(() => assertFinalStorageState([], 0)).toThrow(/bucket/i);
		expect(() => assertFinalStorageState(EXPECTED_STORAGE_BUCKETS, 1)).toThrow(/object/i);
		expect(() => assertFinalStorageState(
			EXPECTED_STORAGE_BUCKETS.map((bucket) => bucket.id === 'report-evidence' ? { ...bucket, file_size_limit: 15_728_640 } : bucket),
			0
		)).toThrow(/bucket/i);
	});

	it('idempotently repairs a missing/partial catalogue only on the exact migration chain', async () => {
		const expectedVersions = ['1', '2'];
		const seed = vi.fn(async () => ({ brands: 196, aliases: 48, memberships: 335 }));
		const attest = vi.fn(async () => ({ brands: 196, aliases: 48, memberships: 335 }));
		await expect(recoverCatalogForCleanup({
			actualVersions: expectedVersions,
			expectedVersions,
			currentCounts: { brands: 12, aliases: 0, memberships: 0 },
			seed,
			attest
		})).resolves.toEqual({ recovered: true });
		expect(seed).toHaveBeenCalledOnce();
		expect(attest).toHaveBeenCalledOnce();
		await expect(recoverCatalogForCleanup({
			actualVersions: ['1'],
			expectedVersions,
			currentCounts: { brands: 0, aliases: 0, memberships: 0 },
			seed,
			attest
		})).rejects.toThrow(/migration/i);
	});

	it('retains recovery when canonical catalogue reseeding fails', async () => {
		await expect(recoverCatalogForCleanup({
			actualVersions: ['1'],
			expectedVersions: ['1'],
			currentCounts: { brands: 0, aliases: 0, memberships: 0 },
			seed: async () => { throw new Error('injected seed fault'); },
			attest: async () => ({ brands: 196, aliases: 48, memberships: 335 })
		})).rejects.toThrow('injected seed fault');
	});

	it('retains recovery artifacts when catalogue recovery fails inside priority cleanup', async () => {
		const deleteRecovery = vi.fn(async () => undefined);
		const noOp = async () => undefined;
		const result = await runPriorityCleanup({
			disable: noOp,
			rollbackDeploy: noOp,
			capacity: noOp,
			rollbackSmoke: noOp,
			recoverCatalog: async () => { throw new Error('injected catalogue recovery fault'); },
			cleanupData: noOp,
			cleanupSecrets: noOp,
			cleanupWidget: noOp,
			attestFinal: noOp,
			deleteRecovery
		}, 1);
		expect(result.failures).toContain('recover-catalog');
		expect(deleteRecovery).not.toHaveBeenCalled();
	});

	it('restores the safety boundary and continues independent cleanup when live capacity fails', async () => {
		const events: string[] = [];
		const result = await runPriorityCleanup({
			disable: async () => { events.push('disable-auth'); },
			rollbackDeploy: async () => { events.push('rollback-deploy'); },
			capacity: async () => { events.push('capacity-failed'); throw new Error('injected capacity failure'); },
			rollbackSmoke: async () => { events.push('rollback-smoke'); },
			cleanupData: async () => { events.push('cleanup-data'); },
			cleanupSecrets: async () => { events.push('cleanup-secrets'); },
			cleanupWidget: async () => { events.push('cleanup-widget'); },
			attestFinal: async () => { events.push('final-attestation'); },
			deleteRecovery: async () => { events.push('delete-recovery'); }
		}, 1);
		expect(events).toEqual([
			'disable-auth',
			'rollback-deploy',
			'capacity-failed',
			'cleanup-data',
			'cleanup-secrets',
			'cleanup-widget',
			'final-attestation'
		]);
		expect(result.failures).toContain('live-capacity');
		expect(result.failures).toContain('rollback-smoke-unproven');
		expect(events).not.toContain('delete-recovery');
	});
	it('uses Wrangler secret list --format json and exact account-bound config', () => {
		const commands = fixedWorkerSecretCommands('tracked-config.jsonc');
		expect(commands.list).toEqual(['exec', 'wrangler', 'secret', 'list', '--name', TARGET.workerName, '--config', 'tracked-config.jsonc', '--format', 'json']);
		expect(commands.delete('TURNSTILE_SECRET_KEY')).toEqual(['exec', 'wrangler', 'secret', 'delete', 'TURNSTILE_SECRET_KEY', '--name', TARGET.workerName, '--config', 'tracked-config.jsonc']);
	});

	it('treats only an exact account-bound 404 Worker probe as an empty secret inventory', () => {
		expect(classifyExactWorkerProbe({ accountId: TARGET.cloudflareAccountId, workerName: TARGET.workerName, status: 404 })).toBe('absent');
		expect(classifyExactWorkerProbe({ accountId: TARGET.cloudflareAccountId, workerName: TARGET.workerName, status: 200 })).toBe('present');
		expect(() => classifyExactWorkerProbe({ accountId: 'wrong', workerName: TARGET.workerName, status: 404 })).toThrow(/identity/i);
		expect(() => classifyExactWorkerProbe({ accountId: TARGET.cloudflareAccountId, workerName: 'wrong', status: 404 })).toThrow(/identity/i);
		expect(() => classifyExactWorkerProbe({ accountId: TARGET.cloudflareAccountId, workerName: TARGET.workerName, status: 403 })).toThrow(/probe/i);
	});

	it('skips secret-list commands when the exact Worker is absent', async () => {
		const list = vi.fn(async () => []);
		const remove = vi.fn(async (_name: string) => undefined);
		await expect(cleanupExactWorkerSecrets({ probe: async () => 'absent', list, remove })).resolves.toEqual({ worker: 'absent' });
		expect(list).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();
	});

	it('deletes only the two reviewed secrets when the exact Worker exists', async () => {
		const list = vi.fn()
			.mockResolvedValueOnce([{ name: 'SUPABASE_SECRET_KEY' }, { name: 'TURNSTILE_SECRET_KEY' }])
			.mockResolvedValueOnce([]);
		const remove = vi.fn(async (_name: string) => undefined);
		await expect(cleanupExactWorkerSecrets({ probe: async () => 'present', list, remove })).resolves.toEqual({ worker: 'present' });
		expect(remove.mock.calls.map(([name]) => name)).toEqual(['SUPABASE_SECRET_KEY', 'TURNSTILE_SECRET_KEY']);
	});

	it('discovers a widget from its pre-intent and rejects ambiguity', () => {
		const intent = { name: 'aromatika-issue22-run-abc', domain: TARGET.workerHostname };
		const widget = { name: intent.name, domains: [intent.domain], sitekey: 'site-key' };
		expect(resolveWidgetForCleanup(intent, [widget])).toEqual(widget);
		expect(() => resolveWidgetForCleanup(intent, [widget, { ...widget }])).toThrow(/ambiguous/i);
	});

	it('never trusts a saved widget sitekey unless its fetched widget matches the saved intent', () => {
		const intent = { name: 'aromatika-issue22-run-abc', domain: TARGET.workerHostname };
		const matching = { name: intent.name, domains: [intent.domain], sitekey: 'saved-site-key' };
		expect(resolveSavedWidgetForCleanup(intent, 'saved-site-key', [matching])).toEqual(matching);
		expect(() => resolveSavedWidgetForCleanup(intent, 'saved-site-key', [{ ...matching, name: 'attacker-widget' }])).toThrow(/intent/i);
		expect(() => resolveSavedWidgetForCleanup(intent, 'saved-site-key', [{ ...matching, domains: ['attacker.invalid'] }])).toThrow(/intent/i);
	});

	it('rejects a generated Wrangler config for any wrong target identity', () => {
		const config = JSON.parse(readFileSync(resolve(operatorRoot, 'wrangler.issue22.jsonc'), 'utf8'));
		config.vars.PUBLIC_TURNSTILE_SITE_KEY = 'materialized-site-key';
		expect(() => assertExactWorkerConfig(config, { requireProjectBindings: true, requireMaterializedSitekey: true })).not.toThrow();
		expect(() => assertExactWorkerConfig({ ...config, account_id: 'wrong-account' }, { requireProjectBindings: true, requireMaterializedSitekey: true })).toThrow(/identity/i);
		expect(() => assertExactWorkerConfig({ ...config, name: 'wrong-worker' }, { requireProjectBindings: true, requireMaterializedSitekey: true })).toThrow(/identity/i);
	});

	it('prioritizes disable and rollback, retries faults, and retains recovery state on any failure', async () => {
		const events: string[] = [];
		const disable = vi.fn(async () => { events.push('disable'); });
		const rollbackDeploy = vi.fn()
			.mockImplementationOnce(async () => { events.push('rollback-fail'); throw new Error('fault'); })
			.mockImplementationOnce(async () => { events.push('rollback'); });
		const cleanupData = vi.fn(async () => { events.push('data'); throw new Error('fault'); });
		const deleteRecovery = vi.fn(async () => { events.push('delete-recovery'); });
		const result = await runPriorityCleanup({
			disable,
			rollbackDeploy,
			capacity: async () => undefined,
			rollbackSmoke: async () => undefined,
			cleanupData,
			cleanupSecrets: async () => events.push('secrets'),
			cleanupWidget: async () => events.push('widget'),
			attestFinal: async () => events.push('attest'),
			deleteRecovery
		}, 2);
		expect(events.slice(0, 3)).toEqual(['disable', 'rollback-fail', 'rollback']);
		expect(result.failures).toContain('cleanup-data');
		expect(deleteRecovery).not.toHaveBeenCalled();
	});

	it('deletes recovery state only after final zero-state succeeds and is retry-safe', async () => {
		const deleteRecovery = vi.fn(async () => undefined);
		const noOp = async () => undefined;
		await expect(runPriorityCleanup({
			disable: noOp,
			rollbackDeploy: noOp,
			capacity: noOp,
			rollbackSmoke: noOp,
			cleanupData: noOp,
			cleanupSecrets: noOp,
			cleanupWidget: noOp,
			attestFinal: noOp,
			deleteRecovery
		}, 2)).resolves.toEqual({ failures: [] });
		expect(deleteRecovery).toHaveBeenCalledOnce();
	});

	it('still attempts rollback when Auth disabling exhausts its retry budget', async () => {
		const rollbackDeploy = vi.fn(async () => undefined);
		const deleteRecovery = vi.fn(async () => undefined);
		const noOp = async () => undefined;
		const result = await runPriorityCleanup({
			disable: async () => { throw new Error('injected disable fault'); },
			rollbackDeploy,
			capacity: noOp,
			rollbackSmoke: noOp,
			cleanupData: noOp,
			cleanupSecrets: noOp,
			cleanupWidget: noOp,
			attestFinal: noOp,
			deleteRecovery
		}, 2);
		expect(result.failures).toContain('disable-auth');
		expect(rollbackDeploy).toHaveBeenCalledOnce();
		expect(deleteRecovery).not.toHaveBeenCalled();
	});

	it('seals recovery provenance before local deletion and leaves recovery last', async () => {
		const events: string[] = [];
		const removeRecovery = vi.fn(async () => { events.push('remove-recovery'); });
		await expect(finalizeRecoveryArtifacts({
			sealRecovery: async () => { events.push('seal'); },
			writeReceipt: async () => { events.push('receipt'); },
			deleteArtifacts: async () => { events.push('delete-artifacts'); throw new Error('injected'); },
			deleteRecovery: removeRecovery
		})).rejects.toThrow('injected');
		expect(events).toEqual(['seal', 'receipt', 'delete-artifacts']);
		expect(removeRecovery).not.toHaveBeenCalled();
	});
});

describe('issue-22 hosted Auth attestation', () => {
	it('requires confirmation, real Turnstile, email only, and anonymous disabled', () => {
		const auth = {
			disable_signup: false,
			external_email_enabled: true,
			external_phone_enabled: false,
			external_anonymous_users_enabled: false,
			mailer_autoconfirm: false,
			security_captcha_enabled: true,
			security_captcha_provider: 'turnstile',
			site_url: `https://${TARGET.workerHostname}`
		};
		const publicSettings = { disable_signup: false, mailer_autoconfirm: false, external: { email: true, phone: false, anonymous_users: false } };
		expect(() => assertAuthState(auth, publicSettings, { open: true, captcha: true })).not.toThrow();
		expect(() => assertAuthState({ ...auth, external_anonymous_users_enabled: true }, publicSettings, { open: true, captcha: true })).toThrow(/Auth/i);
		expect(() => assertAuthState(auth, { ...publicSettings, mailer_autoconfirm: true }, { open: true, captcha: true })).toThrow(/Auth/i);
	});

	it('binds the exact redirect, provider-shaped confirmation template, and SMTP identity', () => {
		const expected = JSON.parse(readFileSync(resolve(operatorRoot, 'auth-config.template.json'), 'utf8'));
		const live = { ...expected, security_captcha_secret: 'masked', smtp_pass: 'masked' };
		expect(() => assertAuthConfiguration(live, expected)).not.toThrow();
		expect(() => assertAuthConfiguration({ ...live, uri_allow_list: 'https://attacker.invalid' }, expected)).toThrow(/configuration/i);
		expect(() => assertAuthConfiguration({ ...live, mailer_templates_confirmation_content: 'type=signup' }, expected)).toThrow(/configuration/i);
	});

	it('uses nullable credential clearing after independently disabling signup', () => {
		const auth = {
			disable_signup: true,
			external_email_enabled: true,
			external_phone_enabled: false,
			external_anonymous_users_enabled: false,
			mailer_autoconfirm: false,
			security_captcha_enabled: false,
			security_captcha_provider: null,
			security_captcha_secret: null,
			site_url: `https://${TARGET.workerHostname}`,
			smtp_admin_email: null, smtp_host: null, smtp_port: null, smtp_user: null, smtp_pass: null, smtp_sender_name: null
		};
		const settings = { disable_signup: true, mailer_autoconfirm: false, external: { email: true, phone: false, anonymous_users: false } };
		expect(() => assertSafeDisabledAuth(auth, settings)).not.toThrow();
		expect(() => assertSafeDisabledAuth({ ...auth, smtp_host: 'smtp.example' }, settings)).toThrow(/baseline/i);
		expect(buildAuthCredentialClearPatch()).toEqual({
			security_captcha_enabled: false,
			security_captcha_provider: null,
			security_captcha_secret: null,
			smtp_admin_email: null,
			smtp_host: null,
			smtp_port: null,
			smtp_user: null,
			smtp_pass: null,
			smtp_sender_name: null
		});
	});

	it('attests the live UpdateAuthConfigBody nullable provider shape', () => {
		const names = Object.keys(buildAuthCredentialClearPatch());
		const properties: Record<string, { type: string; nullable: boolean; format?: string }> = Object.fromEntries(names.map((name) => [name, { type: name === 'security_captcha_enabled' ? 'boolean' : 'string', nullable: true }]));
		properties.smtp_admin_email.format = 'email';
		const schema = { components: { schemas: { UpdateAuthConfigBody: { properties } } } };
		expect(() => assertNullableAuthUpdateSchema(schema)).not.toThrow();
		expect(() => assertNullableAuthUpdateSchema({ components: { schemas: { UpdateAuthConfigBody: { properties: { ...properties, smtp_admin_email: { type: 'string', format: 'email', nullable: false } } } } } })).toThrow(/nullable/i);
	});

	it('disables signup before sending the separate nullable credential-clear PATCH', async () => {
		const events: Array<{ type: string; body?: Record<string, unknown> }> = [];
		const clearPatch = buildAuthCredentialClearPatch();
		const safeAuth = {
			disable_signup: true,
			external_email_enabled: true,
			external_phone_enabled: false,
			external_anonymous_users_enabled: false,
			mailer_autoconfirm: false,
			security_captcha_enabled: false,
			security_captcha_provider: null,
			security_captcha_secret: null,
			site_url: `https://${TARGET.workerHostname}`,
			smtp_admin_email: null, smtp_host: null, smtp_port: null, smtp_user: null, smtp_pass: null, smtp_sender_name: null
		};
		const settings = { disable_signup: true, mailer_autoconfirm: false, external: { email: true, phone: false, anonymous_users: false } };
		const properties: Record<string, { type: string; nullable: boolean; format?: string }> = Object.fromEntries(Object.keys(clearPatch).map((name) => [name, { nullable: true, type: name === 'security_captcha_enabled' ? 'boolean' : 'string' }]));
		properties.smtp_admin_email.format = 'email';
		await clearAuthSafely({
			patch: async (body) => { events.push({ type: 'patch', body }); return body.disable_signup === true ? { disable_signup: true } : safeAuth; },
			publicSettings: async () => { events.push({ type: 'public' }); return settings; },
			getSchema: async () => { events.push({ type: 'schema' }); return { components: { schemas: { UpdateAuthConfigBody: { properties } } } }; },
			getAuth: async () => { events.push({ type: 'auth' }); return safeAuth; }
		});
		expect(events).toEqual([
			{ type: 'patch', body: { disable_signup: true } },
			{ type: 'public' },
			{ type: 'schema' },
			{ type: 'patch', body: clearPatch },
			{ type: 'auth' },
			{ type: 'public' }
		]);
	});
});

describe('issue-22 live Cloudflare capacity', () => {
	it('covers every Worker request path and a bounded per-invocation CPU ceiling', () => {
			expect(OPERATOR_CAPACITY_BUDGET).toEqual({
			browserRequests: 449,
			initialRollbackSmokeRequests: 15,
			candidateSmokeRequests: 78,
			cleanupRollbackSmokeRequests: 45,
			totalRequests: 587,
			maxCpuMsPerInvocation: 10,
			maxSubrequestsPerInvocation: 50,
			freeHardTotalCpuMs: 5870,
			standardDefaultCpuMsPerInvocation: 30000,
			conservativeTotalCpuMs: 17610000,
			totalCpuMs: 17610000
		});
	});

	it('requires both Free UTC-day and Standard current-month headroom without treating usage model as plan', () => {
		const safe = {
			accountId: TARGET.cloudflareAccountId,
			usageModel: 'standard',
			daily: { currentRequests: 820 },
			monthly: { currentRequests: 820, currentCpuMs: 6407.871 },
			freeDailyRequestLimit: 100_000,
			standardMonthlyRequestLimit: 10_000_000,
			standardMonthlyCpuMsLimit: 30_000_000,
			freeCpuMsPerInvocation: 10,
			freeSubrequestsPerInvocation: 50
		};
		expect(assertLiveCloudflareCapacity(safe)).toMatchObject({
			executionPlan: 'workers_free',
			remainingDailyRequests: 99_180,
			remainingMonthlyRequests: 9_999_180,
			remainingMonthlyCpuMs: 29_993_592.129
		});
		expect(assertLiveCloudflareCapacity({ ...safe, usageModel: 'bundled' })).toMatchObject({ executionPlan: 'workers_free' });
		expect(() => assertLiveCloudflareCapacity({ ...safe, daily: { currentRequests: 99_500 } })).toThrow(/daily/i);
		expect(() => assertLiveCloudflareCapacity({ ...safe, monthly: { currentRequests: 9_999_500, currentCpuMs: 6407.871 } })).toThrow(/monthly/i);
		expect(() => assertLiveCloudflareCapacity({ ...safe, monthly: { currentRequests: 820, currentCpuMs: 29_995_000 } })).toThrow(/CPU/i);
		expect(() => assertLiveCloudflareCapacity({ ...safe, freeDailyRequestLimit: 1_000_000 })).toThrow(/limits/i);
		expect(() => assertLiveCloudflareCapacity({ ...safe, standardMonthlyCpuMsLimit: 300_000_000 })).toThrow(/limits/i);
	});
});

describe('issue-22 tracked operator attribution contracts', () => {
	it('binds the repository-native catalogue source and input hashes', () => {
		const manifest = JSON.parse(readFileSync(resolve(operatorRoot, 'operator-manifest.json'), 'utf8'));
		for (const relativePath of ['catalog/brand-categories.json', 'scripts/seed-catalog.mjs']) {
			const bytes = execFileSync('git', ['show', `HEAD:${relativePath}`], { cwd: repo });
			expect(manifest.seed_inputs[relativePath].bytes).toBe(bytes.length);
			expect(manifest.seed_inputs[relativePath].sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
		}
		expect(manifest.catalog_baseline).toEqual({ brands: 196, aliases: 48, memberships: 335 });
		expect(manifest.storage_baseline).toEqual(EXPECTED_STORAGE_BUCKETS);
			expect(manifest.known_failed_recovery).toEqual({
			predecessor_sha: KNOWN_FAILED_RECOVERY.predecessorSha,
			recovery_sha256: KNOWN_FAILED_RECOVERY.recoverySha256,
			generated_config_sha256: KNOWN_FAILED_RECOVERY.generatedConfigSha256,
				run_id: KNOWN_FAILED_RECOVERY.runId
		});
			expect(manifest.provider_limits).toMatchObject({
			workers_free_requests_per_utc_day: 100000,
			workers_free_cpu_ms_per_invocation: 10,
			workers_free_subrequests_per_invocation: 50,
			operator_total_requests: 587,
			operator_free_hard_total_cpu_ms: 5870,
			operator_conservative_standard_total_cpu_ms: 17610000
		});
	});

	it('binds migration receipts to canonical candidate blobs rather than checkout line endings', () => {
		const manifest = JSON.parse(readFileSync(resolve(operatorRoot, 'operator-manifest.json'), 'utf8'));
		for (const expected of manifest.migrations) {
			const relativePath = `supabase/migrations/${expected.file}`;
			const bytes = execFileSync('git', ['show', `HEAD:${relativePath}`], { cwd: repo });
			expect(expected.bytes).toBe(bytes.length);
			expect(expected.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
		}
	});

	it('binds exact-account provider usage to Free hard limits and Standard no-cost headroom', () => {
		const receipt = JSON.parse(readFileSync(resolve(operatorRoot, 'cloudflare-capacity-receipt.json'), 'utf8'));
		expect(receipt).toMatchObject({
			account_id: TARGET.cloudflareAccountId,
			account_settings: { default_usage_model: 'standard' },
			observed_provider_error: { code: 100328 },
			documented_free: { requests_per_utc_day: 100000, cpu_ms_per_invocation: 10, subrequests_per_invocation: 50 },
			documented_standard_included: { requests_per_month: 10000000, cpu_ms_per_month: 30000000 },
			operator_budget: { total_requests: 587, free_hard_total_cpu_ms: 5870, conservative_standard_total_cpu_ms: 17610000 }
		});
	});

	it('binds the complete migrated catalog surface instead of accepting platform or application drift', () => {
		const manifest = JSON.parse(readFileSync(resolve(operatorRoot, 'operator-manifest.json'), 'utf8'));
		expect(manifest.migrated_inventory).toMatchObject({
			private_schema_exists: true,
			unexpected_schemas: ['private']
		});
		expect(manifest.migrated_inventory.public_relations).toHaveLength(38);
		expect(manifest.migrated_inventory.public_functions).toHaveLength(129);
		expect(manifest.migrated_inventory.public_policies).toHaveLength(60);
		expect(manifest.migrated_inventory.user_triggers).toHaveLength(128);
		expect(manifest.migrated_inventory.realtime_publication_tables).toHaveLength(12);
		expect(manifest.migrated_inventory.definition_fingerprints).toEqual(expect.objectContaining({
			relationsSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
			catalogSha256: expect.stringMatching(/^[0-9a-f]{64}$/u)
		}));
		expect(manifest.migrated_inventory.application_table_counts).toHaveLength(35);
		expect(manifest.migrated_inventory.application_table_counts.every((item: { rows: number }) => item.rows === 0)).toBe(true);
		const fingerprintSql = readFileSync(resolve(operatorRoot, 'definition-fingerprints.sql'));
		expect(manifest.definition_fingerprint_input).toEqual({
			bytes: fingerprintSql.length,
			sha256: createHash('sha256').update(fingerprintSql).digest('hex')
		});
	});

	it('uses the confirmed browser SSR session and keeps Playwright artifacts private', () => {
		const hostedSpec = readFileSync(resolve(operatorRoot, 'hosted-registration.spec.ts'), 'utf8');
		const config = readFileSync(resolve(operatorRoot, 'playwright.hosted.config.ts'), 'utf8');
		expect(hostedSpec).toContain('createServerClient');
		expect(hostedSpec).toContain('createServerClient<Database>');
		expect(hostedSpec).not.toContain('signInWithPassword');
		expect(hostedSpec).toContain("const consentColumns = 'document_code,document_version,accepted_at'");
		expect(hostedSpec).toContain("error_code).toBe('captcha_failed')");
		expect(config).toContain("outputDir: './private/playwright-output'");
		expect(readFileSync(resolve(repo, '.gitignore'), 'utf8')).toContain('scripts/issue22-hosted/private/');
	});

	it('keeps executable operator bytes tracked and only recovery/runtime state ignored', () => {
		const wrapper = readFileSync(resolve(operatorRoot, 'run-operator.ps1'), 'utf8');
		const migration = readFileSync(resolve(operatorRoot, 'migration-runner.mjs'), 'utf8');
		const operator = readFileSync(resolve(operatorRoot, 'hosted-operator.mjs'), 'utf8');
		expect(wrapper).toContain("'hosted-cleanup'");
		expect(wrapper).toContain("'hosted-preflight'");
		expect(wrapper).toContain("$LASTEXITCODE=0 # discard the intentional unused-Worker probe exit");
		expect(wrapper).not.toContain("'migration-execute'");
		expect(migration.match(/runLinkedCommand\(/gu)).toHaveLength(3);
		expect(migration).toContain("['ls-tree', '-r', '--name-only', candidateSha, '--', 'supabase']");
		expect(migration).not.toContain('cpSync');
		expect(migration).toContain('seedAndAttestCatalog');
		expect(operator).toContain('clearAuthSafely({');
		expect(operator).toContain('classifyExactWorkerProbe');
		expect(operator.indexOf('disable: disableAuth')).toBeLessThan(operator.indexOf('rollbackDeploy:'));
		expect(operator).toContain('capacity: async () => assertLiveCapacityNow()');
		expect(operator).toContain('rollbackSmoke: async () => smokeRollback()');
		expect(operator.indexOf('const widgetIntent = beginRecovery()')).toBeLessThan(operator.indexOf('const widget = createWidget(widgetIntent)'));
		expect(operator.indexOf('await quiesceAuthBoundary()')).toBeLessThan(operator.indexOf('const widget = createWidget(widgetIntent)'));
		expect(operator.indexOf("join(root, 'migration-runner.mjs'), '--execute'")).toBeLessThan(operator.indexOf("'wrangler', 'deploy', '--config', generatedConfig"));
		const preflight = readFileSync(resolve(operatorRoot, 'preflight.ps1'), 'utf8');
		expect(preflight).toContain("'migration-runner.mjs') --self-test");
		expect(preflight).toContain("status = 'READY_FOR_REVIEW'");
		expect(preflight).toContain("$auth.external_anonymous_users_enabled -eq $false");
		expect(preflight).toContain("'cloudflare-live-capacity.mjs'");
		expect(preflight).not.toContain('usage_window.requests -eq 820');
		expect(preflight).not.toContain("'smoke.mjs') rollback");
		const cleanupStart = operator.indexOf('async function finalCleanup()');
		const cleanupCleanAttestation = operator.indexOf('assertCandidateClean();', cleanupStart);
		const cleanupEnvelopeAttestation = operator.indexOf('assertRecoveryEnvelope(', cleanupStart);
		const cleanupRecoveryAttestation = operator.indexOf('attribution = assertRecoveryAttribution(', cleanupStart);
		const cleanupMutation = operator.indexOf('runPriorityCleanup({', cleanupStart);
		expect(cleanupStart).toBeGreaterThanOrEqual(0);
		expect(cleanupCleanAttestation).toBeGreaterThan(cleanupStart);
		expect(cleanupCleanAttestation).toBeLessThan(cleanupMutation);
		expect(cleanupEnvelopeAttestation).toBeGreaterThan(cleanupCleanAttestation);
		expect(cleanupEnvelopeAttestation).toBeLessThan(cleanupRecoveryAttestation);
		expect(cleanupRecoveryAttestation).toBeGreaterThan(cleanupCleanAttestation);
		expect(cleanupRecoveryAttestation).toBeLessThan(cleanupMutation);
		const executeStart = operator.indexOf('async function execute(markCleanupRequired)');
		const beginRecovery = operator.indexOf('const widgetIntent = beginRecovery()', executeStart);
		expect(operator.indexOf('assertLiveCapacityNow();', executeStart)).toBeLessThan(beginRecovery);
		expect(operator.indexOf('markCleanupRequired();', executeStart)).toBeGreaterThan(beginRecovery);
		expect(operator).toContain('runHostedExecutionWithRequiredCleanup({');
		expect(operator).not.toContain('if (readRecovery()) await finalCleanup()');
		for (const configName of ['wrangler.issue22.jsonc', 'wrangler.issue22.rollback.jsonc']) {
			const config = JSON.parse(readFileSync(resolve(operatorRoot, configName), 'utf8'));
			expect(config).not.toHaveProperty('limits');
		}
		expect(migration).toContain("status: 'MIGRATED_BASELINE_REUSED'");
		expect(migration).toContain('decideMigrationExecution');
	});
});
