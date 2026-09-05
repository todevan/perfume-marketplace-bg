import { constants } from 'node:fs';
import { open, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { assertPrivatePath, ensure, OperationsError, readPrivateManifest, writePrivateManifest } from './manifest.mjs';
import { readPrivateBytes } from './execution.mjs';
import { canonicalJson } from './recovery-set.mjs';
import { validateManagedBaseline, validateDatabaseConnection } from './logical-recovery.mjs';
import { initializeSyntheticSource, createSyntheticSentinel, verifySyntheticSource } from './synthetic-source.mjs';
const HASH = /^[a-f0-9]{64}$/u;
/** @param {unknown} value */
const digest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
/** @param {string} value */
const fingerprint = value => createHash('sha256').update(value).digest();
const settingsSchema = z.strictObject({ schemaVersion: z.literal(1), operation: z.literal('seed-source'), providerToken: z.string().min(10).max(4096), source: z.strictObject({ apiUrl: z.string().url(), serviceKey: z.string().min(10).max(4096) }), connection: z.strictObject({ host: z.string(), port: z.literal(5432), database: z.literal('postgres'), user: z.string(), password: z.string().min(1).max(1024), sslmode: z.literal('verify-full'), sslRootCert: z.literal('system').optional() }), toolchain: z.strictObject({ mode: z.literal('container') }), privateDirectory: z.string() });
/** @typedef {z.infer<typeof settingsSchema>} SourceSettings */
/** @typedef {{manifestPath:string,settingsPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,now?:string,clock?:()=>string}} SourceExecutionOptions */
/** @param {string} path @param {unknown} value @param {string} root */
async function writeEvidence(path, value, root) { await assertPrivatePath(path, root); const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); try {
    await handle.writeFile(canonicalJson(value));
    await handle.sync();
}
finally {
    await handle.close();
} return digest(value); }
/** Exact read-only ownership/key/plan check before any source mutation. @param {{manifest:import('./manifest.mjs').OperationsManifest,settings:SourceSettings,fetchImpl?:typeof fetch}} options */
export async function readSourceSeedPreflight({ manifest, settings, fetchImpl = fetch }) {
    const source = manifest.source;
    ensure(source && !manifest.preservedRefs.includes(source.ref), 'PRESERVED_PROJECT_FORBIDDEN');
    /** @param {string} path */
    async function get(path) { try {
        const response = await fetchImpl(`https://api.supabase.com/v1/${path}`, { headers: { authorization: `Bearer ${settings.providerToken}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
        ensure(response.ok && response.body, 'SOURCE_PREFLIGHT_FAILED');
        const reader = response.body.getReader();
        let size = 0;
        const chunks = [];
        try {
            for (;;) {
                const p = await reader.read();
                if (p.done)
                    break;
                size += p.value.length;
                ensure(size <= 2097152, 'SOURCE_PREFLIGHT_RESPONSE_LIMIT');
                chunks.push(Buffer.from(p.value));
            }
        }
        finally {
            await reader.cancel();
        }
        return JSON.parse(Buffer.concat(chunks).toString());
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('SOURCE_PREFLIGHT_FAILED');
    } }
    const project = await get(`projects/${source.ref}`), organization = await get(`organizations/${source.organizationId}`), keys = await get(`projects/${source.ref}/api-keys?reveal=true`);
    ensure(project.ref === source.ref && project.organization_slug === source.organizationId && project.region === source.region && project.status === 'ACTIVE_HEALTHY' && String(project.database?.version).startsWith(`${source.postgresVersion}.`) && organization.id === source.organizationId && organization.plan === 'free', 'SOURCE_PREFLIGHT_IDENTITY_MISMATCH');
    ensure(Array.isArray(keys) && keys.some(key => key.name === 'service_role' && typeof key.api_key === 'string' && timingSafeEqual(fingerprint(key.api_key), fingerprint(settings.source.serviceKey))), 'SOURCE_STORAGE_CREDENTIAL_MISMATCH');
    const auth = await get(`projects/${source.ref}/config/auth`);
    ensure(typeof auth.disable_signup === 'boolean', 'SOURCE_AUTH_CONFIG_UNPROVEN');
    return { projectRef: source.ref, signupDisabled: auth.disable_signup === true, evidenceSha256: digest({ projectRef: source.ref, organizationId: source.organizationId, region: source.region, free: true, serviceKeyVerified: true, signupDisabled: auth.disable_signup === true }) };
}
/** @typedef {{preflight?:typeof readSourceSeedPreflight,initialize?:typeof initializeSyntheticSource,verify?:typeof verifySyntheticSource,fetchImpl?:typeof fetch}} SourceDependencies */
/** Seed one fresh source using the existing transaction lock/state; ambiguous pending work never retries mutations. @param {SourceExecutionOptions} options @param {SourceDependencies} [dependencies] */
export async function executeSeedSource(options, dependencies = {}) {
    const { manifestPath, repositoryRoot, candidate } = options;
    const clock = options.clock ?? (() => options.now ?? new Date().toISOString());
    await assertPrivatePath(manifestPath, repositoryRoot);
    let lock;
    try {
        lock = await open(`${manifestPath}.lock`, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    }
    catch {
        throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');
    }
    try {
        const manifest = await readPrivateManifest(manifestPath, { repositoryRoot, candidate, now: clock() });
        ensure(manifest.state === 'source_read_back' && manifest.allowedActions.includes('seed-source') && manifest.source && manifest.sourceProvenance && manifest.humanBoundary === null && manifest.terminal === null && !manifest.backupVerification, 'SOURCE_SEED_STATE_INVALID');
        const source = manifest.source;
        const owned = manifest.cleanup.resources.find(resource => resource.provider === 'supabase' && resource.id === source.ref && resource.runId === manifest.runId && resource.disposition === 'disposable' && resource.absentAt === null);
        ensure(owned && !manifest.preservedRefs.includes(source.ref), 'SOURCE_OWNERSHIP_UNPROVEN');
        ensure(!manifest.pending || (manifest.pending.step === 'seed-source' && manifest.pending.resourceId === digest({ kind: 'source-disable-signup', resource: source.ref })), 'SOURCE_MUTATION_READBACK_REQUIRED');
        const parsed = settingsSchema.safeParse(JSON.parse((await readPrivateBytes(options.settingsPath, repositoryRoot)).toString()));
        ensure(parsed.success, 'PRIVATE_SETTINGS_INVALID');
        const settings = parsed.data;
        ensure(settings.source.apiUrl === source.url, 'SOURCE_IDENTITY_MISMATCH');
        await assertPrivatePath(join(settings.privateDirectory, 'boundary'), repositoryRoot);
        const directory = await lstat(settings.privateDirectory);
        ensure(directory.isDirectory() && !directory.isSymbolicLink() && (directory.mode & 0o777) === 0o700, 'PRIVATE_DIRECTORY_REQUIRED');
        const database = { scope: { mode: /** @type {const} */ ('hosted'), role: /** @type {const} */ ('source'), runId: manifest.runId, projectRef: source.ref, sourceRef: source.ref, preservedRefs: manifest.preservedRefs, createdResourceEvidenceSha256: owned.evidenceSha256, apiUrl: source.url }, connection: settings.connection, toolchain: settings.toolchain };
        validateDatabaseConnection(database.scope, database.connection);
        const saved = () => writePrivateManifest(manifestPath, manifest, { repositoryRoot, candidate, now: clock(), replace: true });
        /** @type {import('./synthetic-source.mjs').FixtureIntent|null} */ let activeIntent = null;
        /** @param {import('./synthetic-source.mjs').FixtureIntent} intent */
        async function persistIntent(intent) { ensure(!manifest.pending && HASH.test(intent.sha256), 'SOURCE_MUTATION_READBACK_REQUIRED'); const key = digest({ kind: intent.kind, resource: intent.resource }); ensure(!manifest.attempts[`seed-source:${key}`], 'ATTEMPT_LIMIT'); const operationId = randomUUID(); const evidence = { schemaVersion: 1, runId: manifest.runId, projectRef: source.ref, operationId, startedAt: clock(), intent }; const hash = await writeEvidence(join(settings.privateDirectory, `${operationId}-intent.json`), evidence, repositoryRoot); manifest.pending = { step: 'seed-source', operationId, startedAt: clock(), resourceId: key, priorStateSha256: hash }; manifest.attempts[`seed-source:${key}`] = 1; activeIntent = intent; await saved(); }
        /** @param {import('./synthetic-source.mjs').FixtureIntent} intent */
        async function readbackVerified(intent) { const pending = manifest.pending; ensure(pending?.step === 'seed-source' && activeIntent && activeIntent.kind === intent.kind && activeIntent.sha256 === intent.sha256, 'SOURCE_READBACK_PROVENANCE_REQUIRED'); ensure(activeIntent.resource === intent.resource || (intent.kind === 'source-auth-user' && /^synthetic-user-[01]$/u.test(activeIntent.resource) && /^[a-f0-9-]{36}$/u.test(intent.resource)), 'SOURCE_READBACK_IDENTITY_MISMATCH'); const hash = await writeEvidence(join(settings.privateDirectory, `${pending.operationId}-readback.json`), { schemaVersion: 1, runId: manifest.runId, projectRef: source.ref, operationId: pending.operationId, intentSha256: pending.priorStateSha256, completedAt: clock(), readback: intent }, repositoryRoot); manifest.history.push({ step: 'seed-source', operationId: pending.operationId, completedAt: clock(), resourceId: digest({ kind: intent.kind, resource: intent.resource }), evidenceSha256: hash }); manifest.pending = null; activeIntent = null; await saved(); }
        ensure(!manifest.history.some(entry => entry.step === 'seed-source' && entry.resourceId === null), 'SOURCE_ALREADY_INITIALIZED');
        for (const name of ['source-fixture.json', 'managed-baseline.json']) {
            try {
                await lstat(join(settings.privateDirectory, name));
                throw new OperationsError('SOURCE_PRIVATE_OUTPUT_EXISTS');
            }
            catch (error) {
                if ( /** @type {NodeJS.ErrnoException} */(error).code !== 'ENOENT')
                    throw error;
            }
        }
        if (manifest.pending) {
            const bytes = await readPrivateBytes(join(settings.privateDirectory, `${manifest.pending.operationId}-intent.json`), repositoryRoot);
            ensure(createHash('sha256').update(bytes).digest('hex') === manifest.pending.priorStateSha256, 'SOURCE_READBACK_PROVENANCE_REQUIRED');
            const evidence = JSON.parse(bytes.toString());
            ensure(evidence.runId === manifest.runId && evidence.projectRef === source.ref && evidence.operationId === manifest.pending.operationId && evidence.intent?.kind === 'source-disable-signup' && evidence.intent.resource === source.ref, 'SOURCE_READBACK_PROVENANCE_REQUIRED');
            activeIntent = evidence.intent;
        }
        const preflight = await (dependencies.preflight ?? readSourceSeedPreflight)({ manifest, settings, fetchImpl: dependencies.fetchImpl });
        ensure(preflight && preflight.projectRef === source.ref, 'SOURCE_PREFLIGHT_IDENTITY_MISMATCH');
        if (manifest.pending) {
            ensure(preflight.signupDisabled === true && activeIntent, 'SOURCE_SIGNUP_READBACK_FAILED');
            await readbackVerified(activeIntent);
        }
        if (!preflight.signupDisabled) {
            const intent = { kind: 'source-disable-signup', resource: source.ref, sha256: digest({ disable_signup: true, priorDisabled: false }) };
            await persistIntent(intent);
            try {
                const response = await (dependencies.fetchImpl ?? fetch)(`https://api.supabase.com/v1/projects/${source.ref}/config/auth`, { method: 'PATCH', headers: { authorization: `Bearer ${settings.providerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ disable_signup: true }), redirect: 'error', signal: AbortSignal.timeout(15000) });
                await response.body?.cancel();
                ensure(response.ok, 'SOURCE_SIGNUP_MUTATION_UNCERTAIN');
            }
            catch {
                throw new OperationsError('SOURCE_SIGNUP_MUTATION_UNCERTAIN');
            }
            const observed = await (dependencies.preflight ?? readSourceSeedPreflight)({ manifest, settings, fetchImpl: dependencies.fetchImpl });
            ensure(observed.signupDisabled === true, 'SOURCE_SIGNUP_READBACK_FAILED');
            await readbackVerified(intent);
        }
        const initialized = await (dependencies.initialize ?? initializeSyntheticSource)({ ...database, repositoryRoot, secretKey: settings.source.serviceKey, sentinelBytes: createSyntheticSentinel(), persistIntent, readbackVerified, fetchImpl: dependencies.fetchImpl });
        ensure(!manifest.pending, 'SOURCE_MUTATION_READBACK_REQUIRED');
        const baseline = validateManagedBaseline(initialized.managedBaseline);
        const fixture = { schemaVersion: 1, runId: manifest.runId, projectRef: source.ref, candidate, privateAuthFixtures: initialized.privateAuthFixtures, fixture: initialized.fixture, provenance: initialized.provenance, managedBaselineSha256: baseline.schemaSha256 };
        const fixtureManifestSha256 = await writeEvidence(join(settings.privateDirectory, 'source-fixture.json'), fixture, repositoryRoot);
        const baselineFileSha256 = await writeEvidence(join(settings.privateDirectory, 'managed-baseline.json'), baseline, repositoryRoot);
        const summary = { schemaVersion: 1, runId: manifest.runId, projectRef: source.ref, candidate, fixtureManifestSha256, baselineFileSha256, managedBaselineSha256: baseline.schemaSha256, inventorySha256: digest(initialized.provenance), completedAt: clock() };
        const summaryHash = await writeEvidence(join(settings.privateDirectory, 'source-seed-evidence.json'), summary, repositoryRoot);
        manifest.history.push({ step: 'seed-source', operationId: randomUUID(), completedAt: clock(), resourceId: null, evidenceSha256: summaryHash });
        await saved();
        return { status: 'SYNTHETIC_SOURCE_SEEDED_RELEASE_VERIFICATION_PENDING', projectRef: source.ref, fixtureManifestSha256, inventorySha256: summary.inventorySha256, managedBaselineSha256: baseline.schemaSha256 };
    }
    catch (error) {
        if (error instanceof OperationsError)
            throw error;
        throw new OperationsError('SOURCE_INITIALIZATION_OUTCOME_REQUIRES_READBACK');
    }
    finally {
        await lock.close();
        await unlink(`${manifestPath}.lock`);
    }
}
/** Read generated, hash-bound private source evidence; callers must separately compare a fresh verifySyntheticSource result and release binding. @param {{manifest:import('./manifest.mjs').OperationsManifest,privateDirectory:string,repositoryRoot:string}} options */
export async function readSeededSourceEvidence({ manifest, privateDirectory, repositoryRoot }) { const completed = manifest.history.find(entry => entry.step === 'seed-source' && entry.resourceId === null); ensure(completed && manifest.source, 'SOURCE_SEED_EVIDENCE_REQUIRED'); const summaryBytes = await readPrivateBytes(join(privateDirectory, 'source-seed-evidence.json'), repositoryRoot); ensure(createHash('sha256').update(summaryBytes).digest('hex') === completed.evidenceSha256, 'SOURCE_SEED_EVIDENCE_MISMATCH'); const summary = JSON.parse(summaryBytes.toString()); ensure(summary.runId === manifest.runId && summary.projectRef === manifest.source.ref && canonicalJson(summary.candidate) === canonicalJson(manifest.candidate), 'SOURCE_SEED_EVIDENCE_MISMATCH'); const fixtureBytes = await readPrivateBytes(join(privateDirectory, 'source-fixture.json'), repositoryRoot); const baselineBytes = await readPrivateBytes(join(privateDirectory, 'managed-baseline.json'), repositoryRoot, 8388608); ensure(createHash('sha256').update(fixtureBytes).digest('hex') === summary.fixtureManifestSha256 && createHash('sha256').update(baselineBytes).digest('hex') === summary.baselineFileSha256, 'SOURCE_SEED_EVIDENCE_MISMATCH'); return { summary, fixture: JSON.parse(fixtureBytes.toString()), managedBaseline: validateManagedBaseline(JSON.parse(baselineBytes.toString())) }; }
