import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
	createSupabaseHostedA9Adapters,
	createHostedRunManifest,
	executeHostedA9Provisioning,
	persistHostedRunManifest,
	reserveHostedRunManifest,
	resolveHostedManifestPath,
	validateHostedA9Environment
} from './hosted-report-evidence-operator.mjs';
import {
	createEncryptedModeratorCredentialStore,
	hostedCredentialStoreId,
	validateHostedCredentialStoreEnvironment
} from './hosted-a9-credential-store.mjs';

/** @typedef {Record<string, string | undefined>} OperatorEnvironment */
/** @typedef {{
 *   createClientImpl?: (url: string, key: string, options: Record<string, unknown>) => any,
 *   createCredentialStoreImpl?: (options: Record<string, string>) => any,
 *   createAdaptersImpl?: (options: { createActorClient: () => any, [key: string]: any }) => any,
 *   executeProvisioningImpl?: (options: Record<string, any>) => Promise<any>,
 *   persistManifestImpl?: (config: any, manifest: any, filePath: string) => Promise<void> | void,
 *   reserveManifestImpl?: (config: any, manifest: any, filePath: string) => Promise<void> | void
 * }} HostedA9RunnerDependencies */

const NON_PERSISTENT_AUTH = Object.freeze({
	autoRefreshToken: false,
	detectSessionInUrl: false,
	persistSession: false
});

/** @param {OperatorEnvironment} environment @param {string} name */
function requiredRunnerValue(environment, name) {
	const value = environment[name];
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error('Hosted A9 runner configuration is incomplete.');
	}
	return value.trim();
}

/** @param {OperatorEnvironment} [environment] */
export function validateHostedA9RunnerEnvironment(environment = process.env) {
	const config = validateHostedA9Environment(environment);
	const publishableKey = requiredRunnerValue(environment, 'PUBLIC_SUPABASE_PUBLISHABLE_KEY');
	requiredRunnerValue(environment, 'SUPABASE_ACCESS_TOKEN');
	requiredRunnerValue(environment, 'SUPABASE_SERVICE_ROLE_KEY');
	const manifestPath = resolveHostedManifestPath(
		requiredRunnerValue(environment, 'E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH')
	);
	const credentialStore = validateHostedCredentialStoreEnvironment(environment);
	if (dirname(manifestPath) !== dirname(credentialStore.filePath)) {
		throw new Error('Hosted A9 private files must share one hardened run directory.');
	}
	return Object.freeze({ config, publishableKey, manifestPath, credentialStore });
}

/** @param {Record<string, any>} receipt */
function sanitizeHostedA9Receipt(receipt) {
	return Object.freeze({
		status: receipt.status,
		runId: receipt.runId,
		target: Object.freeze({
			projectRef: receipt.target?.projectRef,
			region: receipt.target?.region,
			postgresMajor: receipt.target?.postgresMajor,
			status: receipt.target?.status
		}),
		actors: Object.freeze(
			Array.isArray(receipt.actors)
				? receipt.actors.map((actor) =>
						Object.freeze({
							role: actor.role,
							profileRole: actor.profileRole,
							membershipStatus: actor.membershipStatus,
							onboardingComplete: actor.onboardingComplete,
							mfaStatus: actor.mfaStatus,
							initialAal: actor.initialAal,
							finalAal: actor.finalAal
						})
				  )
				: []
		),
		artifacts: Object.freeze({
			reports: receipt.artifacts?.reports,
			uploads: receipt.artifacts?.uploads,
			objects: receipt.artifacts?.objects,
			queueRows: receipt.artifacts?.queueRows
		})
	});
}

/**
 * Compose and execute the already-reviewed A9 transaction. Client construction
 * is inert; the transaction re-verifies the target before its first mutation.
 *
 * @param {{
 *   environment?: OperatorEnvironment,
 *   dependencies?: HostedA9RunnerDependencies
 * }} [options]
 */
