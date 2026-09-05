import { createHash } from 'node:crypto';
import { canonicalJson } from './recovery-set.mjs';
import { ensure, OperationsError, validateProviderPreflight } from './manifest.mjs';

const root = 'https://api.supabase.com/v1';
const refPattern = /^[a-z]{20}$/u;
/** @param {unknown} value */
const digest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
/** @typedef {import('./operator.mjs').LifecycleContext} Context */
/** @typedef {{organizationId:string,checkedAt:string,projectLimit:number,availableProjects:number,quotedCost:number,currency:string,deletionAuthorized:boolean,evidenceSha256:string}} CapacityQuote */

/** Real, narrow Management API adapter. The public API does not expose the account-wide
 * free-slot/cost quote: a separate LIVE authenticated provider capability must supply it.
 * A configured plan, documentation, or user-written boolean is not that capability.
 * @param {{token:string,fetch?:typeof fetch,clock?:()=>string,readCapacityQuote?:(organizationId:string)=>Promise<CapacityQuote>,databasePassword?:(purpose:'source'|'target')=>Promise<string>,inspectEmpty?:(project:import('./manifest.mjs').ProjectIdentity)=>Promise<boolean>}} options
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
      const response = await request(`${root}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (allowMissing && response.status === 404) return null;
      if (method === 'DELETE' && response.status === 204) return null;
      ensure(response.ok && response.body, method === 'GET' ? 'PROVIDER_READ_FAILED' : 'PROVIDER_MUTATION_UNCERTAIN');
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; ensure(size <= 2_097_152, 'PROVIDER_RESPONSE_LIMIT'); chunks.push(Buffer.from(part.value)); } }
      finally { await reader.cancel(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof OperationsError) throw error;
      throw new OperationsError(method === 'GET' ? 'PROVIDER_READ_FAILED' : 'PROVIDER_MUTATION_UNCERTAIN');
    }
  }
  /** @param {Context} context */
  async function preflight(context) {
    const { organizationId, region } = context.manifest.provisioning;
    ensure(/^[a-z0-9-]{1,63}$/u.test(organizationId) && /^[a-z0-9-]{1,63}$/u.test(region), 'PROVIDER_PREFLIGHT_IDENTITY_MISMATCH');
    const organization = await call(`/organizations/${organizationId}`);
    ensure(organization.id === organizationId && organization.plan === 'free', 'ZERO_COST_REQUIRED');
    const projects = await call('/projects'); ensure(Array.isArray(projects) && projects.every(p => refPattern.test(p.ref)), 'PROVIDER_INVENTORY_INVALID');
    const regions = await call(`/projects/available-regions?organization_slug=${organizationId}`);
    const available = regions.all?.specific?.some(/** @param {{code:string,status?:string}} r */ r => r.code === region && !r.status);
    ensure(available === true, 'PROVIDER_REGION_UNAVAILABLE');
    ensure(options.readCapacityQuote, 'PROVIDER_CAPACITY_HANDOFF_REQUIRED');
    const quote = await options.readCapacityQuote(organizationId);
    ensure(quote.organizationId === organizationId && Number.isFinite(Date.parse(quote.checkedAt)) && Date.parse(clock()) - Date.parse(quote.checkedAt) >= 0 && Date.parse(clock()) - Date.parse(quote.checkedAt) <= 300000 && /^[a-f0-9]{64}$/u.test(quote.evidenceSha256), 'PROVIDER_QUOTE_STALE');
    const inventoryRefs = projects.map(p => p.ref).sort();
    const activeProjectCount = projects.filter(p => p.organization_slug === organizationId && !['INACTIVE','REMOVED'].includes(p.status)).length;
    const evidence = { organizationId, region, checkedAt: clock(), expiresAt: new Date(Date.parse(clock()) + 300000).toISOString(), plan: 'free', projectLimit: quote.projectLimit, activeProjectCount,
      availableProjects: quote.availableProjects, quotedCost: quote.quotedCost, currency: quote.currency, deletionSupported: quote.deletionAuthorized, regionAvailable: true, inventoryRefs };
    return validateProviderPreflight({ ...evidence, evidenceSha256: digest({ evidence, quoteSha256: quote.evidenceSha256 }) }, { organizationId, region, preservedRefs: context.manifest.preservedRefs, now: clock() });
  }
  /** @param {Context} context */
  async function create(context) {
    const { manifest, operationId, purpose } = context;
    ensure(manifest.pending?.operationId === operationId && manifest.pending.step === `create-${purpose}` && manifest.state === `${purpose === 'source' ? 'source' : 'target'}_creation_pending`, 'PERSISTED_INTENT_REQUIRED');
    ensure(!mutations.has(operationId), 'MUTATION_ALREADY_ATTEMPTED');
    const name = purpose === 'source' ? manifest.provisioning.sourceName : manifest.provisioning.targetName;
    ensure(name.includes(manifest.runId) && options.databasePassword, 'SOURCE_RUN_BINDING_REQUIRED');
    await preflight(context);
    const projects = await call('/projects');
    ensure(!projects.some(/** @param {{name:string}} p */ p => p.name === name), 'PROJECT_NAME_COLLISION');
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
    const matches = (await call('/projects')).filter(/** @param {{name:string}} p */ p => p.name === name);
    ensure(matches.length === 1, 'PROJECT_CREATION_UNCERTAIN');
    const data = await call(`/projects/${matches[0].ref}`);
    ensure(data.name === name && data.organization_slug === manifest.provisioning.organizationId && data.region === manifest.provisioning.region && data.status === 'ACTIVE_HEALTHY' && !manifest.forbiddenRefs.includes(data.ref), 'TARGET_IDENTITY_MISMATCH');
    ensure(Date.parse(data.created_at) >= Date.parse(manifest.pending.startedAt) - 1000, 'CREATION_TIME_MISMATCH');
    const version = /^([0-9]+\.[0-9]+)(?:\.[0-9]+)?/u.exec(data.database?.version ?? '')?.[1]; ensure(version, 'POSTGRES_VERSION_UNPROVEN');
    const project = { organizationId: data.organization_slug, ref: data.ref, region: data.region, environment: purpose === 'source' ? 'synthetic' : 'disposable', url: `https://${data.ref}.supabase.co`, postgresVersion: version, classification: 'synthetic-owner-controlled' };
    const empty = await options.inspectEmpty(project);
    return { project, createdAt: new Date(data.created_at).toISOString(), foreignState: empty !== true, evidenceSha256: digest({ project, createdAt: data.created_at, empty }) };
  }
  /** @param {Context} context */
  function deletable(context) {
    const project = context.purpose === 'source' ? context.manifest.source : context.manifest.target;
    ensure(project && refPattern.test(project.ref) && !context.manifest.preservedRefs.includes(project.ref), 'PRESERVED_PROJECT_FORBIDDEN');
    ensure(context.manifest.cleanup.resources.some(r => r.provider === 'supabase' && r.id === project.ref && r.runId === context.manifest.runId && r.disposition === 'disposable'), 'CLEANUP_OWNERSHIP_MISMATCH');
    return project;
  }
  /** @param {Context} context */
  async function remove(context) {
    const project = deletable(context);
    ensure(context.manifest.pending?.operationId === context.operationId && context.manifest.pending.resourceId === project.ref && ['retire-source','cleanup-resource'].includes(context.manifest.pending.step), 'PERSISTED_INTENT_REQUIRED');
    ensure(!mutations.has(context.operationId), 'MUTATION_ALREADY_ATTEMPTED');
    const data = await call(`/projects/${project.ref}`);
    ensure(data.ref === project.ref && data.organization_slug === project.organizationId && data.region === project.region, 'TARGET_IDENTITY_MISMATCH');
    mutations.add(context.operationId); await call(`/projects/${project.ref}`, 'DELETE');
  }
  /** @param {Context} context */
  async function readAbsent(context) {
    const project = deletable(context);
    const projects = await call('/projects'); ensure(Array.isArray(projects), 'PROVIDER_INVENTORY_INVALID');
    const direct = await call(`/projects/${project.ref}`, 'GET', undefined, true);
    const absent = !projects.some(p => p.ref === project.ref) && direct === null;
    return { absent, evidenceSha256: digest({ projectRef: project.ref, absent, checkedAt: clock() }) };
  }
  return { preflight, create, readCreated, remove, readAbsent };
}
