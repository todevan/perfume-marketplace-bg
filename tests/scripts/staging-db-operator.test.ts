import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	FORBIDDEN_PROJECT_REFS,
	STAGING_PROJECT,
	StagingTargetError,
	buildSupabaseCliEnvironment,
	cleanupPinnedSupabaseWorkdir,
	createPinnedSupabaseWorkdir,
	runStagingCommand,
	stagingCommandArguments,
	verifyStagingTarget,
	verifyStagingInventoryReceipt
} from '../../scripts/staging-db-operator.mjs';

const publishableKey = 'sb_publishable_frankfurt_test_key';

const healthyProject = {
	id: STAGING_PROJECT.ref,
	ref: STAGING_PROJECT.ref,
	linked: true,
	name: 'perfume-marketplace-bg-staging',
	organization_id: STAGING_PROJECT.organizationId,
	organization_slug: STAGING_PROJECT.organizationId,
	region: STAGING_PROJECT.region,
	status: STAGING_PROJECT.status,
	database: {
		postgres_engine: String(STAGING_PROJECT.postgresMajor),
		version: '17.6.1.147'
	}
};

function jwt(payload: Record<string, string>) {
	const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
	return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.test-signature`;
}

const serviceRoleKey = jwt({
	ref: STAGING_PROJECT.ref,
	role: 'service_role'
});

const baseEnvironment = {
	PUBLIC_SUPABASE_URL: STAGING_PROJECT.url,
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
	SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey
};

function dependencies(overrides: Record<string, unknown> = {}) {
	return {
		readLinkedProjectRef: () => STAGING_PROJECT.ref,
		listProjects: () => [healthyProject],
		listApiKeys: () => [
			{ type: 'publishable', name: 'default', api_key: publishableKey },
			{ type: 'legacy', name: 'service_role', api_key: serviceRoleKey }
		],
		createPinnedWorkdir: () => 'C:\\isolated\\perfume-marketplace-staging-test',
		cleanupPinnedWorkdir: () => {},
		verifyInventoryReceipt: () => {},
		...overrides
	};
}

describe('Frankfurt staging target guard', () => {
	it('accepts only the exact linked, healthy Frankfurt project and configured key pair', () => {
		expect(
			verifyStagingTarget({
				environment: baseEnvironment,
				dependencies: dependencies()
			})
		).toEqual(STAGING_PROJECT);
	});

	it('rejects a missing official link before provider inventory is read', () => {
		const listProjects = vi.fn();
		expect(() =>
			verifyStagingTarget({
				environment: baseEnvironment,
				dependencies: dependencies({
					readLinkedProjectRef: () => '',
					listProjects
				})
			})
		).toThrow(/No official Supabase link/u);
		expect(listProjects).not.toHaveBeenCalled();
	});

	it('explicitly rejects the former Stockholm ref before any hosted lookup', () => {
		const listProjects = vi.fn();
		expect(FORBIDDEN_PROJECT_REFS).toContain('zllqwlekadiuyejgbuxc');
		expect(() =>
			verifyStagingTarget({
				environment: baseEnvironment,
				dependencies: dependencies({
					readLinkedProjectRef: () => 'zllqwlekadiuyejgbuxc',
					listProjects
				})
			})
		).toThrow(/Stockholm project is explicitly forbidden/u);
		expect(listProjects).not.toHaveBeenCalled();
	});

	it.each([
		['organization', { organization_id: 'wrong-organization' }, /unexpected Supabase organization/u],
		['region', { region: 'eu-north-1' }, /required Frankfurt region/u],
		['health', { status: 'INACTIVE' }, /not ACTIVE_HEALTHY/u],
		[
			'PostgreSQL major',
			{ database: { ...healthyProject.database, postgres_engine: '16' } },
			/not running PostgreSQL major version 17/u
		],
		['CLI linked flag', { linked: false }, /active local link/u]
	])('rejects the wrong %s metadata', (_label, patch, expectedMessage) => {
		expect(() =>
			verifyStagingTarget({
				environment: baseEnvironment,
				dependencies: dependencies({
					listProjects: () => [{ ...healthyProject, ...patch }]
				})
			})
		).toThrow(expectedMessage);
	});

	it('rejects a Supabase URL for another project', () => {
		expect(() =>
			verifyStagingTarget({
				environment: {
					...baseEnvironment,
					PUBLIC_SUPABASE_URL: 'https://zllqwlekadiuyejgbuxc.supabase.co'
				},
				dependencies: dependencies()
			})
		).toThrow(/PUBLIC_SUPABASE_URL does not match/u);
	});

	it('rejects a publishable key from another project without echoing it', () => {
		const foreignKey = 'sb_publishable_do_not_log_this_value';
		let caught: unknown;
		try {
			verifyStagingTarget({
				environment: {
					...baseEnvironment,
					PUBLIC_SUPABASE_PUBLISHABLE_KEY: foreignKey
				},
				dependencies: dependencies()
			});
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(StagingTargetError);
		expect(String(caught)).not.toContain(foreignKey);
	});

	it('requires an exact Frankfurt legacy service-role key only for seed', () => {
		expect(() =>
			verifyStagingTarget({
				environment: {
					...baseEnvironment,
					SUPABASE_SERVICE_ROLE_KEY: jwt({
						ref: 'zllqwlekadiuyejgbuxc',
						role: 'service_role'
					})
				},
				requireServiceRole: true,
				dependencies: dependencies()
			})
		).toThrow(/does not belong to the allowed Frankfurt staging project/u);

		expect(() =>
			verifyStagingTarget({
				environment: {
					...baseEnvironment,
					SUPABASE_SERVICE_ROLE_KEY: ''
				},
				requireServiceRole: false,
				dependencies: dependencies()
			})
		).not.toThrow();
	});
});

describe('Frankfurt staging operator commands', () => {
	it('maps push operations to fixed forward-only CLI arguments', () => {
		expect(stagingCommandArguments('verify-target')).toBeNull();
		expect(stagingCommandArguments('push-dry-run')).toEqual([
			'db',
			'push',
			'--linked',
			'--dry-run'
		]);
		expect(stagingCommandArguments('push')).toEqual(['db', 'push', '--linked', '--yes']);
		expect(stagingCommandArguments('seed')).toBeNull();
		expect(() => stagingCommandArguments('reset')).toThrow(/Choose exactly one staging command/u);
	});

	it.each([
		['push-dry-run', ['db', 'push', '--linked', '--dry-run']],
		['push', ['db', 'push', '--linked', '--yes']]
	])('executes %s only after the guard succeeds', async (command, expectedArguments) => {
		const runSupabaseCli = vi.fn();
		const cleanupPinnedWorkdir = vi.fn();
		await runStagingCommand(command, {
			environment: baseEnvironment,
			dependencies: dependencies({ runSupabaseCli, cleanupPinnedWorkdir }),
			logger: { info: vi.fn() }
		});
		expect(runSupabaseCli).toHaveBeenCalledOnce();
		expect(runSupabaseCli).toHaveBeenCalledWith(
			[
				...expectedArguments,
				'--workdir',
				'C:\\isolated\\perfume-marketplace-staging-test'
			],
			expect.objectContaining({
				cwd: 'C:\\isolated\\perfume-marketplace-staging-test',
				purpose: 'push',
				inherit: false
			})
		);
		expect(cleanupPinnedWorkdir).toHaveBeenCalledWith(
			'C:\\isolated\\perfume-marketplace-staging-test'
		);
	});

	it('never creates a pinned workdir or starts a push when the guard rejects the target', async () => {
		const runSupabaseCli = vi.fn();
		const createPinnedWorkdir = vi.fn();
		await expect(
			runStagingCommand('push', {
				environment: baseEnvironment,
				dependencies: dependencies({
					readLinkedProjectRef: () => 'zllqwlekadiuyejgbuxc',
					createPinnedWorkdir,
					runSupabaseCli
				}),
				logger: { info: vi.fn() }
			})
		).rejects.toThrow(/Stockholm/u);
		expect(createPinnedWorkdir).not.toHaveBeenCalled();
		expect(runSupabaseCli).not.toHaveBeenCalled();
	});

	it('runs the imported catalogue seed only after public and service keys pass', async () => {
		const seedCatalog = vi.fn(async (_options: {
			projectUrl: string;
			serviceRoleKey: string;
			logger: Pick<Console, 'log'>;
		}) => ({ brands: 196 }));
		await runStagingCommand('seed', {
			environment: baseEnvironment,
			dependencies: dependencies({ seedCatalog }),
			logger: { info: vi.fn() }
		});
		expect(seedCatalog).toHaveBeenCalledOnce();
		expect(seedCatalog).toHaveBeenCalledWith(
			expect.objectContaining({
				projectUrl: STAGING_PROJECT.url,
				serviceRoleKey
			})
		);
		expect(seedCatalog.mock.calls[0]?.[0]).not.toHaveProperty('environment');
	});

	it('always cleans the pinned workdir when the CLI push fails', async () => {
		const rawProviderDiagnostic = 'synthetic provider token must not escape';
		const cleanupPinnedWorkdir = vi.fn();
		let caught: unknown;
		try {
			await runStagingCommand('push', {
				environment: baseEnvironment,
				dependencies: dependencies({
					runSupabaseCli: () => {
						throw new Error(rawProviderDiagnostic);
					},
					cleanupPinnedWorkdir
				}),
				logger: { info: vi.fn() }
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(StagingTargetError);
		expect(String(caught)).not.toContain(rawProviderDiagnostic);
		expect(cleanupPinnedWorkdir).toHaveBeenCalledOnce();
	});

	it('passes only purpose-specific operating-system and Supabase variables to subprocesses', () => {
		const sourceEnvironment = {
			PATH: 'test-path',
			TEMP: 'test-temp',
			SUPABASE_ACCESS_TOKEN: 'access-token',
			SUPABASE_DB_PASSWORD: 'database-password',
			SUPABASE_SERVICE_ROLE_KEY: 'must-not-leak',
			PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'must-not-leak',
			RESEND_API_KEY: 'must-not-leak',
			NODE_OPTIONS: '--require malicious-module',
			SUPABASE_CLI_BINARY_OVERRIDE: 'malicious-binary'
		};
		expect(buildSupabaseCliEnvironment(sourceEnvironment, 'inventory')).toEqual({
			PATH: 'test-path',
			TEMP: 'test-temp',
			SUPABASE_ACCESS_TOKEN: 'access-token'
		});
		expect(buildSupabaseCliEnvironment(sourceEnvironment, 'push')).toEqual({
			PATH: 'test-path',
			TEMP: 'test-temp',
			SUPABASE_ACCESS_TOKEN: 'access-token',
			SUPABASE_DB_PASSWORD: 'database-password'
		});
	});

	it('pins a verified link snapshot that a later workspace relink cannot retarget', () => {
		const fixtureBase = mkdtempSync(join(tmpdir(), 'staging-operator-fixture-'));
		const source = join(fixtureBase, 'source-supabase');
		const sourceTemp = join(source, '.temp');
		mkdirSync(join(source, 'migrations'), { recursive: true });
		mkdirSync(join(source, 'templates'), { recursive: true });
		mkdirSync(join(source, 'functions', 'notification-email'), { recursive: true });
		mkdirSync(sourceTemp, { recursive: true });
		writeFileSync(
			join(source, 'config.toml'),
			[
				'project_id = "test"',
				'[auth.email.template.invite]',
				'content_path = "./supabase/templates/invite.html"',
				'[functions.notification-email]',
				'verify_jwt = false',
				''
			].join('\n')
		);
		writeFileSync(join(source, 'migrations', '001_test.sql'), 'select 1;\n');
		writeFileSync(join(source, 'templates', 'invite.html'), '<p>Invite</p>\n');
		writeFileSync(
			join(source, 'functions', 'notification-email', 'index.ts'),
			'export default {};\n'
		);
		writeFileSync(join(sourceTemp, 'project-ref'), `${STAGING_PROJECT.ref}\n`);
		writeFileSync(
			join(sourceTemp, 'pooler-url'),
			`postgresql://postgres.${STAGING_PROJECT.ref}@aws-0-${STAGING_PROJECT.region}.pooler.supabase.com:5432/postgres\n`
		);
		writeFileSync(join(sourceTemp, 'postgres-version'), '17.6.1.147\n');
		writeFileSync(
			join(sourceTemp, 'linked-project.json'),
			JSON.stringify({
				ref: STAGING_PROJECT.ref,
				organization_id: STAGING_PROJECT.organizationId
			})
		);

		let pinnedWorkdir = '';
		try {
			pinnedWorkdir = createPinnedSupabaseWorkdir({
				sourceSupabaseDirectory: source,
				temporaryBase: fixtureBase
			});
			writeFileSync(join(sourceTemp, 'project-ref'), 'zllqwlekadiuyejgbuxc\n');
			expect(
				readFileSync(
					join(pinnedWorkdir, 'supabase', '.temp', 'project-ref'),
					'utf8'
				).trim()
			).toBe(STAGING_PROJECT.ref);
			expect(
				readFileSync(
					join(pinnedWorkdir, 'supabase', 'templates', 'invite.html'),
					'utf8'
				)
			).toContain('Invite');
			expect(
				existsSync(
					join(
						pinnedWorkdir,
						'supabase',
						'functions',
						'notification-email',
						'index.ts'
					)
				)
			).toBe(true);

			cleanupPinnedSupabaseWorkdir(pinnedWorkdir, fixtureBase);
			expect(existsSync(pinnedWorkdir)).toBe(false);
			pinnedWorkdir = '';
		} finally {
			if (pinnedWorkdir && existsSync(pinnedWorkdir)) {
				cleanupPinnedSupabaseWorkdir(pinnedWorkdir, fixtureBase);
			}
			rmSync(fixtureBase, { recursive: true, force: true });
		}
	});
});


