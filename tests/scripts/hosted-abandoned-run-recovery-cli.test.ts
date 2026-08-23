import { describe, expect, it, vi } from 'vitest';

describe('abandoned Gate 3 recovery CLI', () => {
  it('fails closed before hosted access when operator credentials are unavailable', async () => {
    const cliModule = await import(
      '../../scripts/hosted-abandoned-run-recovery-cli.mjs'
    ).catch(() => null);

    expect(cliModule).not.toBeNull();
    if (!cliModule) return;

    expect(typeof cliModule.runAbandonedRecoveryCli).toBe('function');

    const createClientImpl = vi.fn(() => {
      throw new Error('client construction must not occur without credentials');
    });

    const output = vi.fn();

    const exitCode = await cliModule.runAbandonedRecoveryCli({
      argv: ['dry-run'],
      environment: {},
      createClientImpl,
      output,
      errorOutput: output
    });

    expect(exitCode).toBe(1);
    expect(createClientImpl).not.toHaveBeenCalled();

    const rendered = output.mock.calls.flat().join('\n');

    expect(rendered).toContain('Recovery runner failed safely.');
    expect(rendered).not.toMatch(
      /password|service.?role|access.?token|encryption.?key|totp.?secret/iu
    );
  });
});

  it('exposes the recovery CLI through package scripts', async () => {
    const packageJson = await import('../../package.json', {
      with: { type: 'json' }
    });

    expect(packageJson.default.scripts['gate3:recovery']).toBe(
      'node scripts/hosted-abandoned-run-recovery-cli.mjs'
    );
  });
