const MAX_BODY_BYTES = 16 * 1024;
const MAX_AGE_MS = 45 * 60 * 1000;

/** @param {string} code */
function fail(code) { console.error(`monitor_watchdog_failed:${code}`); process.exitCode = 1; }
/** @param {Response} response */
async function boundedJson(response) {
  if (!response.body || Number(response.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) throw new Error('response_invalid');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_BODY_BYTES) throw new Error('response_invalid'); chunks.push(part.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('response_invalid'); }
}
/** @param {{env?:Record<string,string|undefined>,fetchImpl?:typeof fetch,now?:()=>number}} [options] */
export async function verifyMonitorHeartbeat({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const url = (() => { try { const candidate = new URL(requiredFrom(env, 'MONITOR_HEARTBEAT_URL', /^https:\/\/[^/?#]+(?:\/[^?#]*)?$/)); if (candidate.protocol !== 'https:' || !candidate.hostname.endsWith('.workers.dev') || candidate.username || candidate.password || candidate.port || candidate.pathname !== '/ops/monitor/heartbeat' || candidate.search || candidate.hash) throw new Error('invalid_url'); return candidate; } catch { throw new Error('invalid_monitor_heartbeat_url'); } })();
  const token = requiredFrom(env, 'MONITOR_WATCHDOG_TOKEN', /^[A-Za-z0-9_-]{43,256}$/);
  const environment = requiredFrom(env, 'MONITOR_EXPECTED_ENVIRONMENT', /^[a-z][a-z0-9-]{0,62}$/);
  const release = requiredFrom(env, 'MONITOR_EXPECTED_RELEASE_SHA', /^[a-f0-9]{40}$/);
  let response;
  try { response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10_000) }); }
  catch { throw new Error('request_failed'); }
  if (response.status !== 200) { await response.body?.cancel(); throw new Error('endpoint_unavailable'); }
  let body; try { body = await boundedJson(response); } catch { throw new Error('response_invalid'); }
  if (!body || typeof body !== 'object') throw new Error('response_invalid');
  const value = body;
  if (value.schemaVersion !== 1 || value.environment !== environment || value.release !== release || typeof value.lastSuccessfulMonitorCycleAt !== 'string' || !Number.isFinite(Date.parse(value.lastSuccessfulMonitorCycleAt))) throw new Error('identity_or_shape_invalid');
  const age = now() - Date.parse(value.lastSuccessfulMonitorCycleAt);
  if (age < -5 * 60 * 1000 || age > MAX_AGE_MS) throw new Error('heartbeat_stale');
  return { environment, release, heartbeatAt: new Date(value.lastSuccessfulMonitorCycleAt).toISOString(), toleratedDelayMinutes: MAX_AGE_MS / 60_000 };
}
/** @param {Record<string,string|undefined>} env @param {string} name @param {RegExp} pattern */
function requiredFrom(env, name, pattern) { const value = env[name] ?? ''; if (!pattern.test(value)) throw new Error(`invalid_${name.toLowerCase()}`); return value; }
if (import.meta.url === `file://${process.argv[1]}`) {
  try { const result = await verifyMonitorHeartbeat(); console.log(JSON.stringify(result)); }
  catch (error) { const code = error instanceof Error ? error.message : ''; fail(/^(invalid_monitor_(heartbeat_url|watchdog_token|expected_environment|expected_release_sha)|request_failed|endpoint_unavailable|response_invalid|identity_or_shape_invalid|heartbeat_stale)$/.test(code) ? code : 'verification_failed'); }
}
