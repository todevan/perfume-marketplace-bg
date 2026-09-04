import { isAbsolute, relative, resolve, win32 } from 'node:path';

/** @typedef {'preflight_verified' | 'supabase_project_created' | 'mailtrap_smtp_active' | 'confirmation_template_updated' | 'migrations_applied' | 'worker_deployed' | 'proof_passed' | 'worker_deleted' | 'supabase_project_deleted' | 'mailtrap_sandbox_deleted' | 'cleanup_verified'} Issue22OperatorState */
/** @typedef {'create_supabase_project' | 'configure_mailtrap_smtp' | 'update_confirmation_template' | 'apply_migrations' | 'deploy_worker' | 'run_proof' | 'delete_worker' | 'delete_supabase_project' | 'delete_mailtrap_sandbox'} Issue22OperatorStep */
/** @typedef {'supabase' | 'cloudflare' | 'mailtrap' | 'proof-runner'} Issue22ProviderName */
/** @typedef {{ organization_id: string; project_id?: string; created_by_operator?: boolean; cleanup_authorized?: boolean; absent_verified?: boolean }} Issue22SupabaseProviderState */
/** @typedef {{ account_id?: number; inbox_id: number; api_base_url: string; created_by_operator?: boolean; cleanup_authorized?: boolean; provenance?: string; absent_verified?: boolean }} Issue22MailtrapProviderState */
/** @typedef {{ account_id: string; worker_name?: string; version_id?: string; created_by_operator?: boolean; cleanup_authorized?: boolean; absent_verified?: boolean }} Issue22CloudflareProviderState */
/** @typedef {{ schema_version: number, issue: number, transaction_id: string, state: Issue22OperatorState, candidate: { expected_sha: string, origin: string }, preflight: { status: 'passed'; free_capacity: true; checked_at?: string }, providers: { supabase: Issue22SupabaseProviderState, mailtrap: Issue22MailtrapProviderState, cloudflare: Issue22CloudflareProviderState }, pending_mutation: Issue22PendingMutation | null, history?: Array<{ step: string; completed_at: string }> }} Issue22OperatorManifest */
/** @typedef {{ step: Issue22OperatorStep, target: Issue22ProviderTarget, started_at: string }} Issue22PendingMutation */
/** @typedef {{ status: string; id?: string | number }} Issue22TargetStatus */
/** @typedef {{ supabase: Issue22SupabaseProviderState, cloudflare: Issue22CloudflareProviderState, mailtrap: Issue22MailtrapProviderState }} Issue22ProviderStateMap */
/**
 * @typedef {{
 *   provider: 'supabase' | 'cloudflare' | 'mailtrap' | 'proof-runner',
 *   projectId?: string,
 *   organizationId?: string,
 *   transactionId?: string,
 *   region?: string,
 *   accountId?: string,
 *   workerName?: string,
 *   candidateSha?: string,
 *   versionId?: string,
 *   mailtrapAccountId?: number,
 *   mailtrapInboxId?: number,
 *   id?: string | number
 * }} Issue22ProviderTarget
 */
/** @typedef {{ [key: string]: unknown, target: Issue22ProviderTarget, projectId?: string, versionId?: string }} Issue22ActionResult */
/** @typedef {(manifest: Issue22OperatorManifest) => Promise<void> | void} Issue22Persist */
/** @typedef {(target: Issue22ProviderTarget | Record<string, unknown>) => Promise<Issue22ActionResult> | Issue22ActionResult} Issue22Action */
/** @typedef {(target: Issue22ProviderTarget | Issue22CleanupTarget) => Promise<Issue22TargetStatus>} Issue22InspectExactTarget */
/** @typedef {{ provider: 'supabase' | 'cloudflare' | 'mailtrap'; id: string | number }} Issue22CleanupTarget */
const EXACT_MAILTRAP_INBOX_ID = 4_887_168;
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROJECT_REF_PATTERN = /^[a-z]{20}$/u;
const WORKER_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/u;