describe('current staging signup inventory', () => {
  const categories = ['application_rows', 'auth_configuration', 'auth_users', 'database_objects',
    'edge_functions', 'extensions', 'migrations', 'realtime', 'scheduled_jobs', 'secrets', 'storage'];
  function verify(patch: Record<string, unknown> = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'issue29-signup-inventory-'));
    try {
      const path = join(directory, 'inventory.json');
      const bytes = JSON.stringify({ projectRef: STAGING_PROJECT.ref, createdAt: new Date().toISOString(),
        stopConditionsClear: true, containsRealData: false, publicSignupEnabled: true,
        unexpectedObjects: [], completeCategories: categories, ...patch });
      writeFileSync(path, bytes, { mode: 0o600 });
      return verifyStagingInventoryReceipt({ STAGING_INVENTORY_RECEIPT_PATH: path,
        STAGING_INVENTORY_RECEIPT_SHA256: createHash('sha256').update(bytes).digest('hex') });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  it('accepts approved open signup without relaxing data or target safety', () => {
    expect(() => verify()).not.toThrow();
  });
  it.each([false, undefined, 'true'])('rejects unverified signup state %s', (value) => {
    expect(() => verify({ publicSignupEnabled: value })).toThrow(/stop condition/);
  });
  it.each([{ containsRealData: true }, { projectRef: 'foreign-project' }, { unexpectedObjects: ['foreign'] }])(
    'still rejects unsafe inventory %j', (patch) => { expect(() => verify(patch)).toThrow(/stop condition/); }
  );
});
