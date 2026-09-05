import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createIssue29WorkerConfig } from '../../scripts/issue29-operations/worker-adapter.mjs';
import { validateWranglerConfig as validateIssue22 } from '../../scripts/issue22-hosted/candidate.mjs';
import { manifestFixture } from '../fixtures/issue29-operations';
const now = '2026-09-05T12:00:00.000Z';
const template = JSON.parse(readFileSync('scripts/issue22-hosted/wrangler.issue22.template.json', 'utf8'));
function fixture() { const manifest = structuredClone(manifestFixture()); manifest.target = null; manifest.candidate = { ...manifest.candidate, deploymentId: 'pending' }; manifest.state = 'source_read_back'; manifest.allowedActions.push('deploy-worker'); manifest.cleanup.resources.push({ provider: 'supabase', id: manifest.source!.ref, runId: manifest.runId, createdAt: now, evidenceSha256: 'd'.repeat(64), disposition: 'disposable', absentAt: null }); const settings = { accountId: 'c'.repeat(32), subdomain: 'owner', purpose: 'source' as 'source' | 'target', publishableKey: 'sb_publishable_fixture', turnstileSiteKey: '0x4AAAAAARealSyntheticScopeFixture', operations: { migrationSha256: 'd'.repeat(64), schemaSha256: 'e'.repeat(64), sentinelSha256: 'f'.repeat(64), canaryExpectedUtc: '03:17' } }; return { manifest, settings }; }
describe('Issue29 exact disposable Worker configuration', () => {
    it('adds functional image processing without weakening the original issue22 template contract', () => {
        const { manifest, settings } = fixture();
        const config = createIssue29WorkerConfig({ template, manifest, settings, repositoryRoot: process.cwd(), now });
        expect(config.name).toBe(`issue29-${manifest.runId}`);
        expect(config.images).toEqual({ binding: 'IMAGES' });
        expect(config.vars).toMatchObject({ APP_ENV: 'development', PUBLIC_SUPABASE_URL: manifest.source!.url, IMAGE_PROCESSOR_MODE: 'cloudflare-images', PRIVATE_BETA_REQUIRE_STAFF_MFA: 'true', ISSUE29_RUN_ID: manifest.runId, ISSUE29_CANDIDATE_TREE: manifest.candidate.tree, RELEASE_COMMIT_SHA: manifest.candidate.sha });
        expect(config.routes).toEqual([]);
        expect(config.triggers).toEqual({ crons: [] });
        expect(() => validateIssue22(config)).toThrow('Issue #22 Wrangler config is not safe');
        expect(template.vars.IMAGE_PROCESSOR_MODE).toBe('disabled');
        expect(template.images).toBeUndefined();
    });
});
it('requires exact account and free entitlements before the initial Worker absence check', async () => {
    const { manifest, settings } = fixture();
    const { createIssue29WorkerAdapter } = await import('../../scripts/issue29-operations/worker-adapter.mjs');
    let calls = 0;
    const adapter = createIssue29WorkerAdapter({ settings, readToken: 'r'.repeat(40), deployToken: 'd'.repeat(40), cleanupToken: 'c'.repeat(40), deployCapabilityId: manifest.capabilityIds['monitoring-config'], cleanupCapabilityId: manifest.capabilityIds.cleanup, repositoryRoot: process.cwd(), privateDirectory: '/tmp/not-used-by-readonly' }, { now: () => now, fetchImpl: async (url: string | URL | Request) => { calls++; return Response.json({ success: true, result: String(url).endsWith('/subscriptions') ? [{ rate_plan: { id: 'workers_paid' }, price: 5 }] : { id: settings.accountId } }); } });
    await expect(adapter.inspect({ manifest, operationId: manifest.runId })).rejects.toThrow('WORKER_ZERO_COST_UNPROVEN');
    expect(calls).toBe(2);
});
it.each(['preserved', 'unowned', 'production', 'target-not-restored', 'test-turnstile', 'billing', 'extra-var'])('rejects %s configuration instead of generating a weaker candidate', kind => {
    const f = fixture();
    const base = structuredClone(template);
    if (kind === 'preserved')
        f.manifest.preservedRefs.push(f.manifest.source!.ref);
    if (kind === 'unowned')
        f.manifest.cleanup.resources = [];
    if (kind === 'production')
        f.manifest.source!.environment = 'production';
    if (kind === 'target-not-restored') {
        f.settings.purpose = 'target';
        f.manifest.target = manifestFixture().target;
    }
    if (kind === 'test-turnstile')
        f.settings.turnstileSiteKey = '1x00000000000000000000AA';
    if (kind === 'billing')
        base.vars.FEATURE_BILLING_ENABLED = 'true';
    if (kind === 'extra-var')
        base.vars.RESEND_API_KEY = 'private-unapproved-value';
    expect(() => createIssue29WorkerConfig({ ...f, template: base, repositoryRoot: process.cwd(), now })).toThrow('Issue #29:');
});
function cloudflareFixture(f: ReturnType<typeof fixture>, change?: (url: string, value: any) => any) {
    const calls: {
        url: string;
        method: string;
    }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
        const u = new URL(String(url));
        calls.push({ url: u.pathname, method: init?.method ?? 'GET' });
        let result: any;
        if (u.pathname.endsWith(`/accounts/${f.settings.accountId}`))
            result = { id: f.settings.accountId };
        else if (u.pathname.endsWith('/subscriptions'))
            result = [];
        else if (u.pathname.endsWith('/workers/subdomain'))
            result = { subdomain: f.settings.subdomain };
        else
            result = [];
        let body: any = { success: true, result };
        if (change)
            body = change(u.pathname, body);
        return Response.json(body);
    };
    return { calls, fetchImpl };
}
it('checks account, subscriptions, domains and all zones before proving exact initial absence', async () => {
    const f = fixture(), provider = cloudflareFixture(f);
    const { createIssue29WorkerAdapter } = await import('../../scripts/issue29-operations/worker-adapter.mjs');
    const adapter = createIssue29WorkerAdapter({ ...f, readToken: 'r'.repeat(40), deployToken: 'd'.repeat(40), cleanupToken: 'c'.repeat(40), deployCapabilityId: f.manifest.capabilityIds['monitoring-config'], cleanupCapabilityId: f.manifest.capabilityIds.cleanup, repositoryRoot: process.cwd(), privateDirectory: '/tmp/read-only' }, { fetchImpl: provider.fetchImpl, now: () => now });
    expect(await adapter.inspect({ manifest: f.manifest, operationId: f.manifest.runId })).toMatchObject({ status: 'absent', workerName: `issue29-${f.manifest.runId}` });
    expect(provider.calls).toHaveLength(6);
    expect(provider.calls.every(c => c.method === 'GET')).toBe(true);
    await expect(adapter.mutate({ manifest: f.manifest, operationId: f.manifest.runId })).rejects.toThrow('WORKER_DEPLOY_INTENT_REQUIRED');
    f.manifest.pending = { step: 'deploy-worker', operationId: f.manifest.runId, startedAt: now, resourceId: `issue29-${f.manifest.runId}`, priorStateSha256: null };
    const resumed = createIssue29WorkerAdapter({ ...f, readToken: 'r'.repeat(40), deployToken: 'd'.repeat(40), cleanupToken: 'c'.repeat(40), deployCapabilityId: f.manifest.capabilityIds['monitoring-config'], cleanupCapabilityId: f.manifest.capabilityIds.cleanup, repositoryRoot: process.cwd(), privateDirectory: '/tmp/read-only' }, { fetchImpl: provider.fetchImpl, now: () => now });
    await expect(resumed.inspect({ manifest: f.manifest, operationId: f.manifest.runId })).rejects.toThrow('PENDING_OPERATION_REQUIRES_READBACK');
    await expect(resumed.mutate({ manifest: f.manifest, operationId: f.manifest.runId })).rejects.toThrow('WORKER_PRE_MUTATION_INSPECTION_REQUIRED');
});
async function preparedFixture() {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { createHash } = await import('node:crypto');
    const { canonicalJson } = await import('../../scripts/issue29-operations/recovery-set.mjs');
    const { hashIssue29WorkerBuild, createIssue29WorkerAdapter } = await import('../../scripts/issue29-operations/worker-adapter.mjs');
    const directory = await mkdtemp('/tmp/issue29-worker-test-');
    const repositoryRoot = join(directory, 'repository'), privateDirectory = join(directory, 'private');
    await mkdir(join(repositoryRoot, '.svelte-kit/cloudflare'), { recursive: true, mode: 0o700 });
    await mkdir(join(repositoryRoot, 'scripts/issue22-hosted'), { recursive: true, mode: 0o700 });
    await mkdir(privateDirectory, { mode: 0o700 });
    await writeFile(join(repositoryRoot, 'scripts/issue22-hosted/wrangler.issue22.template.json'), JSON.stringify(template));
    await writeFile(join(repositoryRoot, '.svelte-kit/cloudflare/_worker.js'), 'export default {fetch(){return new Response("fixture")}}');
    await writeFile(join(repositoryRoot, '.svelte-kit/cloudflare/index.html'), 'synthetic fixture');
    const f = fixture();
    const config = createIssue29WorkerConfig({ ...f, template, repositoryRoot, now });
    const secrets = { SUPABASE_SECRET_KEY: 'fixture-source-secret-'.repeat(3), TURNSTILE_SECRET_KEY: '0x4' + 'f'.repeat(40), OPERATIONS_MONITOR_TOKEN: 'm'.repeat(43) };
    const hash = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex');
    await writeFile(join(privateDirectory, 'worker-source.json'), canonicalJson(config), { mode: 0o600 });
    await writeFile(join(privateDirectory, 'worker-source.secrets.json'), canonicalJson(secrets), { mode: 0o600 });
    await writeFile(join(privateDirectory, 'worker-source.build.json'), canonicalJson({ schemaVersion: 1, runId: f.manifest.runId, purpose: 'source', candidateSha: f.manifest.candidate.sha, candidateTree: f.manifest.candidate.tree, buildSha256: await hashIssue29WorkerBuild(join(repositoryRoot, '.svelte-kit/cloudflare')), configSha256: hash(config), secretNames: Object.keys(secrets).sort(), secretValuesSha256: hash(secrets) }), { mode: 0o600 });
    const provider = cloudflareFixture(f, (url, value) => {
        if (url.endsWith('/deployments'))
            value.result = { deployments: [{ versions: [{ version_id: state.versionId, percentage: 100 }] }] };
        if (url.includes('/versions/'))
            value.result = { id: state.versionId, metadata: { created_on: now }, resources: { script: { compatibility_date: config.compatibility_date, compatibility_flags: config.compatibility_flags }, bindings: [...Object.entries(config.vars).map(([name, text]) => ({ type: 'plain_text', name, text })), ...Object.keys(secrets).map(name => ({ type: 'secret_text', name })), { type: 'images', name: 'IMAGES' }, { type: 'assets', name: 'ASSETS' }] } };
        if (url.endsWith('/settings'))
            value.result = { observability: { enabled: state.logging } };
        if (url.endsWith('/schedules'))
            value.result = { schedules: [] };
        if (url.endsWith(`/scripts/${config.name}/subdomain`))
            value.result = { enabled: true, previews_enabled: false };
        return state.change ? state.change(url, value) : value;
    });
    const state = { versionId: '29292929-2929-4292-8292-292929292929', logging: false, deleted: false, change: null as null | ((url: string, value: any) => any) };
    const fetchImpl: typeof fetch = async (url, init) => { if (init?.method === 'DELETE') {
        state.deleted = true;
        provider.calls.push({ url: String(url), method: 'DELETE' });
        return Response.json({ success: true, result: null });
    } if (state.deleted && String(url).endsWith('/settings'))
        return Response.json({ success: false, errors: [{ code: 10007, message: 'Worker absent' }] }, { status: 404 }); return provider.fetchImpl(url, init); };
    const adapter = createIssue29WorkerAdapter({ ...f, repositoryRoot, privateDirectory, readToken: 'r'.repeat(40), deployToken: 'd'.repeat(40), cleanupToken: 'c'.repeat(40), deployCapabilityId: f.manifest.capabilityIds['monitoring-config'], cleanupCapabilityId: f.manifest.capabilityIds.cleanup }, { fetchImpl, now: () => now });
    f.manifest.pending = { step: 'deploy-worker', operationId: f.manifest.runId, startedAt: now, resourceId: config.name, priorStateSha256: null };
    return { ...f, directory, repositoryRoot, privateDirectory, config, secrets, provider, state, adapter };
}
it('hash-binds provider version/readback and removes only the owned Worker even after source reads close', async () => {
    const f = await preparedFixture();
    try {
        const proof = await f.adapter.readback({ manifest: f.manifest, operationId: f.manifest.runId });
        expect(proof).toMatchObject({ status: 'verified', evidenceMode: 'deterministic-http-fixture', workerName: f.config.name, versionId: f.state.versionId });
        expect(JSON.stringify(proof)).not.toContain('fixture-source-secret');
        f.manifest.candidate.deploymentId = proof.versionId;
        f.manifest.pending = null;
        f.manifest.cleanup.resources.push({ provider: 'cloudflare', id: f.config.name, runId: f.manifest.runId, createdAt: now, evidenceSha256: proof.evidenceSha256, disposition: 'disposable', absentAt: null });
        f.manifest.backupVerification = { descriptorSha256: 'e'.repeat(64), independentlyVerifiedAt: now, sourceReadsComplete: true };
        f.manifest.cleanup.resources[0].absentAt = now;
        await f.adapter.inspectCleanup({ manifest: f.manifest, operationId: f.manifest.runId });
        f.manifest.pending = { step: 'cleanup-resource', operationId: f.manifest.runId, startedAt: now, resourceId: f.config.name, priorStateSha256: null };
        await f.adapter.remove({ manifest: f.manifest, operationId: f.manifest.runId });
        expect(await f.adapter.readAbsent({ manifest: f.manifest, operationId: f.manifest.runId })).toMatchObject({ absent: true, workerName: f.config.name });
        expect(f.provider.calls.filter(c => c.method === 'DELETE')).toHaveLength(1);
        await expect(f.adapter.remove({ manifest: f.manifest, operationId: f.manifest.runId })).rejects.toThrow('WORKER_CLEANUP_INTENT_REQUIRED');
    }
    finally {
        await (await import('node:fs/promises')).rm(f.directory, { recursive: true, force: true });
    }
});
it.each(['foreign-binding', 'logging', 'split-version', 'cron', 'unknown-secret', 'modified-build', 'foreign-domain'])('denies %s hosted readback drift', async (kind) => {
    const f = await preparedFixture();
    try {
        f.state.change = (url, value) => {
            if (kind === 'foreign-binding' && value.result?.resources)
                value.result.resources.bindings[0].text = 'production';
            if (kind === 'logging' && url.endsWith('/settings'))
                value.result.observability.enabled = true;
            if (kind === 'split-version' && url.endsWith('/deployments'))
                value.result.deployments[0].versions[0].percentage = 50;
            if (kind === 'cron' && url.endsWith('/schedules'))
                value.result.schedules = [{ cron: '* * * * *' }];
            if (kind === 'unknown-secret' && value.result?.resources)
                value.result.resources.bindings.push({ type: 'secret_text', name: 'RESEND_API_KEY' });
            if (kind === 'foreign-domain' && url.endsWith('/domains'))
                value.result = [{ service: f.config.name, hostname: 'canonical.example.invalid' }];
            return value;
        };
        if (kind === 'modified-build')
            await (await import('node:fs/promises')).writeFile(f.repositoryRoot + '/.svelte-kit/cloudflare/_worker.js', 'changed after proof');
        await expect(f.adapter.readback({ manifest: f.manifest, operationId: f.manifest.runId })).rejects.toThrow('Issue #29:');
        expect(f.provider.calls.every(c => c.method === 'GET')).toBe(true);
    }
    finally {
        await (await import('node:fs/promises')).rm(f.directory, { recursive: true, force: true });
    }
});