const STATE_ORDER = Object.freeze([
	'preflight_verified',
	'supabase_project_created',
	'mailtrap_smtp_active',
	'confirmation_template_updated',
	'migrations_applied',
	'worker_deployed',
	'proof_passed',
	'worker_deleted',
	'supabase_project_deleted',
	'mailtrap_sandbox_deleted',
	'cleanup_verified'
]);

/** @typedef {{from: Issue22OperatorState; to: Issue22OperatorState; requiresAbsence?: boolean; cleanup?: boolean}} Issue22StepTransition */

/** @type {Record<Issue22OperatorStep, Issue22StepTransition>} */
const STEP_TRANSITIONS = Object.freeze({
	create_supabase_project: { from: 'preflight_verified', to: 'supabase_project_created' },
	configure_mailtrap_smtp: { from: 'supabase_project_created', to: 'mailtrap_smtp_active' },
	update_confirmation_template: { from: 'mailtrap_smtp_active', to: 'confirmation_template_updated' },
	apply_migrations: { from: 'confirmation_template_updated', to: 'migrations_applied' },
	deploy_worker: { from: 'migrations_applied', to: 'worker_deployed', requiresAbsence: true },
	run_proof: { from: 'worker_deployed', to: 'proof_passed' },
	delete_worker: { from: 'proof_passed', to: 'worker_deleted', cleanup: true },
	delete_supabase_project: { from: 'worker_deleted', to: 'supabase_project_deleted', cleanup: true },
	delete_mailtrap_sandbox: { from: 'supabase_project_deleted', to: 'mailtrap_sandbox_deleted', cleanup: true }
});

export class Issue22OperatorError extends Error {
	/**
	 * @param {string} message
	 */
	constructor(message) {
		super(message);
		this.name = 'Issue22OperatorError';
	}
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function validHttpsOrigin(value) {
	try {
		const url = new URL(value);
		return (
			url.protocol === 'https:' &&
			!url.username &&
			!url.password &&
			url.pathname === '/' &&
			!url.search &&
			!url.hash
		);
	} catch {
		return false;
	}
}

/** @returns {never} */
function manifestInvalid() {
	throw new Issue22OperatorError('Issue #22 provider manifest is invalid.');
}

/**
 * @param {Issue22OperatorManifest} manifest
 * @returns {manifest is Issue22OperatorManifest}
 */
function baseManifestIsValid(manifest) {
	const mailtrapApiBase = manifest?.providers?.mailtrap?.api_base_url;
	return (
		manifest &&
		typeof manifest === 'object' &&
		manifest.schema_version === 1 &&
		manifest.issue === 22 &&
		UUID_PATTERN.test(manifest.transaction_id ?? '') &&
		STATE_ORDER.includes(manifest.state) &&
		SHA_PATTERN.test(manifest.candidate?.expected_sha ?? '') &&
		validHttpsOrigin(manifest.candidate?.origin) &&
		manifest.preflight?.status === 'passed' &&
		manifest.preflight?.free_capacity === true &&
		typeof manifest.providers?.supabase?.organization_id === 'string' &&
		manifest.providers.supabase.organization_id.trim().length > 0 &&
		manifest.providers?.mailtrap?.inbox_id === EXACT_MAILTRAP_INBOX_ID &&
		typeof mailtrapApiBase === 'string' &&
		validHttpsOrigin(mailtrapApiBase) &&
		ACCOUNT_ID_PATTERN.test(manifest.providers?.cloudflare?.account_id ?? '')
	);
}

/** Validate the no-secret private manifest at the boundary required by a caller. */
/**
 * @param {Issue22OperatorManifest} manifest
 * @param {{ phase?: 'base' | 'poll' | 'proof' }} [options]
 * @returns {Issue22OperatorManifest}
 */
export function validateManifest(manifest, { phase = 'base' } = {}) {
	if (!baseManifestIsValid(manifest)) manifestInvalid();

	if (phase === 'poll' || phase === 'proof') {
		if (
			!Number.isSafeInteger(manifest.providers.mailtrap.account_id) ||
			(manifest.providers.mailtrap.account_id ?? 0) <= 0
		) {
			manifestInvalid();
		}
	}

	if (phase === 'proof') {
		if (
			!PROJECT_REF_PATTERN.test(manifest.providers.supabase.project_id ?? '') ||
			!WORKER_NAME_PATTERN.test(manifest.providers.cloudflare.worker_name ?? '') ||
			!UUID_PATTERN.test(manifest.providers.cloudflare.version_id ?? '')
		) {
			manifestInvalid();
		}
	}

	return manifest;
}

/** The manifest is private orchestration state and must never be stored in the checkout. */
/**
 * @param {string} manifestPath
 * @param {string} repositoryRoot
 * @returns {string}
 */
export function assertPrivateManifestPath(manifestPath, repositoryRoot) {
	const manifestIsWindowsPath = /^[a-zA-Z]:[\\/]/u.test(manifestPath);
	const repositoryIsWindowsPath = /^[a-zA-Z]:[\\/]/u.test(repositoryRoot);
	const target = manifestIsWindowsPath ? win32.normalize(manifestPath.replaceAll('/', '\\')) : resolve(manifestPath);
	const root = repositoryIsWindowsPath ? win32.resolve(repositoryRoot) : resolve(repositoryRoot);

	if (!manifestIsWindowsPath || !repositoryIsWindowsPath) {
		const fromRoot = relative(root, target);
		if (fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))) {
			throw new Issue22OperatorError('Issue #22 provider manifest must remain outside the repository.');
		}
		return target;
	}

	const fromRoot = win32.relative(root, target);
	if (fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))) {
		throw new Issue22OperatorError('Issue #22 provider manifest must remain outside the repository.');
	}
	return target;
}

