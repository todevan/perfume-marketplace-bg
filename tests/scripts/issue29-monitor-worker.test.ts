import { describe, expect, it, vi } from 'vitest';
import { createIssue29Monitor, Issue29MonitorCoordinator, type MonitorEnv } from '../../workers/issue29-monitor/src/index';
import { verifyMonitorHeartbeat } from '../../scripts/issue29-operations/monitor-watchdog.mjs';

const now = Date.parse('2026-09-08T12:00:00.000Z');
const release = 'a'.repeat(40);
const token = (value: string) => value.repeat(43);
const signalNames = ['health', 'auth', 'database', 'storage', 'email', 'deals', 'safety', 'backup_freshness', 'monitor_heartbeat'] as const;

class MemoryKv {
	values = new Map<string, string>();
	async get(key: string) { return this.values.get(key) ?? null; }
	async put(key: string, value: string) { this.values.set(key, value); }
}
function env(kv = new MemoryKv()): MonitorEnv {
	return { MONITOR_STATE: kv, TARGET_ORIGIN: 'https://app.example.test', PUBLIC_HEALTH_URL: 'https://app.example.test/', READINESS_URL: 'https://app.example.test/api/operations/readiness', READINESS_TOKEN: token('r'), EXPECTED_ENVIRONMENT: 'staging', RUNTIME_ENVIRONMENT: 'staging', EXPECTED_RELEASE_SHA: release, RESEND_API_KEY: 're_1234567890abcdef', RESEND_FROM: 'Monitor <monitor@example.test>', RESEND_TO: 'owner@example.test', RESEND_WEBHOOK_SECRET: 'whsec_dGVzdF9zaWduaW5nX2tleV9mb3JfaXNzdWUyOQ==', BACKUP_CHECKPOINT_TOKEN: token('b'), WATCHDOG_TOKEN: token('w'), EVIDENCE_READ_TOKEN: token('e'), MAINTENANCE_TOKEN: token('m'), RELEASE_ADOPTION_TOKEN: token('u') };
}
function readiness(overrides: Record<string, Partial<{ ok: boolean; severity: string; reasonCode: string }>> = {}) {
	return { schemaVersion: 1, signals: signalNames.map((signal, index) => ({ signal, environment: 'staging', deploymentIdentity: release, checkedAt: new Date(now).toISOString(), ok: true, severity: 'none', reasonCode: 'healthy', correlationId: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, runbookAnchor: `docs/INCIDENT-RESPONSE.md#${signal.replaceAll('_', '-')}`, ...overrides[signal] })) };
}
function fetcher(options: { readiness?: unknown; delivered?: boolean; sends?: string[]; heartbeat?: boolean } = {}) {
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = new URL(String(input));
		if (url.pathname === '/') return new Response(null, { status: 200, headers: { 'x-deployed-git-sha': release } });
		if (url.pathname.endsWith('/readiness')) return Response.json(options.readiness ?? readiness());
		if (url.hostname === 'api.resend.com') { options.sends?.push(String(init?.body)); return Response.json({ id: '11111111-1111-4111-8111-111111111111' }); }
		throw new Error(`unexpected ${url}`);
	};
}
async function signedWebhook(configuration: MonitorEnv, id: string, payload: string) { const timestamp = String(Math.floor(now / 1000)); const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(configuration.RESEND_WEBHOOK_SECRET.slice(6)), item => item.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${payload}`)); return new Request('https://monitor.example.test/ops/monitor/resend-webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${btoa(String.fromCharCode(...new Uint8Array(bytes)))}` }, body: payload }); }

