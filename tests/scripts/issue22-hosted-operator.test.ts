import { describe, expect, test, vi } from 'vitest';

type HostedOperatorModule = typeof import('../../scripts/issue22-hosted/operator.mjs');

const operator = await import('../../scripts/issue22-hosted/operator.mjs').catch(
	() => ({}) as Partial<HostedOperatorModule>
);

function requiredFunction<Name extends keyof HostedOperatorModule>(name: Name): HostedOperatorModule[Name] {
	const value = operator[name];
	if (typeof value !== 'function') throw new Error(`${String(name)} is not implemented`);
	return value as HostedOperatorModule[Name];
}

const transactionId = '22222222-2222-4222-8222-222222222222';
const candidateSha = 'a'.repeat(40);
const expectedAuthConfiguration = Object.freeze({
	disable_signup: false,
	external_email_enabled: true,
	mailer_autoconfirm: false,
	security_captcha_enabled: true,
	security_captcha_provider: 'turnstile'
});
type OperatorManifest = Parameters<HostedOperatorModule['validateManifest']>[0];

function manifest(overrides: Partial<OperatorManifest> = {}): OperatorManifest {
	return /** @type {OperatorManifest} */ ({
		schema_version: 1,
		issue: 22,
		transaction_id: transactionId,
		state: 'worker_deployed',
		pending_mutation: null,
		candidate: {
			expected_sha: candidateSha,
			origin: 'https://aromatika-issue-22-a1b2c3d.workers.dev'
		},
		preflight: { status: 'passed', free_capacity: true, checked_at: '2026-09-01T09:00:00.000Z' },
		providers: {
				supabase: {
					organization_id: 'organization-id',
					project_id: 'abcdefghijklmnopqrst',
					region: 'eu-central-1',
					plan: 'free',
					auth_configuration: expectedAuthConfiguration,
					smtp: { account_id: 1_234_567, inbox_id: 4_887_168, configured: true },
					confirmation_template: {
						candidate_origin: 'https://aromatika-issue-22-a1b2c3d.workers.dev',
						configured: true
					},
					migrations: { candidate_sha: candidateSha, applied: true },
					created_by_operator: true,
				cleanup_authorized: true,
				absent_verified: false
			},
			mailtrap: {
				account_id: 1_234_567,
				inbox_id: 4_887_168,
				api_base_url: 'https://mailtrap.io',
				created_by_operator: false,
				cleanup_authorized: false
			},
			cloudflare: {
				account_id: 'b'.repeat(32),
					worker_name: 'aromatika-issue-22-a1b2c3d',
					version_id: '11111111-1111-4111-8111-111111111111',
					candidate_sha: candidateSha,
				created_by_operator: true,
				cleanup_authorized: true,
				absent_verified: false
			}
		},
		history: [],
		...overrides
	});
}

