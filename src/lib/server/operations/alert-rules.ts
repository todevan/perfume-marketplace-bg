import type { OperationsSignal } from './readiness';

type SignalName = OperationsSignal['signal'];
type Rule = { intervalSeconds: number; twoFailureWindowSeconds: number; destinationAlias: 'owner-primary'; ruleAlias: string };
const rule = (signal: SignalName): Rule => ({ intervalSeconds: signal === 'health' ? 300 : 600,
	twoFailureWindowSeconds: 600, destinationAlias: 'owner-primary', ruleAlias: `issue29-${signal.replaceAll('_', '-')}` });
/** Selected Grafana rule contract, not provider configuration or delivery evidence. */
export const OPERATIONS_RULES: Readonly<Record<SignalName, Rule>> = Object.freeze({
	health: rule('health'), auth: rule('auth'), database: rule('database'), storage: rule('storage'),
	email: rule('email'), deals: rule('deals'), safety: rule('safety'),
	backup_freshness: rule('backup_freshness'), monitor_heartbeat: rule('monitor_heartbeat')
});
const REASONS = new Set(['healthy', 'configuration_unavailable', 'deployment_identity_mismatch',
	'auth_probe_failed', 'schema_or_jobs_mismatch', 'snapshot_unavailable', 'sentinel_unavailable',
	'storage_integrity_mismatch', 'storage_processing_unhealthy', 'email_canary_absent',
	'email_delivery_unhealthy', 'deal_invariant_violation', 'safety_invariant_violation',
	'safety_queue_stale', 'checkpoint_unavailable', 'checkpoint_integrity_failed', 'checkpoint_stale']);
const IMMEDIATE = new Set(['deployment_identity_mismatch', 'storage_integrity_mismatch',
	'deal_invariant_violation', 'safety_invariant_violation', 'email_canary_absent']);

export interface OperationsAlertState {
	schemaVersion: 1;
	environment: string;
	deploymentIdentity: string;
	signal: SignalName;
	lastCheckedAt: string;
	lastCorrelationId: string;
	failures: number;
	successes: number;
	firingSeverity: 'none' | 'warning' | 'critical';
}
export interface OperationsAlertNotification extends OperationsSignal {
	state: 'firing' | 'resolved';
	ruleAlias: string;
	destinationAlias: 'owner-primary';
}

/** Pure transition policy; callers must separately bind/authenticate target, clock and persisted state. */
export function evaluateOperationsAlert(previous: OperationsAlertState | undefined, observed: OperationsSignal): {
	state: OperationsAlertState; notification: OperationsAlertNotification | null;
} {
	const selected = OPERATIONS_RULES[observed.signal];
	if (!selected || !['development', 'staging', 'production'].includes(observed.environment) ||
		!/^[0-9a-f]{40}$/.test(observed.deploymentIdentity) ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(observed.correlationId) ||
		!Number.isFinite(Date.parse(observed.checkedAt)) || !REASONS.has(observed.reasonCode) ||
		observed.runbookAnchor !== `docs/INCIDENT-RESPONSE.md#${observed.signal.replaceAll('_', '-')}` ||
		typeof observed.ok !== 'boolean' || (observed.ok ? observed.severity !== 'none' || observed.reasonCode !== 'healthy' :
			!['warning', 'critical'].includes(observed.severity) || observed.reasonCode === 'healthy')) {
		throw new Error('invalid_operations_signal');
	}
	if (previous && (previous.schemaVersion !== 1 || previous.environment !== observed.environment ||
		previous.deploymentIdentity !== observed.deploymentIdentity || previous.signal !== observed.signal ||
		!Number.isFinite(Date.parse(previous.lastCheckedAt)) || !Number.isInteger(previous.failures) ||
		previous.failures < 0 || previous.failures > 2 || !Number.isInteger(previous.successes) || previous.successes < 0 || previous.successes > 2 ||
		!['none', 'warning', 'critical'].includes(previous.firingSeverity))) throw new Error('invalid_operations_alert_state');
	const elapsed = previous ? Date.parse(observed.checkedAt) - Date.parse(previous.lastCheckedAt) : Infinity;
	if (previous && (elapsed <= 0 || observed.correlationId === previous.lastCorrelationId)) return { state: previous, notification: null };
	const immediate = !observed.ok && (IMMEDIATE.has(observed.reasonCode) ||
		observed.signal === 'backup_freshness' || observed.signal === 'monitor_heartbeat');
	if (previous && elapsed < selected.intervalSeconds * 1000 && !immediate) return { state: previous, notification: null };
	const consecutive = elapsed <= selected.twoFailureWindowSeconds * 1000;
	const state: OperationsAlertState = {
		schemaVersion: 1, environment: observed.environment, deploymentIdentity: observed.deploymentIdentity,
		signal: observed.signal, lastCheckedAt: observed.checkedAt, lastCorrelationId: observed.correlationId,
		failures: observed.ok ? 0 : Math.min(2, (consecutive ? previous?.failures ?? 0 : 0) + 1),
		successes: observed.ok ? Math.min(2, (consecutive ? previous?.successes ?? 0 : 0) + 1) : 0,
		firingSeverity: previous?.firingSeverity ?? 'none'
	};
	let transition: 'firing' | 'resolved' | undefined;
	if (!observed.ok && (immediate || state.failures >= 2) &&
		(state.firingSeverity === 'none' || (state.firingSeverity === 'warning' && observed.severity === 'critical'))) {
		state.firingSeverity = observed.severity;
		transition = 'firing';
	} else if (observed.ok && state.successes >= 2 && state.firingSeverity !== 'none') {
		state.firingSeverity = 'none';
		transition = 'resolved';
	}
	// Construct an allowlisted DTO, never spread external input into an alert.
	const notification = transition ? {
		environment: observed.environment, signal: observed.signal, ok: observed.ok,
		severity: observed.severity, checkedAt: observed.checkedAt, deploymentIdentity: observed.deploymentIdentity,
		correlationId: observed.correlationId, reasonCode: observed.reasonCode, runbookAnchor: observed.runbookAnchor,
		state: transition, ruleAlias: selected.ruleAlias, destinationAlias: selected.destinationAlias
	} : null;
	return { state, notification };
}