export async function runHostedA9Provisioning({
	environment = process.env,
	dependencies = {}
} = {}) {
	const contract = validateHostedA9RunnerEnvironment(environment);
	const createClientImpl = dependencies.createClientImpl ?? createClient;
	const createCredentialStoreImpl =
		dependencies.createCredentialStoreImpl ?? createEncryptedModeratorCredentialStore;
	const createAdaptersImpl = dependencies.createAdaptersImpl ?? createSupabaseHostedA9Adapters;
	const executeProvisioningImpl =
		dependencies.executeProvisioningImpl ?? executeHostedA9Provisioning;
	const persistManifestImpl = dependencies.persistManifestImpl ?? persistHostedRunManifest;
	const reserveManifestImpl = dependencies.reserveManifestImpl ?? reserveHostedRunManifest;

	const credentialSink = createCredentialStoreImpl({
		filePath: contract.credentialStore.filePath,
		encryptionKey: contract.credentialStore.encryptionKey,
		projectRef: contract.config.target.projectRef,
		runId: contract.config.runId
	});
	if (
		typeof credentialSink?.initializeModeratorTotpSecrets !== 'function' ||
		typeof credentialSink?.discardAfterVerifiedRollback !== 'function'
	) {
		throw new Error('Hosted A9 credential store cannot be reserved.');
	}
	let credentialReserved = false;
	let manifestReserved = false;
	const initialManifest = createHostedRunManifest(contract.config, {
		provisioningAttemptId: randomUUID(),
		credentialStoreId: hostedCredentialStoreId(contract.credentialStore.filePath)
	});
	try {
		await credentialSink.initializeModeratorTotpSecrets();
		credentialReserved = true;
		await reserveManifestImpl(
			contract.config,
			initialManifest,
			contract.manifestPath
		);
		manifestReserved = true;

		const serviceClient = createClientImpl(
			contract.config.target.supabaseUrl,
			contract.config.serviceKey,
			{ auth: { ...NON_PERSISTENT_AUTH } }
		);
		const createActorClient = () =>
			createClientImpl(contract.config.target.supabaseUrl, contract.publishableKey, {
				auth: { ...NON_PERSISTENT_AUTH }
			});
		const adapters = createAdaptersImpl({
			config: contract.config,
			serviceClient,
			createActorClient,
			credentialSink
		});
		const receipt = await executeProvisioningImpl({
			environment,
			adapters,
			initialManifest,
			persistManifest: (manifest) =>
				persistManifestImpl(contract.config, manifest, contract.manifestPath)
		});
		return sanitizeHostedA9Receipt(/** @type {Record<string, any>} */ (receipt));
	} catch (error) {
		const rollbackUnconfirmed =
			error instanceof Error && error.message === 'A9 provisioning rollback was not confirmed';
		if (!rollbackUnconfirmed) {
			let credentialCleanupConfirmed = true;
			if (
				credentialReserved &&
				typeof credentialSink?.discardAfterVerifiedRollback === 'function'
			) {
				try {
					await credentialSink.discardAfterVerifiedRollback();
				} catch {
					credentialCleanupConfirmed = false;
				}
			}
			if (manifestReserved && credentialCleanupConfirmed) {
				try {
					await unlink(contract.manifestPath);
				} catch {
					// Preserve the original sanitized failure; occupied files keep retries fail-closed.
				}
			}
		}
		throw error;
	}
}

/**
 * @param {{
 *   environment?: OperatorEnvironment,
 *   dependencies?: HostedA9RunnerDependencies,
 *   output?: (line: string) => void,
 *   errorOutput?: (line: string) => void
 * }} [options]
 */
export async function runHostedA9Cli({
	environment = process.env,
	dependencies = {},
	output = console.log,
	errorOutput = console.error
} = {}) {
	try {
		const receipt = await runHostedA9Provisioning({ environment, dependencies });
		output(JSON.stringify(receipt));
		return 0;
	} catch {
		errorOutput('Hosted A9 runner failed safely.');
		return 1;
	}
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
	process.exitCode = await runHostedA9Cli();
}
