import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createIssue29WorkerConfig } from '../../scripts/issue29-operations/worker-adapter.mjs';
import { validateWranglerConfig as validateIssue22 } from '../../scripts/issue22-hosted/candidate.mjs';
import { manifestFixture } from '../fixtures/issue29-operations';
const now = '2026-09-05T12:00:00.000Z';
const template = JSON.parse(readFileSync('scripts/issue22-hosted/wrangler.issue22.template.json', 'utf8'));
function fixture() { const manifest = structuredClone(manifestFixture()); manifest.target = null; manifest.candidate = { ...manifest.candidate, deploymentId: 'pending' }; manifest.state = 'source_read_back'; manifest.allowedActions.push('deploy-worker'); manifest.cleanup.resources.push({ provider: 'supabase', id: manifest.source!.ref, runId: manifest.runId, createdAt: now, evidenceSha256: 'd'.repeat(64), disposition: 'persistent', absentAt: null }); const settings = { accountId: 'c'.repeat(32), subdomain: 'owner', purpose: 'source' as 'source' | 'target', publishableKey: 'sb_publishable_fixture', turnstileSiteKey: '0x4AAAAAARealSyntheticScopeFixture', operations: { migrationSha256: 'd'.repeat(64), schemaSha256: 'e'.repeat(64), sentinelSha256: 'f'.repeat(64), canaryExpectedUtc: '03:17' } }; return { manifest, settings }; }
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
async function preparedFixture(purpose: 'source'|'target' = 'source') {
    const { mkdtemp, mkdir, writeFile, cp } = await import('node:fs/promises');
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
    if (purpose === 'target') { f.settings.purpose = 'target'; f.manifest.target = structuredClone(manifestFixture().target); f.manifest.state = 'storage_restored'; f.manifest.cleanup.resources.push({provider:'supabase',id:f.manifest.target!.ref,runId:f.manifest.runId,createdAt:now,evidenceSha256:'e'.repeat(64),disposition:'disposable',absentAt:null}); }
    await cp(join(repositoryRoot,'.svelte-kit/cloudflare'),join(privateDirectory,`worker-${purpose}-build`),{recursive:true});
    const config = createIssue29WorkerConfig({ ...f, template, repositoryRoot, privateDirectory, now });
    const secrets = { SUPABASE_SECRET_KEY: 'fixture-source-secret-'.repeat(3), TURNSTILE_SECRET_KEY: '0x4' + 'f'.repeat(40), OPERATIONS_MONITOR_TOKEN: 'm'.repeat(43) };
    const hash = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex');
    await writeFile(join(privateDirectory, `worker-${purpose}.json`), canonicalJson(config), { mode: 0o600 });
    await writeFile(join(privateDirectory, `worker-${purpose}.secrets.json`), canonicalJson(secrets), { mode: 0o600 });
    await writeFile(join(privateDirectory, `worker-${purpose}.build.json`), canonicalJson({ schemaVersion: 1, runId: f.manifest.runId, purpose, candidateSha: f.manifest.candidate.sha, candidateTree: f.manifest.candidate.tree, buildSha256: await hashIssue29WorkerBuild(join(privateDirectory, `worker-${purpose}-build`)), configSha256: hash(config), secretNames: Object.keys(secrets).sort(), secretValuesSha256: hash(secrets) }), { mode: 0o600 });
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
    return { ...f, directory, repositoryRoot, privateDirectory, config, secrets, provider, state, adapter, adapterFetch:fetchImpl };
}
it('hash-binds target version/readback and removes only the disposable target Worker', async () => {
    const f = await preparedFixture('target');
    try {
        const proof = await f.adapter.readback({ manifest: f.manifest, operationId: f.manifest.runId });
        expect(proof).toMatchObject({ status: 'verified', evidenceMode: 'deterministic-http-fixture', workerName: f.config.name, versionId: f.state.versionId });
        expect(JSON.stringify(proof)).not.toContain('fixture-source-secret');
        f.manifest.targetDeploymentId = proof.versionId;
        f.manifest.pending = null;
        f.manifest.cleanup.resources.push({ provider: 'cloudflare', id: f.config.name, runId: f.manifest.runId, createdAt: now, evidenceSha256: proof.evidenceSha256, disposition: 'disposable', absentAt: null });
        f.manifest.backupVerification = { descriptorSha256: 'e'.repeat(64), independentlyVerifiedAt: now, sourceReadsComplete: true };
        // The persistent source and its Worker stay unchanged during target cleanup.
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
            await (await import('node:fs/promises')).writeFile(f.privateDirectory + '/worker-source-build/_worker.js', 'changed after proof');
        await expect(f.adapter.readback({ manifest: f.manifest, operationId: f.manifest.runId })).rejects.toThrow('Issue #29:');
        expect(f.provider.calls.every(c => c.method === 'GET')).toBe(true);
    }
    finally {
        await (await import('node:fs/promises')).rm(f.directory, { recursive: true, force: true });
    }
});

