import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	BootstrapConfigurationError,
	BootstrapRecoveryRequiredError,
	resolveBootstrapConfiguration,
	runFirstAdminBootstrap
} from '../../scripts/bootstrap-first-admin.mjs';

const migration = readFileSync(
	new URL('../migrations/202607220008_first_admin_bootstrap.sql', import.meta.url),
	'utf8'
)
	.toLowerCase()
	.replace(/\s+/gu, ' ');
const operatorScript = readFileSync(
	new URL('../../scripts/bootstrap-first-admin.mjs', import.meta.url),
	'utf8'
);

const INVITE_ID = '3a16c442-e04a-45bb-a5fa-466bb3acbf81';
const USER_ID = 'a18eb582-8485-41f4-81d7-ea29a90b2553';

const validEnvironment = {
	FIRST_ADMIN_BOOTSTRAP_ENABLED: 'true',
	FIRST_ADMIN_EMAIL_TRANSPORT_CONFIRMED: 'true',
	PUBLIC_DEMO_MODE: 'false',
	PRIVATE_BETA_REQUIRE_INVITE: 'true',
	APP_ENV: 'staging',
	FIRST_ADMIN_EMAIL: 'first-admin@example.com',
	PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
	SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
	PUBLIC_APP_URL: 'https://staging.example.com',
	RESEND_API_KEY: 'resend-secret',
	RESEND_FROM_EMAIL: 'beta@example.com'
};

const bindEnvironment = {
	...validEnvironment,
	FIRST_ADMIN_EMAIL: '',
	FIRST_ADMIN_BOOTSTRAP_INVITE_ID: INVITE_ID,
	FIRST_ADMIN_BOOTSTRAP_USER_ID: USER_ID
};

test('migration installs one immutable and concurrency-safe bootstrap root', () => {
	for (const fragment of [
		'create table private.first_admin_bootstrap',
		'singleton boolean primary key default true check (singleton)',
		'create table private.first_admin_bootstrap_attempts',
		'bound_profile_id uuid unique references public.profiles(id) on delete restrict',
		'first_admin_bootstrap_attempts_append_only',
		'first administrator bootstrap provenance is immutable',
		'pg_advisory_xact_lock',
		'for update'
	]) {
		assert.ok(migration.includes(fragment), `Missing bootstrap invariant: ${fragment}`);
	}
	assert.ok(migration.includes('if valid_for is null'));
});

test('only the exact prepare and bind RPC signatures are service-role callable', () => {
	for (const signature of [
		'public.prepare_first_admin_invite(text, interval)',
		'public.bind_first_admin_invite(uuid, uuid)'
	]) {
		assert.ok(
			migration.includes(`grant execute on function ${signature} to service_role`),
			`Missing service-role grant for ${signature}`
		);
		assert.ok(
			migration.includes(
				`revoke execute on function ${signature} from public, anon, authenticated`
			),
			`Missing public/client revoke for ${signature}`
		);
	}
	assert.ok(!migration.includes('prepare_first_admin_bootstrap'));
	assert.ok(!migration.includes('bind_first_admin_bootstrap'));
	assert.ok(
		migration.includes(
			'revoke all on private.first_admin_bootstrap from public, anon, authenticated, service_role'
		)
	);
	assert.ok(
		migration.includes(
			'revoke all on private.first_admin_bootstrap_attempts from public, anon, authenticated, service_role'
		)
	);
});

test('prepare generates correlation server-side and returns no redeemable token', () => {
	assert.ok(
		migration.includes(
			'returns table ( bootstrap_invite_id uuid, bootstrap_invite_expires_at timestamptz, bootstrap_attempt_reused boolean )'
		)
	);
	assert.ok(migration.includes('bootstrap_request_id uuid := extensions.gen_random_uuid()'));
	assert.ok(migration.includes("encode(extensions.gen_random_bytes(32), 'hex')"));
	assert.ok(!migration.includes('raw_token'));
	assert.ok(!migration.includes('invite_token'));
	assert.ok(!migration.includes('insert into public.beta_consent_events'));
	assert.ok(migration.includes('insert into public.beta_memberships ( profile_id, invite_id, status )'));
	assert.ok(migration.includes("'pending'"));
});

test('bind verifies the exact invite/user pair and is terminally idempotent', () => {
	for (const fragment of [
		'from auth.users u',
		'lower(btrim(u.email))::extensions.citext = bootstrap_record.requested_email',
		'target_invited_at is null',
		'if bootstrap_record.bound_profile_id is not null then',
		'bootstrap_record.bound_invite_id is distinct from target_invite_id',
		'bootstrap_record.bound_profile_id is distinct from target_user_id',
		'a.invite_id = target_invite_id',
		'bound_request_id = target_request_id',
		"set role = 'admin'",
		'not private.is_active_beta_user(bootstrap_record.bound_profile_id)'
	]) {
		assert.ok(migration.includes(fragment), `Missing bind invariant: ${fragment}`);
	}
});