/**
 * @param {Issue22OperatorManifest} manifest
 * @param {Issue22OperatorStep} step
 * @returns {Issue22ProviderTarget}
 */
function exactStepTarget(manifest, step) {
	const { supabase, mailtrap, cloudflare } = manifest.providers;
	switch (step) {
		case 'create_supabase_project':
			if (manifest.providers.supabase.organization_id.trim().length === 0) manifestInvalid();
			return {
				provider: 'supabase',
				organizationId: supabase.organization_id,
				transactionId: manifest.transaction_id,
				region: 'eu-central-1'
			};
		case 'configure_mailtrap_smtp': {
			const projectId = supabase.project_id;
			const accountId = mailtrap.account_id;
			if (!projectId || typeof accountId !== 'number' || !Number.isSafeInteger(accountId) || accountId <= 0) {
				manifestInvalid();
			}
			return {
				provider: 'supabase',
				projectId,
				mailtrapAccountId: accountId,
				mailtrapInboxId: mailtrap.inbox_id
			};
		}
		case 'update_confirmation_template':
		case 'apply_migrations':
			if (!supabase.project_id) manifestInvalid();
			return { provider: 'supabase', projectId: supabase.project_id };
		case 'deploy_worker':
			if (!cloudflare.account_id || !cloudflare.worker_name) manifestInvalid();
			return {
				provider: 'cloudflare',
				accountId: cloudflare.account_id,
				workerName: cloudflare.worker_name,
				candidateSha: manifest.candidate.expected_sha
			};
		case 'run_proof':
			if (!cloudflare.account_id || !cloudflare.worker_name || !cloudflare.version_id || !supabase.project_id) manifestInvalid();
			return {
				provider: 'proof-runner',
				transactionId: manifest.transaction_id,
				projectId: supabase.project_id,
				workerName: cloudflare.worker_name,
				versionId: cloudflare.version_id,
				mailtrapAccountId: mailtrap.account_id,
				mailtrapInboxId: mailtrap.inbox_id,
				candidateSha: manifest.candidate.expected_sha
			};
		case 'delete_worker': {
			const workerName = cloudflare.worker_name;
			if (!workerName) manifestInvalid();
			return assertCleanupTarget(manifest, { provider: 'cloudflare', id: workerName });
		}
		case 'delete_supabase_project': {
			const projectId = supabase.project_id;
			if (!projectId) manifestInvalid();
			return assertCleanupTarget(manifest, { provider: 'supabase', id: projectId });
		}
		case 'delete_mailtrap_sandbox':
			return assertCleanupTarget(manifest, { provider: 'mailtrap', id: mailtrap.inbox_id });
		default:
			throw new Issue22OperatorError('Issue #22 provider sequence is invalid.');
	}
}