it('keeps a persistent source Worker distinct from the disposable restore Worker and refuses source cleanup', async () => {
 const f=await preparedFixture();
 try {
  const sourceConfig=f.config;
  const targetManifest=structuredClone(f.manifest);targetManifest.target=structuredClone(manifestFixture().target);targetManifest.state='storage_restored';targetManifest.cleanup.resources.push({provider:'supabase',id:targetManifest.target!.ref,runId:targetManifest.runId,createdAt:now,evidenceSha256:'e'.repeat(64),disposition:'disposable',absentAt:null});
  const targetConfig=createIssue29WorkerConfig({template,manifest:targetManifest,settings:{...f.settings,purpose:'target'},repositoryRoot:f.repositoryRoot,now});
  expect(sourceConfig.name).toBe(`issue29-${f.manifest.runId}`);
  expect(targetConfig.name).toBe(`issue29-restore-${f.manifest.runId}`);
  expect(targetConfig.vars.PUBLIC_APP_URL).not.toBe(sourceConfig.vars.PUBLIC_APP_URL);
  const proof=await f.adapter.readback({manifest:f.manifest,operationId:f.manifest.runId});
  f.manifest.pending=null;f.manifest.cleanup.resources.push({provider:'cloudflare',id:sourceConfig.name,runId:f.manifest.runId,createdAt:now,evidenceSha256:proof.evidenceSha256,disposition:'persistent',absentAt:null});
  await expect(f.adapter.inspectCleanup({manifest:f.manifest,operationId:f.manifest.runId})).rejects.toThrow('PERSISTENT_WORKER_CLEANUP_FORBIDDEN');
  expect(f.provider.calls.every(c=>c.method==='GET')).toBe(true);
 } finally {await(await import('node:fs/promises')).rm(f.directory,{recursive:true,force:true});}
});

it('queries source binding with only a read credential and no mutation capability', async () => {
 const f=await preparedFixture();
 try {
  const {readIssue29WorkerBinding}=await import('../../scripts/issue29-operations/worker-adapter.mjs');
  f.manifest.candidate.deploymentId=f.state.versionId;
  const result=await readIssue29WorkerBinding({...f,readToken:'r'.repeat(40)},{fetchImpl:f.adapterFetch,now:()=>now});
  expect(result.workerName).toBe(f.config.name);
 } finally {await(await import('node:fs/promises')).rm(f.directory,{recursive:true,force:true});}
});

