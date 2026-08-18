import { runStagingSmoke, runStagingRollbackSmoke } from '../smoke-staging.mjs';

const origin = 'https://perfume-marketplace-bg-issue22.perfume-marketplace-bg.workers.dev';
const expectedGitSha = process.env.ISSUE22_CANDIDATE_SHA?.trim();
const mode = process.argv[2];

if (!/^[0-9a-f]{40}$/u.test(expectedGitSha ?? '')) throw new TypeError('ISSUE22_CANDIDATE_SHA is required');

if (mode === 'rollback') {
	await runStagingRollbackSmoke({ origin, expectedGitSha, attempts: 3, delayMs: 2_000 });
} else if (mode === 'candidate') {
	await runStagingSmoke({ origin, expectedGitSha, attempts: 6, delayMs: 5_000 });
} else {
	throw new TypeError('Usage: node smoke.mjs rollback|candidate');
}