test('prepare configuration fails closed without enablement or email transport', () => {
	assert.throws(
		() =>
			resolveBootstrapConfiguration(
				{ ...validEnvironment, FIRST_ADMIN_BOOTSTRAP_ENABLED: 'false' },
				'prepare'
			),
		BootstrapConfigurationError
	);
	assert.throws(
		() => {
			const environment = { ...validEnvironment };
			delete environment.RESEND_API_KEY;
			resolveBootstrapConfiguration(environment, 'prepare');
		},
		BootstrapConfigurationError
	);
	assert.throws(
		() =>
			resolveBootstrapConfiguration(
				{ ...validEnvironment, FIRST_ADMIN_EMAIL_TRANSPORT_CONFIRMED: 'false' },
				'prepare'
			),
		BootstrapConfigurationError
	);
});

test('operator is staging-only and cannot bootstrap production', () => {
	assert.throws(
		() =>
			resolveBootstrapConfiguration({ ...validEnvironment, APP_ENV: 'production' }, 'prepare'),
		BootstrapConfigurationError
	);
	assert.throws(
		() =>
			resolveBootstrapConfiguration(
				{
					...validEnvironment,
					APP_ENV: 'production',
					FIRST_ADMIN_BOOTSTRAP_PRODUCTION_CONFIRMED: 'true'
				},
				'prepare'
			),
		BootstrapConfigurationError
	);
});

test('prepare accepts a named sender and no client request correlation', () => {
	const configuration = resolveBootstrapConfiguration(
		{
			...validEnvironment,
			RESEND_FROM_EMAIL: 'Marketplace Beta <beta@example.com>'
		},
		'prepare'
	);

	assert.equal(configuration.bootstrapEmail, 'first-admin@example.com');
	assert.equal(Object.hasOwn(configuration, 'requestId'), false);
	assert.doesNotMatch(operatorScript, /FIRST_ADMIN_BOOTSTRAP_REQUEST_ID/u);
});

test('bind-only recovery requires explicit invite and Auth user UUIDs', () => {
	for (const missingKey of [
		'FIRST_ADMIN_BOOTSTRAP_INVITE_ID',
		'FIRST_ADMIN_BOOTSTRAP_USER_ID'
	]) {
		const environment = { ...bindEnvironment };
		delete environment[missingKey];
		assert.throws(
			() => resolveBootstrapConfiguration(environment, 'bind'),
			BootstrapConfigurationError
		);
	}
	assert.throws(
		() =>
			resolveBootstrapConfiguration(
				{ ...bindEnvironment, FIRST_ADMIN_BOOTSTRAP_USER_ID: 'not-a-uuid' },
				'bind'
			),
		BootstrapConfigurationError
	);

	const configuration = resolveBootstrapConfiguration(bindEnvironment, 'bind');
	assert.equal(configuration.bootstrapEmail, null);
	assert.equal(configuration.inviteId, INVITE_ID);
	assert.equal(configuration.userId, USER_ID);
});

test('bind-only recovery does not depend on email transport or callback configuration', () => {
	const environment = { ...bindEnvironment };
	delete environment.FIRST_ADMIN_EMAIL_TRANSPORT_CONFIRMED;
	delete environment.RESEND_API_KEY;
	delete environment.RESEND_FROM_EMAIL;
	delete environment.PUBLIC_APP_URL;

	const configuration = resolveBootstrapConfiguration(environment, 'bind');
	assert.equal(configuration.inviteId, INVITE_ID);
	assert.equal(configuration.userId, USER_ID);
	assert.equal(configuration.appOrigin, null);
});

test('operator script contains no raw-token, password, or secret logging path', () => {
	assert.doesNotMatch(operatorScript, /invite_token|raw_token/iu);
	assert.doesNotMatch(operatorScript, /console\.(?:log|info|error)\([^)]*serviceRoleKey/isu);
	assert.doesNotMatch(operatorScript, /console\.(?:log|info|error)\([^)]*password/isu);
	assert.match(operatorScript, /revoke_beta_invite/u);
});

