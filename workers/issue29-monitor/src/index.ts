type SignalName = 'health' | 'auth' | 'database' | 'storage' | 'email' | 'deals' | 'safety' | 'backup_freshness' | 'monitor_heartbeat';
type Severity = 'none' | 'warning' | 'critical';
type AlertState = 'firing' | 'resolved';
const SIGNALS: readonly SignalName[] = ['health', 'auth', 'database', 'storage', 'email', 'deals', 'safety', 'backup_freshness', 'monitor_heartbeat'];
const STATE_KEY = 'issue29-monitor-state-v1';
const MAX_JSON_BYTES = 64 * 1024;
const MINUTE = 60_000;

export interface StateStoreLike { get(key: string, type?: 'text'): Promise<string | null>; put(key: string, value: string): Promise<void>; }
export interface DurableObjectStorageLike { get<T>(key: string): Promise<T | undefined>; put(key: string, value: string): Promise<void>; }
export interface DurableObjectStateLike { storage: DurableObjectStorageLike; }
export interface DurableObjectStubLike { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>; }
export interface DurableObjectNamespaceLike { idFromName(name: string): unknown; get(id: unknown): DurableObjectStubLike; }
export interface ExecutionContextLike { waitUntil(promise: Promise<unknown>): void; }
export interface MonitorEnv {
	MONITOR_STATE: StateStoreLike;
	PUBLIC_HEALTH_URL: string; READINESS_URL: string; READINESS_TOKEN: string;
	TARGET_ORIGIN: string; RUNTIME_ENVIRONMENT: string; EXPECTED_ENVIRONMENT: string; EXPECTED_RELEASE_SHA: string;
	RESEND_API_KEY: string; RESEND_FROM: string; RESEND_TO: string;
	RESEND_WEBHOOK_SECRET: string;
	BACKUP_CHECKPOINT_TOKEN: string; WATCHDOG_TOKEN: string; EVIDENCE_READ_TOKEN: string; MAINTENANCE_TOKEN: string; RELEASE_ADOPTION_TOKEN: string;
}
type Signal = { signal: SignalName; ok: boolean; severity: Severity; reasonCode: string; checkedAt: string };
type Delivery = { messageId?: string; eventId?: string; eventType?: 'email.delivered'; occurredAt?: string; sendAttemptedAt?: string; sendStatus?: 'sent' | 'uncertain'; attempts?: number; messageText?: string; requestSha256?: string; idempotencyKey?: string };
type StoredSignal = Signal & { incidentId?: string; alertState?: AlertState; deliveries?: Partial<Record<AlertState, Delivery>>; failures?: number; successes?: number; firingSeverity?: Severity };
type Backup = { release: string; checkpointAt: string; descriptorSha256: string; artifactSha256: string; integrityFailureEvidenceSha256?: string };
type MaintenanceTarget = { origin: string; readinessUrl: string; readinessToken: string; runtimeEnvironment: string; release: string };
type Maintenance = { startsAt: string; endsAt: string; incidentId: string; target?: MaintenanceTarget };
type MonitorState = { schemaVersion: 1; environment: string; release: string; observedTargetOrigin?: string; lastSuccessfulMonitorCycleAt?: string; lastCompletedMonitorCycleAt?: string; latestTrustedBackupCheckpoint?: Backup; backupIntegrityFailureEvidenceSha256?: string; maintenance?: Maintenance; signals: Partial<Record<SignalName, StoredSignal>> };
type FetchLike = typeof fetch;