/**
 * @param {Issue22OperatorManifest} manifest
 * @param {Issue22OperatorStep} step
 * @param {Issue22ProviderTarget} target
 * @returns {Issue22ProviderTarget}
 */
function inspectionTarget(manifest, step, target) {
	if (step === 'deploy_worker') {
		return {
			provider: 'cloudflare',
			accountId: target.accountId,
			workerName: target.workerName
		};
	}
	return target;
}

/**
 * @param {Issue22ProviderTarget} actual
 * @param {Issue22ProviderTarget} expected
 * @returns {boolean}
 */
function sameTarget(actual, expected) {
	return JSON.stringify(actual) === JSON.stringify(expected);
}

/**
 * @param {Issue22OperatorState} currentState
 * @param {Issue22OperatorState} completedState
 * @returns {boolean}
 */
function completedStateAtOrAfter(currentState, completedState) {
	return STATE_ORDER.indexOf(currentState) >= STATE_ORDER.indexOf(completedState);
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function clone(value) {
	return structuredClone(value);
}

/**
 * @param {Issue22TargetStatus | null | undefined} status
 * @param {string | number} targetId
 * @returns {Issue22TargetStatus}
 */
function normalizeTargetStatus(status, targetId) {
	if (!status || (status.status !== 'absent' && status.status !== 'present' && status.status !== 'unknown')) {
		return { status: 'unknown', id: targetId };
	}
	return status;
}

/**
 * @param {Issue22OperatorManifest} next
 * @param {Issue22OperatorStep} step
 * @param {Issue22ActionResult} result
 */
function applyResult(next, step, result) {
	if (step === 'create_supabase_project') {
		if (!PROJECT_REF_PATTERN.test(result.projectId ?? '')) {
			throw new Issue22OperatorError('Issue #22 provider result does not match the manifest.');
		}
		next.providers.supabase.project_id = result.projectId;
		next.providers.supabase.created_by_operator = true;
		next.providers.supabase.cleanup_authorized = true;
	}
	if (step === 'deploy_worker') {
		if (!UUID_PATTERN.test(result.versionId ?? '')) {
			throw new Issue22OperatorError('Issue #22 provider result does not match the manifest.');
		}
		next.providers.cloudflare.version_id = result.versionId;
		next.providers.cloudflare.created_by_operator = true;
		next.providers.cloudflare.cleanup_authorized = true;
	}
	if (step === 'delete_worker') next.providers.cloudflare.absent_verified = false;
	if (step === 'delete_supabase_project') next.providers.supabase.absent_verified = false;
	if (step === 'delete_mailtrap_sandbox') next.providers.mailtrap.absent_verified = false;
}

/**
 * Execute exactly one manifest transition. The pending record is durable before
 * the external action. Unknown outcomes remain pending for explicit recovery.
 *
 * @param {{
 *   manifest: Issue22OperatorManifest,
 *   step: Issue22OperatorStep,
 *   persist: Issue22Persist,
 *   action: Issue22Action,
 *   inspectExactTarget?: Issue22InspectExactTarget,
 *   now?: () => number
 * }} options
 * @returns {Promise<Issue22OperatorManifest>}
 */
export async function executeOperatorStep({
	manifest,
	step,
	persist,
	action,
	inspectExactTarget,
	now = () => Date.now()
}) {
	validateManifest(manifest);
	/** @type {Issue22Persist} */
	const persistManifest = persist;
	/** @type {Issue22Action} */
	const performAction = action;
	const checkExactTarget = inspectExactTarget;
	const transition = STEP_TRANSITIONS[step];
	if (!transition) throw new Issue22OperatorError('Issue #22 provider sequence is invalid.');
	if (manifest.pending_mutation) {
		throw new Issue22OperatorError('Issue #22 provider mutation requires recovery.');
	}
	if (completedStateAtOrAfter(manifest.state, transition.to)) return manifest;
	if (manifest.state !== transition.from) {
		throw new Issue22OperatorError('Issue #22 provider sequence is invalid.');
	}

	if (step !== 'create_supabase_project') {
		validateManifest(manifest, { phase: step === 'run_proof' ? 'proof' : step === 'configure_mailtrap_smtp' ? 'poll' : 'base' });
	}
	const target = exactStepTarget(manifest, step);
	if (transition.requiresAbsence) {
		if (typeof checkExactTarget !== 'function') {
			throw new Issue22OperatorError('Issue #22 exact-target inspection is required.');
		}
		const inspected = await checkExactTarget(inspectionTarget(manifest, step, target));
		if (inspected?.status !== 'absent') {
			throw new Issue22OperatorError('Issue #22 target already exists or is foreign.');
		}
	}

	const pending = clone(manifest);
	pending.pending_mutation = {
		step,
		target: clone(target),
		started_at: new Date(now()).toISOString()
	};
	await persistManifest(pending);

	let result;
	try {
		result = await performAction(clone(target));
	} catch {
		throw new Issue22OperatorError('Issue #22 provider mutation failed safely.');
	}
	if (!result || !sameTarget(result.target, target)) {
		throw new Issue22OperatorError('Issue #22 provider result does not match the manifest.');
	}

	const completed = clone(pending);
	applyResult(completed, step, result);
	completed.state = transition.to;
	completed.pending_mutation = null;
	completed.history = Array.isArray(completed.history) ? completed.history : [];
	completed.history.push({ step, completed_at: new Date(now()).toISOString() });
	await persistManifest(/** @type {Issue22OperatorManifest} */ (completed));
	return completed;
}

/** Only operator-created, explicitly cleanup-authorized exact IDs may be deleted. */
/**
 * @param {Issue22OperatorManifest} manifest
 * @param {Issue22CleanupTarget} target
 * @returns {Issue22CleanupTarget}
 */
export function assertCleanupTarget(manifest, target) {
	validateManifest(manifest);
	if (target.provider === 'mailtrap') {
		const resource = manifest.providers.mailtrap;
		if (
			target.id !== EXACT_MAILTRAP_INBOX_ID ||
			resource.inbox_id !== EXACT_MAILTRAP_INBOX_ID ||
			resource.cleanup_authorized !== true ||
			resource.provenance !== 'owner_provisioned_for_issue22'
		) {
			throw new Issue22OperatorError('Issue #22 cleanup target is not authorized.');
		}
		return { provider: 'mailtrap', id: EXACT_MAILTRAP_INBOX_ID };
	}

	let resource;
	let expectedId;
	if (target.provider === 'supabase') {
		resource = manifest.providers.supabase;
		expectedId = resource.project_id;
	}
	if (target.provider === 'cloudflare') {
		resource = manifest.providers.cloudflare;
		expectedId = resource.worker_name;
	}
	if (
		!resource ||
		resource.created_by_operator !== true ||
		resource.cleanup_authorized !== true ||
		!expectedId ||
		target.id !== expectedId
	) {
		throw new Issue22OperatorError('Issue #22 cleanup target is not authorized.');
	}
	return { provider: target.provider, id: target.id };
}

/** @param {Issue22ProviderTarget} target @returns {Issue22CleanupTarget} */
function cleanupTargetFromProviderTarget(target) {
	if (
		(target.provider !== 'supabase' && target.provider !== 'cloudflare' && target.provider !== 'mailtrap') ||
		(typeof target.id !== 'string' && typeof target.id !== 'number')
	) {
		throw new Issue22OperatorError('Issue #22 cleanup recovery is not available.');
	}
	return { provider: target.provider, id: target.id };
}

/**
 * Recovery never retries a delete. It performs one exact-ID read and records
 * absence only when the provider proves that exact target is gone.
 */
/**
 * @param {{
 *   manifest: Issue22OperatorManifest,
 *   persist: Issue22Persist,
 *   inspectExactTarget: (target: Issue22CleanupTarget) => Promise<Issue22TargetStatus>,
 *   now?: () => number
 * }} options
 * @returns {Promise<Issue22OperatorManifest>}
 */
export async function recoverPendingCleanup({ manifest, persist, inspectExactTarget, now = () => Date.now() }) {
	validateManifest(manifest);
	const pending = manifest.pending_mutation;
	if (!pending || !['delete_worker', 'delete_supabase_project', 'delete_mailtrap_sandbox'].includes(pending.step)) {
		throw new Issue22OperatorError('Issue #22 cleanup recovery is not available.');
	}
	const checkExactTarget = inspectExactTarget;
	const pendingTarget = cleanupTargetFromProviderTarget(pending.target);
	const cleanupTarget = assertCleanupTarget(manifest, pendingTarget);
	const inspected = normalizeTargetStatus(await checkExactTarget(cleanupTarget), pendingTarget.id);
	if (inspected.id !== pendingTarget.id) {
		throw new Issue22OperatorError('Issue #22 cleanup evidence is foreign.');
	}
	if (inspected.status !== 'absent') return manifest;

	const recovered = clone(manifest);
	const providerKey = pending.target.provider === 'cloudflare' ? 'cloudflare' : pending.target.provider === 'mailtrap' ? 'mailtrap' : 'supabase';
	/** @type {Issue22ProviderStateMap} */
	const providers = recovered.providers;
	providers[providerKey].absent_verified = true;
	recovered.state = STEP_TRANSITIONS[pending.step].to;
	recovered.pending_mutation = null;
	recovered.history = Array.isArray(recovered.history) ? recovered.history : [];
	recovered.history.push({ step: `${pending.step}_absence_verified`, completed_at: new Date(now()).toISOString() });
	await persist(/** @type {Issue22OperatorManifest} */ (recovered));
	return recovered;
}

/** Separately runnable, read-only final absence verification. */
/**
 * @param {{
 *   manifest: Issue22OperatorManifest,
 *   inspectExactTarget: (target: Issue22CleanupTarget) => Promise<Issue22TargetStatus>
 * }} options
 * @returns {Promise<{ status: 'absent'; checked: number }>}
 */
export async function verifyCleanupAbsence({ manifest, inspectExactTarget }) {
	validateManifest(manifest);
	const checkExactTarget = inspectExactTarget;
	const workerName = manifest.providers.cloudflare.worker_name;
	const projectId = manifest.providers.supabase.project_id;
	if (!workerName || !projectId) manifestInvalid();
	const targets = [
		assertCleanupTarget(manifest, { provider: 'cloudflare', id: workerName }),
		assertCleanupTarget(manifest, { provider: 'supabase', id: projectId })
	];
	if (
		manifest.providers.mailtrap.cleanup_authorized === true &&
		manifest.providers.mailtrap.provenance === 'owner_provisioned_for_issue22'
	) {
		targets.push(
			assertCleanupTarget(manifest, { provider: 'mailtrap', id: manifest.providers.mailtrap.inbox_id })
		);
	}
	for (const target of targets) {
		const result = normalizeTargetStatus(await checkExactTarget(clone(target)), target.id);
		if (result?.status !== 'absent' || result?.id !== target.id) {
			throw new Issue22OperatorError('Issue #22 cleanup absence is not verified.');
		}
	}
	return { status: 'absent', checked: targets.length };
}
