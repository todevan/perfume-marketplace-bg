import { describe, expect, it } from 'vitest';
import { createOperationsReadinessHandler } from '../../src/lib/server/operations/readiness';

const now = Date.parse('2026-09-05T12:00:00Z');
const config = {
	monitorToken: 'm'.repeat(64), environment: 'staging', deploymentIdentity: 'a'.repeat(40),
	expectedDeploymentIdentity: 'a'.repeat(40), supabaseOrigin: 'https://synthetic.supabase.co',
	publicKey: 'publishable-test', serverKey: 'server-test', migrationDigest: 'b'.repeat(64),
	schemaDigest: 'c'.repeat(64), sentinelBucket: 'operations-sentinels',
	sentinelPath: '11111111-1111-4111-8111-111111111111/sentinel.bin',
	sentinelSha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
	canaryExpectedUtc: '08:17', safetyWarningHours: 24, safetyCriticalHours: 48
};
const healthySnapshot = {
	schemaVersion: 1, migrationDigest: 'b'.repeat(64), schemaDigest: 'c'.repeat(64),
	notificationsFailed: 0, notificationsStale: 0, emailDownstreamFailed: 0, emailDownstreamMissing: 0,
	cleanupRetries: 0, cleanupDeadLetters: 0, quarantineStuck: 0, jobsHealthy: true,
	dealViolations: 0, safetyViolations: 0, reportQueueOldestAt: null,
	checkpoints: Object.fromEntries(['backup_freshness', 'monitor_heartbeat', 'email_canary'].map((kind) => [kind,
		{ deploymentIdentity: 'a'.repeat(40), checkpointAt: new Date(now).toISOString(), ok: true, evidenceSha256: 'd'.repeat(64) }]))
};
function input(token = config.monitorToken) {
	return new Request('https://example.test/api/operations/readiness', { headers: { authorization: `Bearer ${token}` } });
}
function provider(snapshot: unknown = healthySnapshot, sentinel = 'hello') {
	return async (target: string | URL | Request) => {
		const url = target.toString();
		if (url.endsWith('/auth/v1/health')) return Response.json({ version: 'provider-private' });
		if (url.endsWith('/auth/v1/user')) return Response.json({ msg: 'invalid JWT' }, { status: 401 });
		if (url.includes('/storage/v1/object/')) return new Response(sentinel);
		if (url.endsWith('/rest/v1/rpc/get_operations_snapshot')) return Response.json(snapshot);
		throw new Error('unexpected external operation');
	};
}

