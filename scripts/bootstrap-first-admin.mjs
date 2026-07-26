import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/u;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class BootstrapConfigurationError extends Error {
	constructor(message) {
		super(message);
		this.name = 'BootstrapConfigurationError';
	}
}

export class BootstrapRecoveryRequiredError extends Error {
	constructor(inviteId, userId = null) {
		super('First administrator binding requires an explicit retry.');
		this.name = 'BootstrapRecoveryRequiredError';
		this.inviteId = inviteId;
		this.userId = userId;
	}
}

function requireValue(environment, key) {
	const value = environment[key]?.trim();
	if (!value) throw new BootstrapConfigurationError(`${key} is required`);
	return value;
}

function requireExact(environment, key, expected) {
	const value = requireValue(environment, key);
	if (value !== expected) {
		throw new BootstrapConfigurationError(`${key} must be ${expected}`);
	}
	return value;
}

function httpsOrigin(value, key) {
	try {
		const url = new URL(value);
		if (
			url.protocol !== 'https:' ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			(url.pathname !== '/' && url.pathname !== '')
		) {
			throw new Error();
		}
		return url.origin;
	} catch {
		throw new BootstrapConfigurationError(`${key} must be an HTTPS origin`);
	}
}

function emailAddress(value, key) {
	if (!EMAIL_PATTERN.test(value) || value.length > 320) {
		throw new BootstrapConfigurationError(`${key} must be a valid email address`);
	}
	return value.toLowerCase();
}

function uuidValue(environment, key) {
	const value = requireValue(environment, key);
	if (!UUID_PATTERN.test(value)) {
		throw new BootstrapConfigurationError(`${key} must be a UUID`);
	}
	return value.toLowerCase();
}

/**
 * Resolves configuration without returning provider keys in error messages.
 * The Resend values are an operator-side assertion that hosted Auth email
 * transport was configured before the bootstrap is allowed to run.
 */
export function resolveBootstrapConfiguration(environment, action) {
	if (action !== 'prepare' && action !== 'bind') {
		throw new BootstrapConfigurationError('Choose exactly one action: prepare or bind');
	}

	requireExact(environment, 'FIRST_ADMIN_BOOTSTRAP_ENABLED', 'true');
	requireExact(environment, 'PUBLIC_DEMO_MODE', 'false');
	requireExact(environment, 'PRIVATE_BETA_REQUIRE_INVITE', 'true');

	const appEnvironment = requireValue(environment, 'APP_ENV').toLowerCase();
	if (appEnvironment !== 'staging') {
		throw new BootstrapConfigurationError(
			'APP_ENV must be staging; this operator cannot bootstrap production'
		);
	}

	if (action === 'prepare') {
		requireExact(environment, 'FIRST_ADMIN_EMAIL_TRANSPORT_CONFIRMED', 'true');
		requireValue(environment, 'RESEND_FROM_EMAIL');
		requireValue(environment, 'RESEND_API_KEY');
	}

	const bootstrapEmail =
		action === 'prepare'
			? emailAddress(requireValue(environment, 'FIRST_ADMIN_EMAIL'), 'FIRST_ADMIN_EMAIL')
			: null;
	const inviteId =
		action === 'bind'
			? uuidValue(environment, 'FIRST_ADMIN_BOOTSTRAP_INVITE_ID')
			: null;
	const userId =
		action === 'bind'
			? uuidValue(environment, 'FIRST_ADMIN_BOOTSTRAP_USER_ID')
			: null;

	return Object.freeze({
		action,
		appEnvironment,
		bootstrapEmail,
		inviteId,
		userId,
		supabaseUrl: httpsOrigin(
			requireValue(environment, 'PUBLIC_SUPABASE_URL'),
			'PUBLIC_SUPABASE_URL'
		),
		serviceRoleKey: requireValue(environment, 'SUPABASE_SERVICE_ROLE_KEY'),
		appOrigin:
			action === 'prepare'
				? httpsOrigin(requireValue(environment, 'PUBLIC_APP_URL'), 'PUBLIC_APP_URL')
				: null
	});
}

function firstRow(value) {
	if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
	return value && typeof value === 'object' ? value : null;
}

async function bindPreparedInvite(client, inviteId, userId) {
	try {
		const { data, error } = await client.rpc('bind_first_admin_invite', {
			target_invite_id: inviteId,
			target_user_id: userId
		});
		const bound = firstRow(data);
		return (
			!error &&
			bound?.bootstrap_invite_id === inviteId &&
			bound?.bootstrap_profile_id === userId
		);
	} catch {
		return false;
	}
}

