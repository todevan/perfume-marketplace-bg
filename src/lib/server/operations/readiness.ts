import { createHash, timingSafeEqual } from 'node:crypto';

export interface OperationsConfiguration {
	monitorToken?: string;
	environment: string;
	deploymentIdentity: string;
	expectedDeploymentIdentity?: string;
	supabaseOrigin: string;
	publicKey: string;
	serverKey?: string;
	migrationDigest?: string;
	schemaDigest?: string;
	sentinelBucket?: string;
	sentinelPath?: string;
	sentinelSha256?: string;
	canaryExpectedUtc: string;
	safetyWarningHours: number;
	safetyCriticalHours: number;
}


const SIGNAL_NAMES = ['health', 'auth', 'database', 'storage', 'email', 'deals', 'safety',
	'backup_freshness', 'monitor_heartbeat'] as const;
type SignalName = typeof SIGNAL_NAMES[number];
type Checkpoint = { deploymentIdentity: string; checkpointAt: string; ok: boolean; evidenceSha256: string };
type Snapshot = {
	schemaVersion: number; migrationDigest: string; schemaDigest: string;
	notificationsFailed: number; notificationsStale: number;
	emailDownstreamFailed: number; emailDownstreamMissing: number;
	cleanupRetries: number; cleanupDeadLetters: number; quarantineStuck: number;
	jobsHealthy: boolean; dealViolations: number; safetyViolations: number;
	reportQueueOldestAt: string | null; checkpoints: Record<string, Checkpoint>;
};
export interface OperationsSignal {
	environment: string; signal: SignalName; ok: boolean; severity: 'none' | 'warning' | 'critical';
	checkedAt: string; deploymentIdentity: string; correlationId: string;
	reasonCode: string; runbookAnchor: string;
}
const PRIVATE_HEADERS = { 'cache-control': 'private, no-store', 'vary': 'Authorization' };
const SHA256 = /^[0-9a-f]{64}$/;
const COUNT_FIELDS = ['notificationsFailed', 'notificationsStale', 'emailDownstreamFailed',
	'emailDownstreamMissing', 'cleanupRetries', 'cleanupDeadLetters', 'quarantineStuck',
	'dealViolations', 'safetyViolations'] as const;

function errorResponse(status: number, code: string) {
	return Response.json({ ok: false, code }, { status, headers: PRIVATE_HEADERS });
}

async function boundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
	if (!response.body || Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new Error('probe_failed');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let count = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			count += value.byteLength;
			if (count > maxBytes) { void reader.cancel().catch(() => undefined); throw new Error('probe_failed'); }
			chunks.push(value);
		}
	} finally { reader.releaseLock(); }
	const output = new Uint8Array(count);
	let offset = 0;
	for (const bytes of chunks) { output.set(bytes, offset); offset += bytes.byteLength; }
	return output;
}

function snapshotShape(value: unknown): value is Snapshot {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Record<string, unknown>;
	return candidate.schemaVersion === 1 && typeof candidate.migrationDigest === 'string' &&
		SHA256.test(candidate.migrationDigest) && typeof candidate.schemaDigest === 'string' && SHA256.test(candidate.schemaDigest) &&
		COUNT_FIELDS.every((field) => typeof candidate[field] === 'number' && Number.isSafeInteger(candidate[field]) && Number(candidate[field]) >= 0) &&
		typeof candidate.jobsHealthy === 'boolean' &&
		(candidate.reportQueueOldestAt === null || (typeof candidate.reportQueueOldestAt === 'string' && Number.isFinite(Date.parse(candidate.reportQueueOldestAt)))) &&
		candidate.checkpoints !== null && typeof candidate.checkpoints === 'object' && !Array.isArray(candidate.checkpoints);
}

function configurationValid(config: OperationsConfiguration): boolean {
	try {
		const origin = new URL(config.supabaseOrigin);
		return ['development', 'staging', 'production'].includes(config.environment) &&
			/^[0-9a-f]{40}$/.test(config.deploymentIdentity) && /^[0-9a-f]{40}$/.test(config.expectedDeploymentIdentity ?? '') &&
			(origin.protocol === 'https:' || (config.environment === 'development' && origin.protocol === 'http:' &&
				['127.0.0.1', 'localhost'].includes(origin.hostname))) && origin.origin === config.supabaseOrigin &&
			!origin.username && !origin.password && Boolean(config.publicKey) && Boolean(config.serverKey) &&
			SHA256.test(config.migrationDigest ?? '') && SHA256.test(config.schemaDigest ?? '') &&
			config.sentinelBucket === 'operations-sentinels' &&
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/sentinel\.bin$/.test(config.sentinelPath ?? '') &&
			SHA256.test(config.sentinelSha256 ?? '') && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(config.canaryExpectedUtc) && Number.isFinite(config.safetyWarningHours) &&
			config.safetyWarningHours > 0 && config.safetyCriticalHours > config.safetyWarningHours && config.safetyCriticalHours <= 48;
	} catch { return false; }
}

