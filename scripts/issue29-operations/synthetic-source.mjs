import { createClient } from '@supabase/supabase-js';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { assertRecoveryScope, captureManagedBaseline, createPostgresToolchain, exportLogicalRecovery } from './logical-recovery.mjs';
import { exportFinalizedStorage } from './storage-adapter.mjs';
import { canonicalJson } from './recovery-set.mjs';
import { ensure, OperationsError } from './manifest.mjs';
import { sha256 } from '../storage-backup-crypto.mjs';
/** @typedef {import('./logical-recovery.mjs').DatabaseOptions} DatabaseOptions */
/** @typedef {{kind:string,resource:string,sha256:string}} FixtureIntent */
/** A generated solid-color 10x10 WebP; no user-provided image is accepted as synthetic evidence. */
export function createSyntheticSentinel() { return Buffer.from('UklGRjQAAABXRUJQVlA4ICgAAACQAQCdASoKAAoAAgA0JaACdLoAA5gA/ofX/wQW1Hphx4fuibKJpMAA', 'base64'); }
/** @param {string} value */
function literal(value) { return `'${value.replaceAll("'", "''")}'`; }
/** Source-controlled migration inventory, never arbitrary operator-supplied SQL. @param {string} repositoryRoot */
export async function readRecoveryMigrations(repositoryRoot) {
    const directory = join(repositoryRoot, 'supabase', 'migrations');
    ensure((await lstat(directory)).isDirectory() && !(await lstat(directory)).isSymbolicLink(), 'MIGRATION_DIRECTORY_INVALID');
    const names = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
    ensure(names.length > 0, 'MIGRATION_DISCOVERY_ZERO');
    return Promise.all(names.map(async (name) => {
        const match = /^(\d{12,14})_([a-z0-9_]+)\.sql$/u.exec(name);
        ensure(match, 'MIGRATION_FILENAME_INVALID');
        const path = join(directory, name);
        const info = await lstat(path);
        ensure(info.isFile() && !info.isSymbolicLink() && info.size < 8 * 1024 * 1024, 'MIGRATION_FILE_UNSAFE');
        const originalSql = await readFile(path, 'utf8');
        let sql = originalSql;
        if (/^begin;\s/iu.test(sql.trim()) && /commit;$/iu.test(sql.trim()))
            sql = sql.trim().replace(/^begin;/iu, '').replace(/commit;$/iu, '');
        ensure(!/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;|^\\|CREATE DATABASE|ALTER SYSTEM/gimu.test(sql), 'MIGRATION_TRANSACTION_UNSUPPORTED');
        return { version: match[1], name: match[2], sql, sha256: sha256(originalSql) };
    }));
}
/** Bootstrap only a fresh manifest-owned synthetic source. The returned credential fields are private and must never be published. @param {DatabaseOptions & {repositoryRoot:string,secretKey:string,sentinelBytes:Buffer,persistIntent:(intent:FixtureIntent)=>Promise<void>,readbackVerified:(intent:FixtureIntent)=>Promise<void>,fetchImpl?:typeof fetch}} options */
export async function initializeSyntheticSource(options) {
    assertRecoveryScope(options.scope);
    ensure(options.scope.role === 'source', 'SOURCE_CAPABILITY_REQUIRED');
    ensure(typeof options.persistIntent === 'function' && typeof options.readbackVerified === 'function', 'SOURCE_INTENT_REQUIRED');
    ensure(Buffer.isBuffer(options.sentinelBytes) && options.sentinelBytes.equals(createSyntheticSentinel()), 'SYNTHETIC_SENTINEL_INVALID');
    const managedBaseline = await captureManagedBaseline(options);
    const migrations = await readRecoveryMigrations(options.repositoryRoot);
    const tools = createPostgresToolchain(options);
    const session = tools.session();
    const migrationIntent = { kind: 'source-migrations', resource: options.scope.projectRef, sha256: sha256(canonicalJson(migrations.map(({ version, sha256 }) => ({ version, sha256 })))) };
    try {
        await options.persistIntent(migrationIntent);
        await session.query('BEGIN; SET LOCAL statement_timeout=\'10min\'; CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text primary key,statements text[],name text);');
        for (const migration of migrations) {
            await session.query(migration.sql);
            await session.query(`INSERT INTO supabase_migrations.schema_migrations(version,statements,name) VALUES(${literal(migration.version)},ARRAY[${literal(migration.sql)}],${literal(migration.name)});`);
        }
        await session.query("SELECT cron.unschedule(jobid) FROM cron.job; COMMIT;");
        const count = Number(await session.query('SELECT count(*) FROM supabase_migrations.schema_migrations;'));
        ensure(count === migrations.length, 'SOURCE_MIGRATION_READBACK_FAILED');
        await options.readbackVerified(migrationIntent);
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('SOURCE_MIGRATION_OUTCOME_UNCERTAIN');
    }
    finally {
        await session.close();
    }
    const client = createClient(options.scope.apiUrl, options.secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (url, init) => (options.fetchImpl ?? fetch)(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) }) } });
    const password = randomBytes(32).toString('base64url');
    const users = [];
    try {
        for (let i = 0; i < 2; i++) {
            const alias = `synthetic-user-${i}`;
            const email = `issue29-${options.scope.runId}-${i}@example.invalid`;
            const intent = { kind: 'source-auth-user', resource: alias, sha256: sha256(canonicalJson({ runId: options.scope.runId, alias })) };
            await options.persistIntent(intent);
            const result = await client.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { issue29_run_id: options.scope.runId }, user_metadata: { username: `i29_${options.scope.runId.slice(0, 8)}_${i}` } });
            ensure(!result.error && result.data.user, 'SOURCE_AUTH_MUTATION_UNCERTAIN');
            const id = result.data.user.id;
            const observed = await client.auth.admin.getUserById(id);
            ensure(!observed.error && observed.data.user?.email === email && observed.data.user.app_metadata.issue29_run_id === options.scope.runId, 'SOURCE_AUTH_READBACK_FAILED');
            users.push({ id, email, alias });
            await options.readbackVerified({ ...intent, resource: id });
        }
        const listingId = randomUUID(), photoId = randomUUID(), brandId = randomUUID(), uploadId = randomUUID();
        const objectPath = `${users[0].id}/${listingId}/${photoId}.webp`, objectSha256 = sha256(options.sentinelBytes);
        const intent = { kind: 'source-application-fixture', resource: listingId, sha256: sha256(canonicalJson({ listingId, photoId, brandId, uploadId, objectSha256 })) };
        const db = tools.session();
        try {
            await options.persistIntent(intent);
            await db.query(`BEGIN;SET LOCAL session_replication_role=replica;
UPDATE public.profiles SET city='Sofia' WHERE id IN(${literal(users[0].id)},${literal(users[1].id)});
INSERT INTO public.brands(id,canonical_name,slug,status,normalized_key,created_by) VALUES('${brandId}','Recovery Fixture','recovery-fixture','canonical','recovery fixture','${users[0].id}');
INSERT INTO public.listings(id,seller_id,kind,deal_mode,product_format,audience,brand_id,fragrance_name,concentration,title,description,city,bottle_volume_ml,remaining_ml,is_sealed,price_minor,status,slug) VALUES('${listingId}','${users[0].id}','offer','sale','retail_bottle','unisex','${brandId}','Recovery Fragrance','EDP','Recovery listing','Synthetic recovery fixture','Sofia',100,90,false,10000,'draft','recovery-listing');
INSERT INTO public.upload_quarantine(id,uploader_id,listing_id,requested_role,quarantine_path,declared_mime_type,declared_byte_size,status,processor_request_id,final_storage_path,claimed_at,finalized_at) VALUES('${uploadId}','${users[0].id}','${listingId}','product_full','${users[0].id}/${listingId}/${uploadId}/source.jpg','image/jpeg',${options.sentinelBytes.length},'finalized','issue29-synthetic-photo','${objectPath}',now(),now());
INSERT INTO public.listing_photos(id,listing_id,storage_path,role,content_hash,mime_type,byte_size,width_px,height_px,sanitized_at,source_upload_id) VALUES('${photoId}','${listingId}','${objectPath}','product_full','${objectSha256}','image/webp',${options.sentinelBytes.length},10,10,now(),'${uploadId}');COMMIT;`);
            ensure((await db.query(`SELECT content_hash FROM public.listing_photos WHERE id='${photoId}';`)) === objectSha256, 'SOURCE_FIXTURE_READBACK_FAILED');
            await options.readbackVerified(intent);
        }
        finally {
            await db.close();
        }
        const objectIntent = { kind: 'source-storage-object', resource: objectPath, sha256: objectSha256 };
        await options.persistIntent(objectIntent);
        const upload = await client.storage.from('listing-images').upload(objectPath, options.sentinelBytes, { contentType: 'image/webp', upsert: false });
        ensure(!upload.error, 'SOURCE_STORAGE_MUTATION_UNCERTAIN');
        const object = await client.storage.from('listing-images').download(objectPath);
        ensure(!object.error && object.data && sha256(Buffer.from(await object.data.arrayBuffer())) === objectSha256, 'SOURCE_STORAGE_READBACK_FAILED');
        await options.readbackVerified(objectIntent);
        const provenance = await verifySyntheticSource({ ...options, managedBaseline });
        return { managedBaseline, provenance, privateAuthFixtures: { users, password }, fixture: { listingId, photoId, brandId, uploadId, objectPath, objectSha256 } };
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('SOURCE_FIXTURE_OUTCOME_UNCERTAIN');
    }
}
/** Full DB/Auth/object enumeration is generated from current readback, not a synthetic classification label. @param {DatabaseOptions & {managedBaseline:import('./logical-recovery.mjs').ManagedBaseline,secretKey:string,fetchImpl?:typeof fetch}} options */
export async function verifySyntheticSource(options) {
    const exported = await exportLogicalRecovery({ ...options, onSnapshot: ({ photos, checkpoint }) => exportFinalizedStorage({ scope: options.scope, secretKey: options.secretKey, photos, expectedRowsetSha256: checkpoint.finalizedRowsetSha256, fetchImpl: options.fetchImpl }) });
    const storage = /** @type {Awaited<ReturnType<typeof exportFinalizedStorage>>} */ (exported.storage);
    try {
        return { runId: options.scope.runId, projectRef: options.scope.projectRef, createdResourceEvidenceSha256: options.scope.createdResourceEvidenceSha256, classification: 'synthetic-owner-controlled', authUsers: exported.inventory.auth.users, authIdentities: exported.inventory.auth.identities, authInventorySha256: exported.inventory.auth.sha256, applicationInventorySha256: sha256(canonicalJson(exported.inventory.tables)), applicationTableCount: exported.inventory.tables.length, migration: exported.migration, managedBaselineSha256: exported.inventory.managedBaselineSha256, finalizedRowsetSha256: exported.checkpointBefore.finalizedRowsetSha256, storageObjectCount: storage.objectCount, storagePathTreeSha256: storage.pathTreeSha256, storageBytes: storage.totalBytes };
    }
    finally {
        for (const bytes of exported.components.values())
            bytes.fill(0);
        for (const bytes of storage.components.values())
            bytes.fill(0);
    }
}