describe('private manifest validation', () => {
	test('pins the Mailtrap API origin exactly', () => {
		const validate = requiredFunction('validateManifest');
		const foreign = manifest();
		foreign.providers.mailtrap.api_base_url = 'https://mailtrap-proxy.example.invalid';
		expect(() => validate(foreign)).toThrow('Issue #22 provider manifest is invalid.');
		expect(validate(manifest()).providers.mailtrap.api_base_url).toBe('https://mailtrap.io');
	});

	test('requires numeric Mailtrap account and exact inbox IDs before polling', () => {
		const validate = requiredFunction('validateManifest');
		const missingAccount = manifest();
		(missingAccount.providers.mailtrap as Record<string, unknown>).account_id = null;
		expect(() => validate(missingAccount, { phase: 'poll' })).toThrow(
			'Issue #22 provider manifest is invalid.'
		);

		const namedAccount = manifest();
		(namedAccount.providers.mailtrap as Record<string, unknown>).account_id = 'account-name';
		expect(() => validate(namedAccount, { phase: 'poll' })).toThrow(
			'Issue #22 provider manifest is invalid.'
		);

		const foreignInbox = manifest();
		(foreignInbox.providers.mailtrap as Record<string, unknown>).inbox_id = 4_887_169;
		expect(() => validate(foreignInbox, { phase: 'poll' })).toThrow(
			'Issue #22 provider manifest is invalid.'
		);
		expect(validate(manifest(), { phase: 'poll' }).providers.mailtrap.inbox_id).toBe(4_887_168);
	});

	test.each([
		['Supabase project', () => ((manifest().providers.supabase as Record<string, unknown>).project_id = null)],
		['Worker name', () => ((manifest().providers.cloudflare as Record<string, unknown>).worker_name = null)],
		['Worker version', () => ((manifest().providers.cloudflare as Record<string, unknown>).version_id = null)],
		['Cloudflare account', () => ((manifest().providers.cloudflare as Record<string, unknown>).account_id = null)]
	])('requires exact %s before proof', (_label, mutate) => {
		const validate = requiredFunction('validateManifest');
		const value = manifest();
		if (_label === 'Supabase project') (value.providers.supabase as Record<string, unknown>).project_id = null;
		if (_label === 'Worker name') (value.providers.cloudflare as Record<string, unknown>).worker_name = null;
		if (_label === 'Worker version') (value.providers.cloudflare as Record<string, unknown>).version_id = null;
		if (_label === 'Cloudflare account') (value.providers.cloudflare as Record<string, unknown>).account_id = null;
		expect(() => validate(value, { phase: 'proof' })).toThrow('Issue #22 provider manifest is invalid.');
		void mutate;
	});

	test('requires every exact provider readback attestation before proof', () => {
		const validate = requiredFunction('validateManifest');
		expect(validate(manifest(), { phase: 'proof' }).state).toBe('worker_deployed');

		const cases: Array<(value: OperatorManifest) => void> = [
			(value) => delete (value.providers.supabase as Record<string, unknown>).region,
			(value) => ((value.providers.supabase as Record<string, unknown>).plan = 'pro'),
			(value) => delete (value.providers.supabase as Record<string, unknown>).auth_configuration,
			(value) => delete (value.providers.supabase as Record<string, unknown>).smtp,
			(value) => delete (value.providers.supabase as Record<string, unknown>).confirmation_template,
			(value) => delete (value.providers.supabase as Record<string, unknown>).migrations,
			(value) => delete (value.providers.cloudflare as Record<string, unknown>).candidate_sha
		];
		for (const mutate of cases) {
			const value = manifest();
			mutate(value);
			expect(() => validate(value, { phase: 'proof' })).toThrow('Issue #22 provider manifest is invalid.');
		}
	});

	test('rejects manifest paths inside the repository', () => {
		const assertPrivatePath = requiredFunction('assertPrivateManifestPath');
		expect(() => assertPrivatePath('C:/repo/private/provider-manifest.json', 'C:/repo')).toThrow(
			'Issue #22 provider manifest must remain outside the repository.'
		);
		expect(
			assertPrivatePath('C:/Users/Admin/AppData/Local/Aromatika/issue-22/provider-manifest.json', 'C:/repo')
		).toBe('C:\\Users\\Admin\\AppData\\Local\\Aromatika\\issue-22\\provider-manifest.json');
	});
});

