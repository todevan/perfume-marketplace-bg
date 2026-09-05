import { describe, expect, test } from 'vitest';
import { assertRecoveryScope, createPostgresToolchain } from '../../scripts/issue29-operations/logical-recovery.mjs';
const scope = { mode: 'hosted' as const, role: 'source' as const, runId: '29292929-2929-4292-8292-292929292929', projectRef: 'abcdefghijklmnopqrst', sourceRef: 'abcdefghijklmnopqrst', preservedRefs: ['bcdefghijklmnopqrstu'], createdResourceEvidenceSha256: 'a'.repeat(64), apiUrl: 'https://abcdefghijklmnopqrst.supabase.co' };
describe('executable logical recovery boundary', () => {
    test('rejects preserved source and target identities before launching any database command', () => {
        expect(() => assertRecoveryScope({ ...scope, preservedRefs: [scope.projectRef] })).toThrow('PRESERVED_PROJECT_FORBIDDEN');
        expect(() => assertRecoveryScope({ ...scope, role: 'target' })).toThrow('SOURCE_TARGET_COLLISION');
        expect(assertRecoveryScope(scope)).toEqual(scope);
    });
});
import { prepareApplicationSchemaRestore } from '../../scripts/issue29-operations/logical-recovery.mjs';
test('retains application default privileges but independently matches non-owned provider defaults before omitting their replay', () => {
    const provider = 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;';
    const application = 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;';
    expect(prepareApplicationSchemaRestore(`${provider}\n${application}\n`, `${provider}\n`)).toBe(`\n${application}\n`);
    expect(() => prepareApplicationSchemaRestore(`${provider}\n`, '')).toThrow('PROVIDER_DEFAULT_PRIVILEGE_MISMATCH');
});
import { canonicalSchemaSql, safeApplicationDefaultsSql } from '../../scripts/issue29-operations/logical-recovery.mjs';
test('canonicalizes only associative CHECK boolean groups, never comparison grouping or quoted AND literals', () => {
    const source = "    CONSTRAINT code CHECK (((code IS NULL) OR (((length(code) >= 2) AND (length(code) <= 80)) AND (code ~ 'AND (private)'::text)))),";
    const restored = "    CONSTRAINT code CHECK (((code IS NULL) OR ((length(code) >= 2) AND (length(code) <= 80) AND (code ~ 'AND (private)'::text)))),";
    expect(canonicalSchemaSql(source)).toBe(canonicalSchemaSql(restored));
    expect(canonicalSchemaSql("    CONSTRAINT x CHECK (((a) OR (b)) AND (c))")).not.toBe(canonicalSchemaSql("    CONSTRAINT x CHECK ((a) OR ((b) AND (c)))"));
    expect(safeApplicationDefaultsSql()).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon,authenticated,service_role;');
});
test('target restore refuses a preserved source even when the target itself is newly owned', () => { expect(() => assertRecoveryScope({ ...scope, role: 'target', projectRef: 'cdefghijklmnopqrstuv', apiUrl: 'https://cdefghijklmnopqrstuv.supabase.co', preservedRefs: [scope.sourceRef] })).toThrow('PRESERVED_PROJECT_FORBIDDEN'); });
test('schema normalization keeps NOT, OR precedence, comparison operators and quoted values distinct', () => { const check = (s: string) => canonicalSchemaSql(`    CONSTRAINT test CHECK (${s})`); expect(check('NOT ((a) AND (b))')).not.toBe(check('(a) AND (b)')); expect(check('(a >= 1) AND (b)')).not.toBe(check('(a > 1) AND (b)')); expect(check("(code = 'a AND b')")).not.toBe(check("(code = 'a OR b')")); expect(check('(a) OR (b) AND (c)')).toBe(check('(a) OR ((b) AND (c))')); });
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('runs pinned-tool boundaries with a minimal child environment and redacts failing provider output', async () => { const directory = await mkdtemp(join(tmpdir(), 'issue29-pg-tool-test-')); try {
    const executable = `#!/usr/bin/python3\nimport os,sys,json\nif '--fail' in sys.argv:\n sys.stderr.write('secret-database-password provider body');sys.exit(2)\nprint(json.dumps({'keys':list(os.environ),'ssl':os.environ.get('PGSSLROOTCERT'),'argv':sys.argv[1:]}))\n`;
    await writeFile(join(directory, 'psql'), executable, { mode: 0o700 });
    const tools = createPostgresToolchain({ scope, connection: { host: 'db.abcdefghijklmnopqrst.supabase.co', port: 5432, database: 'postgres', user: 'postgres', password: 'secret-database-password', sslmode: 'verify-full' }, toolchain: { mode: 'native', binDirectory: directory } });
    const captured = await tools.run('psql', ['--capture']);
    const result = JSON.parse(captured.toString());
    expect(result.keys.sort()).toEqual(['LANG', 'PATH', 'PGCONNECT_TIMEOUT', 'PGDATABASE', 'PGHOST', 'PGPASSWORD', 'PGPORT', 'PGSSLROOTCERT', 'PGSSLMODE', 'PGUSER'].sort());
    expect(result.ssl).toBe('system');
    expect(result.argv).toEqual(['--capture']);
    await expect(tools.run('psql', ['--fail'])).rejects.toThrow('POSTGRES_COMMAND_FAILED');
}
finally {
    await rm(directory, { recursive: true, force: true });
} });
test('rejects TLS downgrade, mismatched database host, and host-only certificate paths at the connection boundary', () => { const options = { scope, connection: { host: 'db.abcdefghijklmnopqrst.supabase.co', port: 5432, database: 'postgres', user: 'postgres', password: 'private-test', sslmode: 'verify-full' as const }, toolchain: { mode: 'container' as const } }; expect(() => createPostgresToolchain({ ...options, connection: { ...options.connection, sslmode: 'disable' } })).toThrow('DATABASE_TARGET_MISMATCH'); expect(() => createPostgresToolchain({ ...options, connection: { ...options.connection, host: 'db.bcdefghijklmnopqrstu.supabase.co' } })).toThrow('DATABASE_TARGET_MISMATCH'); expect(() => createPostgresToolchain({ ...options, connection: { ...options.connection, sslRootCert: '/private/root.crt' } })).toThrow('SYSTEM_CA_ROOTS_REQUIRED'); });
