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
	test('persists before and after each mutation in strict provider order', async () => {
		const execute = requiredFunction('executeOperatorStep');
		const value = manifest({ state: 'supabase_project_created' });
		const events: string[] = [];
		const persist = vi.fn(async (next: OperatorManifest) => {
			events.push(`persist:${next.pending_mutation ? 'pending' : next.state}`);
		});
		const action = vi.fn(async (target) => {
			events.push('mutate');
			return { target };
		});

		const completed = await execute({ manifest: value, step: 'configure_mailtrap_smtp', persist, action });

		expect(events).toEqual(['persist:pending', 'mutate', 'persist:mailtrap_smtp_active']);
		expect(completed.state).toBe('mailtrap_smtp_active');
		expect(completed.pending_mutation).toBeNull();
		expect(action).toHaveBeenCalledWith({
			provider: 'supabase',
			projectId: 'abcdefghijklmnopqrst',
			mailtrapAccountId: 1_234_567,
			mailtrapInboxId: 4_887_168
		});
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
				manifest: manifest({ state: 'supabase_project_created' }),
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

		current = await execute({ manifest: current, step: 'delete_worker', persist, action });
		current = await execute({ manifest: current, step: 'delete_supabase_project', persist, action });

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
				manifest: manifest({ state: 'supabase_project_created' }),
				step: 'configure_mailtrap_smtp',
				persist: async (value: OperatorManifest) => { persisted.push(structuredClone(value)); },
				action: async () => ({ target: { provider: 'supabase', projectId: 'foreign-project' } })
			})
		).rejects.toThrow('Issue #22 provider result does not match the manifest.');
		expect(persisted).toHaveLength(1);
		expect(persisted[0].pending_mutation).not.toBeNull();
	});
});
