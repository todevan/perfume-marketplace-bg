import {
	chmodSync,
	existsSync,
	readFileSync,
	realpathSync,
	renameSync,
	writeFileSync
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {Record<string, string | undefined>} Environment */
/** @typedef {{ origin: string, supabaseUrl: string, publishableKey: string, projectRef: string, parentProjectRef: string, branchName: string, candidateSha: string, runId: string, workerName: string, versionId: string, provenancePath: string }} HostedTarget */
/** @typedef {{ label: string, email: string, userId: string | null }} ProvenanceActor */
/** @typedef {{ origin: string, supabaseUrl: string, projectRef: string, parentProjectRef: string, branchName: string, candidateSha: string, runId: string, workerName: string, versionId: string }} TargetIdentity */
/** @typedef {{ schemaVersion: number, state: 'attested' | 'cleaned', target: TargetIdentity, attestation: Record<string, unknown>, actors: ProvenanceActor[], cleanup?: Record<string, unknown> }} ProvenanceManifest */

export const ISSUE22_PARENT_PROJECT_REF = 'nuhkpqjjyuygiemrxbdp';
export const ISSUE22_WORKERS_DEV_SUFFIX = '.perfume-marketplace-bg.workers.dev';
const workerPrefix = 'perfume-marketplace-bg-issue22-';
const branchPrefix = 'issue-22-';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {Environment} environment @param {string} name */
function required(environment, name) {
	const value = environment[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

/** @param {string} value @returns {Record<string, unknown> | null} */
function decodeJwtPayload(value) {
	const parts = value.split('.');
	if (parts.length !== 3) return null;
	try {
		return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
	} catch {
		return null;
	}
}

/** @param {string} value */
export function assertPublishableKey(value) {
	if (!value || value.startsWith('sb_secret_') || /service[_-]?role/iu.test(value)) {
		throw new Error('Hosted public key has a privileged key shape.');
	}
	const payload = decodeJwtPayload(value);
	if (payload?.role === 'service_role') {
		throw new Error('Hosted public key JWT carries the service_role claim.');
	}
	return value;
}

/** @param {string} value */
function assertServiceKey(value) {
	const payload = decodeJwtPayload(value);
	if (!value || (!value.startsWith('sb_secret_') && payload?.role !== 'service_role')) {
		throw new Error('Cleanup requires an env-only Supabase service key.');
	}
	return value;
}

/** @param {string} rawPath */
function privateManifestPath(rawPath) {
	if (!isAbsolute(rawPath) || !rawPath.endsWith('.json')) {
		throw new Error('ISSUE22_PROVENANCE_PATH must be an absolute JSON path.');
	}
	const parent = realpathSync(dirname(rawPath));
	const path = join(parent, basename(rawPath));
	const relation = relative(repositoryRoot, path);
	if (relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))) {
		throw new Error('The provenance manifest must be outside the repository.');
	}
	return path;
}

/** @param {Environment} [environment] @returns {HostedTarget} */
export function parseHostedTarget(environment = process.env) {
	const origin = new URL(required(environment, 'ISSUE22_HOSTED_ORIGIN'));
	const supabaseUrl = new URL(required(environment, 'ISSUE22_SUPABASE_URL'));
	const projectRef = required(environment, 'ISSUE22_SUPABASE_PROJECT_REF');
	const parentProjectRef = required(environment, 'ISSUE22_SUPABASE_PARENT_PROJECT_REF');
	const branchName = required(environment, 'ISSUE22_SUPABASE_BRANCH_NAME');
	const candidateSha = required(environment, 'ISSUE22_CANDIDATE_SHA');
	const runId = required(environment, 'ISSUE22_RUN_ID');
	const workerName = required(environment, 'ISSUE22_CLOUDFLARE_WORKER_NAME');
	const versionId = required(environment, 'ISSUE22_CLOUDFLARE_VERSION_ID');
	if (parentProjectRef !== ISSUE22_PARENT_PROJECT_REF) {
		throw new Error('Issue 22 parent project is not allowlisted.');
	}
	if (!branchName.startsWith(branchPrefix) || branchName.length > 48) {
		throw new Error('Issue 22 preview branch name is outside the allowlist.');
	}
	if (projectRef === parentProjectRef || !/^[a-z]{20}$/u.test(projectRef)) {
		throw new Error('Issue 22 target must be a non-default child preview ref.');
	}
	if (!workerName.startsWith(workerPrefix) || !/^[a-z0-9-]{28,63}$/u.test(workerName)) {
		throw new Error('Issue 22 Worker name is outside the dedicated allowlist.');
	}
	if (
		origin.protocol !== 'https:' ||
		origin.pathname !== '/' ||
		origin.hostname !== `${workerName}${ISSUE22_WORKERS_DEV_SUFFIX}`
	) {
		throw new Error('Issue 22 origin does not match the dedicated workers.dev target.');
	}
	if (supabaseUrl.protocol !== 'https:' || supabaseUrl.hostname !== `${projectRef}.supabase.co`) {
		throw new Error('Supabase URL and child project ref do not match.');
	}
	if (!/^[0-9a-f]{40}$/u.test(candidateSha)) {
		throw new Error('ISSUE22_CANDIDATE_SHA must be an exact Git SHA.');
	}
	if (!/^[a-z0-9-]{3,12}$/u.test(runId)) {
		throw new Error('ISSUE22_RUN_ID must be a 3-12 character cleanup label.');
	}
	if (!/^[0-9a-f-]{20,64}$/iu.test(versionId)) {
		throw new Error('Cloudflare version ID has an invalid shape.');
	}
	return {
		origin: origin.origin,
		supabaseUrl: supabaseUrl.origin,
		publishableKey: assertPublishableKey(required(environment, 'ISSUE22_SUPABASE_PUBLISHABLE_KEY')),
		projectRef,
		parentProjectRef,
		branchName,
		candidateSha,
		runId,
		workerName,
		versionId,
		provenancePath: privateManifestPath(required(environment, 'ISSUE22_PROVENANCE_PATH'))
	};
}

/** @param {Record<string, any> | undefined | null} object @param {string[]} names @returns {any} */
function field(object, names) {
	for (const name of names) if (object?.[name] !== undefined) return object[name];
	return undefined;
}

/** @param {any} value @param {string} key @returns {any[]} */
function listFrom(value, key) {
	if (Array.isArray(value)) return value;
	if (Array.isArray(value?.[key])) return value[key];
	return [];
}

/**
 * @param {{ branchName: string, projectRef: string, parentProjectRef: string, candidateSha: string, versionId: string }} target
 * @param {Record<string, any>} evidence
 */
export function assertProviderAttestation(target, evidence) {
	if (evidence.headSha !== target.candidateSha) throw new Error('Git HEAD is not the candidate SHA.');
	const branch = Array.isArray(evidence.branch) ? evidence.branch[0] : evidence.branch;
	if (!branch || field(branch, ['name', 'branch_name']) !== target.branchName) {
		throw new Error('Supabase branch name attestation failed.');
	}
	if (field(branch, ['project_ref', 'projectRef', 'preview_project_ref', 'ref']) !== target.projectRef) {
		throw new Error('Supabase child project ref attestation failed.');
	}
	const reportedParent = field(branch, ['parent_project_ref', 'parentProjectRef']);
	if (reportedParent !== undefined && reportedParent !== target.parentProjectRef) {
		throw new Error('Supabase parent project attestation failed.');
	}
	if (field(branch, ['is_default', 'isDefault', 'default']) !== false) {
		throw new Error('Supabase branch was not proven non-default.');
	}
	const status = String(field(branch, ['status', 'health_status', 'healthStatus']) ?? '');
	if (!/(healthy|active|running|deployed|passed)/iu.test(status)) {
		throw new Error('Supabase branch was not proven healthy.');
	}
	for (const name of ['with_data', 'withData', 'data_cloned', 'dataCloned', 'is_data_clone']) {
		if (branch[name] !== undefined && branch[name] !== false) {
			throw new Error('Supabase branch metadata reports a data clone.');
		}
	}

	const versions = listFrom(evidence.versions, 'versions');
	const version = versions.find((item) => field(item, ['id', 'version_id']) === target.versionId);
	if (!version) throw new Error('Exact Cloudflare version was not found.');
	const annotations = version.annotations ?? {};
	const metadata = version.metadata ?? {};
	const tag = field(version, ['tag']) ?? metadata.tag ?? annotations['workers/tag'];
	const message = field(version, ['message']) ?? metadata.message ?? annotations['workers/message'];
	if (tag !== target.candidateSha && !String(message ?? '').includes(target.candidateSha)) {
		throw new Error('Cloudflare version is not bound to the candidate SHA.');
	}

	const deployments = listFrom(evidence.deployments, 'deployments');
	const active = deployments[0];
	const activeVersions = listFrom(active?.versions ?? active?.version_traffic, 'versions');
	const allocation = activeVersions.find(
		(item) => field(item, ['version_id', 'versionId', 'id']) === target.versionId
	);
	if (!allocation || Number(field(allocation, ['percentage', 'percent', 'traffic']) ?? 0) !== 100) {
		throw new Error('Candidate Cloudflare version is not the active 100% deployment.');
	}
	return { branchStatus: status, dataClone: false };
}

/** @param {string} command @param {string[]} args */
function runCommand(command, args) {
	const result = spawnSync(command, args, {
		cwd: repositoryRoot,
		encoding: 'utf8',
		windowsHide: true,
		maxBuffer: 8 * 1024 * 1024
	});
	if (result.status !== 0) throw new Error('Authenticated provider attestation command failed.');
	return result.stdout.trim();
}

/** @param {string} value @returns {any} */
function parseCommandJson(value) {
	try {
		return JSON.parse(value);
	} catch {
		throw new Error('Provider attestation returned invalid JSON.');
	}
}

/** @param {HostedTarget} target @returns {TargetIdentity} */
function targetIdentity(target) {
	return {
		origin: target.origin,
		supabaseUrl: target.supabaseUrl,
		projectRef: target.projectRef,
		parentProjectRef: target.parentProjectRef,
		branchName: target.branchName,
		candidateSha: target.candidateSha,
		runId: target.runId,
		workerName: target.workerName,
		versionId: target.versionId
	};
}

/** @param {string} path @param {unknown} value */
function writePrivateManifest(path, value) {
	const temporary = `${path}.tmp-${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
	chmodSync(temporary, 0o600);
	renameSync(temporary, path);
	chmodSync(path, 0o600);
}

/** @param {HostedTarget} target @returns {ProvenanceManifest} */
function readManifest(target) {
	if (!existsSync(target.provenancePath)) throw new Error('Private provenance manifest does not exist.');
	const manifest = JSON.parse(readFileSync(target.provenancePath, 'utf8'));
	if (JSON.stringify(manifest.target) !== JSON.stringify(targetIdentity(target))) {
		throw new Error('Private provenance manifest target binding failed.');
	}
	return manifest;
}

/** @param {HostedTarget} target @param {Record<string, unknown>} attestation @param {() => string} [now] */
export function initializeManifest(target, attestation, now = () => new Date().toISOString()) {
	if (existsSync(target.provenancePath)) {
		const existing = readManifest(target);
		if (existing.state !== 'cleaned') throw new Error('An uncleared Issue 22 provenance manifest already exists.');
	}
	const manifest = {
		schemaVersion: 1,
		state: 'attested',
		target: targetIdentity(target),
		attestation: { verifiedAt: now(), ...attestation },
		actors: []
	};
	writePrivateManifest(target.provenancePath, manifest);
	return manifest;
}

/** @param {HostedTarget} target */
function attest(target) {
	const supabaseCli = join(repositoryRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
	const wranglerCli = join(repositoryRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
	const evidence = {
		headSha: runCommand('git', ['rev-parse', 'HEAD']),
		branch: parseCommandJson(
			runCommand(process.execPath, [
				supabaseCli,
				'branches',
				'get',
				target.branchName,
				'--project-ref',
				target.parentProjectRef,
				'--output-format',
				'json',
				'--experimental'
			])
		),
		versions: parseCommandJson(
			runCommand(process.execPath, [wranglerCli, 'versions', 'list', '--name', target.workerName, '--json'])
		),
		deployments: parseCommandJson(
			runCommand(process.execPath, [wranglerCli, 'deployments', 'list', '--name', target.workerName, '--json'])
		)
	};
	return initializeManifest(target, assertProviderAttestation(target, evidence));
}

/** @param {HostedTarget} target @param {(manifest: ProvenanceManifest) => ProvenanceManifest} updater */
function updateManifest(target, updater) {
	const manifest = readManifest(target);
	const updated = updater(structuredClone(manifest));
	writePrivateManifest(target.provenancePath, updated);
	return updated;
}

/** @param {HostedTarget} target @param {Environment} environment */
function recordIntent(target, environment) {
	const label = required(environment, 'ISSUE22_ACTOR_LABEL');
	const actorEmail = required(environment, 'ISSUE22_ACTOR_EMAIL');
	if (!/^[a-z0-9-]{1,32}$/u.test(label)) throw new Error('Actor label has an invalid shape.');
	const expectedPrefix = `issue22-${target.runId}-${target.candidateSha.slice(0, 8)}-`;
	if (!actorEmail.startsWith(expectedPrefix) || !actorEmail.endsWith('@example.invalid')) {
		throw new Error('Actor email is outside the cleanup provenance namespace.');
	}
	updateManifest(target, (manifest) => {
		if (manifest.state !== 'attested') throw new Error('Cannot add intent to a closed manifest.');
		const existing = manifest.actors.find((actor) => actor.label === label);
		if (existing && existing.email !== actorEmail) throw new Error('Actor label is already bound.');
		if (!existing) manifest.actors.push({ label, email: actorEmail, userId: null });
		return manifest;
	});
}

/** @param {HostedTarget} target @param {Environment} environment */
function recordActor(target, environment) {
	const label = required(environment, 'ISSUE22_ACTOR_LABEL');
	const userId = required(environment, 'ISSUE22_ACTOR_USER_ID');
	if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(userId)) throw new Error('Actor user ID has an invalid shape.');
	updateManifest(target, (manifest) => {
		const actor = manifest.actors.find((item) => item.label === label);
		if (!actor) throw new Error('Actor ID cannot be recorded without pre-mutation intent.');
		if (actor.userId && actor.userId !== userId) throw new Error('Actor label is already bound to another ID.');
		actor.userId = userId;
		return manifest;
	});
}

/** @param {HostedTarget} target @param {string} serviceKey @param {string} path @param {RequestInit} [init] */
async function adminRequest(target, serviceKey, path, init = {}) {
	return fetch(`${target.supabaseUrl}${path}`, {
		...init,
		headers: {
			apikey: serviceKey,
			authorization: `Bearer ${serviceKey}`,
			'content-type': 'application/json',
			...init.headers
		}
	});
}

/** @param {HostedTarget} target @param {string} serviceKey @returns {Promise<Array<{ id: string, email?: string }>>} */
async function listUsers(target, serviceKey) {
	/** @type {Array<{ id: string, email?: string }>} */
	const users = [];
	for (let page = 1; page <= 20; page += 1) {
		const response = await adminRequest(target, serviceKey, `/auth/v1/admin/users?page=${page}&per_page=1000`);
		if (!response.ok) throw new Error('Supabase admin user inventory failed.');
		const payload = await response.json();
		const batch = Array.isArray(payload) ? payload : payload.users;
		if (!Array.isArray(batch)) throw new Error('Supabase admin user inventory shape is invalid.');
		users.push(...batch);
		if (batch.length < 1000) return users;
	}
	throw new Error('Supabase admin user inventory exceeded its safety bound.');
}

/** @param {HostedTarget} target @param {string} serviceKey @param {string} table @param {string} column @param {string[]} ids @returns {Promise<any[]>} */
async function residualRows(target, serviceKey, table, column, ids) {
	if (ids.length === 0) return [];
	const filter = `in.(${ids.join(',')})`;
	const response = await adminRequest(
		target,
		serviceKey,
		`/rest/v1/${table}?select=${column}&${column}=${encodeURIComponent(filter)}`
	);
	if (!response.ok) throw new Error(`Residual ${table} readback failed.`);
	return response.json();
}

/** @param {HostedTarget} target @param {Environment} environment */
async function cleanup(target, environment) {
	const manifest = readManifest(target);
	if (manifest.state === 'cleaned') return manifest.cleanup;
	const serviceKey = assertServiceKey(required(environment, 'ISSUE22_SUPABASE_SERVICE_KEY'));
	if (serviceKey === target.publishableKey) throw new Error('Cleanup key must not equal the publishable key.');
	const intendedEmails = new Set(manifest.actors.map((actor) => actor.email));
	const before = await listUsers(target, serviceKey);
	/** @type {Set<string>} */
	const userIds = new Set();
	for (const actor of manifest.actors) if (actor.userId) userIds.add(actor.userId);
	for (const user of before) if (user.email && intendedEmails.has(user.email)) userIds.add(user.id);
	for (const userId of userIds) {
		const response = await adminRequest(target, serviceKey, `/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
		if (!response.ok && response.status !== 404) throw new Error('Supabase synthetic user cleanup failed.');
	}
	const after = await listUsers(target, serviceKey);
	const residualUsers = after.filter(
		(user) => (Boolean(user.email) && intendedEmails.has(user.email ?? '')) || userIds.has(user.id)
	);
	const ids = [...userIds];
	const [profiles, memberships, consents] = await Promise.all([
		residualRows(target, serviceKey, 'profiles', 'id', ids),
		residualRows(target, serviceKey, 'beta_memberships', 'profile_id', ids),
		residualRows(target, serviceKey, 'beta_consent_events', 'profile_id', ids)
	]);
	const residualCounts = {
		authUsers: residualUsers.length,
		profiles: profiles.length,
		memberships: memberships.length,
		consents: consents.length
	};
	if (Object.values(residualCounts).some((count) => count !== 0)) {
		throw new Error('Synthetic actor cleanup residual readback failed.');
	}
	const cleaned = {
		completedAt: new Date().toISOString(),
		deletedUserCount: userIds.size,
		residualCounts
	};
	updateManifest(target, (value) => ({ ...value, state: 'cleaned', cleanup: cleaned }));
	return cleaned;
}

/** @param {string} action @param {Environment} [environment] */
export async function runIssue22HostedProof(action, environment = process.env) {
	const target = parseHostedTarget(environment);
	switch (action) {
		case 'attest':
			attest(target);
			return { ok: true, action, candidateSha: target.candidateSha, versionId: target.versionId };
		case 'record-intent':
			recordIntent(target, environment);
			return { ok: true, action, label: required(environment, 'ISSUE22_ACTOR_LABEL') };
		case 'record-actor':
			recordActor(target, environment);
			return { ok: true, action, label: required(environment, 'ISSUE22_ACTOR_LABEL') };
		case 'cleanup': {
			const result = await cleanup(target, environment);
			return { ok: true, action, ...result };
		}
		default:
			throw new Error('Expected attest, record-intent, record-actor, or cleanup.');
	}
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
	runIssue22HostedProof(process.argv[2])
		.then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
		.catch((error) => {
			process.stderr.write(`Issue 22 hosted proof helper failed: ${error.message}\n`);
			process.exitCode = 1;
		});
}