async function probe(config: OperationsConfiguration, fetcher: typeof fetch, now: number): Promise<OperationsSignal[]> {
	const signal = (name: SignalName, ok: boolean, reasonCode: string, severity: 'warning' | 'critical' = 'critical'): OperationsSignal => ({
		environment: config.environment, signal: name, ok, severity: ok ? 'none' : severity,
		checkedAt: new Date(now).toISOString(), deploymentIdentity: config.deploymentIdentity,
		correlationId: crypto.randomUUID(), reasonCode, runbookAnchor: `docs/INCIDENT-RESPONSE.md#${name.replaceAll('_', '-')}`
	});
	if (!configurationValid(config)) return SIGNAL_NAMES.map((name) => signal(name, false, 'configuration_unavailable'));
	const authHeaders = { apikey: config.publicKey };
	const serverHeaders = { apikey: config.serverKey!, authorization: `Bearer ${config.serverKey}` };
	const boundedFetch = (path: string, init: RequestInit = {}) => fetcher(`${config.supabaseOrigin}${path}`, {
		...init, redirect: 'error', signal: AbortSignal.timeout(3_000)
	});
	const [auth, database, storage] = await Promise.allSettled([
		(async () => {
			const health = await boundedFetch('/auth/v1/health', { headers: authHeaders });
			await health.body?.cancel();
			if (health.status !== 200) return false;
			const denial = await boundedFetch('/auth/v1/user', { headers: { ...authHeaders, authorization: 'Bearer operations-intentionally-invalid-session' } });
			await denial.body?.cancel();
			return denial.status === 401;
		})(),
		(async () => {
			const result = await boundedFetch('/rest/v1/rpc/get_operations_snapshot', {
				method: 'POST', headers: { ...serverHeaders, 'content-type': 'application/json' }, body: '{}'
			});
			if (!result.ok) { await result.body?.cancel(); throw new Error('probe_failed'); }
			const value: unknown = JSON.parse(new TextDecoder().decode(await boundedBytes(result, 32 * 1024)));
			if (!snapshotShape(value)) throw new Error('probe_failed');
			return value;
		})(),
		(async () => {
			const result = await boundedFetch(`/storage/v1/object/authenticated/${config.sentinelBucket}/${config.sentinelPath}`, { headers: serverHeaders });
			if (!result.ok) { await result.body?.cancel(); return 'sentinel_unavailable'; }
			const hash = createHash('sha256').update(await boundedBytes(result, 4096)).digest('hex');
			return hash === config.sentinelSha256 ? 'healthy' : 'storage_integrity_mismatch';
		})()
	]);
	const snapshot = database.status === 'fulfilled' ? database.value : null;
	function checkpoint(name: string, warningHours: number, criticalHours: number): { ok: boolean; reason: string; severity: 'warning' | 'critical' } {
		const value = snapshot?.checkpoints[name];
		if (!value || value.deploymentIdentity !== config.deploymentIdentity || !SHA256.test(value.evidenceSha256 ?? '') ||
			typeof value.checkpointAt !== 'string' || !Number.isFinite(Date.parse(value.checkpointAt)) || Date.parse(value.checkpointAt) > now + 300_000) {
			return { ok: false, reason: 'checkpoint_unavailable', severity: 'critical' };
		}
		if (value.ok !== true) return { ok: false, reason: 'checkpoint_integrity_failed', severity: 'critical' };
		const age = (now - Date.parse(value.checkpointAt)) / 3_600_000;
		if (age > criticalHours) return { ok: false, reason: 'checkpoint_stale', severity: 'critical' };
		if (age > warningHours) return { ok: false, reason: 'checkpoint_stale', severity: 'warning' };
		return { ok: true, reason: 'healthy', severity: 'critical' };
	}
	const backup = checkpoint('backup_freshness', 24, 26);
	const heartbeat = checkpoint('monitor_heartbeat', 1 / 3, 1 / 3);
	const canary = checkpoint('email_canary', 24.25, 24.25);
	const [canaryHour, canaryMinute] = config.canaryExpectedUtc.split(':').map(Number);
	const expectedCanary = new Date(now);
	expectedCanary.setUTCHours(canaryHour, canaryMinute, 0, 0);
	if (expectedCanary.getTime() > now) expectedCanary.setUTCDate(expectedCanary.getUTCDate() - 1);
	if (now > expectedCanary.getTime() + 15 * 60_000 &&
		Date.parse(snapshot?.checkpoints.email_canary?.checkpointAt ?? '') < expectedCanary.getTime()) canary.ok = false;
	const databaseOk = snapshot !== null && snapshot.migrationDigest === config.migrationDigest && snapshot.schemaDigest === config.schemaDigest && snapshot.jobsHealthy;
	const storageReason = storage.status === 'fulfilled' ? storage.value : 'sentinel_unavailable';
	const storageOk = storageReason === 'healthy' && snapshot !== null && snapshot.cleanupRetries === 0 && snapshot.cleanupDeadLetters === 0 && snapshot.quarantineStuck === 0;
	const emailOk = snapshot !== null && snapshot.notificationsFailed === 0 && snapshot.notificationsStale === 0 &&
		snapshot.emailDownstreamFailed === 0 && snapshot.emailDownstreamMissing === 0 && canary.ok;
	const queueAge = snapshot?.reportQueueOldestAt ? (now - Date.parse(snapshot.reportQueueOldestAt)) / 3_600_000 : 0;
	const safetyOk = snapshot !== null && snapshot.safetyViolations === 0 && queueAge <= config.safetyWarningHours;
	return [
		signal('health', config.deploymentIdentity === config.expectedDeploymentIdentity,
			config.deploymentIdentity === config.expectedDeploymentIdentity ? 'healthy' : 'deployment_identity_mismatch'),
		signal('auth', auth.status === 'fulfilled' && auth.value, auth.status === 'fulfilled' && auth.value ? 'healthy' : 'auth_probe_failed'),
		signal('database', databaseOk, databaseOk ? 'healthy' : snapshot ? 'schema_or_jobs_mismatch' : 'snapshot_unavailable'),
		signal('storage', storageOk, storageOk ? 'healthy' : storageReason === 'healthy' ? 'storage_processing_unhealthy' : storageReason),
		signal('email', emailOk, emailOk ? 'healthy' : !canary.ok ? 'email_canary_absent' : 'email_delivery_unhealthy'),
		signal('deals', snapshot !== null && snapshot.dealViolations === 0, snapshot ? snapshot.dealViolations === 0 ? 'healthy' : 'deal_invariant_violation' : 'snapshot_unavailable'),
		signal('safety', safetyOk, safetyOk ? 'healthy' : snapshot?.safetyViolations ? 'safety_invariant_violation' : snapshot ? 'safety_queue_stale' : 'snapshot_unavailable',
			snapshot && snapshot.safetyViolations === 0 && queueAge <= config.safetyCriticalHours ? 'warning' : 'critical'),
		signal('backup_freshness', backup.ok, backup.reason, backup.severity),
		signal('monitor_heartbeat', heartbeat.ok, heartbeat.reason, heartbeat.severity)
	];
}

