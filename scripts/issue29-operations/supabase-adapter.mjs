import { createHash } from 'node:crypto';
import { canonicalJson } from './recovery-set.mjs';
import { ensure, OperationsError, validateProviderPreflight } from './manifest.mjs';
const root = 'https://api.supabase.com/v1';
const refPattern = /^[a-z]{20}$/u;
/** @param {unknown} value */
const digest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
/** @typedef {import('./operator.mjs').LifecycleContext} Context */
/** @typedef {{organizationId:string,checkedAt:string,projectLimit:number,availableProjects:number,quotedCost:number,currency:string,deletionAuthorized:boolean,evidenceSha256:string}} CapacityQuote */
/** Real, narrow Management API adapter. Free capacity requires the exact owner-attested
 * two-slot operating envelope plus fresh plan/inventory, or a separately verified live quote.
 * Documentation or a configured free-plan string alone never establishes capacity.
 * @param {{token:string,fetch?:typeof fetch,clock?:()=>string,readCapacityQuote?:(organizationId:string)=>Promise<CapacityQuote>,databasePassword?:(purpose:'source'|'target')=>Promise<string>,twoSlotAuthorization?:TwoSlotAuthorization,ownerSourceAuthorization?:OwnerSourceAuthorization,inspectEmpty?:(project:import('./manifest.mjs').ProjectIdentity)=>Promise<boolean>}} options
 */