describe('Issue 29 Cloudflare monitor', () => {
	it('runs the exact nine readiness families, verifies public release identity, and exposes only its minimal heartbeat state', async () => {
		const state = new MemoryKv(); const monitor = createIssue29Monitor({ fetch: fetcher(), now: () => now }); const configuration = env(state);
		await monitor.scheduled(configuration);
		const response = await monitor.fetch(new Request('https://monitor.example.test/ops/monitor/state', { headers: { authorization: `Bearer ${configuration.EVIDENCE_READ_TOKEN}` } }), configuration);
		expect(response.status).toBe(200); const body = await response.json() as { signals: Array<{ signal: string; ok: boolean }>; lastSuccessfulMonitorCycleAt: string };
		expect(body.signals.map(value => value.signal)).toEqual(signalNames); expect(body.signals.filter(value => value.signal !== 'backup_freshness').every(value => value.ok)).toBe(true); expect(body.signals.find(value => value.signal === 'backup_freshness')?.ok).toBe(false); expect(body.lastSuccessfulMonitorCycleAt).toBe(new Date(now).toISOString());
		expect(JSON.stringify(body)).not.toContain(configuration.READINESS_TOKEN);
	});

	it('records only a correlated email.delivered event as delivery proof and never treats send or email.sent as proof', async () => {
		const state = new MemoryKv(); const sends: string[] = []; const configuration = env(state);
		const failure = readiness({ storage: { ok: false, severity: 'critical', reasonCode: 'storage_integrity_mismatch' } });
		await createIssue29Monitor({ fetch: fetcher({ readiness: failure, sends }), now: () => now }).scheduled(configuration);
		expect(sends).toHaveLength(2); expect(sends.some(value => value.includes('storage'))).toBe(true); expect(sends.every(value => !value.includes(configuration.READINESS_TOKEN))).toBe(true);
		let body = await (await createIssue29Monitor().fetch(new Request('https://monitor.example.test/ops/monitor/state', { headers: { authorization: `Bearer ${configuration.EVIDENCE_READ_TOKEN}` } }), configuration)).json() as { signals: Array<{ incidentId?: string }> };
		const incident = body.signals.find(value => value.incidentId)?.incidentId!;
		let evidence = await createIssue29Monitor().fetch(new Request(`https://monitor.example.test/ops/monitor/events?incidentId=${incident}&state=firing`, { headers: { authorization: `Bearer ${configuration.EVIDENCE_READ_TOKEN}` } }), configuration);
		expect(evidence.status).toBe(404);
		const forged = await createIssue29Monitor({ now: () => now }).fetch(new Request('https://monitor.example.test/ops/monitor/resend-webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': 'msg_12345678', 'svix-timestamp': String(Math.floor(now / 1000)), 'svix-signature': 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }, body: '{}' }), configuration);
		expect(forged.status).toBe(400);
		const payload = JSON.stringify({ type: 'email.delivered', created_at: new Date(now + 1_000).toISOString(), data: { email_id: '11111111-1111-4111-8111-111111111111' } });
		const webhook = await createIssue29Monitor({ now: () => now }).fetch(await signedWebhook(configuration, 'msg_12345678', payload), configuration);
		expect(webhook.status).toBe(200); evidence = await createIssue29Monitor().fetch(new Request(`https://monitor.example.test/ops/monitor/events?incidentId=${incident}&state=firing`, { headers: { authorization: `Bearer ${configuration.EVIDENCE_READ_TOKEN}` } }), configuration);
		expect(await evidence.json()).toMatchObject({ incidentId: incident, eventType: 'email.delivered', eventId: 'msg_12345678' });
		expect((await createIssue29Monitor({ now: () => now }).fetch(await signedWebhook(configuration, 'msg_12345678', payload), configuration)).status).toBe(404);
		expect((await createIssue29Monitor({ now: () => now }).fetch(await signedWebhook(configuration, 'msg_87654321', JSON.stringify({ type: 'email.delivered', created_at: new Date(now).toISOString(), data: { email_id: '22222222-2222-4222-8222-222222222222' } })), configuration)).status).toBe(404);
		expect((await createIssue29Monitor({ now: () => now }).fetch(await signedWebhook(configuration, 'msg_87654322', JSON.stringify({ type: 'email.sent', created_at: new Date(now).toISOString(), data: { email_id: '11111111-1111-4111-8111-111111111111' } })), configuration)).status).toBe(400);
		body = await (await createIssue29Monitor().fetch(new Request('https://monitor.example.test/ops/monitor/state', { headers: { authorization: `Bearer ${configuration.EVIDENCE_READ_TOKEN}` } }), configuration)).json() as { signals: Array<{ signal: string; incidentId?: string }> };
		expect(body.signals).toHaveLength(9);
	});

	it('preserves a trusted newest backup checkpoint and keeps backup alerts enabled during maintenance', async () => {
		const state = new MemoryKv(); const configuration = env(state); const monitor = createIssue29Monitor({ fetch: fetcher(), now: () => now });
		const checkpoint = { schemaVersion: 1, environment: 'staging', release, checkpointAt: new Date(now - 60_000).toISOString(), descriptorSha256: 'd'.repeat(64), artifactSha256: 'f'.repeat(64) };
		let response = await monitor.fetch(new Request('https://monitor.example.test/ops/monitor/backup-checkpoint', { method: 'POST', headers: { authorization: `Bearer ${configuration.BACKUP_CHECKPOINT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(checkpoint) }), configuration);
		expect(response.status).toBe(204);
		const checkpointReadback = await monitor.fetch(new Request('https://monitor.example.test/ops/monitor/backup-checkpoint', { headers: { authorization: `Bearer ${configuration.EVIDENCE_READ_TOKEN}` } }), configuration);
		expect(await checkpointReadback.json()).toMatchObject({ backupRelease: release, descriptorSha256: checkpoint.descriptorSha256 });
		response = await monitor.fetch(new Request('https://monitor.example.test/ops/monitor/backup-checkpoint', { method: 'POST', headers: { authorization: `Bearer ${configuration.BACKUP_CHECKPOINT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...checkpoint, artifactSha256: 'e'.repeat(64) }) }), configuration);
		expect(response.status).toBe(409);
		response = await monitor.fetch(new Request('https://monitor.example.test/ops/monitor/maintenance', { method: 'PUT', headers: { authorization: `Bearer ${configuration.MAINTENANCE_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ schemaVersion: 1, startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 60_000).toISOString(), incidentId: '22222222-2222-4222-8222-222222222222', target: { origin: 'https://restore.example.test', readinessUrl: 'https://restore.example.test/api/operations/readiness', readinessToken: token('t'), runtimeEnvironment: 'development', release } }) }), configuration);
		expect(response.status).toBe(204);
		const current = await monitor.fetch(new Request('https://monitor.example.test/ops/monitor/heartbeat', { headers: { authorization: `Bearer ${configuration.WATCHDOG_TOKEN}` } }), configuration);
		expect(await current.json()).toMatchObject({ latestTrustedBackupCheckpointAt: checkpoint.checkpointAt, latestTrustedBackupDescriptorSha256: checkpoint.descriptorSha256, latestTrustedBackupArtifactSha256: checkpoint.artifactSha256, maintenance: { active: true } });
		response = await monitor.fetch(new Request('https://monitor.example.test/ops/monitor/maintenance', { method: 'DELETE', headers: { authorization: `Bearer ${configuration.MAINTENANCE_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ schemaVersion: 1, incidentId: '22222222-2222-4222-8222-222222222222' }) }), configuration);
		expect(response.status).toBe(204);
	});

	it('fails closed for unauthenticated runtime reads', async () => {
		const configuration = env(); const response = await createIssue29Monitor().fetch(new Request('https://monitor.example.test/ops/monitor/heartbeat'), configuration);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ ok: false, code: 'not_found' });
	});
	it('serializes concurrent coordinator state updates without dropping the backup checkpoint', async () => {
		const values = new Map<string, string>(); const storage = { get: async <T>(key: string) => values.has(key) ? values.get(key) as T : undefined, put: async (key: string, value: string) => { await Promise.resolve(); values.set(key, value); } };
		const configuration = env() as unknown as Record<string, unknown>; delete configuration.MONITOR_STATE; configuration.MONITOR_COORDINATOR = {};
		const coordinator = new Issue29MonitorCoordinator({ storage }, configuration as never); const checkpoint = { schemaVersion: 1, environment: 'staging', release, checkpointAt: new Date().toISOString(), descriptorSha256: 'd'.repeat(64), artifactSha256: 'c'.repeat(64) };
		const write = coordinator.fetch(new Request('https://internal/ops/monitor/backup-checkpoint', { method: 'POST', headers: { authorization: `Bearer ${env().BACKUP_CHECKPOINT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(checkpoint) }));
		const maintenance=coordinator.fetch(new Request('https://internal/ops/monitor/maintenance',{method:'PUT',headers:{authorization:`Bearer ${env().MAINTENANCE_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({schemaVersion:1,incidentId:'55555555-5555-4555-8555-555555555555',startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+60_000).toISOString()})}));
		expect((await write).status).toBe(204);expect((await maintenance).status).toBe(204);
		const result=await coordinator.fetch(new Request('https://internal/ops/monitor/heartbeat',{headers:{authorization:`Bearer ${env().WATCHDOG_TOKEN}`}}));const readback=await result.json() as any;expect(readback.latestTrustedBackupCheckpointAt).toBe(checkpoint.checkpointAt);expect(readback.maintenance.incidentId).toBe('55555555-5555-4555-8555-555555555555');
	});
});