/** Cache only sanitized completed results; never share I/O promises across Worker request contexts. */
export function createOperationsReadinessHandler(dependencies: { now?: () => number; fetch?: typeof fetch } = {}) {
	let cache: { key: string; expiresAt: number; signals: OperationsSignal[] } | undefined;
	let busy = false;
	const now = dependencies.now ?? Date.now;
	const fetcher = dependencies.fetch ?? fetch;
	return async (request: Request, configuration: OperationsConfiguration): Promise<Response> => {
		const expected = configuration.monitorToken;
		const actual = request.headers.get('authorization') ?? '';
		if (!expected || !/^[A-Za-z0-9_-]{43,128}$/.test(expected)) return errorResponse(503, 'monitor_unavailable');
		if (actual.length > 256 || !timingSafeEqual(createHash('sha256').update(actual).digest(),
			createHash('sha256').update(`Bearer ${expected}`).digest())) return errorResponse(401, 'unauthorized');
		if (request.method !== 'GET' || new URL(request.url).search || request.body !== null) return errorResponse(400, 'invalid_monitor_request');
		const key = createHash('sha256').update(JSON.stringify(configuration)).digest('hex');
		const instant = now();
		if (cache?.key === key && cache.expiresAt > instant) return Response.json({ schemaVersion: 1, signals: cache.signals }, { headers: PRIVATE_HEADERS });
		if (busy) return errorResponse(429, 'monitor_busy');
		busy = true;
		try {
			const signals = await probe(configuration, fetcher, instant);
			cache = { key, expiresAt: instant + 30_000, signals };
			return Response.json({ schemaVersion: 1, signals }, { headers: PRIVATE_HEADERS });
		} catch { return errorResponse(503, 'monitor_unavailable'); }
		finally { busy = false; }
	};
}