export function createSupabaseOperationsAdapter(options) {
    ensure(typeof options.token === 'string' && options.token.length > 0 && !/[\r\n]/u.test(options.token), 'PROVIDER_CREDENTIAL_REQUIRED');
    const request = options.fetch ?? fetch;
    const clock = options.clock ?? (() => new Date().toISOString());
    const mutations = new Set();
    /** @param {string} path @param {string} [method] @param {unknown} [body] @param {boolean} [allowMissing] */
    async function call(path, method = 'GET', body, allowMissing = false) {
        try {
            ensure(path.startsWith('/') && !path.includes('..'), 'PROVIDER_PATH_INVALID');
            const response = await request(`${root}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(20000),
                headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            if (allowMissing && response.status === 404)
                return null;
            if ((method === 'DELETE' && response.status === 204) || (method === 'POST' && /\/(pause|restore)$/u.test(path) && response.status === 200)) {
                await response.body?.cancel();
                return null;
            }
            ensure(response.ok && response.body, method === 'GET' ? 'PROVIDER_READ_FAILED' : 'PROVIDER_MUTATION_UNCERTAIN');
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            try {
                while (true) {
                    const part = await reader.read();
                    if (part.done)
                        break;
                    size += part.value.length;
                    ensure(size <= 2097152, 'PROVIDER_RESPONSE_LIMIT');
                    chunks.push(Buffer.from(part.value));
                }
            }
            finally {
                await reader.cancel();
            }
            return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        }
        catch (error) {
            if (error instanceof OperationsError)
                throw error;
            throw new OperationsError(method === 'GET' ? 'PROVIDER_READ_FAILED' : 'PROVIDER_MUTATION_UNCERTAIN');
        }
    }
    /** @param {Context} context */
    async function preflight(context) {
        const { organizationId, region } = context.manifest.provisioning;
        ensure(/^[a-z0-9-]{1,63}$/u.test(organizationId) && /^[a-z0-9-]{1,63}$/u.test(region), 'PROVIDER_PREFLIGHT_IDENTITY_MISMATCH');
        const organization = await call(`/organizations/${organizationId}`);
        ensure(organization.id === organizationId && organization.plan === 'free', 'ZERO_COST_REQUIRED');
        const projects = await call('/projects');
        ensure(Array.isArray(projects) && projects.every(p => refPattern.test(p.ref)), 'PROVIDER_INVENTORY_INVALID');
        const regions = await call(`/projects/available-regions?organization_slug=${organizationId}`);
        const available = regions.all?.specific?.some(/** @param {{code:string,status?:string}} r */ /** @param {{code:string,status?:string}} r */ r => r.code === region && !r.status);
        ensure(available === true, 'PROVIDER_REGION_UNAVAILABLE');
        let quote;
        if (options.twoSlotAuthorization) {
            const authorization = validateTwoSlotAuthorization(options.twoSlotAuthorization, { organizationId, preservedRefs: context.manifest.preservedRefs, now: clock() });
            ensure(projects.every(p => p.organization_slug === organizationId), 'ACCOUNT_CAPACITY_SCOPE_UNPROVEN');
            ensure(projects.some(p => p.ref === authorization.preservedStagingRef && p.status === 'ACTIVE_HEALTHY'), 'PRESERVED_STAGING_NOT_ACTIVE');
            const active = projects.filter(p => !['INACTIVE', 'REMOVED'].includes(p.status)).length;
            quote = { organizationId, checkedAt: clock(), projectLimit: 2, availableProjects: Math.max(0, 2 - active), quotedCost: 0, currency: 'USD', deletionAuthorized: true, evidenceSha256: digest({ authorizationSha256: authorization.evidenceSha256, active, inventory: projects.map(p => ({ ref: p.ref, status: p.status })) }) };
        }
        else {
            ensure(options.readCapacityQuote, 'PROVIDER_CAPACITY_HANDOFF_REQUIRED');
            quote = await options.readCapacityQuote(organizationId);
        }
        ensure(quote.organizationId === organizationId && Number.isFinite(Date.parse(quote.checkedAt)) && Date.parse(clock()) - Date.parse(quote.checkedAt) >= 0 && Date.parse(clock()) - Date.parse(quote.checkedAt) <= 300000 && /^[a-f0-9]{64}$/u.test(quote.evidenceSha256), 'PROVIDER_QUOTE_STALE');
        const inventoryRefs = projects.map(p => p.ref).sort();
        const activeProjectCount = projects.filter(p => p.organization_slug === organizationId && !['INACTIVE', 'REMOVED'].includes(p.status)).length;
        const evidence = { organizationId, region, checkedAt: clock(), expiresAt: new Date(Date.parse(clock()) + 300000).toISOString(), plan: 'free', projectLimit: quote.projectLimit, activeProjectCount,
            availableProjects: quote.availableProjects, quotedCost: quote.quotedCost, currency: quote.currency, deletionSupported: quote.deletionAuthorized, regionAvailable: true, inventoryRefs };
        const providerInventory={organization:{id:organization.id,plan:organization.plan},projects:projects.map(p=>({ref:p.ref,organizationId:typeof p.organization_slug==='string'&&/^[a-z0-9-]{1,63}$/u.test(p.organization_slug)?p.organization_slug:null,region:typeof p.region==='string'&&/^[a-z0-9-]{1,63}$/u.test(p.region)?p.region:null,status:typeof p.status==='string'&&/^[A-Z_]{1,63}$/u.test(p.status)?p.status:null})).sort((a,b)=>a.ref.localeCompare(b.ref))};
        const preimage={schemaVersion:1,kind:'issue29-supabase-preflight',runId:context.manifest.runId,operationId:context.operationId,evidence,quoteSha256:quote.evidenceSha256,providerInventory,classification:{sourceRef:context.manifest.source?.ref??null,targetRef:context.manifest.target?.ref??null,preservedRefs:[...context.manifest.preservedRefs].sort(),basis:'manifest-authorization-only'}};
        return {...validateProviderPreflight({ ...evidence, evidenceSha256: digest(preimage) }, { organizationId, region, preservedRefs: context.manifest.preservedRefs, now: clock() }),evidence:preimage};
    }
    /** @param {Context} context */
    async function create(context) {
        const { manifest, operationId, purpose } = context;
        ensure(!options.ownerSourceAuthorization, 'OWNER_SOURCE_AUTHORIZATION_READBACK_ONLY');
        ensure(manifest.pending?.operationId === operationId && manifest.pending.step === `create-${purpose}` && manifest.state === `${purpose === 'source' ? 'source' : 'target'}_creation_pending`, 'PERSISTED_INTENT_REQUIRED');
        ensure(!mutations.has(operationId), 'MUTATION_ALREADY_ATTEMPTED');
        const name = purpose === 'source' ? manifest.provisioning.sourceName : manifest.provisioning.targetName;
        ensure(name.includes(purpose==='target'?(manifest.maintenance?.id??manifest.runId):manifest.runId) && options.databasePassword, 'SOURCE_RUN_BINDING_REQUIRED');
        const capacity = await preflight(context);
        ensure(capacity.availableProjects >= 1, 'CAPACITY_UNPROVEN');
        const projects = await call('/projects');
        ensure(!projects.some(/** @param {{name:string}} p */ /** @param {{name:string}} p */ p => p.name === name), 'PROJECT_NAME_COLLISION');
        const password = await options.databasePassword(purpose);
        ensure(typeof password === 'string' && password.length >= 32 && password.length <= 128 && !/[\r\n]/u.test(password), 'DATABASE_CREDENTIAL_REQUIRED');
        mutations.add(operationId);
        await call('/projects', 'POST', { organization_slug: manifest.provisioning.organizationId, name, db_pass: password,
            region_selection: { type: 'specific', code: manifest.provisioning.region } });
    }
    /** @param {Context} context */
    async function readCreated(context) {
        const { manifest, purpose } = context;
        ensure(manifest.pending && options.inspectEmpty, 'READBACK_CAPABILITY_REQUIRED');
        const name = purpose === 'source' ? manifest.provisioning.sourceName : manifest.provisioning.targetName;
        const matches = (await call('/projects')).filter(/** @param {{name:string}} p */ /** @param {{name:string}} p */ p => p.name === name);
        ensure(matches.length === 1, 'PROJECT_CREATION_UNCERTAIN');
        const data = await call(`/projects/${matches[0].ref}`);
        ensure(data.name === name && data.organization_slug === manifest.provisioning.organizationId && data.region === manifest.provisioning.region && data.status === 'ACTIVE_HEALTHY' && !manifest.forbiddenRefs.includes(data.ref) && !manifest.preservedRefs.includes(data.ref), 'TARGET_IDENTITY_MISMATCH');
        const createdAt = new Date(data.created_at).toISOString();
        ensure(Number.isFinite(Date.parse(createdAt)) && Date.parse(createdAt) <= Date.parse(clock()) + 300000, 'CREATION_TIME_MISMATCH');
        const withinCreationWindow = Date.parse(createdAt) >= Date.parse(manifest.pending.startedAt) - 1000;
        const ownerAuthorization = options.ownerSourceAuthorization ? validateOwnerSourceAuthorization(options.ownerSourceAuthorization, { manifest, operationId: context.operationId, purpose, sourceRef: data.ref, sourceName: name, observedCreatedAt: createdAt, now: clock() }) : null;
        ensure(withinCreationWindow || ownerAuthorization, 'CREATION_TIME_MISMATCH');
        const version = /^([0-9]+\.[0-9]+)(?:\.[0-9]+)?/u.exec(data.database?.version ?? '')?.[1];
        ensure(version, 'POSTGRES_VERSION_UNPROVEN');
        const project = { organizationId: data.organization_slug, ref: data.ref, region: data.region, environment: purpose === 'source' ? 'synthetic' : 'disposable', url: `https://${data.ref}.supabase.co`, postgresVersion: version, classification: 'synthetic-owner-controlled' };
        const empty = await options.inspectEmpty(project);
        const evidence={schemaVersion:1,kind:ownerAuthorization?'issue29-supabase-owner-authorized-source':'issue29-supabase-created',runId:manifest.runId,operationId:context.operationId,project,createdAt,empty:empty===true,observed:{name:data.name,status:data.status,checkedAt:clock()},...(ownerAuthorization?{ownerSourceAuthorization:ownerAuthorization}:{})};return { project, createdAt:evidence.createdAt, foreignState: empty !== true, evidence,evidenceSha256: digest(evidence),...(ownerAuthorization?{ownerSourceAuthorization:ownerAuthorization}:{}) };
    }
    /** @param {Context} context */
    function deletable(context) {
        ensure(context.purpose !== 'source', 'PERSISTENT_SOURCE_DELETION_FORBIDDEN');
        const project = context.manifest.target;
        ensure(project && refPattern.test(project.ref) && !context.manifest.preservedRefs.includes(project.ref), 'PRESERVED_PROJECT_FORBIDDEN');
        ensure(context.manifest.cleanup.resources.some(r => r.provider === 'supabase' && r.id === project.ref && r.runId === context.manifest.runId && r.disposition === 'disposable'), 'CLEANUP_OWNERSHIP_MISMATCH');
        return project;
    }
    /** @param {Context} context */
    async function remove(context) {
        const project = deletable(context);
        ensure(context.manifest.pending?.operationId === context.operationId && context.manifest.pending.resourceId === project.ref && ['retire-source', 'cleanup-resource'].includes(context.manifest.pending.step), 'PERSISTED_INTENT_REQUIRED');
        ensure(project.ref !== context.manifest.source?.ref, 'PERSISTENT_SOURCE_DELETION_FORBIDDEN');
        ensure(!mutations.has(context.operationId), 'MUTATION_ALREADY_ATTEMPTED');
        const data = await call(`/projects/${project.ref}`);
        ensure(data.ref === project.ref && data.organization_slug === project.organizationId && data.region === project.region, 'TARGET_IDENTITY_MISMATCH');
        mutations.add(context.operationId);
        await call(`/projects/${project.ref}`, 'DELETE');
    }
    /** @param {Context} context */
    async function readAbsent(context) {
        const project = deletable(context);
        return readOwnedDisposableAbsent({manifest:context.manifest,resourceId:project.ref});
    }
    /** Read-only historical reconciliation never broadens DELETE authority.
     * @param {{manifest:import('./manifest.mjs').OperationsManifest,resourceId:string}} context */
    async function readOwnedDisposableAbsent({manifest,resourceId}) {
        ensure(resourceId !== manifest.source?.ref, 'PERSISTENT_SOURCE_DELETION_FORBIDDEN');
        ensure(refPattern.test(resourceId) && !manifest.preservedRefs.includes(resourceId), 'PRESERVED_PROJECT_FORBIDDEN');
        const owned=manifest.cleanup.resources.filter(r=>r.provider==='supabase'&&r.id===resourceId);
        ensure(owned.length===1 && owned[0].runId===manifest.runId && owned[0].disposition==='disposable', 'CLEANUP_OWNERSHIP_MISMATCH');
        const projects = await call('/projects');
        ensure(Array.isArray(projects) && projects.every(p=>refPattern.test(p.ref)), 'PROVIDER_INVENTORY_INVALID');
        const direct = await call(`/projects/${resourceId}`, 'GET', undefined, true);
        const absent = !projects.some(p => p.ref === resourceId) && direct === null;
        const evidence={schemaVersion:1,kind:'issue29-supabase-absence',runId:manifest.runId,projectRef:resourceId,inventoryAbsent:!projects.some(p=>p.ref===resourceId),directStatus:direct===null?404:null,absent,checkedAt:clock()};
        return { absent, evidence, evidenceSha256: digest(evidence) };
    }
    /** @param {import('./operator.mjs').MaintenanceContext} context */
    async function sourceStatus(context) { const source = context.manifest.source; ensure(source && !context.manifest.preservedRefs.includes(source.ref) && context.manifest.cleanup.resources.some(r => r.provider === 'supabase' && r.id === source.ref && r.disposition === 'persistent' && r.runId === context.manifest.runId && r.absentAt === null), 'PERSISTENT_SOURCE_REQUIRED'); const data = await call(`/projects/${source.ref}`); const version = /^([0-9]+\.[0-9]+)/u.exec(data.database?.version ?? '')?.[1]; ensure(data.ref === source.ref && data.organization_slug === source.organizationId && data.region === source.region && version === source.postgresVersion, 'SOURCE_PAUSE_RESUME_IDENTITY_MISMATCH'); return { source, data }; }
    /** @param {import('./operator.mjs').MaintenanceContext} context @param {boolean} pausing */
    async function changeSource(context, pausing) { const m = context.manifest; ensure(m.pending?.operationId === context.operationId && m.pending.step === (pausing ? 'pause-source' : 'resume-source') && m.pending.resourceId === m.source?.ref && m.maintenance?.phase === (pausing ? 'pause_pending' : 'resume_pending') && m.maintenance.sourceRef === m.source?.ref && m.pending.priorStateSha256 === digest(m.maintenance.preservation) && m.state === (pausing ? 'source_pause_pending' : 'source_resume_pending') && m.allowedActions.includes(pausing ? 'pause-source' : 'resume-source'), 'PERSISTED_INTENT_REQUIRED'); if (pausing)
        ensure(Date.parse(clock()) < Date.parse(m.maintenance.expiresAt), 'MAINTENANCE_EXPIRED'); ensure(!mutations.has(context.operationId), 'MUTATION_ALREADY_ATTEMPTED'); const { source, data } = await sourceStatus(context); ensure(data.status === (pausing ? 'ACTIVE_HEALTHY' : 'INACTIVE'), 'SOURCE_STATUS_MISMATCH'); mutations.add(context.operationId); await call(`/projects/${source.ref}/${pausing ? 'pause' : 'restore'}`, 'POST'); }
    /** @param {import('./operator.mjs').MaintenanceContext} context @param {boolean} paused @returns {Promise<import('./operator.mjs').SourceStatusReadback>} */
    async function sourceReadback(context, paused) { const { source, data } = await sourceStatus(context); ensure(data.status === (paused ? 'INACTIVE' : 'ACTIVE_HEALTHY') && context.manifest.maintenance, 'SOURCE_STATUS_MISMATCH'); const identitySha256 = sourceIdentitySha256(source); const preservation = context.manifest.maintenance.preservation; const preservationSha256 = digest(preservation); const evidence = { projectRef: source.ref, status: data.status, identitySha256, preservationSha256, checkedAt: clock(), configurationObserved: false }; return { project: source, status: paused ? 'INACTIVE' : 'ACTIVE_HEALTHY', identitySha256, preservationSha256, configurationObserved: false, evidence, evidenceSha256: digest(evidence) }; }
    return { preflight, create, readCreated, remove, readAbsent, readOwnedDisposableAbsent, pauseSource: (/** @type {import('./operator.mjs').MaintenanceContext} */ context) => changeSource(context, true), readPaused: (/** @type {import('./operator.mjs').MaintenanceContext} */ context) => sourceReadback(context, true), resumeSource: (/** @type {import('./operator.mjs').MaintenanceContext} */ context) => changeSource(context, false), readResumed: (/** @type {import('./operator.mjs').MaintenanceContext} */ context) => sourceReadback(context, false) };
}
/** @typedef {{schemaVersion:1,policy:'supabase-free-two-active-projects',organizationId:string,preservedStagingRef:string,authorizedAt:string,expiresAt:string,maximumActiveProjects:2,maximumCost:0,evidenceSha256:string}} TwoSlotAuthorization */
/** @typedef {{schemaVersion:1,policy:'issue29-owner-authorized-pending-source-readback',runId:string,operationId:string,organizationId:string,projectRef:string,region:string,sourceName:string,observedCreatedAt:string,authorizedAt:string,expiresAt:string,evidenceSha256:string,originalIntentSha256:string}} OwnerSourceAuthorization */
/** Owner-attested operating envelope is combined with fresh provider observations; never treated as an inventory. @param {unknown} input @param {{organizationId:string,preservedRefs:string[],now:string}} expected @returns {TwoSlotAuthorization} */
export function validateTwoSlotAuthorization(input, expected) { const v = /** @type {TwoSlotAuthorization} */ (input); const keys = ['schemaVersion', 'policy', 'organizationId', 'preservedStagingRef', 'authorizedAt', 'expiresAt', 'maximumActiveProjects', 'maximumCost', 'evidenceSha256']; ensure(v && Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key)) && v.schemaVersion === 1 && v.policy === 'supabase-free-two-active-projects' && v.organizationId === expected.organizationId && expected.preservedRefs.includes(v.preservedStagingRef) && v.maximumActiveProjects === 2 && v.maximumCost === 0 && /^[a-f0-9]{64}$/u.test(v.evidenceSha256), 'TWO_SLOT_AUTHORIZATION_REQUIRED'); ensure(Number.isFinite(Date.parse(v.authorizedAt)) && Date.parse(v.authorizedAt) <= Date.parse(expected.now) && Date.parse(expected.now) < Date.parse(v.expiresAt), 'TWO_SLOT_AUTHORIZATION_EXPIRED'); return v; }
/** A narrowly attested source can only satisfy the already-persisted source readback.
 * It never authorizes creation, targets, preserved/forbidden projects, or an owned source.
 * `observedCreatedAt` may be omitted only while the operator validates the immutable
 * preimage; the provider adapter later binds it to the provider's exact readback.
 * @param {unknown} input @param {{manifest:import('./manifest.mjs').OperationsManifest,operationId:string,purpose:'source'|'target',sourceRef:string,sourceName:string,observedCreatedAt?:string,now:string}} expected @returns {OwnerSourceAuthorization} */
