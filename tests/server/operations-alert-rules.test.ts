import { describe, expect, it } from 'vitest';
import { evaluateOperationsAlert, OPERATIONS_RULES } from '../../src/lib/server/operations/alert-rules';
import type { OperationsSignal } from '../../src/lib/server/operations/readiness';

function result(minutes: number, ok = false, name: OperationsSignal['signal'] = 'health', reasonCode = 'auth_probe_failed'): OperationsSignal {
	return { environment: 'staging', signal: name, ok, severity: ok ? 'none' : 'critical',
		checkedAt: new Date(Date.parse('2026-09-05T12:00:00Z') + minutes * 60000).toISOString(),
		deploymentIdentity: 'a'.repeat(40), correlationId: `11111111-1111-4111-8111-${String(minutes).padStart(12, '0')}`,
		reasonCode: ok ? 'healthy' : reasonCode, runbookAnchor: `docs/INCIDENT-RESPONSE.md#${name.replaceAll('_', '-')}` };
}
describe('selected Grafana alert signal contract', () => {
	it('fires once after two five-minute health failures and recovers after two successes', () => {
		const first = evaluateOperationsAlert(undefined, result(0));
		expect(first.notification).toBeNull();
		const second = evaluateOperationsAlert(first.state, result(5));
		expect(second.notification).toMatchObject({ state: 'firing', ruleAlias: 'issue29-health', destinationAlias: 'owner-primary' });
		const repeat = evaluateOperationsAlert(second.state, result(10));
		expect(repeat.notification).toBeNull();
		const recovering = evaluateOperationsAlert(repeat.state, result(15, true));
		expect(recovering.notification).toBeNull();
		const recovered = evaluateOperationsAlert(recovering.state, result(20, true));
		expect(recovered.notification).toMatchObject({ state: 'resolved', destinationAlias: 'owner-primary' });
	});
	it.each(Object.keys(OPERATIONS_RULES) as OperationsSignal['signal'][])
	('maps %s to one fixed private destination and exact rule alias', (name) => {
		expect(OPERATIONS_RULES[name].destinationAlias).toBe('owner-primary');
		expect(OPERATIONS_RULES[name].ruleAlias).toBe(`issue29-${name.replaceAll('_', '-')}`);
	});
	it.each([
		['health', 'deployment_identity_mismatch'], ['storage', 'storage_integrity_mismatch'],
		['deals', 'deal_invariant_violation'], ['safety', 'safety_invariant_violation'],
		['email', 'email_canary_absent'], ['backup_freshness', 'checkpoint_stale'],
		['monitor_heartbeat', 'checkpoint_stale']
	] as const)('fires %s/%s immediately without waiting for a second failure', (name, reason) => {
		expect(evaluateOperationsAlert(undefined, result(0, false, name, reason)).notification).toMatchObject({ state: 'firing', severity: 'critical' });
	});
	it('requires protected failures inside ten minutes and does not count duplicate rapid polls', () => {
		const first = evaluateOperationsAlert(undefined, result(0, false, 'auth'));
		const rapid = evaluateOperationsAlert(first.state, result(1, false, 'auth'));
		expect(rapid.state).toEqual(first.state);
		expect(evaluateOperationsAlert(first.state, result(10, false, 'auth')).notification?.state).toBe('firing');
		expect(evaluateOperationsAlert(first.state, result(11, false, 'auth')).notification).toBeNull();
	});
	it('deduplicates identical and out-of-order evaluations including immediate failures', () => {
		const signal = result(10, false, 'storage', 'storage_integrity_mismatch');
		const first = evaluateOperationsAlert(undefined, signal);
		expect(evaluateOperationsAlert(first.state, signal).notification).toBeNull();
		expect(evaluateOperationsAlert(first.state, result(0, false, 'storage', 'storage_integrity_mismatch')).state).toEqual(first.state);
	});
	it('escalates backup warning to critical once and still requires two recoveries', () => {
		const warning = result(0, false, 'backup_freshness', 'checkpoint_stale');
		warning.severity = 'warning';
		const first = evaluateOperationsAlert(undefined, warning);
		expect(first.notification?.severity).toBe('warning');
		const critical = evaluateOperationsAlert(first.state, result(10, false, 'backup_freshness', 'checkpoint_stale'));
		expect(critical.notification?.severity).toBe('critical');
		const oneSuccess = evaluateOperationsAlert(critical.state, result(20, true, 'backup_freshness'));
		expect(oneSuccess.notification).toBeNull();
		expect(evaluateOperationsAlert(oneSuccess.state, result(30, true, 'backup_freshness')).notification?.state).toBe('resolved');
	});
	it('rejects private content in reason codes and never copies extra fields to notifications', () => {
		expect(() => evaluateOperationsAlert(undefined, result(0, false, 'safety', 'private@example.test'))).toThrow('invalid_operations_signal');
		const malicious = { ...result(0, false, 'safety', 'safety_invariant_violation'), providerBody: 'private@example.test', token: 'secret' };
		expect(JSON.stringify(evaluateOperationsAlert(undefined, malicious))).not.toMatch(/private@example.test|secret|providerBody/);
	});
	it('does not carry prior-environment or prior-deployment alert state forward', () => {
		const first = evaluateOperationsAlert(undefined, result(0));
		expect(() => evaluateOperationsAlert(first.state, { ...result(10), environment: 'production' })).toThrow('invalid_operations_alert_state');
		expect(() => evaluateOperationsAlert(first.state, { ...result(10), deploymentIdentity: 'b'.repeat(40) })).toThrow('invalid_operations_alert_state');
	});
});
