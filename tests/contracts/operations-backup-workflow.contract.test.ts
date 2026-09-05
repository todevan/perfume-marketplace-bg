import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
const workflow = parse(readFileSync('.github/workflows/operations-backup.yml', 'utf8'));
const job = workflow.jobs['encrypted-backup'];
const steps = job.steps as {
    name?: string;
    uses?: string;
    run?: string;
    env?: Record<string, string>;
    with?: Record<string, unknown>;
    if?: string;
}[];
describe('Issue 29 trusted encrypted backup workflow', () => {
    it('has only default-branch manual and non-round-hour daily triggers, never PR or fork secrets', () => {
        expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
        expect(workflow.on.schedule).toEqual([{ cron: '17 3 * * *' }]);
        for (const guard of ["github.repository == 'todevan/perfume-marketplace-bg'", "github.ref == 'refs/heads/main'", 'github.ref_protected', 'github.workflow_sha == github.sha', 'github.run_attempt == 1'])
            expect(job.if).toContain(guard);
        expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read' });
        expect(job['runs-on']).toBe('ubuntu-24.04');
    });
    it('pins every external action and the exact Node/toolchain dependency contract', () => {
        for (const step of steps.filter(s => s.uses))
            expect(step.uses).toMatch(/@[a-f0-9]{40}$/u);
        expect(steps.find(s => s.uses?.startsWith('actions/setup-node@'))?.with?.['node-version']).toBe('22.23.2');
        expect(steps.find(s => s.run?.includes('pnpm install'))?.run).toBe('pnpm install --frozen-lockfile');
        expect(steps.some(s => s.run?.includes('--passWithNoTests=false'))).toBe(true);
    });
    it('uploads only exact encrypted inputs with 35-day immutable retention and fails on missing files', () => {
        const upload = steps.find(s => s.uses?.startsWith('actions/upload-artifact@'))!;
        expect(upload.with).toMatchObject({ 'retention-days': 35, 'if-no-files-found': 'error', overwrite: false, 'compression-level': 0, 'include-hidden-files': false });
        const paths = String(upload.with?.path).trim().split('\n');
        expect(paths).toHaveLength(3);
        expect(paths.map(p => p.split('/published/')[1])).toEqual(['backup-set.json', 'component-*.bin', 'manifest.bin']);
        const download = steps.find(s => s.uses?.startsWith('actions/download-artifact@'))!;
        expect(download.with?.['artifact-ids']).toBe('${{ steps.upload.outputs.artifact-id }}');
    });
    it('orders intent before upload, actual hash readback before heartbeat, and private cleanup always', () => {
        const at = (text: string) => steps.findIndex(s => s.run?.includes(text) || s.uses?.includes(text));
        expect(at('preparePublication(')).toBeLessThan(at('actions/upload-artifact@'));
        expect(at('actions/upload-artifact@')).toBeLessThan(at('finalizeArtifact('));
        expect(at('finalizeArtifact(')).toBeLessThan(at('beginHeartbeat(p)'));
        const cleanup = steps.at(-1)!;
        expect(cleanup.if).toContain('always()');
        expect(cleanup.run).toContain('cleanupBackupAutomation(');
        const prepareIndex = steps.findIndex(s => s.env?.ISSUE29_BACKUP_AUTHORIZATION_JSON);
        expect(prepareIndex).toBeGreaterThan(at('pnpm install'));
        expect(steps.slice(0, prepareIndex).every(s => !JSON.stringify(s.env ?? {}).includes('secrets.'))).toBe(true);
    });
});