describe('protected aggregate operations readiness HTTP seam', () => {
	it('requires a dedicated monitor credential before provider reads', async () => {
		const handler = createOperationsReadinessHandler({ now: () => now, fetch: async () => { throw new Error('must not run'); } });
		const response = await handler(input('wrong'), config);
		expect(response.status).toBe(401);
		expect(await response.text()).toBe('{"ok":false,"code":"unauthorized"}');
	});
	it('proves all nine signal families without exposing provider data, counts or topology', async () => {
		const handler = createOperationsReadinessHandler({ now: () => now, fetch: provider() });
		const response = await handler(input(), config);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.schemaVersion).toBe(1);
		expect(body.signals.map((signal: {signal: string}) => signal.signal)).toEqual([
			'health', 'auth', 'database', 'storage', 'email', 'deals', 'safety', 'backup_freshness', 'monitor_heartbeat'
		]);
		for (const signal of body.signals) {
			expect(signal.ok).toBe(true);
			expect(Object.keys(signal).sort()).toEqual(['checkedAt', 'correlationId', 'deploymentIdentity',
				'environment', 'ok', 'reasonCode', 'runbookAnchor', 'severity', 'signal']);
		}
		expect(JSON.stringify(body)).not.toMatch(/provider-private|supabase.co|server-test|checkpointAt|sentinel.bin/);
	});
	it.each([
		['deployment_identity_mismatch', 'health', { expectedDeploymentIdentity: 'e'.repeat(40) }, healthySnapshot, 'hello'],
		['storage_integrity_mismatch', 'storage', {}, healthySnapshot, 'corrupt'],
		['deal_invariant_violation', 'deals', {}, { ...healthySnapshot, dealViolations: 1 }, 'hello'],
		['safety_invariant_violation', 'safety', {}, { ...healthySnapshot, safetyViolations: 1 }, 'hello'],
		['snapshot_unavailable', 'database', {}, { leakedEmail: 'private@example.test' }, 'hello'],
		['schema_or_jobs_mismatch', 'database', {}, { ...healthySnapshot, migrationDigest: '0'.repeat(64) }, 'hello']
	])('reports %s without externalizing provider contents', async (reason, signalName, changed, snapshot, sentinel) => {
		const handler = createOperationsReadinessHandler({ now: () => now, fetch: provider(snapshot, sentinel as string) });
		const body = await (await handler(input(), { ...config, ...changed as object })).json();
		expect(body.signals.find((value: {signal: string}) => value.signal === signalName)).toMatchObject({ ok: false, severity: 'critical', reasonCode: reason });
		expect(JSON.stringify(body)).not.toContain('private@example.test');
	});
	it.each([[24, true, 'none'], [24.1, false, 'warning'], [26.1, false, 'critical']])
	('evaluates original backup checkpoint age at %s hours', async (hours, ok, severity) => {
		const snapshot = structuredClone(healthySnapshot);
		snapshot.checkpoints.backup_freshness.checkpointAt = new Date(now - Number(hours) * 3600000).toISOString();
		const handler = createOperationsReadinessHandler({ now: () => now, fetch: provider(snapshot) });
		const body = await (await handler(input(), config)).json();
		expect(body.signals.find((value: {signal: string}) => value.signal === 'backup_freshness')).toMatchObject({ ok, severity });
	});
	it('makes missing canary delivery distinguishable for the immediate alert rule', async () => {
		const snapshot = structuredClone(healthySnapshot);
		snapshot.checkpoints.email_canary.checkpointAt = new Date(now - 26 * 3600000).toISOString();
		const handler = createOperationsReadinessHandler({ now: () => now, fetch: provider(snapshot) });
		const body = await (await handler(input(), config)).json();
		expect(body.signals.find((value: {signal: string}) => value.signal === 'email')).toMatchObject({ ok: false, reasonCode: 'email_canary_absent' });
	});
	it('never refreshes check timestamps when serving cached probes and still authenticates', async () => {
		let clock = now;
		let reads = 0;
		const fetcher = provider();
		const handler = createOperationsReadinessHandler({ now: () => clock, fetch: async (...args) => { reads++; return fetcher(args[0]); } });
		const first = await (await handler(input(), config)).json();
		clock += 10000;
		const second = await (await handler(input(), config)).json();
		expect(second).toEqual(first);
		expect(reads).toBe(4);
		expect((await handler(input('wrong'), config)).status).toBe(401);
	});
	it('treats absent backup and heartbeat checkpoints as unavailable rather than fresh', async () => {
		const handler = createOperationsReadinessHandler({ now: () => now, fetch: provider({ ...healthySnapshot, checkpoints: {} }) });
		const body = await (await handler(input(), config)).json();
		for (const signalName of ['backup_freshness', 'monitor_heartbeat']) {
			expect(body.signals.find((value: {signal: string}) => value.signal === signalName)).toMatchObject({ ok: false, reasonCode: 'checkpoint_unavailable' });
		}
	});
	it('fails closed on redirects and ignores malicious provider errors', async () => {
		const handler = createOperationsReadinessHandler({ now: () => now, fetch: async (_, init) => {
			expect(init?.redirect).toBe('error');
			throw new Error('private@example.test service-key provider body');
		} });
		const body = await (await handler(input(), config)).json();
		expect(body.signals.filter((signal: {ok: boolean}) => !signal.ok)).toHaveLength(8);
		expect(JSON.stringify(body)).not.toMatch(/private@example.test|service-key|provider body/);
	});
	it('rejects concurrent expensive probes rather than sharing cross-request I/O promises', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const fetcher = provider();
		const handler = createOperationsReadinessHandler({ now: () => now, fetch: async (...args) => {
			await gate;
			return fetcher(args[0]);
		} });
		const pending = handler(input(), config);
		expect((await handler(input(), config)).status).toBe(429);
		release();
		expect((await pending).status).toBe(200);
	});
	it('rejects an oversized sentinel without returning paths or object contents', async () => {
		const handler = createOperationsReadinessHandler({ now: () => now, fetch: provider(healthySnapshot, 'private'.repeat(1000)) });
		const body = await (await handler(input(), config)).json();
		expect(body.signals.find((value: {signal: string}) => value.signal === 'storage')).toMatchObject({ ok: false, reasonCode: 'sentinel_unavailable' });
		expect(JSON.stringify(body)).not.toContain('private');
	});
	it('requires explicit configuration and permits no caller-selected target or mutation', async () => {
		let reads = 0;
		const handler = createOperationsReadinessHandler({ now: () => now, fetch: async () => { reads++; throw new Error('must not read'); } });
		const unconfigured = await (await handler(input(), { ...config, canaryExpectedUtc: '' })).json();
		expect(unconfigured.signals.every((value: {ok: boolean; reasonCode: string}) => !value.ok && value.reasonCode === 'configuration_unavailable')).toBe(true);
		const changedTarget = new Request(`${input().url}?target=https://foreign.example`, { headers: input().headers });
		expect((await handler(changedTarget, config)).status).toBe(400);
		expect((await handler(new Request(input().url, { method: 'POST', headers: input().headers }), config)).status).toBe(400);
		expect(reads).toBe(0);
	});
	it('does not reuse cached health after credential or deployment configuration changes', async () => {
		const handler = createOperationsReadinessHandler({ now: () => now, fetch: provider() });
		await handler(input(), config);
		const changed = { ...config, monitorToken: 'n'.repeat(64), expectedDeploymentIdentity: 'e'.repeat(40) };
		expect((await handler(input(), changed)).status).toBe(401);
		const body = await (await handler(input(changed.monitorToken), changed)).json();
		expect(body.signals[0]).toMatchObject({ ok: false, reasonCode: 'deployment_identity_mismatch' });
	});
});