function response(status: number, body?: Record<string, unknown>): Response { return body ? Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } }) : new Response(null, { status, headers: { 'cache-control': 'private, no-store' } }); }
function token(value: string | undefined): boolean { return typeof value === 'string' && /^[A-Za-z0-9_-]{43,256}$/.test(value); }
function sha(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
function release(value: string): boolean { return /^[a-f0-9]{40}$/.test(value); }
function utc(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function sameToken(request: Request, expected: string | undefined): boolean { return token(expected) && request.headers.get('authorization') === `Bearer ${expected}`; }
function isCurrentMaintenance(value: Maintenance | undefined, now: number): boolean { return Boolean(value && Date.parse(value.startsAt) <= now && now < Date.parse(value.endsAt)); }
function runbook(signal: SignalName): string { return `docs/INCIDENT-RESPONSE.md#${signal.replaceAll('_', '-')}`; }
function stateFor(env: MonitorEnv): MonitorState { return { schemaVersion: 1, environment: env.EXPECTED_ENVIRONMENT, release: env.EXPECTED_RELEASE_SHA, signals: {} }; }
function validState(value: unknown, env: MonitorEnv): value is MonitorState {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<MonitorState>;
	return candidate.schemaVersion === 1 && candidate.environment === env.EXPECTED_ENVIRONMENT && typeof candidate.release === 'string' && release(candidate.release) && candidate.signals !== null && typeof candidate.signals === 'object';
}
async function load(env: MonitorEnv): Promise<MonitorState> { try { const raw = await env.MONITOR_STATE.get(STATE_KEY, 'text'); if (!raw) return stateFor(env); const decoded: unknown = JSON.parse(raw); if (!validState(decoded, env)) throw new Error('monitor_state_invalid'); return decoded; } catch { throw new Error('monitor_state_unavailable'); } }
async function save(env: MonitorEnv, state: MonitorState): Promise<void> { await env.MONITOR_STATE.put(STATE_KEY, JSON.stringify(state)); }
async function boundedBytes(response: Response | Request): Promise<Uint8Array> {
	if (!response.body || Number(response.headers.get('content-length') ?? 0) > MAX_JSON_BYTES) throw new Error('response_invalid');
	const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0; const deadline = Date.now() + 5_000;
	try { while (true) { let timer: ReturnType<typeof setTimeout> | undefined; const part = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('body_timeout')), Math.max(1, deadline - Date.now())); })]).finally(() => clearTimeout(timer)); if (part.done) break; size += part.value.byteLength; if (size > MAX_JSON_BYTES) throw new Error('response_invalid'); chunks.push(part.value); } }
	finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
	const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
	return bytes;
}
async function json(response: Response | Request): Promise<unknown> { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedBytes(response))); }
async function boundedFetch(fetcher: FetchLike, url: string, init: RequestInit = {}): Promise<Response> { return fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(5_000) }); }
function validReadiness(value: unknown, env: MonitorEnv, now: number): value is { schemaVersion: 1; signals: Array<Signal & { environment: string; deploymentIdentity: string; correlationId: string; runbookAnchor: string }> } {
	if (!value || typeof value !== 'object') return false; const body = value as { schemaVersion?: unknown; signals?: unknown };
	if (body.schemaVersion !== 1 || !Array.isArray(body.signals) || body.signals.length !== SIGNALS.length) return false;
	const names = new Set<string>();
	return body.signals.every((item): item is Signal & { environment: string; deploymentIdentity: string; correlationId: string; runbookAnchor: string } => {
		if (!item || typeof item !== 'object') return false; const signal = item as Record<string, unknown>; const name = signal.signal;
		if (typeof name !== 'string' || !SIGNALS.includes(name as SignalName) || names.has(name)) return false; names.add(name);
		return signal.environment === env.RUNTIME_ENVIRONMENT && signal.deploymentIdentity === env.EXPECTED_RELEASE_SHA && typeof signal.ok === 'boolean' &&
			((signal.ok && signal.severity === 'none' && signal.reasonCode === 'healthy') || (!signal.ok && (signal.severity === 'warning' || signal.severity === 'critical') && signal.reasonCode !== 'healthy')) &&
			utc(signal.checkedAt) && Math.abs(now - Date.parse(signal.checkedAt as string)) <= 10 * MINUTE && typeof signal.reasonCode === 'string' && /^[a-z_]{3,80}$/.test(signal.reasonCode) &&
			typeof signal.correlationId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(signal.correlationId) && signal.runbookAnchor === runbook(name as SignalName);
	});
}
function unavailable(now: number): Signal[] { return SIGNALS.map(signal => ({ signal, ok: false, severity: 'critical', reasonCode: 'readiness_unavailable', checkedAt: new Date(now).toISOString() })); }
async function observe(env: MonitorEnv, state: MonitorState, fetcher: FetchLike, now: number): Promise<Signal[]> {
	let publicHealthy = false;
	try { const publicResponse = await boundedFetch(fetcher, env.PUBLIC_HEALTH_URL); publicHealthy = publicResponse.status === 200 && publicResponse.headers.get('x-deployed-git-sha') === env.EXPECTED_RELEASE_SHA; await publicResponse.body?.cancel(); } catch { /* represented in the health signal */ }
	try {
		const readiness = await boundedFetch(fetcher, env.READINESS_URL, { headers: { authorization: `Bearer ${env.READINESS_TOKEN}` } });
		if (!readiness.ok) { await readiness.body?.cancel(); return unavailable(now); }
		const decoded = await json(readiness); if (!validReadiness(decoded, env, now)) return unavailable(now);
		return decoded.signals.map(value => {
			if (value.signal === 'health' && !publicHealthy) return { signal: value.signal, ok: false, severity: 'critical', reasonCode: 'public_health_unavailable', checkedAt: value.checkedAt };
			if (value.signal === 'monitor_heartbeat') return { signal: value.signal, ok: true, severity: 'none', reasonCode: 'healthy', checkedAt: new Date(now).toISOString() };
			if (value.signal === 'backup_freshness') {
				const checkpoint = state.latestTrustedBackupCheckpoint; const age = checkpoint ? now - Date.parse(checkpoint.checkpointAt) : Infinity;
				if (!checkpoint || checkpoint.release !== env.EXPECTED_RELEASE_SHA || age > 26 * 60 * MINUTE) return { signal: value.signal, ok: false, severity: 'critical', reasonCode: 'checkpoint_stale', checkedAt: value.checkedAt };
				if (age > 24 * 60 * MINUTE) return { signal: value.signal, ok: false, severity: 'warning', reasonCode: 'checkpoint_stale', checkedAt: value.checkedAt };
			}
			return { signal: value.signal, ok: value.ok, severity: value.severity, reasonCode: value.reasonCode, checkedAt: value.checkedAt };
		});
	} catch { return unavailable(now); }
}
function bodyFor(signal: StoredSignal, env: MonitorEnv): string {
	const state = signal.alertState === 'resolved' ? 'RECOVERY' : 'FAILURE';
	return [`Issue 29 ${state}`, `Environment: ${env.EXPECTED_ENVIRONMENT}`, `Severity: ${signal.severity}`, `Signal: ${signal.signal}`, `Incident: ${signal.incidentId}`, `Observed: ${signal.checkedAt}`, `Immediate action: ${runbook(signal.signal)}`].join('\n');
}
async function sendAlert(env: MonitorEnv, delivery: Delivery, requestBody: string, fetcher: FetchLike): Promise<Delivery> {
	try {
		const result = await boundedFetch(fetcher, 'https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'Idempotency-Key': delivery.idempotencyKey! }, body: requestBody });
		if (!result.ok) { await result.body?.cancel(); return delivery; }
		const value = await json(result), id = value && typeof value === 'object' ? (value as Record<string, unknown>).id : undefined;
		if (typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return { ...delivery, messageId: id, sendStatus: 'sent' };
	} catch { /* Preserve the exact idempotent request; replay is bounded within Resend's 24-hour window. */ }
	return delivery;
}
async function digest(value: unknown): Promise<string> { const bytes = new TextEncoder().encode(JSON.stringify(value)); const output = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(output), byte => byte.toString(16).padStart(2, '0')).join(''); }
function alertable(signal: SignalName, maintenance: boolean): boolean { return !maintenance || signal === 'backup_freshness' || signal === 'monitor_heartbeat'; }
async function cycle(env: MonitorEnv, fetcher: FetchLike, now: number): Promise<void> {
	const state = await load(env); if (state.release !== env.EXPECTED_RELEASE_SHA) return; const maintenance = isCurrentMaintenance(state.maintenance, now); const target = maintenance ? state.maintenance?.target : undefined;
	const probe = target ? { ...env, TARGET_ORIGIN: target.origin, PUBLIC_HEALTH_URL: `${target.origin}/`, READINESS_URL: target.readinessUrl, READINESS_TOKEN: target.readinessToken, EXPECTED_ENVIRONMENT: target.runtimeEnvironment, RUNTIME_ENVIRONMENT: target.runtimeEnvironment, EXPECTED_RELEASE_SHA: target.release } : env;
	const observed = (await observe(probe, state, fetcher, now)).map((value): Signal => {
		if (value.signal === 'monitor_heartbeat') { const missed = Boolean(state.lastSuccessfulMonitorCycleAt && now - Date.parse(state.lastSuccessfulMonitorCycleAt) > 30 * MINUTE); return { ...value, ok: !missed, severity: missed ? 'critical' : 'none', reasonCode: missed ? 'monitor_cycle_gap' : 'healthy', checkedAt: new Date(now).toISOString() }; }
		if (value.signal === 'backup_freshness') {
			const backup = state.latestTrustedBackupCheckpoint, age = backup ? now - Date.parse(backup.checkpointAt) : Infinity;
			const invalid = !backup || backup.release !== env.EXPECTED_RELEASE_SHA || age < 0 || !Number.isFinite(age) || Boolean(state.backupIntegrityFailureEvidenceSha256);
			return { ...value, ok: !invalid && age <= 24 * 60 * MINUTE, severity: invalid || age > 26 * 60 * MINUTE ? 'critical' : age > 24 * 60 * MINUTE ? 'warning' : 'none', reasonCode: invalid || age > 24 * 60 * MINUTE ? 'checkpoint_stale' : 'healthy', checkedAt: new Date(now).toISOString() };
		}
		return value;
	});
	for (const result of observed) {
		const previous = state.signals[result.signal]; const immediate = result.signal === 'backup_freshness' || result.signal === 'monitor_heartbeat' || ['deployment_identity_mismatch', 'storage_integrity_mismatch', 'deal_invariant_violation', 'safety_invariant_violation', 'email_canary_absent'].includes(result.reasonCode);
		const next: StoredSignal = { ...result, incidentId: previous?.incidentId, alertState: undefined, deliveries: previous?.deliveries, failures: result.ok ? 0 : Math.min(2, (previous?.failures ?? 0) + 1), successes: result.ok ? Math.min(2, (previous?.successes ?? 0) + 1) : 0, firingSeverity: previous?.firingSeverity ?? 'none' };
		if (alertable(result.signal, maintenance && !target) && !result.ok && (immediate || next.failures === 2) && (next.firingSeverity === 'none' || (next.firingSeverity === 'warning' && result.severity === 'critical'))) { if (next.firingSeverity === 'none' && Object.values(next.deliveries??{}).every(delivery=>delivery.eventType==='email.delivered')) { next.incidentId = crypto.randomUUID(); next.deliveries = {}; } next.alertState = 'firing'; if (next.firingSeverity !== 'none' || !next.deliveries?.resolved) next.firingSeverity = result.severity; }
		else if (alertable(result.signal, maintenance && !target) && result.ok && previous && previous.firingSeverity !== 'none' && next.successes === 2 && previous.incidentId) { next.incidentId = previous.incidentId; next.alertState = 'resolved'; next.firingSeverity = 'none'; next.deliveries = { ...previous.deliveries }; }
		state.signals[result.signal] = next;
	}
	state.lastCompletedMonitorCycleAt = new Date(now).toISOString(); await save(env, state);
	for (const name of SIGNALS) {
		const signal = state.signals[name]!;
		if (signal.incidentId && signal.alertState && alertable(name, maintenance && !target) && !signal.deliveries?.[signal.alertState]) {
			const phase=signal.alertState, messageText=bodyFor(signal,env), requestBody=JSON.stringify({from:env.RESEND_FROM,to:[env.RESEND_TO],subject:`Issue 29 ${phase==='resolved'?'recovery':'failure'}: ${signal.signal}`,text:messageText});
			signal.deliveries = { ...signal.deliveries, [phase]: { sendAttemptedAt: new Date(now).toISOString(), sendStatus: 'uncertain', attempts: 0, idempotencyKey: `issue29/${env.EXPECTED_RELEASE_SHA}/${signal.incidentId}/${phase}`, messageText, requestSha256:await digest(requestBody) } };
			await save(env,state);
		}
		for (const phase of ['firing','resolved'] as const) {
			const delivery=signal.deliveries?.[phase];
			if (delivery?.sendStatus==='uncertain' && delivery.messageText && delivery.requestSha256 && delivery.idempotencyKey && (delivery.attempts??0)<3 && now-Date.parse(delivery.sendAttemptedAt!)<60*MINUTE) {
				const requestBody=JSON.stringify({from:env.RESEND_FROM,to:[env.RESEND_TO],subject:`Issue 29 ${phase==='resolved'?'recovery':'failure'}: ${signal.signal}`,text:delivery.messageText});
				if(await digest(requestBody)!==delivery.requestSha256)continue;
				delivery.attempts=(delivery.attempts??0)+1;await save(env,state);
				signal.deliveries![phase]=await sendAlert(env,delivery,requestBody,fetcher);await save(env,state);
			}
		}
	}
	const deliveryHealthy=Object.values(state.signals).every(signal=>Object.values(signal.deliveries??{}).every(delivery=>delivery.eventType==='email.delivered'||(utc(delivery.sendAttemptedAt)&&now-Date.parse(delivery.sendAttemptedAt)<=20*MINUTE)));
	state.observedTargetOrigin = probe.TARGET_ORIGIN;
	if(deliveryHealthy)state.lastSuccessfulMonitorCycleAt = new Date(now).toISOString();
	await save(env,state);
}
function configOk(env: MonitorEnv): boolean {
	try {
		const protectedTokens = [env.READINESS_TOKEN, env.BACKUP_CHECKPOINT_TOKEN, env.WATCHDOG_TOKEN, env.EVIDENCE_READ_TOKEN, env.MAINTENANCE_TOKEN, env.RELEASE_ADOPTION_TOKEN];
		const target = new URL(env.TARGET_ORIGIN); const origins = [env.PUBLIC_HEALTH_URL, env.READINESS_URL].map(value => new URL(value));
		return /^[a-z][a-z0-9-]{0,62}$/.test(env.EXPECTED_ENVIRONMENT) && ['development', 'staging', 'production'].includes(env.RUNTIME_ENVIRONMENT) && release(env.EXPECTED_RELEASE_SHA) && protectedTokens.every(token) && new Set(protectedTokens).size === protectedTokens.length && /^re_[A-Za-z0-9_-]{8,}$/.test(env.RESEND_API_KEY) && /^whsec_[A-Za-z0-9+/]{20,128}={0,2}$/.test(env.RESEND_WEBHOOK_SECRET) && target.protocol === 'https:' && origins.every(value => value.protocol === 'https:' && value.origin === target.origin);
	} catch { return false; }
}
function redactState(state: MonitorState, now: number) { return { schemaVersion: 1, environment: state.environment, release: state.release, observedTargetOrigin: state.observedTargetOrigin ?? null, lastSuccessfulMonitorCycleAt: state.lastSuccessfulMonitorCycleAt ?? null, lastCompletedMonitorCycleAt: state.lastCompletedMonitorCycleAt ?? null, latestTrustedBackupCheckpointAt: state.latestTrustedBackupCheckpoint?.checkpointAt ?? null, latestTrustedBackupDescriptorSha256: state.latestTrustedBackupCheckpoint?.descriptorSha256 ?? null, latestTrustedBackupArtifactSha256: state.latestTrustedBackupCheckpoint?.artifactSha256 ?? null, integrityFailureEvidenceSha256: state.backupIntegrityFailureEvidenceSha256 ?? null, maintenance: state.maintenance ? { active: isCurrentMaintenance(state.maintenance, now), endsAt: state.maintenance.endsAt, incidentId: state.maintenance.incidentId, target: state.maintenance.target ? { origin: state.maintenance.target.origin, runtimeEnvironment: state.maintenance.target.runtimeEnvironment, release: state.maintenance.target.release } : null } : null }; }
async function readBody(request: Request): Promise<unknown> { if (request.headers.get('content-type')?.split(';')[0] !== 'application/json' || Number(request.headers.get('content-length') ?? 0) > MAX_JSON_BYTES) throw new Error('invalid'); return json(request); }
function base64(value: string): Uint8Array { const binary = atob(value); return Uint8Array.from(binary, part => part.charCodeAt(0)); }
async function resendWebhook(request: Request, env: MonitorEnv, now: number): Promise<Response> {
	const id = request.headers.get('svix-id') ?? '', timestamp = request.headers.get('svix-timestamp') ?? '', signatures = request.headers.get('svix-signature') ?? '';
	if (request.method !== 'POST' || request.headers.get('content-type')?.split(';')[0] !== 'application/json' || !/^msg_[A-Za-z0-9_-]{8,196}$/.test(id) || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || signatures.length > 1024) return response(400, { ok: false, code: 'invalid_webhook' });
	let bytes: Uint8Array; try { bytes = await boundedBytes(request); const key = await crypto.subtle.importKey('raw', base64(env.RESEND_WEBHOOK_SECRET.slice(6)).buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']); const signed = new TextEncoder().encode(`${id}.${timestamp}.${new TextDecoder().decode(bytes)}`); const valid = await Promise.all(signatures.split(' ').filter(value => /^v1,[A-Za-z0-9+/]{43}=$/.test(value)).map(value => crypto.subtle.verify('HMAC', key, base64(value.slice(3)).buffer as ArrayBuffer, signed.buffer as ArrayBuffer))); if (!valid.some(Boolean)) return response(400, { ok: false, code: 'invalid_webhook' }); const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); if (payload?.type !== 'email.delivered' || typeof payload.data?.email_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.data.email_id) || !utc(payload.created_at)) return response(400, { ok: false, code: 'invalid_webhook' }); const state = await load(env); let found = false; for (const name of SIGNALS) { const signal = state.signals[name]; if (!signal?.deliveries) continue; for (const phase of ['firing', 'resolved'] as const) { const delivery = signal.deliveries[phase]; if (delivery && delivery.messageId === payload.data.email_id && !delivery.eventId) { signal.deliveries[phase] = { ...delivery, eventId: id, eventType: 'email.delivered', occurredAt: new Date(payload.created_at).toISOString() }; found = true; } } } if (!found) return response(404, { ok: false, code: 'unmatched_delivery' }); await save(env, state); return response(200, { ok: true }); } catch { return response(400, { ok: false, code: 'invalid_webhook' }); }
}
async function handler(request: Request, env: MonitorEnv, now = Date.now()): Promise<Response> {
	if (!configOk(env)) return response(503, { ok: false, code: 'monitor_unavailable' }); const url = new URL(request.url);
	if (url.pathname === '/ops/monitor/resend-webhook' && !url.search) return resendWebhook(request, env, now);
	if (url.pathname === '/ops/monitor/config' && request.method === 'GET' && sameToken(request, env.EVIDENCE_READ_TOKEN) && !url.search) return response(200, { schemaVersion: 1, environment: env.EXPECTED_ENVIRONMENT, runtimeEnvironment: env.RUNTIME_ENVIRONMENT, targetOrigin: env.TARGET_ORIGIN, release: env.EXPECTED_RELEASE_SHA, signalFamilies: SIGNALS, scheduleMinutes: 10, webhookSigningSecretSha256: await digest(env.RESEND_WEBHOOK_SECRET), configSha256: await digest({ environment: env.EXPECTED_ENVIRONMENT, runtimeEnvironment: env.RUNTIME_ENVIRONMENT, targetOrigin: env.TARGET_ORIGIN, release: env.EXPECTED_RELEASE_SHA, signalFamilies: SIGNALS, scheduleMinutes: 10 }) });
	if (url.pathname === '/ops/monitor/heartbeat' && request.method === 'GET' && sameToken(request, env.WATCHDOG_TOKEN) && !url.search) return response(200, redactState(await load(env), now));
	if (url.pathname === '/ops/monitor/state' && request.method === 'GET' && sameToken(request, env.EVIDENCE_READ_TOKEN) && !url.search) { const state = await load(env); return response(200, { ...redactState(state, now), signals: SIGNALS.map(signal => { const item = state.signals[signal]; return item ? { signal, ok: item.ok, severity: item.severity, reasonCode: item.reasonCode, checkedAt: item.checkedAt, incidentId: item.incidentId } : { signal, ok: false, severity: 'critical', reasonCode: 'monitor_never_completed', checkedAt: null }; }) }); }
	if (url.pathname === '/ops/monitor/events' && request.method === 'GET' && sameToken(request, env.EVIDENCE_READ_TOKEN) && [...url.searchParams.keys()].every(key => key === 'incidentId' || key === 'state')) { const incidentId = url.searchParams.get('incidentId'), phase = url.searchParams.get('state'); if (!incidentId || (phase !== 'firing' && phase !== 'resolved') || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(incidentId)) return response(400, { ok: false, code: 'invalid_request' }); const state = await load(env); const signal = SIGNALS.map(name => state.signals[name]).find(item => item?.incidentId === incidentId); const delivery = signal?.deliveries?.[phase]; if (!signal || delivery?.eventType !== 'email.delivered' || !delivery.messageId || !delivery.eventId || !delivery.occurredAt) return response(404, { ok: false, code: 'delivery_unproven' }); return response(200, { schemaVersion: 1, incidentId, signal: signal.signal, state: phase, messageId: delivery.messageId, eventId: delivery.eventId, eventType: 'email.delivered', occurredAt: delivery.occurredAt }); }
	if (url.pathname === '/ops/monitor/backup-checkpoint' && request.method === 'GET' && sameToken(request, env.EVIDENCE_READ_TOKEN) && !url.search) { const state = await load(env); const backup = state.latestTrustedBackupCheckpoint; return response(200, { schemaVersion: 1, environment: state.environment, release: state.release, backupRelease: backup?.release ?? null, checkpointAt: backup?.checkpointAt ?? null, descriptorSha256: backup?.descriptorSha256 ?? null, artifactSha256: backup?.artifactSha256 ?? null, integrityFailureEvidenceSha256: state.backupIntegrityFailureEvidenceSha256 ?? null, configSha256: await digest({ environment: env.EXPECTED_ENVIRONMENT, runtimeEnvironment: env.RUNTIME_ENVIRONMENT, targetOrigin: env.TARGET_ORIGIN, release: env.EXPECTED_RELEASE_SHA, signalFamilies: SIGNALS, scheduleMinutes: 10 }) }); }
	if (url.pathname === '/ops/monitor/backup-checkpoint' && request.method === 'POST' && sameToken(request, env.BACKUP_CHECKPOINT_TOKEN) && !url.search) { try { const body = await readBody(request) as Record<string, unknown>; if (body.schemaVersion !== 1 || body.environment !== env.EXPECTED_ENVIRONMENT || body.release !== env.EXPECTED_RELEASE_SHA || !utc(body.checkpointAt) || Date.parse(body.checkpointAt) > now + 5 * MINUTE || !sha(String(body.descriptorSha256)) || !sha(String(body.artifactSha256))) return response(400, { ok: false, code: 'invalid_checkpoint' }); const state = await load(env), previous = state.latestTrustedBackupCheckpoint; if (previous && Date.parse(body.checkpointAt) === Date.parse(previous.checkpointAt) && (previous.descriptorSha256 !== body.descriptorSha256 || previous.artifactSha256 !== body.artifactSha256)) return response(409, { ok: false, code: 'checkpoint_conflict' }); if (!previous || Date.parse(body.checkpointAt) > Date.parse(previous.checkpointAt)) { state.latestTrustedBackupCheckpoint = { release: env.EXPECTED_RELEASE_SHA, checkpointAt: new Date(body.checkpointAt).toISOString(), descriptorSha256: String(body.descriptorSha256), artifactSha256: String(body.artifactSha256) }; delete state.backupIntegrityFailureEvidenceSha256; await save(env, state); } return response(204); } catch { return response(400, { ok: false, code: 'invalid_checkpoint' }); } }
	if (url.pathname === '/ops/monitor/backup-failure' && request.method === 'POST' && sameToken(request, env.BACKUP_CHECKPOINT_TOKEN) && !url.search) { try { const body = await readBody(request) as Record<string, unknown>; if (body.schemaVersion !== 1 || body.environment !== env.EXPECTED_ENVIRONMENT || body.release !== env.EXPECTED_RELEASE_SHA || !sha(String(body.evidenceSha256))) return response(400, { ok: false, code: 'invalid_backup_failure' }); const state = await load(env); state.backupIntegrityFailureEvidenceSha256 = String(body.evidenceSha256); await save(env, state); return response(204); } catch { return response(400, { ok: false, code: 'invalid_backup_failure' }); } }
	if (url.pathname === '/ops/monitor/release-update' && request.method === 'POST' && sameToken(request, env.RELEASE_ADOPTION_TOKEN) && !url.search) { try { const body = await readBody(request) as Record<string, unknown>, state = await load(env); if (body.schemaVersion !== 1 || body.environment !== env.EXPECTED_ENVIRONMENT || body.previousRelease !== state.release || !release(String(body.previousRelease)) || body.release !== env.EXPECTED_RELEASE_SHA || !sha(String(body.protectedMergeEvidenceSha256)) || !sha(String(body.previousConfigSha256))) return response(409, { ok: false, code: 'release_adoption_invalid' }); state.release = env.EXPECTED_RELEASE_SHA; state.observedTargetOrigin = undefined; for (const signal of Object.values(state.signals)) if (signal) { signal.failures = 0; signal.successes = 0; signal.firingSeverity = 'none'; } await save(env, state); return response(200, { schemaVersion: 1, candidateSha: state.release, previousCandidateSha: String(body.previousRelease), previousConfigSha256: String(body.previousConfigSha256) }); } catch { return response(400, { ok: false, code: 'release_adoption_invalid' }); } }
	if (url.pathname === '/ops/monitor/maintenance' && request.method === 'PUT' && sameToken(request, env.MAINTENANCE_TOKEN) && !url.search) { try { const body = await readBody(request) as Record<string, unknown>; if (body.schemaVersion !== 1 || !utc(body.startsAt) || !utc(body.endsAt) || typeof body.incidentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.incidentId) || Date.parse(body.endsAt) <= Date.parse(body.startsAt) || Date.parse(body.endsAt) - Date.parse(body.startsAt) > 2 * 60 * MINUTE || Date.parse(body.startsAt) > now + 5 * MINUTE) return response(400, { ok: false, code: 'invalid_maintenance' }); const state = await load(env); state.maintenance = { startsAt: new Date(body.startsAt).toISOString(), endsAt: new Date(body.endsAt).toISOString(), incidentId: body.incidentId }; await save(env, state); return response(204); } catch { return response(400, { ok: false, code: 'invalid_maintenance' }); } }
	if (url.pathname === '/ops/monitor/maintenance/target' && request.method === 'PUT' && sameToken(request, env.MAINTENANCE_TOKEN) && !url.search) { try { const body = await readBody(request) as Record<string, unknown>, target = body.target as Record<string, unknown>, state = await load(env), maintenance = state.maintenance; if (!maintenance || body.schemaVersion !== 1 || body.incidentId !== maintenance.incidentId || maintenance.target || !target || typeof target.origin !== 'string' || typeof target.readinessUrl !== 'string' || !token(typeof target.readinessToken === 'string' ? target.readinessToken : '') || !['development', 'staging'].includes(String(target.runtimeEnvironment)) || !release(String(target.release)) || new URL(String(target.origin)).protocol !== 'https:' || new URL(String(target.readinessUrl)).origin !== new URL(String(target.origin)).origin) return response(409, { ok: false, code: 'maintenance_target_invalid' }); maintenance.target = { origin: String(target.origin), readinessUrl: String(target.readinessUrl), readinessToken: String(target.readinessToken), runtimeEnvironment: String(target.runtimeEnvironment), release: String(target.release) }; await save(env, state); return response(204); } catch { return response(400, { ok: false, code: 'maintenance_target_invalid' }); } }
	if (url.pathname === '/ops/monitor/maintenance/target' && request.method === 'DELETE' && sameToken(request, env.MAINTENANCE_TOKEN) && !url.search) { try { const body = await readBody(request) as Record<string, unknown>, state = await load(env), maintenance = state.maintenance; if (!maintenance || body.schemaVersion !== 1 || body.incidentId !== maintenance.incidentId || !maintenance.target) return response(409, { ok: false, code: 'maintenance_target_invalid' }); delete maintenance.target; await save(env, state); return response(204); } catch { return response(400, { ok: false, code: 'maintenance_target_invalid' }); } }
	if (url.pathname === '/ops/monitor/maintenance' && request.method === 'DELETE' && sameToken(request, env.MAINTENANCE_TOKEN) && !url.search) { try { const body = await readBody(request) as Record<string, unknown>; const state = await load(env); if (body.schemaVersion !== 1 || body.incidentId !== state.maintenance?.incidentId) return response(409, { ok: false, code: 'maintenance_identity_mismatch' }); delete state.maintenance; await save(env, state); return response(204); } catch { return response(400, { ok: false, code: 'invalid_maintenance' }); } }
	return response(404, { ok: false, code: 'not_found' });
}
export function createIssue29Monitor(dependencies: { fetch?: FetchLike; now?: () => number } = {}) { const fetcher = dependencies.fetch ?? fetch; const clock = dependencies.now ?? Date.now; return { fetch: (request: Request, env: MonitorEnv) => handler(request, env, clock()), scheduled: (env: MonitorEnv) => configOk(env) ? cycle(env, fetcher, clock()) : Promise.resolve() }; }
type WorkerBindingEnv = Omit<MonitorEnv, 'MONITOR_STATE'> & { MONITOR_COORDINATOR: DurableObjectNamespaceLike };
export class Issue29MonitorCoordinator {
	private queue: Promise<void> = Promise.resolve();
	private readonly runtime: MonitorEnv;
	constructor(state: DurableObjectStateLike, env: WorkerBindingEnv) { this.runtime = { ...env, MONITOR_STATE: { get: async key => (await state.storage.get<string>(key)) ?? null, put: async (key, value) => state.storage.put(key, value) } }; }
	async fetch(request: Request): Promise<Response> {
		// Streaming ingress must finish outside the state queue, so a hostile body cannot block cron or heartbeat work.
		if (request.method !== 'GET' && new URL(request.url).pathname !== '/_issue29/internal-cycle') {
			try { const bytes=await boundedBytes(request); request=new Request(request.url,{method:request.method,headers:request.headers,body:bytes.buffer as ArrayBuffer}); }
			catch { return response(400,{ok:false,code:'invalid_request'}); }
		}
		const execute = async () => { const url = new URL(request.url); if (url.pathname === '/_issue29/internal-cycle' && request.method === 'POST' && !url.search) { if (!configOk(this.runtime)) return response(503, { ok: false, code: 'monitor_unavailable' }); await cycle(this.runtime, fetch, Date.now()); return response(204); } return handler(request, this.runtime); };
		const result = this.queue.then(execute); this.queue = result.then(() => undefined, () => undefined); return result;
	}
}
function coordinator(env: WorkerBindingEnv): DurableObjectStubLike { return env.MONITOR_COORDINATOR.get(env.MONITOR_COORDINATOR.idFromName('issue29-monitor-v1')); }
export default { async fetch(request: Request, env: WorkerBindingEnv): Promise<Response> { const url = new URL(request.url); if (url.pathname === '/_issue29/internal-cycle') return response(404, { ok: false, code: 'not_found' }); return coordinator(env).fetch(request); }, scheduled(_event: unknown, env: WorkerBindingEnv, context: ExecutionContextLike): void { context.waitUntil(coordinator(env).fetch('https://issue29-monitor.internal/_issue29/internal-cycle', { method: 'POST' }).then(async response => { await response.body?.cancel(); })); } };