describe('Issue 29 independent watchdog', () => {
	it('accepts only a fresh Cloudflare monitor heartbeat with expected identity', async () => {
		const result = await verifyMonitorHeartbeat({ env: { MONITOR_HEARTBEAT_URL: 'https://monitor.owner.workers.dev/ops/monitor/heartbeat', MONITOR_WATCHDOG_TOKEN: token('w'), MONITOR_EXPECTED_ENVIRONMENT: 'staging', MONITOR_EXPECTED_RELEASE_SHA: release }, now: () => now, fetchImpl: async () => Response.json({ schemaVersion: 1, environment: 'staging', release, lastSuccessfulMonitorCycleAt: new Date(now - 44 * 60_000).toISOString() }) });
		expect(result.toleratedDelayMinutes).toBe(45);
	});
	it('rejects a stale or identity-mismatched monitor heartbeat', async () => {
		const base = { MONITOR_HEARTBEAT_URL: 'https://monitor.owner.workers.dev/ops/monitor/heartbeat', MONITOR_WATCHDOG_TOKEN: token('w'), MONITOR_EXPECTED_ENVIRONMENT: 'staging', MONITOR_EXPECTED_RELEASE_SHA: release };
		await expect(verifyMonitorHeartbeat({ env: base, now: () => now, fetchImpl: async () => Response.json({ schemaVersion: 1, environment: 'staging', release: 'b'.repeat(40), lastSuccessfulMonitorCycleAt: new Date(now).toISOString() }) })).rejects.toThrow('identity_or_shape_invalid');
		await expect(verifyMonitorHeartbeat({ env: base, now: () => now, fetchImpl: async () => Response.json({ schemaVersion: 1, environment: 'staging', release, lastSuccessfulMonitorCycleAt: new Date(now - 46 * 60_000).toISOString() }) })).rejects.toThrow('heartbeat_stale');
	});
});

