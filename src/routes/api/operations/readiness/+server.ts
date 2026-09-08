import { env } from '$env/dynamic/private';
import { version } from '$app/environment';
import type { RequestHandler } from './$types';
import { createOperationsReadinessHandler } from '$lib/server/operations/readiness';

const readiness = createOperationsReadinessHandler();

export const GET: RequestHandler = ({ request, locals, platform }) => {
	const value = (key: string) => platform?.env?.[key] ?? env[key];
	const runtime = locals.runtime;
	if (runtime.mode !== 'production') {
		return Response.json({ ok: false, code: 'monitor_unavailable' }, {
			status: 503, headers: { 'cache-control': 'private, no-store' }
		});
	}
	return readiness(request, {
		monitorToken: value('OPERATIONS_MONITOR_TOKEN'), environment: runtime.appEnvironment,
		deploymentIdentity: version, expectedDeploymentIdentity: value('OPERATIONS_EXPECTED_DEPLOYMENT_SHA'),
		supabaseOrigin: runtime.publicSupabaseUrl, publicKey: runtime.publicSupabaseKey,
		serverKey: runtime.supabaseSecretKey,
		migrationDigest: value('OPERATIONS_EXPECTED_MIGRATION_DIGEST'),
		schemaDigest: value('OPERATIONS_EXPECTED_SCHEMA_DIGEST'),
		sentinelBucket: 'operations-sentinels', sentinelPath: value('OPERATIONS_SENTINEL_PATH'),
		sentinelSha256: value('OPERATIONS_SENTINEL_SHA256'),
		canaryExpectedUtc: value('OPERATIONS_CANARY_EXPECTED_UTC') ?? '',
		safetyWarningHours: Number(value('OPERATIONS_SAFETY_WARNING_HOURS') ?? 24),
		safetyCriticalHours: Number(value('OPERATIONS_SAFETY_CRITICAL_HOURS') ?? 48)
	});
};