export function validateOwnerSourceAuthorization(input, expected) {
    const v = /** @type {OwnerSourceAuthorization} */ (input);
    const keys = ['schemaVersion','policy','runId','operationId','organizationId','projectRef','region','sourceName','observedCreatedAt','authorizedAt','expiresAt','evidenceSha256','originalIntentSha256'];
    ensure(v && Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key)) && v.schemaVersion === 1 && v.policy === 'issue29-owner-authorized-pending-source-readback' && typeof v.organizationId === 'string' && v.organizationId.length > 0 && v.organizationId.length <= 63 && refPattern.test(v.projectRef) && typeof v.region === 'string' && v.region.length > 0 && v.region.length <= 63 && typeof v.sourceName === 'string' && v.sourceName.length > 0 && v.sourceName.length <= 128 && /^[a-f0-9]{64}$/u.test(v.evidenceSha256) && /^[a-f0-9]{64}$/u.test(v.originalIntentSha256), 'OWNER_SOURCE_AUTHORIZATION_REQUIRED');
    const m = expected.manifest;
    ensure(expected.purpose === 'source' && m.state === 'source_creation_pending' && m.pending?.step === 'create-source' && m.pending.operationId === expected.operationId && m.source === null && m.target === null && !m.preservedRefs.includes(expected.sourceRef) && !m.forbiddenRefs.includes(expected.sourceRef) && !m.cleanup.resources.some(r => r.provider === 'supabase' && r.id === expected.sourceRef && r.runId === m.runId), 'OWNER_SOURCE_AUTHORIZATION_SCOPE_FORBIDDEN');
    ensure(v.runId === m.runId && v.operationId === expected.operationId && v.organizationId === m.provisioning.organizationId && v.projectRef === expected.sourceRef && v.region === m.provisioning.region && v.sourceName === expected.sourceName && (expected.observedCreatedAt === undefined || v.observedCreatedAt === expected.observedCreatedAt), 'OWNER_SOURCE_AUTHORIZATION_MISMATCH');
    ensure(Number.isFinite(Date.parse(v.observedCreatedAt)) && Date.parse(v.observedCreatedAt) <= Date.parse(expected.now) + 300000, 'CREATION_TIME_MISMATCH');
    ensure(Number.isFinite(Date.parse(v.authorizedAt)) && Number.isFinite(Date.parse(v.expiresAt)) && Date.parse(v.authorizedAt) <= Date.parse(expected.now) && Date.parse(expected.now) < Date.parse(v.expiresAt), 'OWNER_SOURCE_AUTHORIZATION_EXPIRED');
    return v;
}
/** @param {import('./manifest.mjs').ProjectIdentity} source */
export function sourceIdentitySha256(source) { return digest({ organizationId: source.organizationId, ref: source.ref, region: source.region, url: source.url, postgresVersion: source.postgresVersion }); }
