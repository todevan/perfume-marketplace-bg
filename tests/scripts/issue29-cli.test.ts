import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
const cli = 'scripts/issue29-operations/cli.mjs';
function run(...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  if (result.error) throw result.error;
  return result;
}
describe('Issue 29 verification entry point', () => {
  it('identifies available local verification without claiming hosted readiness', () => {
    const result = run('--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('verify-backup');
    expect(result.stdout).toContain('validate-receipt');
    expect(result.stdout).toContain('Backup requires current manifest-owned synthetic source');
  });
  it.each(['monitoring-proof', 'incident-drill', 'cleanup'])('fails closed for unwired hosted %s', (command) => {
    const result = run(command);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('HOSTED_EXECUTION_UNAVAILABLE');
    expect(result.stdout).not.toContain('PASS');
  });
  it.each(['backup-set','restore','verify-restore'])('requires private transaction and settings for wired %s', command => {
    const result=run(command);expect(result.status).toBe(2);expect(result.stderr).toContain('ARGUMENTS_INVALID');
  });
  it('rejects unsupported arguments without reflecting sensitive text', () => {
    const result = run('verify-backup', '--token=private-secret');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('ARGUMENTS_INVALID');
    expect(result.stderr).not.toContain('private-secret');
  });
});