it('reconciles one pending deployment without repeating Wrangler and binds persistent ownership', async () => {
 const f=await preparedFixture();
 try {
  const {writePrivateManifest,readPrivateManifest}=await import('../../scripts/issue29-operations/manifest.mjs');
  const {executeDeployWorker}=await import('../../scripts/issue29-operations/worker-adapter.mjs');
  const manifestPath=f.privateDirectory+'/manifest.json';
  await writePrivateManifest(manifestPath,f.manifest,{repositoryRoot:f.repositoryRoot,now});
  const options={manifestPath,settings:f.settings,repositoryRoot:f.repositoryRoot,privateDirectory:f.privateDirectory,readToken:'r'.repeat(40),deployToken:'d'.repeat(40),cleanupToken:'c'.repeat(40),deployCapabilityId:f.manifest.capabilityIds['monitoring-config'],cleanupCapabilityId:f.manifest.capabilityIds.cleanup};
  await(await import('../../scripts/issue29-operations/operator.mjs')).persistOperationsIntent(manifestPath,f.manifest,f.repositoryRoot);
  const result=await executeDeployWorker(options,{fetchImpl:f.adapterFetch,now:()=>now});
  const after=await readPrivateManifest(manifestPath,{repositoryRoot:f.repositoryRoot,now});
  expect(after.pending).toBeNull();expect(after.candidate.deploymentId).toBe(result.versionId);
  expect(after.cleanup.resources.find(r=>r.provider==='cloudflare')).toMatchObject({id:f.config.name,disposition:'persistent',absentAt:null});
  expect(after.history.filter(r=>r.step==='deploy-worker')).toHaveLength(1);expect(after.history.find(r=>r.step==='deploy-worker')?.intentSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(f.provider.calls.every(c=>c.method==='GET')).toBe(true);
  await expect(executeDeployWorker(options,{fetchImpl:f.adapterFetch,now:()=>now})).resolves.toMatchObject({versionId:result.versionId});
  expect((await readPrivateManifest(manifestPath,{repositoryRoot:f.repositoryRoot,now})).history.filter(r=>r.step==='deploy-worker')).toHaveLength(1);
 } finally {await(await import('node:fs/promises')).rm(f.directory,{recursive:true,force:true});}
});

it('persists target deletion intent before DELETE and resumes absence without another DELETE', async () => {
 const f=await preparedFixture('target');
 try {
  const {writePrivateManifest,readPrivateManifest}=await import('../../scripts/issue29-operations/manifest.mjs');
  const {executeDeployWorker,executeCleanupWorker}=await import('../../scripts/issue29-operations/worker-adapter.mjs');
  const manifestPath=f.privateDirectory+'/manifest.json';
  await writePrivateManifest(manifestPath,f.manifest,{repositoryRoot:f.repositoryRoot,now});
  const options={manifestPath,settings:f.settings,repositoryRoot:f.repositoryRoot,privateDirectory:f.privateDirectory,readToken:'r'.repeat(40),deployToken:'d'.repeat(40),cleanupToken:'c'.repeat(40),deployCapabilityId:f.manifest.capabilityIds['monitoring-config'],cleanupCapabilityId:f.manifest.capabilityIds.cleanup};
  await(await import('../../scripts/issue29-operations/operator.mjs')).persistOperationsIntent(manifestPath,f.manifest,f.repositoryRoot);
  await executeDeployWorker(options,{fetchImpl:f.adapterFetch,now:()=>now});
  let deletes=0;
  const fetchImpl:typeof fetch=async(url,init)=>{
   if(init?.method==='DELETE'){deletes++;const persisted=await readPrivateManifest(manifestPath,{repositoryRoot:f.repositoryRoot,now});expect(persisted.pending).toMatchObject({step:'cleanup-resource',resourceId:f.config.name});}
   return f.adapterFetch(url,init);
  };
  expect(await executeCleanupWorker(options,{fetchImpl,now:()=>now})).toMatchObject({absent:true,workerName:f.config.name});
  expect(await executeCleanupWorker(options,{fetchImpl,now:()=>now})).toMatchObject({absent:true});
  expect(deletes).toBe(1);
  const after=await readPrivateManifest(manifestPath,{repositoryRoot:f.repositoryRoot,now});
  expect(after.cleanup.resources.find(r=>r.id===f.config.name)?.absentAt).toBe(now);
  expect(after.cleanup.resources.find(r=>r.id===f.manifest.source!.ref)?.absentAt).toBeNull();
 } finally {await(await import('node:fs/promises')).rm(f.directory,{recursive:true,force:true});}
});

it('retains source build readback independently of a later target build in the checkout',async()=>{
 const f=await preparedFixture();try{
  const {writeFile}=await import('node:fs/promises');
  await writeFile(f.repositoryRoot+'/.svelte-kit/cloudflare/_worker.js','later target build');
  await expect(f.adapter.readback({manifest:f.manifest,operationId:f.manifest.runId})).resolves.toMatchObject({workerName:f.config.name});
 }finally{await(await import('node:fs/promises')).rm(f.directory,{recursive:true,force:true});}
});

it('binds merged release to actual protected main, reviewed candidate tree and both successful check cohorts',async()=>{
 const {verifyProtectedMerge}=await import('../../scripts/issue29-operations/worker-adapter.mjs');
 const fromCandidate={sha:'a'.repeat(40),tree:'b'.repeat(40),deploymentId:'29292929-2929-4292-8292-292929292929'},mergeSha='c'.repeat(40);
 const settings={repository:'todevan/perfume-marketplace-bg',repositoryId:12,pullRequestNumber:99,mergeSha,treeSha:fromCandidate.tree,readToken:'r'.repeat(40)};
 const calls:string[]=[];const fetchImpl:typeof fetch=async(url)=>{const p=new URL(String(url)).pathname;calls.push(p);let body:unknown={};
 if(p.endsWith('/pulls/99'))body={number:99,state:'closed',merged:true,merged_at:'2026-09-05T11:55:00Z',merge_commit_sha:mergeSha,head:{sha:fromCandidate.sha,repo:{id:12}},base:{ref:'main',repo:{id:12}}};
 else if(p.endsWith('/branches/main/protection'))body={required_status_checks:{checks:[{context:'CI Gate',app_id:15368}]}};
 else if(p.endsWith('/branches/main'))body={name:'main',protected:true,commit:{sha:mergeSha}};
 else if(p.endsWith('/check-runs'))body={total_count:1,check_runs:[{id:1,name:'CI Gate',head_sha:p.split('/')[5],app:{id:15368},status:'completed',conclusion:'success'}]};
 else if(p.includes('/git/commits/'))body={sha:p.split('/').at(-1),tree:{sha:fromCandidate.tree}};
 else if(p.endsWith('/perfume-marketplace-bg'))body={id:12,full_name:settings.repository,default_branch:'main'};
 return Response.json(body);};
 const proof=await verifyProtectedMerge({settings,fromCandidate,now,fetchImpl});expect(proof).toMatchObject({kind:'issue29-protected-merge',evidenceMode:'deterministic-http-fixture',mergeSha,treeSha:fromCandidate.tree,fromCandidate});expect(calls).toHaveLength(8);
 await expect(verifyProtectedMerge({settings:{...settings,treeSha:'d'.repeat(40)},fromCandidate,now,fetchImpl})).rejects.toThrow('MERGE_TREE_MISMATCH');
 const failed:typeof fetch=async(url,init)=>{const r=await fetchImpl(url,init);const b=await r.json();if(b.check_runs)b.check_runs[0].conclusion='failure';return Response.json(b);};
 await expect(verifyProtectedMerge({settings,fromCandidate,now,fetchImpl:failed})).rejects.toThrow('MERGE_CHECKS_NOT_GREEN');
});

async function mergedWorkerFixture(){
 const f=await preparedFixture();const fs=await import('node:fs/promises'),{join}=await import('node:path'),{createHash}=await import('node:crypto'),{canonicalJson}=await import('../../scripts/issue29-operations/recovery-set.mjs');
 const hash=(v:unknown)=>createHash('sha256').update(canonicalJson(v)).digest('hex');
 const oldProof=await f.adapter.readback({manifest:f.manifest,operationId:f.manifest.runId});f.manifest.pending=null;f.manifest.candidate.deploymentId=oldProof.versionId;f.manifest.cleanup.resources.push({provider:'cloudflare',id:oldProof.workerName,runId:f.manifest.runId,createdAt:now,evidenceSha256:oldProof.evidenceSha256,disposition:'persistent',absentAt:null});
 const fromCandidate=structuredClone(f.manifest.candidate);const proof={schemaVersion:1,kind:'issue29-protected-merge',evidenceMode:'deterministic-http-fixture',repository:'todevan/perfume-marketplace-bg',repositoryId:12,pullRequestNumber:99,fromCandidate,mergeSha:'c'.repeat(40),treeSha:fromCandidate.tree,verifiedAt:now,mergedAt:now,protectionSha256:'1'.repeat(64),checkRunsSha256:'2'.repeat(64)};
 const evidenceSha256=hash(proof);await fs.writeFile(join(f.privateDirectory,evidenceSha256+'.json'),canonicalJson(proof),{mode:0o600});f.manifest.allowedActions.push('adopt-merged-release','update-worker');f.manifest.releaseUpdate={fromCandidate,mergeSha:proof.mergeSha,treeSha:proof.treeSha,pullRequestNumber:99,verifiedAt:now,evidenceSha256,repository:proof.repository,repositoryId:12};f.manifest.candidate.sha=proof.mergeSha;f.manifest.history.push({step:'adopt-merged-release',operationId:f.manifest.runId,completedAt:now,evidenceSha256,resourceId:proof.mergeSha});
 const mergedDirectory=join(f.directory,'merged-private');await fs.mkdir(mergedDirectory,{mode:0o700});await fs.cp(join(f.privateDirectory,'worker-source-build'),join(mergedDirectory,'worker-source-build'),{recursive:true});
 const newConfig=createIssue29WorkerConfig({manifest:f.manifest,settings:f.settings,template,repositoryRoot:f.repositoryRoot,privateDirectory:mergedDirectory,now});const build=JSON.parse(await fs.readFile(join(f.privateDirectory,'worker-source.build.json'),'utf8'));build.candidateSha=proof.mergeSha;build.configSha256=hash(newConfig);
 await fs.writeFile(join(mergedDirectory,'worker-source.json'),canonicalJson(newConfig),{mode:0o600});await fs.writeFile(join(mergedDirectory,'worker-source.build.json'),canonicalJson(build),{mode:0o600});await fs.writeFile(join(mergedDirectory,'worker-source.secrets.json'),canonicalJson(f.secrets),{mode:0o600});
 return{...f,mergedDirectory,newConfig,oldProof,hash,canonicalJson};
}
it('permits only same-origin/source/secret update after actual adoption proof, preserving previous build',async()=>{
 const f=await mergedWorkerFixture();try{
  const {createIssue29WorkerAdapter,readProtectedMergeEvidence}=await import('../../scripts/issue29-operations/worker-adapter.mjs');
  await expect(readProtectedMergeEvidence(f.manifest,f.privateDirectory,f.repositoryRoot)).rejects.toThrow('HOSTED_MERGE_EVIDENCE_REQUIRED');
  const adapter=createIssue29WorkerAdapter({settings:f.settings,repositoryRoot:f.repositoryRoot,privateDirectory:f.mergedDirectory,readToken:'r'.repeat(40)},{fetchImpl:f.adapterFetch,now:()=>now});
  expect(await adapter.inspectUpdate({manifest:f.manifest,operationId:f.manifest.runId},f.privateDirectory)).toMatchObject({evidenceSha256:f.oldProof.evidenceSha256});
  const fs=await import('node:fs/promises');await fs.writeFile(f.mergedDirectory+'/worker-source.secrets.json',f.canonicalJson({...f.secrets,OPERATIONS_MONITOR_TOKEN:'q'.repeat(43)}),{mode:0o600});
  await expect(adapter.inspectUpdate({manifest:f.manifest,operationId:f.manifest.runId},f.privateDirectory)).rejects.toThrow('WORKER_BUILD_PROVENANCE_MISMATCH');
  expect(f.provider.calls.every(c=>c.method==='GET')).toBe(true);
 }finally{await(await import('node:fs/promises')).rm(f.directory,{recursive:true,force:true});}
});
it('resumes an uncertain merged Worker update by exact new version readback without calling Wrangler again',async()=>{
 const f=await mergedWorkerFixture();try{
  const fs=await import('node:fs/promises'),{writePrivateManifest,readPrivateManifest}=await import('../../scripts/issue29-operations/manifest.mjs'),{executeUpdateSourceWorker}=await import('../../scripts/issue29-operations/worker-adapter.mjs');
  const snapshot={schemaVersion:1,kind:'issue29-worker-update-prior',worker:f.oldProof,config:f.config,build:JSON.parse(await fs.readFile(f.privateDirectory+'/worker-source.build.json','utf8'))};const snapshotSha=f.hash(snapshot);await fs.writeFile(f.privateDirectory+'/'+snapshotSha+'.json',f.canonicalJson(snapshot),{mode:0o600});
  f.manifest.pending={step:'update-worker',operationId:f.manifest.runId,startedAt:now,resourceId:f.config.name,priorStateSha256:snapshotSha};f.manifest.attempts['update-worker:'+f.manifest.candidate.sha]=1;const manifestPath=f.privateDirectory+'/manifest.json';await writePrivateManifest(manifestPath,f.manifest,{repositoryRoot:f.repositoryRoot,now});
  await(await import('../../scripts/issue29-operations/operator.mjs')).persistOperationsIntent(manifestPath,f.manifest,f.repositoryRoot);
  f.state.versionId='11111111-1111-4111-8111-111111111111';Object.assign(f.config.vars,f.newConfig.vars);
  const options={manifestPath,settings:f.settings,repositoryRoot:f.repositoryRoot,privateDirectory:f.mergedDirectory,previousPrivateDirectory:f.privateDirectory,readToken:'r'.repeat(40)};
  const result=await executeUpdateSourceWorker(options,{fetchImpl:f.adapterFetch,now:()=>now});expect(result.versionId).toBe(f.state.versionId);
  const after=await readPrivateManifest(manifestPath,{repositoryRoot:f.repositoryRoot,now});expect(after.pending).toBeNull();expect(after.sourceProvenance).toEqual(f.manifest.sourceProvenance);expect(after.candidate.deploymentId).toBe(f.state.versionId);expect(after.cleanup.resources.at(-1)?.disposition).toBe('persistent');
  expect((await executeUpdateSourceWorker(options,{fetchImpl:f.adapterFetch,now:()=>now})).versionId).toBe(f.state.versionId);expect(f.provider.calls.every(c=>c.method==='GET')).toBe(true);
 }finally{await(await import('node:fs/promises')).rm(f.directory,{recursive:true,force:true});}
});
it('keeps source origin stable while assigning each monthly rehearsal a distinct disposable Worker name',async()=>{
 const {workerNameFor}=await import('../../scripts/issue29-operations/worker-adapter.mjs');const {maintenanceFixture}=await import('../fixtures/issue29-operations');const m=manifestFixture();m.maintenance=maintenanceFixture(m);m.maintenance.id='11111111-1111-4111-8111-111111111111';
 expect(workerNameFor(m,'source')).toBe('issue29-29292929-2929-4292-8292-292929292929');expect(workerNameFor(m,'target')).toBe('issue29-restore-11111111-1111-4111-8111-111111111111');
});

describe('complete Cloudflare inventory without optional total_pages', () => {
    async function inspectDomains(responder: (page: number) => any) {
        const f = fixture(), provider = cloudflareFixture(f), pages: number[] = [];
        const { createIssue29WorkerAdapter } = await import('../../scripts/issue29-operations/worker-adapter.mjs');
        const fetchImpl: typeof fetch = async (url, init) => {
            const u = new URL(String(url));
            if (u.pathname.endsWith('/workers/domains')) {
                const page = Number(u.searchParams.get('page')); pages.push(page);
                return Response.json(responder(page));
            }
            return provider.fetchImpl(url, init);
        };
        const adapter = createIssue29WorkerAdapter({ settings: f.settings, readToken: 'r'.repeat(40), repositoryRoot: process.cwd(), privateDirectory: '/tmp/read-only' }, { fetchImpl, now: () => now });
        return { result: adapter.inspect({ manifest: f.manifest, operationId: f.manifest.runId }), pages, f };
    }
    it('accepts the exact native empty-domain response with count/page/per_page/total_count', async () => {
        const run = await inspectDomains(() => ({ success: true, result: [], result_info: { page: 1, per_page: 50, count: 0, total_count: 0 } }));
        await expect(run.result).resolves.toMatchObject({ status: 'absent' });
        expect(run.pages).toEqual([1]);
    });
    it.each([false, true])('reads all count-derived pages and detects a last-page route collision: %s', async collision => {
        const expectedWorker = `issue29-${fixture().manifest.runId}`;
        const run = await inspectDomains(page => ({ success: true, result: page === 1 ? Array.from({length: 50}, (_, i) => ({ service: `other-${i}` })) : [{ service: collision ? expectedWorker : 'other-final' }], result_info: { page, per_page: 50, count: page === 1 ? 50 : 1, total_count: 51 } }));
        if (collision) await expect(run.result).rejects.toThrow('WORKER_CUSTOM_DOMAIN_FORBIDDEN');
        else await expect(run.result).resolves.toMatchObject({ status: 'absent' });
        expect(run.pages).toEqual([1, 2]);
    });
    it.each([
        { page: 1, per_page: 50, count: 0 },
        { page: 1, per_page: 50, count: 1, total_count: 0 },
        { page: 2, per_page: 50, count: 0, total_count: 0 },
        { page: 1, per_page: 20, count: 0, total_count: 0 },
        { page: 1, per_page: 50, count: 0, total_count: 51 },
        { page: 1, per_page: 50, count: 0, total_count: 0, total_pages: 2 },
        { page: 1, per_page: 50, count: 0, total_count: -1 },
        { page: 1, per_page: 50, count: 0, total_count: 5001 }
    ])('rejects incomplete or contradictory pagination %j before declaring absence', async result_info => {
        const run = await inspectDomains(() => ({ success: true, result: [], result_info }));
        await expect(run.result).rejects.toThrow('WORKER_INVENTORY_TRUNCATED');
        expect(run.pages).toEqual([1]);
    });
});