describe('manifest-bound operator transitions', () => {
	test('configures and reads back exact transient-project Auth settings without returning credentials', async () => {
		const execute = requiredFunction('executeOperatorStep');
		const createAction = requiredFunction('createSupabaseAuthConfigurationAction');
		const createReadback = requiredFunction('createSupabaseAuthConfigurationReadback');
		const managementToken = 'supabase-management-private';
		const captchaSecret = 'turnstile-secret-private';
		const requests: Array<{ url: string; init: RequestInit }> = [];
		const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
			requests.push({ url: String(input), init });
			if (init.method === 'PATCH') return new Response('{}', { status: 200 });
			return new Response(JSON.stringify(expectedAuthConfiguration), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});
		const target = { provider: 'supabase' as const, projectId: 'abcdefghijklmnopqrst' };

		const action = createAction({ accessToken: managementToken, captchaSecret, fetchImpl });
		const readBack = createReadback({ accessToken: managementToken, fetchImpl });
		const value = manifest({ state: 'supabase_project_created' });
		delete (value.providers.supabase as Record<string, unknown>).auth_configuration;
		const persisted: OperatorManifest[] = [];
		const completed = await execute({
			manifest: value,
			step: 'configure_supabase_auth',
			persist: async (next: OperatorManifest) => {
				persisted.push(structuredClone(next));
			},
			action,
			readBack
		});

		expect(requests.map(({ url, init }) => [init.method, url])).toEqual([
			['PATCH', 'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/config/auth'],
			['GET', 'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/config/auth']
		]);
		expect(JSON.parse(String(requests[0].init.body))).toEqual({
			...expectedAuthConfiguration,
			security_captcha_secret: captchaSecret
		});
		expect(requests[0].init.headers).toMatchObject({ Authorization: `Bearer ${managementToken}` });
		expect(completed.state).toBe('supabase_auth_configured');
		expect(completed.providers.supabase.auth_configuration).toEqual(expectedAuthConfiguration);
		expect(JSON.stringify(persisted)).not.toContain(managementToken);
		expect(JSON.stringify(persisted)).not.toContain(captchaSecret);
		expect(persisted).toHaveLength(2);
		expect(persisted[0].pending_mutation?.target).toEqual(target);
	});

	test('fails safely when transient-project Auth readback does not match the required settings', async () => {
		const createReadback = requiredFunction('createSupabaseAuthConfigurationReadback');
		const readBack = createReadback({
			accessToken: 'supabase-management-private',
			fetchImpl: vi.fn(async () =>
				new Response(JSON.stringify({ ...expectedAuthConfiguration, security_captcha_enabled: false }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
		});
		await expect(readBack({ provider: 'supabase', projectId: 'abcdefghijklmnopqrst' })).rejects.toThrow(
			'Issue #22 Supabase Auth configuration could not be verified.'
		);
	});

	test('keeps the Auth transition pending until a separate exact GET readback succeeds', async () => {
		const execute = requiredFunction('executeOperatorStep');
		const value = manifest({ state: 'supabase_project_created' });
		delete (value.providers.supabase as Record<string, unknown>).auth_configuration;
		const persisted: OperatorManifest[] = [];
		await expect(
			execute({
				manifest: value,
				step: 'configure_supabase_auth',
				persist: async (next: OperatorManifest) => {
					persisted.push(structuredClone(next));
				},
				action: async (target: Record<string, unknown>) => ({ target })
			})
		).rejects.toThrow('Issue #22 post-mutation readback is required.');
		expect(persisted).toHaveLength(1);
		expect(persisted[0].pending_mutation).toMatchObject({ step: 'configure_supabase_auth' });
	});

	test('advances the Auth transition only after exact sanitized readback', async () => {
		const execute = requiredFunction('executeOperatorStep');
		const value = manifest({ state: 'supabase_project_created' });
		delete (value.providers.supabase as Record<string, unknown>).auth_configuration;
		const readBack = vi.fn(async () => ({
			status: 'present',
			projectId: 'abcdefghijklmnopqrst',
			auth: expectedAuthConfiguration
		}));
		const completed = await execute({
			manifest: value,
			step: 'configure_supabase_auth',
			persist: vi.fn(),
			action: async (target: Record<string, unknown>) => ({ target }),
			readBack
		});
		expect(completed.state).toBe('supabase_auth_configured');
		expect(completed.providers.supabase.auth_configuration).toEqual(expectedAuthConfiguration);
		expect(readBack).toHaveBeenCalledWith({ provider: 'supabase', projectId: 'abcdefghijklmnopqrst' });
	});

	test('authorizes exact Supabase cleanup only after organization, region, and free-plan readback', async () => {
		const execute = requiredFunction('executeOperatorStep');
		const value = manifest({ state: 'preflight_verified' });
		value.providers.supabase = { organization_id: 'organization-id' };
		const persist = vi.fn();
		const action = vi.fn(async (target: Record<string, unknown>) => ({ target, projectId: 'abcdefghijklmnopqrst' }));
		const mismatchedReadback = vi.fn(async () => ({
			status: 'present',
			projectId: 'abcdefghijklmnopqrst',
			organizationId: 'foreign-organization',
			region: 'eu-central-1',
			plan: 'free'
		}));
		await expect(
			execute({ manifest: value, step: 'create_supabase_project', persist, action, readBack: mismatchedReadback })
		).rejects.toThrow('Issue #22 post-mutation readback is not verified.');
		expect(value.providers.supabase.cleanup_authorized).not.toBe(true);

		const completed = await execute({
			manifest: value,
			step: 'create_supabase_project',
			persist: vi.fn(),
			action,
			readBack: async () => ({
				status: 'present',
				projectId: 'abcdefghijklmnopqrst',
				organizationId: 'organization-id',
				region: 'eu-central-1',
				plan: 'free'
			})
		});
		expect(completed.providers.supabase).toMatchObject({
			project_id: 'abcdefghijklmnopqrst',
			organization_id: 'organization-id',
			region: 'eu-central-1',
			plan: 'free',
			created_by_operator: true,
			cleanup_authorized: true
		});
	});

	test('persists before and after each mutation in strict provider order', async () => {
		const execute = requiredFunction('executeOperatorStep');
		const value = manifest({ state: 'supabase_auth_configured' });
		const events: string[] = [];
		const persist = vi.fn(async (next: OperatorManifest) => {
			events.push(`persist:${next.pending_mutation ? 'pending' : next.state}`);
		});
		const action = vi.fn(async (target) => {
			events.push('mutate');
			return { target };
		});
		const readBack = vi.fn(async (target) => {
			events.push('readback');
			return { status: 'present', ...target, smtpConfigured: true };
		});

		const completed = await execute({ manifest: value, step: 'configure_mailtrap_smtp', persist, action, readBack });

		expect(events).toEqual(['persist:pending', 'mutate', 'readback', 'persist:mailtrap_smtp_active']);
		expect(completed.state).toBe('mailtrap_smtp_active');
		expect(completed.pending_mutation).toBeNull();
		expect(action).toHaveBeenCalledWith({
			provider: 'supabase',
			projectId: 'abcdefghijklmnopqrst',
			mailtrapAccountId: 1_234_567,
			mailtrapInboxId: 4_887_168
		});
		expect(completed.providers.supabase.smtp).toEqual({
			account_id: 1_234_567,
			inbox_id: 4_887_168,
			configured: true
		});
	});

	test('persists exact confirmation-template and migration readback attestations', async () => {
		const execute = requiredFunction('executeOperatorStep');
		let current = manifest({ state: 'mailtrap_smtp_active' });
		delete (current.providers.supabase as Record<string, unknown>).confirmation_template;
		delete (current.providers.supabase as Record<string, unknown>).migrations;
		const action = async (target: Record<string, unknown>) => ({ target });
		current = await execute({
			manifest: current,
			step: 'update_confirmation_template',
			persist: vi.fn(),
			action,
			readBack: async (target: Record<string, unknown>) => ({
				status: 'present',
				...target,
				confirmationTemplateConfigured: true
			})
		});
		current = await execute({
			manifest: current,
			step: 'apply_migrations',
			persist: vi.fn(),
			action,
			readBack: async (target: Record<string, unknown>) => ({
				status: 'present',
				...target,
				migrationsApplied: true
			})
		});
		expect(current.providers.supabase.confirmation_template).toEqual({
			candidate_origin: 'https://aromatika-issue-22-a1b2c3d.workers.dev',
			configured: true
		});
		expect(current.providers.supabase.migrations).toEqual({ candidate_sha: candidateSha, applied: true });
	});

	test('authorizes Worker cleanup only after exact account, name, version, and candidate readback', async () => {
		const execute = requiredFunction('executeOperatorStep');
		const value = manifest({ state: 'migrations_applied' });
		value.providers.cloudflare = {
			account_id: 'b'.repeat(32),
			worker_name: 'aromatika-issue-22-a1b2c3d'
		};
		const target = {
			provider: 'cloudflare' as const,
			accountId: 'b'.repeat(32),
			workerName: 'aromatika-issue-22-a1b2c3d',
			candidateSha
		};
		const action = vi.fn(async () => ({
			target,
			versionId: '11111111-1111-4111-8111-111111111111'
		}));
		await expect(
			execute({
				manifest: value,
				step: 'deploy_worker',
				persist: vi.fn(),
				action,
				inspectExactTarget: async () => ({ status: 'absent' }),
				readBack: async () => ({
					status: 'present',
					accountId: 'b'.repeat(32),
					workerName: target.workerName,
					versionId: '11111111-1111-4111-8111-111111111111',
					candidateSha: 'c'.repeat(40)
				})
			})
		).rejects.toThrow('Issue #22 post-mutation readback is not verified.');
		expect(value.providers.cloudflare.cleanup_authorized).not.toBe(true);

		const completed = await execute({
			manifest: value,
			step: 'deploy_worker',
			persist: vi.fn(),
			action,
			inspectExactTarget: async () => ({ status: 'absent' }),
			readBack: async () => ({
				status: 'present',
				accountId: 'b'.repeat(32),
				workerName: target.workerName,
				versionId: '11111111-1111-4111-8111-111111111111',
				candidateSha
			})
		});
		expect(completed.providers.cloudflare).toMatchObject({
			account_id: 'b'.repeat(32),
			worker_name: target.workerName,
			version_id: '11111111-1111-4111-8111-111111111111',
			candidate_sha: candidateSha,
			created_by_operator: true,
			cleanup_authorized: true
		});
	});

	test('keeps a cleanup pending when post-delete absence is unknown', async () => {
		const execute = requiredFunction('executeOperatorStep');
		const persisted: OperatorManifest[] = [];
		await expect(
			execute({
				manifest: manifest({ state: 'proof_passed' }),
				step: 'delete_worker',
				persist: async (next: OperatorManifest) => {
					persisted.push(structuredClone(next));
				},
				action: async (target: Record<string, unknown>) => ({ target }),
				readBack: async (target: Record<string, unknown>) => ({ status: 'unknown', id: target.id })
			})
		).rejects.toThrow('Issue #22 post-mutation readback is not verified.');
		expect(persisted).toHaveLength(1);
		expect(persisted[0].pending_mutation).toMatchObject({ step: 'delete_worker' });
	});

	test('does not run a later step before its prerequisite', async () => {
		const execute = requiredFunction('executeOperatorStep');
		const action = vi.fn();
		await expect(
			execute({ manifest: manifest({ state: 'supabase_project_created' }), step: 'deploy_worker', persist: vi.fn(), action })
		).rejects.toThrow('Issue #22 provider sequence is invalid.');
		expect(action).not.toHaveBeenCalled();
	});

	test('refuses an existing exact Worker target without enumerating resources', async () => {
		const execute = requiredFunction('executeOperatorStep');
		const value = manifest({ state: 'migrations_applied' });
		const action = vi.fn();
		const inspectExactTarget = vi.fn(async () => ({ status: 'present', id: 'aromatika-issue-22-a1b2c3d' }));

		await expect(
			execute({ manifest: value, step: 'deploy_worker', persist: vi.fn(), action, inspectExactTarget })
		).rejects.toThrow('Issue #22 target already exists or is foreign.');
		expect(inspectExactTarget).toHaveBeenCalledWith({
			provider: 'cloudflare',
			accountId: 'b'.repeat(32),
			workerName: 'aromatika-issue-22-a1b2c3d'
		});
		expect(action).not.toHaveBeenCalled();
	});

	test('leaves the pending mutation durable after partial failure', async () => {
		const execute = requiredFunction('executeOperatorStep');
		const persisted: Array<ReturnType<typeof manifest>> = [];
		await expect(
			execute({
				manifest: manifest({ state: 'supabase_auth_configured' }),
				step: 'configure_mailtrap_smtp',
				persist: async (value: OperatorManifest) => { persisted.push(structuredClone(value)); },
				action: async () => {
					throw new Error('provider response with private output');
				}
			})
		).rejects.toThrow('Issue #22 provider mutation failed safely.');
		expect(persisted).toHaveLength(1);
		expect(persisted[0].pending_mutation).toMatchObject({ step: 'configure_mailtrap_smtp' });
	});

	test('returns an already-completed step idempotently without another mutation', async () => {
		const execute = requiredFunction('executeOperatorStep');
		const action = vi.fn();
		const persist = vi.fn();
		const value = manifest({ state: 'mailtrap_smtp_active' });
		const result = await execute({ manifest: value, step: 'configure_mailtrap_smtp', persist, action });
		expect(result).toEqual(value);
		expect(action).not.toHaveBeenCalled();
		expect(persist).not.toHaveBeenCalled();
	});

	test('recovers an interrupted exact cleanup only from read-only absence evidence', async () => {
		const recover = requiredFunction('recoverPendingCleanup');
		const pending = manifest({
			state: 'proof_passed',
			pending_mutation: {
				step: 'delete_worker',
				target: { provider: 'cloudflare', id: 'aromatika-issue-22-a1b2c3d' },
				started_at: '2026-09-01T10:00:00.000Z'
			}
		});
		const persist = vi.fn();
		const inspectExactTarget = vi.fn(async () => ({ status: 'absent', id: 'aromatika-issue-22-a1b2c3d' }));
		const recovered = await recover({ manifest: pending, persist, inspectExactTarget });
		expect(inspectExactTarget).toHaveBeenCalledTimes(1);
		expect(recovered.pending_mutation).toBeNull();
		expect(recovered.providers.cloudflare.absent_verified).toBe(true);
		expect(persist).toHaveBeenCalledTimes(1);
	});

	test('transitions a failed non-mutating proof into exact manifest-bound cleanup', async () => {
		const execute = requiredFunction('executeOperatorStep');
		let current = manifest({
			state: 'worker_deployed',
			pending_mutation: {
				step: 'run_proof',
				target: {
					provider: 'proof-runner',
					transactionId,
					projectId: 'abcdefghijklmnopqrst',
					workerName: 'aromatika-issue-22-a1b2c3d',
					versionId: '11111111-1111-4111-8111-111111111111',
					mailtrapAccountId: 1_234_567,
					mailtrapInboxId: 4_887_168,
					candidateSha
				},
				started_at: '2026-09-01T10:00:00.000Z'
			}
		});
		const deleted: Array<{ provider: string; id: string | number }> = [];
		const persist = vi.fn(async (next: OperatorManifest) => {
			current = structuredClone(next);
		});
		const action = vi.fn(async (target: unknown) => {
			const cleanupTarget = target as {
				provider: 'cloudflare' | 'supabase';
				id: string | number;
			};
			deleted.push(cleanupTarget);
			return { target: cleanupTarget };
		});

		current = await execute({
			manifest: current,
			step: 'delete_worker',
			persist,
			action,
			readBack: async (target: Record<string, unknown>) => ({ status: 'absent', id: target.id })
		});
		current = await execute({
			manifest: current,
			step: 'delete_supabase_project',
			persist,
			action,
			readBack: async (target: Record<string, unknown>) => ({ status: 'absent', id: target.id })
		});

		expect(current.state).toBe('supabase_project_deleted');
		expect(current.pending_mutation).toBeNull();
		expect(deleted).toEqual([
			{ provider: 'cloudflare', id: 'aromatika-issue-22-a1b2c3d' },
			{ provider: 'supabase', id: 'abcdefghijklmnopqrst' }
		]);
		expect(current.history?.map(({ step }) => step)).toEqual([
			'run_proof_failed',
			'delete_worker',
			'delete_supabase_project'
		]);
	});

	test('refuses cleanup for unmanifested, foreign, or owner-created resources', () => {
		const assertCleanup = requiredFunction('assertCleanupTarget');
		const value = manifest();
		expect(() => assertCleanup(value, { provider: 'cloudflare', id: 'foreign-worker' })).toThrow(
			'Issue #22 cleanup target is not authorized.'
		);
		expect(() => assertCleanup(value, { provider: 'mailtrap', id: 4_887_168 })).toThrow(
			'Issue #22 cleanup target is not authorized.'
		);
		expect(
			assertCleanup(value, { provider: 'supabase', id: 'abcdefghijklmnopqrst' })
		).toEqual({ provider: 'supabase', id: 'abcdefghijklmnopqrst' });
	});

	test('allows only the exact dedicated owner-provisioned Mailtrap sandbox when cleanup is explicitly authorized', () => {
		const assertCleanup = requiredFunction('assertCleanupTarget');
		const value = manifest();
		value.providers.mailtrap.cleanup_authorized = true;
		(value.providers.mailtrap as Record<string, unknown>).provenance = 'owner_provisioned_for_issue22';
		expect(assertCleanup(value, { provider: 'mailtrap', id: 4_887_168 })).toEqual({
			provider: 'mailtrap',
			id: 4_887_168
		});
		(value.providers.mailtrap as Record<string, unknown>).provenance = 'owner_general_resource';
		expect(() => assertCleanup(value, { provider: 'mailtrap', id: 4_887_168 })).toThrow(
			'Issue #22 cleanup target is not authorized.'
		);
	});

	test('read-only final absence verification includes the explicitly authorized Mailtrap sandbox', async () => {
		const verifyAbsence = requiredFunction('verifyCleanupAbsence');
		const value = manifest();
		value.providers.mailtrap.cleanup_authorized = true;
		(value.providers.mailtrap as Record<string, unknown>).provenance = 'owner_provisioned_for_issue22';
		const inspected: Array<{ provider: string; id: string | number }> = [];
		const result = await verifyAbsence({
			manifest: value,
			inspectExactTarget: async (target: { provider: string; id: string | number }) => {
				inspected.push(target);
				return { ...target, status: 'absent' };
			}
		});
		expect(inspected).toEqual([
			{ provider: 'cloudflare', id: 'aromatika-issue-22-a1b2c3d' },
			{ provider: 'supabase', id: 'abcdefghijklmnopqrst' },
			{ provider: 'mailtrap', id: 4_887_168 }
		]);
		expect(result).toEqual({ status: 'absent', checked: 3 });
	});

	test('fails closed when a provider result names a foreign target', async () => {
		const execute = requiredFunction('executeOperatorStep');
		const persisted: Array<ReturnType<typeof manifest>> = [];
		await expect(
			execute({
				manifest: manifest({ state: 'supabase_auth_configured' }),
				step: 'configure_mailtrap_smtp',
				persist: async (value: OperatorManifest) => { persisted.push(structuredClone(value)); },
				action: async () => ({ target: { provider: 'supabase', projectId: 'foreign-project' } })
			})
		).rejects.toThrow('Issue #22 provider result does not match the manifest.');
		expect(persisted).toHaveLength(1);
		expect(persisted[0].pending_mutation).not.toBeNull();
	});
});