it('keeps monitor heartbeat and trusted backup observable when readiness is unavailable', async () => {
 const configuration=env();const monitor=createIssue29Monitor({now:()=>now,fetch:async()=>new Response(null,{status:503})});
 const checkpoint=await monitor.fetch(new Request('https://monitor.example.test/ops/monitor/backup-checkpoint',{method:'POST',headers:{authorization:`Bearer ${configuration.BACKUP_CHECKPOINT_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({schemaVersion:1,environment:'staging',release,checkpointAt:new Date(now).toISOString(),descriptorSha256:'d'.repeat(64),artifactSha256:'e'.repeat(64)})}),configuration);expect(checkpoint.status).toBe(204);
 await monitor.scheduled(configuration);
 const state=await (await monitor.fetch(new Request('https://monitor.example.test/ops/monitor/state',{headers:{authorization:`Bearer ${configuration.EVIDENCE_READ_TOKEN}`}}),configuration)).json() as any;
 expect(state.lastSuccessfulMonitorCycleAt).toBe(new Date(now).toISOString());expect(state.signals.find((s:any)=>s.signal==='backup_freshness').ok).toBe(true);expect(state.signals.find((s:any)=>s.signal==='health').ok).toBe(false);
});
it('creates a new incident for a later failure and persists send intent before every request', async () => {
 const configuration=env();let tick=now,failed=true;const storageIncidents:string[]=[];
 const monitor=createIssue29Monitor({now:()=>tick,fetch:async(input,init)=>{
  if(new URL(String(input)).hostname==='api.resend.com'){
   const body=JSON.parse(String(init?.body));if(body.subject.endsWith(': storage')){
    const persisted=JSON.parse((await configuration.MONITOR_STATE.get('issue29-monitor-state-v1'))!);const current=persisted.signals.storage;expect(current.deliveries[current.alertState].sendStatus).toBe('uncertain');
    storageIncidents.push(current.incidentId);
   }
   return Response.json({id:crypto.randomUUID()});
  }
  return fetcher({readiness:{...readiness(failed?{storage:{ok:false,severity:'critical',reasonCode:'storage_integrity_mismatch'}}:{}),signals:readiness(failed?{storage:{ok:false,severity:'critical',reasonCode:'storage_integrity_mismatch'}}:{}).signals.map(s=>({...s,checkedAt:new Date(tick).toISOString()}))}})(input,init);
 }});
 await monitor.scheduled(configuration);failed=false;tick+=10*60_000;await monitor.scheduled(configuration);tick+=10*60_000;await monitor.scheduled(configuration);failed=true;tick+=10*60_000;await monitor.scheduled(configuration);
 expect(storageIncidents).toHaveLength(3);expect(storageIncidents[0]).toBe(storageIncidents[1]);expect(storageIncidents[2]).not.toBe(storageIncidents[0]);
});
it('reports a missed schedule on resumption and then advances actual cycle heartbeat',async()=>{
 const configuration=env();let tick=now;const sends:string[]=[];
 const monitor=createIssue29Monitor({now:()=>tick,fetch:fetcher({sends})});await monitor.scheduled(configuration);tick+=40*60_000;await monitor.scheduled(configuration);
 const state=await (await monitor.fetch(new Request('https://monitor.example.test/ops/monitor/state',{headers:{authorization:`Bearer ${configuration.EVIDENCE_READ_TOKEN}`}}),configuration)).json() as any;
 expect(state.signals.find((s:any)=>s.signal==='monitor_heartbeat')).toMatchObject({ok:false,reasonCode:'monitor_cycle_gap'});expect(state.lastCompletedMonitorCycleAt).toBe(new Date(tick).toISOString());expect(sends.some(s=>s.includes('monitor_heartbeat'))).toBe(true);
});
it('retains corruption evidence even before the first trusted checkpoint without creating freshness',async()=>{
 const configuration=env(),monitor=createIssue29Monitor({now:()=>now});
 expect((await monitor.fetch(new Request('https://monitor.example.test/ops/monitor/backup-failure',{method:'POST',headers:{authorization:`Bearer ${configuration.BACKUP_CHECKPOINT_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({schemaVersion:1,environment:'staging',release,evidenceSha256:'f'.repeat(64)})}),configuration)).status).toBe(204);
 const proof=await (await monitor.fetch(new Request('https://monitor.example.test/ops/monitor/backup-checkpoint',{headers:{authorization:`Bearer ${configuration.EVIDENCE_READ_TOKEN}`}}),configuration)).json();expect(proof).toMatchObject({backupRelease:null,checkpointAt:null,integrityFailureEvidenceSha256:'f'.repeat(64)});
});
it('does not let a stalled unsigned webhook block the coordinator heartbeat',async()=>{
 const configuration=env();const stored=new Map<string,string>();const coordinator=new Issue29MonitorCoordinator({storage:{get:async<T>(key:string)=>stored.get(key) as T|undefined,put:async(key,value)=>{stored.set(key,value);}}},{...configuration,MONITOR_COORDINATOR:{} as never});
 let finish!:()=>void;const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{'));finish=()=>controller.close();}});
 const hostile=coordinator.fetch(new Request('https://monitor.example.test/ops/monitor/resend-webhook',{method:'POST',headers:{'content-type':'application/json','svix-id':'msg_unsigned123','svix-timestamp':String(Math.floor(now/1000))},body:stream,duplex:'half'} as RequestInit));
 const heartbeat=await coordinator.fetch(new Request('https://monitor.example.test/ops/monitor/heartbeat',{headers:{authorization:`Bearer ${configuration.WATCHDOG_TOKEN}`}}));expect(heartbeat.status).toBe(200);finish();expect((await hostile).status).toBe(400);
});
it.each(['failed','accepted'])('makes persistently %s delivery visible to the independent watchdog',async outcome=>{
 const configuration=env();let tick=now;const requests:{body:string,key:string|null}[]=[];
 const monitor=createIssue29Monitor({now:()=>tick,fetch:async(input,init)=>{if(new URL(String(input)).hostname==='api.resend.com'){requests.push({body:String(init?.body),key:new Headers(init?.headers).get('Idempotency-Key')});return outcome==='failed'?new Response(null,{status:503}):Response.json({id:crypto.randomUUID()});}return fetcher({readiness:readiness({storage:{ok:false,severity:'critical',reasonCode:'storage_integrity_mismatch'}})})(input,init);}});
 for(let i=0;i<=7;i++){tick=now+i*10*60_000;await monitor.scheduled(configuration);}
 const heartbeat=await (await monitor.fetch(new Request('https://monitor.example.test/ops/monitor/heartbeat',{headers:{authorization:`Bearer ${configuration.WATCHDOG_TOKEN}`}}),configuration)).json() as any;
 expect(heartbeat.lastCompletedMonitorCycleAt).toBe(new Date(tick).toISOString());
 await expect(verifyMonitorHeartbeat({env:{MONITOR_HEARTBEAT_URL:'https://monitor.owner.workers.dev/ops/monitor/heartbeat',MONITOR_WATCHDOG_TOKEN:configuration.WATCHDOG_TOKEN,MONITOR_EXPECTED_ENVIRONMENT:'staging',MONITOR_EXPECTED_RELEASE_SHA:release},now:()=>tick,fetchImpl:async()=>Response.json(heartbeat)})).rejects.toThrow('heartbeat_stale');
 const storage=requests.filter(r=>JSON.parse(r.body).subject.endsWith(': storage'));expect(storage).toHaveLength(outcome==='failed'?3:1);expect(new Set(storage.map(r=>r.body)).size).toBe(1);expect(new Set(storage.map(r=>r.key)).size).toBe(1);
});
it('cancels a stalled ingress body at the five-second deadline',async()=>{
 vi.useFakeTimers();try{
  const configuration=env();const coordinator=new Issue29MonitorCoordinator({storage:{get:async()=>undefined,put:async()=>{}}},{...configuration,MONITOR_COORDINATOR:{} as never});let canceled=false;
  const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){canceled=true;}});
  const pending=coordinator.fetch(new Request('https://monitor.example.test/ops/monitor/resend-webhook',{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'} as RequestInit));
  await vi.advanceTimersByTimeAsync(5001);expect((await pending).status).toBe(400);expect(canceled).toBe(true);
 }finally{vi.useRealTimers();}
});
