import { describe, it, expect } from 'vitest';
import { verifyMonitorHeartbeat } from '../../scripts/issue29-operations/monitor-watchdog.mjs';
const now = Date.parse('2026-09-08T12:00:00Z');
const env = { MONITOR_HEARTBEAT_URL: 'https://monitor.owner.workers.dev/ops/monitor/heartbeat', MONITOR_WATCHDOG_TOKEN: 'w'.repeat(43), MONITOR_EXPECTED_ENVIRONMENT: 'synthetic-recovery', MONITOR_EXPECTED_RELEASE_SHA: 'a'.repeat(40) };
const body = { schemaVersion: 1, environment: env.MONITOR_EXPECTED_ENVIRONMENT, release: env.MONITOR_EXPECTED_RELEASE_SHA, lastSuccessfulMonitorCycleAt: new Date(now - 44 * 60_000).toISOString() };
describe('independent monitor heartbeat watchdog', () => {
 it('tolerates explicit schedule delay and checks the monitor timestamp', async () => {
  const proof = await verifyMonitorHeartbeat({ env, now: () => now, fetchImpl: async () => Response.json(body) });
  expect(proof.toleratedDelayMinutes).toBe(45);
 });
 it.each([46, -6])('rejects stale or future monitor heartbeat (%s minutes)', async minutes => {
  await expect(verifyMonitorHeartbeat({ env, now: () => now, fetchImpl: async () => Response.json({ ...body, lastSuccessfulMonitorCycleAt: new Date(now - minutes * 60_000).toISOString() }) })).rejects.toThrow('heartbeat_stale');
 });
 it('does not accept its own execution timestamp or a foreign release', async () => {
  await expect(verifyMonitorHeartbeat({ env, now: () => now, fetchImpl: async () => Response.json({ ...body, release: 'b'.repeat(40) }) })).rejects.toThrow('identity_or_shape_invalid');
 });
 it('bounds and sanitizes provider response parsing', async () => {
  await expect(verifyMonitorHeartbeat({ env, fetchImpl: async () => new Response('private provider body') })).rejects.toThrow(/^response_invalid$/);
  let canceled = false;
  const response = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20_000)); }, cancel() { canceled = true; } }));
  await expect(verifyMonitorHeartbeat({ env, fetchImpl: async () => response })).rejects.toThrow('response_invalid'); expect(canceled).toBe(true);
 });
 it.each(['https://foreign.example/ops/monitor/heartbeat','https://monitor.owner.workers.dev/private','https://user:secret@monitor.owner.workers.dev/ops/monitor/heartbeat'])('rejects invalid target before sending credentials', async url => {
  let called = false;
  await expect(verifyMonitorHeartbeat({ env: { ...env, MONITOR_HEARTBEAT_URL: url }, fetchImpl: async () => { called = true; return Response.json(body); } })).rejects.toThrow('invalid_monitor_heartbeat_url'); expect(called).toBe(false);
 });
});
