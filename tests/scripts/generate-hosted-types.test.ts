import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	HOSTED_TYPES_TARGET,
	HostedTypeGenerationError,
	HostedTypeUsageError,
	assertHostedTypeTarget,
	composeHostedTypes,
	hostedTypeArguments,
	hostedTypeCliEnvironment,
	invokeHostedTypeGenerator,
	parseHostedTypeArguments,
	runHostedTypeGeneration
} from '../../scripts/generate-hosted-types.mjs';

const generatedCore = `export type Json =
  | string
  | number
  | boolean
  | null

export type Database = {
  public: {
    Tables: {}
    Views: {
      public_profiles: {
        Row: {
          id: string
        }
      }
    }
    Functions: {}
    Enums: {}
    CompositeTypes: {}
  }
}

export type Tables<
  TableName extends keyof Database["public"]["Tables"],
> = Database["public"]["Tables"][TableName]["Row"]
`;

const committedTypesPath = resolve(
	import.meta.dirname,
	'../../src/lib/server/database.types.ts'
);

function dependencies(overrides: Record<string, unknown> = {}) {
	return {
		readLinkedProjectRef: () => HOSTED_TYPES_TARGET.projectRef,
		generateCore: vi.fn(() => generatedCore),
		readCurrentOutput: vi.fn(() => null),
		writeOutput: vi.fn(),
		...overrides
	};
}