test('definite delivery failure compensates the pending database invite', async () => {
	const calls = [];
	const fakeClient = {
		rpc: async (name) => {
			calls.push(name);
			if (name === 'prepare_first_admin_invite') {
				return {
					data: [
						{
							bootstrap_invite_id: INVITE_ID,
							bootstrap_attempt_reused: false
						}
					],
					error: null
				};
			}
			if (name === 'revoke_beta_invite') return { data: null, error: null };
			throw new Error(`Unexpected RPC: ${name}`);
		},
		auth: {
			admin: {
				inviteUserByEmail: async () => ({
					data: { user: null },
					error: { message: 'transport failed' }
				})
			}
		}
	};

	await assert.rejects(
		runFirstAdminBootstrap(resolveBootstrapConfiguration(validEnvironment, 'prepare'), {
			createClientImpl: () => fakeClient,
			logger: { info: () => {} }
		}),
		/pending bootstrap invite was revoked/u
	);
	assert.deepEqual(calls, ['prepare_first_admin_invite', 'revoke_beta_invite']);
});

test('successful Auth delivery followed by bind failure preserves recovery state', async () => {
	const calls = [];
	const fakeClient = {
		rpc: async (name, parameters) => {
			calls.push({ name, parameters });
			if (name === 'prepare_first_admin_invite') {
				return {
					data: [
						{
							bootstrap_invite_id: INVITE_ID,
							bootstrap_attempt_reused: false
						}
					],
					error: null
				};
			}
			if (name === 'bind_first_admin_invite') {
				throw new Error('transient bind transport failure');
			}
			throw new Error(`Unexpected RPC: ${name}`);
		},
		auth: {
			admin: {
				inviteUserByEmail: async () => ({
					data: { user: { id: USER_ID } },
					error: null
				})
			}
		}
	};

	await assert.rejects(
		runFirstAdminBootstrap(resolveBootstrapConfiguration(validEnvironment, 'prepare'), {
			createClientImpl: () => fakeClient,
			logger: { info: () => {} }
		}),
		(error) => {
			assert.ok(error instanceof BootstrapRecoveryRequiredError);
			assert.equal(error.inviteId, INVITE_ID);
			assert.equal(error.userId, USER_ID);
			return true;
		}
	);
	assert.deepEqual(
		calls.map(({ name }) => name),
		['prepare_first_admin_invite', 'bind_first_admin_invite']
	);
	assert.deepEqual(calls[1].parameters, {
		target_invite_id: INVITE_ID,
		target_user_id: USER_ID
	});
});

test('a reused pending attempt never sends or revokes another invitation', async () => {
	const calls = [];
	let deliveryCalls = 0;
	const fakeClient = {
		rpc: async (name) => {
			calls.push(name);
			if (name === 'prepare_first_admin_invite') {
				return {
					data: [
						{
							bootstrap_invite_id: INVITE_ID,
							bootstrap_attempt_reused: true
						}
					],
					error: null
				};
			}
			throw new Error(`Unexpected RPC: ${name}`);
		},
		auth: {
			admin: {
				inviteUserByEmail: async () => {
					deliveryCalls += 1;
					throw new Error('must not send');
				}
			}
		}
	};

	await assert.rejects(
		runFirstAdminBootstrap(resolveBootstrapConfiguration(validEnvironment, 'prepare'), {
			createClientImpl: () => fakeClient,
			logger: { info: () => {} }
		}),
		(error) => {
			assert.ok(error instanceof BootstrapRecoveryRequiredError);
			assert.equal(error.inviteId, INVITE_ID);
			assert.equal(error.userId, null);
			return true;
		}
	);
	assert.deepEqual(calls, ['prepare_first_admin_invite']);
	assert.equal(deliveryCalls, 0);
});

test('bind-only retry uses the exact pair and remains idempotent', async () => {
	const calls = [];
	let alreadyBound = false;
	const fakeClient = {
		rpc: async (name, parameters) => {
			calls.push({ name, parameters });
			assert.equal(name, 'bind_first_admin_invite');
			const row = {
				bootstrap_invite_id: INVITE_ID,
				bootstrap_profile_id: USER_ID,
				bootstrap_already_bound: alreadyBound
			};
			alreadyBound = true;
			return { data: [row], error: null };
		},
		auth: {
			admin: {
				inviteUserByEmail: async () => {
					throw new Error('bind-only recovery must not send email');
				}
			}
		}
	};
	const configuration = resolveBootstrapConfiguration(bindEnvironment, 'bind');
	const options = {
		createClientImpl: () => fakeClient,
		logger: { info: () => {} }
	};

	await runFirstAdminBootstrap(configuration, options);
	await runFirstAdminBootstrap(configuration, options);

	assert.equal(calls.length, 2);
	for (const call of calls) {
		assert.deepEqual(call, {
			name: 'bind_first_admin_invite',
			parameters: {
				target_invite_id: INVITE_ID,
				target_user_id: USER_ID
			}
		});
	}
});