async function compensatePendingInvite(client, inviteId) {
	if (!inviteId) return false;
	const { error } = await client.rpc('revoke_beta_invite', {
		target_invite_id: inviteId
	});
	return !error;
}

/**
 * Executes only through a service-role client. It never receives a raw beta
 * token: migration 008 creates a non-redeemable random hash marker and bind is
 * performed by verified Auth user/email lookup.
 */
export async function runFirstAdminBootstrap(
	configuration,
	{ createClientImpl = createClient, logger = console } = {}
) {
	const client = createClientImpl(configuration.supabaseUrl, configuration.serviceRoleKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});

	if (configuration.action === 'bind') {
		if (
			!(await bindPreparedInvite(
				client,
				configuration.inviteId,
				configuration.userId
			))
		) {
			throw new Error(
				'First administrator binding failed closed. Inspect the private bootstrap audit state.'
			);
		}
		logger.info(
			'First administrator is bound. Email confirmation, legal onboarding, and MFA remain required.'
		);
		return;
	}

	const { data: preparedData, error: prepareError } = await client.rpc(
		'prepare_first_admin_invite',
		{
			bootstrap_email: configuration.bootstrapEmail,
			valid_for: '7 days'
		}
	);
	const prepared = firstRow(preparedData);
	if (
		prepareError ||
		!prepared ||
		!UUID_PATTERN.test(prepared.bootstrap_invite_id ?? '') ||
		typeof prepared.bootstrap_attempt_reused !== 'boolean'
	) {
		throw new Error(
			'First administrator preparation failed closed. Inspect the private bootstrap audit state.'
		);
	}

	const inviteId = prepared.bootstrap_invite_id;

	// A live marker can mean Auth already delivered the email before an earlier
	// process stopped. Never send a second invitation without an explicit,
	// operator-supplied Auth user id.
	if (prepared.bootstrap_attempt_reused) {
		throw new BootstrapRecoveryRequiredError(inviteId);
	}

	const callback = new URL('/auth/callback', configuration.appOrigin);
	callback.searchParams.set('next', '/onboarding');
	let deliveryData;
	try {
		({ data: deliveryData } = await client.auth.admin.inviteUserByEmail(
			configuration.bootstrapEmail,
			{
				redirectTo: callback.toString()
			}
		));
	} catch {
		// The provider outcome is unknown. Preserve the marker so an operator can
		// inspect Auth and perform a deterministic bind-only retry.
		throw new BootstrapRecoveryRequiredError(inviteId);
	}

	const deliveredUserId = deliveryData?.user?.id;
	if (!deliveredUserId) {
		const compensated = await compensatePendingInvite(client, inviteId);
		throw new Error(
			compensated
				? 'Authentication email delivery failed; the pending bootstrap invite was revoked.'
				: 'Authentication email delivery failed and compensation needs operator review.'
		);
	}

	if (
		!UUID_PATTERN.test(deliveredUserId) ||
		!(await bindPreparedInvite(client, inviteId, deliveredUserId))
	) {
		// Auth delivery succeeded, so revoking the database marker would destroy
		// the only deterministic correlation needed for recovery.
		throw new BootstrapRecoveryRequiredError(
			inviteId,
			UUID_PATTERN.test(deliveredUserId) ? deliveredUserId : null
		);
	}

	logger.info(
		'First administrator invitation was sent and bound. Email confirmation, legal onboarding, and MFA remain required.'
	);
}

async function main() {
	try {
		process.loadEnvFile?.('.env');
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
	}

	const action = process.argv[2] ?? '';
	const configuration = resolveBootstrapConfiguration(process.env, action);
	await runFirstAdminBootstrap(configuration);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === resolve(fileURLToPath(import.meta.url))) {
	main().catch((error) => {
		let safeMessage;
		if (error instanceof BootstrapConfigurationError) {
			safeMessage = error.message;
		} else if (error instanceof BootstrapRecoveryRequiredError) {
			const userReference = error.userId ? ` user_id=${error.userId}` : '';
			safeMessage =
				`First administrator recovery required: invite_id=${error.inviteId}${userReference}. ` +
				'Run the bind action with explicit invite and Auth user IDs.';
		} else {
			safeMessage =
				'First administrator bootstrap failed closed. Inspect the private audit state.';
		}
		console.error(safeMessage);
		process.exitCode = 1;
	});
}