describe('Frankfurt hosted type generator contract', () => {
	it('pins the exact project, public schema, language, and non-agent CLI invocation', () => {
		expect(HOSTED_TYPES_TARGET).toEqual({
			projectRef: 'nuhkpqjjyuygiemrxbdp',
			schema: 'public',
			language: 'typescript',
			output: 'src/lib/server/database.types.ts'
		});
		expect(hostedTypeArguments()).toEqual([
			'gen',
			'types',
			'--project-id',
			HOSTED_TYPES_TARGET.projectRef,
			'--schema',
			'public',
			'--lang',
			'typescript',
			'--agent',
			'no'
		]);
	});

	it('fails closed on a missing or unexpected linked project before generation starts', () => {
		expect(() => assertHostedTypeTarget(() => '')).toThrow(HostedTypeGenerationError);
		expect(() => assertHostedTypeTarget(() => 'zllqwlekadiuyejgbuxc')).toThrow(
			/unexpected project/u
		);

		const generateCore = vi.fn(() => generatedCore);
		expect(() =>
			runHostedTypeGeneration({
				dependencies: dependencies({
					readLinkedProjectRef: () => 'zllqwlekadiuyejgbuxc',
					generateCore
				}),
				logger: { info: vi.fn() }
			})
		).toThrow(/unexpected project/u);
		expect(generateCore).not.toHaveBeenCalled();
	});

	it('normalizes the generated core and appends exactly one stable Views helper', () => {
		const windowsCore = `\uFEFF${generatedCore.replaceAll('\n', '\r\n')}`;
		const first = composeHostedTypes(windowsCore);
		const second = composeHostedTypes(generatedCore);

		expect(first).toBe(second);
		expect(first).toContain(
			'Generated from the hosted Frankfurt staging schema\n * (`nuhkpqjjyuygiemrxbdp`)'
		);
		expect(first.match(/^export type Views</gmu)).toHaveLength(1);
		expect(first).toContain(
			'> = Database["public"]["Views"][ViewName]["Row"]\n'
		);
		expect(first).not.toContain('\r');
		expect(first.endsWith('\n')).toBe(true);
	});

	it('reproduces the committed hosted type file from its generated core exactly', () => {
		const committed = readFileSync(committedTypesPath, 'utf8').replace(/\r\n?/gu, '\n');
		const coreStart = committed.indexOf('export type Json =');
		const helperStart = committed.indexOf('\nexport type Views<');

		expect(coreStart).toBeGreaterThan(-1);
		expect(helperStart).toBeGreaterThan(coreStart);
		expect(composeHostedTypes(committed.slice(coreStart, helperStart))).toBe(committed);
	});

	it('rejects unexpected provider output without touching the committed file', () => {
		const writeOutput = vi.fn();
		expect(() =>
			runHostedTypeGeneration({
				dependencies: dependencies({
					generateCore: () => 'provider warning rather than TypeScript',
					writeOutput
				}),
				logger: { info: vi.fn() }
			})
		).toThrow(/unexpected TypeScript shape/u);
		expect(writeOutput).not.toHaveBeenCalled();
	});

	it('writes the deterministic candidate once and then passes check mode without writing', () => {
		const writeOutput = vi.fn();
		const firstDependencies = dependencies({ writeOutput });
		const result = runHostedTypeGeneration({
			dependencies: firstDependencies,
			logger: { info: vi.fn() }
		});

		expect(result).toEqual({ changed: true, checked: false });
		expect(firstDependencies.generateCore).toHaveBeenCalledWith(
			hostedTypeArguments(),
			process.env
		);
		expect(writeOutput).toHaveBeenCalledOnce();

		const candidate = writeOutput.mock.calls[0]?.[0] as string;
		const checkWrite = vi.fn();
		const checkResult = runHostedTypeGeneration({
			check: true,
			dependencies: dependencies({
				readCurrentOutput: () => candidate.replaceAll('\n', '\r\n'),
				writeOutput: checkWrite
			}),
			logger: { info: vi.fn() }
		});
		expect(checkResult).toEqual({ changed: false, checked: true });
		expect(checkWrite).not.toHaveBeenCalled();
	});

	it('fails check mode on drift and never writes the generated candidate', () => {
		const writeOutput = vi.fn();
		expect(() =>
			runHostedTypeGeneration({
				check: true,
				dependencies: dependencies({
					readCurrentOutput: () => 'stale types',
					writeOutput
				}),
				logger: { info: vi.fn() }
			})
		).toThrow(/out of date/u);
		expect(writeOutput).not.toHaveBeenCalled();
	});

	it('passes only the CLI login context and suppresses credential-bearing provider failures', () => {
		const environment = {
			PATH: 'test-path',
			USERPROFILE: 'test-profile',
			SUPABASE_ACCESS_TOKEN: 'sbp_access_token_do_not_log',
			SUPABASE_DB_PASSWORD: 'database-password-do-not-pass',
			SUPABASE_SERVICE_ROLE_KEY: 'service-role-do-not-pass',
			SUPABASE_SECRET_KEY: 'sb_secret_do_not_pass',
			CLOUDFLARE_API_TOKEN: 'cloudflare-do-not-pass',
			RESEND_API_KEY: 'resend-do-not-pass',
			NODE_OPTIONS: '--require malicious-module'
		};
		expect(hostedTypeCliEnvironment(environment)).toEqual({
			PATH: 'test-path',
			SUPABASE_ACCESS_TOKEN: 'sbp_access_token_do_not_log',
			USERPROFILE: 'test-profile'
		});

		const spawn = vi.fn(
			(
				_command: string,
				_argumentsList: string[],
				_options: Record<string, unknown>
			) => ({
				status: 1,
				stdout: 'sb_secret_provider_output',
				stderr: 'database-password-provider-output'
			})
		);
		let caught: unknown;
		try {
			invokeHostedTypeGenerator(environment, spawn);
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(HostedTypeGenerationError);
		expect(String(caught)).not.toContain('sb_secret_provider_output');
		expect(String(caught)).not.toContain('database-password-provider-output');
		expect(spawn).toHaveBeenCalledOnce();
		expect(spawn.mock.calls[0]?.[1]).toEqual([
			expect.stringMatching(/supabase\.js$/u),
			...hostedTypeArguments()
		]);
		expect(spawn.mock.calls[0]?.[2]).toMatchObject({
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				PATH: 'test-path',
				SUPABASE_ACCESS_TOKEN: 'sbp_access_token_do_not_log',
				USERPROFILE: 'test-profile'
			}
		});
	});

	it('keeps the CLI non-interactive and rejects every target override', () => {
		expect(parseHostedTypeArguments([])).toEqual({
			help: false,
			version: false,
			check: false
		});
		expect(parseHostedTypeArguments(['--check'])).toEqual({
			help: false,
			version: false,
			check: true
		});
		expect(parseHostedTypeArguments(['--help', '--project-id', 'other'])).toEqual({
			help: true,
			version: false,
			check: false
		});
		expect(() => parseHostedTypeArguments(['--project-id', 'other'])).toThrow(
			HostedTypeUsageError
		);
		expect(() => parseHostedTypeArguments(['--schema', 'private'])).toThrow(
			HostedTypeUsageError
		);
		expect(() => parseHostedTypeArguments(['--check', '--check'])).toThrow(
			HostedTypeUsageError
		);
	});
});
