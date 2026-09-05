import { spawn, execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensure, OperationsError } from './manifest.mjs';
import { canonicalJson } from './recovery-set.mjs';
import { sha256 } from '../storage-backup-crypto.mjs';
export const POSTGRES_VERSION = '17.6';
export const POSTGRES_IMAGE = 'public.ecr.aws/supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453';
export const SUPABASE_CLI_VERSION = '2.109.1';
/** @typedef {{mode:'local'|'hosted',role:'source'|'target',runId:string,projectRef:string,sourceRef:string,preservedRefs:string[],createdResourceEvidenceSha256:string,apiUrl:string}} RecoveryScope */
/** @typedef {{host:string,port:number,database:string,user:string,password:string,sslmode:'disable'|'verify-full',sslRootCert?:string}} DatabaseConnection */
/** @typedef {{mode:'container'}|{mode:'exec',containerId:string}|{mode:'native',binDirectory:string}} Toolchain */
/** @typedef {{scope:RecoveryScope,connection:DatabaseConnection,toolchain:Toolchain}} DatabaseOptions */
const execFile = promisify(execFileCallback);
const REF = /^[a-z]{20}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const SCHEMAS = ['public', 'private'];
/** @param {RecoveryScope} scope */
export function assertRecoveryScope(scope) {
    ensure(scope && ['local', 'hosted'].includes(scope.mode) && ['source', 'target'].includes(scope.role) && REF.test(scope.projectRef) && REF.test(scope.sourceRef) && Array.isArray(scope.preservedRefs) && scope.preservedRefs.every(ref => REF.test(ref)), 'RECOVERY_SCOPE_INVALID');
    ensure(!scope.preservedRefs.includes(scope.projectRef) && !scope.preservedRefs.includes(scope.sourceRef), 'PRESERVED_PROJECT_FORBIDDEN');
    ensure(scope.role !== 'target' || scope.projectRef !== scope.sourceRef, 'SOURCE_TARGET_COLLISION');
    ensure(scope.role !== 'source' || scope.projectRef === scope.sourceRef, 'SOURCE_IDENTITY_MISMATCH');
    ensure(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(scope.runId) && HASH.test(scope.createdResourceEvidenceSha256), 'SOURCE_PROVENANCE_REQUIRED');
    if (scope.mode === 'hosted')
        ensure(scope.apiUrl === `https://${scope.projectRef}.supabase.co`, 'PROJECT_URL_MISMATCH');
    else
        ensure(/^http:\/\/127\.0\.0\.1:\d{4,5}$/u.test(scope.apiUrl), 'LOCAL_SCOPE_INVALID');
    return scope;
}
/** @param {string} name */
function identifier(name) { ensure(typeof name === 'string' && name.length > 0 && name.length <= 128 && !name.includes('\0'), 'DATABASE_IDENTIFIER_INVALID'); return `"${name.replaceAll('"', '""')}"`; }
/** @param {string} text */
function literal(text) { return `'${text.replaceAll("'", "''")}'`; }
/** @param {DatabaseOptions} options */
export function createPostgresToolchain({ scope, connection, toolchain }) {
    assertRecoveryScope(scope);
    ensure(connection.database === 'postgres' && Number.isSafeInteger(connection.port) && connection.port > 0 && connection.port < 65536 && typeof connection.password === 'string' && connection.password.length > 0, 'DATABASE_CONNECTION_INVALID');
    if (scope.mode === 'local')
        ensure(connection.host === '127.0.0.1' && connection.sslmode === 'disable' && connection.user === 'postgres', 'LOCAL_SCOPE_INVALID');
    else
        ensure(connection.sslmode === 'verify-full' && ((connection.host === `db.${scope.projectRef}.supabase.co` && connection.user === 'postgres') || (/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/u.test(connection.host) && connection.port === 5432 && connection.user === `postgres.${scope.projectRef}`)), 'DATABASE_TARGET_MISMATCH');
    ensure(!connection.sslRootCert || connection.sslRootCert === 'system', 'SYSTEM_CA_ROOTS_REQUIRED');
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', PGHOST: connection.host, PGPORT: String(connection.port), PGDATABASE: connection.database, PGUSER: connection.user, PGPASSWORD: connection.password, PGSSLMODE: connection.sslmode, PGCONNECT_TIMEOUT: '10', ...(scope.mode === 'hosted' ? { PGSSLROOTCERT: 'system' } : {}) };
    const pgVariables = Object.keys(env).filter(name => name.startsWith('PG'));
    /** @param {'psql'|'pg_dump'} tool @param {string[]} args */
    function command(tool, args) {
        if (toolchain.mode === 'native') {
            ensure(isAbsolute(toolchain.binDirectory), 'PINNED_TOOLCHAIN_REQUIRED');
            return { file: join(toolchain.binDirectory, tool), args };
        }
        if (toolchain.mode === 'exec') {
            ensure(scope.mode === 'local' && /^supabase_db_issue29-recovery-[a-z0-9-]+$/u.test(toolchain.containerId), 'LOCAL_SCOPE_INVALID');
            return { file: 'docker', args: ['exec', '-i', ...pgVariables.flatMap(name => ['-e', name]), toolchain.containerId, tool, ...args] };
        }
        ensure(toolchain.mode === 'container', 'PINNED_TOOLCHAIN_REQUIRED');
        return { file: 'docker', args: ['run', '--rm', '-i', '--network', 'host', ...pgVariables.flatMap(name => ['-e', name]), '--entrypoint', tool, POSTGRES_IMAGE, ...args] };
    }
    /** @param {'psql'|'pg_dump'} tool @param {string[]} args */
    async function run(tool, args) {
        const spec = command(tool, args);
        try {
            const result = await execFile(spec.file, spec.args, { env, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, timeout: 600000 });
            return result.stdout;
        }
        catch {
            throw new OperationsError('POSTGRES_COMMAND_FAILED');
        }
    }
    async function verifyVersions() {
        for (const name of /** @type {const} */ (['psql', 'pg_dump']))
            ensure((await run(name, ['--version'])).toString().trim() === `${name} (PostgreSQL) ${POSTGRES_VERSION}`, 'POSTGRES_TOOL_VERSION_MISMATCH');
        ensure((await run('psql', ['--no-psqlrc', '--no-password', '--tuples-only', '--no-align', '--command=SHOW server_version;'])).toString().trim() === POSTGRES_VERSION, 'POSTGRES_SERVER_VERSION_MISMATCH');
    }
    function session() {
        const spec = command('psql', ['--no-psqlrc', '--no-password', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1']);
        const child = spawn(spec.file, spec.args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
        let output = '';
        let failed = false;
        /** @type {{marker:string,resolve:(text:string)=>void,reject:(error:Error)=>void,timer:ReturnType<typeof setTimeout>}|null} */ let waiting = null;
        child.stdout.on('data', chunk => {
            output += chunk.toString('utf8');
            if (output.length > 128 * 1024 * 1024) {
                child.kill();
                return;
            }
            if (waiting) {
                const end = output.indexOf(`${waiting.marker}\n`);
                if (end >= 0) {
                    const value = output.slice(0, end).trim();
                    output = output.slice(end + waiting.marker.length + 1);
                    clearTimeout(waiting.timer);
                    waiting.resolve(value);
                    waiting = null;
                }
            }
        });
        child.stderr.on('data', () => { }); // Provider/database error text never enters logs or receipts.
        const die = () => {
            failed = true;
            if (waiting) {
                clearTimeout(waiting.timer);
                waiting.reject(new OperationsError('POSTGRES_SESSION_FAILED'));
                waiting = null;
            }
        };
        child.on('error', die);
        child.on('exit', die);
        /** @param {string} sql @returns {Promise<string>} */
        async function query(sql) { ensure(!failed && waiting === null, 'POSTGRES_SESSION_UNAVAILABLE'); const marker = `issue29_${randomUUID().replaceAll('-', '')}`; return new Promise((resolve, reject) => { const timer = setTimeout(() => { child.kill(); die(); }, 600000); waiting = { marker, resolve, reject, timer }; child.stdin.write(`${sql}\n\\echo ${marker}\n`); }); }
        return { query, async close() {
                if (!failed) {
                    child.stdin.end('ROLLBACK;\n\\q\n');
                    await new Promise(resolve => child.once('exit', resolve));
                }
            } };
    }
    return { run, session, verifyVersions };
}
/** @typedef {{schemaSql:string,roleNames:string[],schemaSha256:string,postgresVersion:string}} ManagedBaseline */
/** @typedef {{op:'AND'|'OR',children:BooleanNode[]}|{op:null,text:string}} BooleanNode */
/** Parse only fully parenthesized pg_dump CHECK expressions; preserve every leaf byte. @param {string} input @returns {BooleanNode} */
function booleanNode(input) {
    let text = input.trim();
    /** @param {string} value */
    function boundaries(value) {
        let depth = 0;
        let quote = '';
        const tokens = [];
        let firstClose = -1;
        for (let i = 0; i < value.length; i++) {
            const char = value[i];
            if (quote) {
                if (char === quote) {
                    if (value[i + 1] === quote)
                        i++;
                    else
                        quote = '';
                }
                else if (char === '\\')
                    i++;
                continue;
            }
            if (char === "'" || char === '"') {
                quote = char;
                continue;
            }
            if (char === '(')
                depth++;
            else if (char === ')') {
                depth--;
                if (depth === 0 && firstClose < 0)
                    firstClose = i;
            }
            else if (depth === 0) {
                const match = /^ (AND|OR) /u.exec(value.slice(i));
                if (match) {
                    tokens.push({ at: i, length: match[0].length, op: match[1] });
                    i += match[0].length - 1;
                }
            }
        }
        ensure(depth === 0 && !quote, 'SCHEMA_CHECK_SYNTAX_UNSUPPORTED');
        return { tokens, firstClose };
    }
    while (text.startsWith('(') && boundaries(text).firstClose === text.length - 1)
        text = text.slice(1, -1).trim();
    const { tokens } = boundaries(text);
    if (tokens.length === 0)
        return { op: null, text };
    const op = tokens.some(t => t.op === 'OR') ? 'OR' : 'AND';
    const selected = tokens.filter(t => t.op === op);
    let from = 0;
    const children = [];
    for (const token of selected) {
        children.push(booleanNode(text.slice(from, token.at)));
        from = token.at + token.length;
    }
    children.push(booleanNode(text.slice(from)));
    return { op, children: children.flatMap(child => child.op === op ? child.children : [child]) };
}
/** @param {BooleanNode} node @returns {string} */
function renderBoolean(node) { return node.op === null ? `(${node.text})` : `(${node.children.map(renderBoolean).join(` ${node.op} `)})`; }
/** pg_dump expands BETWEEN, then reparsing flattens only associative AND/OR groups. No other SQL normalization is allowed. @param {string} sql */
export function canonicalSchemaSql(sql) { return sql.replace(/^(\s+CONSTRAINT [^\n]+? CHECK )(.+?)(,?)$/gmu, (_line, prefix, expression, comma) => `${prefix}${renderBoolean(booleanNode(expression))}${comma}`); }
/** Reset only operator-owned per-schema grants before object creation; replay source defaults at the end of its dump. */
export function safeApplicationDefaultsSql() { return ['TABLES', 'SEQUENCES', 'FUNCTIONS', 'TYPES'].map(kind => `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${kind} FROM anon,authenticated,service_role;`).join('\n'); }
/** @param {string} sql */
function normalizeDump(sql) { return sql.replace(/^\\(?:un)?restrict .*\n/gmu, '').replace(/^-- Dumped (?:from|by).*\n/gmu, '').trim(); }
/** @param {unknown} value @returns {ManagedBaseline} */
export function validateManagedBaseline(value) { const v = /** @type {ManagedBaseline} */ (value); ensure(v && typeof v.schemaSql === 'string' && v.schemaSql.length < 8 * 1024 * 1024 && Array.isArray(v.roleNames) && v.roleNames.every(name => typeof name === 'string') && v.postgresVersion === POSTGRES_VERSION && v.schemaSha256 === sha256(normalizeDump(v.schemaSql)), 'MANAGED_BASELINE_INVALID'); return v; }
/** Capture only on a freshly created empty source before application migrations. @param {DatabaseOptions} options */
export async function captureManagedBaseline(options) {
    const tools = createPostgresToolchain(options);
    await tools.verifyVersions();
    const session = tools.session();
    try {
        const foreign = JSON.parse(await session.query("select json_build_object('users',(select count(*) from auth.users),'objects',(select count(*) from storage.objects),'applicationTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p') and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')));"));
        ensure(foreign.users === 0 && foreign.objects === 0 && foreign.applicationTables === 0, 'TARGET_FOREIGN_STATE');
        const roles = JSON.parse(await session.query("select json_agg(rolname order by rolname) from pg_roles;"));
        const schemaSql = (await tools.run('pg_dump', ['--schema-only', '--schema=auth', '--schema=storage', '--no-owner', '--no-comments', '--no-publications', '--no-subscriptions'])).toString();
        return validateManagedBaseline({ schemaSql, roleNames: roles, schemaSha256: sha256(normalizeDump(schemaSql)), postgresVersion: POSTGRES_VERSION });
    }
    finally {
        await session.close();
    }
}
/** @param {string} sql */
function managedBlocks(sql) { const body = normalizeDump(sql); const regex = /^--\n-- Name: (.*); Type: ([^;]+); Schema: ([^;]+); Owner: [^\n]*\n--\n/gmu; const matches = [...body.matchAll(regex)]; return matches.map((match, index) => ({ key: `${match[2]}:${match[3]}:${match[1]}`, kind: match[2], body: body.slice(/** @type {number} */ (match.index) + match[0].length, matches[index + 1]?.index ?? body.length).replace(/-- PostgreSQL database dump complete[\s\S]*$/u, '').trim() })); }
/** The current repository adds managed-schema triggers and RLS policies; unsupported provider-base alterations fail rather than being guessed. @param {ManagedBaseline} baseline @param {string} currentSql */
export function deriveManagedSchemaChanges(baseline, currentSql) {
    validateManagedBaseline(baseline);
    const prior = new Map(managedBlocks(baseline.schemaSql).map(b => [b.key, b]));
    const current = managedBlocks(currentSql);
    for (const before of prior.values()) {
        const after = current.find(b => b.key === before.key);
        ensure(after && after.body === before.body, 'MANAGED_BASE_SCHEMA_DRIFT');
    }
    const additions = current.filter(b => !prior.has(b.key));
    ensure(additions.every(b => ['TRIGGER', 'POLICY', 'FUNCTION'].includes(b.kind)), 'MANAGED_CHANGE_UNSUPPORTED');
    return Buffer.from(`-- Application additions to the verified provider Auth/Storage base.\n${additions.map(b => b.body).join('\n\n')}\n`);
}
/** @typedef {ReturnType<ReturnType<typeof createPostgresToolchain>['session']>} Session */
/** @param {Session} session @param {string} sql @returns {Promise<any>} */
async function jsonQuery(session, sql) { return JSON.parse(await session.query(sql)); }
/** @param {Session} session */
async function inventory(session) {
    const tables = await jsonQuery(session, "select coalesce(json_agg(json_build_object('schema',n.nspname,'table',c.relname,'rls',c.relrowsecurity) order by n.nspname,c.relname),'[]'::json) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p') and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e');");
    /** @type {Array<{schema:string,table:string,rls:boolean,count:number,sha256:string}>} */ const rows = [];
    for (const table of tables) {
        const data = await jsonQuery(session, `select coalesce(json_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::json) from ${identifier(table.schema)}.${identifier(table.table)} t;`);
        rows.push({ ...table, count: data.length, sha256: sha256(canonicalJson(data)) });
    }
    return rows;
}
export const FINALIZED_PHOTO_SQL = "select coalesce(json_agg(json_build_object('id',id,'storage_path',storage_path,'content_hash',content_hash,'mime_type',mime_type,'byte_size',byte_size,'sanitized_at',sanitized_at) order by id),'[]'::json) from public.listing_photos where sanitized_at is not null;";
/** @param {unknown[]} photos */
export function finalizedRowsetSha256(photos) { return sha256(canonicalJson(photos)); }
/** @param {Session} session @param {RecoveryScope} scope */
async function authRecovery(session, scope) {
    const excluded = ['confirmed_at', 'confirmation_token', 'confirmation_sent_at', 'recovery_token', 'recovery_sent_at', 'email_change_token_new', 'email_change', 'email_change_sent_at', 'email_change_token_current', 'email_change_confirm_status', 'phone_change', 'phone_change_token', 'phone_change_sent_at', 'reauthentication_token', 'reauthentication_sent_at'];
    const users = await jsonQuery(session, `select coalesce(json_agg(to_jsonb(u)-array[${excluded.map(literal).join(',')}] order by id),'[]'::json) from auth.users u;`);
    const identities = await jsonQuery(session, "select coalesce(json_agg(to_jsonb(i)-'email' order by id),'[]'::json) from auth.identities i;");
    ensure(users.length > 0 && users.every((/** @type {any} */ u) => u.raw_app_meta_data?.issue29_run_id === scope.runId && u.is_sso_user !== true && u.is_anonymous !== true && u.deleted_at === null && typeof u.encrypted_password === 'string' && /^\$2[aby]\$/u.test(u.encrypted_password)), 'SYNTHETIC_AUTH_OWNERSHIP_UNPROVEN');
    ensure(identities.length === users.length && identities.every((/** @type {any} */ i) => i.provider === 'email' && users.some((/** @type {any} */ u) => u.id === i.user_id && u.email === i.identity_data?.email)) && new Set(identities.map((/** @type {any} */ i) => i.user_id)).size === users.length, 'AUTH_RECOVERY_INCOMPLETE');
    ensure(Number(await session.query('select count(*) from auth.mfa_factors;')) === 0, 'AUTH_MFA_RECOVERY_UNSUPPORTED');
    /** @param {string} table @param {any[]} rows @param {Record<string,string>} [defaults] */
    const insert = (table, rows, defaults = {}) => { const columns = Object.keys(rows[0]); return `INSERT INTO auth.${identifier(table)} (${[...columns, ...Object.keys(defaults)].map(identifier).join(',')}) SELECT ${[...columns.map(k => `r.${identifier(k)}`), ...Object.values(defaults)].join(',')} FROM jsonb_populate_recordset(NULL::auth.${identifier(table)},${literal(JSON.stringify(rows))}::jsonb) r;`; };
    const tokens = { confirmation_token: "''", recovery_token: "''", email_change_token_new: "''", email_change: "''", email_change_token_current: "''", phone_change: "''", phone_change_token: "''", reauthentication_token: "''", email_change_confirm_status: '0' };
    return { sql: Buffer.from(`-- Recovery-relevant synthetic Auth state only; source tokens and sessions excluded.\n${insert('users', users, tokens)}\n${insert('identities', identities)}\n`), count: users.length, identities: identities.length, sha256: sha256(canonicalJson({ users, identities })) };
}
/** @param {Session} session @param {ManagedBaseline} baseline */
async function roleRecovery(session, baseline) { const roles = await jsonQuery(session, "select coalesce(json_agg(to_jsonb(r) order by rolname),'[]'::json) from (select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls from pg_roles) r;"); const custom = roles.filter((/** @type {any} */ r) => !baseline.roleNames.includes(r.rolname)); ensure(custom.every((/** @type {any} */ r) => !r.rolsuper && !r.rolcreaterole && !r.rolcreatedb && !r.rolcanlogin && !r.rolreplication && !r.rolbypassrls), 'CUSTOM_ROLE_RECOVERY_UNSUPPORTED'); const members = await jsonQuery(session, "select coalesce(json_agg(json_build_object('role',r.rolname,'member',m.rolname,'admin',a.admin_option) order by r.rolname,m.rolname),'[]'::json) from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member;"); const customNames = custom.map((/** @type {any} */ r) => r.rolname); const grants = members.filter((/** @type {any} */ m) => customNames.includes(m.role) || customNames.includes(m.member)); ensure(grants.every((/** @type {any} */ g) => !g.admin && customNames.includes(g.role) && [...customNames, 'anon', 'authenticated', 'service_role'].includes(g.member)), 'CUSTOM_ROLE_GRANT_UNSUPPORTED'); return Buffer.from(`-- Custom non-login role recovery; managed provider roles are not replayed.\n${custom.map((/** @type {any} */ r) => `CREATE ROLE ${identifier(r.rolname)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS ${r.rolinherit ? 'INHERIT' : 'NOINHERIT'};`).join('\n')}\n${grants.map((/** @type {any} */ g) => `GRANT ${identifier(g.role)} TO ${identifier(g.member)};`).join('\n')}\n`); }
/** @param {Session} session */
async function assertDatabaseQuarantine(session) {
    const result = await jsonQuery(session, "select json_build_object('alwaysTriggers',(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and t.tgenabled='A' and n.nspname in ('public','private','auth')),'subscriptions',(select count(*) from pg_subscription),'hooks',(select count(*) from supabase_functions.hooks),'pendingNetwork',(select count(*) from net.http_request_queue));");
    ensure(Object.values(result).every(value => value === 0), 'UNSAFE_OUTBOUND_EFFECTS');
    const cron = await session.query("select to_regclass('cron.job') is not null;");
    if (cron === 't')
        ensure(Number(await session.query('select count(*) from cron.job where active;')) === 0, 'ACTIVE_JOB_QUARANTINE_UNPROVEN');
}
/** @param {DatabaseOptions & {managedBaseline:ManagedBaseline,onSnapshot?:(value:{photos:any[],checkpoint:{snapshotId:string,finalizedRowsetSha256:string}})=>Promise<unknown>}} options */
export async function exportLogicalRecovery(options) {
    assertRecoveryScope(options.scope);
    ensure(options.scope.role === 'source', 'SOURCE_CAPABILITY_REQUIRED');
    const baseline = validateManagedBaseline(options.managedBaseline);
    const tools = createPostgresToolchain(options);
    await tools.verifyVersions();
    const session = tools.session();
    try {
        await session.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;');
        const snapshotId = await session.query('SELECT pg_export_snapshot();');
        ensure(/^[A-Fa-f0-9]+-[A-Fa-f0-9]+-[0-9]+$/u.test(snapshotId), 'SNAPSHOT_ID_INVALID');
        const snapshotArgs = [`--snapshot=${snapshotId}`, '--no-owner', '--no-comments', '--no-publications', '--no-subscriptions'];
        await validateForeignKeys(session);
        const before = await inventory(session);
        const auth = await authRecovery(session, options.scope);
        const photos = await jsonQuery(session, FINALIZED_PHOTO_SQL);
        const checkpoint = { snapshotId, finalizedRowsetSha256: finalizedRowsetSha256(photos) };
        const schema = (await tools.run('pg_dump', ['--schema-only', '--schema=public', '--schema=private', ...snapshotArgs])).toString().replace(/^CREATE SCHEMA public;\n/gmu, '');
        ensure(!/CREATE EVENT TRIGGER|ALTER SYSTEM|CREATE SUBSCRIPTION/iu.test(schema), 'UNSAFE_SCHEMA_EFFECTS');
        const managed = (await tools.run('pg_dump', ['--schema-only', '--schema=auth', '--schema=storage', ...snapshotArgs])).toString();
        const changes = deriveManagedSchemaChanges(baseline, managed);
        const migrations = await jsonQuery(session, 'select coalesce(json_agg(to_jsonb(m) order by version),\'[]\'::json) from supabase_migrations.schema_migrations m;');
        ensure(migrations.length > 0, 'MIGRATION_INVENTORY_REQUIRED');
        const migrationSql = Buffer.from(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;\nCREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text primary key, statements text[], name text);\nINSERT INTO supabase_migrations.schema_migrations(version,statements,name) SELECT version,statements,name FROM jsonb_populate_recordset(NULL::supabase_migrations.schema_migrations,${literal(JSON.stringify(migrations))}::jsonb);\n`);
        const extensions = await jsonQuery(session, "select json_agg(json_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) order by e.extname) from pg_extension e join pg_namespace n on n.oid=e.extnamespace;");
        const extensionsPrivileges = await jsonQuery(session, "select coalesce(json_agg(json_build_object('grantee',coalesce(r.rolname,'PUBLIC'),'privilege',a.privilege_type,'grantable',a.is_grantable) order by coalesce(r.rolname,'PUBLIC'),a.privilege_type),'[]'::json) from pg_namespace n cross join lateral aclexplode(n.nspacl) a left join pg_roles r on r.oid=a.grantee where n.nspname='extensions';");
        const publications = await jsonQuery(session, "select coalesce(json_agg(json_build_object('name',pubname,'schema',schemaname,'table',tablename) order by pubname,schemaname,tablename),'[]'::json) from pg_publication_tables where schemaname in ('public','private');");
        const data = await tools.run('pg_dump', ['--data-only', '--schema=public', '--schema=private', ...snapshotArgs]);
        const roles = await roleRecovery(session, baseline);
        const platform = { version: 1, runId: options.scope.runId, sourceRef: options.scope.projectRef, managedBaselineSha256: baseline.schemaSha256, managedSchemaSha256: sha256(normalizeDump(managed)), schemaSha256: sha256(normalizeDump(canonicalSchemaSql(schema))), migration: { count: migrations.length, sha256: sha256(canonicalJson(migrations)) }, auth: { users: auth.count, identities: auth.identities, sha256: auth.sha256 }, tables: before, extensions, extensionsPrivileges, publications, exclusions: ['auth-sessions', 'auth-refresh-tokens', 'auth-one-time-tokens', 'auth-flow-state', 'auth-mfa', 'storage-managed-internals', 'cron-jobs', 'pending-network', 'runtime-secrets', 'provider-settings'], checkpoint };
        const storage = options.onSnapshot ? await options.onSnapshot({ photos, checkpoint }) : null;
        Object.assign(platform, { storageBuckets: storage && typeof storage === 'object' && 'bucketInventory' in storage ? storage.bucketInventory : [] });
        if (storage && typeof storage === 'object' && 'bucketInventory' in storage && Array.isArray(storage.bucketInventory) && storage.bucketInventory.some(bucket => bucket.id === 'operations-sentinels'))
            platform.exclusions.push('monitor-sentinel-fixture');
        await session.query('COMMIT;');
        const after = await inventory(session);
        const afterPhotos = await jsonQuery(session, FINALIZED_PHOTO_SQL);
        const afterAuth = await authRecovery(session, options.scope);
        ensure(canonicalJson(before) === canonicalJson(after) && checkpoint.finalizedRowsetSha256 === finalizedRowsetSha256(afterPhotos) && auth.sha256 === afterAuth.sha256, 'SOURCE_SNAPSHOT_DRIFT');
        afterAuth.sql.fill(0);
        return { components: new Map([['roles.sql', roles], ['schema.sql', Buffer.from(schema)], ['data.sql', data], ['migration-history.sql', migrationSql], ['auth-recovery.sql', auth.sql], ['managed-schema.sql', changes], ['platform-inventory.json', Buffer.from(canonicalJson(platform))]]), checkpointBefore: checkpoint, checkpointAfter: { ...checkpoint }, migration: platform.migration, inventory: platform, storage };
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('LOGICAL_EXPORT_FAILED');
    }
    finally {
        await session.close();
    }
}
/** Provider-owned defaults cannot be changed by the normal postgres operator; omit only exact live base matches. @param {string} schemaSql @param {string} targetBaseSql */
export function prepareApplicationSchemaRestore(schemaSql, targetBaseSql) {
    return schemaSql.replace(/^ALTER DEFAULT PRIVILEGES FOR ROLE (\S+) [^\n]*;$/gmu, (statement, role) => {
        if (role === 'postgres' || role === '"postgres"')
            return statement;
        ensure(targetBaseSql.split('\n').includes(statement), 'PROVIDER_DEFAULT_PRIVILEGE_MISMATCH');
        return '';
    });
}
/** @param {RecoveryScope} scope @param {DatabaseConnection} connection */
export function validateDatabaseConnection(scope, connection) { createPostgresToolchain({ scope, connection, toolchain: { mode: 'container' } }); return connection; }
/** @typedef {{runId:string,projectRef:string,evidenceSha256:string,checkedAt:string,noRuntimeRoutes:true,noOutboundIntegrations:true,noRuntimeSecrets:true}} PlatformQuarantine */
/** @param {Session} session */
async function validateForeignKeys(session) {
    await session.query(`DO $issue29$
DECLARE c record; equality text; nonnull text; nulls text; bad boolean;
BEGIN
 FOR c IN SELECT x.*, n.nspname child_schema,t.relname child_table, pn.nspname parent_schema,pt.relname parent_table
 FROM pg_constraint x JOIN pg_class t ON t.oid=x.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class pt ON pt.oid=x.confrelid JOIN pg_namespace pn ON pn.oid=pt.relnamespace WHERE x.contype='f' AND n.nspname IN ('public','private','auth') LOOP
 SELECT string_agg(format('a.%I = b.%I',ca.attname,pa.attname),' AND ' ORDER BY k.ord),string_agg(format('a.%I IS NOT NULL',ca.attname),' AND ' ORDER BY k.ord),string_agg(format('a.%I IS NULL',ca.attname),' AND ' ORDER BY k.ord)
 INTO equality,nonnull,nulls FROM unnest(c.conkey,c.confkey) WITH ORDINALITY k(child,parent,ord) JOIN pg_attribute ca ON ca.attrelid=c.conrelid AND ca.attnum=k.child JOIN pg_attribute pa ON pa.attrelid=c.confrelid AND pa.attnum=k.parent;
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I a WHERE (%s) AND NOT EXISTS(SELECT 1 FROM %I.%I b WHERE %s))',c.child_schema,c.child_table,nonnull,c.parent_schema,c.parent_table,equality) INTO bad;
 IF bad THEN RAISE EXCEPTION 'ISSUE29_FOREIGN_KEY_INTEGRITY_FAILED'; END IF;
 IF c.confmatchtype='f' THEN EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I a WHERE NOT(%s) AND NOT(%s))',c.child_schema,c.child_table,nonnull,nulls) INTO bad;IF bad THEN RAISE EXCEPTION 'ISSUE29_FOREIGN_KEY_INTEGRITY_FAILED';END IF; END IF;
 END LOOP;
END $issue29$;`);
}
/** One full application-schema path, never migrations followed by replayed duplicate DDL. Caller provides components only inside withVerifiedRecoverySet. @param {DatabaseOptions & {components:Map<string,Buffer>,quarantine:PlatformQuarantine,now?:string}} options */
export async function restoreLogicalRecovery(options) {
    const { scope } = options;
    assertRecoveryScope(scope);
    ensure(scope.role === 'target', 'RESTORE_CAPABILITY_REQUIRED');
    const q = options.quarantine;
    const now = Date.parse(options.now ?? new Date().toISOString());
    ensure(q && q.runId === scope.runId && q.projectRef === scope.projectRef && HASH.test(q.evidenceSha256) && q.noRuntimeRoutes === true && q.noOutboundIntegrations === true && q.noRuntimeSecrets === true && Number.isFinite(Date.parse(q.checkedAt)) && now - Date.parse(q.checkedAt) >= 0 && now - Date.parse(q.checkedAt) <= 300000, 'PLATFORM_QUARANTINE_UNPROVEN');
    const names = ['roles.sql', 'schema.sql', 'data.sql', 'migration-history.sql', 'auth-recovery.sql', 'managed-schema.sql', 'platform-inventory.json'];
    ensure(names.every(name => Buffer.isBuffer(options.components.get(name)) && /** @type {Buffer} */ (options.components.get(name)).length > 0), 'COMPONENT_INVENTORY_MISMATCH');
    const platform = JSON.parse(/** @type {Buffer} */ (options.components.get('platform-inventory.json')).toString());
    ensure(platform.version === 1 && platform.runId === scope.runId && platform.sourceRef === scope.sourceRef && HASH.test(platform.managedBaselineSha256) && Array.isArray(platform.tables), 'RECOVERY_INVENTORY_INVALID');
    const tools = createPostgresToolchain(options);
    await tools.verifyVersions();
    const baseline = await captureManagedBaseline(options);
    ensure(baseline.schemaSha256 === platform.managedBaselineSha256, 'MANAGED_BASE_SCHEMA_DRIFT');
    const targetBaseSql = (await tools.run('pg_dump', ['--schema-only', '--schema=public', '--no-owner', '--no-comments', '--no-publications', '--no-subscriptions'])).toString();
    const session = tools.session();
    let committed = false;
    try {
        await assertDatabaseQuarantine(session);
        await session.query('BEGIN; SET LOCAL lock_timeout = \'10s\'; SET LOCAL statement_timeout = \'30min\'; SET LOCAL session_replication_role = replica;');
        await session.query(/** @type {Buffer} */ (options.components.get('roles.sql')).toString());
        for (const extension of platform.extensions) {
            ensure(['plpgsql', 'pgcrypto', 'citext', 'pg_trgm', 'unaccent', 'uuid-ossp', 'pg_stat_statements', 'pg_net', 'pg_cron', 'supabase_vault', 'pg_graphql'].includes(extension.name) && ['pg_catalog', 'public', 'extensions', 'net', 'cron', 'vault', 'graphql'].includes(extension.schema), 'EXTENSION_RECOVERY_UNSUPPORTED');
            await session.query(`CREATE EXTENSION IF NOT EXISTS ${identifier(extension.name)} WITH SCHEMA ${identifier(extension.schema)};`);
            const version = await session.query(`SELECT extversion FROM pg_extension WHERE extname=${literal(extension.name)};`);
            ensure(version === extension.version, 'EXTENSION_VERSION_MISMATCH');
        }
        await session.query('REVOKE ALL ON SCHEMA extensions FROM PUBLIC,anon,authenticated,service_role;');
        for (const grant of platform.extensionsPrivileges ?? []) {
            if (['PUBLIC', 'anon', 'authenticated', 'service_role'].includes(grant.grantee)) {
                ensure(['USAGE', 'CREATE'].includes(grant.privilege), 'SCHEMA_PRIVILEGE_UNSUPPORTED');
                await session.query(`GRANT ${grant.privilege} ON SCHEMA extensions TO ${grant.grantee === 'PUBLIC' ? 'PUBLIC' : identifier(grant.grantee)}${grant.grantable ? ' WITH GRANT OPTION' : ''};`);
            }
        }
        const schema = /** @type {Buffer} */ (options.components.get('schema.sql'));
        ensure(!/CREATE EVENT TRIGGER|ALTER SYSTEM|CREATE SUBSCRIPTION/iu.test(schema.toString()), 'UNSAFE_SCHEMA_EFFECTS');
        await session.query(safeApplicationDefaultsSql());
        await session.query(prepareApplicationSchemaRestore(schema.toString(), targetBaseSql));
        await session.query(/** @type {Buffer} */ (options.components.get('managed-schema.sql')).toString());
        ensure(Number(await session.query("select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where a.attgenerated<>'' and n.nspname in('public','private');")) === 0, 'GENERATED_COLUMN_EFFECTS_UNPROVEN');
        await assertDatabaseQuarantine(session);
        await session.query(/** @type {Buffer} */ (options.components.get('auth-recovery.sql')).toString());
        await session.query(/** @type {Buffer} */ (options.components.get('data.sql')).toString());
        await session.query(/** @type {Buffer} */ (options.components.get('migration-history.sql')).toString());
        for (const pub of platform.publications) {
            ensure(pub.name === 'supabase_realtime' && SCHEMAS.includes(pub.schema) && platform.tables.some((/** @type {any} */ t) => t.schema === pub.schema && t.table === pub.table), 'PUBLICATION_RECOVERY_UNSUPPORTED');
            await session.query(`ALTER PUBLICATION supabase_realtime ADD TABLE ${identifier(pub.schema)}.${identifier(pub.table)};`);
        }
        await session.query('SET LOCAL session_replication_role = origin;');
        await validateForeignKeys(session);
        await assertDatabaseQuarantine(session);
        const restored = await inventory(session);
        ensure(canonicalJson(restored) === canonicalJson(platform.tables), 'APPLICATION_INVENTORY_MISMATCH');
        const auth = await authRecovery(session, { ...scope, role: 'source', projectRef: scope.sourceRef });
        auth.sql.fill(0);
        ensure(auth.sha256 === platform.auth.sha256 && auth.count === platform.auth.users && auth.identities === platform.auth.identities, 'AUTH_RECOVERY_MISMATCH');
        const photos = await jsonQuery(session, FINALIZED_PHOTO_SQL);
        ensure(finalizedRowsetSha256(photos) === platform.checkpoint.finalizedRowsetSha256, 'FINALIZED_ROWSET_MISMATCH');
        const migrations = await jsonQuery(session, "select coalesce(json_agg(to_jsonb(m) order by version),'[]'::json) from supabase_migrations.schema_migrations m;");
        ensure(sha256(canonicalJson(migrations)) === platform.migration.sha256 && migrations.length === platform.migration.count, 'MIGRATION_INVENTORY_MISMATCH');
        const sessions = await jsonQuery(session, "select json_build_object('sessions',(select count(*) from auth.sessions),'refreshTokens',(select count(*) from auth.refresh_tokens),'oneTimeTokens',(select count(*) from auth.one_time_tokens),'flowState',(select count(*) from auth.flow_state));");
        ensure(Object.values(sessions).every(value => value === 0), 'SOURCE_AUTH_TOKEN_REPLAYED');
        await session.query("NOTIFY pgrst, 'reload schema'; COMMIT;");
        committed = true;
        const finalSchema = (await tools.run('pg_dump', ['--schema-only', '--schema=public', '--schema=private', '--no-owner', '--no-comments', '--no-publications', '--no-subscriptions'])).toString().replace(/^CREATE SCHEMA public;\n/gmu, '');
        const managed = (await tools.run('pg_dump', ['--schema-only', '--schema=auth', '--schema=storage', '--no-owner', '--no-comments', '--no-publications', '--no-subscriptions'])).toString();
        ensure(sha256(normalizeDump(canonicalSchemaSql(finalSchema))) === platform.schemaSha256 && sha256(normalizeDump(managed)) === platform.managedSchemaSha256, 'RESTORED_SCHEMA_MISMATCH');
        return { projectRef: scope.projectRef, sourceRef: scope.sourceRef, schemaSha256: platform.schemaSha256, managedSchemaSha256: platform.managedSchemaSha256, migration: platform.migration, auth: { users: auth.count, identities: auth.identities, tokensExcluded: true }, tableCount: restored.length, inventorySha256: sha256(canonicalJson(restored)), finalizedRowsetSha256: platform.checkpoint.finalizedRowsetSha256, foreignKeysVerified: true, quarantineVerified: true };
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError(committed ? 'RESTORE_POSTCONDITION_FAILED' : 'LOGICAL_RESTORE_FAILED_ROLLED_BACK');
    }
    finally {
        await session.close();
    }
}
/** Read only the normalized finalized rowset from the exact owned scope. @param {DatabaseOptions} options */
export async function readFinalizedPhotos(options) {
    const tools = createPostgresToolchain(options);
    await tools.verifyVersions();
    const session = tools.session();
    try {
        await session.query('BEGIN READ ONLY;');
        return await jsonQuery(session, FINALIZED_PHOTO_SQL);
    }
    finally {
        await session.close();
    }
}
/** A read-only recovery readback for ambiguous commit outcomes; this never reruns restore SQL. @param {DatabaseOptions & {expectedInventory:Record<string,any>}} options */
export async function verifyLogicalRecovery(options) {
    assertRecoveryScope(options.scope);
    ensure(options.scope.role === 'target', 'RESTORE_CAPABILITY_REQUIRED');
    const expected = options.expectedInventory;
    ensure(expected?.version === 1 && expected.runId === options.scope.runId && expected.sourceRef === options.scope.sourceRef && Array.isArray(expected.tables), 'RECOVERY_INVENTORY_INVALID');
    const tools = createPostgresToolchain(options);
    await tools.verifyVersions();
    const session = tools.session();
    try {
        await session.query('BEGIN READ ONLY;');
        await assertDatabaseQuarantine(session);
        await validateForeignKeys(session);
        const current = await inventory(session);
        ensure(canonicalJson(current) === canonicalJson(expected.tables), 'APPLICATION_INVENTORY_MISMATCH');
        const auth = await authRecovery(session, { ...options.scope, role: 'source', projectRef: options.scope.sourceRef });
        auth.sql.fill(0);
        ensure(auth.sha256 === expected.auth.sha256 && auth.count === expected.auth.users && auth.identities === expected.auth.identities, 'AUTH_RECOVERY_MISMATCH');
        const photos = await jsonQuery(session, FINALIZED_PHOTO_SQL);
        ensure(finalizedRowsetSha256(photos) === expected.checkpoint.finalizedRowsetSha256, 'FINALIZED_ROWSET_MISMATCH');
        const migrations = await jsonQuery(session, "select coalesce(json_agg(to_jsonb(m) order by version),'[]'::json) from supabase_migrations.schema_migrations m;");
        ensure(sha256(canonicalJson(migrations)) === expected.migration.sha256 && migrations.length === expected.migration.count, 'MIGRATION_INVENTORY_MISMATCH');
        const publication = await jsonQuery(session, "select coalesce(json_agg(json_build_object('name',pubname,'schema',schemaname,'table',tablename) order by pubname,schemaname,tablename),'[]'::json) from pg_publication_tables where schemaname in('public','private');");
        ensure(canonicalJson(publication) === canonicalJson(expected.publications), 'PUBLICATION_INVENTORY_MISMATCH');
        const grants = await jsonQuery(session, "select coalesce(json_agg(json_build_object('grantee',coalesce(r.rolname,'PUBLIC'),'privilege',a.privilege_type,'grantable',a.is_grantable) order by coalesce(r.rolname,'PUBLIC'),a.privilege_type),'[]'::json) from pg_namespace n cross join lateral aclexplode(n.nspacl) a left join pg_roles r on r.oid=a.grantee where n.nspname='extensions';");
        ensure(canonicalJson(grants) === canonicalJson(expected.extensionsPrivileges), 'SCHEMA_PRIVILEGE_MISMATCH');
        const schema = (await tools.run('pg_dump', ['--schema-only', '--schema=public', '--schema=private', '--no-owner', '--no-comments', '--no-publications', '--no-subscriptions'])).toString().replace(/^CREATE SCHEMA public;\n/gmu, '');
        const managed = (await tools.run('pg_dump', ['--schema-only', '--schema=auth', '--schema=storage', '--no-owner', '--no-comments', '--no-publications', '--no-subscriptions'])).toString();
        ensure(sha256(normalizeDump(canonicalSchemaSql(schema))) === expected.schemaSha256 && sha256(normalizeDump(managed)) === expected.managedSchemaSha256, 'RESTORED_SCHEMA_MISMATCH');
        return { projectRef: options.scope.projectRef, sourceRef: options.scope.sourceRef, schemaSha256: expected.schemaSha256, managedSchemaSha256: expected.managedSchemaSha256, migration: expected.migration, auth: { users: auth.count, identities: auth.identities }, tableCount: current.length, inventorySha256: sha256(canonicalJson(current)), finalizedRowsetSha256: expected.checkpoint.finalizedRowsetSha256, foreignKeysVerified: true, quarantineVerified: true };
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('LOGICAL_READBACK_FAILED');
    }
    finally {
        await session.close();
    }
}
